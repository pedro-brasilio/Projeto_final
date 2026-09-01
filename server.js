// Servidor da Neon AI.
//
// Responsabilidades deste arquivo: subir o Express, expor as rotas e orquestrar
// as peças (contexto -> roteamento -> OpenAI). A lógica de cada parte vive em
// modules separados:
//   services/openai.js   -> conversa com a OpenAI Responses API
//   services/omdb.js     -> detalhes de filmes e séries (OMDb)
//   services/tmdb.js     -> listas de estreias/populares e busca pt-BR (TMDB)
//   services/igdb.js     -> dados atuais de jogos (IGDB, via OAuth da Twitch)
//   chat/context.js      -> histórico da conversa
//   chat/router.js       -> decide quando consultar dados externos
//   chat/errors.js       -> mensagens de erro sem vazar detalhe técnico
//   chat/systemPrompt.js -> System Prompt permanente da Neon

import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import { SYSTEM_PROMPT } from "./chat/systemPrompt.js";
import { conversationStore, MAX_MENSAGENS } from "./chat/context.js";
import { historyStore, MAX_CONVERSAS } from "./chat/historyStore.js";
import { rotearMensagem } from "./chat/router.js";
import { gerarResposta } from "./services/openai.js";
import * as tmdb from "./services/tmdb.js";
import * as igdb from "./services/igdb.js";
import { mensagemErroAleatoria, registrarErroInterno } from "./chat/errors.js";
import dealsRoutes from "./routes/deals.routes.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "32kb" }));

const LIMITE_MENSAGEM = 2000;

// Valida o corpo recebido do frontend. Retorna { ok, message, sessionId } ou { ok:false, erro }.
function validarEntrada(body) {
  if (!body || typeof body !== "object") {
    return { ok: false, erro: "Corpo da requisição inválido." };
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return { ok: false, erro: "Envie uma mensagem de texto." };
  }
  if (message.length > LIMITE_MENSAGEM) {
    return { ok: false, erro: `Mensagem muito longa (máximo ${LIMITE_MENSAGEM} caracteres).` };
  }

  const sessionId =
    typeof body.sessionId === "string" && body.sessionId.trim()
      ? body.sessionId.trim().slice(0, 100)
      : "default";

  return { ok: true, message, sessionId };
}

// Identifica o dono das conversas. O projeto não tem login: o frontend gera um
// id por dispositivo e o envia no header "x-user-id" (ou no corpo, como userId).
function getUserId(req) {
  const bruto =
    (typeof req.headers["x-user-id"] === "string" && req.headers["x-user-id"]) ||
    (typeof req.body?.userId === "string" && req.body.userId) ||
    "";
  const limpo = bruto.trim().slice(0, 100);
  return limpo || "default";
}

app.get("/", (req, res) => {
  res.send("BEM VINDO AO SERVIDOR NEON AI");
});

// Integração de promoções de jogos (CheapShark hoje; preparada para outras
// fontes no futuro). Módulo isolado: rotas, controllers, provider e cache
// próprios em routes/, controllers/, providers/ e utils/. Ver routes/deals.routes.js.
app.use("/api", dealsRoutes);

app.post("/chat", async (req, res) => {
  const entrada = validarEntrada(req.body);
  if (!entrada.ok) {
    return res.status(400).json({ retornoChat: entrada.erro });
  }

  const { message, sessionId } = entrada;
  const userId = getUserId(req);
  console.log(`\nRequisição [${sessionId}]:`, message);

  try {
    // 0. Se o contexto em memória desta sessão está vazio (servidor reiniciou ou
    //    o usuário reabriu uma conversa antiga), recarrega do histórico em disco.
    if (conversationStore.getHistory(sessionId).length === 0) {
      const salva = historyStore.obter(userId, sessionId);
      if (salva && salva.messages.length) {
        for (const m of salva.messages.slice(-MAX_MENSAGENS)) {
          if (m.role === "assistant") conversationStore.appendAssistant(sessionId, m.content);
          else conversationStore.appendUser(sessionId, m.content);
        }
      }
    }

    // 1. Histórico atual da sessão + mensagem nova.
    conversationStore.appendUser(sessionId, message);
    const historico = conversationStore.getHistory(sessionId);

    // 2. Decidir se precisa de dados externos e buscá-los.
    const { dadosExternos, fonteUsada } = await rotearMensagem({
      historico,
      mensagem: message
    });
    if (fonteUsada) console.log(`  -> dados atuais via ${fonteUsada}`);

    // 3. Gerar a resposta com a OpenAI (System Prompt sempre separado).
    const resposta = await gerarResposta({
      instrucoes: SYSTEM_PROMPT,
      historico,
      dadosExternos
    });

    const texto = resposta || "Não consegui formular uma resposta agora. Tente reformular a pergunta.";

    // 4. Guardar a resposta no contexto em memória.
    conversationStore.appendAssistant(sessionId, texto);

    // 5. Persistir a troca no histórico em disco (sobrevive a reinícios).
    //    A conversa é criada aqui se ainda não existir, respeitando o limite
    //    de MAX_CONVERSAS (a mais antiga é removida ao criar a 6ª).
    let removedConversationIds = [];
    try {
      const r1 = historyStore.adicionarMensagem(userId, sessionId, "user", message);
      const r2 = historyStore.adicionarMensagem(userId, sessionId, "assistant", texto);
      removedConversationIds = [...new Set([...(r1.removedIds || []), ...(r2.removedIds || [])])];
    } catch (erroHist) {
      registrarErroInterno("server./chat.historico", erroHist);
    }

    res.json({ retornoChat: texto, removedConversationIds });
  } catch (erro) {
    registrarErroInterno("server./chat", erro);
    // Remove a última mensagem do usuário para não sujar o contexto com uma
    // troca que não teve resposta.
    conversationStore.removerUltima(sessionId);
    res.status(502).json({ retornoChat: mensagemErroAleatoria() });
  }
});

// Zera o contexto de uma sessão (usado ao iniciar "Nova conversa" ou limpar histórico).
app.post("/chat/reset", (req, res) => {
  const sessionId =
    typeof req.body?.sessionId === "string" && req.body.sessionId.trim()
      ? req.body.sessionId.trim().slice(0, 100)
      : "default";
  conversationStore.reset(sessionId);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Histórico de conversas (persistido em disco por chat/historyStore.js).
// O dono das conversas vem de getUserId(req) -> header "x-user-id".
// ---------------------------------------------------------------------------

// Lista as conversas do usuário, da mais recente para a mais antiga.
app.get("/conversations", (req, res) => {
  const userId = getUserId(req);
  res.json({ conversations: historyStore.listar(userId), limite: MAX_CONVERSAS });
});

// Cria uma nova conversa. Aplica o limite de MAX_CONVERSAS: se já houver 5,
// a mais antiga é removida durante a criação.
app.post("/conversations", (req, res) => {
  const userId = getUserId(req);
  const id = typeof req.body?.id === "string" ? req.body.id : undefined;
  const title = typeof req.body?.title === "string" ? req.body.title : undefined;
  const { conversation, removedIds } = historyStore.criar(userId, { id, title });
  res.status(201).json({ conversation, removedConversationIds: removedIds });
});

// Retorna uma conversa específica com todas as suas mensagens.
app.get("/conversations/:id", (req, res) => {
  const userId = getUserId(req);
  const conversation = historyStore.obter(userId, req.params.id);
  if (!conversation) {
    return res.status(404).json({ erro: "Conversa não encontrada." });
  }
  res.json({ conversation });
});

// Exclui manualmente uma conversa e suas mensagens.
app.delete("/conversations/:id", (req, res) => {
  const userId = getUserId(req);
  const removeu = historyStore.excluir(userId, req.params.id);
  if (!removeu) {
    return res.status(404).json({ erro: "Conversa não encontrada." });
  }
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Catálogos (jogos e filmes) para as abas de descoberta do frontend.
// Os dados vêm da IGDB (jogos) e da TMDB (filmes). Como um catálogo muda pouco
// e as APIs têm limite de uso, guardamos o resultado em memória por 6 horas.
// ---------------------------------------------------------------------------

const CATALOGO_TTL_MS = 6 * 60 * 60 * 1000;
const catalogoCache = new Map(); // chave -> { dados, expiraEm }

async function servirCatalogo(res, chave, configurado, carregar) {
  if (!configurado) {
    return res.json({ items: [], configurado: false });
  }

  const cache = catalogoCache.get(chave);
  if (cache && Date.now() < cache.expiraEm) {
    return res.json({ items: cache.dados, configurado: true, cache: true });
  }

  try {
    const dados = await carregar();
    catalogoCache.set(chave, { dados, expiraEm: Date.now() + CATALOGO_TTL_MS });
    res.json({ items: dados, configurado: true, cache: false });
  } catch (erro) {
    registrarErroInterno(`server./catalog/${chave}`, erro);
    // Se ainda houver um resultado antigo em cache, devolve ele em vez de falhar.
    if (cache) {
      return res.json({ items: cache.dados, configurado: true, cache: true, stale: true });
    }
    res.status(502).json({ items: [], configurado: true, erro: true });
  }
}

app.get("/catalog/games", (req, res) =>
  servirCatalogo(res, "games", igdb.igdbConfigurado(), () => igdb.catalogoJogos({ limite: 12 }))
);

app.get("/catalog/movies", (req, res) =>
  servirCatalogo(res, "movies", tmdb.tmdbConfigurado(), () => tmdb.catalogoFilmes({ limite: 12 }))
);

app.listen(3000, () => {
  console.log("Servidor Neon AI rodando na porta 3000");
});

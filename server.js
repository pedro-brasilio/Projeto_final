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
import { conversationStore } from "./chat/context.js";
import { rotearMensagem } from "./chat/router.js";
import { gerarResposta } from "./services/openai.js";
import { mensagemErroAleatoria, registrarErroInterno } from "./chat/errors.js";

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

app.get("/", (req, res) => {
  res.send("BEM VINDO AO SERVIDOR NEON AI");
});

app.post("/chat", async (req, res) => {
  const entrada = validarEntrada(req.body);
  if (!entrada.ok) {
    return res.status(400).json({ retornoChat: entrada.erro });
  }

  const { message, sessionId } = entrada;
  console.log(`\nRequisição [${sessionId}]:`, message);

  try {
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

    // 4. Guardar a resposta no histórico e devolver ao frontend.
    conversationStore.appendAssistant(sessionId, texto);
    res.json({ retornoChat: texto });
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

app.listen(3000, () => {
  console.log("Servidor Neon AI rodando na porta 3000");
});

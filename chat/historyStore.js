// Histórico de conversas — persistência SEM banco de dados.
//
// Guardamos as conversas num arquivo JSON no disco (data/history.json). Isso
// sobrevive a reinícios do processo Node, ao contrário do contexto em memória de
// `chat/context.js` (que continua responsável apenas pela janela de contexto
// enviada ao modelo).
//
// Estrutura do arquivo:
//   {
//     "conversations": [
//       {
//         "id": "c-...",              // id único (o mesmo que o front usa como sessionId)
//         "userId": "u-...",          // dono da conversa (device id vindo do header x-user-id)
//         "title": "GTA VI",          // título (1ª mensagem do usuário, encurtada)
//         "messages": [ { "role": "user"|"assistant", "content": "...", "createdAt": "ISO" } ],
//         "createdAt": "ISO",         // data de criação
//         "updatedAt": "ISO"          // data da última atualização
//       }
//     ]
//   }
//
// Deploy no Render: o disco padrão do Render é efêmero. Para manter o histórico
// entre deploys/reinícios lá, crie um "Persistent Disk" e aponte a variável
// HISTORY_FILE para um caminho dentro dele (ex.: /var/data/history.json).

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

// Máximo de conversas guardadas POR USUÁRIO. Ao criar a 6ª, a mais antiga sai.
const MAX_CONVERSAS = 5;

// Teto de mensagens por conversa (evita o arquivo crescer sem limite).
const MAX_MENSAGENS_POR_CONVERSA = 400;

// Corta mensagens muito longas antes de gravar.
const MAX_CARACTERES_POR_MENSAGEM = 8000;

const ARQUIVO_PADRAO = path.resolve(process.cwd(), "data", "history.json");
const ARQUIVO = process.env.HISTORY_FILE
  ? path.resolve(process.env.HISTORY_FILE)
  : ARQUIVO_PADRAO;

function agora() {
  return new Date().toISOString();
}

function normalizarConteudo(texto) {
  const limpo = String(texto ?? "").trim();
  if (limpo.length <= MAX_CARACTERES_POR_MENSAGEM) return limpo;
  return limpo.slice(0, MAX_CARACTERES_POR_MENSAGEM) + " [...]";
}

function tituloDeMensagem(texto) {
  const limpo = String(texto ?? "").replace(/\s+/g, " ").trim();
  if (!limpo) return "Nova conversa";
  return limpo.length > 40 ? limpo.slice(0, 40) + "…" : limpo;
}

class HistoryStore {
  constructor(arquivo = ARQUIVO) {
    this._arquivo = arquivo;
    this._db = { conversations: [] };
    this._carregar();
  }

  _carregar() {
    try {
      const bruto = fs.readFileSync(this._arquivo, "utf8");
      const dados = JSON.parse(bruto);
      if (dados && Array.isArray(dados.conversations)) {
        this._db = { conversations: dados.conversations };
      }
    } catch {
      // Arquivo ainda não existe ou está ilegível: começa vazio.
      this._db = { conversations: [] };
    }
  }

  _salvar() {
    try {
      fs.mkdirSync(path.dirname(this._arquivo), { recursive: true });
      // Grava em arquivo temporário e renomeia: reduz risco de corromper o
      // JSON se o processo cair no meio da escrita.
      const tmp = this._arquivo + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(this._db, null, 2), "utf8");
      fs.renameSync(tmp, this._arquivo);
    } catch (erro) {
      console.error("Falha ao gravar histórico:", erro?.message ?? erro);
    }
  }

  _chaveUsuario(userId) {
    const id = String(userId ?? "").trim();
    return id ? id.slice(0, 100) : "default";
  }

  _doUsuario(userId) {
    const chave = this._chaveUsuario(userId);
    return this._db.conversations.filter((c) => c.userId === chave);
  }

  // Da mais recente para a mais antiga (por updatedAt; cai para createdAt).
  _ordenarRecentes(lista) {
    return [...lista].sort(
      (a, b) =>
        Date.parse(b.updatedAt ?? b.createdAt ?? 0) -
        Date.parse(a.updatedAt ?? a.createdAt ?? 0)
    );
  }

  // Aplica o limite de MAX_CONVERSAS removendo as conversas MAIS ANTIGAS
  // (por createdAt) do usuário. Devolve os ids removidos.
  _aplicarLimite(userId) {
    const chave = this._chaveUsuario(userId);
    const doUsuario = this._db.conversations
      .filter((c) => c.userId === chave)
      .sort((a, b) => Date.parse(a.createdAt ?? 0) - Date.parse(b.createdAt ?? 0));

    const excedente = doUsuario.length - MAX_CONVERSAS;
    if (excedente <= 0) return [];

    const removidos = new Set(doUsuario.slice(0, excedente).map((c) => c.id));
    this._db.conversations = this._db.conversations.filter((c) => !removidos.has(c.id));
    return [...removidos];
  }

  // ---- API pública --------------------------------------------------------

  // Lista resumida das conversas do usuário, da mais recente para a mais antiga.
  listar(userId) {
    return this._ordenarRecentes(this._doUsuario(userId)).map((c) => ({
      id: c.id,
      title: c.title,
      userId: c.userId,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      messageCount: Array.isArray(c.messages) ? c.messages.length : 0
    }));
  }

  // Conversa específica com as mensagens. `null` se não existir para o usuário.
  obter(userId, id) {
    const chave = this._chaveUsuario(userId);
    const conv = this._db.conversations.find((c) => c.id === id && c.userId === chave);
    if (!conv) return null;
    return {
      id: conv.id,
      title: conv.title,
      userId: conv.userId,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
      messages: (conv.messages ?? []).map((m) => ({
        role: m.role,
        content: m.content,
        createdAt: m.createdAt
      }))
    };
  }

  // Cria uma conversa. `id` é opcional (permite reaproveitar o id que o front
  // já gera). Aplica o limite de 5 removendo a mais antiga se necessário.
  // Retorna { conversation, removedIds }.
  criar(userId, { id, title } = {}) {
    const chave = this._chaveUsuario(userId);
    const convId =
      String(id ?? "").trim() || "c-" + Date.now() + "-" + randomUUID().slice(0, 8);

    const existente = this._db.conversations.find(
      (c) => c.id === convId && c.userId === chave
    );
    if (existente) {
      return { conversation: this.obter(userId, convId), removedIds: [] };
    }

    const ts = agora();
    this._db.conversations.push({
      id: convId,
      userId: chave,
      title: title ? tituloDeMensagem(title) : "Nova conversa",
      messages: [],
      createdAt: ts,
      updatedAt: ts
    });

    const removedIds = this._aplicarLimite(userId);
    this._salvar();
    return { conversation: this.obter(userId, convId), removedIds };
  }

  // Exclui manualmente uma conversa (e suas mensagens). Retorna true se removeu.
  excluir(userId, id) {
    const chave = this._chaveUsuario(userId);
    const antes = this._db.conversations.length;
    this._db.conversations = this._db.conversations.filter(
      (c) => !(c.id === id && c.userId === chave)
    );
    const removeu = this._db.conversations.length < antes;
    if (removeu) this._salvar();
    return removeu;
  }

  // Garante que a conversa existe (criando-a e aplicando o limite de 5 se for
  // o caso) e acrescenta uma mensagem. Usado pelo fluxo do POST /chat.
  // Retorna { conversation, removedIds }.
  adicionarMensagem(userId, id, role, content) {
    const chave = this._chaveUsuario(userId);
    let conv = this._db.conversations.find((c) => c.id === id && c.userId === chave);
    let removedIds = [];

    if (!conv) {
      const ts = agora();
      conv = {
        id: String(id ?? "").trim() || "c-" + Date.now(),
        userId: chave,
        title: "Nova conversa",
        messages: [],
        createdAt: ts,
        updatedAt: ts
      };
      this._db.conversations.push(conv);
      removedIds = this._aplicarLimite(userId);
      // Caso extremo: se a própria conversa recém-criada saiu pelo limite
      // (não deveria, é a mais nova), aborta sem gravar mensagem.
      if (removedIds.includes(conv.id)) {
        this._salvar();
        return { conversation: null, removedIds };
      }
    }

    conv.messages.push({
      role: role === "assistant" ? "assistant" : "user",
      content: normalizarConteudo(content),
      createdAt: agora()
    });
    if (conv.messages.length > MAX_MENSAGENS_POR_CONVERSA) {
      conv.messages.splice(0, conv.messages.length - MAX_MENSAGENS_POR_CONVERSA);
    }
    if ((!conv.title || conv.title === "Nova conversa") && role === "user") {
      conv.title = tituloDeMensagem(content);
    }
    conv.updatedAt = agora();

    this._salvar();
    return { conversation: this.obter(userId, conv.id), removedIds };
  }

  // Remove a última mensagem de uma conversa (usado quando uma troca falha e
  // não queremos deixar a pergunta sem resposta).
  removerUltimaMensagem(userId, id) {
    const chave = this._chaveUsuario(userId);
    const conv = this._db.conversations.find((c) => c.id === id && c.userId === chave);
    if (conv && conv.messages.length) {
      conv.messages.pop();
      conv.updatedAt = agora();
      this._salvar();
    }
  }
}

export const historyStore = new HistoryStore();
export { MAX_CONVERSAS };

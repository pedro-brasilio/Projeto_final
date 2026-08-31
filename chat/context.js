// Histórico e contexto da conversa.
//
// O chatbot ainda não tem contas de usuário. Por enquanto usamos um armazenamento
// em memória, com uma sessão por `sessionId` (o frontend envia o id da conversa
// atual; se não enviar, cai numa sessão única "default").
//
// A estrutura foi pensada para ser trocada no futuro por sessões individuais ou
// banco de dados: basta implementar a mesma interface de `ConversationStore`
// (getHistory / appendUser / appendAssistant / reset) apontando para outro backend.

// Quantas mensagens (user + assistant somados) mantemos por sessão.
// 16 mensagens = cerca de 8 trocas, suficiente para resolver referências como
// "ele", "esse filme", "o segundo", "e o jogo?" sem enviar um histórico gigante.
const MAX_MENSAGENS = 16;

// Corta o conteúdo de cada mensagem para não estourar o contexto caso alguém
// cole um texto enorme.
const MAX_CARACTERES_POR_MENSAGEM = 4000;

function normalizarConteudo(texto) {
  const limpo = String(texto ?? "").trim();
  if (limpo.length <= MAX_CARACTERES_POR_MENSAGEM) return limpo;
  return limpo.slice(0, MAX_CARACTERES_POR_MENSAGEM) + " [...]";
}

class MemoryConversationStore {
  constructor() {
    // Map<sessionId, Array<{ role: "user" | "assistant", content: string }>>
    this._sessoes = new Map();
  }

  _chave(sessionId) {
    const id = String(sessionId ?? "").trim();
    return id || "default";
  }

  // Devolve uma cópia do histórico pronta para a Responses API.
  getHistory(sessionId) {
    const hist = this._sessoes.get(this._chave(sessionId)) ?? [];
    return hist.map((m) => ({ role: m.role, content: m.content }));
  }

  appendUser(sessionId, texto) {
    this._append(sessionId, "user", texto);
  }

  appendAssistant(sessionId, texto) {
    this._append(sessionId, "assistant", texto);
  }

  _append(sessionId, role, texto) {
    const chave = this._chave(sessionId);
    const hist = this._sessoes.get(chave) ?? [];
    hist.push({ role, content: normalizarConteudo(texto) });
    // Mantém apenas as últimas MAX_MENSAGENS mensagens.
    if (hist.length > MAX_MENSAGENS) hist.splice(0, hist.length - MAX_MENSAGENS);
    this._sessoes.set(chave, hist);
  }

  // Remove a última mensagem registrada (usado quando uma troca falha e não
  // queremos deixar a pergunta sem resposta no histórico).
  removerUltima(sessionId) {
    const hist = this._sessoes.get(this._chave(sessionId));
    if (hist && hist.length) hist.pop();
  }

  // Zera uma sessão (usado ao iniciar "Nova conversa" ou limpar histórico).
  reset(sessionId) {
    this._sessoes.delete(this._chave(sessionId));
  }
}

export const conversationStore = new MemoryConversationStore();
export { MAX_MENSAGENS };

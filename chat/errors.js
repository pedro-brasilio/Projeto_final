// Tratamento e mascaramento de erros.
//
// Regra: o usuário nunca deve ver stack trace, chave de API, JSON técnico
// ou mensagem interna do Node. Quando algo falha, devolvemos uma frase
// aleatória inspirada em cultura geek e registramos o detalhe apenas no
// console do servidor.

export const MENSAGENS_ERRO_API = [
  "Erro na API. Ela entrou em outra dimensão. 🌀",
  "Erro na API. Ela não alcançou 88 mph. ⚡",
  "Erro na API. Foi para uma galáxia muito, muito distante.",
  "Erro na API. Os Vingadores já foram chamados. 🦸",
  "Game Over para a API. Tente novamente. 🎮",
  "Erro na API. Parece que o feitiço falhou. 🪄",
  "A API encontrou um chefão inesperado. Tente novamente.",
  "Erro na API. Perdemos o sinal no multiverso.",
  "A Força não foi suficiente... a API retornou um erro.",
  "O DeLorean falhou na viagem e a API não conseguiu voltar. Tente novamente. ⚡"
];

export function mensagemErroAleatoria() {
  const i = Math.floor(Math.random() * MENSAGENS_ERRO_API.length);
  return MENSAGENS_ERRO_API[i];
}

// Registra o erro real somente no servidor, de forma resumida.
export function registrarErroInterno(contexto, erro) {
  const detalhe = erro?.message ?? erro?.toString?.() ?? String(erro);
  console.error(`[${contexto}]`, detalhe);
}

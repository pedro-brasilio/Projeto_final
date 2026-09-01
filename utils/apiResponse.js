// Formato padrão de resposta das rotas de promoções (/api/deals, /api/games...).
//
// Sucesso:
//   { "success": true, "data": [...], "pagination": { "page": 0, "limit": 20 } }
// Erro:
//   { "success": false, "error": { "message": "..." } }
//
// Nunca enviamos stack trace nem detalhe técnico ao frontend. O detalhe real
// é registrado só no servidor (registrarErroInterno).

// Erro "de aplicação": carrega o status HTTP e uma mensagem já segura para o
// usuário. O restante do código lança instâncias disto e o controller apenas
// as converte em resposta.
export class ApiError extends Error {
  constructor(status, mensagemPublica, causa) {
    super(mensagemPublica);
    this.name = "ApiError";
    this.status = status;
    this.publicMessage = mensagemPublica;
    if (causa) this.cause = causa;
  }
}

// Atalhos para os casos previstos na especificação.
export const erros = {
  parametroInvalido: (msg = "Parâmetro inválido.") => new ApiError(400, msg),
  naoEncontrado: (msg = "Recurso não encontrado.") => new ApiError(404, msg),
  interno: (msg = "Erro interno ao processar a requisição.") => new ApiError(500, msg),
  upstream: (msg = "Não foi possível se comunicar com a fonte de dados externa.", causa) =>
    new ApiError(502, msg, causa),
  timeout: (msg = "A fonte de dados externa demorou demais para responder.", causa) =>
    new ApiError(504, msg, causa)
};

export function responderSucesso(res, data, pagination) {
  const corpo = { success: true, data };
  if (pagination) corpo.pagination = pagination;
  return res.json(corpo);
}

export function responderErro(res, status, mensagem) {
  return res.status(status).json({
    success: false,
    error: { message: mensagem }
  });
}

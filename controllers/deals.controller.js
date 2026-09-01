// Controllers das rotas de promoções.
//
// Responsabilidades:
//   - validar e sanitizar TODO parâmetro vindo do frontend (nunca confiar nele);
//   - chamar o provider certo (via providers/index.js);
//   - devolver sempre o formato padrão (utils/apiResponse.js);
//   - traduzir erros em status HTTP corretos, sem vazar detalhe técnico.
//
// Os controllers NÃO conhecem a CheapShark: falam só com a interface de provider.
// Trocar/registrar outra fonte (PlayStation, Xbox...) não muda nada aqui.

import { getProvider, PROVIDER_PADRAO } from "../providers/index.js";
import { SORTS_VALIDOS } from "../providers/cheapShark.provider.js";
import { getUsdToBrl } from "../services/exchangeRate.service.js";
import { responderSucesso, responderErro, ApiError, erros } from "../utils/apiResponse.js";
import { registrarErroInterno } from "../chat/errors.js";

// Teto absoluto de itens por requisição (limite da CheapShark é 60).
const LIMIT_MAX = 60;
const LIMIT_PADRAO = 20;
const TOP_LIMIT_PADRAO = 12;
const QUERY_MAX = 200;

// ---------- sanitizadores ----------

function inteiro(valor, { min = 0, max = Infinity, padrao }) {
  if (valor === undefined || valor === null || valor === "") return padrao;
  const n = Number.parseInt(valor, 10);
  if (!Number.isFinite(n)) return padrao;
  return Math.min(Math.max(n, min), max);
}

function numeroNaoNegativo(valor) {
  if (valor === undefined || valor === null || valor === "") return undefined;
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

function apenasDigitos(valor) {
  if (valor === undefined || valor === null) return undefined;
  const limpo = String(valor).trim();
  return /^\d+$/.test(limpo) ? limpo : undefined;
}

function booleano(valor, padrao = undefined) {
  if (valor === undefined || valor === "") return padrao;
  if (valor === "1" || valor === "true" || valor === true) return true;
  if (valor === "0" || valor === "false" || valor === false) return false;
  return padrao;
}

function textoBusca(valor) {
  if (typeof valor !== "string") return "";
  // colapsa espaços e corta no limite; remove caracteres de controle.
  return valor
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, QUERY_MAX);
}

// ---------- tratamento de erro comum a todas as rotas ----------

function tratarErro(res, contexto, erro) {
  if (erro instanceof ApiError) {
    if (erro.status >= 500) registrarErroInterno(contexto, erro.cause || erro);
    return responderErro(res, erro.status, erro.publicMessage);
  }
  registrarErroInterno(contexto, erro);
  return responderErro(res, 500, "Erro interno ao processar a requisição.");
}

// Resolve o provider pedido (?provider=) ou o padrão. 400 se pedir um inexistente.
function resolverProvider(req) {
  const pedido = typeof req.query.provider === "string" ? req.query.provider : PROVIDER_PADRAO;
  const provider = getProvider(pedido);
  if (!provider) {
    throw erros.parametroInvalido(`Fonte de promoções desconhecida: "${pedido}".`);
  }
  if (!provider.isConfigured()) {
    throw erros.upstream(`A fonte de promoções "${provider.id}" não está disponível agora.`);
  }
  return provider;
}

// ---------------------------------------------------------------------------
// GET /api/deals  — promoções gerais, paginadas.
//   ?page=0&limit=20&sort=dealRating&desc=1&store=1&upperPrice=15&lowerPrice=0
//   &onSale=1&metacritic=75&steamRating=80&title=zelda&provider=cheapshark
// ---------------------------------------------------------------------------
export async function listarDeals(req, res) {
  try {
    const provider = resolverProvider(req);

    const page = inteiro(req.query.page, { min: 0, max: 500, padrao: 0 });
    const limit = inteiro(req.query.limit, { min: 1, max: LIMIT_MAX, padrao: LIMIT_PADRAO });

    const sort = SORTS_VALIDOS.includes(req.query.sort) ? req.query.sort : "dealRating";
    const desc = booleano(req.query.desc, true);
    const storeId = apenasDigitos(req.query.store ?? req.query.storeID ?? req.query.storeId);

    // O frontend envia a faixa de preço em REAL; a CheapShark filtra em USD.
    const cotacao = await getUsdToBrl();
    const brlParaUsd = (v) => (v == null ? undefined : Math.round((v / cotacao) * 100) / 100);
    const upperPrice = brlParaUsd(numeroNaoNegativo(req.query.upperPrice ?? req.query.maxPrice));
    const lowerPrice = brlParaUsd(numeroNaoNegativo(req.query.lowerPrice ?? req.query.minPrice));
    const onSale = booleano(req.query.onSale, true);
    const metacritic = inteiro(req.query.metacritic, { min: 0, max: 100, padrao: undefined });
    const steamRating = inteiro(req.query.steamRating, { min: 0, max: 100, padrao: undefined });
    const title = textoBusca(req.query.title || "") || undefined;

    const { items, hasMore } = await provider.getDeals({
      page,
      limit,
      sort,
      desc,
      storeId,
      upperPrice,
      lowerPrice,
      onSale,
      metacritic,
      steamRating,
      title
    });

    return responderSucesso(res, items, {
      page,
      limit,
      count: items.length,
      sort,
      hasMore: Boolean(hasMore)
    });
  } catch (erro) {
    return tratarErro(res, "deals.controller.listarDeals", erro);
  }
}

// ---------------------------------------------------------------------------
// GET /api/deals/top  — melhores promoções atuais.  ?limit=12&sort=dealRating
// ---------------------------------------------------------------------------
export async function listarTopDeals(req, res) {
  try {
    const provider = resolverProvider(req);
    const limit = inteiro(req.query.limit, { min: 1, max: LIMIT_MAX, padrao: TOP_LIMIT_PADRAO });
    const sort = SORTS_VALIDOS.includes(req.query.sort) ? req.query.sort : "dealRating";

    const { items } = await provider.getTopDeals({ limit, sort });
    return responderSucesso(res, items, { page: 0, limit, count: items.length, sort });
  } catch (erro) {
    return tratarErro(res, "deals.controller.listarTopDeals", erro);
  }
}

// ---------------------------------------------------------------------------
// GET /api/games/search?q=Cyberpunk  — busca jogo pelo nome. 400 se q vazio.
// ---------------------------------------------------------------------------
export async function buscarJogos(req, res) {
  try {
    const provider = resolverProvider(req);
    const q = textoBusca(req.query.q ?? req.query.title ?? "");
    if (!q) {
      return responderErro(res, 400, 'Informe o termo de busca no parâmetro "q".');
    }
    const limit = inteiro(req.query.limit, { min: 1, max: LIMIT_MAX, padrao: LIMIT_PADRAO });

    const { items } = await provider.searchGames({ query: q, limit });
    return responderSucesso(res, items, { query: q, limit, count: items.length });
  } catch (erro) {
    return tratarErro(res, "deals.controller.buscarJogos", erro);
  }
}

// ---------------------------------------------------------------------------
// GET /api/games/:gameId/deals  — ofertas de um jogo em cada loja. 404 se sumir.
// ---------------------------------------------------------------------------
export async function ofertasDoJogo(req, res) {
  try {
    const provider = resolverProvider(req);
    const gameId = apenasDigitos(req.params.gameId);
    if (!gameId) {
      return responderErro(res, 400, "O id do jogo deve ser numérico.");
    }

    const { item } = await provider.getGameDeals({ gameId });
    if (!item) {
      return responderErro(res, 404, "Jogo não encontrado ou sem ofertas disponíveis.");
    }
    return responderSucesso(res, item);
  } catch (erro) {
    return tratarErro(res, "deals.controller.ofertasDoJogo", erro);
  }
}

// ---------------------------------------------------------------------------
// GET /api/stores  — lojas suportadas.  ?active=1 para só as ativas.
// ---------------------------------------------------------------------------
export async function listarLojas(req, res) {
  try {
    const provider = resolverProvider(req);
    const onlyActive = booleano(req.query.active, false);

    const { items } = await provider.getStores({ onlyActive });
    return responderSucesso(res, items, { count: items.length });
  } catch (erro) {
    return tratarErro(res, "deals.controller.listarLojas", erro);
  }
}

// Provider de promoções: CheapShark (jogos de PC).
//
// Um "provider" transforma dados de UMA fonte externa no formato interno do
// projeto e expõe sempre a MESMA interface:
//
//   id, label, platform, isConfigured()
//   getDeals(opts)      -> { items }
//   getTopDeals(opts)   -> { items }
//   searchGames(opts)   -> { items }
//   getGameDeals(opts)  -> { item } | { item: null }
//   getStores(opts)     -> { items }
//
// Amanhã, providers/playstation.provider.js, xbox.provider.js e
// nintendo.provider.js implementam essa mesma interface e entram no registro
// em providers/index.js — sem tocar nos controllers nem no frontend.
//
// O cache vive AQUI (não nos controllers). Trocar utils/cache.js por um
// adaptador Redis migra tudo de uma vez.

import {
  fetchDeals,
  fetchGamesByTitle,
  fetchGameById,
  fetchStores,
  cheapSharkConfigurado
} from "../services/cheapShark.service.js";
import {
  normalizeDeal,
  normalizeGameDeal,
  normalizeGameSearchResult,
  normalizeStore,
  usdParaBrl,
  imagemHd,
  imagensFallback
} from "../utils/normalizeDeal.js";
import { getUsdToBrl } from "../services/exchangeRate.service.js";
import { dealsCache, TTL } from "../utils/cache.js";
import { registrarErroInterno } from "../chat/errors.js";

// Ordenações que o frontend pode pedir -> valor aceito pela CheapShark (sortBy).
const SORT_MAP = {
  dealRating: "Deal Rating",
  price: "Price",
  savings: "Savings",
  discount: "Savings",
  title: "Title",
  metacritic: "Metacritic",
  reviews: "Reviews",
  release: "Release",
  store: "Store",
  recent: "recent"
};

export const SORTS_VALIDOS = Object.keys(SORT_MAP);

// ---------------------------------------------------------------------------
// Lista de lojas — cache de 60 min e um índice (Map por id) para enriquecer as
// ofertas com nome/logo da loja.
// ---------------------------------------------------------------------------
async function carregarLojas() {
  return dealsCache.wrap("cheapshark:stores", TTL.LOJAS, async () => {
    const cru = await fetchStores();
    return cru.map(normalizeStore).filter((s) => s && s.id);
  });
}

async function mapaDeLojas() {
  try {
    const lojas = await carregarLojas();
    return new Map(lojas.map((l) => [l.id, l]));
  } catch (erro) {
    // Enriquecer a loja é "bônus": se a lista falhar, as ofertas ainda saem
    // (com store.name/logo nulos).
    registrarErroInterno("cheapShark.provider.mapaDeLojas", erro);
    return new Map();
  }
}

// ---------------------------------------------------------------------------
// Remoção de duplicatas.
// A CheapShark às vezes repete o MESMO jogo na MESMA loja (edições, dealIDs
// diferentes para a mesma oferta, gameIDs distintos do mesmo título). Regra:
// o mesmo jogo só pode aparecer uma vez POR LOJA — fica a oferta mais barata.
// O mesmo jogo em lojas DIFERENTES continua aparecendo (é o objetivo: comparar).
// ---------------------------------------------------------------------------
function menorPreco(oferta) {
  return oferta?.pricing?.sale ?? oferta?.cheapestPrice ?? Infinity;
}

function semDuplicatas(lista, { porLoja = true } = {}) {
  const vistos = new Map();
  for (const item of lista) {
    const titulo = (item.title || "").trim().toLowerCase();
    const loja = item.store && item.store.id ? String(item.store.id) : "";
    const chave = porLoja ? `${titulo}|${loja}` : titulo;
    const atual = vistos.get(chave);
    if (!atual || menorPreco(item) < menorPreco(atual)) {
      vistos.set(chave, item);
    }
  }
  return [...vistos.values()];
}

// Para as ofertas de UM jogo: uma por loja (a mais barata).
function umaOfertaPorLoja(ofertas) {
  const vistos = new Map();
  ofertas.forEach((o, i) => {
    const loja = o.store && o.store.id ? String(o.store.id) : `?${i}`;
    const atual = vistos.get(loja);
    if (!atual || menorPreco(o) < menorPreco(atual)) vistos.set(loja, o);
  });
  return [...vistos.values()];
}

// ---------------------------------------------------------------------------
// Interface do provider
// ---------------------------------------------------------------------------

export const id = "cheapshark";
export const label = "CheapShark (PC)";
export const platform = "pc";

export function isConfigured() {
  return cheapSharkConfigurado();
}

// Promoções gerais, paginadas.
export async function getDeals(opts = {}) {
  const {
    page = 0,
    limit = 20,
    sort = "dealRating",
    desc = true,
    storeId,
    upperPrice,
    lowerPrice,
    onSale = true,
    metacritic,
    steamRating,
    title
  } = opts;

  const params = {
    pageNumber: page,
    pageSize: limit,
    sortBy: SORT_MAP[sort] || SORT_MAP.dealRating,
    desc: desc ? 1 : 0,
    storeID: storeId,
    upperPrice,
    lowerPrice,
    onSale: onSale ? 1 : undefined,
    metacritic,
    steamRating,
    title
  };

  const chave = "cheapshark:deals:" + JSON.stringify(params);
  const { items, hasMore } = await dealsCache.wrap(chave, TTL.DEALS, async () => {
    const [cru, lojas, cotacao] = await Promise.all([
      fetchDeals(params),
      mapaDeLojas(),
      getUsdToBrl()
    ]);
    const norm = cru.map((d) => normalizeDeal(d, lojas, cotacao)).filter(Boolean);
    // hasMore olha o total CRU (antes de deduplicar), senão a paginação
    // "acabaria" cedo toda vez que uma página tivesse repetidos.
    return { items: semDuplicatas(norm), hasMore: cru.length >= limit };
  });

  return { items, hasMore };
}

// Seleção das melhores promoções (padrão: melhor "deal rating" da CheapShark).
export async function getTopDeals(opts = {}) {
  const { limit = 12, sort = "dealRating" } = opts;
  const params = {
    pageNumber: 0,
    pageSize: limit,
    sortBy: SORT_MAP[sort] || SORT_MAP.dealRating,
    desc: 1,
    onSale: 1
  };

  const chave = "cheapshark:top:" + JSON.stringify(params);
  const items = await dealsCache.wrap(chave, TTL.TOP, async () => {
    const [cru, lojas, cotacao] = await Promise.all([
      fetchDeals(params),
      mapaDeLojas(),
      getUsdToBrl()
    ]);
    const norm = cru
      .map((d) => normalizeDeal(d, lojas, cotacao))
      .filter(Boolean)
      // Reforça a ordenação por desconto quando dealRating vier vazio.
      .sort((a, b) => {
        const dr = (b.dealRating ?? 0) - (a.dealRating ?? 0);
        return dr !== 0 ? dr : b.pricing.discountPercent - a.pricing.discountPercent;
      });
    return semDuplicatas(norm);
  });

  return { items };
}

// Busca por nome digitado pelo usuário.
export async function searchGames(opts = {}) {
  const { query, limit = 20 } = opts;
  const chave = `cheapshark:search:${limit}:${String(query).toLowerCase()}`;
  const items = await dealsCache.wrap(chave, TTL.BUSCA, async () => {
    const [cru, cotacao] = await Promise.all([
      fetchGamesByTitle(query, { limit }),
      getUsdToBrl()
    ]);
    const norm = cru
      .map((g) => normalizeGameSearchResult(g, cotacao))
      .filter((g) => g && g.gameId);
    // Sem loja aqui: dedupe por título (títulos iguais = mesmo jogo repetido),
    // ficando o de menor preço.
    return semDuplicatas(norm, { porLoja: false });
  });
  return { items };
}

// Todas as ofertas de um jogo específico (comparação entre lojas).
export async function getGameDeals(opts = {}) {
  const { gameId } = opts;
  const chave = `cheapshark:game:${gameId}`;
  const item = await dealsCache.wrap(chave, TTL.DETALHES, async () => {
    const [dados, lojas, cotacao] = await Promise.all([
      fetchGameById(gameId),
      mapaDeLojas(),
      getUsdToBrl()
    ]);
    if (!dados) return null;

    const ofertas = umaOfertaPorLoja(
      (dados.deals || [])
        .map((d) =>
          normalizeGameDeal(d, { gameId, info: dados.info, storeMap: lojas, cotacaoUsdBrl: cotacao })
        )
        .filter(Boolean)
    ).sort((a, b) => (a.pricing.sale ?? Infinity) - (b.pricing.sale ?? Infinity));

    return {
      gameId: String(gameId),
      title: dados.info?.title || null,
      thumbnail: imagemHd(dados.info?.thumb, dados.info?.steamAppID),
      thumbnailFallback: imagensFallback(dados.info?.thumb, dados.info?.steamAppID),
      steamAppId: dados.info?.steamAppID || null,
      cheapestPriceEver: dados.cheapestPriceEver
        ? {
            currency: "BRL",
            price: usdParaBrl(dados.cheapestPriceEver.price, cotacao),
            date: dados.cheapestPriceEver.date
              ? new Date(dados.cheapestPriceEver.date * 1000).toISOString().slice(0, 10)
              : null
          }
        : null,
      deals: ofertas
    };
  });

  return { item };
}

// Lista de lojas suportadas.
export async function getStores(opts = {}) {
  const { onlyActive = false } = opts;
  const lojas = await carregarLojas();
  return { items: onlyActive ? lojas.filter((l) => l.active) : lojas };
}

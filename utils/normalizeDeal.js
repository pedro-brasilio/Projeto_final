// Normalização: estrutura da CheapShark -> estrutura interna do projeto.
//
// O frontend NUNCA vê o JSON cru da CheapShark. Todo dado que sai do backend
// passa por aqui e ganha o formato abaixo, que é o mesmo independentemente de
// qual provider (CheapShark hoje; PlayStation/Xbox/Nintendo amanhã) originou a
// oferta.
//
// Formato de uma oferta (deal):
//   {
//     id, dealId, gameId, title,
//     store:   { id, name, logo },
//     pricing: { normal, sale, discountPercent },
//     ratings: { metacritic, steam },
//     thumbnail, dealRating, releaseDate, redirectUrl
//   }
//
// Regras:
//   - preços são NÚMEROS em REAL (BRL), convertidos de USD pela cotação atual
//     (services/exchangeRate.service.js). A CheapShark só fornece USD.
//   - campos ausentes viram null (nunca "undefined" ou string vazia crua);
//   - nenhum campo extra da CheapShark vaza para o frontend.

const SITE_URL = (process.env.CHEAPSHARK_SITE_URL || "https://www.cheapshark.com").replace(/\/$/, "");

// "12.34" -> 12.34 ; "" / null / lixo -> null
function paraNumero(valor) {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

// Converte um valor em USD para BRL usando a cotação (reais por dólar).
// Sem cotação válida, devolve o valor original (melhor que quebrar).
export function usdParaBrl(valorUsd, cotacao) {
  const n = paraNumero(valorUsd);
  if (n === null) return null;
  const taxa = Number(cotacao);
  if (!Number.isFinite(taxa) || taxa <= 0) return Math.round(n * 100) / 100;
  return Math.round(n * taxa * 100) / 100;
}

// A CheapShark manda `savings` como "50.360000". Arredondamos para inteiro.
// Se não vier, calculamos a partir de normal/sale.
function percentualDesconto(savings, normal, sale) {
  const s = paraNumero(savings);
  if (s !== null) return Math.round(s);
  if (normal && sale !== null && normal > 0) {
    return Math.round(((normal - sale) / normal) * 100);
  }
  return 0;
}

// Timestamp unix (segundos) -> "AAAA-MM-DD". 0 / ausente -> null.
function dataDeUnix(segundos) {
  const n = paraNumero(segundos);
  if (!n) return null;
  const d = new Date(n * 1000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// Nota "porcentagem" da Steam (0..100) -> null quando não informada.
function steamRating(percent) {
  const n = paraNumero(percent);
  return n === null || n === 0 ? null : n;
}

function metacritic(score) {
  const n = paraNumero(score);
  return n === null || n === 0 ? null : n;
}

// A CheapShark serve os logos de loja como caminho relativo
// ("/img/stores/logos/0.png"). Prefixamos com o site.
function urlAbsoluta(caminho) {
  if (!caminho) return null;
  if (/^https?:\/\//i.test(caminho)) return caminho;
  return SITE_URL + (caminho.startsWith("/") ? "" : "/") + caminho;
}

// A CheapShark só devolve uma MINIATURA pequena (Steam "capsule" 231x87, tile
// de ~117px da GOG...) que fica borrada quando esticada no card. Aqui trocamos
// pela maior imagem disponível:
//   - Steam: capa vertical 600x900 @2x (cdn.*.steamstatic.com/.../library_600x900_2x.jpg);
//   - GOG:   troca o tile "<hash>_product_tile_117h.webp" pelo original "<hash>.webp";
//   - resto: mantém a original.
// `imagensFallback` devolve as próximas opções em ordem de qualidade (a última
// é sempre a miniatura original, que nunca falha) — o frontend tenta uma a uma
// no onerror, porque nem todo jogo tem a capa grande (ex.: bundles).
const STEAM_IMG = "https://cdn.cloudflare.steamstatic.com/steam/apps";

export function imagemHd(thumb, steamAppId) {
  if (steamAppId) return `${STEAM_IMG}/${steamAppId}/library_600x900_2x.jpg`;
  // GOG: a miniatura é "<hash>_product_tile_117h.webp"; "<hash>.webp" é o
  // asset original, em alta resolução.
  const gog = thumb && thumb.match(/images\.gog-statics\.com\/([0-9a-f]{40,})/i);
  if (gog) return `https://images.gog-statics.com/${gog[1]}.webp`;
  return thumb || null;
}

export function imagensFallback(thumb, steamAppId) {
  const lista = [];
  if (steamAppId) {
    lista.push(`${STEAM_IMG}/${steamAppId}/library_600x900.jpg`); // capa "1x"
    lista.push(`${STEAM_IMG}/${steamAppId}/header.jpg`); // 460x215
  }
  if (thumb) lista.push(thumb); // miniatura original da CheapShark (sempre válida)
  return lista;
}

// A CheapShark passou a devolver `dealID` já percent-encoded
// ("abc%2Fdef%3D"). Guardamos sempre a forma "crua" (decodificada) para não
// arriscar codificar duas vezes ao montar URLs.
function decodificarDealId(valor) {
  if (!valor) return null;
  try {
    return decodeURIComponent(valor);
  } catch {
    return String(valor);
  }
}

// Link de saída oficial da CheapShark (conta o clique e redireciona para a loja).
export function urlRedirecionamento(dealId) {
  return dealId ? `${SITE_URL}/redirect?dealID=${encodeURIComponent(dealId)}` : null;
}

// storeMap: Map<storeId, { id, name, logo }> vindo de getStores(). Opcional.
function resolverLoja(storeId, storeMap) {
  const id = storeId != null ? String(storeId) : null;
  const info = storeMap && id ? storeMap.get(id) : null;
  return {
    id,
    name: info?.name || null,
    logo: info?.logo || null
  };
}

// ---------------------------------------------------------------------------
// 1. Deal vindo de GET /deals (lista de promoções gerais / top).
// ---------------------------------------------------------------------------
export function normalizeDeal(bruto, storeMap, cotacaoUsdBrl) {
  if (!bruto || typeof bruto !== "object") return null;

  const normal = usdParaBrl(bruto.normalPrice, cotacaoUsdBrl);
  const sale = usdParaBrl(bruto.salePrice, cotacaoUsdBrl);
  const dealId = decodificarDealId(bruto.dealID);

  return {
    id: dealId,
    dealId,
    gameId: bruto.gameID != null ? String(bruto.gameID) : null,
    title: bruto.title || null,
    store: resolverLoja(bruto.storeID, storeMap),
    pricing: {
      currency: "BRL",
      normal,
      sale,
      discountPercent: percentualDesconto(bruto.savings, normal, sale)
    },
    ratings: {
      metacritic: metacritic(bruto.metacriticScore),
      steam: steamRating(bruto.steamRatingPercent)
    },
    thumbnail: imagemHd(bruto.thumb, bruto.steamAppID),
    thumbnailFallback: imagensFallback(bruto.thumb, bruto.steamAppID),
    dealRating: paraNumero(bruto.dealRating),
    releaseDate: dataDeUnix(bruto.releaseDate),
    redirectUrl: urlRedirecionamento(dealId)
  };
}

// ---------------------------------------------------------------------------
// 2. Oferta vinda de GET /games?id=<gameId> (comparação entre lojas de um jogo).
//    Aqui cada item traz storeID, dealID, price, retailPrice, savings.
//    `info` (title/thumb) é comum ao jogo inteiro e entra por parâmetro.
// ---------------------------------------------------------------------------
export function normalizeGameDeal(bruto, { gameId, info, storeMap, cotacaoUsdBrl } = {}) {
  if (!bruto || typeof bruto !== "object") return null;

  const normal = usdParaBrl(bruto.retailPrice, cotacaoUsdBrl);
  const sale = usdParaBrl(bruto.price, cotacaoUsdBrl);
  const dealId = decodificarDealId(bruto.dealID);

  return {
    id: dealId,
    dealId,
    gameId: gameId != null ? String(gameId) : null,
    title: info?.title || null,
    store: resolverLoja(bruto.storeID, storeMap),
    pricing: {
      currency: "BRL",
      normal,
      sale,
      discountPercent: percentualDesconto(bruto.savings, normal, sale)
    },
    ratings: { metacritic: null, steam: null },
    thumbnail: imagemHd(info?.thumb, info?.steamAppID),
    thumbnailFallback: imagensFallback(info?.thumb, info?.steamAppID),
    dealRating: null,
    releaseDate: null,
    redirectUrl: urlRedirecionamento(dealId)
  };
}

// ---------------------------------------------------------------------------
// 3. Resultado de busca por nome (GET /games?title=...).
//    Estrutura mais enxuta: identifica o jogo e o melhor preço atual.
// ---------------------------------------------------------------------------
export function normalizeGameSearchResult(bruto, cotacaoUsdBrl) {
  if (!bruto || typeof bruto !== "object") return null;
  const gameId = bruto.gameID != null ? String(bruto.gameID) : null;
  const cheapestDealId = decodificarDealId(bruto.cheapestDealID);

  return {
    gameId,
    title: bruto.external || null,
    thumbnail: imagemHd(bruto.thumb, bruto.steamAppID),
    thumbnailFallback: imagensFallback(bruto.thumb, bruto.steamAppID),
    steamAppId: bruto.steamAppID || null,
    currency: "BRL",
    cheapestPrice: usdParaBrl(bruto.cheapest, cotacaoUsdBrl),
    cheapestDealId,
    redirectUrl: urlRedirecionamento(cheapestDealId)
  };
}

// ---------------------------------------------------------------------------
// 4. Loja (GET /stores).
// ---------------------------------------------------------------------------
export function normalizeStore(bruto) {
  if (!bruto || typeof bruto !== "object") return null;
  return {
    id: bruto.storeID != null ? String(bruto.storeID) : null,
    name: bruto.storeName || null,
    logo: urlAbsoluta(bruto.images?.logo || bruto.images?.icon || null),
    banner: urlAbsoluta(bruto.images?.banner || null),
    active: bruto.isActive === 1 || bruto.isActive === "1" || bruto.isActive === true
  };
}

// Comunicação com a CheapShark (https://www.cheapshark.com/api/1.0).
//
// Fonte externa de PROMOÇÕES e comparação de preços de jogos de PC entre lojas
// (Steam, GOG, Fanatical, Humble, GreenManGaming, etc.).
//
// Este arquivo é a camada mais baixa: só monta a URL, faz o fetch com timeout e
// devolve o JSON cru. Não normaliza nada e não tem regra de negócio — disso
// cuidam providers/cheapShark.provider.js e utils/normalizeDeal.js.
//
// A CheapShark hoje não exige chave/token. Ainda assim, a base fica em variável
// de ambiente (CHEAPSHARK_API_URL) e há um ponto pronto para um cabeçalho de
// autenticação (CHEAPSHARK_API_KEY) caso isso mude.

import dotenv from "dotenv";
import { erros } from "../utils/apiResponse.js";

dotenv.config();

const BASE_URL = (process.env.CHEAPSHARK_API_URL || "https://www.cheapshark.com/api/1.0").replace(
  /\/$/,
  ""
);
const API_KEY = process.env.CHEAPSHARK_API_KEY || ""; // hoje não usada; reservada.
const TIMEOUT_MS = Math.min(
  Math.max(Number(process.env.CHEAPSHARK_TIMEOUT_MS) || 9000, 1000),
  15000
);

// A CheapShark recusa (HTTP 400) requisições com User-Agent genérico (como o
// padrão do fetch do Node). É preciso identificar o cliente.
const USER_AGENT =
  process.env.CHEAPSHARK_USER_AGENT ||
  "NeonAI-Deals/1.0 (+https://github.com/pedrobrasilio/projeto-final)";

export function cheapSharkConfigurado() {
  // Sem chave obrigatória: basta ter uma URL base.
  return Boolean(BASE_URL);
}

// GET genérico. `caminho` é "/deals", "/games", "/stores". `params` vira query
// string (valores null/undefined/"" são ignorados).
async function cheapSharkGet(caminho, params = {}, { notFoundComoNulo = false } = {}) {
  const url = new URL(BASE_URL + caminho);
  for (const [chave, valor] of Object.entries(params)) {
    if (valor !== undefined && valor !== null && valor !== "") {
      url.searchParams.set(chave, String(valor));
    }
  }

  const headers = { Accept: "application/json", "User-Agent": USER_AGENT };
  if (API_KEY) headers.Authorization = `Bearer ${API_KEY}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, { headers, signal: controller.signal });

    // 404 num recurso opcional (ex.: jogo inexistente) não é erro de
    // comunicação: devolvemos null e quem chamou responde 404 ao frontend.
    if (resp.status === 404 && notFoundComoNulo) {
      return null;
    }
    if (resp.status === 429) {
      throw erros.upstream("A CheapShark está limitando as requisições. Tente de novo em instantes.");
    }
    if (!resp.ok) {
      throw erros.upstream(`A CheapShark respondeu ${resp.status}.`);
    }

    let dados;
    try {
      dados = await resp.json();
    } catch (e) {
      throw erros.upstream("A CheapShark retornou uma resposta inválida.", e);
    }
    return dados;
  } catch (erro) {
    if (erro?.name === "ApiError") throw erro;
    if (erro?.name === "AbortError") {
      throw erros.timeout("A CheapShark demorou demais para responder.", erro);
    }
    // Falha de rede / DNS / conexão recusada / CheapShark fora do ar.
    throw erros.upstream("Não foi possível se conectar à CheapShark.", erro);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Endpoints da CheapShark (retornam JSON cru).
// ---------------------------------------------------------------------------

// GET /deals — lista de promoções. Aceita storeID, upperPrice, lowerPrice,
// sortBy, desc, pageNumber, pageSize, onSale, metacritic, steamRating, title...
// Retorna um array de deals.
export async function fetchDeals(params = {}) {
  const dados = await cheapSharkGet("/deals", params);
  if (!Array.isArray(dados)) {
    throw erros.upstream("A CheapShark retornou um formato inesperado para /deals.");
  }
  return dados;
}

// GET /games?title=<titulo>&limit=<n> — busca jogos pelo nome.
// Retorna um array de { gameID, steamAppID, cheapest, cheapestDealID, external, thumb }.
export async function fetchGamesByTitle(title, { limit = 20, exact = 0 } = {}) {
  const dados = await cheapSharkGet("/games", { title, limit, exact });
  if (!Array.isArray(dados)) {
    throw erros.upstream("A CheapShark retornou um formato inesperado para a busca de jogos.");
  }
  return dados;
}

// GET /games?id=<gameID> — detalhe de um jogo com todas as ofertas por loja.
// Retorna { info, cheapestPriceEver, deals: [...] }. Para id inexistente a
// CheapShark devolve [] ou objeto sem `deals` -> tratamos como "não encontrado".
export async function fetchGameById(gameId) {
  const dados = await cheapSharkGet("/games", { id: gameId }, { notFoundComoNulo: true });
  if (Array.isArray(dados) || !dados || typeof dados !== "object" || !Array.isArray(dados.deals)) {
    return null;
  }
  return dados;
}

// GET /stores — todas as lojas suportadas (ativas e inativas).
export async function fetchStores() {
  const dados = await cheapSharkGet("/stores");
  if (!Array.isArray(dados)) {
    throw erros.upstream("A CheapShark retornou um formato inesperado para /stores.");
  }
  return dados;
}

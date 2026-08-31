// Comunicação com a IGDB (Internet Game Database).
//
// Fonte de dados atuais de JOGOS: nome, data de lançamento, próximos
// lançamentos, plataformas, desenvolvedoras, publishers, gêneros, franquias,
// DLCs, expansões, remakes/remasters e avaliações.
//
// Autenticação: a IGDB usa OAuth da Twitch (client credentials). O backend
// pede um Access Token com TWITCH_CLIENT_ID + TWITCH_CLIENT_SECRET e o guarda
// em memória até expirar; quando expira, um novo é solicitado automaticamente.
// Client ID, Client Secret e Access Token NUNCA chegam ao frontend.

import dotenv from "dotenv";

dotenv.config();

const TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const IGDB_URL = "https://api.igdb.com/v4";
const TIMEOUT_MS = 8000;

const CLIENT_ID = process.env.TWITCH_CLIENT_ID || "";
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET || "";

export function igdbConfigurado() {
  return Boolean(CLIENT_ID && CLIENT_SECRET);
}

// ---------- Gerência do Access Token da Twitch ----------

// Cache em memória. `expiraEm` é um timestamp (ms); renovamos um pouco antes
// do vencimento real para não usar um token que expira no meio da chamada.
const MARGEM_RENOVACAO_MS = 60_000;
let tokenCache = { valor: null, expiraEm: 0 };
let tokenEmVoo = null; // evita pedir vários tokens em paralelo.

async function solicitarToken() {
  const url = new URL(TOKEN_URL);
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("client_secret", CLIENT_SECRET);
  url.searchParams.set("grant_type", "client_credentials");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, { method: "POST", signal: controller.signal });
    if (!resp.ok) {
      throw new Error(`Twitch OAuth respondeu ${resp.status}`);
    }
    const dados = await resp.json();
    if (!dados.access_token) {
      throw new Error("Twitch OAuth não retornou access_token");
    }
    const validadeMs = (Number(dados.expires_in) || 3600) * 1000;
    tokenCache = {
      valor: dados.access_token,
      expiraEm: Date.now() + validadeMs - MARGEM_RENOVACAO_MS
    };
    return tokenCache.valor;
  } finally {
    clearTimeout(timer);
  }
}

async function getToken({ forcar = false } = {}) {
  if (!igdbConfigurado()) {
    throw new Error(
      "IGDB não configurado (defina TWITCH_CLIENT_ID e TWITCH_CLIENT_SECRET no .env)"
    );
  }
  if (!forcar && tokenCache.valor && Date.now() < tokenCache.expiraEm) {
    return tokenCache.valor;
  }
  if (forcar) tokenCache = { valor: null, expiraEm: 0 };

  // Se já existe um pedido em andamento, aguarda o mesmo.
  if (!tokenEmVoo) {
    tokenEmVoo = solicitarToken().finally(() => {
      tokenEmVoo = null;
    });
  }
  return tokenEmVoo;
}

// ---------- Consulta à IGDB (linguagem Apicalypse) ----------

async function igdbQuery(endpoint, corpo, { tentativa = 0 } = {}) {
  const token = await getToken({ forcar: tentativa > 0 });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(`${IGDB_URL}/${endpoint}`, {
      method: "POST",
      headers: {
        "Client-ID": CLIENT_ID,
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "text/plain"
      },
      body: corpo,
      signal: controller.signal
    });

    // Token expirado/revogado no meio do caminho: renova uma vez e repete.
    if ((resp.status === 401 || resp.status === 403) && tentativa === 0) {
      clearTimeout(timer);
      return igdbQuery(endpoint, corpo, { tentativa: 1 });
    }
    if (!resp.ok) {
      throw new Error(`IGDB respondeu ${resp.status} em ${endpoint}`);
    }
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Helpers ----------

function agoraEmSegundos() {
  return Math.floor(Date.now() / 1000);
}

// Timestamp unix (s) da IGDB -> "DD/MM/AAAA".
function formatarData(segundos) {
  if (!segundos && segundos !== 0) return null;
  const d = new Date(segundos * 1000);
  if (Number.isNaN(d.getTime())) return null;
  const dia = String(d.getUTCDate()).padStart(2, "0");
  const mes = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dia}/${mes}/${d.getUTCFullYear()}`;
}

function nomes(lista) {
  return (lista || []).map((item) => item?.name).filter(Boolean);
}

// Campos completos usados na busca por um jogo específico.
const CAMPOS_DETALHE = [
  "name",
  "slug",
  "summary",
  "storyline",
  "first_release_date",
  "release_dates.human",
  "release_dates.date",
  "release_dates.platform.name",
  "platforms.name",
  "genres.name",
  "involved_companies.company.name",
  "involved_companies.developer",
  "involved_companies.publisher",
  "franchises.name",
  "collections.name",
  "dlcs.name",
  "expansions.name",
  "remakes.name",
  "remasters.name",
  "aggregated_rating",
  "aggregated_rating_count",
  "rating",
  "rating_count",
  "category",
  "status",
  "url"
].join(",");

const CATEGORIAS = {
  0: "jogo principal",
  1: "DLC",
  2: "expansão",
  3: "bundle",
  4: "expansão standalone",
  5: "mod",
  6: "episódio",
  7: "temporada",
  8: "remake",
  9: "remaster",
  10: "jogo expandido",
  11: "port",
  12: "fork",
  13: "pacote",
  14: "atualização"
};

const STATUS = {
  0: "lançado",
  2: "descontinuado",
  3: "early access",
  4: "offline",
  5: "cancelado",
  6: "rumor",
  7: "adiado"
};

function normalizarResumo(j) {
  return {
    id: j.id,
    slug: j.slug || null,
    nome: j.name || null,
    lancamento: formatarData(j.first_release_date),
    plataformas: nomes(j.platforms),
    generos: nomes(j.genres)
  };
}

function empresasPorPapel(lista, papel) {
  return (lista || [])
    .filter((c) => c && c[papel] && c.company?.name)
    .map((c) => c.company.name);
}

function normalizarJogo(j) {
  const lancamentoUnix = j.first_release_date || null;
  return {
    nome: j.name || null,
    tipo: CATEGORIAS[j.category] || "jogo principal",
    status: STATUS[j.status] || null,
    lancamento: formatarData(lancamentoUnix),
    jaLancou: lancamentoUnix ? lancamentoUnix <= agoraEmSegundos() : null,
    datasPorPlataforma: (j.release_dates || [])
      .map((r) => ({
        plataforma: r?.platform?.name || null,
        data: r?.human || formatarData(r?.date)
      }))
      .filter((r) => r.plataforma || r.data)
      .slice(0, 12),
    plataformas: nomes(j.platforms),
    desenvolvedoras: empresasPorPapel(j.involved_companies, "developer"),
    publishers: empresasPorPapel(j.involved_companies, "publisher"),
    generos: nomes(j.genres),
    franquias: [...new Set([...nomes(j.franchises), ...nomes(j.collections)])],
    dlcs: nomes(j.dlcs).slice(0, 10),
    expansoes: nomes(j.expansions).slice(0, 10),
    remakes: nomes(j.remakes),
    remasters: nomes(j.remasters),
    avaliacaoCritica: j.aggregated_rating ? Math.round(j.aggregated_rating) : null,
    avaliacaoUsuarios: j.rating ? Math.round(j.rating) : null,
    votos: j.rating_count || null,
    resumo: j.summary || null,
    historia: j.storyline || null,
    site: j.url || null
  };
}

// ---------- Funções públicas ----------

export async function buscarJogo(query) {
  const corpo =
    `search "${String(query).replace(/"/g, '\\"')}"; ` +
    "fields name,slug,first_release_date,platforms.name,genres.name; " +
    "limit 6;";
  const dados = await igdbQuery("games", corpo);
  return (Array.isArray(dados) ? dados : []).map(normalizarResumo);
}

export async function detalhesJogo(id) {
  const dados = await igdbQuery("games", `fields ${CAMPOS_DETALHE}; where id = ${Number(id)}; limit 1;`);
  const jogo = Array.isArray(dados) ? dados[0] : null;
  return jogo ? normalizarJogo(jogo) : null;
}

// Resolve o jogo mais provável pelo nome e devolve os detalhes completos.
export async function buscarComDetalhes(query) {
  const candidatos = await buscarJogo(query);
  if (!candidatos.length) return null;
  return detalhesJogo(candidatos[0].id);
}

export async function proximosLancamentos() {
  const agora = agoraEmSegundos();
  const corpo =
    "fields name,slug,first_release_date,platforms.name,genres.name; " +
    `where first_release_date > ${agora} & category = (0,2,4,8,9); ` +
    "sort first_release_date asc; limit 12;";
  const dados = await igdbQuery("games", corpo);
  return (Array.isArray(dados) ? dados : []).map(normalizarResumo);
}

export async function lancamentosRecentes() {
  const agora = agoraEmSegundos();
  const umAnoAtras = agora - 365 * 24 * 60 * 60;
  const corpo =
    "fields name,slug,first_release_date,platforms.name,genres.name; " +
    `where first_release_date > ${umAnoAtras} & first_release_date <= ${agora} & category = (0,2,4,8,9); ` +
    "sort first_release_date desc; limit 12;";
  const dados = await igdbQuery("games", corpo);
  return (Array.isArray(dados) ? dados : []).map(normalizarResumo);
}

export async function jogosPopulares() {
  const corpo =
    "fields name,slug,first_release_date,platforms.name,genres.name,rating_count; " +
    "where rating_count > 20 & category = (0,4,8,9); " +
    "sort rating_count desc; limit 12;";
  const dados = await igdbQuery("games", corpo);
  return (Array.isArray(dados) ? dados : []).map(normalizarResumo);
}

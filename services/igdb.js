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
  "hypes",
  "game_type",
  "game_status",
  "url"
].join(",");

// A IGDB aposentou os campos `category`/`status`. Agora são `game_type` e
// `game_status` (mesmos significados, valores numéricos abaixo).
const TIPOS_JOGO = {
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

// Tipos que representam um "jogo de verdade" (não bundle/mod/pacote/update).
const TIPOS_JOGO_REAL = [0, 2, 4, 8, 9, 10, 11];

const STATUS_JOGO = {
  0: "lançado",
  1: "alpha",
  2: "beta",
  3: "early access",
  4: "offline",
  5: "cancelado",
  6: "rumor",
  7: "removido"
};

function normalizarResumo(j) {
  return {
    id: j.id,
    slug: j.slug || null,
    nome: j.name || null,
    tipoJogo: j.game_type ?? 0,
    hype: j.hypes || 0,
    votos: j.rating_count || 0,
    lancamento: formatarData(j.first_release_date),
    plataformas: nomes(j.platforms),
    generos: nomes(j.genres)
  };
}

// Remove campos internos (só usados para ranquear) antes de mandar ao modelo.
function limparResumo({ tipoJogo, hype, votos, ...resto }) {
  return resto;
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
    tipo: TIPOS_JOGO[j.game_type] || "jogo principal",
    status: STATUS_JOGO[j.game_status] || null,
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

const TIPOS_REAL_LISTA = `(${TIPOS_JOGO_REAL.join(",")})`;

export async function buscarJogo(query) {
  const corpo =
    `search "${String(query).replace(/"/g, '\\"')}"; ` +
    "fields name,slug,first_release_date,platforms.name,genres.name,game_type,hypes,rating_count; " +
    "limit 10;";
  const dados = await igdbQuery("games", corpo);
  return (Array.isArray(dados) ? dados : []).map(normalizarResumo);
}

export async function detalhesJogo(id) {
  const dados = await igdbQuery("games", `fields ${CAMPOS_DETALHE}; where id = ${Number(id)}; limit 1;`);
  const jogo = Array.isArray(dados) ? dados[0] : null;
  return jogo ? normalizarJogo(jogo) : null;
}

// Resolve o jogo mais provável pelo nome e devolve os detalhes completos.
// A busca da IGDB às vezes coloca bundles, edições "GOTY" ou entradas falsas no
// topo. Aqui ranqueamos: jogo principal > nome batendo com a busca > mais
// popular (hype + votos).
export async function buscarComDetalhes(query) {
  const candidatos = await buscarJogo(query);
  if (!candidatos.length) return null;

  const alvoBusca = String(query).toLowerCase().trim();
  const pontuar = (c) => {
    let p = 0;
    if (c.tipoJogo === 0) p += 1000;
    else if (TIPOS_JOGO_REAL.includes(c.tipoJogo)) p += 300;
    const nome = String(c.nome || "").toLowerCase();
    if (nome === alvoBusca) p += 500;
    else if (nome.startsWith(alvoBusca)) p += 200;
    else if (nome.includes(alvoBusca)) p += 80;
    p += Math.min(c.hype, 200) + Math.min(c.votos, 200);
    return p;
  };

  const alvo = [...candidatos].sort((a, b) => pontuar(b) - pontuar(a))[0];
  return detalhesJogo(alvo.id);
}

export async function proximosLancamentos() {
  const agora = agoraEmSegundos();
  // Ordena por "hypes" (quanta gente está acompanhando o lançamento) para trazer
  // os jogos realmente aguardados, não centenas de indies com data só de ano.
  const corpo =
    "fields name,slug,first_release_date,platforms.name,genres.name,game_type; " +
    `where first_release_date > ${agora} & game_type = ${TIPOS_REAL_LISTA} & hypes > 3; ` +
    "sort hypes desc; limit 12;";
  const dados = await igdbQuery("games", corpo);
  return (Array.isArray(dados) ? dados : []).map(normalizarResumo).map(limparResumo);
}

export async function lancamentosRecentes() {
  const agora = agoraEmSegundos();
  const umAnoAtras = agora - 365 * 24 * 60 * 60;
  const corpo =
    "fields name,slug,first_release_date,platforms.name,genres.name,game_type; " +
    `where first_release_date > ${umAnoAtras} & first_release_date <= ${agora} & game_type = ${TIPOS_REAL_LISTA} & rating_count > 5; ` +
    "sort first_release_date desc; limit 12;";
  const dados = await igdbQuery("games", corpo);
  return (Array.isArray(dados) ? dados : []).map(normalizarResumo).map(limparResumo);
}

export async function jogosPopulares() {
  const corpo =
    "fields name,slug,first_release_date,platforms.name,genres.name,game_type; " +
    `where rating_count > 20 & game_type = ${TIPOS_REAL_LISTA}; ` +
    "sort rating_count desc; limit 12;";
  const dados = await igdbQuery("games", corpo);
  return (Array.isArray(dados) ? dados : []).map(normalizarResumo).map(limparResumo);
}

// ---------- Catálogo para o frontend (cards com capa) ----------

// A IGDB serve as imagens em https://images.igdb.com/igdb/image/upload/t_<tamanho>/<image_id>.jpg
function capaDoJogo(imageId) {
  return imageId
    ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${imageId}.jpg`
    : null;
}

function anoDoUnix(segundos) {
  if (!segundos && segundos !== 0) return null;
  const d = new Date(segundos * 1000);
  return Number.isNaN(d.getTime()) ? null : d.getUTCFullYear();
}

// A IGDB não localiza gêneros; traduzimos os mais comuns para o card em pt-BR.
const GENERO_PT = {
  "Role-playing (RPG)": "RPG",
  "Turn-based strategy (TBS)": "Estratégia por turnos",
  "Real Time Strategy (RTS)": "Estratégia em tempo real",
  Adventure: "Aventura",
  Shooter: "Tiro",
  Platform: "Plataforma",
  Puzzle: "Puzzle",
  Racing: "Corrida",
  Fighting: "Luta",
  Simulator: "Simulação",
  Strategy: "Estratégia",
  Tactical: "Tático",
  "Hack and slash/Beat 'em up": "Hack and slash",
  "Point-and-click": "Point-and-click",
  Indie: "Indie",
  Arcade: "Arcade",
  "Card & Board Game": "Cartas e tabuleiro",
  "Music": "Música",
  "Sport": "Esporte",
  "Quiz/Trivia": "Quiz",
  "Visual Novel": "Visual Novel",
  "Pinball": "Pinball",
  "MOBA": "MOBA"
};

function generoPt(nome) {
  return GENERO_PT[nome] || nome;
}

// Monta o card no mesmo formato que o frontend já espera:
// { id, titulo, ano, nota, genero, cover }
function normalizarCard(j) {
  const nota100 = j.rating ?? j.aggregated_rating ?? null;
  return {
    id: `g-${j.id}`,
    titulo: j.name || "Sem título",
    ano: anoDoUnix(j.first_release_date),
    nota: nota100 != null ? `★ ${(nota100 / 10).toFixed(1)}` : "★ –",
    genero: nomes(j.genres).slice(0, 2).map(generoPt).join(" / ") || "Jogo",
    cover: capaDoJogo(j.cover?.image_id)
  };
}

// A IGDB lista cada versão de plataforma como um id separado (ex.: "Mario &
// Sonic at the Olympic Winter Games" no Wii e no DS), o que faz o mesmo jogo
// aparecer repetido no catálogo/busca. Por isso o critério de duplicata é
// nome + ano (não o id, que nunca colide entre essas versões). Mantém só a
// 1ª ocorrência (a lista já vem ordenada por relevância/popularidade).
function dedupeCards(cards) {
  const vistos = new Set();
  return cards.filter((c) => {
    const chave = `${(c.titulo || "").trim().toLowerCase()}|${c.ano || ""}`;
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
}

// Jogos mais aclamados historicamente (usados para completar o catálogo
// depois dos destaques do mês).
async function jogosMaisAclamados(limite) {
  const corpo =
    "fields name,first_release_date,genres.name,rating,aggregated_rating,rating_count,cover.image_id,game_type; " +
    `where rating_count > 200 & rating != null & cover != null & game_type = ${TIPOS_REAL_LISTA}; ` +
    `sort rating_count desc; limit ${limite};`;
  const dados = await igdbQuery("games", corpo);
  return (Array.isArray(dados) ? dados : [])
    .map(normalizarCard)
    .filter((c) => c.cover);
}

// Jogos em destaque no mês corrente (já lançados ou ainda por lançar),
// ordenados por "hypes" (quanto o jogo está sendo acompanhado/aguardado na
// IGDB). Aparecem primeiro no catálogo mesmo sem terem sido lançados ainda.
async function jogosDestaqueDoMes(limite) {
  const agora = new Date();
  const inicioMes = Math.floor(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1) / 1000);
  const fimMes = Math.floor(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() + 1, 1) / 1000) - 1;
  const corpo =
    "fields name,first_release_date,genres.name,rating,aggregated_rating,rating_count,cover.image_id,game_type,hypes; " +
    `where first_release_date >= ${inicioMes} & first_release_date <= ${fimMes} & cover != null & game_type = ${TIPOS_REAL_LISTA}; ` +
    `sort hypes desc; limit ${limite};`;
  const dados = await igdbQuery("games", corpo);
  return (Array.isArray(dados) ? dados : [])
    .map(normalizarCard)
    .filter((c) => c.cover);
}

// Catálogo para o "Games em Destaque": primeiro os destaques do mês (mesmo
// que ainda não tenham sido lançados), depois os mais aclamados historicamente
// até completar o limite.
export async function catalogoJogos({ limite = 12 } = {}) {
  const n = Math.min(Math.max(Number(limite) || 12, 1), 24);
  const qtdDestaque = Math.min(6, n);
  const [destaqueMes, aclamados] = await Promise.all([
    jogosDestaqueDoMes(qtdDestaque),
    jogosMaisAclamados(n + qtdDestaque) // margem para cobrir eventuais duplicatas com o destaque do mês
  ]);
  return dedupeCards([...destaqueMes, ...aclamados]).slice(0, n);
}

// Busca livre por nome, no mesmo formato de card do catálogo em destaque.
// Usada pela pesquisa do frontend para alcançar títulos além dos fixados.
export async function buscarJogosCatalogo(query, { limite = 24 } = {}) {
  const termo = String(query || "").trim();
  if (!termo) return [];
  const n = Math.min(Math.max(Number(limite) || 24, 1), 40);
  const corpo =
    `search "${termo.replace(/"/g, '\\"')}"; ` +
    "fields name,first_release_date,genres.name,rating,aggregated_rating,rating_count,cover.image_id,game_type; " +
    `limit ${n};`;
  const dados = await igdbQuery("games", corpo);
  return dedupeCards(
    (Array.isArray(dados) ? dados : [])
      .filter((j) => TIPOS_JOGO_REAL.includes(j.game_type ?? 0))
      .map(normalizarCard)
      .filter((c) => c.cover)
  );
}

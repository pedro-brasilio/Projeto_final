// Comunicação com o TMDB (The Movie Database).
//
// Papel: cobrir o que a OMDb NÃO faz — listas de descoberta (filmes em cartaz,
// próximas estreias, populares, séries no ar) e busca com dados em pt-BR.
// Os detalhes ricos de um título específico (nota IMDb, Rotten Tomatoes,
// Metascore, prêmios) continuam vindo da OMDb.
//
// A chave fica em .env (TMDB_API_KEY = chave v3, ou TMDB_ACCESS_TOKEN = token
// de leitura v4). Nada disso chega ao frontend.

import dotenv from "dotenv";

dotenv.config();

const BASE_URL = "https://api.themoviedb.org/3";
const IMG_BASE = "https://image.tmdb.org/t/p/w500";
const LANG = "pt-BR";
const REGION = "BR";
const TIMEOUT_MS = 8000;

const API_KEY = process.env.TMDB_API_KEY || "";
const ACCESS_TOKEN = process.env.TMDB_ACCESS_TOKEN || "";

export function tmdbConfigurado() {
  return Boolean(API_KEY || ACCESS_TOKEN);
}

async function tmdbFetch(caminho, params = {}) {
  if (!tmdbConfigurado()) {
    throw new Error("TMDB não configurado (defina TMDB_API_KEY ou TMDB_ACCESS_TOKEN no .env)");
  }

  const url = new URL(BASE_URL + caminho);
  url.searchParams.set("language", LANG);
  for (const [chave, valor] of Object.entries(params)) {
    if (valor !== undefined && valor !== null && valor !== "") {
      url.searchParams.set(chave, String(valor));
    }
  }

  const headers = { Accept: "application/json" };
  if (ACCESS_TOKEN) {
    headers.Authorization = `Bearer ${ACCESS_TOKEN}`;
  } else {
    url.searchParams.set("api_key", API_KEY);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, { headers, signal: controller.signal });
    if (!resp.ok) {
      throw new Error(`TMDB respondeu ${resp.status} em ${caminho}`);
    }
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

function formatarData(data) {
  if (!data) return null;
  const [ano, mes, dia] = String(data).split("-");
  if (!ano) return null;
  if (!mes || !dia) return ano;
  return `${dia}/${mes}/${ano}`;
}

// ---------- Normalizadores ----------

function resumirItemBusca(item) {
  const ehSerie = item.media_type === "tv" || (!item.title && item.name);
  return {
    id: item.id,
    tipo: ehSerie ? "serie" : "filme",
    titulo: item.title || item.name,
    tituloOriginal: item.original_title || item.original_name,
    lancamento: formatarData(item.release_date || item.first_air_date),
    nota: item.vote_average ? Number(item.vote_average.toFixed(1)) : null,
    sinopse: item.overview || null
  };
}

function normalizarFilme(d) {
  return {
    tipo: "filme",
    titulo: d.title,
    tituloOriginal: d.original_title,
    lancamento: formatarData(d.release_date),
    jaLancou: d.release_date ? new Date(d.release_date) <= new Date() : null,
    duracaoMin: d.runtime || null,
    generos: (d.genres || []).map((g) => g.name),
    nota: d.vote_average ? Number(d.vote_average.toFixed(1)) : null,
    votos: d.vote_count || null,
    status: d.status || null,
    sinopse: d.overview || null,
    elenco: (d.credits?.cast || []).slice(0, 8).map((a) => `${a.name} (${a.character})`),
    direcao: (d.credits?.crew || []).filter((c) => c.job === "Director").map((c) => c.name),
    imdbID: d.imdb_id || d.external_ids?.imdb_id || null,
    poster: d.poster_path ? IMG_BASE + d.poster_path : null,
    homepage: d.homepage || null
  };
}

function normalizarSerie(d) {
  return {
    tipo: "serie",
    titulo: d.name,
    tituloOriginal: d.original_name,
    estreia: formatarData(d.first_air_date),
    ultimoEpisodio: formatarData(d.last_air_date),
    status: d.status || null,
    emProducao: d.in_production ?? null,
    temporadas: d.number_of_seasons || null,
    episodios: d.number_of_episodes || null,
    generos: (d.genres || []).map((g) => g.name),
    nota: d.vote_average ? Number(d.vote_average.toFixed(1)) : null,
    emissoras: (d.networks || []).map((n) => n.name),
    sinopse: d.overview || null,
    elenco: (d.credits?.cast || []).slice(0, 8).map((a) => `${a.name} (${a.character})`),
    criadores: (d.created_by || []).map((c) => c.name),
    proximoEpisodio: d.next_episode_to_air ? formatarData(d.next_episode_to_air.air_date) : null,
    imdbID: d.external_ids?.imdb_id || null,
    poster: d.poster_path ? IMG_BASE + d.poster_path : null,
    homepage: d.homepage || null
  };
}

function resumirLista(resultados = [], tipo) {
  return resultados.slice(0, 10).map((item) => ({
    tipo,
    titulo: item.title || item.name,
    lancamento: formatarData(item.release_date || item.first_air_date),
    nota: item.vote_average ? Number(item.vote_average.toFixed(1)) : null,
    sinopse: item.overview || null
  }));
}

// ---------- Busca (fallback da OMDb, em pt-BR) ----------

export async function buscarTitulo(query, { tipo } = {}) {
  const caminho =
    tipo === "filme" ? "/search/movie" : tipo === "serie" ? "/search/tv" : "/search/multi";
  const data = await tmdbFetch(caminho, { query, include_adult: false, region: REGION });
  return (data.results || [])
    .filter((i) => tipo || i.media_type === "movie" || i.media_type === "tv")
    .slice(0, 6)
    .map(resumirItemBusca);
}

export async function detalhesFilme(id) {
  const d = await tmdbFetch(`/movie/${id}`, { append_to_response: "credits,external_ids" });
  return normalizarFilme(d);
}

export async function detalhesSerie(id) {
  const d = await tmdbFetch(`/tv/${id}`, { append_to_response: "credits,external_ids" });
  return normalizarSerie(d);
}

export async function buscarComDetalhes(query, { tipo } = {}) {
  const itens = await buscarTitulo(query, { tipo });
  if (!itens.length) return null;
  const alvo = itens[0];
  return alvo.tipo === "serie" ? detalhesSerie(alvo.id) : detalhesFilme(alvo.id);
}

// ---------- Listas de descoberta (o que a OMDb não faz) ----------

export async function filmesEmCartaz() {
  const data = await tmdbFetch("/movie/now_playing", { region: REGION, page: 1 });
  return resumirLista(data.results, "filme");
}

export async function proximosFilmes() {
  const data = await tmdbFetch("/movie/upcoming", { region: REGION, page: 1 });
  return resumirLista(data.results, "filme");
}

export async function filmesPopulares() {
  const data = await tmdbFetch("/movie/popular", { region: REGION, page: 1 });
  return resumirLista(data.results, "filme");
}

export async function seriesNoAr() {
  const data = await tmdbFetch("/tv/on_the_air", { page: 1 });
  return resumirLista(data.results, "serie");
}

export async function seriesPopulares() {
  const data = await tmdbFetch("/tv/popular", { page: 1 });
  return resumirLista(data.results, "serie");
}

// ---------- Catálogo para o frontend (cards com pôster) ----------

// As listas de descoberta trazem só `genre_ids`; o nome vem de /genre/movie/list.
// Guardamos o mapa em memória por 24h (a lista muda raríssimas vezes).
let generoCache = { mapa: null, expiraEm: 0 };

async function mapaDeGeneros() {
  if (generoCache.mapa && Date.now() < generoCache.expiraEm) return generoCache.mapa;
  const data = await tmdbFetch("/genre/movie/list");
  const mapa = new Map((data.genres || []).map((g) => [g.id, g.name]));
  generoCache = { mapa, expiraEm: Date.now() + 24 * 60 * 60 * 1000 };
  return mapa;
}

// Filmes mais bem avaliados, com pôster, no formato que o frontend já espera:
// { id, titulo, ano, nota, genero, cover }
export async function catalogoFilmes({ limite = 12 } = {}) {
  const n = Math.min(Math.max(Number(limite) || 12, 1), 24);
  // /movie/top_rated hoje vem poluído com filmes obscuros de nota perfeita e
  // pouquíssimos votos. /discover com um piso de votos traz os clássicos
  // realmente aclamados.
  const [data, generos] = await Promise.all([
    tmdbFetch("/discover/movie", {
      sort_by: "vote_average.desc",
      "vote_count.gte": 3000,
      include_adult: false,
      page: 1
    }),
    mapaDeGeneros().catch(() => new Map())
  ]);
  return (data.results || [])
    .filter((f) => f.poster_path)
    .slice(0, n)
    .map((f) => ({
      id: `m-${f.id}`,
      titulo: f.title || f.original_title || "Sem título",
      ano: (f.release_date || "").slice(0, 4) || null,
      nota: f.vote_average ? `★ ${f.vote_average.toFixed(1)}` : "★ –",
      genero:
        (f.genre_ids || [])
          .map((id) => generos.get(id))
          .filter(Boolean)
          .slice(0, 2)
          .join(" / ") || "Filme",
      cover: IMG_BASE + f.poster_path
    }));
}

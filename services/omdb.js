// Comunicação com a OMDb API (Open Movie Database).
//
// Fonte de dados atuais de FILMES e SÉRIES: título, ano, data de lançamento,
// duração, gênero, diretor, roteiristas, elenco, sinopse, país, idioma,
// premiações, avaliações (IMDb, Rotten Tomatoes, Metacritic) e número de
// temporadas de séries.
//
// A chave fica em .env (OMDB_API_KEY) e nunca chega ao frontend: todas as
// chamadas passam por este módulo.

import dotenv from "dotenv";

dotenv.config();

const BASE_URL = "https://www.omdbapi.com/";
const TIMEOUT_MS = 8000;
const API_KEY = process.env.OMDB_API_KEY || "";

export function omdbConfigurado() {
  return Boolean(API_KEY);
}

// "N/A" (e vazio) da OMDb vira null para o modelo não repetir "N/A" na resposta.
function limpar(valor) {
  if (valor === undefined || valor === null) return null;
  const texto = String(valor).trim();
  if (!texto || texto.toUpperCase() === "N/A") return null;
  return texto;
}

function listaSeparada(valor) {
  const texto = limpar(valor);
  if (!texto) return [];
  return texto
    .split(",")
    .map((parte) => parte.trim())
    .filter(Boolean);
}

function paraNumero(valor) {
  const texto = limpar(valor);
  if (!texto) return null;
  const numero = Number(texto.replace(/[^0-9.,-]/g, "").replace(",", "."));
  return Number.isFinite(numero) ? numero : null;
}

// "01 Nov 2014" / "2014-11-07" -> Date, quando possível.
function paraData(valor) {
  const texto = limpar(valor);
  if (!texto) return null;
  const data = new Date(texto);
  return Number.isNaN(data.getTime()) ? null : data;
}

async function omdbFetch(params = {}) {
  if (!omdbConfigurado()) {
    throw new Error("OMDb não configurado (defina OMDB_API_KEY no .env)");
  }

  const url = new URL(BASE_URL);
  url.searchParams.set("apikey", API_KEY);
  for (const [chave, valor] of Object.entries(params)) {
    if (valor !== undefined && valor !== null && valor !== "") {
      url.searchParams.set(chave, String(valor));
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
    if (!resp.ok) {
      throw new Error(`OMDb respondeu ${resp.status}`);
    }
    const dados = await resp.json();
    // A OMDb devolve HTTP 200 mesmo quando não encontra: sinaliza em Response.
    if (dados.Response === "False") {
      const motivo = String(dados.Error || "").toLowerCase();
      if (motivo.includes("not found")) return null;
      throw new Error(`OMDb: ${dados.Error || "resposta inválida"}`);
    }
    return dados;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Normalizadores (raw OMDb -> objeto enxuto para o modelo) ----------

function mapaTipo(tipoOmdb) {
  if (tipoOmdb === "series") return "serie";
  if (tipoOmdb === "episode") return "episodio";
  return "filme";
}

function normalizarAvaliacoes(d) {
  const avaliacoes = {};
  const imdb = paraNumero(d.imdbRating);
  if (imdb !== null) avaliacoes.imdb = `${imdb}/10`;
  const metascore = paraNumero(d.Metascore);
  if (metascore !== null) avaliacoes.metascore = `${metascore}/100`;
  for (const item of d.Ratings || []) {
    const fonte = limpar(item?.Source);
    const nota = limpar(item?.Value);
    if (!fonte || !nota) continue;
    if (fonte === "Rotten Tomatoes") avaliacoes.rottenTomatoes = nota;
    else if (fonte === "Metacritic" && !avaliacoes.metascore) avaliacoes.metascore = nota;
  }
  const votos = limpar(d.imdbVotes);
  if (votos) avaliacoes.imdbVotos = votos;
  return Object.keys(avaliacoes).length ? avaliacoes : null;
}

function normalizarObra(d) {
  const lancamento = limpar(d.Released);
  const dataLancamento = paraData(d.Released) || paraData(d.Year);
  const tipo = mapaTipo(d.Type);

  const obra = {
    tipo,
    titulo: limpar(d.Title),
    ano: limpar(d.Year),
    lancamento,
    jaLancou: dataLancamento ? dataLancamento <= new Date() : null,
    classificacao: limpar(d.Rated),
    duracao: limpar(d.Runtime),
    generos: listaSeparada(d.Genre),
    diretor: limpar(d.Director),
    roteiristas: listaSeparada(d.Writer),
    elenco: listaSeparada(d.Actors),
    sinopse: limpar(d.Plot),
    idiomas: listaSeparada(d.Language),
    paises: listaSeparada(d.Country),
    premiacoes: limpar(d.Awards),
    avaliacoes: normalizarAvaliacoes(d),
    bilheteria: limpar(d.BoxOffice),
    producao: limpar(d.Production),
    poster: limpar(d.Poster),
    site: limpar(d.Website),
    imdbID: limpar(d.imdbID)
  };

  if (tipo === "serie") {
    obra.temporadas = paraNumero(d.totalSeasons);
  }
  if (tipo === "episodio") {
    obra.temporada = paraNumero(d.Season);
    obra.episodio = paraNumero(d.Episode);
    obra.serie = limpar(d.seriesID);
  }

  return obra;
}

// tipo interno ("filme"/"serie") -> parâmetro da OMDb.
function tipoOmdb(tipo) {
  if (tipo === "serie") return "series";
  if (tipo === "filme") return "movie";
  if (tipo === "episodio") return "episode";
  return undefined;
}

// ---------- Funções públicas ----------

// Busca livre por título. Retorna uma lista curta de candidatos.
export async function buscarTitulo(query, { tipo } = {}) {
  const dados = await omdbFetch({ s: query, type: tipoOmdb(tipo) });
  if (!dados || !Array.isArray(dados.Search)) return [];
  return dados.Search.slice(0, 6).map((item) => ({
    titulo: limpar(item.Title),
    ano: limpar(item.Year),
    tipo: mapaTipo(item.Type),
    imdbID: limpar(item.imdbID),
    poster: limpar(item.Poster)
  }));
}

export async function detalhesPorId(imdbID) {
  const dados = await omdbFetch({ i: imdbID, plot: "full" });
  return dados ? normalizarObra(dados) : null;
}

export async function detalhesPorTitulo(query, { tipo, ano } = {}) {
  const dados = await omdbFetch({ t: query, type: tipoOmdb(tipo), y: ano, plot: "full" });
  return dados ? normalizarObra(dados) : null;
}

// Resolve o título mais provável e já devolve os detalhes completos.
// Tenta a busca exata (t=) e, se falhar, cai para a busca ampla (s=).
export async function buscarComDetalhes(query, { tipo, ano } = {}) {
  const exato = await detalhesPorTitulo(query, { tipo, ano });
  if (exato) return exato;

  const candidatos = await buscarTitulo(query, { tipo });
  if (!candidatos.length) return null;
  return detalhesPorId(candidatos[0].imdbID);
}

// Lista os episódios de uma temporada de uma série.
export async function temporadaDaSerie(query, temporada) {
  const dados = await omdbFetch({ t: query, type: "series", Season: temporada });
  if (!dados || !Array.isArray(dados.Episodes)) return null;
  return {
    serie: limpar(dados.Title),
    temporada: paraNumero(dados.Season) ?? temporada,
    episodios: dados.Episodes.map((ep) => ({
      numero: paraNumero(ep.Episode),
      titulo: limpar(ep.Title),
      lancamento: limpar(ep.Released),
      nota: paraNumero(ep.imdbRating)
    }))
  };
}

// Roteamento inteligente.
//
// Decide, a partir da mensagem atual e do contexto da conversa, se é preciso
// consultar uma fonte de dados atualizada (OMDb para filmes/séries, IGDB para
// jogos) antes de acionar a OpenAI.
//
// A OpenAI continua responsável por interpretar a pergunta e escrever a resposta
// final. Aqui só decidimos qual fonte usar e buscamos os dados.
//
// Retorno de rotearMensagem():
//   { dadosExternos: string|null, fonteUsada: string|null, houveFalhaFonte: boolean }

import { classificarIntencao } from "../services/openai.js";
import * as omdb from "../services/omdb.js";
import * as tmdb from "../services/tmdb.js";
import * as igdb from "../services/igdb.js";
import * as promocoes from "../providers/cheapShark.provider.js";
import { registrarErroInterno } from "./errors.js";

// Serializa objetos de dados de forma legível para o modelo.
function bloco(titulo, dados) {
  return `${titulo}\n${JSON.stringify(dados, null, 2)}`;
}

// Filmes e séries: a OMDb resolve os detalhes de um título específico (com nota
// IMDb, Rotten Tomatoes, Metascore e prêmios). As LISTAS de descoberta (em
// cartaz, próximas estreias, populares, séries no ar) só existem na TMDB, que
// também serve de fallback quando a OMDb não acha o título.
async function coletarFilmeSerie({ tipo, consulta, ano, temporada, modo }) {
  // 1. Modos de lista, quando não há um título específico em foco.
  if (!consulta) {
    if (!tmdb.tmdbConfigurado()) return null;
    switch (modo) {
      case "em_cartaz_agora":
        return bloco("Filmes em cartaz no Brasil agora:", await tmdb.filmesEmCartaz());
      case "lancamentos_futuros":
        return bloco("Próximas estreias de filmes:", await tmdb.proximosFilmes());
      case "series_no_ar":
        return bloco("Séries em exibição agora:", await tmdb.seriesNoAr());
      case "populares":
        return tipo === "serie"
          ? bloco("Séries populares no momento:", await tmdb.seriesPopulares())
          : bloco("Filmes populares no momento:", await tmdb.filmesPopulares());
      default:
        return null;
    }
  }

  // 2. Título específico: temporada de série.
  if (tipo === "serie" && Number.isFinite(temporada) && temporada > 0) {
    const dadosTemporada = await omdb.temporadaDaSerie(consulta, temporada);
    if (dadosTemporada) {
      return bloco(`Temporada ${temporada} de "${consulta}":`, dadosTemporada);
    }
  }

  // 3. Título específico: detalhes pela OMDb, com fallback na TMDB (pt-BR).
  const detalhes = await omdb.buscarComDetalhes(consulta, { tipo, ano });
  if (detalhes) return bloco(`Dados de "${consulta}":`, detalhes);

  if (tmdb.tmdbConfigurado()) {
    const alternativo = await tmdb.buscarComDetalhes(consulta, { tipo });
    if (alternativo) return bloco(`Dados de "${consulta}":`, alternativo);
  }
  return null;
}

async function coletarIgdb({ modo, consulta }) {
  switch (modo) {
    case "lancamentos_futuros":
      if (consulta) {
        const det = await igdb.buscarComDetalhes(consulta);
        if (det) return bloco(`Dados do jogo "${consulta}":`, det);
      }
      return bloco("Próximos lançamentos de jogos:", await igdb.proximosLancamentos());
    case "populares":
      return bloco("Jogos populares no momento:", await igdb.jogosPopulares());
    case "em_cartaz_agora":
    case "series_no_ar":
      return bloco("Jogos lançados recentemente:", await igdb.lancamentosRecentes());
    case "detalhes":
    default:
      if (consulta) {
        const det = await igdb.buscarComDetalhes(consulta);
        if (det) return bloco(`Dados do jogo "${consulta}":`, det);
        return null;
      }
      return null;
  }
}

// Promoções e preços de jogos de PC (provider CheapShark, preços já em BRL).
// Dois casos: preço/ofertas de UM jogo (modo "detalhes" + consulta) ou uma
// LISTA de promoções (modo "promocoes"), opcionalmente filtrada por loja.
async function coletarPromocoes({ modo, consulta, loja, limite }) {
  const n = Math.min(Math.max(limite || 5, 1), 15);

  // 1. Preço/ofertas de um jogo específico -> comparação entre lojas.
  if (consulta) {
    const { items: achados } = await promocoes.searchGames({ query: consulta, limit: 5 });
    if (!achados.length) {
      return bloco(`Não encontrei "${consulta}" na base de promoções de jogos de PC.`, {});
    }
    const alvo = achados[0];
    const { item } = await promocoes.getGameDeals({ gameId: alvo.gameId });
    if (!item || !item.deals.length) {
      return bloco(`Sem ofertas ativas para "${alvo.title}" agora.`, { jogo: alvo.title });
    }
    return bloco(`Ofertas atuais de "${item.title}" (preços em reais, BRL):`, {
      jogo: item.title,
      menorPrecoHistoricoBRL: item.cheapestPriceEver ? item.cheapestPriceEver.price : null,
      ofertas: item.deals.map((d) => ({
        loja: d.store?.name || null,
        precoNormal: d.pricing.normal,
        precoPromocional: d.pricing.sale,
        desconto: `${d.pricing.discountPercent}%`
      }))
    });
  }

  // 2. Lista de promoções. Se a loja foi citada, filtra por ela.
  let storeId;
  let nomeLoja = "";
  if (loja) {
    try {
      const { items: lojas } = await promocoes.getStores({ onlyActive: true });
      const achou = lojas.find(
        (l) => l.name && l.name.toLowerCase().includes(loja.toLowerCase())
      );
      if (achou) {
        storeId = achou.id;
        nomeLoja = achou.name;
      }
    } catch {
      /* sem lista de lojas: cai para o top geral */
    }
  }

  const { items } = storeId
    ? await promocoes.getDeals({ limit: n, storeId, sort: "dealRating", onSale: true })
    : await promocoes.getTopDeals({ limit: n });

  if (!items.length) return null;

  const titulo = nomeLoja
    ? `${n} melhores promoções de jogos na ${nomeLoja} agora (preços em BRL):`
    : `${n} melhores promoções de jogos de PC agora (preços em BRL):`;

  return bloco(
    titulo,
    items.map((d) => ({
      jogo: d.title,
      loja: d.store?.name || null,
      de: d.pricing.normal,
      por: d.pricing.sale,
      desconto: `${d.pricing.discountPercent}%`,
      notaSteam: d.ratings?.steam ?? null,
      metacritic: d.ratings?.metacritic ?? null
    }))
  );
}

export async function rotearMensagem({ historico, mensagem }) {
  const resultado = { dadosExternos: null, fonteUsada: null, houveFalhaFonte: false };

  const intencao = await classificarIntencao({ historico, mensagem });
  console.log("  intenção:", JSON.stringify(intencao));

  if (!intencao.precisaDadosAtuais || !intencao.fonte) {
    return resultado;
  }

  try {
    if (intencao.fonte === "omdb") {
      if (!omdb.omdbConfigurado() && !tmdb.tmdbConfigurado()) return resultado;
      resultado.dadosExternos = await coletarFilmeSerie(intencao);
      resultado.fonteUsada = resultado.dadosExternos ? "omdb/tmdb" : null;
    } else if (intencao.fonte === "igdb") {
      if (!igdb.igdbConfigurado()) return resultado;
      resultado.dadosExternos = await coletarIgdb(intencao);
      resultado.fonteUsada = resultado.dadosExternos ? "igdb" : null;
    } else if (intencao.fonte === "promocoes") {
      if (!promocoes.isConfigured()) return resultado;
      resultado.dadosExternos = await coletarPromocoes(intencao);
      resultado.fonteUsada = resultado.dadosExternos ? "promocoes" : null;
    }
  } catch (erro) {
    // Falha ao consultar a fonte externa: não quebramos a conversa.
    // A OpenAI ainda responde, avisando que não confirmou o dado agora.
    registrarErroInterno(`router.${intencao.fonte}`, erro);
    resultado.houveFalhaFonte = true;
    resultado.dadosExternos =
      "Não foi possível obter dados atualizados de fonte externa neste momento. " +
      "Responda com o que souber e deixe claro que não conseguiu confirmar datas ou detalhes recentes.";
  }

  return resultado;
}

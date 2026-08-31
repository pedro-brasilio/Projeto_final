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
import * as igdb from "../services/igdb.js";
import { registrarErroInterno } from "./errors.js";

// Serializa objetos de dados de forma legível para o modelo.
function bloco(titulo, dados) {
  return `${titulo}\n${JSON.stringify(dados, null, 2)}`;
}

// OMDb é uma base de consulta por título: não tem listas de "em cartaz",
// "populares" ou "próximos lançamentos". Sempre que houver uma obra citada,
// buscamos os detalhes dela; caso contrário, não há dado externo a oferecer.
async function coletarOmdb({ tipo, consulta, ano, temporada }) {
  if (!consulta) return null;

  if (tipo === "serie" && Number.isFinite(temporada) && temporada > 0) {
    const dadosTemporada = await omdb.temporadaDaSerie(consulta, temporada);
    if (dadosTemporada) {
      return bloco(`Temporada ${temporada} de "${consulta}":`, dadosTemporada);
    }
  }

  const detalhes = await omdb.buscarComDetalhes(consulta, { tipo, ano });
  if (detalhes) return bloco(`Dados de "${consulta}":`, detalhes);
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

export async function rotearMensagem({ historico, mensagem }) {
  const resultado = { dadosExternos: null, fonteUsada: null, houveFalhaFonte: false };

  const intencao = await classificarIntencao({ historico, mensagem });
  console.log("  intenção:", JSON.stringify(intencao));

  if (!intencao.precisaDadosAtuais || !intencao.fonte) {
    return resultado;
  }

  try {
    if (intencao.fonte === "omdb") {
      if (!omdb.omdbConfigurado()) return resultado;
      resultado.dadosExternos = await coletarOmdb(intencao);
      resultado.fonteUsada = resultado.dadosExternos ? "omdb" : null;
    } else if (intencao.fonte === "igdb") {
      if (!igdb.igdbConfigurado()) return resultado;
      resultado.dadosExternos = await coletarIgdb(intencao);
      resultado.fonteUsada = resultado.dadosExternos ? "igdb" : null;
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

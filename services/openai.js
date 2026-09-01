// Comunicação com a OpenAI (Responses API).
//
// Duas funções:
//   - gerarResposta(): a conversa em si. Recebe o system prompt, o histórico e,
//     opcionalmente, um bloco de dados atuais (OMDb/IGDB). Devolve texto puro.
//   - classificarIntencao(): uma chamada curta e barata que lê o contexto e
//     decide se a pergunta precisa de dados atualizados e de qual fonte.
//
// Toda a configuração de endpoint/modelo/chave fica aqui.

import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const endpoint = "https://turmagpt.services.ai.azure.com/openai/v1";
const deploymentName = "gpt-5.6-luna";
const apiKey = process.env.OPENAI_API_KEY;

const openai = new OpenAI({
  baseURL: endpoint,
  apiKey: apiKey
});

/**
 * Gera a resposta da assistente.
 *
 * @param {object} opts
 * @param {string} opts.instrucoes  System Prompt permanente.
 * @param {Array<{role: string, content: string}>} opts.historico  Histórico recente.
 * @param {string|null} [opts.dadosExternos]  Bloco de dados atuais já formatado.
 * @returns {Promise<string>}
 */
export async function gerarResposta({ instrucoes, historico, dadosExternos }) {
  // O histórico vai no `input`. O System Prompt permanente vai em `instructions`
  // e nunca entra no histórico. Quando há dados atuais, eles são anexados às
  // instruções apenas desta chamada (não são persistidos no contexto).
  const input = [...(historico ?? [])];

  let instructions = instrucoes;
  if (dadosExternos) {
    instructions +=
      "\n\n=== DADOS ATUAIS (fonte externa confiável) ===\n" +
      "Considere estes dados como verdade e não os contradiga com conhecimento antigo. " +
      "Não mencione a fonte nem diga que recebeu um bloco de dados.\n\n" +
      dadosExternos;
  }

  const response = await openai.responses.create({
    model: deploymentName,
    input,
    instructions
  });

  return response.output_text?.trim() || "";
}

// Palavras/pistas que o classificador procura. A decisão final é do modelo,
// isto é só documentação do que esperamos no JSON de retorno.
const FORMATO_CLASSIFICACAO = `
Responda APENAS com um objeto JSON válido, sem texto antes ou depois, no formato:
{
  "precisaDadosAtuais": boolean,   // true só quando a resposta depende de algo que muda com o tempo
  "fonte": "omdb" | "igdb" | null, // omdb = filmes/séries, igdb = jogos
  "tipo": "filme" | "serie" | "jogo" | null,
  "consulta": string,              // nome da obra/jogo já resolvido pelo contexto ("" se não houver)
  "ano": string,                   // ano da obra quando o contexto deixar claro ("" se não houver)
  "temporada": number | null,      // número da temporada quando a pergunta for sobre uma temporada específica
  "modo": "detalhes" | "lancamentos_futuros" | "em_cartaz_agora" | "series_no_ar" | "populares" | "generico"
}

Regras:
- precisaDadosAtuais = true para: datas de lançamento, "já lançou?", "foi adiado?",
  "quando lança?", duração, gênero, diretor, roteiristas, elenco, sinopse, país,
  idioma, premiações, avaliações (IMDb, Metascore, Rotten Tomatoes), quantas
  temporadas uma série tem, próximos lançamentos de jogos, plataformas, publishers,
  desenvolvedoras, DLCs, expansões, remakes, novidades recentes.
- precisaDadosAtuais = false para curiosidades, enredo já conhecido, personagens,
  opinião, recomendação atemporal, comparações, "quem é fulano?".
- Use o histórico para resolver referências: "ele", "esse filme", "essa saga",
  "o segundo", "o próximo", "e o jogo?", "e a continuação?". Preencha "consulta"
  com o nome real e completo da obra.
- Se pelo contexto for um jogo, fonte = "igdb". Se for filme ou série, fonte = "omdb".
- "modo": use "detalhes" quando a pergunta for sobre uma obra específica (com
  "consulta" preenchida). Use um modo de lista quando NÃO houver obra específica:
  "em_cartaz_agora" (filmes em cartaz), "lancamentos_futuros" (próximas estreias
  de filmes ou jogos), "series_no_ar" (séries em exibição agora), "populares"
  (filmes, séries ou jogos populares do momento).
- Se precisaDadosAtuais = false, use fonte = null, consulta = "", ano = "",
  temporada = null, modo = "generico".
`;

/**
 * Decide se a mensagem atual precisa de dados atualizados e de qual fonte.
 * Nunca lança: em qualquer falha devolve um resultado neutro (sem consulta externa).
 *
 * @param {object} opts
 * @param {Array<{role: string, content: string}>} opts.historico
 * @param {string} opts.mensagem  Mensagem atual do usuário.
 * @returns {Promise<{precisaDadosAtuais: boolean, fonte: string|null, tipo: string|null, consulta: string, modo: string}>}
 */
export async function classificarIntencao({ historico, mensagem }) {
  const neutro = {
    precisaDadosAtuais: false,
    fonte: null,
    tipo: null,
    consulta: "",
    ano: "",
    temporada: null,
    modo: "generico"
  };

  try {
    const contexto = (historico ?? [])
      .slice(-8)
      .map((m) => `${m.role === "user" ? "Usuário" : "Neon"}: ${m.content}`)
      .join("\n");

    const response = await openai.responses.create({
      model: deploymentName,
      instructions:
        "Você é um classificador de intenção para um chatbot sobre filmes, séries e jogos. " +
        "Sua única saída é um JSON. " +
        FORMATO_CLASSIFICACAO,
      input: [
        {
          role: "user",
          content:
            `HISTÓRICO RECENTE:\n${contexto || "(vazio)"}\n\n` +
            `MENSAGEM ATUAL DO USUÁRIO:\n${mensagem}`
        }
      ]
    });

    const bruto = response.output_text?.trim() || "";
    const json = extrairJson(bruto);
    if (!json) return neutro;

    const temporada = Number(json.temporada);

    return {
      precisaDadosAtuais: Boolean(json.precisaDadosAtuais),
      fonte: json.fonte === "omdb" || json.fonte === "igdb" ? json.fonte : null,
      tipo: ["filme", "serie", "jogo"].includes(json.tipo) ? json.tipo : null,
      consulta: typeof json.consulta === "string" ? json.consulta.trim() : "",
      ano: typeof json.ano === "string" ? json.ano.trim() : "",
      temporada: Number.isFinite(temporada) && temporada > 0 ? temporada : null,
      modo: [
        "detalhes",
        "lancamentos_futuros",
        "em_cartaz_agora",
        "series_no_ar",
        "populares",
        "generico"
      ].includes(json.modo)
        ? json.modo
        : "generico"
    };
  } catch (erro) {
    // Classificação é best-effort. Se falhar, a conversa segue só com a OpenAI.
    console.error("[openai.classificarIntencao]", erro?.message ?? erro);
    return neutro;
  }
}

// Extrai o primeiro objeto JSON de um texto, tolerando lixo ao redor.
function extrairJson(texto) {
  if (!texto) return null;
  try {
    return JSON.parse(texto);
  } catch {
    const inicio = texto.indexOf("{");
    const fim = texto.lastIndexOf("}");
    if (inicio === -1 || fim === -1 || fim <= inicio) return null;
    try {
      return JSON.parse(texto.slice(inicio, fim + 1));
    } catch {
      return null;
    }
  }
}

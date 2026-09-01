// Cotação do dólar para conversão de preços em Real (BRL).
//
// A CheapShark só devolve preços em USD. Para a Neon mostrar SEMPRE em Real,
// buscamos a cotação USD->BRL aqui, guardamos em memória por algumas horas e
// aplicamos a conversão na camada de normalização (utils/normalizeDeal.js).
//
// Fonte padrão: AwesomeAPI (serviço brasileiro, sem chave). Configurável por
// USD_BRL_URL. Se a fonte falhar, mantemos a última cotação boa; sem nenhuma,
// caímos para USD_BRL_FALLBACK. Nunca lança.

import dotenv from "dotenv";
import { registrarErroInterno } from "../chat/errors.js";

dotenv.config();

const FONTE = process.env.USD_BRL_URL || "https://economia.awesomeapi.com.br/last/USD-BRL";
const FALLBACK = Number(process.env.USD_BRL_FALLBACK) || 5.4;
const TIMEOUT_MS = 8000;
const TTL_OK_MS = 6 * 60 * 60 * 1000; // cotação boa: 6 h
const TTL_FALLBACK_MS = 15 * 60 * 1000; // usando fallback: tenta de novo em 15 min

let cache = { valor: null, expiraEm: 0 };
let emVoo = null;

async function buscarCotacao() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(FONTE, { headers: { Accept: "application/json" }, signal: controller.signal });
    if (!resp.ok) throw new Error(`cotação respondeu ${resp.status}`);
    const dados = await resp.json();
    // AwesomeAPI: { "USDBRL": { "bid": "5.43", ... } }
    // open.er-api / exchangerate.host: { "rates": { "BRL": 5.43 } }
    const bruto = dados?.USDBRL?.bid ?? dados?.rates?.BRL ?? dados?.bid ?? dados?.result;
    const n = Number(bruto);
    if (!Number.isFinite(n) || n <= 0) throw new Error("cotação inválida");
    return n;
  } finally {
    clearTimeout(timer);
  }
}

// Retorna quantos reais vale 1 dólar (ex.: 5.42). Sempre resolve.
export async function getUsdToBrl() {
  if (cache.valor && Date.now() < cache.expiraEm) return cache.valor;
  if (emVoo) return emVoo;

  emVoo = (async () => {
    try {
      const taxa = await buscarCotacao();
      cache = { valor: taxa, expiraEm: Date.now() + TTL_OK_MS };
      return taxa;
    } catch (erro) {
      registrarErroInterno("exchangeRate.getUsdToBrl", erro);
      const taxa = cache.valor || FALLBACK;
      cache = { valor: taxa, expiraEm: Date.now() + TTL_FALLBACK_MS };
      return taxa;
    } finally {
      emVoo = null;
    }
  })();

  return emVoo;
}

// Registro de providers de promoções de jogos.
//
// Hoje só a CheapShark (jogos de PC). Para adicionar PlayStation, Xbox ou
// Nintendo no futuro:
//   1. criar providers/playstation.provider.js implementando a mesma interface
//      do cheapShark.provider.js (id, label, platform, isConfigured, getDeals,
//      getTopDeals, searchGames, getGameDeals, getStores);
//   2. importar e adicionar ao array PROVIDERS abaixo.
// Nada mais muda: controllers e frontend continuam iguais, porque todo provider
// devolve o mesmo formato interno (utils/normalizeDeal.js).

import * as cheapShark from "./cheapShark.provider.js";

const PROVIDERS = [cheapShark];

// Provider padrão para promoções de PC.
export const PROVIDER_PADRAO = "cheapshark";

// Providers com credenciais/condições prontas para uso.
export function providersDisponiveis() {
  return PROVIDERS.filter((p) => {
    try {
      return p.isConfigured();
    } catch {
      return false;
    }
  });
}

// Busca um provider pelo id (ex.: "cheapshark"). Sem id, devolve o padrão.
export function getProvider(id = PROVIDER_PADRAO) {
  const alvo = String(id || PROVIDER_PADRAO).toLowerCase();
  return PROVIDERS.find((p) => p.id === alvo) || null;
}

// Lista leve para uma futura rota "quais fontes existem".
export function listarProviders() {
  return PROVIDERS.map((p) => ({
    id: p.id,
    label: p.label,
    platform: p.platform,
    configured: (() => {
      try {
        return p.isConfigured();
      } catch {
        return false;
      }
    })()
  }));
}

// Cache genérico com TTL.
//
// Hoje a implementação é 100% em memória (um Map por instância). O contrato
// abaixo (`get`, `set`, `del`, `wrap`) é propositalmente pequeno para que, no
// futuro, seja possível trocar por Redis sem mexer em quem usa o cache
// (providers e controllers). Basta criar outro objeto com os mesmos métodos.
//
// `wrap(chave, ttlMs, carregar)` é o atalho usado pelos providers:
//   - se houver valor válido em cache, devolve na hora;
//   - senão, chama `carregar()`, guarda o resultado e devolve;
//   - chamadas concorrentes para a mesma chave compartilham a MESMA Promise
//     (evita disparar a mesma requisição externa várias vezes em paralelo).

export function criarCacheMemoria() {
  const loja = new Map(); // chave -> { valor, expiraEm }
  const emVoo = new Map(); // chave -> Promise (carga em andamento)

  function get(chave) {
    const item = loja.get(chave);
    if (!item) return undefined;
    if (Date.now() >= item.expiraEm) {
      loja.delete(chave);
      return undefined;
    }
    return item.valor;
  }

  function set(chave, valor, ttlMs) {
    loja.set(chave, { valor, expiraEm: Date.now() + Math.max(0, Number(ttlMs) || 0) });
    return valor;
  }

  function del(chave) {
    loja.delete(chave);
  }

  function limpar() {
    loja.clear();
    emVoo.clear();
  }

  async function wrap(chave, ttlMs, carregar) {
    const cacheado = get(chave);
    if (cacheado !== undefined) return cacheado;

    if (emVoo.has(chave)) return emVoo.get(chave);

    const promessa = (async () => {
      const valor = await carregar();
      set(chave, valor, ttlMs);
      return valor;
    })().finally(() => emVoo.delete(chave));

    emVoo.set(chave, promessa);
    return promessa;
  }

  return { get, set, del, limpar, wrap };
}

// Instância única compartilhada pela integração de promoções. Trocar por um
// adaptador Redis aqui é suficiente para migrar tudo.
export const dealsCache = criarCacheMemoria();

// TTLs (em ms) sugeridos pela especificação da integração.
export const TTL = {
  LOJAS: 60 * 60 * 1000, // lista de lojas: 60 min
  TOP: 5 * 60 * 1000, // melhores promoções: 5 min
  BUSCA: 10 * 60 * 1000, // busca por jogo: 10 min
  DETALHES: 5 * 60 * 1000, // ofertas de um jogo: 5 min
  DEALS: 3 * 60 * 1000 // promoções gerais paginadas: 3 min
};

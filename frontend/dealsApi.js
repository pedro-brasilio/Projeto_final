/* Camada de acesso do frontend às promoções de jogos.
 *
 * O frontend NUNCA fala com a CheapShark. Fala só com o backend deste projeto,
 * pelas rotas /api/deals, /api/deals/top, /api/games/search, /api/games/:id/deals
 * e /api/stores. Nenhuma URL da CheapShark aparece aqui nem nos componentes.
 *
 * Uso (script clássico):
 *   <script src="frontend/dealsApi.js"></script>
 *   const { data } = await DealsApi.getTopDeals({ limit: 12 });
 *
 * Todas as funções devolvem o corpo já parseado do backend:
 *   sucesso -> { success: true, data, pagination }
 *   erro    -> lança Error com a mensagem amigável vinda do backend.
 *
 * Debounce da busca (300-500 ms) fica a cargo de quem chama searchGames().
 */
(function (global) {
  "use strict";

  // Mesma origem/porta do backend usada no resto do frontend.
  var API_BASE = (global.API_BASE || "http://localhost:3000").replace(/\/$/, "");

  function montarQuery(params) {
    var pares = [];
    Object.keys(params || {}).forEach(function (chave) {
      var valor = params[chave];
      if (valor === undefined || valor === null || valor === "") return;
      pares.push(encodeURIComponent(chave) + "=" + encodeURIComponent(valor));
    });
    return pares.length ? "?" + pares.join("&") : "";
  }

  async function pedir(caminho, params) {
    var url = API_BASE + caminho + montarQuery(params);
    var resp;
    try {
      resp = await fetch(url, { headers: { Accept: "application/json" } });
    } catch (e) {
      throw new Error("Não foi possível falar com o servidor de promoções.");
    }

    var corpo = null;
    try {
      corpo = await resp.json();
    } catch (e) {
      corpo = null;
    }

    if (!resp.ok || !corpo || corpo.success === false) {
      var msg =
        (corpo && corpo.error && corpo.error.message) ||
        "Não foi possível buscar as promoções.";
      throw new Error(msg);
    }
    return corpo;
  }

  var DealsApi = {
    /* GET /api/deals — promoções gerais, paginadas.
     * opts: { page, limit, sort, desc, store, upperPrice, lowerPrice, onSale,
     *         metacritic, steamRating, title, provider } */
    getDeals: function (opts) {
      return pedir("/api/deals", opts || {});
    },

    /* GET /api/deals/top — melhores promoções atuais. opts: { limit, sort } */
    getTopDeals: function (opts) {
      return pedir("/api/deals/top", opts || {});
    },

    /* GET /api/games/search?q=... — busca jogo pelo nome. */
    searchGames: function (q, opts) {
      var params = Object.assign({ q: q }, opts || {});
      return pedir("/api/games/search", params);
    },

    /* GET /api/games/:gameId/deals — ofertas do jogo em cada loja. */
    getGameDeals: function (gameId) {
      return pedir("/api/games/" + encodeURIComponent(gameId) + "/deals");
    },

    /* GET /api/stores — lojas suportadas. opts: { active } */
    getStores: function (opts) {
      return pedir("/api/stores", opts || {});
    }
  };

  // Exporta como global (script clássico) e como módulo, se houver.
  global.DealsApi = DealsApi;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = DealsApi;
  }
})(typeof window !== "undefined" ? window : this);

// Rotas da integração de promoções de jogos.
//
// Montadas em server.js com  app.use("/api", dealsRoutes).
// Prefixo final de cada rota: /api/...
//
//   GET /api/deals                 -> promoções gerais, paginadas
//   GET /api/deals/top             -> melhores promoções atuais
//   GET /api/games/search?q=...    -> busca jogo pelo nome
//   GET /api/games/:gameId/deals   -> ofertas de um jogo em cada loja
//   GET /api/stores                -> lojas suportadas
//
// Toda a lógica (validação, provider, cache, formato de resposta) está nos
// controllers. Aqui é só o mapa de URLs.

import { Router } from "express";
import {
  listarDeals,
  listarTopDeals,
  buscarJogos,
  ofertasDoJogo,
  listarLojas
} from "../controllers/deals.controller.js";

const router = Router();

// A rota mais específica (/deals/top) vem antes da genérica (/deals).
router.get("/deals/top", listarTopDeals);
router.get("/deals", listarDeals);

router.get("/games/search", buscarJogos);
router.get("/games/:gameId/deals", ofertasDoJogo);

router.get("/stores", listarLojas);

export default router;

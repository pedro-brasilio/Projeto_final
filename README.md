<div align="center">
  <img src="imag/atomix-logo.png" alt="Logo do Atomix" width="180">

  # ⚛️ Atomix

  **Sua central inteligente para explorar games, filmes, séries e promoções.**

  [![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
  [![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white)](https://expressjs.com/)
  [![OpenAI](https://img.shields.io/badge/OpenAI-Responses_API-412991?logo=openai&logoColor=white)](https://platform.openai.com/docs/api-reference/responses)
</div>

## 📖 Sobre o projeto

O **Atomix** é uma aplicação web voltada à cultura geek. Sua assistente virtual, **Neon**, conversa sobre games, filmes e séries, consulta dados atualizados em serviços externos e adapta a forma de responder à personalidade escolhida pelo usuário.

Além do chat, a aplicação oferece catálogos de jogos e filmes, pesquisa por título, histórico de conversas, lista de itens salvos e consulta de promoções de jogos para PC com preços convertidos para real.

## ✨ Funcionalidades

- 🤖 Chat com IA especializado em games, filmes e séries
- 🎭 Três personalidades: **Geek Entusiasta**, **Crítico de Cinema** e **Gamer Hardcore**
- 🎮 Catálogo e pesquisa de jogos com dados da IGDB
- 🎬 Catálogo e pesquisa de filmes com dados da TMDB
- 🍿 Consulta de detalhes de filmes e séries pela OMDb
- 🏷️ Promoções de jogos para PC fornecidas pela CheapShark
- 💱 Conversão automática de preços de dólar para real
- 💾 Histórico persistente de até 5 conversas por usuário
- ⭐ Watchlist armazenada no navegador
- 🌓 Interface responsiva com temas claro e escuro
- ⚡ Cache em memória para reduzir chamadas às APIs externas

## 🛠️ Tecnologias e serviços

| Camada | Tecnologias |
| --- | --- |
| Frontend | HTML, CSS e JavaScript puro |
| Backend | Node.js e Express |
| IA | SDK OpenAI e Responses API |
| Filmes e séries | TMDB e OMDb |
| Jogos | IGDB com autenticação Twitch OAuth |
| Promoções | CheapShark |
| Persistência | Arquivo JSON e Local Storage |

## 🚀 Como executar

### Pré-requisitos

- [Node.js](https://nodejs.org/) 18 ou superior
- npm
- Uma chave de API compatível com a configuração OpenAI usada pelo projeto
- Credenciais dos serviços externos que você deseja habilitar

### Instalação

1. Clone o repositório:

   ```bash
   git clone https://github.com/pedro-brasilio/Projeto_final.git
   cd Projeto_final
   ```

2. Instale as dependências:

   ```bash
   npm install
   ```

3. Crie o arquivo de variáveis de ambiente a partir do exemplo:

   **Windows (PowerShell):**

   ```powershell
   Copy-Item .env.example .env
   ```

   **Linux ou macOS:**

   ```bash
   cp .env.example .env
   ```

4. Preencha as credenciais necessárias no arquivo `.env`.

5. Inicie a aplicação:

   ```bash
   npm start
   ```

6. Acesse [http://localhost:3000](http://localhost:3000) no navegador.

Durante o desenvolvimento, use o reinício automático do servidor:

```bash
npm run dev
```

## 🔐 Variáveis de ambiente

| Variável | Obrigatória | Finalidade |
| --- | --- | --- |
| `OPENAI_API_KEY` | Sim, para o chat | Autenticação do modelo de IA |
| `OMDB_API_KEY` | Opcional | Detalhes de filmes e séries |
| `TMDB_API_KEY` | Opcional¹ | Catálogo e busca de filmes |
| `TMDB_ACCESS_TOKEN` | Opcional¹ | Alternativa à chave v3 da TMDB |
| `TWITCH_CLIENT_ID` | Opcional² | Autenticação da IGDB |
| `TWITCH_CLIENT_SECRET` | Opcional² | Autenticação da IGDB |
| `CHEAPSHARK_API_URL` | Não | URL da API de promoções |
| `CHEAPSHARK_SITE_URL` | Não | URL usada nos redirecionamentos |
| `CHEAPSHARK_TIMEOUT_MS` | Não | Tempo limite das requisições |
| `CHEAPSHARK_USER_AGENT` | Não | Identificação personalizada do cliente |
| `USD_BRL_URL` | Não | Fonte da cotação USD/BRL |
| `USD_BRL_FALLBACK` | Não | Cotação reserva em caso de falha |
| `HISTORY_FILE` | Não | Caminho do arquivo de histórico |

¹ Configure `TMDB_API_KEY` **ou** `TMDB_ACCESS_TOKEN`.  
² As duas credenciais da Twitch são necessárias para ativar a IGDB.

## 🔌 Principais endpoints

| Método | Rota | Descrição |
| --- | --- | --- |
| `POST` | `/chat` | Envia uma mensagem para a Neon |
| `POST` | `/chat/reset` | Limpa o contexto da sessão |
| `GET` | `/conversations` | Lista as conversas do usuário |
| `POST` | `/conversations` | Cria uma conversa |
| `GET` | `/conversations/:id` | Obtém uma conversa com suas mensagens |
| `DELETE` | `/conversations/:id` | Exclui uma conversa |
| `GET` | `/catalog/games` | Lista jogos em destaque |
| `GET` | `/catalog/games/search?q=...` | Pesquisa jogos |
| `GET` | `/catalog/movies` | Lista filmes em destaque |
| `GET` | `/catalog/movies/search?q=...` | Pesquisa filmes |
| `GET` | `/api/deals` | Lista e filtra promoções |
| `GET` | `/api/deals/top` | Lista as melhores promoções |
| `GET` | `/api/games/search?q=...` | Pesquisa jogos na CheapShark |
| `GET` | `/api/games/:gameId/deals` | Compara ofertas de um jogo |
| `GET` | `/api/stores` | Lista as lojas disponíveis |

O frontend envia um identificador local pelo cabeçalho `x-user-id`, usado para separar os históricos sem exigir login.

## 📁 Estrutura do projeto

```text
Projeto_final/
├── chat/           # Contexto, histórico, roteamento e personalidades da IA
├── controllers/    # Validação e controle das rotas de promoções
├── data/           # Histórico local gerado em tempo de execução
├── imag/           # Imagens e identidade visual
├── providers/      # Abstração dos provedores de promoções
├── routes/         # Definição das rotas da API
├── services/       # Integrações com OpenAI, TMDB, OMDb, IGDB e CheapShark
├── utils/          # Cache, normalização e respostas HTTP
├── index.html      # Interface principal da aplicação
├── server.js       # Servidor Express e endpoints
├── .env.example    # Modelo de configuração
└── package.json    # Dependências e scripts
```

## 🧠 Como a resposta é gerada

1. O frontend envia a mensagem, a sessão e a personalidade selecionada.
2. O backend recupera o contexto recente da conversa.
3. O roteador identifica se a pergunta precisa de informações atualizadas.
4. Quando necessário, o serviço adequado consulta filmes, séries, jogos ou promoções.
5. A Neon combina o contexto e os dados atuais para produzir a resposta.
6. A troca é salva no histórico local da conversa.

## 📜 Scripts disponíveis

| Comando | Descrição |
| --- | --- |
| `npm start` | Inicia o servidor com Node.js |
| `npm run dev` | Inicia o servidor com Nodemon |

## 🤝 Contribuição

Contribuições são bem-vindas! Faça um fork, crie uma branch para sua alteração e envie um pull request.

```bash
git checkout -b feature/minha-melhoria
git commit -m "feat: adiciona minha melhoria"
git push origin feature/minha-melhoria
```

---

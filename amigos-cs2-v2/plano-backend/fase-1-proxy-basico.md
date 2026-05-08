# Fase 1 — Proxy Básico com Express

## Objetivo

Criar a estrutura do projeto Node.js e um proxy funcional que repassa chamadas do frontend para o Gamersclub com os headers corretos, eliminando o erro de CORS.

## Estrutura de Pastas

```
backend/
├── src/
│   ├── routes/
│   │   └── proxy.js          # rotas do proxy
│   ├── services/
│   │   └── httpClient.js     # axios configurado com cookie jar
│   ├── middlewares/
│   │   └── cors.js           # libera apenas o frontend Angular
│   └── index.js              # entry point
├── .env
├── .env.example
└── package.json
```

## Passos

### 1.1 — Inicializar o projeto

```bash
mkdir backend && cd backend
npm init -y
npm install express axios axios-cookiejar-support tough-cookie dotenv cors
```

### 1.2 — Configurar o cliente HTTP (`src/services/httpClient.js`)

- Criar instância do axios com `CookieJar` do `tough-cookie`
- Definir headers base que simulam uma requisição `same-origin`:
  - `referer: https://gamersclub.com.br/`
  - `sec-fetch-site: same-origin`
  - `sec-fetch-mode: cors`
  - `user-agent` de um Chrome real
- **Não enviar** o header `origin` (browser omite em same-origin)

### 1.3 — Criar a rota de proxy (`src/routes/proxy.js`)

- `GET /api/lobby/match/:matchId/:tab`
  - Repassa para `https://gamersclub.com.br/lobby/match/:matchId/:tab`
  - Retorna o JSON para o frontend
- Tratar erros HTTP do Gamersclub (401, 403, 429) com mensagens claras

### 1.4 — Configurar CORS do backend (`src/middlewares/cors.js`)

- Liberar apenas `https://amigos-cs2-north-wind.web.app` (e `localhost` em dev)
- Bloquear qualquer outra origem

### 1.5 — Entry point (`src/index.js`)

- Carregar `.env`
- Registrar middlewares (cors, json)
- Registrar rotas
- Subir na porta configurada (padrão `3000`)

### 1.6 — Variáveis de ambiente (`.env`)

```env
PORT=3000
ALLOWED_ORIGIN=https://amigos-cs2-north-wind.web.app
GAMERSCLUB_BASE_URL=https://gamersclub.com.br
```

## Critério de Conclusão

- `GET /api/lobby/match/26843934/1` retorna o JSON do Gamersclub sem erro de CORS
- O frontend Angular consegue consumir a rota normalmente
- Requisições sem cookies válidos retornam 401/403 (Cloudflare ainda bloqueia — será resolvido na Fase 3)

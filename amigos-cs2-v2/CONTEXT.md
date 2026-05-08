# Amigos CS2 — Backend Proxy: Contexto e Funcionamento

> **Documentos relacionados:**
> - [`DOCUMENTACAO.md`](./DOCUMENTACAO.md) — referência operacional (camadas, libs, troubleshooting)
> - [`MIGRACAO.md`](./MIGRACAO.md) — histórico da migração Firebase Functions → VPS
> - [`PROXIMA_SESSAO.md`](./PROXIMA_SESSAO.md) — onde retomar trabalho na próxima sessão

---

## Problema original

O frontend Angular (`amigos-cs2-north-wind.web.app`) chamava direto a API do `gamersclub.com.br`. Dois bloqueios apareceram:

1. **CORS**: o browser bloqueia requisições cross-origin sem os headers corretos
2. **Cloudflare**: o GamersClub usa CF para bloquear bots e exige cookies autenticados (`cf_clearance`, `gclubsess`, `gcid:accessToken`)

**Solução**: backend Node.js como proxy intermediário que injeta os cookies autenticados antes de repassar a request ao GC.

---

## Arquitetura atual

```
Angular (browser, Firebase Hosting HTTPS)
    ↓ https://amigos-cs2.duckdns.org/api/...
Nginx :443 (TLS, na VPS Vultr SP)
    ↓ proxy_pass http://127.0.0.1:3000
Express :3000 (PM2)                                    FlareSolverr :8191 (Docker, 127.0.0.1 only)
    │                                                          ▲
    └── injeta cookies + cf_clearance ─────── pede cf_clearance ┘
    ↓ https://gamersclub.com.br/...
GamersClub API
```

Onde mora cada peça:

- **Frontend**: Firebase Hosting (`amigos-cs2-north-wind.web.app`)
- **Backend + FlareSolverr**: VPS Vultr São Paulo, Ubuntu 24.04 ($6/mês)
- **DNS**: DuckDNS (subdomínio gratuito `amigos-cs2.duckdns.org`)

---

## Autenticação do GamersClub

O acesso à API do GC requer **dois tipos de credencial em paralelo**:

### Cookies de sessão (manuais, ~6 meses)

Cookies que comprovam que você está logado no GC. Hoje o GC só aceita login via Steam OAuth — não dá pra automatizar com email/senha. Por isso o admin loga manualmente uma vez, copia os cookies do navegador, e cola no `.env`.

| Cookie | Domínio | Descrição |
|--------|---------|-----------|
| `gclubsess` | gamersclub.com.br | Sessão principal do GC |
| `gcid:accessToken` | gamersclub.com.br | Token opaco da sessão OAuth2 |
| `x-gcid:accessToken` | gamersclub.com.br | JWT diferente do anterior (mesmo nome, valor distinto — começa com `eyJ...`) |

**Importante**: `gcid:accessToken` e `x-gcid:accessToken` têm valores **completamente diferentes**. O primeiro é opaco, o segundo é um JWT.

Procedimento detalhado pra rotacionar: ver seção 4.1 da [`DOCUMENTACAO.md`](./DOCUMENTACAO.md).

### `cf_clearance` (automático, a cada 25 min)

Cookie do Cloudflare que comprova que o cliente passou pelo challenge. **Vinculado ao par (IP, User-Agent)** — o que foi minted no seu PC residencial **não vale** no IP da VPS.

**Solução em produção**: `FlareSolverr` (Chrome headless containerizado) resolve o challenge a partir do IP da VPS. O backend chama o FlareSolverr no boot e a cada 25 min, persiste o `cf_clearance` retornado no cookie jar, e atualiza o User-Agent do axios pra bater com o que o solver usou.

---

## Estrutura de arquivos

```
backend/
├── src/
│   ├── index.js                  — entry point: bootstrap + listen
│   ├── app.js                    — Express app + middlewares + rotas
│   ├── middlewares/
│   │   └── cors.js               — CORS: libera ALLOWED_ORIGIN
│   ├── routes/
│   │   ├── proxy.js              — /api/lobby/match/* (proxy ao GC)
│   │   └── session.js            — /api/session/status, /api/session/renew (debug)
│   └── services/
│       ├── auth.js               — orquestra login: cookies manuais + flaresolverr
│       ├── manualAuth.js         — injeta cookies do .env no cookie jar
│       ├── flaresolverr.js       — chama FlareSolverr e persiste cf_clearance
│       ├── httpClient.js         — cliente axios + cookie jar + UA dinâmico (interceptor)
│       ├── cookieJar.js          — singleton tough-cookie compartilhado
│       └── sessionManager.js     — cron */25 * * * * de renovação do cf_clearance
├── .env                          — cookies + FLARESOLVERR_URL + configs (não commitar)
└── .env.example                  — template sem valores sensíveis
```

---

## Variáveis de ambiente (.env)

```env
APP_PORT=3000
ALLOWED_ORIGIN=https://amigos-cs2-north-wind.web.app
GAMERSCLUB_BASE_URL=https://gamersclub.com.br

# Cookies de sessão — copiados do Chrome DevTools, validade ~6 meses
GCLUBSESS=<valor de gclubsess>
ACCESS_TOKEN=<valor de gcid:accessToken>
X_ACCESS_TOKEN=<valor de x-gcid:accessToken>  # JWT, diferente do anterior!

# cf_clearance: só usado em dev local (válido pro IP residencial).
# Em produção, deixe vazio — FlareSolverr gera no boot.
CF_CLEARANCE=

# FlareSolverr — URL do solver (deixar vazio em dev local)
# Em produção (VPS): http://127.0.0.1:8191/v1
# IMPORTANTE: usar 127.0.0.1, não localhost (Node 18 resolve localhost pra IPv6)
FLARESOLVERR_URL=

MATCH_ID=26866303              # ID de partida usado em testes manuais
SESSION_FILE=.session.json
INTERNAL_API_KEY=              # protege /api/session/* em produção (vazio em dev)
CF_CRON=*/25 * * * *           # intervalo de renovação do cf_clearance
SESSION_TTL_HOURS=4380         # informativo (sessões duram ~6 meses)
```

---

## Endpoints disponíveis

### `GET /health`
Status do servidor e se a sessão está autenticada.

```json
{ "status": "ok", "session": { "authenticated": true, "loggedInAt": "2026-05-08T19:31:01.000Z" } }
```

### `GET /api/lobby/match/:matchId/:tab`
Proxy para `gamersclub.com.br/lobby/match/:matchId/:tab`.

Exemplo: `GET /api/lobby/match/26866303/1`

### `GET /api/lobby/match/:matchId`
Proxy para `gamersclub.com.br/lobby/match/:matchId` (sem tab).

### `GET /api/session/status`
Detalhes da sessão atual (requer `INTERNAL_API_KEY` em produção).

### `POST /api/session/renew`
Força renovação do `cf_clearance` (requer `INTERNAL_API_KEY` em produção).

---

## Como o proxy funciona

`routes/proxy.js` injeta o `Referer` correto em cada requisição (o GC valida esse header):

- `/lobby/match/:matchId/:tab` → referer: `gamersclub.com.br/lobby/match/:matchId`
- `/lobby/match/:matchId` → referer: `gamersclub.com.br/lobby/partida/:matchId`

`services/httpClient.js` tem um **request interceptor** que sobrescreve o `User-Agent` em toda request com o UA atual (definido pelo último `setUserAgent()` chamado por `auth.js` ou `sessionManager.js`).

Tratamento de erro:
- Se o GC retornar **HTML** (em vez de JSON) → 503 com "Sessão inválida" (cookies expirados)
- Se retornar **403** → `forceRenew()` (pede novo `cf_clearance` ao FlareSolverr) e tenta de novo uma vez

---

## Renovação automática de sessão

`services/sessionManager.js` roda um cron a cada 25 minutos (`*/25 * * * *`):

1. Chama `flaresolverr.refreshClearance()` → recebe novo `cf_clearance` + `userAgent`
2. Persiste o cookie no jar
3. Atualiza o UA do axios via `setUserAgent()`

Por que 25 min: o `cf_clearance` dura ~30 min. Margem de 5 min evita gap entre expiração e renovação.

**Login completo NÃO é automatizado** — o GC só aceita Steam OAuth, então a renovação dos cookies de sessão (`gclubsess`, etc.) é manual a cada ~6 meses (ver [`DOCUMENTACAO.md`](./DOCUMENTACAO.md) seção 4.1).

---

## Como iniciar o servidor

### Em dev local (Windows / sua máquina)

```bash
cd backend
npm install
npm run dev   # node --watch src/index.js
```

`.env` local: `FLARESOLVERR_URL` vazio, `CF_CLEARANCE` preenchido com o valor do navegador (válido pro seu IP residencial).

Teste:
```bash
curl -s http://localhost:3000/health
curl -s http://localhost:3000/api/lobby/match/26866303/1
```

### Em produção (VPS)

Já deployado. Comandos de operação:
```bash
pm2 status
pm2 logs amigos-cs2
pm2 restart amigos-cs2
```

Detalhes em [`DOCUMENTACAO.md`](./DOCUMENTACAO.md), seção "Operação no dia a dia".

---

## Problemas conhecidos e soluções

| Problema | Causa | Solução |
|---------|-------|---------|
| Proxy retorna `503` com "HTML recebido" | Cookies de sessão (`gclubsess` etc) inválidos ou expirados | Rotacionar cookies (DOCUMENTACAO.md §4.1) |
| `x-gcid:accessToken` inválido | Copiou o mesmo valor de `gcid:accessToken` | São tokens diferentes — copiar o JWT (`eyJ...`) do cookie `x-gcid:accessToken` |
| 403 com `cf-mitigated: challenge` | `cf_clearance` desatualizado ou mismatch de UA | Forçar renovação: `curl -X POST localhost:3000/api/session/renew` |
| `connect ECONNREFUSED ::1:8191` | `.env` usa `localhost` em vez de `127.0.0.1` (Node 18 resolve IPv6) | `.env`: `FLARESOLVERR_URL=http://127.0.0.1:8191/v1` |
| `ERR_REQUIRE_ESM` no boot | Versão errada de `tough-cookie` ou `axios-cookiejar-support` (v6+ é ESM-only) | Manter `tough-cookie@^4.1.4` e `axios-cookiejar-support@^5.0.5` |
| Server sobe mas `authenticated: false` | FlareSolverr inacessível **OU** cookies do `.env` faltando | `pm2 logs amigos-cs2 --lines 30` revela qual dos dois |

Histórico completo dos bugs encontrados na migração: [`MIGRACAO.md`](./MIGRACAO.md), tabela "Bugs encontrados e corrigidos durante a Fase 4".

# Amigos CS2 — Backend Proxy: Contexto e Funcionamento

## Problema original

O frontend Angular (`amigos-cs2-north-wind.web.app`) chamava diretamente a API do `gamersclub.com.br`. O Gamersclub passou a bloquear essas requisições por dois motivos:

1. **CORS**: o browser bloqueia requisições cross-origin sem os headers corretos
2. **Cloudflare**: o Gamersclub usa CF para bloquear bots e requer cookies autenticados (`cf_clearance`, `gclubsess`, `gcid:accessToken`)

**Solução**: Node.js rodando como proxy intermediário. O Angular chama o backend local; o backend repassa as requisições ao Gamersclub com os cookies corretos já injetados.

---

## Arquitetura

```
Angular (browser)
    ↓ http://localhost:3000/api/...
Backend Node.js (Express)
    ↓ https://gamersclub.com.br/...  (com cookies autenticados)
Gamersclub API
```

---

## Autenticação do Gamersclub

O Gamersclub usa **Ory Kratos** (identidade) + **Ory Hydra** (OAuth2) hospedados em `gcid.gamersclub.gg`.

### Fluxo OAuth2 completo (modo auto)

```
gcid.gamersclub.gg           → CF resolvido + formulário Kratos aparece
POST /self-service/login/...  → Kratos autentica com email/senha
→ hydraLogin                  → aprovação OAuth2 automática
→ hydra/oauth2/auth (login_verifier)
→ hydraPreConsent
→ hydra/oauth2/auth (consent_verifier)
→ gamersclub.com.br/auth/gcidCallback   → seta gclubsess + gcid:accessToken
→ gamersclub.com.br/lobby   ← autenticado
```

### Cookies necessários

| Cookie | Domínio | Descrição |
|--------|---------|-----------|
| `gclubsess` | gamersclub.com.br | Sessão principal do Gamersclub |
| `gcid:accessToken` | gamersclub.com.br | Token opaco da sessão OAuth2 |
| `x-gcid:accessToken` | gamersclub.com.br | JWT diferente do anterior (mesmo nome, valor distinto) |
| `cf_clearance` | gamersclub.com.br | Token Cloudflare (bound ao IP, validade ~30min) |

**Importante**: `gcid:accessToken` e `x-gcid:accessToken` têm valores completamente diferentes. O primeiro é um token opaco, o segundo é um JWT (`eyJ...`).

---

## Modos de autenticação

Controlado pela variável `GC_AUTH_MODE` no `.env`.

### `manual` (padrão atual)

Você copia os cookies do DevTools do Chrome e coloca no `.env`. O servidor os injeta no `CookieJar` na inicialização.

**Quando usar**: sempre que o modo `auto` falhar ou para testes rápidos.

**Como obter os cookies**:
1. Abra `gamersclub.com.br` no Chrome logado
2. F12 → Application → Cookies → `gamersclub.com.br`
3. Copie os valores de `gclubsess`, `gcid:accessToken`, `x-gcid:accessToken`, `cf_clearance`

**Limitação**: o `cf_clearance` é bound ao IP e expira em ~30min. Em produção isso precisa de renovação automática.

### `auto`

Puppeteer abre um Chrome headless, navega para `gcid.gamersclub.gg`, preenche email/senha, segue o fluxo OAuth2 completo e sincroniza todos os cookies para o `CookieJar` compartilhado.

**Quando usar**: em produção, para renovação automática de sessão.

**Pré-requisito no Ubuntu/WSL2**: instalar as dependências do Chrome:
```bash
sudo apt-get install -y \
  libnspr4 libnss3 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
  libxfixes3 libxrandr2 libgbm1 libasound2t64 libpango-1.0-0 \
  libcairo2 libatspi2.0-0
```

---

## Estrutura de arquivos

```
backend/
├── src/
│   ├── index.js                  — entry point, bootstrap
│   ├── middlewares/
│   │   └── cors.js               — CORS: permite localhost:4200 + ALLOWED_ORIGIN
│   ├── routes/
│   │   ├── proxy.js              — rotas /api/lobby/match/...
│   │   └── session.js            — rotas /api/session/status e /renew
│   └── services/
│       ├── cookieJar.js          — singleton CookieJar (tough-cookie) compartilhado
│       ├── httpClient.js         — dois axios: client (gamersclub) + kratosClient (gcid)
│       ├── auth.js               — orquestra login manual ou auto, persiste sessão em disco
│       ├── manualAuth.js         — injeta cookies do .env no jar
│       ├── cloudflare.js         — login via Puppeteer + refresh do cf_clearance
│       └── sessionManager.js     — cron para renovação automática a cada 25min
├── .env                          — variáveis de ambiente (não commitar)
└── .env.example                  — template sem valores sensíveis
```

---

## Variáveis de ambiente (.env)

```env
APP_PORT=3000
ALLOWED_ORIGIN=https://amigos-cs2-north-wind.web.app
GAMERSCLUB_BASE_URL=https://gamersclub.com.br
GCID_BASE_URL=https://gcid.gamersclub.gg

# Modo de autenticação: "manual" ou "auto"
GC_AUTH_MODE=manual

# Modo MANUAL — cookies copiados do Chrome DevTools
GC_COOKIE_GCLUBSESS=<valor de gclubsess>
GC_COOKIE_ACCESS_TOKEN=<valor de gcid:accessToken>
GC_COOKIE_X_ACCESS_TOKEN=<valor de x-gcid:accessToken>  # JWT, diferente do anterior!
GC_COOKIE_CF_CLEARANCE=<valor de cf_clearance>

# Modo AUTO — credenciais para Puppeteer
GC_EMAIL=seu@email.com
GC_PASSWORD=suasenha

SESSION_FILE=.session.json
INTERNAL_API_KEY=          # deixar vazio em dev
PUPPETEER_HEADLESS=true
CF_CRON=*/25 * * * *       # intervalo de renovação do cf_clearance
SESSION_TTL_HOURS=6
```

---

## Endpoints disponíveis

### `GET /health`
Retorna status do servidor e se a sessão está autenticada.

```json
{ "status": "ok", "session": { "authenticated": true, "loggedInAt": "2026-05-05T..." } }
```

### `GET /api/lobby/match/:matchId/:tab`
Proxy para `gamersclub.com.br/lobby/match/:matchId/:tab`.

Exemplo: `GET /api/lobby/match/26843934/1`

### `GET /api/lobby/match/:matchId`
Proxy para `gamersclub.com.br/lobby/match/:matchId` (sem tab).

### `GET /api/session/status`
Retorna detalhes da sessão atual (requer `INTERNAL_API_KEY` em produção).

### `POST /api/session/renew`
Força renovação da sessão (requer `INTERNAL_API_KEY` em produção).

---

## Como o proxy funciona

O `proxy.js` injeta o `Referer` correto em cada requisição, pois o Gamersclub verifica esse header:

- `/lobby/match/:matchId/:tab` → referer: `gamersclub.com.br/lobby/match/:matchId`
- `/lobby/match/:matchId` → referer: `gamersclub.com.br/lobby/partida/:matchId`

Se o Gamersclub retornar HTML (em vez de JSON), o proxy responde com `503` — indica sessão inválida.

Se receber `403`, o proxy chama `forceRenew()` (que roda o Puppeteer para renovar o `cf_clearance`) e tenta novamente.

---

## Renovação automática de sessão

O `sessionManager.js` roda um cron a cada 25 minutos (`CF_CRON`):

- Se a sessão expirou (baseado em `SESSION_TTL_HOURS`): faz login completo via Puppeteer
- Se ainda válida: só renova o `cf_clearance` (mais rápido, sem precisar de login)

---

## Como iniciar o servidor

```bash
cd backend
npm install
node src/index.js
```

Teste:
```bash
curl -s http://localhost:3000/health
curl -s http://localhost:3000/api/lobby/match/26843934/1
```

---

## Problemas conhecidos e soluções

| Problema | Causa | Solução |
|---------|-------|---------|
| Proxy retorna `503` com "HTML recebido" | Cookies inválidos ou expirados | Atualizar cookies no `.env` e reiniciar |
| `x-gcid:accessToken` inválido | Copiou o mesmo valor de `gcid:accessToken` | São tokens diferentes — copiar o JWT (`eyJ...`) do cookie `x-gcid:accessToken` |
| Puppeteer não encontra `input[name="identifier"]` | CF challenge bloqueou antes do form | Aguardar (timeout de 90s) ou usar modo manual |
| Chrome não lança no WSL2 | Bibliotecas do sistema faltando | Instalar deps com `apt-get` (ver seção auto acima) |
| `cf_clearance` expira | Bound ao IP, TTL ~30min | Renovação automática via cron (modo auto) ou atualizar manualmente (modo manual) |

# Documentação — Backend amigos-cs2 (proxy GamersClub)

Referência única do backend: o que é, como funciona, quais bibliotecas usa, como
a VPS está montada e como operar no dia a dia.

> Para **rotacionar os tokens de sessão** (quando o backend começa a falhar com
> "sessão inválida"), veja [`RENOVAR-TOKENS.md`](./RENOVAR-TOKENS.md).

---

## Sumário

1. [Visão geral](#1-visão-geral)
2. [Como funciona uma requisição](#2-como-funciona-uma-requisição)
3. [Cache, serialização e deduplicação](#3-cache-serialização-e-deduplicação)
4. [Infraestrutura (VPS)](#4-infraestrutura-vps)
5. [Aplicação Node.js](#5-aplicação-nodejs)
6. [Bibliotecas (o que e por quê)](#6-bibliotecas-o-que-e-por-quê)
7. [Variáveis de ambiente (.env)](#7-variáveis-de-ambiente-env)
8. [Endpoints](#8-endpoints)
9. [Operação no dia a dia](#9-operação-no-dia-a-dia)
10. [Troubleshooting](#10-troubleshooting)
11. [Pendências](#11-pendências)

---

## 1. Visão geral

O sistema é um **proxy autenticado** entre o frontend (Angular, no Firebase
Hosting) e a API privada do GamersClub (GC). O frontend não pode chamar o GC
direto por dois motivos: **CORS** (o browser bloqueia cross-origin) e
**Cloudflare + autenticação** (o GC exige cookies de sessão e um `cf_clearance`
válido). O backend resolve os dois: injeta a sessão autenticada e devolve o JSON
pro frontend.

```
[Frontend Angular]  https://amigos-cs2-north-wind.web.app  (Firebase Hosting)
       │
       ▼  https://amigos-cs2.duckdns.org/api/lobby/match/...
[DuckDNS] amigos-cs2.duckdns.org → IP fixo da VPS
       │
       ▼
[VPS Vultr — São Paulo, Ubuntu 24.04]
       │
       ├── Nginx :443 (HTTPS, TLS) ── proxy_pass → 127.0.0.1:3000
       │
       ├── Express :3000 (PM2)
       │     ├─ cache em memória das partidas já buscadas
       │     └─ busca a API do GC pelo FlareSolverr (ver abaixo)
       │
       └── FlareSolverr (Docker, 127.0.0.1:8191)
             └─ Chrome headless: resolve Cloudflare + faz a request com
                fingerprint de browser real
                       │
                       ▼
                gamersclub.com.br
```

**Por que a busca passa pelo FlareSolverr (e não pelo axios direto):**
o GamersClub fica atrás do Cloudflare, que valida não só o `cf_clearance` mas
também o **fingerprint TLS (JA3)** de quem faz a chamada. Uma requisição feita
pelo axios/Node tem fingerprint de "não-browser" — o Cloudflare deixa passar pro
servidor do GC, mas o GC responde **500** (uma página de erro HTML com New
Relic). Já o **FlareSolverr usa um Chrome real**: fingerprint de browser +
`cf_clearance` consistente → o GC responde **200 + JSON**. Por isso, em produção,
**toda** chamada à API do GC sai pelo FlareSolverr, com os cookies de sessão
injetados.

**Stack rápida:**
- VPS: Vultr Cloud Compute, São Paulo, Ubuntu 24.04 (~$6/mês), IP fixo
- Backend: Node.js 18 + Express 5 + axios
- Anti-Cloudflare / fetch: FlareSolverr (Chrome headless em Docker)
- Reverse proxy / TLS: Nginx + Certbot (ZeroSSL via DNS-01)
- DNS: DuckDNS
- Process manager: PM2

---

## 2. Como funciona uma requisição

1. O frontend chama `https://amigos-cs2.duckdns.org/api/lobby/match/27128374/1`.
2. O Nginx termina o TLS e repassa pra `http://127.0.0.1:3000/...`.
3. O Express cai no router `routes/proxy.js`.
4. **Cache:** se essa partida/aba já foi buscada e o cache ainda está fresco, a
   resposta sai daí na hora, sem tocar no GC (header `x-proxy-cache: HIT`).
5. Senão, o proxy chama `flaresolverr.fetchJson(url)`:
   - Monta o POST pro FlareSolverr (`cmd: request.get`) com os **cookies de
     sessão** do `.env` (`gclubsess`, `gcid:accessToken`, `x-gcid:accessToken`).
   - O FlareSolverr abre o Chrome, resolve o Cloudflare e busca a URL.
   - O Chrome renderiza o JSON dentro de um `<pre>` (com entidades HTML
     escapadas); `extractJson()` extrai e faz o parse.
6. O proxy guarda a resposta no cache e devolve o JSON pro frontend
   (`x-proxy-cache: MISS`).

**Tratamento de erro** (`routes/proxy.js`):
- **429 / 5xx do GC** → se houver versão em cache (mesmo "velha"), serve ela em
  vez de propagar o erro (`x-proxy-cache: STALE`); senão devolve o status.
- **200 sem JSON** (página de login/erro) → 503 "sessão inválida" (ou cache
  stale, se houver).
- **403** → só ocorre no caminho axios (dev local); tenta renovar o
  `cf_clearance` e refazer uma vez.

---

## 3. Cache, serialização e deduplicação

Três mecanismos no proxy reduzem o volume de chamadas ao GC — o que evita o
**rate-limit** (o GC devolve 429 e depois 500 quando o IP da VPS faz muitas
requisições) e esconde a latência do Chrome do FlareSolverr.

### 3.1 Cache em memória (`routes/proxy.js`)

- `Map` simples: `path → { data, status, expiresAt }`.
- Partida já buscada é servida do cache até expirar. Partida **finalizada não
  muda**, então um TTL generoso é seguro.
- Configurável pelo `.env`:
  - `PROXY_CACHE_TTL` — validade em **segundos** (default **300** = 5 min).
  - `PROXY_CACHE_MAX` — teto de entradas (default **500**); ao estourar, descarta
    a mais antiga.
- Em 429/5xx, serve a versão em cache mesmo expirada (melhor um dado velho que um
  erro). Em todas as respostas há o header `x-proxy-cache: HIT | MISS | STALE`
  (útil pra depurar no DevTools).
- **Reiniciar o app zera o cache** (é em memória, não persiste).

### 3.2 Serialização do FlareSolverr (`services/flaresolverr.js`)

O FlareSolverr roda **um Chrome só** e atende **um pedido por vez**. Se duas
chamadas chegam juntas (o cron de `cf_clearance` + uma request, ou o front
pedindo vários matches), ele colide e devolve erro / página de desafio em vez do
JSON. Por isso há uma **fila** (`serialize`) que garante uma chamada ao solver
por vez.

### 3.3 Deduplicação de pedidos idênticos (`routes/proxy.js`)

Se N requisições do **mesmo** `path` chegam enquanto uma já está em voo, todas
esperam a **mesma** busca (`fetchDeduped`) em vez de disparar N chamadas ao
FlareSolverr.

> **Trade-off:** como o FlareSolverr é serializado, abrir o front e pedir vários
> matches **diferentes** de uma vez faz eles saírem **um a um** (alguns segundos
> cada na 1ª vez). O cache faz isso acontecer só na primeira busca de cada
> partida. Se um dia ficar lento demais, dá pra subir uma 2ª instância do
> FlareSolverr.

---

## 4. Infraestrutura (VPS)

### 4.1 Vultr Cloud Compute
Servidor virtual com IP fixo (São Paulo, Ubuntu 24.04). Uma Cloud Function do
Firebase (us-central1) levava 403 do Cloudflare porque o IP do GCP está em listas
de bots; uma VPS brasileira passa. Acesso por SSH como `root`.

### 4.2 Docker + FlareSolverr
O FlareSolverr roda como container Docker. Ele sobe um Chrome headless, resolve
challenges do Cloudflare e — no nosso uso — **faz a própria request à API do GC**
(fingerprint de browser real). Devolve o conteúdo + o `userAgent` usado.

```bash
docker run -d --name flaresolverr -p 127.0.0.1:8191:8191 \
  ghcr.io/flaresolverr/flaresolverr:latest
```

**Bind em `127.0.0.1`** — o FlareSolverr **não** pode ficar exposto na internet
(qualquer um o usaria pra furar Cloudflare). Endpoint: `POST http://127.0.0.1:8191/v1`.

### 4.3 PM2
Process manager do Node: mantém o app vivo, reinicia em crash, gerencia logs.
```bash
pm2 start src/index.js --name amigos-cs2
pm2 logs amigos-cs2            # streaming
pm2 logs amigos-cs2 --lines 50 --nostream
pm2 restart amigos-cs2
pm2 status
pm2 startup && pm2 save        # auto-start no boot da VPS
```

> ⚠️ **Atenção ao trocar cookies do `.env`:** o PM2 preserva o `process.env`
> entre restarts. Veja [`RENOVAR-TOKENS.md`](./RENOVAR-TOKENS.md) — o código já usa
> `dotenv ... { override: true }` pra contornar isso.

### 4.4 Nginx
Reverse proxy: termina TLS na `:443` e encaminha pro Express na `:3000`.
Config em `/etc/nginx/sites-available/amigos-cs2`.
```bash
nginx -t && systemctl reload nginx
```

### 4.5 Certbot + ZeroSSL (DNS-01 via DuckDNS)
Certificado TLS. Let's Encrypt não emite cert pra IP, só pra domínio — daí o
DuckDNS. Na emissão, o Let's Encrypt estava em manutenção e o ZeroSSL HTTP-01
travava, então fechamos com **ZeroSSL via DNS-01**:
- Plugin `certbot-dns-duckdns` (`pip3 install certbot-dns-duckdns --break-system-packages`).
- Credenciais DuckDNS em `/root/.duckdns-credentials` (modo 600).
- Renovação automática via `systemd timer`; config em
  `/etc/letsencrypt/renewal/amigos-cs2.duckdns.org.conf`.
```bash
certbot certificates
certbot renew --dry-run
```
Se um dia o ZeroSSL falhar e o Let's Encrypt voltar, remova as linhas
`server = https://acme.zerossl.com/...`, `eab_kid`, `eab_hmac_key` do renewal
config e rode `certbot renew --force-renewal`.

### 4.6 DuckDNS
Subdomínio gratuito `amigos-cs2.duckdns.org` → IP fixo da VPS. Como o IP é fixo
(Vultr), não precisa de cron de update.

---

## 5. Aplicação Node.js

### 5.1 Estrutura

```
backend/
├── index.js                    # entrypoint legado (Firebase Functions) — não usado na VPS
├── src/
│   ├── index.js                # entrypoint da VPS: bootstrap + listen
│   ├── app.js                  # Express app + middlewares + rotas
│   ├── middlewares/
│   │   └── cors.js             # CORS — libera ALLOWED_ORIGIN
│   ├── routes/
│   │   ├── proxy.js            # /api/lobby/match/* + cache + dedup
│   │   └── session.js          # /api/session/{status,renew} (debug)
│   └── services/
│       ├── auth.js             # orquestra o boot da sessão
│       ├── manualAuth.js       # injeta cookies do .env no cookie jar (dev/axios)
│       ├── flaresolverr.js     # fetchJson (busca a API) + refreshClearance + fila
│       ├── httpClient.js       # axios + cookie jar (fallback de dev local)
│       ├── cookieJar.js        # tough-cookie jar compartilhado
│       └── sessionManager.js   # cron */25 de renovação do cf_clearance
├── .env                        # cookies + configs (NÃO commitar)
└── package.json
```

### 5.2 Boot (`src/index.js`)
1. `require('dotenv').config({ override: true })` — carrega o `.env` **sempre por
   cima** do que estiver no `process.env` (ver §10 / `RENOVAR-TOKENS.md`).
2. `auth.initialize()` injeta os cookies e, se `FLARESOLVERR_URL` estiver setado,
   pede um `cf_clearance` inicial ao solver.
3. `sessionManager.start()` agenda o cron `*/25` de renovação do `cf_clearance`.
4. Express ouve na porta 3000.

> **Produção vs dev:** com `FLARESOLVERR_URL` setado (VPS), as buscas à API saem
> pelo FlareSolverr (`fetchJson`). Sem ele (dev local), caem no axios + cookie jar
> (`httpClient`), usando o `cf_clearance` do `.env` válido pro IP residencial.

---

## 6. Bibliotecas (o que e por quê)

| Lib | Versão | Para quê |
|---|---|---|
| `express` | ^5.x | Framework HTTP / roteamento. |
| `cors` | ^2.8 | Headers CORS pra liberar o domínio do frontend. |
| `axios` | ^1.x | Cliente HTTP — fala com o FlareSolverr e (em dev) com o GC. |
| `tough-cookie` | **^4.1** | Cookie jar (RFC 6265). **v4 de propósito**: v6 é ESM-only e o Node 18 não faz `require(esm)`. |
| `axios-cookiejar-support` | **^5.0** | Bridge axios ↔ tough-cookie. **v5 de propósito** (mesmo motivo). |
| `dotenv` | ^17 | Carrega o `.env`. Usado com `{ override: true }`. |
| `node-cron` | ^4 | Cron do `cf_clearance` (`*/25 * * * *`). |
| `firebase-admin` / `firebase-functions` | — | **Legado** (era Cloud Function). Não são `require`'d na VPS; podem ser removidas. |

**Removidas na migração:** `puppeteer` (login automatizado por email/senha — o GC
forçou Steam OAuth) e o pacote `docker` (dep fantasma).

---

## 7. Variáveis de ambiente (.env)

```env
APP_PORT=3000
ALLOWED_ORIGIN=https://amigos-cs2-north-wind.web.app   # SEM barra no final
GAMERSCLUB_BASE_URL=https://gamersclub.com.br          # SEM barra no final

# Cookies de sessão — copiados do Chrome DevTools (~6 meses). Ver RENOVAR-TOKENS.md
GCLUBSESS=<valor de gclubsess>
ACCESS_TOKEN=<valor de gcid:accessToken>               # token opaco
X_ACCESS_TOKEN=<valor de x-gcid:accessToken>           # JWT (eyJ...), DIFERENTE do anterior

# cf_clearance — só em dev local (válido pro IP residencial). Em produção, vazio.
CF_CLEARANCE=

# FlareSolverr — vazio em dev local; na VPS:
FLARESOLVERR_URL=http://127.0.0.1:8191/v1              # 127.0.0.1, NÃO localhost (Node 18 → IPv6)

# Cache do proxy (opcional)
PROXY_CACHE_TTL=300                                     # segundos (default 300)
PROXY_CACHE_MAX=500                                     # nº de entradas (default 500)

INTERNAL_API_KEY=                                       # protege /api/session/* em produção
CF_CRON=*/25 * * * *                                    # intervalo de renovação do cf_clearance
```

> `gcid:accessToken` e `x-gcid:accessToken` têm valores **diferentes**: o primeiro
> é opaco, o segundo é um JWT (`eyJ...`). Não copie o mesmo nos dois.

---

## 8. Endpoints

| Método / rota | Descrição |
|---|---|
| `GET /health` | Status do servidor e se a sessão está autenticada. |
| `GET /api/lobby/match/:matchId/:tab` | Proxy pra `gamersclub.com.br/lobby/match/:matchId/:tab` (a API JSON). |
| `GET /api/lobby/match/:matchId` | Proxy pra a página da partida (sem tab). |
| `GET /api/session/status` | Detalhes da sessão (requer `INTERNAL_API_KEY` em prod). |
| `POST /api/session/renew` | Força renovação do `cf_clearance` (requer `INTERNAL_API_KEY`). |

`GET /health` esperado:
```json
{ "status": "ok", "session": { "authenticated": true, "loggedInAt": "..." } }
```

> ⚠️ `authenticated: true` só significa que os cookies foram **injetados** — não
> garante que o GC os aceita (token pode estar expirado). A prova real é uma
> chamada a `/api/lobby/match/...` retornar JSON.

---

## 9. Operação no dia a dia

| Tarefa | Comando |
|---|---|
| Status do app | `pm2 status` |
| Logs (streaming) | `pm2 logs amigos-cs2` |
| Logs (últimas N, sem stream) | `pm2 logs amigos-cs2 --lines 50 --nostream` |
| Só erros | `pm2 logs amigos-cs2 --lines 50 --nostream --err` |
| Reiniciar | `pm2 restart amigos-cs2` |
| Logs do FlareSolverr | `docker logs -f flaresolverr` |
| Reiniciar FlareSolverr | `docker restart flaresolverr` |
| Recarregar Nginx | `nginx -t && systemctl reload nginx` |
| Ver certificados | `certbot certificates` |

**Deploy de código novo:**
```bash
cd /root/amigos-cs2/amigos-cs2-backend/backend
git pull
pm2 restart amigos-cs2
```

**Healthcheck rápido:**
```bash
curl -s https://amigos-cs2.duckdns.org/health
curl -si https://amigos-cs2.duckdns.org/api/lobby/match/27128374/1 | grep -iE "HTTP/|x-proxy-cache"
curl -si https://amigos-cs2.duckdns.org/api/lobby/match/27128374/1 | grep -iE "HTTP/|x-proxy-cache"
```
Esperado: `200`, com a 1ª chamada `x-proxy-cache: MISS` e a 2ª `HIT`.

---

## 10. Troubleshooting

| Sintoma | Causa provável | Ação |
|---|---|---|
| 500 "Erro do Gamersclub" com `pm2 env` mostrando **token velho** | PM2 cacheou o token expirado no `process.env` | Ver [`RENOVAR-TOKENS.md`](./RENOVAR-TOKENS.md): `pm2 delete` + `pm2 start` (o código já tem `override:true`). |
| 503 "Sessão inválida / não retornou JSON" | Cookies de sessão expirados, **ou** o GC devolveu HTML (rate-limit/erro) | Conferir token (RENOVAR-TOKENS.md). Se persistir, ver os 2 itens abaixo. |
| 500/HTML com `NREUM`/New Relic no body | Chamada saiu com fingerprint de não-browser (**não** pelo FlareSolverr), **ou** rate-limit do IP | Confirmar que `FLARESOLVERR_URL` está setado (prod sempre usa FlareSolverr). Testar isolado pelo solver (ver abaixo). |
| Muitos `429` no log, depois `500` | Volume de requisições alto demais pro IP | O cache (§3) reduz isso; aumentar `PROXY_CACHE_TTL`. |
| `502 erro inesperado` intermitente | Colisão de chamadas concorrentes no FlareSolverr | Já mitigado pela fila (§3.2). Conferir `docker logs flaresolverr`. |
| `connect ECONNREFUSED ::1:8191` | `.env` usa `localhost` em vez de `127.0.0.1` | `FLARESOLVERR_URL=http://127.0.0.1:8191/v1` |
| `ERR_REQUIRE_ESM` no boot | Versão errada de `tough-cookie`/`axios-cookiejar-support` (v6 é ESM) | Manter `tough-cookie@^4` e `axios-cookiejar-support@^5`. |
| "erro de CORS" no browser (mas curl 200) | `ALLOWED_ORIGIN` errado/ausente, ou com `/` no final | `.env`: `ALLOWED_ORIGIN=https://amigos-cs2-north-wind.web.app` (sem barra) + `pm2 restart`. |

**Teste isolado do FlareSolverr** (confirma se o IP/sessão estão OK, fora do app):
```bash
cd /root/amigos-cs2/amigos-cs2-backend/backend
node -e "require('dotenv').config({override:true});const a=require('axios');const u=process.env.GAMERSCLUB_BASE_URL+'/lobby/match/27128374/1';a.post(process.env.FLARESOLVERR_URL,{cmd:'request.get',url:u,maxTimeout:60000,cookies:[{name:'gclubsess',value:process.env.GCLUBSESS},{name:'gcid:accessToken',value:process.env.ACCESS_TOKEN},{name:'x-gcid:accessToken',value:process.env.X_ACCESS_TOKEN||process.env.ACCESS_TOKEN}]},{timeout:120000}).then(r=>console.log('origem:',r.data.solution.status,(r.data.solution.response||'').slice(0,120))).catch(e=>console.error(e.message))"
```
Se isso retornar `origem: 200` + `<pre>{...}`, o IP/sessão estão bons e o
problema é no app (env do PM2, cache, etc.).

---

## 11. Pendências

Itens de hardening que ainda não foram feitos (baixa prioridade):

- **UFW (firewall)** — não está ativo:
  ```bash
  ufw default deny incoming && ufw default allow outgoing
  ufw allow 22 && ufw allow 80 && ufw allow 443
  ufw enable
  ```
  (8191 e 3000 não são abertas — ficam internas.)
- **PM2 startup** — garantir auto-start no boot: `pm2 startup && pm2 save`.
- **Usuário não-root** — hoje tudo roda como `root`; criar usuário `deploy` e
  desabilitar root no SSH.
- **Remover deps legadas** — `npm uninstall firebase-admin firebase-functions`.
- **Node 18 → 22** — se atualizar, dá pra voltar `tough-cookie` e
  `axios-cookiejar-support` pras versões 6.
- **2ª instância do FlareSolverr** — se a serialização (§3.3) ficar lenta na prática.

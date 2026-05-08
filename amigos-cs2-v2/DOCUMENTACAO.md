# Documentação — Backend amigos-cs2 (proxy GamersClub)

> **Para um histórico narrativo da migração** (Firebase Functions → VPS), bugs encontrados e decisões de arquitetura, ver [`MIGRACAO.md`](./MIGRACAO.md).
>
> Este documento é a referência **operacional**: o que tem rodando, por que cada peça existe, e como manter tudo funcionando.

---

## Sumário

1. [Visão geral](#1-visão-geral)
2. [Camada 1 — Infraestrutura (VPS)](#camada-1--infraestrutura-vps)
3. [Camada 2 — Aplicação Node.js](#camada-2--aplicação-nodejs)
4. [Camada 3 — Bibliotecas (o que e por quê)](#camada-3--bibliotecas-o-que-e-por-quê)
5. [Camada 4 — Rotacionar tokens / cookies](#camada-4--rotacionar-tokens--cookies)
6. [Operação no dia a dia](#operação-no-dia-a-dia)

---

## 1. Visão geral

O sistema é um **proxy autenticado** entre o frontend (`https://amigos-cs2-north-wind.web.app`) e a API privada do GamersClub. O frontend chama o proxy; o proxy injeta cookies de uma sessão autenticada do GC e devolve a resposta.

```
[Frontend HTTPS]
       │
       ▼
[DuckDNS DNS] amigos-cs2.duckdns.org → IP da VPS
       │
       ▼
[VPS Vultr SP — Ubuntu 24.04]
       │
       ├── Nginx :443 (HTTPS, Let's Encrypt)
       │     └─ proxy_pass → 127.0.0.1:3000
       │
       ├── Express :3000 (gerenciado por PM2)
       │     ├─ injeta gclubsess + accessToken (cookies do .env)
       │     ├─ usa cf_clearance + UA do FlareSolverr
       │     └─ cron a cada 25 min renova cf_clearance
       │
       └── FlareSolverr (Docker, 127.0.0.1:8191)
             └─ resolve Cloudflare challenge a partir do IP da VPS
                       │
                       ▼
                gamersclub.com.br
```

**Stack rápida:**
- VPS: Vultr Cloud Compute, São Paulo, Ubuntu 24.04, $6/mês
- Backend: Node.js 18 + Express + axios + tough-cookie
- Anti-Cloudflare: FlareSolverr (Docker)
- Reverse proxy: Nginx
- TLS: Let's Encrypt via Certbot
- DNS: DuckDNS (subdomínio gratuito)
- Process manager: PM2

---

## Camada 1 — Infraestrutura (VPS)

### 1.1 Vultr Cloud Compute

**O que é:** servidor virtual (VPS) com IP fixo. Plano $6/mês, região São Paulo, Ubuntu 24.04.

**Por que aqui:** a Cloud Function do Firebase (us-central1) levava 403 do Cloudflare por causa do IP do GCP estar em listas de bots. Uma VPS residencial-ish brasileira passa sem problema. Vultr tem $6/mês com IP brasileiro estável.

**Acesso:** SSH como `root` (precisa criar usuário `deploy` e desabilitar root depois — pendente).

### 1.2 Docker

**O que é:** runtime de containers.

**Por que usamos:** o **FlareSolverr** roda como container Docker pré-empacotado. Sem Docker teria que rodar Chrome headless + dependências do sistema na unha. Docker isola tudo.

**Estado:** `docker run -d --name flaresolverr -p 127.0.0.1:8191:8191 ghcr.io/flaresolverr/flaresolverr:latest`

Note o **bind em 127.0.0.1** — o FlareSolverr **não** pode estar exposto na internet (qualquer um o usaria pra contornar Cloudflare). Só localhost.

### 1.3 FlareSolverr

**O que é:** servidor que sobe um Chrome headless e resolve Cloudflare challenges. Recebe uma URL via HTTP POST, retorna `cf_clearance` válido + `userAgent` que ele usou.

**Por que crítico:** o `cf_clearance` é vinculado ao par **(IP, User-Agent, possivelmente JA3)**. Como o IP da VPS muda em relação ao seu PC, o `cf_clearance` que você tem no navegador local não vale na VPS. O FlareSolverr resolve um challenge **a partir do IP da VPS**, gerando um clearance válido pra ela.

**Endpoint usado:** `POST http://127.0.0.1:8191/v1` com body `{ cmd: "request.get", url: "https://gamersclub.com.br" }`.

### 1.4 PM2

**O que é:** process manager pra Node.js — mantém o app rodando, reinicia em crash, gerencia logs.

**Por que:** sem PM2 o `node src/index.js` morre se a sessão SSH cair, ou se o processo crashear. PM2 daemoniza.

**Comandos principais:**
```bash
pm2 start src/index.js --name amigos-cs2
pm2 logs amigos-cs2          # streaming de logs
pm2 restart amigos-cs2
pm2 status
pm2 flush amigos-cs2         # limpa logs antigos
pm2 startup && pm2 save      # auto-start no boot da VPS
```

### 1.5 Nginx

**O que é:** reverse proxy / web server.

**Por que:** o Express tá em 127.0.0.1:3000 (porta interna). Quem recebe HTTPS na porta 443 e encaminha pro Express é o Nginx. Vantagens:
- Termina TLS (só ele lida com certificado)
- Adiciona headers (`X-Forwarded-For`, `X-Real-IP`)
- Permite múltiplos serviços no mesmo IP no futuro (ex: api1.duckdns.org, api2.duckdns.org)

**Config:** `/etc/nginx/sites-available/amigos-cs2` — server block que escuta `:443 ssl` e faz `proxy_pass http://127.0.0.1:3000;`.

### 1.6 Certbot + ZeroSSL (DNS-01 via DuckDNS)

**O que é:** Certbot é o cliente; ZeroSSL é a CA (Certificate Authority) que emite o certificado TLS. Originalmente o plano era usar Let's Encrypt, mas LE estava em manutenção quando emitimos, e ZeroSSL HTTP-01 estava bugado — fechamos com **ZeroSSL via desafio DNS-01**.

**Por que HTTPS:** o frontend é HTTPS (Firebase Hosting), então o backend tem que ser HTTPS também (browsers bloqueiam mixed content).

**Por que DNS-01 e não HTTP-01:** ZeroSSL não conseguia validar HTTP-01 (challenge ficava em "processing" infinitamente). DNS-01 cria um TXT record em `_acme-challenge.amigos-cs2.duckdns.org` via API do DuckDNS, ZeroSSL consulta esse DNS pra validar.

**Plugin necessário:** `certbot-dns-duckdns` (instalado com `pip3 install certbot-dns-duckdns --break-system-packages`).

**Credenciais:** `/root/.duckdns-credentials` (modo 600), uma linha: `dns_duckdns_token = <token>`.

**Renovação:** automática via `systemd timer` (`certbot.timer`). Cert dura 90 dias, renova quando faltam 30. A config de renewal em `/etc/letsencrypt/renewal/amigos-cs2.duckdns.org.conf` já guarda que tem que usar ZeroSSL+DNS-01.

**Confere com:**
```bash
systemctl list-timers | grep certbot
certbot certificates
certbot renew --dry-run    # simulação completa de renovação (recomendado rodar uma vez)
```

**Se ZeroSSL um dia também der pau** e Let's Encrypt já estiver de volta, basta editar o renewal config (`/etc/letsencrypt/renewal/amigos-cs2.duckdns.org.conf`) e remover as linhas `server = https://acme.zerossl.com/...`, `eab_kid`, `eab_hmac_key`. Aí roda `certbot renew --force-renewal` que migra pra LE.

### 1.7 DuckDNS

**O que é:** serviço que dá subdomínios gratuitos no formato `<seunome>.duckdns.org`, com DNS dinâmico.

**Por que usamos:** Let's Encrypt **não emite cert pra IP**, só pra domínio. Como você não tinha domínio próprio, DuckDNS dá um subdomínio grátis que aponta pro IP da VPS — e Let's Encrypt aceita.

**Config:** painel web em https://www.duckdns.org/. O IP é fixo (Vultr), então não precisa de cron de update — basta apontar `amigos-cs2.duckdns.org` → IP da VPS uma vez.

### 1.8 UFW (firewall) — pendente

**Estado atual:** Vultr não tem firewall ativo por padrão; UFW também não foi configurado.

**A configurar:**
```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22         # SSH
ufw allow 80         # HTTP (Certbot precisa)
ufw allow 443        # HTTPS
ufw enable
```

A porta 8191 (FlareSolverr) **não** é aberta porque o bind é em 127.0.0.1. A porta 3000 (Express) também fica interna — só o Nginx fala com ela.

---

## Camada 2 — Aplicação Node.js

### 2.1 Estrutura

```
backend/
├── src/
│   ├── index.js                # entrypoint: bootstrap + PORT
│   ├── app.js                  # Express app + middlewares + rotas
│   ├── middlewares/
│   │   └── cors.js             # CORS (libera o domínio do frontend)
│   ├── routes/
│   │   ├── proxy.js            # /api/lobby/match/* → GC
│   │   └── session.js          # /api/session/{status,renew} (debug)
│   └── services/
│       ├── auth.js             # orquestra login (cookies + flaresolverr)
│       ├── manualAuth.js       # injeta cookies do .env no jar
│       ├── flaresolverr.js     # chama FlareSolverr e persiste cf_clearance
│       ├── httpClient.js       # cliente axios + cookie jar + UA dinâmico
│       ├── cookieJar.js        # tough-cookie jar compartilhado
│       └── sessionManager.js   # cron de renovação do cf_clearance
├── .env                        # cookies + FLARESOLVERR_URL etc
└── package.json
```

### 2.2 Fluxo de boot

1. `index.js` carrega `.env`, chama `auth.initialize()`
2. `auth.login()`:
   - `manualAuth.loadManualSession()` injeta `gclubsess`, `gcid:accessToken`, `x-gcid:accessToken` no cookie jar (lendo do `.env`)
   - Se `FLARESOLVERR_URL` estiver setado:
     - `flaresolverr.refreshClearance()` chama o FlareSolverr → recebe `cf_clearance` + `userAgent`, persiste o clearance no jar
     - `httpClient.setUserAgent(userAgent)` atualiza o UA usado pelo axios
   - Marca a sessão como autenticada
3. `sessionManager.start()` agenda cron a cada 25 min pra renovar o `cf_clearance`
4. Express começa a ouvir na porta 3000

### 2.3 Fluxo de uma request

1. Frontend chama `https://amigos-cs2.duckdns.org/api/lobby/match/26866303/1`
2. Nginx termina TLS, repassa pra `http://127.0.0.1:3000/api/lobby/match/26866303/1`
3. Express → router em `proxy.js` faz `client.get('/lobby/match/26866303/1')`
4. `httpClient` (axios) anexa via interceptor:
   - `user-agent`: o UA do FlareSolverr (linha viva, atualizada por `setUserAgent`)
   - Cookies do jar (`tough-cookie`): `gclubsess`, `gcid:accessToken`, `x-gcid:accessToken`, `cf_clearance`
   - Headers fixos: `accept`, `accept-language`, `sec-fetch-*`, `referer`
5. Resposta do GC volta como JSON, é encaminhada pro frontend

### 2.4 Tratamento de 403

`proxy.js` tem retry automático: se o GC retornar 403, ele chama `sessionManager.forceRenew()` (que pede um novo `cf_clearance` ao FlareSolverr) e tenta de novo uma vez. Se o segundo tiro falhar, devolve 403 ao cliente.

---

## Camada 3 — Bibliotecas (o que e por quê)

### 3.1 Dependências de runtime

#### `express` (^5.2.1)
Framework HTTP minimalista. Usado pra rotear `/api/lobby/...`, `/api/session/...`, `/health`. Escolhido por ser o padrão do ecossistema Node e ter overhead próximo de zero.

#### `cors` (^2.8.6)
Middleware que adiciona os headers CORS necessários pro browser deixar o frontend (`amigos-cs2-north-wind.web.app`) chamar a API. Sem isso, browser bloqueia chamadas cross-origin.

#### `axios` (^1.16.0)
Cliente HTTP. Usado pra falar com a API do GC e com o FlareSolverr. Por que axios em vez de `fetch` nativo:
- Suporta cookie jar via plugin (essencial)
- Interceptors (usamos pra injetar UA dinâmico)
- API mais ergonômica pra request/response

#### `tough-cookie` (^4.1.4) ⚠ versão 4 propositalmente
Implementação do RFC 6265 (cookies HTTP). Usado pra **manter os cookies de sessão** entre requests.

**Por que v4 e não v6:** v6 é ESM-only e o VPS roda Node 18, que não suporta `require(esm)`. v4 é CommonJS e funciona em qualquer Node.

#### `axios-cookiejar-support` (^5.0.5) ⚠ versão 5 propositalmente
Bridge entre `axios` e `tough-cookie`. Sem isso, axios não sabe ler/escrever do cookie jar.

**Por que v5 e não v6:** mesmo motivo do tough-cookie — v6 é ESM-only.

#### `dotenv` (^17.4.2)
Carrega o arquivo `.env` em `process.env`. Usamos pra os cookies e configs (`FLARESOLVERR_URL`, `APP_PORT`, etc.) ficarem fora do código.

#### `node-cron` (^4.2.1)
Agenda tarefas em formato cron. Usamos pra rodar `flaresolverr.refreshClearance()` a cada 25 minutos (cf_clearance dura ~30 min).

#### `firebase-admin` / `firebase-functions` (legado)
Ficaram no `package.json` da época em que o backend rodava como Cloud Function. **Vão ser removidas** após o cutover (Fase 6 do MIGRACAO.md). Por enquanto não atrapalham porque não são `require`'d em runtime.

### 3.2 Removidas durante a migração

- **`puppeteer`** — usado antes pra fazer login automatizado por email/senha. Removido: o GC não aceita mais essa conta de email (forçou Steam OAuth).
- **`docker`** (npm package) — era dep fantasma, nunca foi usado.

### 3.3 Stack de infraestrutura

#### Docker
Roda o FlareSolverr containerizado. Sem Docker, teria que instalar Chrome + Xvfb + libs do sistema na mão.

#### FlareSolverr
Resolve Cloudflare challenges via Chrome headless. Devolve `cf_clearance` + `userAgent` válidos pro IP de quem o invocou (a VPS, no nosso caso).

#### PM2
Mantém o Node app vivo, reinicia em crash, persiste logs em `/root/.pm2/logs/`.

#### Nginx
Reverse proxy: termina TLS na :443, encaminha pro Express na :3000. Também é quem o Certbot ajusta automaticamente quando você roda `certbot --nginx`.

#### Certbot + Let's Encrypt
Cert TLS gratuito. Renovação automática via systemd timer.

#### DuckDNS
Subdomínio gratuito (`amigos-cs2.duckdns.org`). Necessário pra Let's Encrypt emitir cert (não emite pra IP).

---

## Camada 4 — Rotacionar tokens / cookies

Tem dois tipos de credenciais:

| Credencial | Onde mora | Validade | Renovação |
|---|---|---|---|
| `gclubsess`, `gcid:accessToken`, `x-gcid:accessToken` | `.env` | ~6 meses | **Manual**, via navegador |
| `cf_clearance` | gerado em runtime, em memória + cookie jar | ~30 min | **Automática** via cron do FlareSolverr |

### 4.1 Renovar cookies de sessão (a cada ~6 meses)

Quando você notar que o backend começou a retornar 401/403 mesmo com o `cf_clearance` válido, é sinal de que o `gclubsess` expirou.

**Passo 1 — Pegar cookies novos do navegador:**

1. Abre `https://gamersclub.com.br/` no Chrome e faz login (via Steam)
2. Confirma que tá logado (vê seu perfil no canto)
3. F12 → aba **Application** → **Cookies** → seleciona `https://gamersclub.com.br`
4. Anota os valores **atuais** de:
   - `gclubsess`
   - `gcid:accessToken`
   - `x-gcid:accessToken`

**Passo 2 — Atualizar o `.env` da VPS:**

```bash
ssh root@<IP_DA_VPS>
cd ~/amigos-cs2/amigos-cs2-v2/backend
nano .env
```

Atualiza as três linhas:
```
GCLUBSESS=<valor novo>
ACCESS_TOKEN=<valor novo do gcid:accessToken>
X_ACCESS_TOKEN=<valor novo do x-gcid:accessToken>
```

**Passo 3 — Reiniciar o app:**

```bash
pm2 restart amigos-cs2
pm2 logs amigos-cs2 --lines 20 --nostream
```

No log você quer ver:
```
[manual-auth] cookie "gclubsess" injetado
[manual-auth] cookie "gcid:accessToken" injetado
[manual-auth] cookie "x-gcid:accessToken" injetado
[flaresolverr] cf_clearance persistido no jar
[auth] sessão pronta (modo: manual+flaresolverr)
[server] rodando na porta 3000
```

**Passo 4 — Validar:**

```bash
curl -s https://amigos-cs2.duckdns.org/health | jq
curl -s https://amigos-cs2.duckdns.org/api/lobby/match/26866303/1 | head -c 200
```

A primeira tem que retornar `authenticated: true`. A segunda, JSON com dados da partida.

### 4.2 cf_clearance (renovação automática)

O `cf_clearance` é gerado pelo FlareSolverr e renovado **automaticamente a cada 25 minutos** (cron `*/25 * * * *` em `sessionManager.js`). Você não precisa fazer nada.

**Forçar renovação manual** (debug, ou após reiniciar FlareSolverr):

Localmente no VPS:
```bash
curl -X POST http://localhost:3000/api/session/renew
```

Em produção (com `INTERNAL_API_KEY` setado):
```bash
curl -X POST https://amigos-cs2.duckdns.org/api/session/renew \
  -H "x-api-key: <valor de INTERNAL_API_KEY>"
```

**Reiniciar o FlareSolverr** (caso ele engasgue):
```bash
docker restart flaresolverr
pm2 restart amigos-cs2   # opcional, pra forçar nova requisição
```

### 4.3 Troubleshooting de auth

| Sintoma | Provável causa | Ação |
|---|---|---|
| `health` retorna `authenticated: false` no boot | Cookies do `.env` incorretos OU FlareSolverr inacessível | `pm2 logs amigos-cs2 --lines 30` — vai dizer qual dos dois |
| 401 nas chamadas `/api/lobby/...` | `gclubsess` ou `accessToken` expirado | Rotacionar cookies (seção 4.1) |
| 403 com `cf-mitigated: challenge` | `cf_clearance` desatualizado ou mismatch de UA | `curl -X POST localhost:3000/api/session/renew` |
| `connect ECONNREFUSED ::1:8191` | FlareSolverr fora do ar OU `.env` usando `localhost` em vez de `127.0.0.1` | `docker restart flaresolverr` + checar `.env` |

---

## Operação no dia a dia

### Comandos essenciais

| Tarefa | Comando |
|---|---|
| Status do app | `pm2 status` |
| Logs do app (streaming) | `pm2 logs amigos-cs2` |
| Logs do app (últimas N linhas, sem stream) | `pm2 logs amigos-cs2 --lines 50 --nostream` |
| Reiniciar o app | `pm2 restart amigos-cs2` |
| Limpar logs antigos | `pm2 flush amigos-cs2` |
| Logs do FlareSolverr | `docker logs -f flaresolverr` |
| Reiniciar FlareSolverr | `docker restart flaresolverr` |
| Status do Nginx | `systemctl status nginx` |
| Recarregar Nginx (após editar config) | `nginx -t && systemctl reload nginx` |
| Ver certificados TLS | `certbot certificates` |
| Renovar cert (manual, normalmente é automático) | `certbot renew` |

### Healthcheck rápido (uma linha)

```bash
curl -s https://amigos-cs2.duckdns.org/health | jq
```

Saída esperada: `{ "status": "ok", "session": { "authenticated": true, "loggedInAt": "..." } }`

### Quando algo der errado

1. **Sempre comece pelos logs:** `pm2 logs amigos-cs2 --lines 50 --nostream`
2. **Olhe a tabela de troubleshooting** na seção 4.3
3. **Histórico de incidentes anteriores** está em [`MIGRACAO.md`](./MIGRACAO.md) (tabela de bugs encontrados durante a migração — bom ponto de referência se algo parecido voltar)

---

*Documento gerado em 2026-05-08 durante a migração Firebase Functions → VPS Vultr SP.*

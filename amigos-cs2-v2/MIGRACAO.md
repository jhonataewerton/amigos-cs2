# Migração: Firebase Functions → VPS Vultr SP

## Contexto

O backend é um proxy que faz requisições autenticadas à API do GamersClub para servir dados a um frontend de amigos jogando CS2.

- **Local (`npm run dev`):** funciona — IP residencial passa pelo Cloudflare e o `cf_clearance` minted no navegador é válido.
- **Firebase Functions (us-central1):** retornava `403 — cf-mitigated: challenge`.

## Diagnóstico (validado em 2026-05-08)

Não é o IP do GCP em si. O verdadeiro problema é o **`cf_clearance`**:

- O Cloudflare emite `cf_clearance` depois de um challenge resolvido
- Esse cookie é **vinculado ao par (IP, user-agent)** que resolveu o challenge
- O `cf_clearance` no `.env` foi minted no PC residencial → só vale daquele IP
- Em qualquer outro host (Firebase, VPS) ele é inválido → CF dispara novo challenge → 403

Comprovação: teste com `curl` na Vultr SP retornou `cf-mitigated: challenge` (não bloqueio duro). Após resolver via FlareSolverr e usar o cf_clearance gerado pelo solver com o user-agent dele, **GC respondeu HTTP 200 + JSON correto**.

## Decisão de arquitetura

**Modo único: cookies manuais autenticados + FlareSolverr para `cf_clearance` rotativo.**

Login automatizado por email/senha foi removido — o GamersClub não aceita mais essa conta por email (Steam OAuth obrigatório). Cookies de sessão (`gclubsess`, `gcid:accessToken`, `x-gcid:accessToken`) duram ~6 meses e são renovados manualmente pelo admin pegando do navegador.

```
[Frontend]
    │
    ▼
[VPS Vultr SP]
    ├── Express (porta 3000)
    │     └─ inject cookies do .env (gclubsess, accessToken)
    │     └─ usa cf_clearance + UA do FlareSolverr
    │
    └── FlareSolverr (Docker, 127.0.0.1:8191)
          └─ resolve CF challenge a partir do IP da VPS
          └─ devolve cf_clearance válido + userAgent
          └─ renovado a cada 25 min via cron
                    │
                    ▼
            gamersclub.com.br ✅
```

## Arquivos modificados nesta refatoração

| Arquivo | Mudança |
|---|---|
| `backend/.env` | Removido `GC_AUTH_MODE`, `GC_EMAIL`, `GC_PASSWORD`, `PUPPETEER_HEADLESS`, `GCID_BASE_URL`. Adicionado `FLARESOLVERR_URL`. Cookies mantidos. |
| `backend/src/services/cloudflare.js` | **Deletado** (Puppeteer login com email/senha) |
| `backend/src/services/manualAuth.js` | Nomes das envs corrigidos (`GCLUBSESS` etc, sem prefixo `GC_COOKIE_`). Pula injeção de `cf_clearance` quando `FLARESOLVERR_URL` setado. |
| `backend/src/services/flaresolverr.js` | Reduzido a um único `refreshClearance()` que persiste apenas `cf_clearance` (não sobrescreve `gclubsess`) e retorna `userAgent`. |
| `backend/src/services/httpClient.js` | User-agent dinâmico via `setUserAgent(ua)`. Removido `kratosClient` (não usado). |
| `backend/src/services/auth.js` | Modo único: load manual → se `FLARESOLVERR_URL` setado, pega `cf_clearance` + atualiza UA. |
| `backend/src/services/sessionManager.js` | Cron simplificado: só refresh de `cf_clearance` quando FlareSolverr está ativo. |
| `backend/package.json` | Removido `puppeteer`, `docker` (deps fantasmas). Firebase mantido temporariamente. |

## Plano de execução

### Fase 1 — VPS ✅ (provisionada)
- Vultr Cloud Compute, **São Paulo**, Ubuntu 24.04, $6/mês

### Fase 2 — Configurar servidor ✅ (parcial)
- Docker instalado
- FlareSolverr rodando em `127.0.0.1:8191`
- Falta: usuário deploy, UFW, Node 22, Nginx, PM2

### Fase 3 — Subir aplicação (próximo passo)
- `git clone` (ou `scp`) do código
- `npm ci --omit=dev`
- Copiar `.env` da máquina local para a VPS
- **Editar na VPS:** setar `FLARESOLVERR_URL=http://localhost:8191/v1`
- `pm2 start src/index.js --name amigos-cs2`

### Fase 4 — Validação ✅ (2026-05-08)
- `curl http://localhost:3000/health` → `{ status: "ok", session: { authenticated: true, mode: "manual+flaresolverr" } }` ✅
- `curl http://localhost:3000/api/lobby/match/26866303/1` → JSON ✅

**Bugs encontrados e corrigidos durante a Fase 4:**

| Bug | Sintoma | Causa | Fix |
|---|---|---|---|
| ESM-only deps | `ERR_REQUIRE_ESM` no boot | `tough-cookie@6` e `axios-cookiejar-support@6` viraram ESM. Node 18 (no VPS) não suporta `require(esm)` | Downgrade pra `tough-cookie@^4.1.4` e `axios-cookiejar-support@^5.0.5` |
| `localhost` → IPv6 | `connect ECONNREFUSED ::1:8191` | Node 18 resolve `localhost` pra `::1` (IPv6), FlareSolverr bind só em `127.0.0.1` | `.env`: `FLARESOLVERR_URL=http://127.0.0.1:8191/v1` |
| `/v1` duplicado | 404 do FlareSolverr | Código fazia `axios.post(\`${solver}/v1\`, ...)` enquanto `.env` já incluía `/v1` | `flaresolverr.js`: `axios.post(solver, ...)` (sem suffix) |
| `cf_clearance` não saía nas requests | 403 mesmo com sessão "ok" | Solver retorna `domain: ".gamersclub.com.br"` (com ponto). Combinado com `hostOnly:true` no `tough-cookie@4`, o cookie ficava armazenado mas não matchava no envio | `flaresolverr.js`: `domain: new URL(GC_URL()).hostname` (hostname puro, sem ponto) |
| `setUserAgent` sem efeito | UA padrão (Windows Chrome) saía nas requests, mismatch com cf_clearance (Linux Chrome) | Override de `client.defaults.headers['user-agent']` em axios 1.x não pega de forma confiável | `httpClient.js`: variável `currentUserAgent` + request interceptor que sobrescreve o header em toda request |

**Versão Node no VPS:** Node 18.19.1 (Ubuntu 24.04 default). O `package.json` declara `engines: { node: "22" }` mas funciona em 18 com os deps downgradados. Upgrade pra Node 22 é opcional — se for feito, dá pra reverter os deps pras versões 6.

### Fase 5 — Domínio + HTTPS ✅ (2026-05-08)

- Subdomínio: **`amigos-cs2.duckdns.org`** (gratuito, IP da Vultr SP)
- Reverse proxy: Nginx em `/etc/nginx/sites-available/amigos-cs2`
- Cert TLS: válido até **2026-08-06**, renovação automática via `certbot.timer`
- Redirect HTTP→HTTPS via 301

**Provedor de cert e método (não foi pelo Let's Encrypt):**
- Let's Encrypt estava em manutenção (HTTP 503) durante toda a sessão
- ZeroSSL HTTP-01 ficou travado em "processing" (provável bug deles, `Retry-After: 86400`)
- **Solução final: ZeroSSL via DNS-01** + plugin `certbot-dns-duckdns`
  - Plugin instalado: `pip3 install certbot-dns-duckdns --break-system-packages`
  - Credenciais DuckDNS em `/root/.duckdns-credentials` (modo 600)
  - Renewal config salvo em `/etc/letsencrypt/renewal/amigos-cs2.duckdns.org.conf`

Quando renovar manualmente (caso a renovação automática falhe):
```bash
certbot renew
```
Vai usar a mesma config (DNS-01 via DuckDNS).

### Fase 6 — Cutover
- Atualizar base URL no frontend
- Desativar a Cloud Function

## Plano C — Se o FlareSolverr parar de resolver no futuro

Se o Cloudflare fortalecer e o FlareSolverr não der conta:

1. **`cycletls`** ou **`curl-impersonate`** no lugar do axios — clona o handshake TLS do Chrome real (resolve detecção JA3/JA4)
2. **Proxy residencial** (IPRoyal pay-as-you-go ~$1.75/GB) — IP "limpo" e residencial brasileiro
3. **Combinação dos dois** — solução mais robusta e mais cara

Custo estimado plano C: ~$3-10/mês de proxy residencial pra o volume de uso pessoal.

## Renovação dos cookies (a cada ~6 meses)

1. Login normal em `https://gamersclub.com.br/` (via Steam) no Chrome
2. F12 → Application → Cookies → `https://gamersclub.com.br`
3. Copiar valores **atuais** de:
   - `gclubsess`
   - `gcid:accessToken`
   - `x-gcid:accessToken`
4. Atualizar `.env` local (e `.env` na VPS via `nano`)
5. `pm2 restart amigos-cs2`

O `cf_clearance` no `.env` é só pra dev local; em produção quem renova é o cron do FlareSolverr.

## Operação na VPS

| Tarefa | Comando |
|---|---|
| Ver logs | `pm2 logs amigos-cs2` |
| Reiniciar app | `pm2 restart amigos-cs2` |
| Status app | `pm2 status` |
| Ver logs do FlareSolverr | `docker logs -f flaresolverr` |
| Reiniciar FlareSolverr | `docker restart flaresolverr` |
| Editar `.env` | `nano backend/.env && pm2 restart amigos-cs2` |
| Renovar cf_clearance manualmente | `curl -X POST http://localhost:3000/api/session/renew` |

## Custos

| Item | Custo/mês |
|---|---|
| Vultr SP $6 | ~R$33 |
| Domínio `.click`/`.xyz` | ~R$1 |
| **Total** | **~R$34/mês** |

Alternativa mais barata pós-cutover: migrar pra Hostinger VPS BR (~R$25/mês) — mesma estratégia funciona lá.

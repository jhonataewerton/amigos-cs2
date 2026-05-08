# Próxima sessão — Retomar Fase 5 (HTTPS)

> Status em **2026-05-08 ~19:50** — Let's Encrypt fora do ar pra manutenção, parado no **Passo 6** (rodar Certbot). Quando o serviço voltar, retomar daqui.

---

## TL;DR

```bash
# 1. checar se Let's Encrypt voltou
curl -sI https://acme-v02.api.letsencrypt.org/directory | head -1
# se vier "HTTP/2 200" pode prosseguir

# 2. rodar Certbot (passo 6)
ssh root@<IP_DA_VPS>
certbot --nginx -d amigos-cs2.duckdns.org --redirect --agree-tos --no-eff-email -m jhonata.as@hotmail.com

# 3. testar HTTPS (passo 7)
curl -i https://amigos-cs2.duckdns.org/health
curl -i http://amigos-cs2.duckdns.org/health   # tem que dar 301/308 redirect
```

Se os dois `curl` derem certo → Fase 5 ✅, partir pra Fase 6 (frontend + cutover).

---

## O que já está feito ✅

### Fase 1-3: VPS + backend deployado
- VPS Vultr SP, Ubuntu 24.04, $6/mês — provisionada
- Docker + FlareSolverr (Docker, bind 127.0.0.1:8191)
- Node 18 + PM2 — `pm2 status` mostra `amigos-cs2` online
- Backend rodando em `127.0.0.1:3000`, autenticando via cookies do `.env` + cf_clearance do FlareSolverr

### Fase 4: validação ✅
- `curl localhost:3000/health` → `authenticated: true`
- `curl localhost:3000/api/lobby/match/26866303/1` → JSON correto
- 5 bugs encontrados e corrigidos (ver tabela em [`MIGRACAO.md`](./MIGRACAO.md))

### Fase 5: parcial — HTTP funcionando, HTTPS pendente
- DuckDNS configurado: `amigos-cs2.duckdns.org` → IP da VPS ✅
- Nginx instalado e configurado como reverse proxy ✅
  - Config em `/etc/nginx/sites-available/amigos-cs2`
  - `proxy_pass http://127.0.0.1:3000`
- `curl http://amigos-cs2.duckdns.org/health` → `200 OK` com JSON ✅
- **Certbot/Let's Encrypt — falhou** com erro "service is down for maintenance"

---

## O que falta

### Passo 6 — Certbot (HTTPS) ⏸ aguardando Let's Encrypt voltar

```bash
certbot --nginx -d amigos-cs2.duckdns.org --redirect --agree-tos --no-eff-email -m jhonata.as@hotmail.com
```

Esse comando:
- Pega cert do Let's Encrypt
- Edita `/etc/nginx/sites-available/amigos-cs2` automaticamente pra adicionar `:443 ssl`
- Adiciona redirect HTTP→HTTPS (`--redirect`)
- Recarrega o nginx

Renovação automática já vem ativa via `certbot.timer` no Ubuntu 24.

**Plano B se Let's Encrypt seguir fora**: usar **ZeroSSL** como ACME alternativo. Detalhes na conversa anterior, mas requer signup em `app.zerossl.com/developer` pra pegar EAB credentials.

### Passo 7 — Validar HTTPS

```bash
# tem que voltar HTTP/2 200 com JSON
curl -i https://amigos-cs2.duckdns.org/health

# tem que voltar 301 ou 308 (redirect)
curl -i http://amigos-cs2.duckdns.org/health

# fim a fim
curl -s https://amigos-cs2.duckdns.org/api/lobby/match/26866303/1 | head -c 300
```

### Passo 8 — Ajustar frontend (Fase 6)

Trocar a base URL da API no Angular. Hoje aponta pra Cloud Function (us-central1); precisa apontar pra `https://amigos-cs2.duckdns.org/api`.

Provável arquivo: `environments/environment.prod.ts` (ou similar). Verificar repo do frontend (não está nesse working directory).

Build + deploy do frontend (`firebase deploy --only hosting`).

### Passo 9 — Smoke test completo

Abrir `https://amigos-cs2-north-wind.web.app` no browser, abrir DevTools → Network, navegar pra uma partida. As chamadas devem ir pra `amigos-cs2.duckdns.org` e retornar 200.

### Passo 10 — Desativar Cloud Function

Só depois que o frontend estiver 100% usando a VPS por pelo menos 24h (margem pra rollback se der ruim).

```bash
firebase functions:delete <nome-da-function> --region us-central1
```

E remover `firebase-admin` + `firebase-functions` do `package.json` do backend (não são mais usados).

---

## Pendências secundárias (low prio, dá pra deixar pra depois)

- **UFW** — firewall não está ativo. Configurar:
  ```bash
  ufw default deny incoming
  ufw allow 22 && ufw allow 80 && ufw allow 443
  ufw enable
  ```
  (porta 8191 fica fechada, pois FlareSolverr está em 127.0.0.1)

- **PM2 startup** — pra app subir sozinho se a VPS reiniciar:
  ```bash
  pm2 startup
  pm2 save
  ```

- **Usuário não-root** — hoje tudo roda como root no VPS. Criar usuário `deploy`, mover o app pra ele, desabilitar root SSH.

- **Upgrade Node 18 → 22** — opcional. Se for feito, dá pra reverter `tough-cookie` e `axios-cookiejar-support` pras versões 6 (mais novas).

---

## Onde olhar quando algo der errado

1. **Logs do app**: `pm2 logs amigos-cs2 --lines 50 --nostream`
2. **Logs do FlareSolverr**: `docker logs -f flaresolverr`
3. **Logs do Nginx**: `tail -f /var/log/nginx/error.log`
4. **Status Let's Encrypt**: https://letsencrypt.status.io/
5. **Tabela de troubleshooting**: [`DOCUMENTACAO.md`](./DOCUMENTACAO.md), seção 4.3
6. **Histórico de bugs já vistos**: [`MIGRACAO.md`](./MIGRACAO.md)

---

## Comando único pra testar tudo (depois do certbot rodar)

```bash
echo "== HTTPS health ==" && curl -sI https://amigos-cs2.duckdns.org/health | head -3 && \
echo "== HTTP redirect ==" && curl -sI http://amigos-cs2.duckdns.org/health | head -3 && \
echo "== JSON =="          && curl -s https://amigos-cs2.duckdns.org/api/lobby/match/26866303/1 | head -c 200 && echo
```

Se os 3 blocos vierem ok → HTTPS funcionando, Fase 5 ✅.

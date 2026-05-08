# Próxima sessão — Fase 6 (cutover do frontend)

> Status em **2026-05-08 ~20:45** — Fase 5 ✅ completa (HTTPS rodando em `https://amigos-cs2.duckdns.org`). Próxima sessão: ajustar o frontend e desativar a Cloud Function.

---

## TL;DR

```bash
# verificação rápida pra confirmar que o backend ainda tá saudável
curl -sI https://amigos-cs2.duckdns.org/health
curl -s https://amigos-cs2.duckdns.org/api/lobby/match/26866303/1 | head -c 100
```

Se os dois funcionarem, partir pra ajuste do frontend (passos 8-10 abaixo).

---

## O que já está feito ✅

### Fase 1-4 ✅ — VPS + backend funcionando
Detalhes em [`MIGRACAO.md`](./MIGRACAO.md).

### Fase 5 ✅ — Domínio + HTTPS (concluída em 2026-05-08)
- DuckDNS: `amigos-cs2.duckdns.org` → IP da VPS
- Nginx reverse proxy configurado em `/etc/nginx/sites-available/amigos-cs2`
- Cert TLS válido até **2026-08-06** (renovação automática)
- Redirect HTTP→HTTPS via 301

**Detalhes não-óbvios da emissão do cert:**
- Let's Encrypt estava em manutenção (503) durante a sessão → tivemos que ir pra ZeroSSL
- ZeroSSL HTTP-01 ficou travado em "processing" → tivemos que ir pra DNS-01
- DNS-01 funcionou via plugin `certbot-dns-duckdns` (instalado com `pip3 install certbot-dns-duckdns --break-system-packages`)
- Credenciais DuckDNS guardadas em `/root/.duckdns-credentials` (modo 600)
- Configuração de renewal salva pelo certbot em `/etc/letsencrypt/renewal/amigos-cs2.duckdns.org.conf` — vai usar o mesmo método (DNS-01 + ZeroSSL) pra renovar

---

## Fase 6 — Cutover (próximos passos)

### Passo 8 — Ajustar URL da API no frontend

O frontend Angular hoje aponta pra Cloud Function (`us-central1`). Precisa apontar pra `https://amigos-cs2.duckdns.org/api`.

Provável arquivo: `environments/environment.prod.ts` (e talvez `environment.ts` pra dev). Procurar a constante de base URL — algo tipo `apiBaseUrl`, `gcProxyUrl`, ou similar.

**O frontend Angular não está nesse working directory** — precisa abrir o repo do frontend.

Comando útil pra encontrar:
```bash
# no repo do frontend
grep -r "cloudfunctions.net\|us-central1\|firebase" src/
```

Substituir a base URL e fazer build + deploy:
```bash
ng build --configuration production
firebase deploy --only hosting
```

### Passo 9 — Smoke test no browser

Abre `https://amigos-cs2-north-wind.web.app` no Chrome:
1. F12 → Network
2. Navega numa partida ou tela que use a API
3. Verifica que as chamadas vão pra `amigos-cs2.duckdns.org` e retornam 200

Se aparecer **CORS error**, o backend tem `ALLOWED_ORIGIN=https://amigos-cs2-north-wind.web.app` no `.env` da VPS — confere se bate. Se o frontend for migrado pra outro domínio (ex: domínio próprio mais tarde), precisa atualizar `ALLOWED_ORIGIN` e `pm2 restart amigos-cs2`.

### Passo 10 — Desativar a Cloud Function (24h+ depois do cutover)

Só depois que o frontend estiver 100% usando a VPS por pelo menos um dia inteiro (margem pra rollback se algo der ruim em prod).

```bash
# lista as functions ativas
firebase functions:list

# deleta a function do proxy (substituir <nome> pelo que aparecer no list)
firebase functions:delete <nome> --region us-central1
```

Depois, no `package.json` do backend, remover deps não usadas:
```bash
cd ~/amigos-cs2/amigos-cs2-v2/backend  # ou local
npm uninstall firebase-admin firebase-functions
```

Remover scripts de Firebase do `package.json`:
```json
// remover:
"serve": "firebase emulators:start --only functions",
"deploy": "firebase deploy --only functions"
```

---

## Pendências secundárias (low prio, dá pra deixar pra depois)

Mantidas da sessão anterior:

- **UFW firewall** — não está ativo. Configurar:
  ```bash
  ufw default deny incoming
  ufw allow 22 && ufw allow 80 && ufw allow 443
  ufw enable
  ```

- **PM2 startup** — pra app subir sozinho se a VPS reiniciar:
  ```bash
  pm2 startup
  pm2 save
  ```

- **Usuário não-root** — hoje tudo roda como root no VPS. Criar usuário `deploy`, mover o app pra ele, desabilitar root SSH.

- **Upgrade Node 18 → 22** — opcional. Se for feito, dá pra reverter `tough-cookie` e `axios-cookiejar-support` pras versões 6.

- **DuckDNS auto-update IP** — desnecessário hoje (Vultr tem IP fixo), mas se um dia migrar pra um host com IP dinâmico, precisa rodar um cron que bate em `https://www.duckdns.org/update?domains=amigos-cs2&token=<TOKEN>` periodicamente.

---

## Onde olhar quando algo der errado

1. **Logs do app**: `pm2 logs amigos-cs2 --lines 50 --nostream`
2. **Logs do FlareSolverr**: `docker logs -f flaresolverr`
3. **Logs do Nginx**: `tail -f /var/log/nginx/error.log`
4. **Status do cert**: `certbot certificates`
5. **Tabela de troubleshooting**: [`DOCUMENTACAO.md`](./DOCUMENTACAO.md), seção 4.3
6. **Histórico de bugs**: [`MIGRACAO.md`](./MIGRACAO.md)

---

## Healthcheck rápido

```bash
echo "== HTTPS health ==" && curl -sI https://amigos-cs2.duckdns.org/health | head -3 && \
echo "== HTTP redirect ==" && curl -sI http://amigos-cs2.duckdns.org/health | head -3 && \
echo "== JSON =="          && curl -s https://amigos-cs2.duckdns.org/api/lobby/match/26866303/1 | head -c 100 && echo
```

Esperado:
- HTTPS health: `HTTP/2 200`
- HTTP redirect: `HTTP/1.1 301`
- JSON: `{"success":true,"message":null,"id":"26866303",...`

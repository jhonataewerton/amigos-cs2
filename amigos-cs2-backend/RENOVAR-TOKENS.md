# Como renovar os tokens de sessão do GamersClub

Os cookies de sessão do GC (`gclubsess`, `gcid:accessToken`, `x-gcid:accessToken`)
duram **~6 meses**. Quando expiram, o backend passa a falhar — tipicamente com
**500 "Erro do Gamersclub"** ou **503 "sessão inválida"**.

> ⚠️ **A pegadinha do PM2:** editar o `.env` e dar `pm2 restart` **pode não
> atualizar o token** — o PM2 preserva o `process.env` entre restarts. O código já
> contorna isso (`dotenv ... { override: true }`), mas se algo der errado, o
> **passo 5** mostra como garantir/diagnosticar.

---

## Quando renovar

Sinais de que o token expirou:
- `/api/lobby/match/...` retorna **500** ou **503** de forma consistente.
- No log (`pm2 logs amigos-cs2 --lines 30 --nostream --err`) aparece
  `sessão inválida` ou `Erro 500 do Gamersclub`.
- O **teste isolado do FlareSolverr** (seção Troubleshooting da
  [`DOCUMENTACAO.md`](./DOCUMENTACAO.md)) volta HTML em vez de JSON.

Pra ter certeza de que é o token (e não outra coisa), **decodifique o `exp`** do
token que está no `.env`:
```bash
cd /root/amigos-cs2/amigos-cs2-backend/backend
node -e "require('dotenv').config({override:true});const t=process.env.ACCESS_TOKEN;const p=JSON.parse(Buffer.from(t.split('.')[1],'base64url'));console.log('expira:',new Date(p.exp*1000).toISOString(),'| agora:',new Date().toISOString())"
```
Se `expira` estiver no passado → token vencido, siga abaixo.

---

## Passo 1 — Pegar cookies novos no navegador

1. Abra `https://gamersclub.com.br/` no Chrome e faça login (via Steam).
2. Confirme que está logado (seu perfil aparece no canto).
3. `F12` → aba **Application** → **Cookies** → selecione `https://gamersclub.com.br`.
4. Copie os valores **atuais** de:
   - `gclubsess`
   - `gcid:accessToken` (token opaco)
   - `x-gcid:accessToken` (JWT, começa com `eyJ...` — **valor diferente** do anterior)

---

## Passo 2 — Atualizar o `.env` da VPS

```bash
ssh root@<IP_DA_VPS>
cd /root/amigos-cs2/amigos-cs2-backend/backend
nano .env
```

Atualize as três linhas:
```env
GCLUBSESS=<valor novo de gclubsess>
ACCESS_TOKEN=<valor novo de gcid:accessToken>
X_ACCESS_TOKEN=<valor novo de x-gcid:accessToken>
```

> 💡 JWT é uma string longa. Colar no `nano` via SSH às vezes quebra a linha. Se
> tiver dúvida, edite pelo VS Code (Remote-SSH) ou use `sed`:
> ```bash
> sed -i "s|^ACCESS_TOKEN=.*|ACCESS_TOKEN=COLE_AQUI|" .env
> ```
> Cada valor tem que ficar **em uma única linha**, sem espaços ou quebras.

---

## Passo 3 — Reiniciar o app

Com o `override: true` no código, um restart normal já basta:
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

---

## Passo 4 — Validar

```bash
# confirma o token carregado em runtime (tem que mostrar o gclubsess NOVO):
node -e "require('dotenv').config({override:true});console.log(process.env.GCLUBSESS)"

# teste de fogo:
curl -si https://amigos-cs2.duckdns.org/api/lobby/match/27128374/1 | grep -iE "HTTP/|x-proxy-cache"
curl -si https://amigos-cs2.duckdns.org/api/lobby/match/27128374/1 | grep -iE "HTTP/|x-proxy-cache"
```
Esperado: `HTTP/2 200`, com a 1ª `x-proxy-cache: MISS` e a 2ª `HIT`.

> O cache guarda respostas antigas. Se quiser forçar uma busca nova, o
> `pm2 restart` do passo 3 já zera o cache (é em memória).

---

## Passo 5 — Se o token **não** atualizar (a pegadinha do PM2)

Se mesmo após o passo 3 o app continuar falhando, verifique o que o **PM2** está
injetando no processo:
```bash
pm2 env 0 | grep -E "GCLUBSESS|ACCESS_TOKEN"
```

- **Mostra o valor NOVO** (ou nada) → ok, o `dotenv` está mandando; o problema é
  outro (veja a [`DOCUMENTACAO.md`](./DOCUMENTACAO.md) §10).
- **Mostra o valor VELHO** → o PM2 cacheou o env antigo. Suba o processo **do
  zero** (não apenas restart):

```bash
cd /root/amigos-cs2/amigos-cs2-backend/backend
pm2 delete amigos-cs2
pm2 start src/index.js --name amigos-cs2
pm2 save
```

Depois repita o **passo 4**. Um start limpo descarta o `process.env` cacheado e o
`dotenv` lê o `.env` atual.

---

## Por que isso acontece (resumo)

- O PM2 **persiste o `process.env`** de um processo entre `restart`s.
- O `dotenv`, por padrão, **não sobrescreve** uma variável que já existe no
  `process.env` — então o token carregado no 1º start "gruda".
- A correção permanente já está no código: `require('dotenv').config({ override: true })`
  em `src/index.js` e `index.js`. Com isso, o arquivo **sempre vence**.
- O `pm2 delete` + `pm2 start` é o método garantido caso algo ainda escape.

Sobre o `cf_clearance`: esse é **automático** (gerado pelo FlareSolverr no boot e
a cada 25 min). Você **não** precisa renovar manualmente — só os três cookies de
sessão acima.

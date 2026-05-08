# Plano — Backend Node.js para Proxy do Gamersclub

## Contexto

O frontend Angular (`amigos-cs2-north-wind.web.app`) estava consumindo a API do Gamersclub diretamente.
Esse acesso parou de funcionar por duas razões combinadas:

1. **CORS** — o servidor do Gamersclub bloqueia requisições com `origin` externo
2. **Cloudflare** — proteção anti-bot que exige cookies de sessão gerados por um browser real (`cf_clearance`, `gclubsess`, tokens JWT)

A solução é criar um backend Node.js que atue como proxy, aparecendo para o Gamersclub como uma requisição `same-origin` com os cookies corretos.

## Fases

| Fase | Arquivo | Descrição |
|------|---------|-----------|
| 1 | [fase-1-proxy-basico.md](./fase-1-proxy-basico.md) | Estrutura do projeto + proxy Express básico |
| 2 | [fase-2-autenticacao.md](./fase-2-autenticacao.md) | Login, sessão e renovação de JWT |
| 3 | [fase-3-cloudflare.md](./fase-3-cloudflare.md) | Bypass do Cloudflare com Puppeteer/Stealth |
| 4 | [fase-4-integracao-frontend.md](./fase-4-integracao-frontend.md) | Adaptar o Angular para consumir o backend |

## Stack

```
Node.js 20+
Express.js              — servidor HTTP
axios                   — cliente HTTP
axios-cookiejar-support — persiste cookies entre requisições
tough-cookie            — gerenciamento de cookie jar
puppeteer               — browser headless
puppeteer-extra         — extensões para o puppeteer
puppeteer-extra-plugin-stealth — evita detecção de bot
node-cron               — agendamento de renovação de sessão
dotenv                  — variáveis de ambiente
```

## Fluxo Geral

```
Angular Frontend
      │
      │  HTTP (sem CORS, mesma origem ou CORS liberado só pro próprio frontend)
      ▼
Node.js Backend (proxy)
      │
      │  Requisição simulando same-origin + cookies válidos
      ▼
gamersclub.com.br API
```

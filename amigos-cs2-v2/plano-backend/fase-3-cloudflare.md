# Fase 3 — Bypass do Cloudflare

## Objetivo

Obter e renovar o cookie `cf_clearance` automaticamente, que é gerado pelo Cloudflare após um challenge resolvido por browser real. Sem ele, mesmo com autenticação válida, a API retorna 403.

## Como o `cf_clearance` Funciona

1. Cloudflare intercepta a requisição e serve um challenge (JS challenge, Turnstile, etc.)
2. O browser executa o challenge e prova que é humano
3. Cloudflare emite o cookie `cf_clearance` (atrelado ao IP + user-agent)
4. Requisições subsequentes com esse cookie passam direto, sem challenge

**Duração:** ~30 minutos por padrão, mas pode variar conforme configuração do site.

## Estratégia: Puppeteer com Stealth Plugin

Abrir um Chromium headless que parece um browser real, navegar para o Gamersclub uma vez para resolver o challenge, extrair o `cf_clearance` e injetar no `CookieJar` do axios.

### Por que não FlareSolverr?

FlareSolverr é uma opção válida (container Docker), mas adiciona uma dependência externa. Usar Puppeteer diretamente mantém tudo dentro do mesmo processo Node.js e facilita o deploy.

## Passos

### 3.1 — Instalar dependências

```bash
npm install puppeteer puppeteer-extra puppeteer-extra-plugin-stealth
```

### 3.2 — Serviço do Cloudflare (`src/services/cloudflare.js`)

- Função `getClearanceCookie()`:
  1. Abre o Puppeteer com `stealth` ativado
  2. Navega para `https://gamersclub.com.br/lobby`
  3. Aguarda o challenge ser resolvido (detectar quando `cf_clearance` aparecer nos cookies do browser)
  4. Extrai `cf_clearance` e `__cf_bm` dos cookies do Puppeteer
  5. Injeta esses cookies no `CookieJar` do axios
  6. Fecha o browser
- Timeout de segurança: 30 segundos — se não resolver, logar erro e tentar de novo

### 3.3 — Configurações do Puppeteer para não ser detectado

```js
// Usar mesmo user-agent das requisições axios
// Desativar headless se o challenge exigir interação visual (modo headed temporário)
// Definir viewport realista: 1920x1080
// Passar --no-sandbox em ambientes Linux/Docker
```

### 3.4 — Integrar com o SessionManager (`src/services/sessionManager.js`)

- No fluxo de inicialização, resolver o Cloudflare **antes** de autenticar
- Adicionar verificação no cron: se uma requisição retornar 403, acionar `getClearanceCookie()` e repetir

### 3.5 — Detecção de 403 nas rotas do proxy

- No `src/routes/proxy.js`, interceptar respostas 403 do Gamersclub
- Acionar renovação do `cf_clearance` automaticamente
- Fazer retry da requisição original uma vez após renovar

### 3.6 — Variáveis de ambiente adicionais (`.env`)

```env
PUPPETEER_HEADLESS=true          # false para debugar visualmente
CF_CLEARANCE_TTL_MINUTES=25      # renovar antes de expirar (margem de segurança)
```

## Fluxo Completo com Cloudflare

```
Servidor sobe
     │
     ▼
Puppeteer abre gamersclub.com.br
     │
     ▼
Cloudflare challenge resolvido → cf_clearance extraído
     │
     ▼
CookieJar recebe cf_clearance
     │
     ▼
Login (Fase 2) → gclubsess + JWT
     │
     ▼
Proxy pronto para requisições
     │
     ▼
node-cron renova cf_clearance a cada 25min
```

## Casos de Borda

| Situação | Comportamento |
|----------|--------------|
| Challenge visual (não headless) | Rodar `PUPPETEER_HEADLESS=false` para resolver manualmente uma vez, salvar os cookies |
| IP bloqueado permanentemente | Trocar IP do servidor (Cloudflare pode banir IPs de datacenter conhecidos) |
| `cf_clearance` inválido por mudança de IP | Renovar imediatamente ao detectar 403 |

## Critério de Conclusão

- `GET /api/lobby/match/:matchId/:tab` retorna 200 consistentemente
- O `cf_clearance` é renovado automaticamente antes de expirar
- Um 403 inesperado aciona renovação automática + retry transparente para o frontend

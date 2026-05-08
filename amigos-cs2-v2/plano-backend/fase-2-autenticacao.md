# Fase 2 — Autenticação e Gerenciamento de Sessão

## Objetivo

Fazer o backend autenticar no Gamersclub e persistir os cookies de sessão (`gclubsess`, `gcid:accessToken`, `x-gcid:accessToken`) para que todas as requisições do proxy já saiam autenticadas.

## Contexto dos Cookies de Autenticação

| Cookie | Função | Duração aproximada |
|--------|--------|--------------------|
| `gclubsess` | Sessão do servidor (PHP/Laravel session) | Enquanto ativo |
| `gcid:accessToken` | JWT de autenticação do usuário | ~7 dias (verificar `exp` no payload) |
| `x-gcid:accessToken` | Cópia do JWT (enviada em header paralelo) | Mesma do anterior |

## Passos

### 2.1 — Serviço de autenticação (`src/services/auth.js`)

- Função `login(email, password)`:
  - Faz `POST` para o endpoint de login do Gamersclub
  - O `CookieJar` do axios captura automaticamente os cookies `Set-Cookie` da resposta
  - Salva os cookies em memória (e opcionalmente em arquivo `.session.json` para sobreviver a restarts)
- Função `isAuthenticated()`:
  - Verifica se o JWT armazenado ainda é válido decodificando o `exp`
  - Retorna `false` se expirado ou ausente

### 2.2 — Renovação automática de sessão (`src/services/sessionManager.js`)

- Usar `node-cron` para checar a validade do token a cada 30 minutos
- Se expirado, chamar `login()` automaticamente com as credenciais do `.env`
- Logar o resultado da renovação (sucesso ou falha)

```
npm install node-cron
```

### 2.3 — Variáveis de ambiente adicionais (`.env`)

```env
GC_EMAIL=seu-email@exemplo.com
GC_PASSWORD=sua-senha
SESSION_FILE=.session.json   # opcional, para persistência em disco
```

### 2.4 — Inicialização do backend

- No `src/index.js`, antes de subir o servidor:
  1. Tentar carregar sessão do disco (`.session.json`)
  2. Se não existir ou estiver expirada, fazer login
  3. Só então registrar as rotas e subir o servidor

### 2.5 — Rota de status da sessão (dev only)

- `GET /api/session/status`
  - Retorna se autenticado, o `exp` do JWT e quando será renovado
  - Proteger com um `API_KEY` interno para não expor em produção

## Fluxo de Sessão

```
Servidor sobe
     │
     ▼
Carrega .session.json ──existe e válido──► usa sessão salva
     │
     │ não existe / expirado
     ▼
POST /login → Gamersclub
     │
     ▼
CookieJar recebe gclubsess + JWT
     │
     ▼
Salva em .session.json
     │
     ▼
node-cron verifica a cada 30min → renova se necessário
```

## Critério de Conclusão

- Backend autentica automaticamente ao subir
- Todas as requisições do proxy saem com os cookies de sessão válidos
- A sessão é renovada automaticamente sem intervenção manual
- Restart do servidor reutiliza sessão salva em disco (sem precisar logar de novo)

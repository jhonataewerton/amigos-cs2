const { Router } = require('express');
const { client } = require('../services/httpClient');
const { forceRenew } = require('../services/sessionManager');
const flaresolverr = require('../services/flaresolverr');

const GC_URL = () => process.env.GAMERSCLUB_BASE_URL || 'https://gamersclub.com.br';
const USE_FLARE = () => !!process.env.FLARESOLVERR_URL;
const router = Router();

// Cache em memória das partidas já buscadas. Serve daqui em vez de bater no GC
// de novo — reduz o volume (causa dos 429 → 500) e esconde a latência do Chrome
// do FlareSolverr nas chamadas repetidas. TTL em segundos via PROXY_CACHE_TTL
// (default 300 = 5 min). Partida finalizada não muda, então TTL generoso é seguro.
const CACHE_TTL_MS = (Number(process.env.PROXY_CACHE_TTL) || 300) * 1000;
const CACHE_MAX_ENTRIES = Number(process.env.PROXY_CACHE_MAX) || 500;
const cache = new Map(); // path -> { data, status, expiresAt }

function readCache(path) {
  return cache.get(path) || null;
}

function writeCache(path, data, status) {
  // Evita crescimento ilimitado: remove a entrada mais antiga ao estourar o teto.
  if (cache.size >= CACHE_MAX_ENTRIES && !cache.has(path)) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(path, { data, status, expiresAt: Date.now() + CACHE_TTL_MS });
}

// Busca o upstream. Em produção usa o FlareSolverr (Chrome real — fingerprint de
// browser, evita o 500 que o GC devolve pro fingerprint TLS do axios/Node). Em
// dev (sem FLARESOLVERR_URL) cai no axios + cookie jar.
// Retorna { status, data, isHtml } com status = HTTP real da origem do GC.
async function fetchUpstream(path, headers) {
  if (USE_FLARE()) {
    const { status, data, isJson } = await flaresolverr.fetchJson(`${GC_URL()}${path}`);
    return { status, data, isHtml: !isJson };
  }
  const response = await client.get(path, { headers });
  const contentType = response.headers['content-type'] || '';
  return { status: response.status, data: response.data, isHtml: contentType.includes('text/html') };
}

async function proxyGet(path, res, { referer } = {}) {
  const headers = referer ? { referer: `${GC_URL()}${referer}` } : {};
  const cached = readCache(path);

  // Cache fresco → responde sem tocar no GC.
  if (cached && Date.now() < cached.expiresAt) {
    res.set('x-proxy-cache', 'HIT');
    return res.status(cached.status).json(cached.data);
  }

  let result;
  try {
    result = await fetchUpstream(path, headers);

    // 403 só acontece no caminho axios (cf_clearance/UA). Renova e tenta 1x.
    if (result.status === 403 && !USE_FLARE()) {
      console.warn(`[proxy] 403 em ${path} — renovando sessão e tentando novamente...`);
      await forceRenew();
      result = await fetchUpstream(path, headers);
    }
  } catch (error) {
    return serveStaleOrError(error, res, path, cached);
  }

  const { status, data, isHtml } = result;

  // Erros do GC (rate limit / origem instável): prefere cache antigo a propagar erro.
  if (status === 429 || status >= 500) {
    if (cached) {
      console.warn(`[proxy] ${status} em ${path} — servindo cache stale (não repassa erro do GC)`);
      res.set('x-proxy-cache', 'STALE');
      return res.status(cached.status).json(cached.data);
    }
    return sendHttpError(status, res, path);
  }
  if (status === 401 || status === 403 || status === 404) {
    return sendHttpError(status, res, path);
  }

  // 2xx mas sem JSON = sessão inválida ou resposta inesperada.
  if (isHtml) {
    console.error(`[proxy] sem JSON de ${path} (status ${status}) — sessão inválida ou resposta inesperada`);
    if (cached) {
      res.set('x-proxy-cache', 'STALE');
      return res.status(cached.status).json(cached.data);
    }
    return res.status(503).json({
      error: 'Sessão inválida: o Gamersclub não retornou JSON. Verifique os cookies no .env ou reinicie o servidor.',
      status: 503,
    });
  }

  // Sucesso.
  writeCache(path, data, status);
  res.set('x-proxy-cache', 'MISS');
  return res.status(status).json(data);
}

// GET /api/lobby/match/:matchId/:tab
router.get('/lobby/match/:matchId/:tab', (req, res) => {
  const { matchId, tab } = req.params;
  // referer aponta para a página da partida (sem o tab), igual ao browser
  return proxyGet(`/lobby/match/${matchId}/${tab}`, res, { referer: `/lobby/partida/${matchId}` });
});

// GET /api/lobby/match/:matchId (sem tab)
router.get('/lobby/match/:matchId', (req, res) => {
  const { matchId } = req.params;
  return proxyGet(`/lobby/match/${matchId}`, res, { referer: `/lobby/partida/${matchId}` });
});

function sendHttpError(status, res, path, retryAfter) {
  const messages = {
    401: 'Não autenticado no Gamersclub — sessão expirada',
    403: 'Acesso bloqueado — Cloudflare ou permissão negada',
    404: 'Recurso não encontrado no Gamersclub',
    429: 'Rate limit atingido — aguarde antes de tentar novamente',
  };
  const message = messages[status] || `Erro ${status} do Gamersclub`;
  console.error(`[proxy] ${status} em ${path}: ${message}`);
  if (status === 429 && retryAfter) res.set('Retry-After', retryAfter);
  return res.status(status).json({ error: message, status });
}

// Falha de transporte (timeout, FlareSolverr fora) ou erro axios com response.
function serveStaleOrError(error, res, path, cached) {
  const status = error.response?.status;

  if (cached && (status === 429 || (status && status >= 500) || !status)) {
    console.warn(`[proxy] falha em ${path} (${status || error.message}) — servindo cache stale`);
    res.set('x-proxy-cache', 'STALE');
    return res.status(cached.status).json(cached.data);
  }

  if (status) {
    return sendHttpError(status, res, path, error.response?.headers?.['retry-after']);
  }
  if (error.code === 'ECONNABORTED') {
    console.error(`[proxy] timeout em ${path}`);
    return res.status(504).json({ error: 'Timeout ao conectar no Gamersclub', status: 504 });
  }
  console.error(`[proxy] erro inesperado em ${path}:`, error.message);
  return res.status(502).json({ error: 'Erro interno do proxy', status: 502 });
}

module.exports = router;

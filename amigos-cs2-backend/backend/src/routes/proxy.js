const { Router } = require('express');
const { client } = require('../services/httpClient');
const { forceRenew } = require('../services/sessionManager');

const GC_URL = () => process.env.GAMERSCLUB_BASE_URL || 'https://gamersclub.com.br';
const router = Router();

async function proxyGet(url, res, { referer } = {}) {
  const headers = referer ? { referer: `${GC_URL()}${referer}` } : {};

  try {
    const response = await client.get(url, { headers });

    const contentType = response.headers['content-type'] || '';
    if (contentType.includes('text/html')) {
      console.error(`[proxy] HTML recebido de ${url} — sessão inválida ou expirada`);
      return res.status(503).json({
        error: 'Sessão inválida: o Gamersclub retornou HTML. Verifique os cookies no .env ou reinicie o servidor.',
        status: 503,
      });
    }

    return res.status(response.status).json(response.data);
  } catch (error) {
    if (error.response?.status === 403) {
      console.warn(`[proxy] 403 em ${url} — renovando sessão e tentando novamente...`);
      try {
        await forceRenew();
        const retry = await client.get(url, { headers });
        return res.status(retry.status).json(retry.data);
      } catch (retryError) {
        return handleProxyError(retryError, res, url);
      }
    }
    return handleProxyError(error, res, url);
  }
}

// GET /api/lobby/match/:matchId/:tab
router.get('/lobby/match/:matchId/:tab', (req, res) => {
  const { matchId, tab } = req.params;
  // referer aponta para a página da partida (sem o tab), igual ao browser
  return proxyGet(`/lobby/match/${matchId}/${tab}`, res, { referer: `/lobby/match/${matchId}` });
});

// GET /api/lobby/match/:matchId (sem tab)
router.get('/lobby/match/:matchId', (req, res) => {
  const { matchId } = req.params;
  return proxyGet(`/lobby/match/${matchId}`, res, { referer: `/lobby/partida/${matchId}` });
});

function handleProxyError(error, res, url) {
  if (error.response) {
    const { status, data } = error.response;
    const messages = {
      401: 'Não autenticado no Gamersclub — sessão expirada',
      403: 'Acesso bloqueado — Cloudflare ou permissão negada',
      404: 'Recurso não encontrado no Gamersclub',
      429: 'Rate limit atingido — aguarde antes de tentar novamente',
    };
    const message = messages[status] || `Erro ${status} do Gamersclub`;
    console.error(`[proxy] ${status} em ${url}: ${message}`);
    if (status >= 500) {
      const preview = typeof data === 'string'
        ? data.slice(0, 400)
        : JSON.stringify(data).slice(0, 400);
      console.error(`[proxy] body do ${status} em ${url}: ${preview}`);
    }
    return res.status(status).json({ error: message, status });
  }

  if (error.code === 'ECONNABORTED') {
    console.error(`[proxy] timeout em ${url}`);
    return res.status(504).json({ error: 'Timeout ao conectar no Gamersclub', status: 504 });
  }

  console.error(`[proxy] erro inesperado em ${url}:`, error.message);
  res.status(502).json({ error: 'Erro interno do proxy', status: 502 });
}

module.exports = router;

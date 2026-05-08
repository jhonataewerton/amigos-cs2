const axios = require('axios');
const { Cookie } = require('tough-cookie');
const jar = require('./cookieJar');

const GC_URL = () => process.env.GAMERSCLUB_BASE_URL || 'https://gamersclub.com.br';
const FLARE_URL = () => process.env.FLARESOLVERR_URL;

async function persistCfClearance(cookies = []) {
  const cf = cookies.find((c) => c.name === 'cf_clearance');
  if (!cf) throw new Error('FlareSolverr não retornou cf_clearance');

  const tc = new Cookie({
    key: 'cf_clearance',
    value: cf.value,
    domain: cf.domain || new URL(GC_URL()).hostname,
    path: cf.path || '/',
    secure: cf.secure !== false,
    hostOnly: true,
  });
  await jar.setCookie(tc, GC_URL());
}

async function callSolver(url) {
  const solver = FLARE_URL();
  if (!solver) throw new Error('FLARESOLVERR_URL não configurado');

  const body = { cmd: 'request.get', url, maxTimeout: 60000 };
  const resp = await axios.post(`${solver}/v1`, body, { timeout: 120000 });
  if (resp.data?.status !== 'ok') {
    throw new Error(`FlareSolverr retornou status="${resp.data?.status}" — ${resp.data?.message || 'sem detalhes'}`);
  }
  return resp.data.solution;
}

// Pede ao FlareSolverr um cf_clearance válido para o IP atual.
// Persiste apenas o cf_clearance no jar (NÃO sobrescreve gclubsess/accessToken).
// Retorna { userAgent } para o httpClient alinhar o header com o que o solver usou.
async function refreshClearance() {
  console.log('[flaresolverr] solicitando cf_clearance');
  const solution = await callSolver(GC_URL());
  await persistCfClearance(solution.cookies || []);
  console.log('[flaresolverr] cf_clearance persistido no jar');
  return { userAgent: solution.userAgent };
}

module.exports = { refreshClearance };

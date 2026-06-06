const axios = require('axios');
const { Cookie } = require('tough-cookie');
const jar = require('./cookieJar');

const GC_URL = () => process.env.GAMERSCLUB_BASE_URL || 'https://gamersclub.com.br';
const FLARE_URL = () => process.env.FLARESOLVERR_URL;

async function persistCfClearance(cookies = []) {
  const cf = cookies.find((c) => c.name === 'cf_clearance');
  if (!cf) throw new Error('FlareSolverr não retornou cf_clearance');

  // FlareSolverr devolve domain ".gamersclub.com.br" (com ponto), mas com
  // hostOnly:true o tough-cookie só matcha host literal — então usamos o
  // hostname puro pra alinhar com os outros cookies do jar.
  const tc = new Cookie({
    key: 'cf_clearance',
    value: cf.value,
    domain: new URL(GC_URL()).hostname,
    path: '/',
    secure: true,
    hostOnly: true,
  });
  await jar.setCookie(tc, GC_URL());
}

// O FlareSolverr roda um Chrome só e atende um pedido por vez. Se duas chamadas
// chegam juntas (cron + request, ou o front pollando vários matches), ele colide
// e devolve erro/página de desafio em vez do JSON. Esta fila serializa TODAS as
// chamadas ao solver — uma de cada vez.
let solverQueue = Promise.resolve();
function serialize(task) {
  const run = solverQueue.then(task, task);
  solverQueue = run.then(() => {}, () => {}); // mantém a fila andando mesmo em erro
  return run;
}

function callSolver(url, cookies) {
  return serialize(async () => {
    const solver = FLARE_URL();
    if (!solver) throw new Error('FLARESOLVERR_URL não configurado');

    const body = { cmd: 'request.get', url, maxTimeout: 60000 };
    if (cookies) body.cookies = cookies;
    const resp = await axios.post(solver, body, { timeout: 120000 });
    if (resp.data?.status !== 'ok') {
      throw new Error(`FlareSolverr retornou status="${resp.data?.status}" — ${resp.data?.message || 'sem detalhes'}`);
    }
    return resp.data.solution;
  });
}

// O Chrome do FlareSolverr renderiza JSON dentro de <pre>...</pre> e escapa as
// entidades HTML. Extrai e parseia. Retorna null se não for JSON (ex.: página
// de erro 500 do GC ou landing de sessão inválida).
function extractJson(html) {
  if (!html) return null;
  const m = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
  const text = (m ? m[1] : html.trim())
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Busca uma URL JSON da API do GC pelo Chrome real do FlareSolverr.
// Fingerprint de browser + cf_clearance consistente → evita o 500 que o GC
// devolve quando a chamada sai do axios/Node. Injeta os cookies de sessão.
// Retorna { status, data, isJson } — status é o HTTP real da origem.
async function fetchJson(url) {
  const cookies = [
    { name: 'gclubsess', value: process.env.GCLUBSESS },
    { name: 'gcid:accessToken', value: process.env.ACCESS_TOKEN },
    { name: 'x-gcid:accessToken', value: process.env.X_ACCESS_TOKEN || process.env.ACCESS_TOKEN },
  ].filter((c) => c.value);

  const solution = await callSolver(url, cookies);
  const data = extractJson(solution.response);
  if (data === null) {
    const preview = (solution.response || '').replace(/\s+/g, ' ').slice(0, 300);
    console.error(`[flaresolverr] resposta sem JSON para ${url} (status ${solution.status}): ${preview}`);
  }
  return { status: solution.status || 0, data, isJson: data !== null };
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

module.exports = { refreshClearance, fetchJson };

const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const jar = require('./cookieJar');

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

// UA dinâmico — atualizado por setUserAgent quando o FlareSolverr resolve
// o challenge. cf_clearance é vinculado ao par (IP, UA), então toda request
// precisa sair com o mesmo UA usado pelo solver.
let currentUserAgent = DEFAULT_USER_AGENT;

const client = wrapper(
  axios.create({
    jar,
    baseURL: process.env.GAMERSCLUB_BASE_URL,
    headers: {
      'accept': 'application/json, text/plain, */*',
      'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      'referer': `${process.env.GAMERSCLUB_BASE_URL}/lobby`,
    },
    maxRedirects: 5,
    timeout: 15000,
  })
);

// Garante que o UA correto seja anexado a TODA request, sobrescrevendo
// qualquer default em axios. Resolve a inconsistência da estrutura
// `defaults.headers` do axios 1.x onde override pós-create não pega.
client.interceptors.request.use((config) => {
  config.headers.set('user-agent', currentUserAgent);
  return config;
});

function setUserAgent(ua) {
  if (!ua) return;
  currentUserAgent = ua;
  console.log(`[http] user-agent atualizado: ${ua.slice(0, 60)}...`);
}

module.exports = { client, setUserAgent };

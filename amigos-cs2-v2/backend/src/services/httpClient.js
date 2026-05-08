const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const jar = require('./cookieJar');

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

const COMMON_HEADERS = {
  'accept': 'application/json, text/plain, */*',
  'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'user-agent': DEFAULT_USER_AGENT,
};

// Cliente para a API do gamersclub.com.br.
// Simula request same-origin: referer do próprio site, sem header "origin".
const client = wrapper(
  axios.create({
    jar,
    baseURL: process.env.GAMERSCLUB_BASE_URL,
    headers: {
      ...COMMON_HEADERS,
      'referer': `${process.env.GAMERSCLUB_BASE_URL}/lobby`,
      'sec-fetch-site': 'same-origin',
    },
    maxRedirects: 5,
    timeout: 15000,
  })
);

// Atualiza o user-agent em runtime. Usado quando o FlareSolverr resolve o
// challenge — o cf_clearance é vinculado ao par (IP, user-agent), então o
// cliente HTTP precisa enviar exatamente o mesmo UA usado pelo solver.
function setUserAgent(ua) {
  if (!ua) return;
  client.defaults.headers['user-agent'] = ua;
  console.log(`[http] user-agent atualizado: ${ua.slice(0, 60)}...`);
}

module.exports = { client, setUserAgent };

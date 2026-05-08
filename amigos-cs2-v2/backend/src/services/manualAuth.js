const { Cookie } = require('tough-cookie');
const jar = require('./cookieJar');

const GC_DOMAIN = () => new URL(process.env.GAMERSCLUB_BASE_URL || 'https://gamersclub.com.br').hostname;
const GC_URL = () => process.env.GAMERSCLUB_BASE_URL || 'https://gamersclub.com.br';

async function injectCookie(name, value) {
  if (!value) {
    console.warn(`[manual-auth] cookie "${name}" não definido no .env — ignorando`);
    return;
  }
  const c = new Cookie({
    key: name,
    value,
    domain: GC_DOMAIN(),
    path: '/',
    secure: true,
    hostOnly: true,
  });
  await jar.setCookie(c, GC_URL());
  console.log(`[manual-auth] cookie "${name}" injetado`);
}

async function loadManualSession() {
  const gcl = process.env.GCLUBSESS;
  const at = process.env.ACCESS_TOKEN;
  const xat = process.env.X_ACCESS_TOKEN;
  const cf = process.env.CF_CLEARANCE;
  const useFlare = !!process.env.FLARESOLVERR_URL;

  if (!gcl || !at) {
    throw new Error(
      'GCLUBSESS e ACCESS_TOKEN são obrigatórios no .env\n' +
      'Abra gamersclub.com.br no Chrome → DevTools → Application → Cookies → copie os valores.'
    );
  }

  await injectCookie('gclubsess', gcl);
  await injectCookie('gcid:accessToken', at);
  // x-gcid:accessToken é um JWT diferente; se não vier, reusa o gcid:accessToken
  await injectCookie('x-gcid:accessToken', xat || at);

  // cf_clearance só é injetado do .env quando FlareSolverr não estiver configurado.
  // Em produção (VPS), o cf_clearance do .env não vale (foi minted no IP local) —
  // o flaresolverr cuida disso no boot e no cron.
  if (!useFlare) {
    await injectCookie('cf_clearance', cf);
  } else {
    console.log('[manual-auth] FLARESOLVERR_URL setado — cf_clearance será obtido pelo solver');
  }

  console.log('[manual-auth] cookies de sessão carregados');
}

module.exports = { loadManualSession };

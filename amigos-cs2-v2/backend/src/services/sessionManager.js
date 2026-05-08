const cron = require('node-cron');

// cf_clearance expira em ~30min — renova com margem de segurança
const CF_CRON = process.env.CF_CRON || '*/25 * * * *';

async function refreshClearanceSafe() {
  if (!process.env.FLARESOLVERR_URL) return; // dev local: nada a fazer
  try {
    const flaresolverr = require('./flaresolverr');
    const { setUserAgent } = require('./httpClient');
    const { userAgent } = await flaresolverr.refreshClearance();
    setUserAgent(userAgent);
  } catch (err) {
    console.error('[session] falha ao renovar cf_clearance:', err.message);
  }
}

function start() {
  if (!process.env.FLARESOLVERR_URL) {
    console.log('[session] FLARESOLVERR_URL não setado — cron de cf_clearance desativado (modo dev local)');
    return;
  }
  cron.schedule(CF_CRON, refreshClearanceSafe);
  console.log(`[session] renovação de cf_clearance agendada (${CF_CRON})`);
}

// Chamado pelo proxy quando recebe 403 inesperado (provável cf_clearance expirado).
async function forceRenew() {
  console.log('[session] renovação forçada por 403');
  await refreshClearanceSafe();
}

module.exports = { start, forceRenew };

const fs = require('fs');
const path = require('path');

const SESSION_FILE = path.resolve(process.env.SESSION_FILE || '.session.json');

let currentSession = null;

function saveSessionToDisk(session) {
  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));
  } catch (err) {
    console.warn('[auth] não foi possível salvar sessão em disco:', err.message);
  }
}

function isAuthenticated() {
  return !!currentSession?.loggedInAt;
}

function getSession() {
  return currentSession;
}

function markAuthenticated(mode) {
  currentSession = { loggedInAt: new Date().toISOString(), mode };
  saveSessionToDisk(currentSession);
}

// Carrega cookies manuais do .env e, se FLARESOLVERR_URL estiver setado,
// pede ao FlareSolverr um cf_clearance válido para o IP atual e atualiza o
// user-agent do httpClient pra bater com o que o solver usou.
async function login() {
  const { loadManualSession } = require('./manualAuth');
  await loadManualSession();

  if (process.env.FLARESOLVERR_URL) {
    const flaresolverr = require('./flaresolverr');
    const { setUserAgent } = require('./httpClient');
    const { userAgent } = await flaresolverr.refreshClearance();
    setUserAgent(userAgent);
    markAuthenticated('manual+flaresolverr');
    return;
  }

  markAuthenticated('manual');
}

async function initialize() {
  console.log('[auth] inicializando sessão...');
  await login();
  console.log(`[auth] sessão pronta (modo: ${currentSession?.mode})`);
}

// Mantido para compatibilidade com routes/session.js — não há JWT que possa
// ser introspecionado aqui sem decodificar manualmente o ACCESS_TOKEN.
function getTokenExpiration() {
  return null;
}

module.exports = { login, isAuthenticated, getSession, initialize, getTokenExpiration };

require('dotenv').config({ override: true });

const { onRequest } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const app = require('./src/app');
const { initialize } = require('./src/services/auth');

setGlobalOptions({ region: 'us-central1', memory: '512MiB', timeoutSeconds: 120 });

// Garante que os cookies são injetados antes do primeiro request (warm start)
let initPromise = null;

function ensureInit() {
  if (!initPromise) {
    initPromise = initialize().catch((err) => {
      console.warn('[functions] init warning:', err.message);
      initPromise = null; // permite retry no próximo request
    });
  }
  return initPromise;
}

exports.api = onRequest(async (req, res) => {
  await ensureInit();
  return app(req, res);
});

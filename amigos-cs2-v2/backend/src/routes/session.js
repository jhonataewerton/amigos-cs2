const { Router } = require('express');
const { isAuthenticated, getSession, getTokenExpiration } = require('../services/auth');
const { forceRenew } = require('../services/sessionManager');

const router = Router();

// Middleware: só permite em dev ou com API key
router.use((req, res, next) => {
  const apiKey = process.env.INTERNAL_API_KEY;
  if (!apiKey || req.headers['x-api-key'] === apiKey) return next();
  res.status(403).json({ error: 'Acesso negado' });
});

// GET /api/session/status
router.get('/status', (req, res) => {
  const session = getSession();
  const expiry = getTokenExpiration();

  res.json({
    authenticated: isAuthenticated(),
    loggedInAt: session?.loggedInAt || null,
    tokenExpiresAt: expiry?.toISOString() || null,
  });
});

// POST /api/session/renew
router.post('/renew', async (req, res) => {
  try {
    await forceRenew();
    res.json({ success: true, message: 'Sessão renovada' });
  } catch (err) {
    res.status(500).json({ error: 'Falha ao renovar sessão', detail: err.message });
  }
});

module.exports = router;

const express = require('express');
const corsMiddleware = require('./middlewares/cors');
const proxyRouter = require('./routes/proxy');
const sessionRouter = require('./routes/session');

const app = express();

app.use(corsMiddleware);
app.use(express.json());

app.get('/health', (_req, res) => {
  const { isAuthenticated, getSession } = require('./services/auth');
  const session = getSession();
  res.json({
    status: 'ok',
    session: { authenticated: isAuthenticated(), loggedInAt: session?.loggedInAt || null },
  });
});

// The Functions runtime already routes requests under the function name
// (e.g. /api/...), so the app receives paths with that prefix removed.
// Mount routers at the root so routes like /lobby/... map correctly
// when the function is deployed as `api`.
// Mount routers so both local server (`/api/...`) and Functions runtime (`/...`) work
app.use('/api', proxyRouter);
app.use('/api/session', sessionRouter);

app.use('/', proxyRouter);
app.use('/session', sessionRouter);

module.exports = app;

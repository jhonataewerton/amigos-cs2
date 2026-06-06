// override: true garante que os valores do .env sempre vençam o que o PM2
// possa ter cacheado no process.env entre restarts (senão um token velho
// carregado num start anterior nunca seria atualizado).
require('dotenv').config({ override: true });

const app = require('./app');
const { initialize } = require('./services/auth');
const { start: startSessionManager } = require('./services/sessionManager');

const PORT = process.env.APP_PORT || process.env.PORT || 3000;

async function bootstrap() {
  try {
    await initialize();
  } catch (err) {
    console.warn('[bootstrap] falha na autenticação inicial:', err.message);
    console.warn('[bootstrap] o servidor vai subir mesmo assim — configure os cookies no .env');
  }

  startSessionManager();
  app.listen(PORT, () => console.log(`[server] rodando na porta ${PORT}`));
}

bootstrap();

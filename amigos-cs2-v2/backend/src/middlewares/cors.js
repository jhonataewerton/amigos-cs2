const cors = require('cors');

const allowedOrigins = [
  process.env.ALLOWED_ORIGIN,
  'http://localhost:4200', // Angular dev server
  'http://localhost:3000',
].filter(Boolean);

module.exports = cors({
  origin: (origin, callback) => {
    // Permitir requisições sem origin (ex: curl, Postman, server-to-server)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    callback(new Error(`Origem não permitida pelo CORS: ${origin}`));
  },
  credentials: true,
});

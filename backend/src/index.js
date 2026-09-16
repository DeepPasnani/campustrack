require('dotenv').config();

// Sentry must be initialized before the modules it instruments (express,
// pg, etc.) are required, to get full automatic tracing — hence right
// after dotenv, ahead of everything else. A no-op with no SENTRY_DSN set:
// every Sentry.* call below is safe to make unconditionally either way.
const Sentry = require('@sentry/node');
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.1,
  });
}

const http = require('http');
const path = require('path');
const express = require('express');
// MUST be required immediately after express and before ./routes (which
// registers ~230 async route handlers) — this patches Express 4's router so
// a thrown error/rejected promise inside an async handler is automatically
// forwarded to the error-handling middleware below, instead of silently
// hanging the request forever. Express 4 does not do this on its own (only
// Express 5 does); prior to this, the ~90% of controller functions written
// as `async function(req, res) {...}` with no try/catch of their own would
// leave the client's request hanging with no response at all whenever a
// query failed, a field was missing, or any other exception was thrown —
// surfacing as random freezes/timeouts under any real usage or load rather
// than a clean error message.
require('express-async-errors');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const pinoHttp = require('pino-http');
const promClient = require('prom-client');

const multer = require('multer');
const routes = require('./routes');
const { setupWebSocket } = require('./services/websocket');
const { startScheduler } = require('./services/scheduler');
const logger = require('./services/logger');
const { pool, getReadPool } = require('./db');
const { getRedis } = require('./db/redis');

const app = express();
const PORT = process.env.PORT || 5000;

// ── Trust proxy ───────────────────────────────────────────────
// This app always sits behind at least one reverse proxy (the Nginx
// container in docker-compose.yml / docker-compose.prod.yml, and often an
// additional platform load balancer on top of that — Render, Railway,
// Heroku, etc. all add one). Both proxies set X-Forwarded-For.
//
// Without `trust proxy` set, Express ignores X-Forwarded-For and req.ip
// resolves to the socket address of whichever hop connected directly to
// Node — i.e. the *proxy's* IP, which is identical for every single user.
// express-rate-limit keys its buckets on req.ip by default, so every
// visitor (every student login, every admin login, every API call) was
// sharing ONE bucket. The admin login limiter allows only 20 requests per
// 15 minutes total, across the whole site — that bucket emptied almost
// immediately under any real traffic, which is why admin (and eventually
// everyone) started seeing "Too many requests"/"Too many login attempts".
//
// Setting this to a hop count makes Express pick the correct
// client-supplied IP out of X-Forwarded-For, so rate limits apply
// per-visitor again. TRUST_PROXY lets you tune the hop count for your
// topology (defaults to 1, matching the bundled single-Nginx setup);
// bump it to 2 if you put this behind Nginx *and* a platform LB/CDN.
const trustProxyHops = Number.isFinite(Number(process.env.TRUST_PROXY))
  ? Number(process.env.TRUST_PROXY)
  : 1;
app.set('trust proxy', trustProxyHops);

// ── Prometheus metrics ────────────────────────────────────
const collectDefaultMetrics = promClient.collectDefaultMetrics;
collectDefaultMetrics({ register: promClient.register });

const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'path', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2.5, 5, 10],
});

const httpRequestsTotal = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'path', 'status'],
});

const activeUsersGauge = new promClient.Gauge({
  name: 'active_users_total',
  help: 'Number of active users in tests',
});

// ── Swagger ───────────────────────────────────────────────
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./swagger');
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'CampusTrack API Docs',
}));

// ── Middleware ──────────────────────────────────────────────────
// Helmet's default Cross-Origin-Resource-Policy ("same-origin") makes
// browsers silently refuse to render <img src="..."> whenever the frontend
// is hosted on a different origin/domain than this API (e.g. Vercel +
// Render/Railway, or even just http://localhost:5173 calling
// http://localhost:5000 directly). The network request succeeds, but the
// image never paints — this is one of the reasons uploaded question/option
// images can appear broken on the test-taking page. "cross-origin" keeps
// helmet's other protections while allowing images served from
// GET /api/images/:id to be embedded from any origin.
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(compression());
app.use(pinoHttp({ logger }));
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Request metrics middleware ────────────────────────────
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    const path = req.route ? req.route.path : req.path;
    httpRequestDuration.observe({ method: req.method, path, status: res.statusCode }, duration);
    httpRequestsTotal.inc({ method: req.method, path, status: res.statusCode });
  });
  next();
});

// ── Serve uploaded files ────────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// ── Routes ──────────────────────────────────────────────────────
app.use('/api', routes);

// ── Metrics endpoint for Prometheus ───────────────────────
app.get('/metrics', async (_req, res) => {
  try {
    const r = await getRedis();
    const activeKeys = await r.keys('active:*');
    activeUsersGauge.set(activeKeys.length);
    res.set('Content-Type', promClient.register.contentType);
    res.end(await promClient.register.metrics());
  } catch (err) {
    res.status(500).json({ error: 'Metrics unavailable' });
  }
});

// ── Health check ───────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  const checks = { database: false, redis: false, readReplica: false };

  try {
    await pool.query('SELECT 1');
    checks.database = true;
  } catch {
    checks.database = false;
  }

  try {
    const r = await getRedis();
    await r.ping();
    checks.redis = true;
  } catch {
    checks.redis = false;
  }

  // Check read replica if configured
  const readUrl = process.env.DATABASE_URL_READ;
  if (readUrl) {
    try {
      const rp = getReadPool();
      await rp.query('SELECT 1');
      checks.readReplica = true;
    } catch {
      checks.readReplica = false;
    }
  } else {
    checks.readReplica = 'not_configured';
  }

  const allOk = checks.database && checks.redis;
  res.status(allOk ? 200 : 503).json({
    status: allOk ? 'ok' : 'degraded',
    checks,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// ── 404 handler ────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Reports the error to Sentry (no-op if SENTRY_DSN isn't set) and calls
// next(err), so the existing JSON-response error handler below still runs
// exactly as before — this only adds reporting, it doesn't change any
// response the client sees.
if (process.env.SENTRY_DSN) Sentry.setupExpressErrorHandler(app);

// ── Error handler ──────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  logger.error({ err }, 'Unhandled error');

  // Multer-specific errors
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File too large. Maximum size is 5 MB.' });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ error: 'Unexpected file field' });
    }
    return res.status(400).json({ error: err.message });
  }

  let message = err?.message;
  if (!message) message = err?.error?.message;
  if (!message && typeof err?.error === 'string') message = err.error;
  if (!message && typeof err === 'string') message = err;
  if (!message && typeof err?.error === 'object') message = JSON.stringify(err.error);
  if (!message) message = typeof err === 'object' ? JSON.stringify(err) : String(err);

  logger.error({ err, extractedMessage: message }, 'Request error');
  return res.status(500).json({ error: message });
});

// ── Global error handlers (prevent crash on unhandled promise rejections) ──
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
  Sentry.captureException(reason);
});
process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught exception');
  Sentry.captureException(err);
});

// ── Create HTTP server with WebSocket support ──────────────────
const server = http.createServer(app);
setupWebSocket(server);

// ── Start server ───────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  logger.info({ port: PORT }, 'Server started');
  startScheduler();
});

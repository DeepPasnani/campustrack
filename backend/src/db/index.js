const { Pool } = require('pg');
const logger = require('../services/logger');

// ── Primary pool (writes) ────────────────────────────────
const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: false,
        max: parseInt(process.env.DB_POOL_MAX) || 50,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: parseInt(process.env.DB_POOL_TIMEOUT) || 5000,
      }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT) || 5432,
        database: process.env.DB_NAME || 'campustrack',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD,
        max: parseInt(process.env.DB_POOL_MAX) || 50,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: parseInt(process.env.DB_POOL_TIMEOUT) || 5000,
      }
);

// ── Read replica pool (reads) ────────────────────────────
let readPool = null;
const readUrl = process.env.DATABASE_URL_READ;

function getReadPool() {
  if (!readUrl) return pool; // fall back to primary if no read replica configured

  if (!readPool) {
    readPool = new Pool(
      readUrl.startsWith('postgresql://') || readUrl.startsWith('postgres://')
        ? {
            connectionString: readUrl,
            ssl: false,
            max: 30,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 2000,
          }
        : {
            host: process.env.DB_HOST_READ || 'localhost',
            port: parseInt(process.env.DB_PORT_READ) || 5433,
            database: process.env.DB_NAME_READ || 'campustrack',
            user: process.env.DB_USER_READ || process.env.DB_USER || 'postgres',
            password: process.env.DB_PASSWORD_READ || process.env.DB_PASSWORD,
            max: 30,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 2000,
          }
    );

    readPool.on('error', (err) => {
      logger.error({ err }, 'PostgreSQL read-replica pool error');
    });
  }

  return readPool;
}

pool.on('error', (err) => {
  logger.error({ err }, 'PostgreSQL primary pool error');
});

// ── Query helpers ─────────────────────────────────────────
// Writes always go to primary, reads can go to replica.
// Call query() for writes, readQuery() for read-only queries.

const query = (text, params) => pool.query(text, params);

const readQuery = (text, params) => {
  const rp = getReadPool();
  const start = Date.now();
  return rp.query(text, params).then(result => {
    logger.debug({ query: text.substring(0, 80), duration: Date.now() - start }, 'Read query');
    return result;
  });
};

const getClient = () => pool.connect();

module.exports = { query, readQuery, getClient, pool, getReadPool };

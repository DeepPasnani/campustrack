const { createClient } = require('redis');
const logger = require('../services/logger');

let client;

async function getRedis() {
  if (client && client.isReady) return client;

  client = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    socket: {
      reconnectStrategy: (retries) => Math.min(retries * 50, 2000),
    },
  });

  client.on('error', (err) => logger.error({ err }, 'Redis error'));
  client.on('connect', () => logger.info('Redis connected'));
  client.on('reconnecting', () => logger.warn('Redis reconnecting...'));

  await client.connect();
  return client;
}

// Cache helper with TTL
async function cacheGet(key) {
  const r = await getRedis();
  const val = await r.get(key);
  return val ? JSON.parse(val) : null;
}

async function cacheSet(key, value, ttlSeconds = 300) {
  const r = await getRedis();
  await r.set(key, JSON.stringify(value), { EX: ttlSeconds });
}

async function cacheDel(key) {
  const r = await getRedis();
  await r.del(key);
}

// Delete all keys matching a prefix (used for class-aware cache keys, e.g.
// "test:<id>:full:*" — one test can have several cached variants, one per
// MCQ set/class).
async function cacheDelPattern(prefix) {
  const r = await getRedis();
  let cursor = 0;
  do {
    const res = await r.scan(cursor, { MATCH: `${prefix}*`, COUNT: 100 });
    cursor = res.cursor;
    if (res.keys.length) await r.del(res.keys);
  } while (cursor !== 0);
}

// Rate limiting helpers
async function incrementRateLimit(key, windowSeconds) {
  const r = await getRedis();
  const count = await r.incr(key);
  if (count === 1) await r.expire(key, windowSeconds);
  return count;
}

// Active test session tracking
async function setActiveSession(userId, testId, data) {
  const r = await getRedis();
  await r.set(`session:${userId}:${testId}`, JSON.stringify(data), { EX: 7200 });
}

async function getActiveSession(userId, testId) {
  const r = await getRedis();
  const val = await r.get(`session:${userId}:${testId}`);
  return val ? JSON.parse(val) : null;
}

async function deleteActiveSession(userId, testId) {
  const r = await getRedis();
  await r.del(`session:${userId}:${testId}`);
}

// Real-time active user count
async function trackActiveUser(testId, userId) {
  const r = await getRedis();
  await r.sAdd(`active:${testId}`, userId);
  await r.expire(`active:${testId}`, 7200);
}

async function getActiveUserCount(testId) {
  const r = await getRedis();
  return await r.sCard(`active:${testId}`);
}

module.exports = {
  getRedis, cacheGet, cacheSet, cacheDel, cacheDelPattern,
  incrementRateLimit, setActiveSession, getActiveSession,
  deleteActiveSession, trackActiveUser, getActiveUserCount,
};

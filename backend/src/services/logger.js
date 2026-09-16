const pino = require('pino');

// Structured JSON logger with correlation ID support.
// Outputs pino-loki-compatible JSON for log aggregation.

const logger = pino({
  transport: process.env.NODE_ENV === 'development'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level(label) {
      return { level: label };
    },
    bindings() {
      return {
        pid: process.pid,
        hostname: require('os').hostname(),
        service: 'campustrack-backend',
        environment: process.env.NODE_ENV || 'development',
      };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'body.password',
      'body.token',
      'body.credential',
      'body.newPassword',
      'body.currentPassword',
    ],
    censor: '[REDACTED]',
  },
});

// Helper to create a child logger with correlation ID
function withCorrelation(correlationId) {
  return logger.child({ correlation_id: correlationId });
}

// Helper to log DB query timing
function logDbQuery(queryText, durationMs, correlationId) {
  logger.debug({
    correlation_id: correlationId,
    db_query_ms: durationMs,
    query: queryText.substring(0, 200),
  }, 'DB query');
}

module.exports = logger;
module.exports.withCorrelation = withCorrelation;
module.exports.logDbQuery = logDbQuery;

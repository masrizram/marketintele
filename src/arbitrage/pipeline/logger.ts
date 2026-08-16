/**
 * Structured logger with correlation/request ID support.
 *
 * All pipeline stages log with a requestId to enable end-to-end tracing.
 * Secrets are never logged — only metadata, IDs, and computed values.
 */
import pino from 'pino';

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

export const logger = pino({
  level: LOG_LEVEL,
  base: undefined,  // no base fields — we add our own
  mixin(_ctx) {
    return {};
  },
});

export interface RequestLogger {
  readonly requestId: string;
  debug(msg: string, obj?: Record<string, unknown>): void;
  info(msg: string, obj?: Record<string, unknown>): void;
  warn(msg: string, obj?: Record<string, unknown>): void;
  error(msg: string, obj?: Record<string, unknown>): void;
  child(overrides: Record<string, unknown>): RequestLogger;
}

const SENSITIVE_KEYS = new Set([
  'password', 'token', 'secret', 'apikey', 'api_key',
  'PG_PASSWORD', 'TELEGRAM_BOT_TOKEN', 'REDIS_URL',
  'authorization', 'cookie', 'session', 'credentials',
]);

function sanitize(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      out[key] = '[REDACTED]';
    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
      out[key] = sanitize(val as Record<string, unknown>);
    } else {
      out[key] = val;
    }
  }
  return out;
}

export function createRequestLogger(requestId: string): RequestLogger {
  const child = logger.child({ requestId });
  return {
    requestId,
    debug: (msg, obj) => child.debug(sanitize(obj || {}), msg),
    info: (msg, obj) => child.info(sanitize(obj || {}), msg),
    warn: (msg, obj) => child.warn(sanitize(obj || {}), msg),
    error: (msg, obj) => child.error(sanitize(obj || {}), msg),
    child: (_overrides) => createRequestLogger(requestId),
  };
}

export default logger;

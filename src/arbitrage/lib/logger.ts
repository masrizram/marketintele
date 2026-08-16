/**
 * Logger setup for the arbitrage engine.
 *
 * Resolves the log level lazily so that utility scripts (migrate.ts, seed.ts,
 * benchmark.ts) that only need a subset of the config do not trigger full
 * environment validation at import time.
 */
import pino from 'pino';

const DEFAULT_LEVEL = process.env.LOG_LEVEL || 'info';

export const logger = pino({
  level: DEFAULT_LEVEL,
});

export default logger;

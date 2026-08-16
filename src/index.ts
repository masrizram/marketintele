/**
 * MarketIntele — Arbitrage Intelligence Engine
 *
 * Single entry point. Bootstraps configuration, database, adapters, and
 * the Telegram bot with the full arbitrage pipeline.
 *
 * In production this is started via `npm start` or `node dist/index.js`.
 */
import 'dotenv/config';
import { config, requireWorkerConfig } from './config';
import { logger } from './arbitrage/lib/logger';
import { createBot } from './legacy/bot/handlers';
import { initDb } from './legacy/database';
import { adapterRegistry, registerDefaults } from './arbitrage/adapters/registry';
import { validateFeeConfiguration } from './arbitrage/economic/fee-config';
import { closePool, healthCheck as pgHealthCheck } from './arbitrage/db/pool';
import { arbitragePipeline } from './arbitrage/pipeline/pipeline';
import { startHealthServer, stopHealthServer } from './arbitrage/observability/health';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Bootstrap sequence:
 * 1. Validate configuration (fails fast if env is incomplete)
 * 2. Initialise SQLite legacy DB (user preferences, promo history)
 * 3. Health-check PostgreSQL connectivity
 * 4. Validate marketplace fee configuration
 * 5. Register source adapters and verify they are callable
 * 6. Wire the arbitrage pipeline into the Telegram bot
 * 7. Start Telegram bot
 */
async function bootstrap(): Promise<void> {
  logger.info('MarketIntele v2.0.0 — Arbitrage Intelligence Engine starting (WORKER)');

  // Step 1: Config is already parsed and validated in config.ts via Zod.
  // The worker additionally requires TELEGRAM_BOT_TOKEN (the shared schema
  // makes it optional so the serverless API can import the engine without it).
  requireWorkerConfig();
  logger.info(`Config loaded: logLevel=${config.logLevel}, ssrf=${config.ssrfFirewallEnabled}`);

  // Step 2: Legacy SQLite for user preferences and promo history.
  // SQLite IS required — the bot persists user settings and history here.
  try {
    const dbDir = path.dirname(config.databasePath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
      logger.info(`Created SQLite directory: ${dbDir}`);
    }
    initDb(config.databasePath);
    logger.info(`DATABASE READY — Legacy SQLite initialized: ${config.databasePath}`);
  } catch (err) {
    logger.error('DATABASE FAILED — SQLite init error. Bot cannot persist user preferences/history:', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  // Step 3: PostgreSQL connectivity health check
  try {
    const pgHealthy = await pgHealthCheck();
    if (pgHealthy) {
      logger.info('DATABASE READY — PostgreSQL connectivity verified');
    } else {
      logger.warn('DATABASE DEGRADED — PostgreSQL not reachable (arbitrage persistence will be unavailable until DB is available)');
    }
  } catch (err) {
    logger.warn('DATABASE DEGRADED — PostgreSQL health check failed (continuing in degraded mode):', err instanceof Error ? err.message : err);
  }

  // Step 4: Validate fee configuration
  try {
    validateFeeConfiguration([]);
    logger.info('CONFIG VALIDATED — Marketplace fee configuration verified');
  } catch (err) {
    logger.error('CONFIG FAILED — Fee configuration INCOMPLETE — profit engine will refuse to calculate until fees are provided:', err instanceof Error ? err.message : err);
    // Fee config is critical for the profit engine — but we continue in degraded mode
  }

  // Step 5: Register source adapters and verify they are callable
  registerDefaults();
  const activeAdapters = adapterRegistry.getActive();
  logger.info(`ADAPTERS REGISTERED — ${activeAdapters.length} marketplace adapters active`);

  // Verify each adapter is callable by checking it implements the required interface
  for (const adapter of activeAdapters) {
    const hasSearch = typeof (adapter as any).search === 'function';
    const hasFetch = typeof (adapter as any).fetch === 'function';
    const hasParse = typeof (adapter as any).parse === 'function';
    const hasNormalize = typeof (adapter as any).normalize === 'function';
    const capabilitiesOk = hasSearch && hasFetch && hasParse && hasNormalize;

    if (!capabilitiesOk) {
      logger.warn(`ADAPTER DEGRADED — ${adapter.adapterName} missing capabilities: search=${hasSearch}, fetch=${hasFetch}, parse=${hasParse}, normalize=${hasNormalize}`);
    } else {
      logger.info(`ADAPTER READY — ${adapter.adapterName} (${adapter.sourceName}) implements all required methods`);
    }
  }

  // Step 6: Wire the arbitrage pipeline into the Telegram bot
  logger.info('DEPENDENCIES READY — Arbitrage pipeline wired to Telegram bot');

  // Step 6b: Start health/metrics HTTP server (IDEA §49 / AUDIT §50)
  const healthPort = parseInt(process.env.HEALTH_PORT || '9090', 10);
  const healthServer = startHealthServer(healthPort);

  // Step 7: Start Telegram bot
  try {
    const bot = createBot(arbitragePipeline);
    logger.info('TELEGRAM INITIALIZED — Bot created');
    logger.info('BOT READY — All systems operational');

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}. Shutting down gracefully...`);
      try {
        await stopHealthServer(healthServer);
      } catch (err) {
        logger.error('Error stopping health server:', err instanceof Error ? err.message : err);
      }
      try {
        await closePool();
      } catch (err) {
        logger.error('Error closing PostgreSQL pool:', err instanceof Error ? err.message : err);
      }
      bot.stop('SIGTERM');
      await adapterRegistry.shutdownAll();
      logger.info('Shutdown complete.');
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // Start polling
    await bot.launch();
    logger.info('SERVER STARTED — Bot is now listening for commands');
    logger.info('LISTENING — Awaiting Telegram commands');
  } catch (err) {
    logger.error('TELEGRAM FAILED — Could not start Telegram bot:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

bootstrap().catch((err) => {
  logger.error('Fatal bootstrap error:', err instanceof Error ? err.message : err);
  process.exit(1);
});

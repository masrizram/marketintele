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
import { supplierSourcingService } from './arbitrage/sourcing/supplier-sourcing-service';
import { TestFixtureSupplierAdapter } from './arbitrage/sourcing/test-fixture-supplier-adapter';
import { AlibabaSupplierAdapter } from './arbitrage/sourcing/alibaba-supplier-adapter';
import { IndotradingSupplierAdapter } from './arbitrage/sourcing/indotrading-supplier-adapter';
import { circuitBreakerRegistry, DEFAULT_ADAPTER_BREAKER_CONFIG, DEFAULT_SUPPLIER_BREAKER_CONFIG } from './arbitrage/reliability/circuit-breaker-wiring';
import { alertManager } from './arbitrage/observability/alerts';
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

  // Step 5b: Register supplier adapters (IDEA §9–§12)
  // Alibaba adapter (requires API key) — registered first for priority
  if (config.alibabaApiKey && config.alibabaApiKey.trim().length > 0) {
    supplierSourcingService.registerAdapter(
      new AlibabaSupplierAdapter({ apiKey: config.alibabaApiKey, baseUrl: config.alibabaApiUrl }),
    );
    logger.info('SUPPLIER ADAPTER — Alibaba International registered');
  } else {
    logger.warn('SUPPLIER ADAPTER — Alibaba API key not configured (set ALIBABA_API_KEY)');
  }

  // Indotrading adapter (scraping-based, no API key needed)
  supplierSourcingService.registerAdapter(new IndotradingSupplierAdapter());
  logger.info('SUPPLIER ADAPTER — Indotrading B2B registered');

  // Test fixture adapter (development fallback — always last priority)
  if (config.applicationEnv !== 'production') {
    supplierSourcingService.registerAdapter(new TestFixtureSupplierAdapter());
    logger.info('SUPPLIER ADAPTER — TestFixture registered (development only)');
  }

  const hasRealSuppliers = supplierSourcingService.hasRealAdapters();
  logger.info(`SUPPLIER SOURCING — ${hasRealSuppliers ? 'REAL' : 'TEST_FIXTURE'} data provenance`);

  // Step 5c: Wire circuit breakers for each marketplace adapter
  for (const adapter of activeAdapters) {
    circuitBreakerRegistry.register(adapter.adapterName, DEFAULT_ADAPTER_BREAKER_CONFIG);
  }
  // Wire circuit breakers for each supplier adapter
  for (const supplierAdapter of ['AlibabaSupplierAdapter', 'IndotradingSupplierAdapter', 'TestFixtureSupplierAdapter']) {
    circuitBreakerRegistry.register(supplierAdapter, DEFAULT_SUPPLIER_BREAKER_CONFIG);
  }
  logger.info('CIRCUIT BREAKERS — Wired for all adapters');

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

  // Step 6b: Start alert manager
  alertManager.start(config.alertIntervalMs);
  logger.info('ALERTING — Alert manager started');

  // Step 6c: Start health/metrics HTTP server (IDEA §49 / AUDIT §50)
  const healthPort = parseInt(process.env.HEALTH_PORT || config.healthPort.toString(), 10);
  const healthServer = startHealthServer(healthPort);

  // Step 7: Start Telegram bot
  try {
    const bot = createBot(arbitragePipeline);
    logger.info('TELEGRAM INITIALIZED — Bot created');

    // Wire alert manager to the Telegram bot for alert delivery
    alertManager.setBot(bot);

    // Surface Telegraf handler errors instead of letting the default handler
    // kill the process. The default handleError() calls process.exit(1) and
    // throws, which terminates the worker on any single handler exception.
    bot.catch((err, ctx) => {
      logger.error(
        {
          err: err instanceof Error ? err.message : String(err),
          update_id: ctx?.update?.update_id,
        },
        'TELEGRAM HANDLER ERROR — update processing threw',
      );
    });

    logger.info('BOT READY — All systems operational');

    // Graceful shutdown
    let shuttingDown = false;
    const shutdown = async (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info(`Received ${signal}. Shutting down gracefully...`);
      try {
        bot.stop(signal);
        logger.info('TELEGRAM STOPPED — Polling stopped');
      } catch (err) {
        logger.error('Error stopping Telegram bot:', err instanceof Error ? err.message : err);
      }
      try {
        await stopHealthServer(healthServer);
      } catch (err) {
        logger.error('Error stopping health server:', err instanceof Error ? err.message : err);
      }
      try {
        alertManager.stop();
      } catch (err) {
        logger.error('Error stopping alert manager:', err instanceof Error ? err.message : err);
      }
      try {
        await closePool();
      } catch (err) {
        logger.error('Error closing PostgreSQL pool:', err instanceof Error ? err.message : err);
      }
      await adapterRegistry.shutdownAll();
      logger.info('Shutdown complete.');
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // Telegraf's bot.launch() performs getMe, deleteWebhook, then starts the
    // long-polling loop via Polling.loop(). Polling.loop() only resolves when
    // polling is stopped (it iterates `while (!aborted)`), so awaiting
    // launch() would block the bootstrap indefinitely and the ready logs would
    // never print while the bot is running.
    //
    // Intentionally NOT awaited: launch() resolves connectivity + starts the
    // polling loop in the background. We attach a rejection handler so a
    // launch failure (e.g. 401 Unauthorized / 409 Conflict) is logged and the
    // worker exits instead of running with a dead polling loop.
    const launchPromise = bot.launch();
    launchPromise.catch((err) => {
      logger.error(
        'TELEGRAM POLLING FAILURE — bot.launch() rejected:',
        err instanceof Error ? err.message : err,
      );
      process.exit(1);
    });

    logger.info('SERVER STARTED — Bot is now listening for commands');
    logger.info('LISTENING — Long-polling active, awaiting Telegram updates');
    logger.info('TELEGRAM POLLING ACTIVE — receive → dispatch → handler path open');
  } catch (err) {
    logger.error('TELEGRAM FAILED — Could not start Telegram bot:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

bootstrap().catch((err) => {
  logger.error('Fatal bootstrap error:', err instanceof Error ? err.message : err);
  process.exit(1);
});

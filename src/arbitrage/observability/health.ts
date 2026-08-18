/**
 * Health Endpoints — /health, /live, /ready (IDEA §49 / AUDIT §50)
 *
 * /live   — process is alive (liveness probe)
 * /ready  — dependencies required for serving are healthy (readiness probe)
 * /health — aggregate health information without leaking secrets
 *
 * These are HTTP endpoints served by a lightweight HTTP server that
 * runs alongside the Telegram bot. They do NOT require Express or any
 * external framework — just Node's built-in http module.
 */
import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { timingSafeEqual } from 'crypto';
import { metricsRegistry } from './metrics';
import { healthCheck as pgHealthCheck } from '../db/pool';
import { adapterRegistry } from '../adapters/registry';
import { logger } from '../lib/logger';

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: Record<string, { healthy: boolean; detail: string }>;
  uptime: number;
  timestamp: string;
  version: string;
}

export interface LivenessStatus {
  status: 'alive';
  uptime: number;
  timestamp: string;
}

export interface ReadinessStatus {
  status: 'ready' | 'not_ready';
  dependencies: Record<string, { ready: boolean; detail: string }>;
  timestamp: string;
}

const APP_VERSION = '2.0.0';
const startTime = Date.now();

function requireAuthForEndpoint(url: string): 'none' | 'optional' | 'required' {
  if (url === '/live' || url === '/ready') return 'none';
  return 'required';
}

function requireAuth(req: IncomingMessage, res: ServerResponse, url: string): boolean {
  if (requireAuthForEndpoint(url) === 'none') return true;
  const apiKey = process.env.ADMIN_API_KEY || process.env.HEALTH_API_KEY;
  if (!apiKey) return true;
  const auth = (req.headers['authorization'] || req.headers['x-admin-api-key'] || '') as string;
  const expected = `Bearer ${apiKey}`;
  if (!auth || !timingSafeEqual(Buffer.from(auth), Buffer.from(expected))) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return false;
  }
  return true;
}

/**
 * Check all dependencies for readiness.
 */
async function checkDependencies(): Promise<Record<string, { ready: boolean; detail: string }>> {
  const deps: Record<string, { ready: boolean; detail: string }> = {};

  // PostgreSQL
  try {
    const pgOk = await pgHealthCheck();
    deps.postgresql = { ready: pgOk, detail: pgOk ? 'connected' : 'not reachable' };
  } catch (err) {
    deps.postgresql = { ready: false, detail: err instanceof Error ? err.message : 'error' };
  }

  // Adapters
  const adapters = adapterRegistry.getActive();
  deps.adapters = {
    ready: adapters.length > 0,
    detail: `${adapters.length} adapter(s) registered`,
  };

  return deps;
}

/**
 * Get aggregate health status.
 */
export async function getHealthStatus(): Promise<HealthStatus> {
  const deps = await checkDependencies();
  const allHealthy = Object.values(deps).every((d) => d.ready);
  const anyReady = Object.values(deps).some((d) => d.ready);

  let status: 'healthy' | 'degraded' | 'unhealthy';
  if (allHealthy) {
    status = 'healthy';
  } else if (anyReady) {
    status = 'degraded';
  } else {
    status = 'unhealthy';
  }

  const checks: Record<string, { healthy: boolean; detail: string }> = {};
  for (const [name, dep] of Object.entries(deps)) {
    checks[name] = { healthy: dep.ready, detail: dep.detail };
  }

  return {
    status,
    checks,
    uptime: Math.floor((Date.now() - startTime) / 1000),
    timestamp: new Date().toISOString(),
    version: APP_VERSION,
  };
}

/**
 * Get liveness status (process is alive).
 */
export function getLivenessStatus(): LivenessStatus {
  return {
    status: 'alive',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Get readiness status (dependencies healthy).
 */
export async function getReadinessStatus(): Promise<ReadinessStatus> {
  const deps = await checkDependencies();
  const allReady = Object.values(deps).every((d) => d.ready);

  return {
    status: allReady ? 'ready' : 'not_ready',
    dependencies: deps,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Start the health HTTP server.
 *
 * Endpoints:
 *   GET /live   → 200 { status: "alive", uptime, timestamp }
 *   GET /ready  → 200/503 { status, dependencies, timestamp }
 *   GET /health → 200 { status, checks, uptime, timestamp, version }
 *   GET /metrics→ 200 (Prometheus text format)
 */
export function startHealthServer(port: number = 9090): Server {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url || '/';

    try {
      if (!requireAuth(req, res, url)) return;

      if (url === '/live') {
        const status = getLivenessStatus();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(status));
        return;
      }

      if (url === '/ready') {
        const status = await getReadinessStatus();
        const code = status.status === 'ready' ? 200 : 503;
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(status));
        return;
      }

      if (url === '/health') {
        const status = await getHealthStatus();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(status));
        return;
      }

      if (url === '/metrics') {
        const text = metricsRegistry.toPrometheusText();
        res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
        res.end(text);
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    } catch (err) {
      logger.error({ msg: 'Health server error', error: err instanceof Error ? err.message : String(err) });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal error' }));
    }
  });

  server.listen(port, '0.0.0.0', () => {
    logger.info(`Health server listening on :${port} (/live, /ready, /health, /metrics)`);
  });

  return server;
}

/**
 * Stop the health server.
 */
export function stopHealthServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      server.unref();
      resolve();
    }, 10000);

    server.keepAliveTimeout = 5000;
    server.headersTimeout = 6000;

    if ('closeAllConnections' in server) {
      (server as any).closeAllConnections();
    }

    server.close(() => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

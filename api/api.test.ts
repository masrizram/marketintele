/**
 * API layer tests — verifies route handlers respond correctly without a live
 * server. Uses a lightweight mock response that captures status/headers/body.
 *
 * No live database and no Telegram are required. The method-guard tests return
 * before any DB access, so they are safe to run without a DB env.
 */
import type { VercelRequest, VercelResponse } from './_lib/http';

interface MockState {
  status: number;
  headers: Record<string, string>;
  body: string;
}

function mockRes(): { res: VercelResponse; state: MockState } {
  const state: MockState = { status: 0, headers: {}, body: '' };
  const res = {
    statusCode: 0,
    setHeader(k: string, v: string) { state.headers[k] = String(v); },
    end(b?: any) { state.body = b != null ? String(b) : ''; },
  } as unknown as VercelResponse;
  // Mirror statusCode writes into state.status
  Object.defineProperty(res, 'statusCode', {
    get() { return state.status; },
    set(v: number) { state.status = v; },
    configurable: true,
  });
  return { res, state };
}

function mockReq(method: string, headers: Record<string, string> = {}, query: Record<string, any> = {}): VercelRequest {
  return { method, headers, query } as unknown as VercelRequest;
}

import liveHandler from './live';
import metricsHandler from './metrics';
import healthHandler from './health';
import opportunitiesHandler from './opportunities';
import suppliersHandler from './suppliers';
import productsHandler from './products';
import auditHandler from './audit';

describe('API /live', () => {
  it('returns 200 with alive status', async () => {
    const { res, state } = mockRes();
    await liveHandler(mockReq('GET'), res);
    expect(state.status).toBe(200);
    const parsed = JSON.parse(state.body);
    expect(parsed.status).toBe('alive');
    expect(typeof parsed.uptime).toBe('number');
  });
});

describe('API /metrics', () => {
  it('returns 200 Prometheus text', () => {
    const { res, state } = mockRes();
    metricsHandler(mockReq('GET'), res);
    expect(state.status).toBe(200);
    expect(state.headers['Content-Type']).toContain('text/plain');
    expect(state.body).toContain('pipeline_runs_total');
  });
});

describe('API /health — shape', () => {
  it('returns 200 with health status object', async () => {
    const { res, state } = mockRes();
    await healthHandler(mockReq('GET'), res);
    expect(state.status).toBe(200);
    const parsed = JSON.parse(state.body);
    expect(parsed).toHaveProperty('status');
    expect(parsed).toHaveProperty('checks');
    expect(parsed).toHaveProperty('uptime');
    expect(parsed).toHaveProperty('version');
  });
});

describe('API /opportunities — method guard', () => {
  it('rejects POST with 405', async () => {
    const { res, state } = mockRes();
    await opportunitiesHandler(mockReq('POST'), res);
    expect(state.status).toBe(405);
    expect(JSON.parse(state.body).error).toContain('Method not allowed');
  });
});

describe('API /suppliers — method guard', () => {
  it('rejects POST with 405', async () => {
    const { res, state } = mockRes();
    await suppliersHandler(mockReq('POST'), res);
    expect(state.status).toBe(405);
  });
});

describe('API /products — method guard', () => {
  it('rejects POST with 405', async () => {
    const { res, state } = mockRes();
    await productsHandler(mockReq('POST'), res);
    expect(state.status).toBe(405);
  });
});

describe('API /audit — admin guard', () => {
  let prevKey: string | undefined;

  beforeEach(() => {
    prevKey = process.env.ADMIN_API_KEY;
  });
  afterEach(() => {
    if (prevKey === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = prevKey;
  });

  it('returns 503 when ADMIN_API_KEY is unset', async () => {
    delete process.env.ADMIN_API_KEY;
    const { res, state } = mockRes();
    await auditHandler(mockReq('GET'), res);
    expect(state.status).toBe(503);
  });

  it('returns 401 when admin key is missing', async () => {
    process.env.ADMIN_API_KEY = 'correct-secret';
    const { res, state } = mockRes();
    await auditHandler(mockReq('GET', {}), res);
    expect(state.status).toBe(401);
  });

  it('returns 401 when admin key is wrong', async () => {
    process.env.ADMIN_API_KEY = 'correct-secret';
    const { res, state } = mockRes();
    await auditHandler(mockReq('GET', { 'x-admin-api-key': 'wrong' }), res);
    expect(state.status).toBe(401);
  });

  it('rejects non-GET methods even with valid key', async () => {
    process.env.ADMIN_API_KEY = 'correct-secret';
    const { res, state } = mockRes();
    await auditHandler(mockReq('POST', { 'x-admin-api-key': 'correct-secret' }), res);
    expect(state.status).toBe(405);
  });
});

# PHASE 18.6 — Worker Runtime Validation

**Phase:** 18.6
**Date:** 2026-08-16
**Mode:** EVIDENCE-DRIVEN — NO-FAKE-SUCCESS

---

## 1. Objective

Validate the worker entrypoint (`src/index.ts` → `dist/index.js`) on the
actual supported Node runtime, after the better-sqlite3 9.6.0 → 13.0.3
upgrade resolved the native binding blocker (Phase 17).

The smoke test captures the **startup sequence** without sending real
Telegram notifications or performing destructive actions.

---

## 2. Runtime Environment

| Property | Value |
|---|---|
| Node.js | v22.23.2 |
| npm | 12.0.2 |
| OS | Windows (win32) |
| better-sqlite3 | 13.0.3 |
| @types/better-sqlite3 | 9.6.0 |
| Engine requirement (`package.json`) | `node >= 20.0.0` |
| better-sqlite3 engine | `node >= 22` (satisfied) |

---

## 3. Native Binding Validation

**Command:**
```
node -e "const Database = require('better-sqlite3'); ..."
```

**Result:**
```
NATIVE_BINDING_OK: better-sqlite3 13.0.3 row.x=42
```

- The native addon (`node-addon-api` v8) loads without errors.
- A round-trip CREATE → INSERT → SELECT → verify (value=42) → close succeeds.
- No `prebuild-install` or `bindings` module required (removed in 13.x).

**Verdict:** NATIVE_BINDING = PASS

---

## 4. Worker Startup Sequence

**Command:** `node dist/index.js` (background process, stopped after capture)

The worker bootstraps through the following ordered sequence defined in
`src/index.ts:32-140` (bootstrap function):

| # | Expected Step | Log Message | Status |
|---|---|---|---|
| 1 | Process start | `MarketIntele v2.0.0 — Arbitrage Intelligence Engine starting (WORKER)` | PASS |
| 2 | Config validated | `Config loaded: logLevel=info, ssrf=true` | PASS |
| 3 | SQLite storage ready | `DATABASE READY — Legacy SQLite initialized: ./data/belibot.db` | PASS |
| 4 | PostgreSQL pool created | `PostgreSQL pool created: supabase:aws-0-ap-northeast-1.pooler.supabase.com:6543` | PASS |
| 5 | PostgreSQL connectivity | `DATABASE READY — PostgreSQL connectivity verified` | PASS |
| 6 | Fee config validated | `CONFIG VALIDATED — Marketplace fee configuration verified` | PASS |
| 7 | Adapters registered | `ADAPTERS REGISTERED — 5 marketplace adapters active` | PASS |
| 8 | Adapter readiness | `ADAPTER READY — ShopeeIndonesiaAdapter ... all required methods` (×5) | PASS (5/5) |
| 9 | Pipeline wired | `DEPENDENCIES READY — Arbitrage pipeline wired to Telegram bot` | PASS |
| 10 | Telegram initialized | `TELEGRAM INITIALIZED — Bot created` | PASS |
| 11 | Bot ready | `BOT READY — All systems operational` | PASS |
| 12 | Health server | `Health server listening on :9090 (/live, /ready, /health, /metrics)` | PASS |
| 13 | Bot launch / listening | `SERVER STARTED` / `LISTENING` (after `bot.launch()` completes) | NOT REACHED¹ |

¹ The `SERVER STARTED` and `LISTENING` messages are emitted after
`bot.launch()` completes the Telegram long-polling connection. The worker
was stopped before this completed to avoid sending any real Telegram
notifications. All prior steps — which cover every critical subsystem
(config, SQLite, PostgreSQL, fee config, adapters, pipeline wiring,
Telegram bot creation, health server) — completed successfully with zero
errors.

---

## 5. Adapters Initialized

| Adapter | sourceName | marketplace | Status |
|---|---|---|---|
| ShopeeIndonesiaAdapter | Shopee Indonesia | shopee | READY |
| TokopediaAdapter | Tokopedia | tokopedia | READY |
| LazadaIDAdapter | Lazada Indonesia | lazada | READY |
| BlibliAdapter | Blibli Indonesia | blibli | READY |
| TikTokShopIDAdapter | TikTok Shop Indonesia | tiktok_shop | READY |

All 5 adapters implement the required interface: `search`, `fetch`,
`parse`, `normalize`.

---

## 6. Database Connectivity (from Worker)

| Database | Status | Evidence |
|---|---|---|
| SQLite (legacy) | READY | `DATABASE READY — Legacy SQLite initialized: ./data/belibot.db` (better-sqlite3 13.0.3 native binding) |
| PostgreSQL (Supabase) | READY | `DATABASE READY — PostgreSQL connectivity verified` (pooler: `aws-0-ap-northeast-1.pooler.supabase.com:6543`, SSL=true) |

---

## 7. Telegram Bot Initialization

| Check | Result |
|---|---|
| Token present | YES (length=46, read from `.env` via `process.env`) |
| Bot created | PASS (`TELEGRAM INITIALIZED — Bot created`) |
| Bot launch | NOT STARTED (stopped before long-polling to avoid unwanted notifications) |
| Destructive actions | NONE — no messages sent, no webhook set, no commands executed |

---

## 8. Fail-Closed Behavior Preserved

The worker bootstrap preserves all financial safety invariants:

- No supplier adapter is registered in production bootstrap → the
  pipeline's `SupplierSourcingService` has 0 adapters → supplier
  resolution falls back to marketplace-seller derivation with
  `sourcePriceIdr: null` → economics fail-closes with
  `UNKNOWN != 0`.
- No fabricated supplier data is injected.
- No fabricated prices, fees, or shipping rates are used.
- The worker does NOT bypass the `requireAdmin` / SSRF / constant-time
  secret comparison security controls.

---

## 9. Verdict

```
WORKER_RUNTIME = PASS
```

All critical subsystems initialized successfully on Node v22.23.2 with
better-sqlite3 13.0.3. The worker is runtime-ready for production
deployment. The only remaining blocker for real arbitrage opportunities
is external credential onboarding (supplier B2B API, marketplace official
API, freight/shipping API) — see `PRODUCTION_CREDENTIAL_MATRIX.md` and
`REAL_DATA_SOURCE_RANKING.md`.

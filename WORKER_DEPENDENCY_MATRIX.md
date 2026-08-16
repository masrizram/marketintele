# PHASE 17.3 — Worker Dependency Matrix

**Phase:** 17.3 (analysis only — no code modified)
**Date:** 2026-08-16
**Scope:** Classify every SQLite / better-sqlite3 dependency in the worker to determine whether SQLite is still required.

---

## 1. Worker Architecture Summary

The worker (`src/index.ts`) is the **persistent runtime** that runs the Telegram bot. It is NOT deployed to Vercel (the serverless API excludes it via the import boundary). The worker bootstraps:

1. Config validation (`requireWorkerConfig`)
2. **Legacy SQLite init** (`initDb`) ← the dependency under analysis
3. PostgreSQL health check
4. Fee config validation
5. Marketplace adapter registration (5 adapters)
6. Health/metrics HTTP server (port 9090)
7. Telegram bot launch (Telegraf polling)

The worker hosts **two parallel feature paths**:
- **Legacy "belibot" promo path** — `/cari`, `/rp0`, `/murah`, `/setbudget`, `/history` commands → legacy scrapers + engine. **This is the only path that uses SQLite.**
- **Arbitrage pipeline path** — `/arbitrage` command → `ArbitragePipeline` → PostgreSQL. **Does NOT use SQLite.**

---

## 2. SQLite Dependency Chain (verified by grep)

```
better-sqlite3 (npm)
  └── src/legacy/database/index.ts   (ONLY importer of the native package)
        ├── initDb()          creates the DB file + tables
        ├── getDb()           returns the singleton Database handle
        ├── upsertUser()      writes user preferences
        ├── getUser()         reads user preferences
        ├── insertPromo()     writes a promo record
        ├── insertPromoHistory() writes promo search history
        ├── getPromoHistory() reads promo search history
        └── getAllPromos()    reads all promos
              │
              ▼
        src/legacy/bot/handlers.ts   (ONLY consumer of the above functions)
              │
              ▼
        src/index.ts  (worker entrypoint — calls initDb at bootstrap + wires bot)
```

**Confirmed by grep:** No file under `api/`, `src/arbitrage/`, `src/legacy/engine/`, or `src/legacy/scrapers/` imports `legacy/database` or `better-sqlite3`. The dependency is fully contained in the worker path.

---

## 3. SQLite Tables & Their Classification

`src/legacy/database/index.ts` creates 3 tables:

| Table | Purpose | Used by | Classification |
|---|---|---|---|
| `users` | Telegram user preferences (budget, marketplaces, categories, keywords, notification settings, search mode) | bot handlers `/start`, `/setbudget`, `/setmarketplace`, `/setkategori`, `/setnotifikasi`, `sendSearchResults`, `/murah` | **A. Truly required runtime state** (by the legacy bot path) — but **replaceable** with PostgreSQL |
| `promos` | Cached promo records (product/seller/price/fees/discounts/verification) | `insertPromo` (NOT called by any handler in `handlers.ts`) | **D. Dead code** at the handler level — the function exists but no bot command invokes it; promos are not persisted, only displayed |
| `promo_history` | Log of promo search results sent to a user (user_id, promo_id, marketplace, product_name, checkout_total, action) | bot handlers `sendSearchResults` (after search), `/history` (read) | **A. Truly required runtime state** (by the legacy bot path) — but **replaceable** with PostgreSQL |

---

## 4. Per-Function Dependency Classification

| Function | Called by | Stores | Class |
|---|---|---|---|
| `initDb` | `src/index.ts` (bootstrap), `handlers.ts` (4 commands) | creates DB + schema | A — required to run the legacy path |
| `upsertUser` | `/start`, `/setbudget`, `/setmarketplace`, `/setkategori`, `/setnotifikasi` | user prefs | A — required; replaceable with PG `suppliers`-style table or a new `bot_users` table |
| `getUser` | `sendSearchResults`, `/murah` | reads user prefs | A — required; replaceable |
| `insertPromoHistory` | `sendSearchResults` | search result log | A — required; replaceable with PG |
| `getPromoHistory` | `/history` | reads search result log | A — required; replaceable |
| `insertPromo` | **none** (no handler calls it) | promo cache | **D — dead code** |
| `getAllPromos` | **none** (no handler calls it) | promo cache read | **D — dead code** |

---

## 5. Is SQLite Still Required by the Worker?

**Short answer: NO, not architecturally.** SQLite is a **legacy local-only persistence layer** for the belibot promo feature. Every table it holds is **replaceable** with PostgreSQL (which the worker already connects to for the arbitrage pipeline).

**However:** SQLite is currently the **only** store for user preferences and promo history. Removing it without migrating that state to PostgreSQL would **lose user preferences and history**. The worker `bootstrap()` calls `initDb` and exits(1) on failure, so the bot will not start without SQLite today.

### Classification summary

| Dependency | Class | Notes |
|---|---|---|
| `users` table | **A → C** | Truly required by legacy bot, but replaceable with PostgreSQL |
| `promo_history` table | **A → C** | Truly required by legacy bot, but replaceable with PostgreSQL |
| `promos` table + `insertPromo` + `getAllPromos` | **D** | Dead code — no handler uses it |
| `better-sqlite3` native binding | **B** | Legacy compatibility — only needed because the above tables exist locally |
| `initDb` at bootstrap | **A** | Required *today* to start the bot; removable once state migrates to PG |

---

## 6. SSRF / Security Notes

- SQLite holds **no financial data** and **no secrets** — only user prefs (budget, marketplace filters) and a search-action log.
- The arbitrage pipeline (the financially-integrity-critical path) does **not** touch SQLite at all; it uses PostgreSQL exclusively.
- Therefore SQLite poses **no financial-integrity risk**. Its only risk is **operational** (native binding failure prevents the worker from booting).

---

## 7. Conclusion

SQLite is **not architecturally required** — it is a legacy local-persistence layer that can be fully replaced by PostgreSQL. The `promos` table and two of its accessor functions are **dead code**. The `users` and `promo_history` tables are **replaceable state** (Class C) currently implemented locally (Class A usage).

The decision on *whether and how* to remediate `better-sqlite3` is scored in Phase 17.4. **Per the hard safety rules, the legacy SQLite implementation is NOT deleted until all required state and behavior have been mapped and verified** — this matrix constitutes that mapping.

# PHASE 17.4 — better-sqlite3 Remediation Decision

**Phase:** 17.4 (decision + scoring — no code modified in this sub-phase)
**Date:** 2026-08-16

---

## 1. Root-Cause Evidence

### 1.1 The failure

Instantiating `better-sqlite3` on this machine (Node v22.23.2, win32-x64) fails:

```
Could not locate the bindings file. Tried:
 → .../build/Release/better_sqlite3.node
 → .../compiled/22.23.2/win32/x64/better_sqlite3.node
 → .../lib/binding/node-v127-win32-x64/better_sqlite3.node
 (all paths missing)
```

### 1.2 Why it fails

| Factor | Value | Source |
|---|---|---|
| Installed version | `better-sqlite3@9.6.0` | `package.json` / `package-lock.json` |
| Node runtime | v22.23.2 (ABI `node-v127`) | `node -v` |
| Vercel install command | `npm ci --ignore-scripts` | `vercel.json` |
| 9.6.0 build model | `node-gyp` native compilation (`gypfile`, `binding.gyp` present) | package contents |
| Prebuilt binary for node-v127 / win32-x64 | **NONE shipped** | binding search above |
| Result | `--ignore-scripts` skips compilation → no `.node` binding → `new Database()` throws | runtime test |

**Conclusion:** better-sqlite3@9.6.0 requires on-device native compilation. Vercel's `--ignore-scripts` (correctly used to keep serverless builds safe and fast) prevents that compilation, and 9.6.0 ships no prebuilt binary for Node 22's ABI. This is an environment + version mismatch, not a code defect.

### 1.3 Note on local success

`require('better-sqlite3')` appears to "load OK" at first because the module resolves lazily; the failure surfaces only when the native binding is actually loaded (`new Database(...)`). The earlier Phase 16 "loads OK" observations were at the require level, not at instantiation. This phase corrects that evidence.

---

## 2. Options Evaluated

### OPTION A — Upgrade better-sqlite3 to v13.x (prebuilt binaries)

**Latest:** `better-sqlite3@13.0.3`
- `engines.node: ">=22"` — explicitly supports Node 22.
- `gpgfile: false` — no node-gyp compilation required.
- `exports` map ships **prebuilt platform binaries**: `./win32-x64`, `./linux-x64`, `./darwin-x64`, `./linux-arm64`, `./win32-arm64`, `./darwin-arm64`, `./linuxmusl-x64`, `./linuxmusl-arm64`.
- Works under `npm ci --ignore-scripts` because the binaries are fetched as optional platform packages, not compiled.
- API is compatible (same `Database` class, prepared statements, pragmas).

### OPTION B — Pin Node to a compatible LTS version (e.g. Node 20)

- Node 20 LTS ABI is `node-v115`. better-sqlite3@9.6.0 ships prebuilt binaries for node-v115.
- Would require changing the deployment Node version (Vercel Node runtime + local).
- `engines.node` is currently `>=20.0.0`, so Node 20 is already permitted.

### OPTION C — Remove SQLite entirely; migrate worker state to PostgreSQL/Supabase

- Per the Worker Dependency Matrix (17.3): only `users` and `promo_history` are required; `promos` is dead code.
- Both required tables are replaceable with PostgreSQL tables (a `bot_users` + `bot_search_history` migration).
- Removes the native dependency permanently.
- Higher implementation effort (migration + rewrite of `src/legacy/database/index.ts` + bot handlers).

### OPTION D — Hybrid transition

- Short-term: Option A (upgrade to v13) to unblock the worker immediately.
- Long-term: Option C (migrate state to PG, remove SQLite) as a follow-up phase.
- Preserves the legacy implementation until state is mapped + verified (per hard safety rule 13).

---

## 3. Scoring Matrix

Score 1 (worst) → 5 (best).

| Criterion | Option A (upgrade v13) | Option B (pin Node 20) | Option C (remove SQLite → PG) | Option D (hybrid) |
|---|---|---|---|---|
| **Compatibility** (Node 22/24 + Vercel ignore-scripts) | 5 — prebuilt binaries, no compile | 3 — works but downgrades Node from 22→20; future Node 24 re-breaks | 5 — no native dep at all | 5 (A now, C later) |
| **Reliability** (no binding surprises) | 4 — depends on prebuilt availability per platform | 3 — re-breaks on next Node major | 5 — pure JS + PG | 5 (end state) |
| **Migration risk** | 2 — minor API compat check; same table schemas | 5 — no code change, only runtime | 2 — requires migration + handler rewrite + data migration | 3 — staged lowers risk |
| **Operational complexity** | 4 — drop-in dependency bump | 3 — must manage Node version pin platform-wide | 3 — one fewer runtime store, but new PG tables to operate | 3 |
| **Maintenance burden** | 4 — still maintain a native dep + its platform matrix | 2 — recurring break on every Node major | 5 — no native dep; PG already operated | 4 (end state) |
| **Production safety** (no destabilization) | 4 — worker-only change; API untouched | 4 — runtime-only change | 3 — touches worker state path | 4 — staged |
| **Weighted total** | **23 / 30** | **20 / 30** | **23 / 30** | **24 / 30** |

---

## 4. Decision

### PRIMARY: OPTION D (Hybrid) — highest-scoring and safest

**Immediate (this phase, verifiable):** Implement **Option A** — upgrade `better-sqlite3` from `^9.6.0` to `^13.0.3`. This unblocks the worker on Node 22/24 + Vercel `--ignore-scripts` using shipped prebuilt binaries, with no code changes required (the API is compatible).

**Deferred (Phase 18):** Plan **Option C** — migrate `users` and `promo_history` to PostgreSQL, delete the `promos` dead code, and remove `better-sqlite3` entirely. This is deferred because:
- It requires a new migration (`0002-bot-state.sql`) with `bot_users` + `bot_search_history` tables.
- It requires rewriting `src/legacy/database/index.ts` to use the PG pool.
- It requires rewriting the bot handlers' persistence calls.
- It requires a data migration path for existing local SQLite user prefs (out of scope for "do not destabilize").

**Rationale for D over C-now:** Option C scores equally on total but has higher *immediate* migration risk (touches worker state + requires data migration) and the hard safety rules forbid removing SQLite until state is mapped and verified (rule 13) — the mapping is now complete (17.3), but the *verification* (migrated tables + handlers + tests) is multi-step work better suited to a dedicated phase. Option D captures the immediate unblock (A) while sequencing the full removal (C) safely.

### Why not Option B (pin Node 20)

Pinning to Node 20 is a regression: it downgrades the runtime from the currently-supported Node 22, and it **re-breaks on the next Node major** (24), creating a recurring maintenance trap. It also does not solve the underlying fragility (native compilation dependency). It scores lowest on maintenance burden.

---

## 5. Implementation Plan for Option A (immediate)

1. Update `package.json`: `better-sqlite3` `^9.6.0` → `^13.0.3`.
2. Update `@types/better-sqlite3` to a compatible version (if needed).
3. Run `npm install` (prebuilt binary fetched, no compile).
4. Verify `new Database(':memory:')` instantiates successfully on Node 22.
5. Run `npm test` — all 545 tests must still pass (no test weakening).
6. Run `npm run build` + `npm run build:api` + `npm run typecheck` + `npm run lint`.
7. Confirm the API/serverless bundle still excludes SQLite (no import path change).
8. Update `package.json` `allowScripts` entry if present.

**Risk to the live Vercel API: NONE.** The API does not import `better-sqlite3`; only the worker does. The version bump affects the worker only. The serverless bundle is unaffected.

**Per hard safety rule 13:** The legacy SQLite implementation is NOT deleted. Only the dependency version is bumped. State tables and handlers remain unchanged.

---

## 6. Verification Gate (must pass before declaring 17.4 complete)

- [x] `new Database(':memory:')` works on Node v22.23.2 — verified: prebuilt `win32-x64.node` present; `INSERT/SELECT` round-trip succeeds
- [x] `npm test` — 545/545 pass (34 suites, 0 failures, no tests weakened)
- [x] `npm run build` PASS (tsc exit 0)
- [x] `npm run build:api` PASS (tsc -p tsconfig.api.json exit 0)
- [x] `npm run typecheck` PASS (tsc --noEmit exit 0)
- [x] `npm run lint` PASS (0 errors; 110 pre-existing `any` warnings unchanged)
- [x] No SQLite in serverless bundle (import graph unchanged; `api/_lib/http.ts` still excludes SQLite)

**Result: OPTION A implemented and verified. The worker native-binding blocker is resolved.**

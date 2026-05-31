# Nexus Terminal - HANDOFF.md

> Updated: 2026-05-31
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and durable docs such as `docs/repo-cleanup.md`.

Historical completed sections (Sprints 1-11, Tier 1 Cleanup, Chart Drawings, Multi-Day Charts, CSV/Cover-Close flows, Workflow Maintenance) were removed to keep this file focused. Use git history and `docs/repo-cleanup.md` (Completed) for archived implementation detail.

---

## Sprint 13 — Remove Dashboard MDR Scans

> Generated: 2026-05-31 | Agent: Codex (`$nexus-handoff`)
> Status: COMPLETE — validated 2026-05-31

### Objective

Remove the Dashboard MDR scan surface and all live/runtime logic that calculates or serves MDR scan candidates. Keep the existing `mdr_triggers` database table, historical data, and `lib/db/schema.ts` mapping in place for now; a later migration will drop that table.

This is a Dashboard scanner retirement, not a repo-wide ban on the string "MDR". Swing-trader agent research language and tests that describe MDR-style pattern matching are out of scope unless they import or call the Dashboard scan runtime.

### Current State

- `components/trading/DashboardTab.tsx` renders `DashboardScannerTable` under the "Scanners" heading.
- `components/trading/DashboardScannerTable.tsx` renders two tables:
  - Day 1 Setup table from `gainers`.
  - Potential MDR Setup table from `mdrLive` and `mdrRecent`.
- `app/api/dashboard/scanner-state/route.ts` aggregates:
  - `fetchGainersForDashboard()` from `app/api/tradingview/gainers/route.ts`.
  - `fetchMdrCandidatesForDashboard()` from `app/api/tradingview/mdr-candidates/route.ts`.
  - `fetchMdrRecentForDashboard(db)` from `app/api/scanner/mdr-recent/route.ts`.
  - The response shape currently includes `mdrLive` and `mdrRecent`.
- `app/api/tradingview/mdr-candidates/route.ts` owns the live TradingView MDR candidate scan and calls `evaluateLatestD2MdrTrigger()`.
- `app/api/scanner/mdr-recent/route.ts` reads `mdr_triggers`, fetches Massive snapshots, and enriches rows with MDR thresholds.
- `app/api/cron/mdr-sweep/route.ts` populates and invalidates `mdr_triggers`; `vercel.json` schedules it at `/api/cron/mdr-sweep`.
- `lib/massive-market.ts` contains MDR-specific evaluator/threshold helpers:
  - `D2MdrTriggerResult`
  - `MdrThresholds`
  - `D2MdrDailyEvaluation`
  - `evaluateD2MdrTrigger`
  - `calculateMdrThresholds`
  - `evaluateD2MdrDailySeries`
  - `evaluateLatestD2MdrTrigger`
  - `isInvalidationDay`
- `lib/massive-market.ts` also contains non-MDR Massive helpers that must remain:
  - `fetchUnifiedSnapshot`
  - `fetchDailyAggregates`
  - `fetchGroupedDailyAggregates`
  - `GroupedDailyBar`
  - `fetchTickerNews`, market movers, ticker details, etc.
- `lib/db/schema.ts` exports `mdrTriggers`. Keep this export and table mapping until the later DB migration.

### Required Changes

#### 1. Remove MDR from the Dashboard aggregate route

**File:** `app/api/dashboard/scanner-state/route.ts` — **MODIFY**

- Remove imports from:
  - `@/app/api/scanner/mdr-recent/route`
  - `@/app/api/tradingview/mdr-candidates/route`
- Remove `DashboardMdrRecentPayload` and `DashboardMdrCandidatesPayload` from `AggregatePayload`.
- Remove `mdrLive` and `mdrRecent` fields from `AggregatePayload`.
- Change the fan-out from three helpers to only `fetchGainersForDashboard()`.
- Remove warning branches for `mdr-candidates` and `mdr-recent`.
- Keep the existing DB-backed 8s aggregate cache in `askedgar_cache`.
- Keep auth, DB guard, `dynamic`, `maxDuration`, cache read/write behavior, and error handling unchanged.

Expected post-change payload shape:

```ts
interface AggregatePayload {
  gainers: DashboardGainersPayload['gainers'];
  isRealtime: boolean;
  fetchedAt: string;
}
```

#### 2. Remove Dashboard MDR UI and client merge logic

**File:** `components/trading/DashboardScannerTable.tsx` — **MODIFY**

- Remove MDR-only interfaces and types:
  - `MdrCandidate`
  - `MdrRecentRow`
  - `MarketSession` if no longer needed after MDR removal.
- Remove MDR-only helpers:
  - `getMarketSession`
  - `sessionMark`
  - `fmtDollarOrDash`
  - `fmtPercentOrDash`
  - `thresholdClass`
- Remove MDR state:
  - `mdrLive`
  - `mdrRecent`
- Update the `/api/dashboard/scanner-state` response type to only read `gainers`, `isRealtime`, and `fetchedAt`.
- Remove `setMdrLive(...)` and `setMdrRecent(...)`.
- Remove the `mdrRows` `useMemo`.
- Remove the entire "Potential MDR Setup" table/card from the JSX.
- Keep the Day 1 Setup table, Day 1 localStorage latch, scanner-summary enrichment, polling interval, and row navigation behavior unchanged.
- Review copy after removal. If only one scanner remains, keep `DashboardTab.tsx` title as "Scanners" unless the executor sees a clearly better minimal wording change; do not redesign the Dashboard.

#### 3. Delete Dashboard MDR runtime routes

**Files:** **DELETE**

- `app/api/tradingview/mdr-candidates/route.ts`
- `app/api/scanner/mdr-recent/route.ts`
- `app/api/cron/mdr-sweep/route.ts`

These routes should have no remaining imports after steps 1 and 4. Do not leave route files with no HTTP method just to satisfy path stability; the feature is being retired.

#### 4. Remove MDR cron schedule

**File:** `vercel.json` — **MODIFY**

- Remove the cron entry:

```json
{
  "path": "/api/cron/mdr-sweep",
  "schedule": "0 22 * * 1-5"
}
```

- Keep the `agent-retention` and `market-pulse-eod` cron entries unchanged.

#### 5. Remove now-dead MDR evaluator code, but keep shared Massive helpers

**File:** `lib/massive-market.ts` — **MODIFY**

- Remove the MDR-specific exports listed in Current State:
  - `D2MdrTriggerResult`
  - `MdrThresholds`
  - `D2MdrDailyEvaluation`
  - `evaluateD2MdrTrigger`
  - `calculateMdrThresholds`
  - `evaluateD2MdrDailySeries`
  - `evaluateLatestD2MdrTrigger`
  - `isInvalidationDay`
- Remove private helpers only used by those MDR exports:
  - `NULL_MDR_THRESHOLDS`
  - `round2`
  - `lastFinite` if no other code uses it
  - `dailyBarTime` if no other code uses it
  - `toGroupedDailyBar`
  - `toOhlcData`
  - `indicatorContext`
- Remove the `atr`, `ema50`, and `OHLCData` import from `@/lib/indicators` if it becomes unused.
- Keep `DailyOhlcBar`, `GroupedDailyBar`, `fetchDailyAggregates`, and `fetchGroupedDailyAggregates`; `lib/market-pulse/capture.ts` still uses the grouped aggregate helper and type.
- Rename or remove the stale `// MDR cron helpers` section comment so the remaining grouped aggregate helper is not documented as MDR-only.

#### 6. Keep database schema/table until the later migration

**File:** `lib/db/schema.ts` — **NO CHANGE**

- Do not delete `mdrTriggers`.
- Do not generate or run a migration.
- Do not remove historical data.
- The schema export is intentionally retained as a temporary table mapping until the later explicit migration drops `mdr_triggers`.

#### 7. Update or delete tests to match the retired surface

**Files:** **MODIFY / DELETE**

- `__tests__/dashboard-scanner-state-route.test.ts` — **MODIFY**
  - Remove mocks for `fetchMdrCandidatesForDashboard` and `fetchMdrRecentForDashboard`.
  - Update cached payloads and expected responses to exclude `mdrLive` and `mdrRecent`.
  - Update helper-call assertions so only `fetchGainersForDashboard` is expected.
  - Preserve coverage for:
    - fresh cache row returns without fan-out
    - cache miss fans out and upserts
    - TTL expiry refreshes
    - gainer helper failure returns fallback payload and caches it
    - cache upsert failure still returns payload
    - DB unavailable returns 503 without calling helpers
- `__tests__/dashboard-scanner-table.test.tsx` — **MODIFY**
  - Remove MDR fixture types, `MDR_STORAGE_KEY`, `mdrLiveBatches`, and `mdrRecentRows`.
  - Remove the test that renders merged MDR live/recent rows.
  - Update fetch mock payloads so `/api/dashboard/scanner-state` returns only `gainers`, `isRealtime`, and `fetchedAt`.
  - Add or keep an assertion that "Potential MDR Setup" and "No MDR setups detected." are not rendered.
  - Keep Day 1 latch and scanner-summary tests intact.
- `__tests__/tradingview-mdr-candidates-route.test.ts` — **DELETE**
- `__tests__/massive-market.test.ts` — **DELETE** if it contains only MDR evaluator/threshold tests. If non-MDR coverage is added before execution, delete only the MDR cases.

#### 8. Clean stale docs references introduced by this retirement

**Files:** **MODIFY**

- `docs/repo-cleanup.md`
  - Remove or rewrite the old Dashboard MDR threshold/caching cleanup note so it no longer asks future agents to optimize a retired scan.
  - Keep completed-history bullets if they describe past work, but do not leave active TODOs for MDR Dashboard scans.
- `docs/scanner-build.md`
  - Mark MDR replacement content as stale/retired or remove references that describe MDR as an active Dashboard target.
  - Preserve Day 1/custom scanner material that remains relevant.

### Acceptance Criteria

- [x] Dashboard renders only the Day 1 scanner table; no "Potential MDR Setup" UI or empty MDR message remains.
- [x] `/api/dashboard/scanner-state` returns only Day 1 aggregate data (`gainers`, `isRealtime`, `fetchedAt`) and no longer imports or calls MDR helpers.
- [x] `app/api/tradingview/mdr-candidates/route.ts`, `app/api/scanner/mdr-recent/route.ts`, and `app/api/cron/mdr-sweep/route.ts` are deleted.
- [x] `vercel.json` no longer schedules `/api/cron/mdr-sweep`.
- [x] MDR candidate/evaluator/threshold exports are removed from `lib/massive-market.ts`.
- [x] No live import references remain for `mdr-candidates`, `mdr-recent`, `mdr-sweep`, `evaluateD2Mdr*`, `calculateMdrThresholds`, `MdrThresholds`, or `isInvalidationDay`.
- [x] `lib/db/schema.ts` still contains `mdrTriggers`; no migration is generated or run.
- [x] Tests no longer assert MDR Dashboard behavior and still cover Day 1 Dashboard scanner behavior.
- [x] Stale docs no longer tell future agents to optimize or preserve retired Dashboard MDR scans.

### Search Checks

Run these before validation and resolve any unexpected hits:

```bash
rg -n "mdr-candidates|mdr-recent|mdr-sweep|evaluateD2Mdr|evaluateLatestD2MdrTrigger|calculateMdrThresholds|MdrThresholds|isInvalidationDay" app components hooks lib __tests__ docs specs vercel.json
rg -n "Potential MDR Setup|No MDR setups detected|mdrLive|mdrRecent" components __tests__
```

Expected remaining MDR hits after implementation:

- `lib/db/schema.ts` table mapping and comments for `mdrTriggers`.
- Historical or non-Dashboard agent references such as swing-trader research prompts/tests, if they do not import retired Dashboard scan code.
- Any docs explicitly marked as historical/retired.

### Security / Cost Notes

- Removing the MDR Dashboard routes reduces TradingView and Massive API calls.
- Keep `MASSIVE_API_KEY` server-side; do not touch `.env*`.
- No auth model changes.
- No database migration in this sprint.

### Order Of Operations

1. Remove MDR fields/calls from `app/api/dashboard/scanner-state/route.ts`.
2. Remove MDR state/rendering from `components/trading/DashboardScannerTable.tsx`.
3. Delete the retired MDR route files.
4. Remove the Vercel cron entry.
5. Remove unused MDR evaluator/threshold exports from `lib/massive-market.ts`.
6. Update/delete tests.
7. Update stale docs references.
8. Run the search checks, then validation.

This order keeps TypeScript errors easy to interpret: route/UI consumers are disconnected before deleting providers, then shared helper cleanup follows once imports are gone.

### Validation

From repo root:

- [x] `npm run lint`
- [x] `npx tsc --noEmit`
- [x] `npm test`
- [x] `npm run workflow:audit` (HANDOFF.md and docs changed)
- [x] Do **not** run `npm run db:migrate`; no migration belongs in this sprint.

Validation note: the first full `npm test` run hit a timeout in the unrelated `__tests__/sec-companyfacts.test.ts` stale-cache test. The single file passed on rerun, and the required full `npm test` rerun passed.

### Complexity Estimate

Medium. The runtime removal is straightforward, but the blast radius spans UI, API routes, Vercel cron config, shared Massive helpers, route/component tests, and stale docs. The main risk is deleting a shared Massive helper still used by market pulse or agents; use the search checks before removing exports.

---

## Sprint 12 — Scanner Cost & Telemetry (right-sized)

> Generated: 2026-05-31 | Agent: claude (inline spec, per workflow preference)
> Status: COMPLETE — validated 2026-05-31

Goal: make AskEdgar fan-out cost attributable in logs, and make the dashboard scanner cache durable across Vercel instances. Telemetry is **structured logs only** (no table). MDR threshold caching is **dropped** (MDR scans are being retired). No AskEdgar cache-logic change (TTLs tuned later from the log evidence). **No migration. No UI change.**

Scope locked with Jared 2026-05-31:
- Part A — AskEdgar telemetry = structured stdout logs, no `askedgar_request_log` table.
- Part B — dashboard scanner cache = durable DB row, reusing the existing `askedgar_cache` table (no migration).
- Dropped: MDR threshold caching (MDR being removed later) and any per-endpoint AE TTL refactor.

---

### Part A — Structured per-endpoint AskEdgar fan-out logs

**File:** `lib/askedgar/fanout.ts` — **MODIFY**

Today `fetchTickerData` emits one human-readable aggregate `console.log` line per ticker. Replace it with one structured JSON line per endpoint (so per-endpoint cost is queryable in Vercel logs) plus one structured summary line.

1. Add an optional `surface` to the `opts` param of `fetchTickerData`:
   ```ts
   opts?: { endpoints?: readonly string[]; surface?: string }
   ```
   After the existing `const requested = opts?.endpoints ?? ENDPOINT_SCOPES.snapshot;`, add:
   ```ts
   const surface = opts?.surface ?? 'snapshot';
   ```

2. Leave the batch-of-10 loop and the `endpointStates` construction **untouched** (no per-endpoint timing). Replace ONLY the existing aggregate `console.log( ... )` block (the `[askedgar-fanout] ticker=... requested=... succeeded=... costUsd=... durationMs=...` template literal) with the following, built from the already-constructed `endpointStates`:
   ```ts
   for (const state of endpointStates) {
     console.log(JSON.stringify({
       tag: 'askedgar-endpoint',
       surface,
       ticker: normalizedTicker,
       endpoint: state.key,
       status: state.response.status,          // 'success' | 'error'
       hasData: state.hasData,
       costMicrodollars: state.response.usage?.cost_microdollars ?? 0,
       error: state.response.error ?? null,
     }));
   }
   console.log(JSON.stringify({
     tag: 'askedgar-fanout',
     surface,
     ticker: normalizedTicker,
     requested: requested.length,
     succeeded: endpointStates.filter((s) => s.hasData).length,
     costUsd: Number(sumCostUsd(endpointStates).toFixed(4)),
     durationMs: Date.now() - startedAt,
   }));
   ```
   Do **not** reference `state.response.usage?.duplicate` — that field does not exist on the `usage` type (`{ cost_microdollars?: number }` only). Do **not** add per-endpoint duration.

3. Thread `surface` so each fan-out logs the scope that triggered it. The scope name is known at the cache entry points; pass it down the existing chain into the new `surface` option.

   **File:** `lib/askedgar/cache.ts` — **MODIFY**
   - `getCachedTickerData(ticker, opts?: { scope })` already computes `const scope = opts?.scope ?? 'snapshot';`. Add a `scope: string` parameter to `completeTickerDataForScope(...)` and `fetchAndCacheTickerEndpoints(...)`, and pass `scope` from both `getCachedTickerData` call sites of `completeTickerDataForScope` (the partial-cache path and the empty-result path).
   - In `fetchAndCacheTickerEndpoints`, change the fan-out call from `fetchTickerData(normalizedTicker, { endpoints: requested })` to `fetchTickerData(normalizedTicker, { endpoints: requested, surface: scope })`.
   - No separate change is needed for scanner-summary: `getCachedScannerSummary` already routes through `getCachedTickerData(ticker, { scope: 'scanner-summary' })` (via `fetchScannerSummaryRaw`), so threading `scope` through the chain above automatically attributes those fan-outs as `'scanner-summary'`.
   - The only other `fetchTickerData` reference is the `lib/askedgar.ts` re-export; leave its callers' `surface` defaulting to `'snapshot'`.

**Acceptance criteria:**
- [x] `fetchTickerData` accepts `opts.surface`, defaulting to `'snapshot'`.
- [x] Each fan-out logs one `tag:'askedgar-endpoint'` JSON line per requested endpoint (with `endpoint`, `status`, `hasData`, `costMicrodollars`, `error`) plus one `tag:'askedgar-fanout'` summary line.
- [x] No reference to `usage.duplicate`; no per-endpoint timing; the batch loop is unchanged.
- [x] `surface` reflects the originating scope: ticker/research snapshots log their scope; scanner-summary fetches log `'scanner-summary'`.
- [x] `TickerDataResult` shape is unchanged; `npm run lint` and `npx tsc --noEmit` clean.

---

### Part B — Durable dashboard scanner-state cache (DB row, no migration)

**File:** `app/api/dashboard/scanner-state/route.ts` — **MODIFY**

Replace the module-level `Map` (per-instance, lost on cold start) with a single row in the existing `askedgar_cache` table so the 8s warm cache is shared across Vercel instances. The response JSON contract (`AggregatePayload`) is unchanged.

1. Remove the in-memory cache: delete `interface CachedState`, `const cache = new Map<string, CachedState>();`, and `const CACHE_KEY = 'dashboard-scanner-state';`. Keep `const TTL_MS = 8_000;`. Add:
   ```ts
   const SCANNER_CACHE_TYPE = 'dashboard-scanner-state';
   const SCANNER_CACHE_KEY = 'GLOBAL'; // single shared row; ticker column reused as a fixed key
   ```

2. Add imports (match the file's existing import style):
   ```ts
   import { and, eq, gt } from 'drizzle-orm';
   import { askedgarCache } from '@/lib/db/schema';
   ```

3. In `GET`, after the existing `db` guard (`if (!db) return dbUnavailable();`), replace the in-memory read with a DB read:
   ```ts
   const now = new Date();
   const cachedRows = await db
     .select({ dataJson: askedgarCache.dataJson })
     .from(askedgarCache)
     .where(and(
       eq(askedgarCache.cacheType, SCANNER_CACHE_TYPE),
       eq(askedgarCache.ticker, SCANNER_CACHE_KEY),
       gt(askedgarCache.expiresAt, now),
     ))
     .limit(1);
   if (cachedRows.length > 0) {
     return Response.json(cachedRows[0].dataJson as AggregatePayload);
   }
   ```

4. After `payload` is built (the existing `Promise.allSettled` fan-out is unchanged), replace the old `cache.set(...)` write with an upsert that mirrors the existing `askedgar_cache` upsert pattern in `lib/askedgar/cache.ts`, wrapped so a write failure never fails the request:
   ```ts
   // askedgar_cache is a generic jsonb cache; reused here for the (non-AE) scanner aggregate.
   try {
     const cacheNow = new Date();
     const cacheExpiry = new Date(cacheNow.getTime() + TTL_MS);
     await db.insert(askedgarCache).values({
       id: SCANNER_CACHE_TYPE,
       cacheType: SCANNER_CACHE_TYPE,
       ticker: SCANNER_CACHE_KEY,
       dataJson: payload,
       fetchedAt: cacheNow,
       expiresAt: cacheExpiry,
     }).onConflictDoUpdate({
       target: [askedgarCache.cacheType, askedgarCache.ticker],
       set: { dataJson: payload, fetchedAt: cacheNow, expiresAt: cacheExpiry },
     });
   } catch (error) {
     console.warn('[dashboard:scanner-state] cache write failed:', error);
   }
   return Response.json(payload);
   ```
   (Plain-value `set` matches the existing `askedgar_cache` upserts in `lib/askedgar/cache.ts` — `writeTickerCache`, `getCachedScannerSummary`. Concurrent instances may each recompute once when the row expires — acceptable; same behavior as before, just shared once warm. No locking needed.)

**Acceptance criteria:**
- [x] Module-level `Map` / `CachedState` / `CACHE_KEY` are removed.
- [x] A fresh cached row (`expiresAt > now`) is returned without fanning out.
- [x] On miss, the route fans out, upserts the single row with an 8s expiry, and returns the payload.
- [x] A cache-write failure logs and still returns the computed payload (request never 500s on cache write).
- [x] `AggregatePayload` response shape is unchanged.

**Tests** — `__tests__/dashboard-scanner-state-route.test.ts` — **MODIFY**

Extend the existing `db` stub so it supports the new read chain (`.select().from().where().limit()`) and the write chain (`.insert().values().onConflictDoUpdate()`). Add cases:
- [x] Fresh cached row present → returns it, fan-out helpers NOT called.
- [x] Cache miss (read returns `[]`) → fan-out helpers called, upsert called, payload returned.
- [x] Upsert throws → payload still returned (no 500).
Do not assert on `console` output.

(Part A logging needs no dedicated test — it's stdout only. Keep coverage on the data paths above.)

---

### Files Changed Summary

| File | Action | ~Lines | Risk |
|---|---|---|---|
| `lib/askedgar/fanout.ts` | MODIFY | ~18 | LOW (logging + optional param) |
| `lib/askedgar/cache.ts` | MODIFY | ~8 | LOW (thread `scope` through 2 helpers) |
| `app/api/dashboard/scanner-state/route.ts` | MODIFY | ~30 | MEDIUM (in-memory → DB read/write path) |
| `__tests__/dashboard-scanner-state-route.test.ts` | MODIFY | ~35 | LOW |

No new files. No schema change. No migration.

### Verification Steps

From repo root:
- [x] `npm run lint`
- [x] `npx tsc --noEmit`
- [x] `npm test`
- [x] `npm run workflow:audit` (HANDOFF.md changed)
- [x] Do **not** run `npm run db:migrate` — this sprint adds no migration. If you find yourself writing one, stop and re-read the scope.

Manual (post-deploy):
- [ ] Open the Dashboard; confirm the scanner panel renders identically and refreshes.
- [ ] Open a Research ticker; in Vercel logs confirm `tag:"askedgar-endpoint"` lines (one per endpoint, with `costMicrodollars`) and a `tag:"askedgar-fanout"` summary line, with `surface` set to the right scope.

---

## Implementation Style

Write the simplest correct code that satisfies this spec. Specifically:

- Match the existing conventions in the file you're editing. Do not introduce new patterns, helpers, abstractions, or file layouts unless this spec explicitly calls for them.
- No future-proofing. No feature flags, no "in case we need it later" parameters, no extracted helpers that have a single caller. If a value is only used once, inline it.
- No defensive code at internal boundaries. Trust your own code and framework guarantees; validate only at system boundaries (user input, external APIs, DB reads of untrusted JSON).
- No comments unless the *why* is non-obvious (a hidden constraint, a workaround, a surprising invariant). Don't restate what the code says.
- If a step in this spec looks more complex than it needs to be, flag it and propose the simpler version before implementing — don't silently "improve" the spec, but don't write code that's more elaborate than the problem requires either.
- If you spot an existing simpler pattern in the codebase that fits, use it instead of writing new code.

This is a personal trading platform built solo. Readability > cleverness; debuggable > elegant; small diff > sweeping refactor. Three similar lines beats a premature abstraction.

---

## Session Maintenance

- Keep this file compact: active specs only while work is in flight, short summaries after validation.
- If a new multi-step feature starts, replace or append a self-contained execution spec with exact file paths, ordered changes, acceptance criteria, and validation requirements.
- If only docs/workflow assets change, run `npm run workflow:audit`.
- Do not modify `.env*` or secret files.

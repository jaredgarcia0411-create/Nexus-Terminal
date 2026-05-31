# Nexus Terminal - HANDOFF.md

> Updated: 2026-05-31
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and durable docs such as `docs/repo-cleanup.md`.

Historical completed sections (Sprints 1-11, Tier 1 Cleanup, Chart Drawings, Multi-Day Charts, CSV/Cover-Close flows, Workflow Maintenance) were removed to keep this file focused. Use git history and `docs/repo-cleanup.md` (Completed) for archived implementation detail.

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
</content>

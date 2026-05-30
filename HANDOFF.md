# Nexus Terminal - HANDOFF.md

> Updated: 2026-05-30
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and durable docs such as `docs/repo-cleanup.md`.

Historical completed sections (Sprints 1-5, Tier 1 Cleanup, Chart Drawings, Workflow Maintenance, AskEdgar News Filter Expansion) were removed to keep this file focused. Use git history for archived implementation detail.

---

## AEV2 Sprint 11 — Provider Client Consolidation

> Generated: 2026-05-30 | Agent: Claude (Plan)
> Status: COMPLETE — implemented by Codex on 2026-05-30

### Objective

Kill the duplicated provider-fetch plumbing the audit flagged: every TradingView scan request is hand-rolled in three places, and `/api/market-data` re-implements the Massive aggregates fetch that `lib/massive-market.ts` already owns. Centralize both. Also delete the three raw scanner GET handlers that have no HTTP consumers (the dashboard imports their functions directly). Scanner and chart output must be byte-for-byte unchanged — the existing route tests are the contract.

### Stories

- CLEAN-1101 — Add a single `scanTradingView(body)` owner in `lib/tradingview-client.ts`; route `fetchTradingViewPriceContext`, gainers, and mdr-candidates through it.
- CLEAN-1102 — Add `fetchMassiveAggregateBars(...)` + `MassiveRequestError` + `isMassiveConfigured()` to `lib/massive-market.ts`, and route `/api/market-data` through it while preserving its 503/passthrough/502 status contract.
- CLEAN-1103 — Delete the dead `GET` handlers on the gainers, mdr-candidates, and mdr-recent routes (keep the `fetch*ForDashboard` helpers + types); rewrite the two TradingView route tests to call the helpers directly.

### Current State

- `lib/tradingview-client.ts` already hand-rolls the scan request inside `fetchTradingViewPriceContext` (URL `https://scanner.tradingview.com/america/scan`, header block, `cache:'no-store'`, `if(!ok) throw 'TradingView scanner returned ${status}'`). `app/api/tradingview/gainers/route.ts` (private `fetchScan`, lines ~206-227) and `app/api/tradingview/mdr-candidates/route.ts` (inline `fetch`, lines ~111-126) each repeat the identical request + header block + non-OK throw.
- Both TradingView routes also have an identical `GET` handler that maps the `TradingView scanner returned NNN` throw to a 502 and otherwise returns `internalServerError()`. **Neither GET is fetched over HTTP** — `app/api/dashboard/scanner-state/route.ts` imports `fetchGainersForDashboard`/`fetchMdrCandidatesForDashboard`/`fetchMdrRecentForDashboard` as functions and wraps them in `Promise.allSettled` (a thrown error becomes an empty array + a `console.warn`).
- `app/api/scanner/mdr-recent/route.ts` likewise has a `GET` with no HTTP consumer; its `fetchMdrRecentForDashboard(db)` helper + `MdrRecentRow`/`DashboardMdrRecentPayload` types are what scanner-state uses. Its threshold-enrichment internals are **out of scope** (Sprint 12 owns MDR threshold caching).
- `lib/massive-market.ts` centralizes Massive: `const MASSIVE_BASE_URL = 'https://api.massive.com'` (line 3), `getMassiveApiKey()` (throws if unset), `fetchMassiveJson<T>(path, params)` (sets `apiKey`, `cache:'no-store'`, throws `new Error('Massive request failed: ${status}')` on non-OK), and `fetchDailyAggregates(ticker, days)` which inlines the `/v2/aggs/ticker/.../range/1/day/...` request.
- `app/api/market-data/route.ts` ignores all of that: it hardcodes `https://api.massive.com/v2/aggs/...`, reads `process.env.MASSIVE_API_KEY` directly, and maps errors to **503** (no key), **502** (`fetch` threw), and **upstream status || 502** (non-OK). Consumed over HTTP by `components/trading/BacktestChart.tsx` and `hooks/use-candle-data.ts`. `services/.env.example` documents `MASSIVE_API_BASE_URL` but no code reads it.
- Baseline is green: `npm run lint`, `npx tsc --noEmit`, `npm test` (96 files, 692 tests) all pass as of commit `a72f694`.

### Scope

- **In scope:** `lib/tradingview-client.ts`, `lib/massive-market.ts`, the three scanner route files (gainers, mdr-candidates, mdr-recent), `app/api/market-data/route.ts`, and the two TradingView route tests.
- **Out of scope:** `app/api/scanner/mdr-recent/route.ts` threshold-enrichment logic (`loadThresholdsByTrigger`, `fetchMdrRecentForDashboard` body) — Sprint 12. Do **not** move any `fetch*ForDashboard` helper into `lib/` (the routes keep exporting them, per the chosen plan). Do **not** add durable telemetry or caching (Sprint 12). Do **not** touch `app/api/dashboard/scanner-state/route.ts` or any `.env*` file.

### Decisions Locked For Sprint 11

- **D1. TradingView scan owner.** Add to `lib/tradingview-client.ts`: an exported `TradingViewScanPayload` type `{ totalCount?: number; data?: Array<{ s: string; d: unknown[] }> }` and an exported `async function scanTradingView(body: unknown): Promise<TradingViewScanPayload>` that owns the URL, the header block (reads `process.env.TRADINGVIEW_SESSION_ID?.trim()` and adds `Cookie: sessionid=...` only when set), `method:'POST'`, `cache:'no-store'`, `JSON.stringify(body)`, and `if (!response.ok) throw new Error('TradingView scanner returned ' + response.status)`. This reproduces the exact request all three current call sites build, so `tradingview-client.test.ts` (which asserts the URL, `Cookie`, `Origin`, `body.columns`, `body.filter`, and the `rejects.toThrow('TradingView scanner returned 503')`) stays green.
- **D2. Callers keep their own `sessionId` read for `isRealtime`.** `scanTradingView` reads the env internally for the cookie; gainers and mdr-candidates still need `const sessionId = process.env.TRADINGVIEW_SESSION_ID?.trim() ?? '';` for their `isRealtime: Boolean(sessionId)` field. Reading the env twice in one request is acceptable and keeps the gainers test's `isRealtime`/Cookie assertions intact. Route-specific `COLUMNS`/`SCAN_BODY`/normalization/qualification stay in each route file.
- **D3. Massive aggregates owner.** Add to `lib/massive-market.ts`: `export interface MassiveAggregateBar { o?: number|null; h?: number|null; l?: number|null; c?: number|null; v?: number|null; vw?: number|null; t?: number|null; n?: number|null }` and `export async function fetchMassiveAggregateBars(params: { ticker: string; multiplier: string; timespan: string; from: string; to: string; limit?: number }): Promise<MassiveAggregateBar[]>` that calls `fetchMassiveJson('/v2/aggs/ticker/' + encodeURIComponent(ticker.trim().toUpperCase()) + '/range/' + multiplier + '/' + timespan + '/' + from + '/' + to, { adjusted: 'true', sort: 'asc', limit: String(limit ?? 50000) })` and returns `payload.results ?? []`.
- **D4. Typed Massive error for status passthrough.** Add `export class MassiveRequestError extends Error { constructor(public readonly status: number) { super('Massive request failed: ' + status); this.name = 'MassiveRequestError'; } }` and change `fetchMassiveJson`'s non-OK branch to `throw new MassiveRequestError(response.status)`. The message is byte-identical to the old `new Error(...)`, so every existing `fetchMassiveJson` caller is unaffected; only `/api/market-data` will `instanceof`-check it.
- **D5. `isMassiveConfigured()` for the 503 guard.** Add `export function isMassiveConfigured(): boolean { return Boolean(process.env.MASSIVE_API_KEY?.trim()); }`. `/api/market-data` calls it for its existing 503; it does **not** read the env name directly anymore.
- **D6. Do NOT touch the `MASSIVE_API_BASE_URL` knob this sprint.** Leave `lib/massive-market.ts` line 3 as `const MASSIVE_BASE_URL = 'https://api.massive.com';` exactly as-is. The consolidation already gives the base URL a single home (market-data now calls through `fetchMassiveJson`, which uses this const), so the duplication is resolved without wiring the env var. Implementing the knob is deliberately deferred: `services/.env.example` documents `MASSIVE_API_BASE_URL=https://api.polygon.io` — a *different host* — so making the const read that var could silently re-point every Massive call (market-data, snapshots, news, aggregates, MDR cron) to polygon.io if it is set in any environment. Reconciling that doc-vs-code mismatch is its own task, out of scope here.
- **D7. `fetchDailyAggregates` delegates the HTTP, keeps its math.** Refactor it to compute `fromStr`/`toStr` exactly as today, then `const bars = await fetchMassiveAggregateBars({ ticker, multiplier: '1', timespan: 'day', from: fromStr, to: toStr, limit: days + 5 });` and keep the existing `.flatMap(...).slice(-days)` normalization verbatim. The 1.6× calendar-day over-fetch, `limit: days + 5`, and `DailyOhlcBar` output shape are unchanged — this is a faithful extraction, not a behavior change. (It is on the hot MDR path and has no direct unit test, so do not alter any value.) Pass `limit` as the NUMBER `days + 5` — `fetchMassiveAggregateBars` does the `String(...)` itself. `MassiveAggregateBar` is intentionally a superset of the fields this function reads (it also carries `n`); do not narrow it.
- **D8. Delete the three dead `GET` handlers; routes keep their helpers.** Per the chosen plan the `fetch*ForDashboard` helpers stay where they are. Remove only each `export async function GET`, its now-unused imports, and its now-orphaned `export const dynamic`/`export const maxDuration` config (those only matter with a handler). Keep `app/api/market-data/route.ts`'s `GET` — it is a live route.

### Planned File Actions

**`lib/tradingview-client.ts` (MODIFY)**
1. Add the `TradingViewScanPayload` type and `scanTradingView` function (D1) near the top, after `TRADINGVIEW_COLUMNS`.
2. In `fetchTradingViewPriceContext`, replace the inline `fetch(...)` + `if(!response.ok) throw...` + `const payload = (await response.json()) as {...}` block (current lines ~44-70) with:
   ```ts
   const normalizedTicker = ticker.trim().toUpperCase();
   const payload = await scanTradingView({
     columns: TRADINGVIEW_COLUMNS,
     filter: [{ left: 'name', operation: 'equal', right: normalizedTicker }],
     range: [0, 1],
   });
   ```
   Keep the existing `payload.data?.find(...)` row selection and the rest of the normalization unchanged. Remove the now-unused local `sessionId` line inside this function.

**`app/api/tradingview/gainers/route.ts` (MODIFY)**
1. Add `import { scanTradingView } from '@/lib/tradingview-client';`.
2. Delete the private `fetchScan` function (lines ~206-227). Also delete the now-orphaned local `type TradingViewScanPayload` (lines ~82-85) — `scanTradingView`'s return type replaces it (the route reads `pmPayload.data`/`pmPayload.totalCount` off that returned type).
3. In `fetchGainersForDashboard`, keep `const sessionId = process.env.TRADINGVIEW_SESSION_ID?.trim() ?? '';` (for `isRealtime`), and change the `Promise.all` to `await Promise.all([scanTradingView(PM_SCAN_BODY), scanTradingView(AH_SCAN_BODY)])`.
4. Delete `export async function GET()` (lines ~262-280), `export const dynamic = 'force-dynamic';`, and the now-unused imports `internalServerError`, `logRouteError`, `requireUser`. Keep all types, helpers, `PM_SCAN_BODY`/`AH_SCAN_BODY`, and `fetchGainersForDashboard`.

**`app/api/tradingview/mdr-candidates/route.ts` (MODIFY)**
1. Add `import { scanTradingView } from '@/lib/tradingview-client';`.
2. In `fetchMdrCandidatesForDashboard`, keep `const sessionId = process.env.TRADINGVIEW_SESSION_ID?.trim() ?? '';` and replace the inline `fetch(...)` + non-OK throw + `const payload = (await response.json()) as {...}` (lines ~111-131) with `const payload = await scanTradingView(SCAN_BODY);`. Keep `const raw = payload.data ?? [];` and everything after.
3. Delete `export async function GET()` (lines ~173-191), `export const dynamic`, `export const maxDuration`, and the now-unused imports `internalServerError`, `logRouteError`, `requireUser`. Keep `import { evaluateLatestD2MdrTrigger } from '@/lib/massive-market';` (used by `structurallyQualifyCandidates`).

**`app/api/scanner/mdr-recent/route.ts` (MODIFY)**
1. Delete `export async function GET()` (lines ~139-152), `export const dynamic`, `export const maxDuration`, and the now-unused imports `internalServerError`, `logRouteError`, `dbUnavailable`, `requireUser`. **Keep** `import { getDb } from '@/lib/db';` (the `AppDb = NonNullable<ReturnType<typeof getDb>>` type alias still uses it) and the `evaluateLatestD2MdrTrigger`/`fetchUnifiedSnapshot`/schema imports. Keep `fetchMdrRecentForDashboard`, the types, and all enrichment helpers untouched.

**`lib/massive-market.ts` (MODIFY)**
1. Leave line 3 (`const MASSIVE_BASE_URL = 'https://api.massive.com';`) unchanged (D6 — knob deferred; do not wire `MASSIVE_API_BASE_URL`).
2. Add `MassiveRequestError` (D4) and change `fetchMassiveJson`'s non-OK `throw` to `throw new MassiveRequestError(response.status)`.
3. Add `MassiveAggregateBar` + `fetchMassiveAggregateBars` (D3) and `isMassiveConfigured` (D5).
4. Refactor `fetchDailyAggregates` to delegate to `fetchMassiveAggregateBars` (D7), preserving every value.

**`app/api/market-data/route.ts` (MODIFY)**
1. Replace the imports/local `MassiveAggResponse` type with `import { fetchMassiveAggregateBars, isMassiveConfigured, MassiveRequestError } from '@/lib/massive-market';` (keep `requireUser`, `internalServerError`, `logRouteError`). Delete the local `MassiveAggResponse` type.
2. Replace the `const apiKey = process.env.MASSIVE_API_KEY; if (!apiKey) return 503;` block with `if (!isMassiveConfigured()) return Response.json({ error: 'Market data provider not configured' }, { status: 503 });`.
3. Keep all param parsing (`toMassiveTimespan`, `computeDateRange`, the epoch-ms-vs-date `from`/`to` logic, the ignored `includePrePost`). Delete the manual `endpoint` URL build (lines ~99-103).
4. Replace the `let res; try { res = await fetch(...) } ... if (!res.ok) ...` block with:
   ```ts
   let bars;
   try {
     bars = await fetchMassiveAggregateBars({ ticker: symbol, multiplier, timespan, from, to });
   } catch (error) {
     if (error instanceof MassiveRequestError) {
       return Response.json({ error: 'Failed to fetch market data' }, { status: error.status || 502 });
     }
     console.error('[api:market-data] upstream request failed', { symbol, error: String(error) });
     return Response.json({ error: 'Market data provider unavailable' }, { status: 502 });
   }
   if (bars.length === 0) return Response.json({ symbol, candles: [] });
   ```
   Keep the existing `const candles = bars.flatMap(...)` normalization (rename `results` → `bars`) and the final `Response.json({ symbol, candles })`. Net status contract is identical: 400 missing symbol, 401 auth, 503 no key, 200 candles, upstream-status passthrough, 502 on network throw.

**`__tests__/tradingview-gainers-route.test.ts` (MODIFY)**
1. Change the import from `{ GET }` to `import { fetchGainersForDashboard } from '@/app/api/tradingview/gainers/route';`, drop the `vi.mock('@/lib/server-db-utils', ...)` + `requireUserMock` (the helper has no auth), and rename the `describe` to `fetchGainersForDashboard`.
2. Delete the `returns 401 when unauthenticated` test.
3. For each normalization test, replace `const response = ensureResponse(await GET()); const payload = await response.json();` with `const payload = await fetchGainersForDashboard();` and keep the same expected object assertions (drop the `response.status` lines).
4. Replace `returns 502 when TradingView responds with a non-OK status` with `await expect(fetchGainersForDashboard()).rejects.toThrow('TradingView scanner returned 403');` and `returns 500 when fetch throws` with `await expect(fetchGainersForDashboard()).rejects.toThrow('network down');`. Keep the `fetch` spy/`mockTradingViewFetch` setup and the Cookie/isRealtime assertions (now read from the returned payload + `fetchSpy.mock.calls`).

**`__tests__/tradingview-mdr-candidates-route.test.ts` (MODIFY)**
1. Change the import from `{ GET }` to `import { fetchMdrCandidatesForDashboard } from '@/app/api/tradingview/mdr-candidates/route';`, drop the `requireUserMock` + its `vi.mock('@/lib/server-db-utils', ...)`, keep the `vi.mock('@/lib/massive-market', ...)` for `evaluateLatestD2MdrTrigger`, and rename the `describe`.
2. Delete the `returns 401 when unauthenticated` test.
3. In the two remaining tests, replace `const response = (await GET()) as Response; const payload = await response.json();` with `const payload = await fetchMdrCandidatesForDashboard();`, drop `response.status` assertions, and keep all `evaluateLatestD2MdrTrigger` call + payload + `console.warn` assertions.

**Do not modify:** `app/api/dashboard/scanner-state/route.ts`, `__tests__/dashboard-scanner-state-route.test.ts`, `__tests__/market-data-route.test.ts`, `__tests__/tradingview-client.test.ts`, `__tests__/massive-market.test.ts` — all stay green as-is and are the regression contract.

### Acceptance Criteria

- [x] `scanTradingView` is the only place that calls `https://scanner.tradingview.com/america/scan`; gainers, mdr-candidates, and `fetchTradingViewPriceContext` all go through it (no remaining inline `fetch` to that URL outside `lib/tradingview-client.ts`).
- [x] `/api/market-data` no longer references `https://api.massive.com` or `process.env.MASSIVE_API_KEY` directly; it uses `fetchMassiveAggregateBars` + `isMassiveConfigured`, and its 400/401/503/200/passthrough/502 responses are unchanged (`market-data-route.test.ts` passes without edits).
- [x] `fetchMassiveJson` throws `MassiveRequestError` (message unchanged) and `fetchDailyAggregates` returns identical output via `fetchMassiveAggregateBars`.
- [x] The gainers, mdr-candidates, and mdr-recent route files export no `GET` (and no orphaned `dynamic`/`maxDuration`); their `fetch*ForDashboard` helpers + types still export and `app/api/dashboard/scanner-state/route.ts` still imports them unchanged.
- [x] The two rewritten TradingView route tests call the helpers directly and assert the same normalized payloads + the `rejects.toThrow` error cases.
- [x] No `.env*` file changed; no new file; no migration.

### Validation

Run before marking COMPLETE:
- `npm run lint` — passed 2026-05-30.
- `npx tsc --noEmit` — passed 2026-05-30.
- `npm test` — passed 2026-05-30 (96 files, 690 tests).
- `npm run workflow:audit` (HANDOFF.md changed — workflow asset) — passed 2026-05-30.
- `npm run build` — passed 2026-05-30; handler-less route files did not produce a build error.
- Manual: confirm the Dashboard scanner panel (gainers + MDR live + MDR recent) and a replay/backtest chart (`/api/market-data`) still render — PENDING user verification post-deploy.

### Notes for Codex

- The whole sprint is behavior-preserving refactor + dead-handler deletion. If any of the four unmodified tests (`market-data-route`, `tradingview-client`, `dashboard-scanner-state-route`, `massive-market`) goes red, you have drifted from the original request shape — fix the refactor, do not edit those tests.
- A `route.ts` with no exported HTTP method is valid in the App Router (it simply matches no method); keeping the helpers there is intentional per the chosen plan.

### Files Changed Summary

| File | Action | Risk |
|------|--------|------|
| `lib/tradingview-client.ts` | MODIFY — add `scanTradingView` + `TradingViewScanPayload`; route `fetchTradingViewPriceContext` through it | Low — test-pinned request shape |
| `app/api/tradingview/gainers/route.ts` | MODIFY — use `scanTradingView`; delete `fetchScan`, local payload type, `GET`, orphaned imports/config | Low |
| `app/api/tradingview/mdr-candidates/route.ts` | MODIFY — use `scanTradingView`; delete inline fetch, `GET`, orphaned imports/config | Low |
| `app/api/scanner/mdr-recent/route.ts` | MODIFY — delete `GET` + orphaned imports/config (keep `getDb` + helper) | Low |
| `lib/massive-market.ts` | MODIFY — add `MassiveRequestError`/`MassiveAggregateBar`/`fetchMassiveAggregateBars`/`isMassiveConfigured`; `fetchDailyAggregates` delegates | Med — hot MDR path; preserve values |
| `app/api/market-data/route.ts` | MODIFY — delegate to lib; preserve 503/passthrough/502 contract | Med — live chart path, 2 HTTP consumers |
| `__tests__/tradingview-gainers-route.test.ts` | MODIFY — call helper directly; `rejects.toThrow` for error cases | Low |
| `__tests__/tradingview-mdr-candidates-route.test.ts` | MODIFY — call helper directly; drop 401 | Low |

No new files. No deleted files. No migration.

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

## Recently Completed

### Sprint 10 — Dead-Code Purge + Type-Cast Documentation + Audit Coverage

Status: completed 2026-05-30.

Outcome:
- Deleted the dead scanner MDR-eligibility route + route test, and removed its orphaned helper/result type from `lib/massive-market.ts`. `fetchDailyAggregates` remains intact for the live scanner/agent/cron paths.
- Deleted backend-only generic agent-report list/detail routes + route test, and removed the orphaned validation schema/type exports. The `agentReports` table and its type-specific latest/admin/cron readers were not changed.
- Documented the three accepted `as unknown as` limitations in place, without refactoring signatures or Drizzle mock seams.
- Extended `scripts/workflow-audit.mjs` so `workflow:audit` now checks `HANDOFF.md` and `docs/ARCHITECTURE.md` invariants in addition to the existing workflow assets.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm run typecheck:services`, `npm test` (96 files, 692 tests), and `npm run workflow:audit` all passed.
- Repo-wide grep found no live dangling references for the deleted symbols/routes. The dashboard test's intentional negative assertion that the UI does not fetch the retired scanner route remains.

### Sprint 9 — Agent Job Lease Recovery

Status: completed 2026-05-30 (commit c8ffd89).

Outcome:
- New `recoverExpiredJobs(db, agentId)` in `lib/agents/queue.ts`: two non-fenced bulk updates over expired-lease processing rows (`status='processing' AND lockExpiresAt < now()`, scoped by `agentId`) — FAIL exhausted (`attempt >= maxAttempts`) with a lease-expired message, REQUEUE the rest (`attempt < maxAttempts`) immediately (`nextRetryAt=null`), leaving `leaseVersion`/`startedAt`/`attempt` for the next claim. Returns `{ requeued, failed }`. No migration (reuses existing `idx_agent_jobs_stale`).
- `lib/agents/worker.ts` runs recovery before each claim inside the poll loop, in its own try/catch so a recovery failure logs and falls through instead of breaking the loop; logs only on non-empty recovery. Closes the `docs/repo-cleanup.md` "Expired Agent Job Leases Are Not Recovered" finding.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm run typecheck:services`, `npm test` (98 files, 707 tests) all passed.
- Tests cover requeue/fail counts, the empty case, exact set-payloads (requeue has no `leaseVersion`/`errorMessage`), and a source-string guard on the filter conditions.
- Manual (kill a container mid-job; row clears off `processing` within ~5 min): PENDING post-deploy verification.

### Sprint 8 — Research TLDR Paid-Work Claim + Usage Telemetry

Status: completed 2026-05-29 (commit 458a0a9).

Outcome:
- New `research_tldr_claims` table (ticker PK + `claimed_at`) + migration `0044_optimal_mysterio.sql`. `getCachedResearchTldr(ticker, userId)` now claims per-ticker on a cold miss; concurrent losers poll (8×1500ms) and reuse the winner's cached row instead of double-spending, then generate themselves only if the winner stalls. Stale claims (>90s) cleared at claim time.
- `lib/llm-client.ts` `callLlm` surfaces `usage: { inputTokens, outputTokens }` (defaults 0). TLDR generation now logs tokens/cost/duration to `agent_request_log` via new telemetry-only `recordSiteLlmUsage` (`mode:'site-research-tldr'`) — deliberately NOT `recordLlmAttempt`, so it never mutates the small-cap-trader circuit breaker. Route adds `ensureUser` + threads the user id; response shape unchanged. Closes the `docs/repo-cleanup.md` "Research TLDR Needs A Paid-Work Claim And Unified Telemetry" finding.
- Beneficial drift from spec: a non-unique-violation claim-insert error is logged and swallowed (proceed as owner, skip release) rather than rethrown — better satisfies "claim writes never block the TLDR" than the literal spec, which would have 500'd.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (98 files, 704 tests) all passed; `npm run db:migrate` applied `0044` cleanly.
- Tests cover usage parse/default-zero, `recordSiteLlmUsage` insert with `db.execute` never called (no-breaker proof), and cache-hit / cold-owner (2 deletes) / failed-telemetry / loser-poll (fake timers, no LLM call) paths.
- Manual browser smoke (one generation for a cold ticker opened twice; `agent_request_log` row for `mode='site-research-tldr'` with non-zero tokens): PENDING user verification.

### Sprint 7 — Slim GET /api/trades Payload (Lazy-Load Executions)

Status: completed 2026-05-29 (commit 757cd32).

Outcome:
- `GET /api/trades` no longer joins `tradeExecutions` — returns one summary row per trade (tags intact, `rawExecutions: []`), so the bulk list loads lighter; `POST` unchanged. Closes the `docs/repo-cleanup.md` "Unbounded GET /api/trades" finding (slim-payload scope; true pagination deferred).
- New `hooks/use-trade-executions.ts`: `useTradeExecutions(id, seeded)` lazy-loads a single trade's executions via `/api/trades/[id]` with a shared module cache + promise-based in-flight dedup; `prefetchTradeExecutions(ids)` warms the same cache. `JournalTradeChart` uses it so replay charts keep per-fill markers; both review sheets prefetch before the auto-print timer so exported PDFs keep per-fill markers.
- Also closed the "Missing GET Test For Trades Route" gap.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (96 files, 696 tests) all passed.
- New GET test asserts `select` ran exactly once (proves the executions query is gone); new hook test covers seeded/seed-transition/lazy-fetch/cache/prefetch.
- Manual browser smoke (Journal + daily/weekly replay markers, detail sheet, multi-fill review PDF export, list load speed): PENDING user verification.

### Sprint 6 — Rate Limiting On Expensive Endpoints

Status: completed 2026-05-29 (commit 644dc24).

Outcome:
- New `rate_limits` table (text PK `${userId}:${endpoint}:${windowStartMs}`, FK cascade, lookup index) + migration `drizzle/0043_fat_timeslip.sql`.
- Shared `lib/rate-limit.ts`: atomic fixed-window (UTC clock-hour) upsert counter + 429 builder with `Retry-After` / `X-RateLimit-*` headers. Caps: research-report 20/hr, askedgar-tldr 30/hr.
- Wired into `POST /api/research-report` and `POST /api/askedgar/tldr` (added a `getDb` guard + one-try/catch restructure to the tldr route).

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (95 files, 688 tests) all passed; `npm run db:migrate` applied cleanly.
- Manual post-deploy 429-header smoke: PENDING user verification.

### Multi-Day Trade Replay Charts

Status: completed 2026-05-28 (commit a625032).

Outcome:
- Closed trades spanning >1 day now widen the candle window entry-day→exit-day, place `EXIT` markers on the exit day, and show a date range in the detail-sheet and Journal labels. Open/same-day trades are unchanged.
- Behind an optional `endSortKey` param on `buildTradeChartOptions`; `ResearchChart`/`WatchlistTickerChart` (2-arg callers) untouched. Detection reuses `isCrossDayTrade`/`bucketKey`.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (94 files, 681 tests) all passed.
- Codex added `__tests__/ui-trade-utils.test.ts` (3 marker tests) beyond the spec.
- Manual browser smoke (same-day unchanged, multi-day span, ResearchChart unaffected): PENDING user verification.

### CSV Parser: Position-Aware B Resolution

Status: completed 2026-05-28 (commit 5ea235b).

Outcome:
- Lifted DAS Trader's chronological position-resolver into shared `resolveSidesByPositionState` helper in `lib/parsers/utils.ts`.
- `defaultParser` now runs the resolver in `buildContext`, disambiguating raw `B` to `MARGIN` (long open) when no open short exists, or `B` (cover) when one does.
- Deleted `builtinNormalizeRow`; both `processCsvData` and `extractRawExecutions` default to `defaultParser`. Removed `parser.id === 'default'` bypass in `lib/trade-utils.ts`.

Validation:
- `npm run lint` passed.
- `npx tsc --noEmit` passed.
- `npm test` passed (92 files, 671 tests).
- Manual browser smoke with coworker's 2026-05-28 CSV: PENDING — confirm ASTC/ATPC LONG trades appear, NCT/SPRC SHORT remain correct, ARM shows as open long.

### Cover/Close Entry Flow — Manual Entry (FIFO) + Import Side Resolution

Status: completed 2026-05-28 (commit c846e4a).

Outcome:
- Part A: manual New Trade form now detects an offsetting open position (same symbol, opposite direction) and prompts to close it FIFO instead of creating a new opposite open trade. New `lib/cover-position.ts` (pure FIFO math) + `app/api/trades/cover/route.ts` handle full close / partial / flip; `useTrades.handleCoverPosition` merges affected rows by id.
- Part B: import (raw CSV) path seeds `resolveSidesByPositionState` with the client's currently-open positions so a later-day `B` covering a carried-over short labels as a cover, not a new long. Threaded through `extractRawExecutions` → `collectRawExecutions` → `processImportFiles`.
- Known limits (intentional): multi-day folder import in one action won't link an open+cover across batches; same-symbol intraday round-trip while holding a carried-over position can mislabel. Supported workflow documented for coworkers.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (93 files, 677 tests) all passed.
- Manual browser smoke (Part A confirm/partial/flip/decline, Part B import seeding): PENDING user verification.

---

## Session Maintenance

- Keep this file compact: active specs only while work is in flight, short summaries after validation.
- If a new multi-step feature starts, replace or append a self-contained execution spec with exact file paths, ordered changes, acceptance criteria, and validation requirements.
- If only docs/workflow assets change, run `npm run workflow:audit`.
- Do not modify `.env*` or secret files.

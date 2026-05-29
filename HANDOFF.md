# Nexus Terminal - HANDOFF.md

> Updated: 2026-05-29
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and durable docs such as `docs/repo-cleanup.md`.

Historical completed sections (Sprints 1-5, Tier 1 Cleanup, Chart Drawings, Workflow Maintenance, AskEdgar News Filter Expansion) were removed to keep this file focused. Use git history for archived implementation detail.

---

## Sprint 7 — Slim GET /api/trades Payload (Lazy-Load Executions)

> Generated: 2026-05-29 | Agent: Claude (Plan)
> Status: COMPLETE — CODE VALIDATED; MANUAL SMOKE PENDING

### Objective

`GET /api/trades` currently loads every trade **plus every execution** for the user in one response, then the client holds it all in memory. Executions are the bulk of the payload and the heaviest query, yet they are only read in per-trade views (detail sheet, replay charts). This sprint drops the executions join from the bulk list and lazy-loads a single trade's executions on demand, so the trade list loads lighter/faster with **no visible change** to users. Implements the `docs/repo-cleanup.md` § "Unbounded GET /api/trades Query" finding (slim-payload scope — true pagination is intentionally NOT attempted, see D1) and closes the "Missing GET Test For Trades Route" gap.

### Stories

- AEV2-701 — Drop the executions join from `GET /api/trades` (return summary rows + tags only)
- AEV2-702 — New `hooks/use-trade-executions.ts` (lazy per-trade executions with a shared module cache + `prefetchTradeExecutions`)
- AEV2-703 — Wire `JournalTradeChart` to lazy-load executions so replay charts keep per-fill markers
- AEV2-704 — Prefetch executions before auto-print in both review sheets so exported PDFs keep per-fill markers
- AEV2-705 — Tests: `GET /api/trades` coverage + the new hook (+ prefetch)

### Current State

- `GET /api/trades` (`app/api/trades/route.ts`, lines 16-73): `requireUser()` → `getDb()`/`dbUnavailable()` → `ensureUser` → select all trade rows ordered by `date desc` → **`Promise.all([loadTagsForTradeIds(...), <select ALL executions via inArray(tradeIds)>])`** → build an `executionsByTrade` Map → `toTrade(row, tags, executions)` per row → `Response.json({ trades })`. The executions query + Map (lines 32-65) is what this sprint removes.
- `POST /api/trades` in the same file still inserts executions and uses `and`/`eq`. It is **out of scope** and must not change.
- `toTrade(row, tags, executions)` (`lib/server-db-utils.ts:135`) accepts an executions array and defaults it to `[]`. Calling it with `[]` yields a valid `ApiTrade` whose `rawExecutions` is empty; all summary fields (`netPnl`, `executionCount`, etc.) come from the row, so analytics are unaffected.
- `GET /api/trades/[id]` (`app/api/trades/[id]/route.ts:48`) already returns a single trade **with** its `rawExecutions`. This is the lazy-load source.
- Client load path: `useTradeSync.refreshTrades()` (`hooks/use-trade-sync.ts:27`) calls `apiRequest<{ trades: ApiTrade[] }>('/api/trades')`, maps with `fromApiTrade`, and stores the full array in `trades` state. Every analytic (Career P/L, Performance, Calendar, tag stats) and all filtering read this full array client-side — this is why we keep loading **all trade rows** and only drop executions.
- `rawExecutions` is read in exactly two display surfaces: `buildTradeMarkers(trade)` (`lib/ui-trade-utils.ts:44`) and `TradeDetailSheet.tsx:81` (sort). Nothing iterates `rawExecutions` across the whole list for analytics. (Other `rawExecutions` references are CSV import / position-matching / cover flows, which build executions from upload data, not from this GET.)
- `buildTradeMarkers` **degrades gracefully**: when `trade.rawExecutions.length === 0` it falls back to single ENTRY/EXIT markers from `avgEntryPrice`/`avgExitPrice` (`lib/ui-trade-utils.ts:60-74`). So a missing-executions chart never errors — it just shows 2 markers instead of one-per-fill. The lazy-load in this sprint restores the per-fill markers.
- `TradeDetailSheet` is already covered: `app/page.tsx:116-121` runs `fetchTradeDetail(selectedTradeId)` whenever a trade is selected, and `fetchTradeDetail` (`hooks/use-trades.ts:104`) fetches `/api/trades/[id]` and merges executions into the shared `trades` state. **No change needed for the detail sheet.**
- `JournalTradeChart` (`components/trading/JournalTradeChart.tsx`) is a `memo`'d presentational component that takes a `trade` prop and builds markers via `buildTradeMarkers(trade)` (line 34). It is rendered in **bounded batches** in three places: `JournalTab.tsx:351`, `DailyReportSheet.tsx:380`, `WeeklyReviewSheet.tsx:476` (Journal/reviews show an initial batch + a "show more" button, so only a handful of charts mount at once).
- Pattern precedent for a module-level cache hook: `hooks/use-candle-data.ts` (module-level `candleDataCache` Map, async fetch in `useEffect`). The new hook mirrors this shape.
- Test infra: `renderHook` from `@testing-library/react` is used in existing `.test.tsx` files (e.g. `__tests__/backtesting-sidebar.test.tsx`); jsdom is the default test environment. `__tests__/trades-route.test.ts` currently tests **POST only** — it mocks `@/lib/db`, `@/lib/server-db-utils` (`requireUser`, `ensureUser`, `dbUnavailable`, `loadTagsForTradeIds`, `toTrade`, etc.), and imports the route handler directly.

### Scope

- **In scope:** removing the executions query from `GET /api/trades`; `hooks/use-trade-executions.ts` (lazy hook + `prefetchTradeExecutions`); the one-line wiring in `JournalTradeChart.tsx`; the auto-print prefetch in `DailyReportSheet.tsx` and `WeeklyReviewSheet.tsx`; new GET tests in `__tests__/trades-route.test.ts`; new `__tests__/use-trade-executions.test.tsx`.
- **Out of scope:** true cursor/offset pagination; any "load more trades" UI on the list; moving analytics server-side; a batch executions API endpoint; touching `POST /api/trades`, `import-raw`, `import`, `cover`, or `merge`; prop-drilling `fetchTradeDetail` into the chart; changing anything in the review sheets other than their `printOnReady` effect; the `docs/repo-cleanup.md` "Missing Component-Level Tests" gap (separate finding); editing `hooks/use-trades.ts` or `hooks/use-trade-sync.ts`.

### Decisions Locked For Sprint 7

- **D1. Slim the payload, do NOT paginate.** Keep loading **all** trade rows (analytics depend on the full set in memory) and only drop executions from the bulk GET. True pagination would silently break Career P/L / Performance / Calendar unless those move server-side — a multi-sprint architectural change deliberately deferred.
- **D2. Preserve per-fill chart markers via a lazy-load hook in `JournalTradeChart`, not prop-drilling.** Threading `fetchTradeDetail` down through `ManagementTab → JournalTab/DailyReportSheet/WeeklyReviewSheet → JournalTradeChart` is heavy and would touch many files; a self-contained hook keeps the change local and respects the rule "do not add new logic to `hooks/use-trades.ts`".
- **D3. Hook uses a single shared module-level loader with promise-based dedup, keyed by `trade.id` only.** Executions don't depend on timeframe, so toggling timeframe must not refetch. A `Map<string, Execution[]>` caches results and a `Map<string, Promise<Execution[]>>` holds in-flight requests, so multiple charts for the same trade — and `prefetchTradeExecutions` — all join one request. The promise-dedup (vs a plain in-flight `Set`) is what lets the print prefetch await the exact same fetch the charts use, guaranteeing markers are ready before the snapshot.
- **D4. Detail sheet path unchanged.** It is already served by `page.tsx` → `fetchTradeDetail`, which merges executions into the shared `trades` array. When that has run, `JournalTradeChart` receives a trade that already carries executions, and the hook short-circuits (returns the seed without fetching). The seed→fetched transition (a trade arriving with `[]` then later carrying executions) is covered by returning `seeded` directly whenever it is non-empty.
- **D5. Lazy-fetch failure is non-fatal and silent; the auto-print PDF path is made deterministic.** On error `loadExecutions` resolves `[]` and `buildTradeMarkers` shows entry/exit markers from average prices — no toast, the chart still renders. For interactive viewing this async load is fine (same as candle data). The one place async would change output is the review **auto-print** (Archive PDF export), which fires `window.print()` 200ms after data loads without waiting for charts: there we explicitly `await prefetchTradeExecutions(...)` before starting the print timer (D7), so exported PDFs keep per-fill markers exactly as today.
- **D6. Add the missing `GET /api/trades` tests as part of this sprint.** This closes the `docs/repo-cleanup.md` "Missing GET Test For Trades Route" finding at the same time, since we're already editing the handler. Keep scope to the GET handler (happy path, auth rejection, db-unavailable, executions-query-removed) — do not add component tests.
- **D7. Review sheets prefetch executions before auto-printing.** `DailyReportSheet` and `WeeklyReviewSheet` change ONLY their `printOnReady` effect: `await prefetchTradeExecutions(<charted trade ids>)`, then `setTimeout(window.print, 200)`. The charted set is exactly the trades rendered as charts (`chartTrades.slice(0, chartCount)`), so we prefetch only what's on the page. Because the prefetch shares the charts' fetch (D3), the chart components' markers are committed before the timer fires.

### Planned File Actions

**New files:**

- `hooks/use-trade-executions.ts` — lazy per-trade executions for replay charts. Exact contract:

  ```ts
  'use client';

  import { useEffect, useState } from 'react';
  import type { ApiTrade, Execution } from '@/lib/types';
  import { apiRequest, fromApiTrade } from '@/lib/trade-utils';

  // Executions are dropped from the bulk GET /api/trades payload (Sprint 7), so
  // replay charts fetch a single trade's executions on demand here. Results are
  // cached at module scope (keyed by trade id) so timeframe toggles / re-renders
  // don't refetch; in-flight requests are stored as promises so the chart hook
  // and prefetchTradeExecutions() share one request per trade. Mirrors the
  // candleDataCache pattern in use-candle-data.ts.
  const executionsCache = new Map<string, Execution[]>();
  const inFlight = new Map<string, Promise<Execution[]>>();

  // Single shared loader: returns cached executions, joins an in-flight request,
  // or starts a new one. Resolves to [] on error (non-fatal — charts fall back
  // to entry/exit markers) and does not cache failures, so a later view retries.
  function loadExecutions(tradeId: string): Promise<Execution[]> {
    const cached = executionsCache.get(tradeId);
    if (cached) return Promise.resolve(cached);

    const existing = inFlight.get(tradeId);
    if (existing) return existing;

    const promise = apiRequest<{ trade: ApiTrade }>(`/api/trades/${encodeURIComponent(tradeId)}`)
      .then((res) => {
        const executions = fromApiTrade(res.trade).rawExecutions;
        executionsCache.set(tradeId, executions);
        return executions;
      })
      .catch(() => [] as Execution[])
      .finally(() => {
        inFlight.delete(tradeId);
      });

    inFlight.set(tradeId, promise);
    return promise;
  }

  // `seeded` is whatever executions the trade already carries (e.g. after the
  // detail sheet loaded them into the shared trades cache). When present we use
  // them directly and skip the fetch.
  export function useTradeExecutions(tradeId: string, seeded: Execution[]): Execution[] {
    const hasSeed = seeded.length > 0;
    const [fetched, setFetched] = useState<Execution[] | null>(
      () => executionsCache.get(tradeId) ?? null,
    );

    useEffect(() => {
      if (hasSeed) return;
      let cancelled = false;
      void loadExecutions(tradeId).then((executions) => {
        if (!cancelled) setFetched(executions);
      });
      return () => {
        cancelled = true;
      };
    }, [tradeId, hasSeed]);

    if (hasSeed) return seeded;
    return fetched ?? [];
  }

  // Prefetch executions for a set of trades into the shared cache. Used by the
  // review sheets before auto-printing so the replay charts have per-fill markers
  // loaded before the print snapshot. Shares loadExecutions(), so it dedupes
  // with the charts' own fetches instead of issuing duplicate requests.
  export async function prefetchTradeExecutions(tradeIds: string[]): Promise<void> {
    await Promise.all(tradeIds.map((tradeId) => loadExecutions(tradeId)));
  }
  ```

  Notes for Codex:
  - The effect deps are exactly `[tradeId, hasSeed]` — do **not** add `seeded` to the deps (it's an array whose identity churns each render; it's only read in the render-time `return`, not inside the effect).
  - The `useState` lazy initializer reads the cache only at mount. This is correct because every call site keys `<JournalTradeChart>` by `trade.id`, so a different trade remounts the component (and the hook) fresh — do not reuse the component for a different trade without a key.

- `__tests__/use-trade-executions.test.tsx` — hook tests via `renderHook`/`waitFor` from `@testing-library/react`. Mock `@/lib/trade-utils` with a hoisted `apiRequestMock`; the hook only reads `.rawExecutions` off the `fromApiTrade` result, so stub `fromApiTrade` as `(trade) => ({ ...trade, rawExecutions: trade.rawExecutions ?? [] })` (no need for real normalization). Because the module-level `executionsCache`/`inFlight` persist across tests in this file, use a **distinct `tradeId` per test** and `await waitFor(...)` for the resolved result before each test ends (so the in-flight promise's `.finally` clears before the next test). Cover:
  - Seeded: `useTradeExecutions('t-seed', [<one execution>])` returns the seed immediately and `apiRequestMock` is **not** called.
  - Seed transition (D4): start with `renderHook` at `('t-trans', [])`, await the fetched result, then `rerender` with `('t-trans', [<one execution>])` and assert the hook now returns that seed (covers the detail-sheet merge path).
  - Lazy fetch: `useTradeExecutions('t-fetch', [])` triggers one `apiRequest('/api/trades/t-fetch')`; after `await waitFor`, the hook returns the 2 executions the mock resolved.
  - Cache (self-contained — do NOT depend on the lazy-fetch test): in one test, render `useTradeExecutions('t-cache', [])`, `await waitFor` the fetched result and assert `apiRequestMock` was called once; then mount a **second** hook with the same `('t-cache', [])` and assert `apiRequestMock` is **still** called only once (served from cache).
  - Prefetch: with a fresh id, `await prefetchTradeExecutions(['t-pre'])` then render `useTradeExecutions('t-pre', [])` and assert it returns the executions **without** a second `apiRequest` call (prefetch populated the shared cache).

**Modified files:**

- `app/api/trades/route.ts` — in **`GET` only**, remove the executions query, the `executionsByTrade` Map, and the unused operator imports. Replace the import line `import { and, asc, desc, eq, inArray } from 'drizzle-orm';` with `import { and, desc, eq } from 'drizzle-orm';` (POST still uses `and`/`eq`; `asc` and `inArray` were only used by the GET executions query — confirm with `tsc`/lint that nothing else references them). Keep the `tradeExecutions` schema import (POST still uses it). Replace the GET body from the `const tradeIds = ...` line through the `return Response.json({ trades: tradeList });` line with:

  ```ts
    const tradeIds = tradeRows.map((row) => row.id);
    const tagMap = await loadTagsForTradeIds(db, authState.user.id, tradeIds);

    // Executions are intentionally NOT loaded here. They are the bulk of the
    // payload and the heaviest query, and are only needed in per-trade views
    // (detail sheet, replay charts), which lazy-load them via /api/trades/[id].
    const tradeList = tradeRows.map((row) => toTrade(row, tagMap.get(row.id) ?? [], []));
    return Response.json({ trades: tradeList });
  ```

  The surrounding `try`, `requireUser`/`getDb`/`ensureUser` guards, the `tradeRows` select, and the `catch (error) { logRouteError('trades.get', error); ... }` stay exactly as they are.

- `components/trading/JournalTradeChart.tsx` — add `import { useTradeExecutions } from '@/hooks/use-trade-executions';` and replace the marker line (currently line 34, `const tradeMarkers = useMemo<TradeMarker[]>(() => buildTradeMarkers(trade), [trade]);`) with:

  ```ts
    const executions = useTradeExecutions(trade.id, trade.rawExecutions);
    const tradeMarkers = useMemo<TradeMarker[]>(
      () => buildTradeMarkers({ ...trade, rawExecutions: executions }),
      [trade, executions],
    );
  ```

  Nothing else in the component changes (candles, loading/error states, `memo` wrapper all stay).

- `components/trading/DailyReportSheet.tsx` and `components/trading/WeeklyReviewSheet.tsx` — change **only** the `printOnReady` auto-print effect so it prefetches the charted trades' executions before snapshotting for print (otherwise an exported PDF would show entry/exit-only markers for multi-fill trades). Add `import { prefetchTradeExecutions } from '@/hooks/use-trade-executions';`. Both sheets currently have the identical effect:

  ```ts
  useEffect(() => {
    if (!printOnReady || !open || loading) return;
    const timer = setTimeout(() => window.print(), 200);
    return () => clearTimeout(timer);
  }, [printOnReady, open, loading]);
  ```

  Replace it (in **both** files) with:

  ```ts
  useEffect(() => {
    if (!printOnReady || !open || loading) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Executions were dropped from the bulk trades payload, so make sure the
    // replay charts have their per-fill markers loaded before we snapshot for print.
    void prefetchTradeExecutions(chartTrades.slice(0, chartCount).map((trade) => trade.id))
      .then(() => {
        if (cancelled) return;
        timer = setTimeout(() => window.print(), 200);
      });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [printOnReady, open, loading, chartTrades, chartCount]);
  ```

  `chartTrades` and `chartCount` are already in scope in both components (they drive the `chartTrades.slice(0, chartCount).map(...)` chart loop — `DailyReportSheet.tsx:375`, `WeeklyReviewSheet.tsx:471`). Adding them to the deps is required for exhaustive-deps; re-runs are cheap because `prefetchTradeExecutions` is cache-guarded, and the `cancelled` flag prevents a stale print. Do not change any other part of these files.

- `__tests__/trades-route.test.ts` — add `GET` to the route import (`import { GET, POST } from '@/app/api/trades/route';`) and a new `describe('GET /api/trades', ...)`. Reuse the existing hoisted mocks. In `beforeEach` for this block, set `requireUserMock` to a valid `{ user: { id: 'user-1', ... } }`, `getDbMock` to a GET-shaped db, configure `loadTagsForTradeIds` mock to resolve a `Map`, and `toTradeMock` to echo (e.g. `(row, tags, executions) => ({ id: row.id, tags, rawExecutions: executions })`). The GET db mock needs the select→from→where→**orderBy** chain (POST's `makeDb` uses `...where→limit`, so add an `orderBy` variant), e.g.:

  ```ts
  function makeGetDb(rows: Array<{ id: string }>) {
    const selectMock = vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(async () => rows),
        })),
      })),
    }));
    return { select: selectMock, _mocks: { selectMock } };
  }
  ```

  Tests:
  - Returns 401 when `requireUserMock` resolves `{ error: <401 Response> }`.
  - Returns 503 when `getDbMock` returns `null` (body `{ error: 'Database not configured' }`).
  - Happy path: with two rows, responds 200 and `payload.trades` has length 2. Assert **`db._mocks.selectMock` was called exactly once** — this is the load-bearing assertion proving the executions query was removed (with the old code `select` runs twice: trades + executions). Also assert `toTradeMock` was called with `[]` as its third argument for every row, and that `loadTagsForTradeIds` was called once with the two trade ids.

**Deleted files:** none.

### Acceptance Criteria

- [x] `GET /api/trades` no longer queries `tradeExecutions`; it returns one row per trade with `rawExecutions: []`, tags intact, ordered by `date desc`. `and`/`asc`/`inArray` imports reflect actual usage (no unused-import lint error).
- [x] `POST /api/trades` is byte-for-byte unchanged.
- [x] `hooks/use-trade-executions.ts` exports `useTradeExecutions(tradeId, seeded)` and `prefetchTradeExecutions(tradeIds)`. The hook returns `seeded` directly when non-empty (no fetch); otherwise fetches `/api/trades/[id]` once via the shared loader, caches by id, dedupes in-flight requests as promises, and returns the fetched executions (`[]` and silent on error). `prefetchTradeExecutions` resolves only after all requested trades' executions are loaded into the shared cache, deduping against the hook's own fetches.
- [x] `JournalTradeChart` renders per-fill markers for a trade whose `rawExecutions` arrive via the hook (verified by the hook test; manual smoke pending), and unchanged behavior when the trade already carries executions.
- [x] `DailyReportSheet` and `WeeklyReviewSheet` `await prefetchTradeExecutions(<charted ids>)` before starting the 200ms print timer, and change nothing else; an auto-exported review PDF of a multi-fill trade still shows per-fill markers.
- [x] `__tests__/trades-route.test.ts` covers GET: happy path (asserts `select` ran exactly once → executions query removed), 401, and 503.
- [x] `__tests__/use-trade-executions.test.tsx` covers seeded (no fetch), seed transition, lazy fetch, cache-hit (self-contained, no second fetch), and prefetch (populates cache, no hook refetch).
- [x] All existing tests still pass.

### Validation

Run before marking the sprint COMPLETE:
- `npm run lint`
- `npx tsc --noEmit`
- `npm test`
- Manual browser smoke (user): open Journal and a daily/weekly review — replay charts still show a marker per fill; open a trade's detail sheet — chart + executions list intact; export a daily/weekly review PDF (Archive) for a multi-fill trade and confirm the printed charts show per-fill markers; confirm the trade list still loads (and feels at least as fast). No new console errors.

### Completion Evidence

- `npm run lint` passed.
- `npx tsc --noEmit` passed.
- `npm test` passed: 96 files, 696 tests.
- `npm run typecheck:services` skipped because no `services/` files changed.
- Manual browser smoke remains pending user verification.

---

## Recently Completed

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

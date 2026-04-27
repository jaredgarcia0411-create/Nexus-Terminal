# Nexus Terminal — HANDOFF.md

> Updated: 2026-04-27
> Purpose: brief summary of recently completed work plus any active execution spec. Older implementation detail lives in git history and `specs/`.
> Historical completed sections were archived to keep this file focused. Agent Hardening #1 shipped in `7118598`; Agent Hardening #2 in `2a856f1`; Agent Hardening #3 in `bf13567`; Research agent report refinements in `9a69655` (2026-04-17); Trade Journal Enhancement (DRC + Weekly Review + Archive tab) shipped across `4757fa3`, `0e41b5a`, `8dd6b12`, `fe97e8c`, `c300153` (2026-04-19 → 2026-04-20); Tighten Trading Journal UI shipped in `f1fde41` (2026-04-20); Spend Enforcement Fix shipped across `7aad160`, `abdefe9`, `1bd5e1e`, `8ad674e`, `9f0a123` (2026-04-20); Research Gap-Stats Parser + Redundancy Fix shipped in `0e96e16` (2026-04-22); Research Chart History Polish shipped in `5fc5b9e` (2026-04-22); System Sheet Sync shipped in `63c3a3b` + `a694797` (2026-04-23); AskEdgar Gap-Stats Mapper Fix shipped in `aa3ea65` (2026-04-24). See git history for full records.

## Current State

**Active spec:** AskEdgar Conditional Fan-Out + Cost Telemetry — implemented and validated 2026-04-27; pending review/commit.

## Validation Snapshot

Most recent validation (`2026-04-27`, AskEdgar Conditional Fan-Out + Cost Telemetry):

- `npm run lint` — passed
- `npx tsc --noEmit` — passed
- `npm test` — passed (`55` files, `432` tests)
- `npx vitest run __tests__/askedgar-client.test.ts __tests__/agent-blueprints.test.ts` — passed (`2` files, `55` tests)

## Follow-Up Notes

- **AskEdgar paid API migration (Monday 2026-04-27).** Test key expires Monday. `https://eapi.askedgar.io` remains the correct base URL — the readme.io docs list `https://api.askedgar.com`, which redirects to a HugeDomains parking page. Only swap the `ASKEDGAR_API_KEY` env var; do not touch `ASKEDGAR_BASE_URL` in `lib/askedgar.ts:42`.
- **Cost-per-report estimate (after dropping `filing-titles` and `historical-float-pro`).** Per the free `/estimate` endpoint at `https://eapi.askedgar.io/estimate?endpoint={name}&ticker={t}` with no auth, an unbounded fresh report on a heavy-activity microcap (SPRC) costs ~$3.33 across 15 working endpoints (dilution-data /estimate is broken upstream so excluded). Dropping `filing-titles` (~$1.56) and `historical-float-pro` (~$0.63) brings the upper bound to **~$1.14 per fresh report**. The `limit` and filter parameters are honored by the real endpoints but ignored by `/estimate`, so real costs on `news` (limit=20) and `offerings` (limit=20) will run lower than the upper bound. With the 1-hour `(ticker)` cache, ~10 unique tickers per day projects to roughly **$5–$10/day** after the endpoint trim.
- **Endpoint trim (separate future spec).** Drop `filing-titles` and `historical-float-pro` from the `endpointConfigs` array in `lib/askedgar.ts:481-499`, plus the corresponding helper functions (`fetchHistoricalFloatPro`, `fetchFilingTitles`) and any consumer references in `lib/agents/blueprints/`. Confirm nothing reads from `rawData['filing-titles']` or `rawData['historical-float-pro']` before removing.
- **Cost telemetry.** Folded into the active spec below — `usage.cost_microdollars` will be summed and logged per fan-out call. A DB-backed usage table is deferred until logs prove what shape it should take.
- **Ask Edgar replacement research** is in `docs/ae-buildout.md`. `FUTURE-PLANS.md` and `AGENTIC_EXPANSIONV2.md` live under `docs/`.

---

## Active Spec: AskEdgar Conditional Fan-Out + Cost Telemetry

> Generated: 2026-04-27 | Author: planning session (inline, no architect handoff)
> Status: IMPLEMENTED + VALIDATED (2026-04-27)
> Goal: stop fetching 17 endpoints when blueprint consumers only need 9-16, and start logging real per-call cost so we can measure savings instead of guessing.

### Background

`lib/askedgar.ts:465` (`fetchTickerData`) currently fans a single ticker into 17 parallel endpoint calls regardless of which consumer asked. Five surfaces use the result via `getCachedTickerData(ticker)`:

- `app/api/askedgar/snapshot/route.ts:26` → Research Tab UI (needs all 17 normalized fields)
- `app/api/askedgar/tldr/route.ts:32` → TLDR LLM call (currently consumes all 17)
- `app/api/askedgar/lookup/route.ts:22` → debug/admin endpoint (all 17)
- `lib/agents/blueprints/small-cap-research.ts:808` → reads 16 keys (everything except `float-outstanding`)
- `lib/agents/blueprints/swing-trader-research.ts:828` → reads 9 keys

Cache: `askedgar_cache` (`lib/db/schema.ts:199`) keyed on `(cache_type, ticker)`, 1-hour TTL, single row per ticker holds all endpoint payloads in `data_json`. We will **keep that shape** and make reads/writes endpoint-aware so a partial fetch can fill the same row and a later full request can reuse what's already cached.

No DB migration. No API contract change for snapshot/tldr/lookup routes.

---

### File: `lib/askedgar.ts`
**Action:** MODIFY

#### Step 1 — Extend the response type with usage metadata

1.1. Locate the `AskEdgarResponse<T>` interface (line 28). Add an optional `usage` field:

```ts
export interface AskEdgarResponse<T> {
  status: string;
  count: number;
  results: T[];
  error?: string;
  usage?: { cost_microdollars?: number };
}
```

> AskEdgar v1 paid responses include `usage.cost_microdollars` per the prior HANDOFF Follow-Up Notes.

#### Step 2 — Extract the endpoint registry and define scopes

2.1. Just above `fetchTickerData` (line 465), define a typed registry that maps endpoint key → `{ label, run }`. Move all 17 entries from the inline `endpointConfigs` array (`lib/askedgar.ts:481-499`) into this exported registry. Each `run` is a thunk that closes over `normalizedTicker` — match the existing fetch helpers (`fetchFloatOutstanding`, `fetchScreenerByTicker`, etc., at lines 363-462). Limits stay as they are today.

```ts
type EndpointRunner = (ticker: string) => Promise<AskEdgarResponse<unknown>>;

export const ENDPOINT_REGISTRY: Record<string, { label: string; run: EndpointRunner }> = {
  'float-outstanding':       { label: 'Float Outstanding',       run: (t) => fetchFloatOutstanding(t) },
  'screener':                { label: 'Screener',                run: (t) => fetchScreenerByTicker(t) },
  'dilution-rating':         { label: 'Dilution Rating',         run: (t) => fetchDilutionRating(t) },
  'dilution-data':           { label: 'Dilution Data',           run: (t) => fetchDilutionData(t) },
  'offerings':               { label: 'Offerings',               run: (t) => fetchOfferings(t, 20) },
  'equity-lines':            { label: 'Equity Lines',            run: (t) => fetchEquityLines(t) },
  'registrations':           { label: 'Registrations',           run: (t) => fetchRegistrations(t) },
  'news':                    { label: 'News',                    run: (t) => fetchNews(t, 20) },
  'nasdaq-compliance':       { label: 'Nasdaq Compliance',       run: (t) => fetchNasdaqCompliance(t) },
  'pump-and-dump-tracker':   { label: 'Pump and Dump Tracker',   run: (t) => fetchPumpAndDumpTracker(t) },
  'agreements':              { label: 'Agreements',              run: (t) => fetchAgreements(t) },
  'historical-float-pro':    { label: 'Historical Float',        run: (t) => fetchHistoricalFloatPro(t, 20) },
  'reverse-splits':          { label: 'Reverse Splits',          run: (t) => fetchReverseSplits(t) },
  'filing-titles':           { label: 'Filing Titles',           run: (t) => fetchFilingTitles(t, 20) },
  'gap-stats':               { label: 'Gap Stats',               run: (t) => fetchGapStats(t, 50) },
  'ownership':               { label: 'Ownership',               run: (t) => fetchOwnership(t) },
  'split-status':            { label: 'Split Status',            run: (t) => fetchSplitStatus(t) },
};

export const ALL_ENDPOINT_KEYS = Object.keys(ENDPOINT_REGISTRY) as readonly string[];

export const ENDPOINT_SCOPES = {
  snapshot: ALL_ENDPOINT_KEYS,
  tldr: ALL_ENDPOINT_KEYS,
  lookup: ALL_ENDPOINT_KEYS,
  'small-cap-research': [
    'screener', 'dilution-rating', 'dilution-data', 'offerings', 'equity-lines',
    'registrations', 'news', 'nasdaq-compliance', 'pump-and-dump-tracker',
    'agreements', 'historical-float-pro', 'reverse-splits', 'filing-titles',
    'gap-stats', 'ownership', 'split-status',
  ],
  'swing-trader-research': [
    'dilution-data', 'dilution-rating', 'offerings', 'registrations',
    'news', 'filing-titles', 'historical-float-pro', 'gap-stats', 'ownership',
  ],
} as const satisfies Record<string, readonly string[]>;

export type EndpointScope = keyof typeof ENDPOINT_SCOPES;
```

> Scope definitions match exactly what each consumer reads from `rawData` today. Verified against `small-cap-research.ts:811-832` (16 keys; only `float-outstanding` is unread) and `swing-trader-research.ts:830-836,841-847` (9 keys including `dilution-data` for the `managementCommentary` fallback).

#### Step 3 — Add a cost-summing helper

3.1. Near the existing `endpointWarning` helper (line 348), add:

```ts
function sumCostUsd(states: EndpointState[]): number {
  const micro = states.reduce(
    (sum, s) => sum + (s.response.usage?.cost_microdollars ?? 0),
    0,
  );
  return micro / 1_000_000;
}
```

#### Step 4 — Refactor `fetchTickerData` to accept an endpoint list

4.1. Change the signature at line 465 to:

```ts
export async function fetchTickerData(
  ticker: string,
  opts?: { endpoints?: readonly string[] },
): Promise<TickerDataResult>
```

4.2. At the top of the function body, capture `const startedAt = Date.now()`.

4.3. Resolve the requested endpoint list:

```ts
const requested = opts?.endpoints ?? ENDPOINT_SCOPES.snapshot;
```

4.4. Replace the inline `endpointConfigs` array (`lib/askedgar.ts:481-499`) with a build step:

```ts
const endpointConfigs: EndpointConfig[] = requested.map((key) => {
  const entry = ENDPOINT_REGISTRY[key];
  if (!entry) {
    throw new Error(`[askedgar] Unknown endpoint key: ${key}`);
  }
  return { key, label: entry.label, run: () => entry.run(normalizedTicker) };
});
```

> Throwing on unknown keys catches typos at the call site rather than silently returning empty data.

4.5. Keep the existing batching loop (lines 504-510), `endpointStates` mapping, `warnings`, `rawData` build, and `hasAnyData` flag exactly as they are. The batch size of 10 still works for any subset.

4.6. Just before the `return` at line 519, emit the structured fan-out log:

```ts
console.log(
  `[askedgar-fanout] ticker=${normalizedTicker} requested=${requested.length} ` +
  `succeeded=${endpointStates.filter((s) => s.hasData).length} ` +
  `costUsd=${sumCostUsd(endpointStates).toFixed(4)} ` +
  `durationMs=${Date.now() - startedAt}`
);
```

#### Step 5 — Make `getCachedTickerData` scope-aware with merge-on-write

5.1. Change the signature at line 931 to:

```ts
export async function getCachedTickerData(
  ticker: string,
  opts?: { scope?: EndpointScope },
): Promise<TickerDataResult>
```

5.2. Resolve the requested endpoints near the top of the function:

```ts
const scope = opts?.scope ?? 'snapshot';
const requested = ENDPOINT_SCOPES[scope];
```

5.3. Add a small predicate above the function:

```ts
function cachedHasFreshEndpoint(
  rawData: Record<string, AskEdgarResponse<unknown>> | undefined,
  key: string,
): boolean {
  const entry = rawData?.[key];
  return Boolean(entry && entry.status !== 'error' && Array.isArray(entry.results));
}
```

5.4. Add a merge helper above the function:

```ts
function mergeRawData(
  cached: Record<string, AskEdgarResponse<unknown>>,
  fresh: Record<string, AskEdgarResponse<unknown>>,
): Record<string, AskEdgarResponse<unknown>> {
  return { ...cached, ...fresh };
}
```

5.5. Rewrite the read path (lines 935-952) so it:

1. Queries the cache row exactly as today.
2. If a fresh row exists, computes `missing = requested.filter((key) => !cachedHasFreshEndpoint(cachedResult.rawData, key))`.
3. If `missing.length === 0` → log `cacheHit=full` and return the hydrated result. Subset the returned `rawData` to only the requested keys (so callers don't see endpoints they didn't ask for); leave the DB row untouched (keep the superset).
4. If `missing.length > 0` → call `fetchTickerData(normalizedTicker, { endpoints: missing })`, build `mergedRawData = mergeRawData(cachedResult.rawData, freshResult.rawData)`, write the merged result back to the same row via `onConflictDoUpdate` (refresh `fetchedAt` and `expiresAt` using `getTickerCacheExpiry` against the merged result), and return a `TickerDataResult` whose `rawData` is `mergedRawData` subset to `requested` keys. Log `cacheHit=partial fetchedFresh=${missing.length}/${requested.length}`.
5. If no fresh cache row → behave as today: call `fetchTickerData(normalizedTicker, { endpoints: requested })`, write the row, return. Log `cacheHit=miss fetchedFresh=${requested.length}/${requested.length}`.

5.6. Keep the `inFlightTickerRequests` dedupe (lines 998-1004) keyed on `normalizedTicker` only — the merge-on-write semantics make it safe for two scopes to share an in-flight result. Document this with one short comment line.

5.7. After the cache-decision branch resolves, emit:

```ts
console.log(
  `[askedgar-cache] ticker=${normalizedTicker} scope=${scope} ` +
  `cacheHit=${cacheHit} fetchedFresh=${freshCount}/${requested.length}`
);
```

Where `cacheHit` is `'full' | 'partial' | 'miss'` and `freshCount` is the number of endpoints just fetched (0 for full hit, `missing.length` for partial, `requested.length` for miss).

5.8. Make sure the returned `rawData` on the full-hit path is subset to the requested keys. Use:

```ts
const subsetRawData = Object.fromEntries(
  requested.map((k) => [k, mergedRawData[k]]),
);
```

Return a result with `rawData: subsetRawData` and the existing `dataSources`/`warnings`/`hasAnyData` recomputed against the subset. Preserve `ticker`, `fetchedAt`, `cacheExpiresAt` on the existing return shape.

#### Step 6 — Acceptance for `lib/askedgar.ts`

- [x] `ENDPOINT_REGISTRY` and `ENDPOINT_SCOPES` are exported and the inline `endpointConfigs` array is gone from `fetchTickerData`.
- [x] `fetchTickerData(ticker)` with no opts behaves identically to today (fires all 17).
- [x] `fetchTickerData(ticker, { endpoints: ['gap-stats', 'ownership'] })` fires exactly two upstream calls.
- [x] `getCachedTickerData(ticker)` with no opts returns the same shape as today and writes the same cache row format.
- [x] `getCachedTickerData(ticker, { scope: 'swing-trader-research' })` against an empty cache fires 9 upstream calls and writes a row containing those 9 endpoints.
- [x] After a `'snapshot'` call populates the cache, a follow-up `'swing-trader-research'` call fires **0** upstream calls.
- [x] After a `'swing-trader-research'` call populates the cache, a follow-up `'snapshot'` call fires **8** upstream calls (17 − 9) and the merged row contains all 17.
- [x] Two log lines emit per `getCachedTickerData` call: one `[askedgar-fanout]` (only when a fetch happened) and one `[askedgar-cache]`.
- [x] Unknown endpoint keys throw a clear error.

---

### File: `lib/agents/blueprints/small-cap-research.ts`
**Action:** MODIFY

#### Step 7 — Pass small-cap scope

7.1. At line 808, change:

```ts
const result = await getCachedTickerData(ticker);
```

to:

```ts
const result = await getCachedTickerData(ticker, { scope: 'small-cap-research' });
```

7.2. No other changes. The blueprint already reads only the 16 keys included in this scope; `float-outstanding` is never referenced.

#### Acceptance

- [x] Small-cap blueprint call site passes `{ scope: 'small-cap-research' }`.
- [x] Existing blueprint tests still pass without any other source change.

---

### File: `lib/agents/blueprints/swing-trader-research.ts`
**Action:** MODIFY

#### Step 8 — Pass swing-trader scope

8.1. At line 828, change:

```ts
const result = await getCachedTickerData(ticker);
```

to:

```ts
const result = await getCachedTickerData(ticker, { scope: 'swing-trader-research' });
```

8.2. No other changes. Lines 830-847 already read only the 9 keys in scope (including `dilution-data` for the `managementCommentary` fallback at line 831).

#### Acceptance

- [x] Swing-trader blueprint call site passes `{ scope: 'swing-trader-research' }`.
- [x] `managementCommentary` still resolves correctly when present (covered by existing tests).

---

### File: `app/api/askedgar/snapshot/route.ts`
**Action:** UNCHANGED

> Default scope (`'snapshot'`) preserves all 17 endpoints. Do not modify.

### File: `app/api/askedgar/tldr/route.ts`
**Action:** UNCHANGED

### File: `app/api/askedgar/lookup/route.ts`
**Action:** UNCHANGED

---

### File: `__tests__/askedgar-client.test.ts`
**Action:** MODIFY

#### Step 9 — Add scoped fan-out and cache-merge tests

9.1. Add a test: `fetchTickerData` with explicit `endpoints` only fires the requested endpoints upstream (mock the underlying HTTP layer the existing tests already mock; assert call count and called URLs).

9.2. Add a test: `getCachedTickerData(ticker, { scope: 'swing-trader-research' })` against an empty cache fires 9 upstream calls.

9.3. Add a test: a `'snapshot'`-scoped fetch populates the cache; a follow-up `'swing-trader-research'` call fires zero upstream calls and returns 9 rawData keys.

9.4. Add a test: a `'swing-trader-research'`-scoped fetch populates the cache; a follow-up `'snapshot'` call fires exactly 8 upstream calls and the persisted cache row now contains all 17 endpoint keys.

9.5. Add a test: response objects with `usage.cost_microdollars` get summed into the `[askedgar-fanout]` log line. Spy on `console.log` and assert the `costUsd=` token reflects `sum_microdollars / 1_000_000` formatted to 4 decimals.

9.6. Add a test: `fetchTickerData(ticker, { endpoints: ['nope'] })` throws.

#### Acceptance

- [x] All six new tests pass.
- [x] Existing tests at lines 81, 96-97, 111, 137, 146, 155-161 continue to pass without modification.

---

### File: `__tests__/agent-blueprints.test.ts`
**Action:** MODIFY

#### Step 10 — Assert blueprint call sites pass scope

10.1. Locate the existing assertion at line 1277:

```ts
expect(getCachedTickerDataMock).toHaveBeenCalledWith('AAPL');
```

Change to:

```ts
expect(getCachedTickerDataMock).toHaveBeenCalledWith('AAPL', { scope: 'small-cap-research' });
```

10.2. Locate the matching assertion for swing-trader at line 1310 and change to:

```ts
expect(getCachedTickerDataMock).toHaveBeenCalledWith('AAPL', { scope: 'swing-trader-research' });
```

> Read the surrounding test context (lines 1245-1310) to confirm which `it(...)` block is small-cap vs swing-trader before editing — line numbers may drift slightly during the test file update.

#### Acceptance

- [x] Both blueprint call-site assertions verify the scope object is passed.

---

### Files Changed Summary

| File | Action | Approx. lines added/removed | Risk |
|---|---|---|---|
| `lib/askedgar.ts` | MODIFY | +120 / -25 | Medium — central ticker-fetch path; covered by tests |
| `lib/agents/blueprints/small-cap-research.ts` | MODIFY | +1 / -1 | Low |
| `lib/agents/blueprints/swing-trader-research.ts` | MODIFY | +1 / -1 | Low |
| `__tests__/askedgar-client.test.ts` | MODIFY | +90 / -0 | Low |
| `__tests__/agent-blueprints.test.ts` | MODIFY | +2 / -2 | Low |

No DB migration. No new files. No API contract changes.

---

### Verification Steps

From repo root, in order:

1. `npm run lint`
2. `npx tsc --noEmit`
3. `npm test`

`npm run typecheck:services` is **not** required (no `services/` files touched).
`npm run workflow:audit` is **not** required (no `.claude/` or `AGENTS.md` files touched).

Manual smoke checks (after deploying or running `npm run dev`):

- [ ] Open Research Tab on a ticker. Confirm `[askedgar-fanout]` log shows `requested=17` on cold cache or no fan-out log on warm cache, plus `[askedgar-cache] cacheHit=miss` or `=full`.
- [ ] Run a small-cap research report on the same ticker within 1 hour. Confirm `[askedgar-cache] scope=small-cap-research cacheHit=full` and **no** `[askedgar-fanout]` line for that ticker.
- [ ] Run a swing-trader research report on a fresh ticker. Confirm `[askedgar-fanout] requested=9` and `costUsd=` populated.
- [ ] Inspect the `askedgar_cache` row for that ticker — `data_json.rawData` should accumulate keys across scopes.

### Rollback

Revert the commit. No DB migration, no schema change. Cache rows written under the new code remain valid for old code — they're still `cache_type='ticker'` rows with full `rawData` JSON.

### Out of scope (separate future specs)

- Dropping `filing-titles` and `historical-float-pro` from the registry entirely (already noted in HANDOFF Follow-Up Notes; will become a 1-line registry trim after we measure savings here first).
- Persisting per-call cost to a `askedgar_usage` table — defer until logs reveal the right shape.
- Tier A SEC replacement per `docs/ae-buildout.md`.

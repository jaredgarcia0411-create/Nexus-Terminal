# Nexus Terminal - HANDOFF.md

> Updated: 2026-05-19
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and `docs/repo-cleanup.md`.

> Historical completed sections were removed to keep this file focused. Use git history and the `specs/` directory for archived implementation detail.

## Recently Completed (Uncommitted)

Trade date and executions fix (validated 2026-05-19, not yet committed). Touches `lib/trade-utils.ts`, `components/trading/TradeDetailSheet.tsx`, `lib/position-matcher.ts`, `app/api/trades/import-raw/route.ts`, and the matching `__tests__/` files. Validation (`npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run workflow:audit`) passed.

---

## Spec: Ask Edgar Cost Reduction — Round 1

> Generated: 2026-05-19 | Author: inline (post-investigation)
> Status: COMPLETED 2026-05-19
> Owner: Codex

Reduce Ask Edgar spend by removing duplicate fetches, filtering payloads, and deleting dead code. Per-KB billing model (see `docs/ae-buildout.md` "Pricing Model") means cache TTL + payload shaping beats per-call swaps. Six numbered changes follow; implement in order, one commit per change is fine.

Completion evidence:
- Implemented Changes 1-6 in order. Final snapshot scope has 15 endpoint keys after dropping `agreements`.
- Ask Edgar `/v1/news` reference confirmed `form_type` support; `fetchNews` now sends `form_type=news,8-K,S-1`.
- `npm run db:generate` generated migration 0040; it was renamed to `0040_drop_askedgar_daily_tickers.sql` and adjusted to explicitly drop the daily-ticker index/table.
- Validation passed: `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run db:migrate`, `npm run workflow:audit`.
- Manual browser smoke not run in this session.

### Background context Codex must know first

- Ask Edgar bills per KB of response, not per call. Failed requests are free.
- The ticker cache (`askedgar_cache.cacheType = 'ticker'`) is shared across all `EndpointScope`s. A narrower scope just controls what's considered "missing" on read; cache merge writes back the full set of fetched endpoints.
- `ENDPOINT_SCOPES.snapshot` is the default scope used by the Research page and the Nexus TLDR (via `lib/research.ts:190`). Both already share the same ticker cache row.
- The scanner currently has its own derived-summary cache row (`cacheType = 'scanner-summary'`, 24h TTL) keyed by ticker. We keep that row. What changes is the underlying endpoint fetch path.

---

### Change 1 — Scanner-summary reuses `getCachedTickerData`

**Why:** `fetchScannerSummaryRaw` in `lib/askedgar/cache.ts:424-476` directly calls four Ask Edgar endpoints (`fetchRegistrations`, `fetchDilutionRating`, `fetchDilutionData`, `fetchEquityLines`) and writes ONLY to the `scanner-summary` cache row. If the same ticker is later viewed on the Research page, the snapshot fanout re-fetches those same four endpoints into the `ticker` cache row. We pay twice. Routing the scanner through `getCachedTickerData` writes those four endpoints to the shared `ticker` row, so subsequent snapshot fanouts only fetch the remaining endpoints.

**File:** `lib/askedgar/endpoints.ts`
**Action:** MODIFY

1. In the `ENDPOINT_SCOPES` object (currently lines 307–321), add a new narrow scope after `lookup`:
   ```ts
   'scanner-summary': [
     'registrations', 'dilution-rating', 'dilution-data', 'equity-lines',
   ],
   ```
   Note: leave the order of the other scopes alone. After this and Change 4, the final `ENDPOINT_SCOPES` keys are `snapshot`, `scanner-summary`, `small-cap-research`, `swing-trader-research`.

**File:** `lib/askedgar/cache.ts`
**Action:** MODIFY

1. Remove the now-unused fetch imports at the top of the file (lines 11–14 inside the `endpoints` import block):
   - Remove `fetchDilutionData`, `fetchDilutionRating`, `fetchEquityLines`, `fetchRegistrations`. Keep `extractRetryAfterSeconds`, `isRateLimitError`, `replaceRetryAfterSeconds`, `responseHasData`, `SEC_BACKED_ENDPOINT_KEYS`, `ENDPOINT_REGISTRY_LOOKUP`, `ENDPOINT_SCOPES`.
2. Replace the entire body of `fetchScannerSummaryRaw` (lines 424–476) with a version that calls `getCachedTickerData(normalizedTicker, { scope: 'scanner-summary' })` and derives the same five booleans from `result.rawData`:

   ```ts
   async function fetchScannerSummaryRaw(ticker: string): Promise<ScannerSummaryResult> {
     const normalizedTicker = ticker.trim().toUpperCase();

     // Route through the shared ticker cache. This writes the four endpoints we
     // need into the cacheType='ticker' row so a later Research-page snapshot
     // fanout only fetches the remaining endpoints instead of re-paying for
     // these four. Reads honor the existing 16h TTL.
     const result = await getCachedTickerData(normalizedTicker, { scope: 'scanner-summary' });

     const registrationsResp = result.rawData['registrations'] ?? { status: 'error', count: 0, results: [] };
     const dilutionRatingResp = result.rawData['dilution-rating'] ?? { status: 'error', count: 0, results: [] };
     const dilutionDataResp = result.rawData['dilution-data'] ?? { status: 'error', count: 0, results: [] };
     const equityLinesResp = result.rawData['equity-lines'] ?? { status: 'error', count: 0, results: [] };

     const dilutionRatingFirst = toRecord(dilutionRatingResp.results[0]);
     const dilutionDataFirst = toRecord(dilutionDataResp.results[0]);

     const cashRemainingMonths: number | null =
       toNumberValue(getField(dilutionRatingFirst, ['cash_remaining_months', 'cashRemainingMonths'])) ??
       toNumberValue(getField(dilutionDataFirst, ['cashRemainingMonths', 'monthsRemaining']));

     const registrationRows = registrationsResp.results.map((item, index) =>
       toRegistrationRow(toRecord(item), `Registration ${index + 1}`),
     );

     const hasAtm = registrationRows.some((row) => row.isAtm);
     const hasS1 = registrationRows.some((row) => {
       const formType = row.formType ?? '';
       return /^S-1/i.test(formType);
     });

     const hasElFromEquityLines = equityLinesResp.results.length > 0;
     const hasElFromRegistrations = registrationRows.some((row) => {
       if (row.isAtm) return false;
       return isEquityLineHeadline(row.headline);
     });
     const hasEl = hasElFromEquityLines || hasElFromRegistrations;

     const hasWarrants = dilutionDataResp.results.some((item) => {
       const row = toRecord(item);
       const amount = toNumberValue(getField(row, ['warrants_amount']));
       return amount !== null && amount > 0;
     });

     return {
       ticker: normalizedTicker,
       cashRemainingMonths,
       hasAtm,
       hasEl,
       hasWarrants,
       hasS1,
       fetchedAt: new Date().toISOString(),
     };
   }
   ```

3. Confirm `getField`, `toNumberValue`, `toRecord` imports at the top of the file remain (line 3). They were already imported for the original implementation, just keep them. `toRegistrationRow` and `isEquityLineHeadline` imports from `@/lib/askedgar/snapshot-normalizer` (line 21) also stay.

**Expected behavior after Change 1:**
- Scanner ticker X (cold) → fetches 4 endpoints → writes both `ticker` row (4 keys) and `scanner-summary` row (booleans, 24h TTL).
- User clicks ticker X → snapshot fanout reads `ticker` row → finds 4 endpoints fresh → fetches the missing 11 → merges, writes 15-key `ticker` row.
- Scanner ticker X (warm, within 16h) → reads existing `ticker` row → no fetch → derives booleans → writes `scanner-summary` row (or hits it directly if also within 24h).

**Acceptance criteria:**
- [ ] `ENDPOINT_SCOPES['scanner-summary']` exists and contains exactly `['registrations', 'dilution-rating', 'dilution-data', 'equity-lines']`.
- [ ] `fetchScannerSummaryRaw` no longer calls `fetchRegistrations`/`fetchDilutionRating`/`fetchDilutionData`/`fetchEquityLines` directly; greps for those names in `lib/askedgar/cache.ts` return zero hits.
- [ ] `fetchScannerSummaryRaw` calls `getCachedTickerData(..., { scope: 'scanner-summary' })`.
- [ ] Existing `__tests__/askedgar-client.test.ts` scanner-summary cases still pass (booleans match prior expectations). If any test mock-stubbed the four raw fetches directly, replace the stub with a mock of `getCachedTickerData` returning a `TickerDataResult` with the same shape in `rawData`.

---

### Change 2 — Filter `/v1/news` to news + 8-K + S-1 only

**Why:** Today's `/v1/news` response includes `jmt415` and `grok` rows (LLM summaries Ask Edgar adds), plus every form_type they have. We render only `news`, `8-K`, and `S-1` in the UI. Per-KB billing means filtering server-side (or, failing that, narrowing what we render and accept) is the lever.

**Pre-step (server-side capability check):**

1. Use the Ask Edgar MCP from `.mcp.json` to fetch the schema for `GET /v1/news`. Look for a query parameter that accepts a form-type filter list (likely names: `form_type`, `form_types`, `formType`, `types`, `filter`).
2. If a server-side filter param exists, prefer it (lowest KB cost). If not, fall back to client-side filtering only.

**File:** `lib/askedgar/endpoints.ts`
**Action:** MODIFY

1. Update `fetchNews` (lines 244–250) to pass the filter param **only if server support is confirmed**:
   ```ts
   export async function fetchNews(ticker: string, limit = 40) {
     const validated = validateTickerOrError<unknown>(ticker);
     if (typeof validated !== 'string') return validated;
     // SERVER-SIDE FILTER: only news + 8-K + S-1 form types. Per-KB billing
     // makes this the highest-leverage payload-shaping change. Drop the LLM
     // summary rows (`jmt415`, `grok`) and any form type we don't render.
     return requestAskEdgar<unknown>('/v1/news', {
       ticker: validated,
       limit,
       // <<< replace `form_type` with the parameter name verified from the MCP schema >>>
       form_type: 'news,8-K,S-1',
     });
   }
   ```
   If no server-side filter exists, leave `fetchNews` unchanged and rely on Change 2 client-side filtering below.

**File:** `lib/askedgar/snapshot-normalizer.ts`
**Action:** MODIFY

1. Replace the `NON_FILING_FORM_TYPES` set (line 286) and the two filters at lines 289–300 with explicit allowlists:
   ```ts
   // News bucket: ONLY actual news rows. Previously this set also included
   // 'grok' and 'jmt415' (Ask Edgar LLM summaries) — those bloat KB cost and
   // confuse the Research-tab news section, so we drop them entirely.
   const NEWS_FORM_TYPES = new Set(['news']);
   // Filings fallback bucket (from /v1/news when /v1/sec-filings has no data):
   // only forms we actually render in the Filings tab.
   const ALLOWED_NEWS_FILING_TYPES = new Set(['8-k', 's-1']);

   const newsEndpointRows = getEndpointResponse(rawData, ['news']).results.map((item) => toRecord(item));

   const news: ResearchSnapshotNewsItem[] = newsEndpointRows
     .filter((row) => NEWS_FORM_TYPES.has((getStringField(row, ['form_type', 'formType']) ?? 'news').toLowerCase()))
     .map((row, index) => ({
       title: normalizeHeadline(row, `News item ${index + 1}`),
       summary: getStringField(row, ['body', 'summary', 'details']) ?? '',
       filedAt: getStringField(row, ['filedAt', 'filed_at', 'date']),
       formType: getStringField(row, ['formType', 'form_type', 'form', 'source']) ?? 'News',
       isNews: true,
     } satisfies ResearchSnapshotNewsItem));

   const newsFilingRows: ResearchSnapshotFiling[] = newsEndpointRows
     .filter((row) => ALLOWED_NEWS_FILING_TYPES.has((getStringField(row, ['form_type', 'formType']) ?? '').toLowerCase()))
     .map((row) => {
       const formType = getStringField(row, ['form_type', 'formType', 'form']) ?? 'unknown';
       const title = getStringField(row, ['headline', 'title', 'summary', 'primary_doc_description', 'primaryDocDescription'])
         ?? `${formType} filing`;
       return {
         formType,
         bucket: bucketForFormType(formType),
         title,
         filedAt: getStringField(row, ['filed_at', 'filedAt', 'date']),
         url: getStringField(row, ['document_url', 'documentUrl', 'url']),
         accessionNumber: getStringField(row, ['accession_number', 'accessionNumber', 'accn']),
       } satisfies ResearchSnapshotFiling;
     })
     .sort((a, b) => {
       if (!a.filedAt && !b.filedAt) return 0;
       if (!a.filedAt) return 1;
       if (!b.filedAt) return -1;
       return b.filedAt.localeCompare(a.filedAt);
     });
   ```

**Acceptance criteria:**
- [ ] MCP schema for `/v1/news` was inspected; if a form-type filter param exists, `fetchNews` passes `'news,8-K,S-1'` (or the verified equivalent). If not, leave `fetchNews` as-is and note the gap in the commit message.
- [ ] `NON_FILING_FORM_TYPES` no longer appears in `snapshot-normalizer.ts`. Replaced by `NEWS_FORM_TYPES` (just `'news'`) and `ALLOWED_NEWS_FILING_TYPES` (`'8-k'`, `'s-1'`).
- [ ] On a ticker with mixed `news`/`grok`/`jmt415` rows, `news` array contains only `news` rows; `newsFilingRows` contains only `8-K`/`S-1` rows; `grok`/`jmt415` rows are dropped from both.
- [ ] Existing tests in `__tests__/askedgar-snapshot-normalizer.test.ts` (if present) pass with the new allowlists.

---

### Change 3 — Bump news cache TTL 5min → 15min

**Why:** Same per-KB calculus: tripling the TTL cuts `/v1/news` refetches by ~3x on busy tickers. 15 minutes is still well inside one trading hour, so meaningful headlines aren't missed by anyone actively trading.

**File:** `lib/askedgar/cache.ts`
**Action:** MODIFY

1. Replace line 32:
   ```ts
   const NEWS_CACHE_TTL_MS = 5 * 60 * 1000;       // 5 minutes — news refreshes throughout the trading day, but simultaneous viewers should coalesce on one call
   ```
   With:
   ```ts
   const NEWS_CACHE_TTL_MS = 15 * 60 * 1000;       // 15 minutes — per-KB billing makes a longer coalesce window worth the small staleness; still well inside any active trading session
   ```

**Acceptance criteria:**
- [ ] `NEWS_CACHE_TTL_MS = 15 * 60 * 1000` in `lib/askedgar/cache.ts`.
- [ ] No other usages of `NEWS_CACHE_TTL_MS` had their behavior changed (grep should show only this constant declaration and one usage in `cachedHasFreshEndpoint`, both already correct).

---

### Change 4 — Delete dead `tldr` and `lookup` scopes

**Why:** Both scopes are defined as `ALL_ENDPOINT_KEYS` and have zero callers anywhere in the repo (verified via grep). They predate the current scope system and just clutter the type union. The Nexus TLDR feature uses `cacheType: 'tldr'` in `lib/research.ts` — that's a separate DB cache key, not this scope.

**File:** `lib/askedgar/endpoints.ts`
**Action:** MODIFY

1. In `ENDPOINT_SCOPES` (lines 307–321), delete lines 309 and 310:
   ```ts
   tldr: ALL_ENDPOINT_KEYS,
   lookup: ALL_ENDPOINT_KEYS,
   ```
2. Final `ENDPOINT_SCOPES` keys after Change 1 + Change 4: `snapshot`, `scanner-summary`, `small-cap-research`, `swing-trader-research`.

**Acceptance criteria:**
- [ ] `ENDPOINT_SCOPES` no longer has `tldr` or `lookup` keys.
- [ ] `npx tsc --noEmit` passes (no `EndpointScope` references to those deleted keys exist anywhere).

---

### Change 5 — Drop the `agreements` endpoint everywhere

**Why:** User hasn't opened the Agreements table in 30+ days. `/v1/agreements` returns large investor-agreement payloads that cost per-KB on every snapshot fanout. Pure dead weight.

**File:** `lib/askedgar/endpoints.ts`
**Action:** MODIFY

1. Delete the `fetchAgreements` function (lines 258–262).
2. In `ENDPOINT_REGISTRY` (line 292), delete:
   ```ts
   agreements: { label: 'Agreements', run: (ticker) => fetchAgreements(ticker) },
   ```
3. In `ENDPOINT_SCOPES.small-cap-research` (line 313), remove the `'agreements'` entry from the array.

**File:** `lib/askedgar/snapshot-normalizer.ts`
**Action:** MODIFY

1. Delete the `agreements` derivation block (lines 489–497).
2. In the `return { ... }` block (around line 580), remove the `agreements,` line from the returned object.

**File:** `lib/types.ts`
**Action:** MODIFY

1. Delete the `ResearchSnapshotAgreement` interface (lines 296–301).
2. In `ResearchSnapshot` (around line 343), remove `agreements: ResearchSnapshotAgreement[];`.

**File:** `lib/agents/blueprints/small-cap-research.ts`
**Action:** MODIFY

1. Delete `agreements: z.array(z.unknown()),` from the Zod schema (line 33).
2. Delete the `agreements:\n${wrapUntrusted(...)}` line from the prompt sections (line 700).
3. Delete `agreements: readResults(rawData['agreements']),` from both call sites (lines 768 and 866).

**File:** `components/trading/ResearchReportSections.tsx`
**Action:** MODIFY

1. Remove `ResearchSnapshotAgreement` from the type imports at the top of the file (line 22).
2. Delete the entire `AgreementsTable` function (lines 656–685).
3. Delete the Agreements `<h5>` + `<AgreementsTable rows={data.agreements} />` block (lines 1021–1024).

**Acceptance criteria:**
- [ ] `grep -rn "agreements\|Agreements" lib/ components/ app/ --include="*.ts" --include="*.tsx"` returns zero hits outside of unrelated contexts (test fixtures, comments unrelated to the endpoint). Allowed remaining hits would be inside `/specs/` or `/docs/` if any exist.
- [ ] Research page Dilution column no longer renders an Agreements row.
- [ ] `npx tsc --noEmit` passes; `npm run lint` passes.
- [ ] Existing snapshot-normalizer tests still pass; if any reference `.agreements`, delete those assertions.

---

### Change 6 — Remove daily-ticker cap

**Why:** The 50-unique-ticker-per-day cap is a free-tier guard. On a paid plan it's just dead code blocking legitimate use, plus a DB table and writeback on every fetch.

**File:** `lib/askedgar/fanout.ts`
**Action:** MODIFY

1. Remove the daily-limit imports at the top of the file (lines 7–14 inside the `runtime-state` import block). The final import block should keep only `syncRateLimitFromDb`:
   ```ts
   import { syncRateLimitFromDb } from '@/lib/askedgar/runtime-state';
   ```
2. In `fetchTickerData` (lines 98–119), delete:
   - `await syncDailyTickersFromDb();` (line 104)
   - `const dailyLimit = parseDailyLimit();` (line 106)
   - The `if (!hasDailyTicker(...)) { ... return ... }` guard block (lines 107–117)
   - `addDailyTicker(normalizedTicker);` (line 118)
   - `void persistDailyTicker(normalizedTicker);` (line 119)

   After deletion, `fetchTickerData` body starts with:
   ```ts
   export async function fetchTickerData(
     ticker: string,
     opts?: { endpoints?: readonly string[] },
   ): Promise<TickerDataResult> {
     const startedAt = Date.now();
     const normalizedTicker = ticker.trim().toUpperCase();
     await syncRateLimitFromDb();

     const requested = opts?.endpoints ?? ENDPOINT_SCOPES.snapshot;
     // ... rest unchanged
   ```

**File:** `lib/askedgar/runtime-state.ts`
**Action:** MODIFY

1. Delete the import of `askedgarDailyTickers` from `@/lib/db/schema` (line 4) — keep `askedgarRuntimeState`:
   ```ts
   import { askedgarRuntimeState } from '@/lib/db/schema';
   ```
2. Delete these top-level constants and variables:
   - `const DEFAULT_DAILY_LIMIT = 50;` (line 6)
   - `const uniqueTickersToday = new Set<string>();` (line 7)
   - `let resetDate = '';` (line 8)
3. Delete these functions entirely:
   - `getCurrentUtcDate` (lines 62–64)
   - `syncDailyTickersFromDb` (lines 66–90)
   - `persistDailyTicker` (lines 92–103)
   - `parseDailyLimit` (lines 110–116)
   - `hasDailyTicker` (lines 118–120)
   - `getDailyTickerCount` (lines 122–124)
   - `addDailyTicker` (lines 126–128)
   - `getAskEdgarCallCount` (lines 130–133)
   - `getAskEdgarDailyLimit` (lines 135–137)
4. Keep `syncRateLimitFromDb`, `persistRateLimit`, `setRateLimited`, `getRateLimitedUntil`, and the module-level `rateLimitedUntil` / `MODULE_RATE_LIMIT_REFRESH_MS` / `rateLimitDbLastSyncedAt` state.

**File:** `lib/askedgar.ts`
**Action:** MODIFY

1. Delete the entire export block for the runtime-state daily helpers (lines 15–18):
   ```ts
   export {
     getAskEdgarCallCount,
     getAskEdgarDailyLimit,
   } from '@/lib/askedgar/runtime-state';
   ```

**File:** `lib/db/schema.ts`
**Action:** MODIFY

1. Delete the `askedgarDailyTickers` table definition (lines 155–163, inclusive of the leading comment).

**File:** `drizzle/0040_drop_askedgar_daily_tickers.sql`
**Action:** CREATE

1. Generate a migration that drops the table. Pick the next sequential migration number (current latest is `0039_backfill_closed_at_noon.sql`, so use `0040`). Run `npm run db:generate` after editing `lib/db/schema.ts` to let Drizzle scaffold the migration; if the generated SQL needs a name, rename to `0040_drop_askedgar_daily_tickers.sql`. The generated file should contain (verify after generation):
   ```sql
   DROP INDEX IF EXISTS "askedgar_daily_tickers_date_idx";
   --> statement-breakpoint
   DROP TABLE IF EXISTS "askedgar_daily_tickers";
   ```
2. **Do not run `npm run db:push`.** Use `npm run db:migrate` to apply.

**File:** `__tests__/askedgar-client.test.ts`
**Action:** MODIFY

1. Delete the two tests that reference `getAskEdgarCallCount` and the daily-ticker DB persistence:
   - The `it('tracks unique ticker count', ...)` block (around lines 458–465).
   - The `it('persists unique ticker usage to the DB-backed daily state', ...)` block (around lines 467–477).
2. If `getDailyTickers()` is defined on the `createAskedgarCacheDb()` test helper elsewhere in this file solely to support these tests, delete its definition too. If it's used by other tests, leave it.

**Acceptance criteria:**
- [ ] `getAskEdgarCallCount`, `getAskEdgarDailyLimit`, `parseDailyLimit`, `hasDailyTicker`, `getDailyTickerCount`, `addDailyTicker`, `persistDailyTicker`, `syncDailyTickersFromDb` no longer exist (grep returns zero).
- [ ] `askedgarDailyTickers` no longer exists in `lib/db/schema.ts` or anywhere else (grep returns zero outside `drizzle/0033_*.sql` and the new drop migration).
- [ ] New migration `drizzle/0040_*.sql` exists and drops the table + index.
- [ ] `npm run db:migrate` applies cleanly (verify before declaring done).
- [ ] `fetchTickerData` no longer references daily-ticker tracking; the function still calls `syncRateLimitFromDb()` and the rate-limit guard inside `requestAskEdgar` still works.
- [ ] `npm test` passes, including the rate-limit DB-persistence test.

---

### Files Changed Summary

| File | Change | Risk |
|------|--------|------|
| `lib/askedgar/endpoints.ts` | Add `scanner-summary` scope, delete `tldr`/`lookup` scopes, drop `fetchAgreements` + registry entry, conditionally add `form_type` param to `fetchNews` | Low |
| `lib/askedgar/cache.ts` | Refactor `fetchScannerSummaryRaw` to use `getCachedTickerData`, bump `NEWS_CACHE_TTL_MS` to 15min, drop 4 unused imports | Medium (touches core caching path) |
| `lib/askedgar/snapshot-normalizer.ts` | Replace `NON_FILING_FORM_TYPES` with two allowlist sets, drop `agreements` derivation + return field | Medium (touches normalization, affects UI shape) |
| `lib/askedgar/fanout.ts` | Remove daily-ticker cap guard + 5 helper calls | Low |
| `lib/askedgar/runtime-state.ts` | Delete 9 functions + 3 module-level constants tied to daily-ticker tracking | Low |
| `lib/askedgar.ts` | Drop 2 exports | Trivial |
| `lib/db/schema.ts` | Drop `askedgarDailyTickers` table definition | Low |
| `lib/types.ts` | Drop `ResearchSnapshotAgreement` interface + `agreements` field on snapshot | Low |
| `lib/agents/blueprints/small-cap-research.ts` | Drop `agreements` Zod field + prompt section + two `readResults` call sites | Low |
| `components/trading/ResearchReportSections.tsx` | Drop `AgreementsTable` function + render block + type import | Low |
| `drizzle/0040_drop_askedgar_daily_tickers.sql` | NEW — drop the daily-tickers table + index | Low |
| `__tests__/askedgar-client.test.ts` | Delete 2 daily-ticker tests | Trivial |

Estimated total: 12 files touched, ~250 lines removed, ~80 lines added.

---

### Verification Steps

Run in order from repo root after all six changes are implemented:

1. `npm run lint`
2. `npx tsc --noEmit`
3. `npm test`
4. `npm run db:migrate` (verify the new migration applies cleanly; **do not use `db:push`**)
5. `npm run workflow:audit` (because `HANDOFF.md` changed)

Manual smoke checks (run dev server with `npm run dev`):

- **Scanner cache reuse:** open Scanner with at least one ticker that hasn't been viewed today. After it appears, immediately open the same ticker in Research. Confirm in the server logs that `[askedgar-cache] ticker=X scope=snapshot cacheHit=partial fetchedFresh=11/15` (or similar — the 4 scanner endpoints should be cached, only the remaining 11 fetched).
- **News filter:** open Research for a ticker known to have LLM summary rows (Ask Edgar `jmt415`/`grok`). Confirm the News section no longer shows those rows. Confirm only 8-K and S-1 rows appear in the Filings fallback when `/v1/sec-filings` returns nothing.
- **News TTL:** load a ticker's news, immediately refresh the page → expect a cache hit. Wait ~16 minutes and refresh → expect a fresh `/v1/news` call.
- **Agreements removed:** open Research for any ticker. Dilution column should no longer show "Agreements" heading or table.
- **Daily cap removed:** fetch 60+ unique tickers in a single day (via Scanner or repeated Research opens) → none return the `daily unique ticker limit reached` warning.

---

## Session Maintenance Checklist

- [x] Read this file before starting.
- [x] If the active context drifts from the live repo, update the context or stop and ask before editing.
- [x] Implement Changes 1–6 in the order listed above. One commit per change is fine; do not bundle Change 6 (schema/migration) with anything else.
- [x] Run the Verification Steps before reporting work complete.
- [ ] Do not push to remote without explicit user instruction.
- [x] Do not modify `.env*` or secret files.
- [x] Use `npm run db:migrate`, never `db:push`.

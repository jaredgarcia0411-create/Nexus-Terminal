# Nexus Terminal - HANDOFF.md

> Updated: 2026-05-24
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and durable docs such as `docs/repo-cleanup.md`.

---

## Sprint 4 — AE Endpoint Swap + Historical Dilution Rating

Status: completed 2026-05-24.

Validation:
- `npm run lint` — passed.
- `npx tsc --noEmit` — passed.
- `npm test` — passed (93 files, 676 tests).
- `npm run workflow:audit` — passed.
- Manual Research smoke remains user-run; no dev server/browser smoke was run in this session.

### Why

Four of our SEC-backed parsers consistently miss data the Ask Edgar (AE) endpoints capture cleanly (historical tickers, past offerings, reverse splits). The user wants to pay for AE coverage on those surfaces. Two AE endpoints we currently call (`ownership`, `split-status`) are never looked at in practice — drop the calls. AE shipped a new `/v1/historical-dilution` endpoint that returns the dilution-rating snapshot as of a given date; we want to render it next to Gap Up Days for the most recent gap. Plus two tiny UI tweaks (theme-toggle icon position and a leftover Open Follow-Up).

All endpoint paths and response shapes below were verified against the live AE API on 2026-05-24 with a throwaway probe (since deleted). Cost data is from the live `usage` block.

### Endpoint changes summary

| Surface | Before | After |
|---|---|---|
| Previous tickers / "Former Symbols" | `lib/sec/identity-events.ts` parser | AE `/v1/historical-tickers?ticker=X` |
| Past offerings | `lib/sec/offerings.ts` parser | AE `/v1/offerings?ticker=X&limit=50` |
| Reverse splits | `lib/sec/reverse-splits.ts` parser | AE `/v1/reverse-splits?ticker=X` |
| Split status | AE `/v1/split-status` | **removed** (UI section deleted) |
| Ownership | AE `/v1/ownership` | **removed** (UI section deleted) |
| Historical dilution rating | — | AE `/v1/historical-dilution?ticker=X&date=YYYY-MM-DD` (new) |

### Live AE response shapes (verified 2026-05-24)

`/v1/historical-tickers?ticker=BINI` (cost $0.0089) →
```json
{ "status": "success", "count": 1, "results": [
  { "current_ticker": "BINI", "historical_tickers": [{ "ticker": "MULN", "date_changed": "2025-07-28" }] }
]}
```
Note: a query on `MULN` (the old symbol) returns the SAME record (with `current_ticker: "BINI"`). The endpoint is idempotent across either direction.

`/v1/reverse-splits?ticker=TNXP` (cost $0.0094) →
```json
{ "status": "success", "count": 7, "results": [
  { "ticker": "TNXP", "execution_date": "2025-02-05", "split_from": 100, "split_to": 1, "last_updated": "..." }
]}
```

`/v1/offerings?ticker=TNXP&limit=3` (cost $0.0152) →
```json
{ "status": "success", "results": [{
  "ticker": "TNXP", "headline": "ATM USED", "filed_at": "2026-05-11", "form_type": "news",
  "offering_type": " S-3", "askedgar_url": "...", "selling_shareholder_details": "...",
  "shares_amount": null, "warrants_amount": null, "share_price": null,
  "offering_amount": 5200000, "conversion_price": null, "last_updated": "..."
}]}
```

`/v1/historical-dilution?ticker=TNXP&date=2024-12-17` (cost **$0.301** — heavy, must cache aggressively) →
```json
{ "status": "success", "count": 1, "results": [{
  "ticker": "TNXP", "date": "2024-12-17",
  "overall_offering_risk": "High",
  "cash_need": "High", "cash_need_desc": "The company has 2.93 months of cash left...",
  "offering_ability": "High", "offering_ability_desc": "Shelf Capacity: $97.78M, ATM: $9.50M, No Equity Line, No S-1 Offering",
  "offering_frequency": "High", "offering_frequency_desc": "Count of offering types in last 2 yrs: Offerings: 7...",
  "dilution": "High", "dilution_desc": "156.7%",
  "estimated_cash": 15052207.18, "cash_remaining_months": 2.93, "cash_burn": -15431666.67,
  "shelf_capacity": 97776477, "has_pending_s1": false, "offering_count_2y": 14, "regsho": false
}]}
```

---

### Step 1 — Drop ownership and split-status

**File:** `lib/askedgar/endpoints.ts`
- Delete `fetchOwnership` (~line 265) and `fetchSplitStatus` (~line 271).
- Remove `ownership` and `split-status` keys from `ENDPOINT_REGISTRY` (~lines 291–292).
- Remove `'ownership'` and `'split-status'` from `ENDPOINT_SCOPES.snapshot`, `.small-cap-research`, `.swing-trader-research` (~lines 301–315).

**File:** `lib/askedgar/snapshot-normalizer.ts`
- Delete the ownership mapping block (~line 421, function that builds `data.ownershipGroups`).
- Delete the split-status mapping block (~line 482, function that builds `data.splitStatuses`).
- Remove the `ownershipGroups` and `splitStatuses` properties from the returned snapshot object.

**File:** `lib/types.ts`
- Delete `ResearchSnapshotOwnershipGroup`, `ResearchSnapshotOwner`, `ResearchSnapshotSplitStatus` type exports.
- Remove `ownershipGroups: ResearchSnapshotOwnershipGroup[]` and `splitStatuses: ResearchSnapshotSplitStatus[]` from the `ResearchSnapshot` interface.

**File:** `components/trading/research-report-sections/DilutionSection.tsx`
- Delete the `OwnershipGroupsTables` component (~line 450) and its `<h4>Owners</h4>` render block (~line 601–604).
- Delete the `SplitStatusesTable` component (~line 382) and the `<h5>Split Status</h5>` block inside `Split History` (~line 548–551). After removal, the `Split History` section only renders Reverse Splits — drop the inner `<h5>Reverse Splits</h5>` heading since it's now the only subsection (the `<h4>Split History</h4>` header stands alone).
- Drop the type imports for `ResearchSnapshotOwnershipGroup` and `ResearchSnapshotSplitStatus`.

**File:** `lib/agents/blueprints/small-cap-research.ts` — `ownership` and `splitStatus` are wired in DEEP, not just scope keys. Strip every reference:
- `edgarSectionsSchema` (~lines 21–38): delete `ownership: z.unknown().nullable()` (line 29) and `splitStatus: z.unknown().nullable()` (line 32).
- `deterministicAnalysisSchema` (~lines 57–77): delete `splitApproved: z.boolean()` (line 66), `splitEffectivePending: z.boolean()` (line 67), `knownHolderOverhang: z.number().nullable()` (line 70). Adjust any callers reading these fields downstream (LLM example shape, system prompts).
- `computeDeterministicAnalysis` (~lines 578–582 split-status block, ~617–626 ownership block): delete both blocks and the `splitApproved` / `splitEffectivePending` / `knownHolderOverhang` keys from the `return` object (~lines 637–641). Drop `flattenOwnershipRecords` import if it's no longer used.
- `buildResearchPrompt` (~lines 695, 698): delete the `ownership` and `splitStatus` lines from the prompt sections array.
- `edgarSectionsSchema.parse(...)` call (~lines 763, 766): drop the `ownership: readResults(rawData['ownership'])` and `splitStatus: readResults(rawData['split-status'])` keys.
- Blueprint step inner `completedResult` (~lines 864, 867): drop the same two `readResults` keys.

**File:** `lib/agents/blueprints/swing-trader-research.ts` — same depth, `ownership` only (this blueprint never used split-status):
- `filingsSchema` (~line 23): delete `ownership: z.array(z.unknown())`.
- `runnerQualitySchema` (~lines 82, 88): delete `ownership: z.array(z.unknown())` and `knownHolderOverhang: z.number().nullable()`.
- `computeKnownHolderOverhang` function (~lines 473–486): delete the entire function and its single call site at line 633.
- `computeSwingTechnicals` (~lines 627, 633): delete `ownership: asArray(input.ownership)` and `knownHolderOverhang: computeKnownHolderOverhang(input.ownership)`.
- `buildResearchPrompt` (~line 679): delete the `ownership` line from the runner quality prompt sections.
- Blueprint step inner `completedResult` (~line 783): drop `ownership: readSection(rawData, 'ownership')`.

**Tests to update — the spec previously underspecified this; here is the complete inventory:**

- `__tests__/askedgar-client.test.ts`:
  - Lines 263, 268, 270 — remove `'ownership'` from the explicit endpoint-list test.
  - Line 282 — `expect(fetchSpy).toHaveBeenCalledTimes(6)` becomes `7` (swing-trader scope drops `ownership` but `offerings`/`reverse-splits`/`historical-tickers` are now AE-bound, not SEC, so count goes up).
  - Lines 255, 294, 303 — `toHaveLength(15)` snapshot-scope endpoint count becomes `13` (drop ownership + split-status + identity-events; add historical-tickers).
  - Lines 319, 322–323 — update the comment block "// reverse-splits, sec-filings, identity-events, split-status" so the `rg` acceptance grep passes.
  - Line 341 — separate `costUsd` test that uses `['gap-stats', 'ownership']` — replace ownership with another endpoint or remove the case.

- `__tests__/research-snapshot-mapper.test.ts`:
  - Four fixtures contain `ownership: emptyResponse` and `'split-status': emptyResponse`: lines 149/151/152, 259/270/271, 374/376/377, 456/458/459. Delete those keys from every fixture.
  - Lines 13–55 — the `'maps SEC-backed identity events…'` test must be DELETED and replaced with a `historical-tickers` test asserting the new `historicalTickers: ResearchSnapshotHistoricalTicker[]` field (use the live AE shape at the top of this spec).
  - Lines 57–82 — the reverse-splits test currently asserts `{ ratio: '1-for-20', lifecycleStatus: 'completed', effectiveDate: ... }`. Rewrite the fixture as the AE shape `{ ticker, execution_date, split_from, split_to, last_updated }` and update the expected assertion to `{ date: '2025-02-05', ratio: '100-for-1' }` (per the new mapper template `${split_from}-for-${split_to}`).
  - Lines 333–369 (offerings fixture) — currently camelCase SEC-parser shape with `accessionNumber`, `url`, `isSellingStockholderResale`, etc. Replace with the AE snake_case shape (`filed_at`, `shares_amount`, `offering_amount`, `headline`, `offering_type`, `share_price`, `warrants_amount`, `conversion_price`, `selling_shareholder_details`, `askedgar_url`).
  - Lines 388–407 expected assertion — the current expected `headline` is a synthesized string `'ATM USED — 2,000,000 shares — @ $2.50 — $5.0M'`. New mapper passes `row.headline` through, so update expected to `headline: 'ATM USED'`. Drop expected `accessionNumber`/`url`/`status` keys.

- `__tests__/research-report-sections.test.tsx` (spec previously missed this file entirely):
  - `buildSnapshot` fixture (~lines 60–80) — delete the `ownershipGroups: []`, `splitStatuses: []`, and `identityEvents: []` keys. Add `historicalTickers: []`.
  - Full `identityEvents` array fixture (~lines 177–200) — delete the array literal and any DilutionSection-rendering test that asserts the "Former Symbols" rendering against it. Replace with a `historicalTickers` array + assertion that the new `HistoricalTickersTable` renders the rows.

- `__tests__/agent-blueprints.test.ts`:
  - Swing-trader fixture passes mocked `ownership: { results: [{ holder: 'Fund A' }] }` (~line 1534–1536). Delete the key — the blueprint no longer reads it.
  - Verify no test asserts a fixed endpoint-count per blueprint (`rg "toHaveLength" __tests__/agent-blueprints.test.ts`); the reviewer confirmed there are none, but if any have been added, adjust.

Expected outcome: `rg "'ownership'|'split-status'|'identity-events'|ownershipGroups|splitStatuses|identityEvents|splitApproved|splitEffectivePending|knownHolderOverhang|flattenOwnershipRecords|computeKnownHolderOverhang"` returns zero matches in `lib/`, `app/`, `components/`, `__tests__/`.

### Step 2 — Repoint offerings, reverse-splits, historical-tickers to AE

**2a — Add new AE fetchers in `lib/askedgar/endpoints.ts`** (right after `fetchEquityLines`):
```ts
export async function fetchOfferings(ticker: string, limit = 50) {
  const validated = validateTickerOrError<unknown>(ticker);
  if (typeof validated !== 'string') return validated;
  return requestAskEdgar<unknown>('/v1/offerings', { ticker: validated, limit });
}

export async function fetchReverseSplits(ticker: string) {
  const validated = validateTickerOrError<unknown>(ticker);
  if (typeof validated !== 'string') return validated;
  return requestAskEdgar<unknown>('/v1/reverse-splits', { ticker: validated });
}

export async function fetchHistoricalTickers(ticker: string) {
  const validated = validateTickerOrError<unknown>(ticker);
  if (typeof validated !== 'string') return validated;
  return requestAskEdgar<unknown>('/v1/historical-tickers', { ticker: validated });
}
```

**2b — Repoint `ENDPOINT_REGISTRY` runners** in `lib/askedgar/endpoints.ts`:
```ts
offerings:        { label: 'Offerings',          run: (t) => fetchOfferings(t, 50) },
'reverse-splits': { label: 'Reverse Splits',     run: (t) => fetchReverseSplits(t) },
'historical-tickers': { label: 'Historical Tickers', run: (t) => fetchHistoricalTickers(t) },
```
- Delete the `'identity-events'` registry entry. Replace it in `ENDPOINT_SCOPES.snapshot` and `ENDPOINT_SCOPES.small-cap-research` with `'historical-tickers'`.
- Remove `offerings`, `reverse-splits`, `identity-events` from `SEC_BACKED_ENDPOINT_KEYS` (~lines 10–16). They are no longer SEC-backed.
- Drop the now-unused imports `getOfferings`, `getReverseSplits`, `getIdentityEvents` from the top of `endpoints.ts`.

**2c — Delete dead SEC parsers and their tests:**
- `lib/sec/identity-events.ts`
- `lib/sec/reverse-splits.ts`
- `lib/sec/offerings.ts`
- `lib/sec/offerings-extractors.ts`
- `__tests__/sec-identity-events.test.ts`
- `__tests__/sec-identity-events-parser.test.ts`
- `__tests__/sec-reverse-splits.test.ts`
- `__tests__/sec-reverse-splits-parser.test.ts`
- Any `__tests__/sec-offerings*.test.ts` and `__tests__/sec-offerings-extractors*.test.ts` (verify with `rg -l "offerings-extractors|getOfferings\\b" __tests__/`).

Also remove any imports of these files from `lib/sec/submissions.ts`, `lib/filings-bucket.ts`, or anywhere `rg "from '@/lib/sec/(identity-events|reverse-splits|offerings|offerings-extractors)'"` surfaces. The CIK map / submissions / filing-body / companyfacts helpers stay (still used by `historical-float-pro`).

### Step 3 — Update snapshot normalizer for AE response shapes

**File:** `lib/askedgar/snapshot-normalizer.ts`

**3a — Offerings (~line 260):** the existing block already filters by `isSellingStockholderResale` and reads `row.filedAt`, `row.sharesAmount`, etc. The AE response uses snake_case: `filed_at`, `shares_amount`, `warrants_amount`, `share_price`, `offering_amount`, `headline`, `form_type`, `offering_type`, `askedgar_url`, `selling_shareholder_details`, `conversion_price`. AE does NOT return `isSellingStockholderResale` or `status`. Rewrite the block as:
```ts
const offerings = (getEndpointResponse(rawData, ['offerings']).results as Record<string, unknown>[])
  .map((row) => ({
    headline: getStringField(row, ['headline']) ?? 'Offering',
    filedAt: getStringField(row, ['filed_at', 'filedAt']),
    offeringType: getStringField(row, ['offering_type', 'offeringType']),
    sharesAmount: toNumberValue(getField(row, ['shares_amount', 'sharesAmount'])),
    warrantsAmount: toNumberValue(getField(row, ['warrants_amount', 'warrantsAmount'])),
    sharePrice: toNumberValue(getField(row, ['share_price', 'sharePrice'])),
    offeringAmount: toNumberValue(getField(row, ['offering_amount', 'offeringAmount'])),
  } satisfies ResearchSnapshotOffering))
  .filter((row) => !String(row.offeringType ?? '').toUpperCase().includes('EQUITY LINE'));
```
Drop the `buildOfferingHeadline`, `dedupeByHeadline`, and `isSellingStockholderResale` helpers if no other caller uses them — verify with `rg`.

**Also delete** the `import type { RawOffering } from '@/lib/sec/offerings'` line at the top of `snapshot-normalizer.ts` (line 3) and the `RawOffering[]` cast at line 261. The new mapper consumes `Record<string, unknown>[]` directly.

**3b — Reverse splits (~line 455):** existing normalizer already reads `executionDate`/`execution_date` and `split_from`/`split_to`. Verify it still produces a `ratio` string from the live AE shape `{ticker, execution_date, split_from, split_to}` — if not, add `ratio: \`${row.split_from}-for-${row.split_to}\``. Drop `lifecycleStatus`, `voteApprovalDate`, `announcementDate`, `sourceSnippet`, `confidence`, `accessionNumber`, `url` from the mapping — AE doesn't return them. Update `ResearchSnapshotReverseSplit` in `lib/types.ts` to just `{ date: string | null, ratio: string }`.

**3c — Replace identity-events mapper with historical-tickers (~line 465):** delete the old block. Add:
```ts
const historicalTickersResult = firstResult(rawData, ['historical-tickers', 'historicalTickers']);
const historicalTickers: ResearchSnapshotHistoricalTicker[] = Array.isArray(historicalTickersResult?.historical_tickers)
  ? (historicalTickersResult.historical_tickers as Record<string, unknown>[])
      .map((row) => ({
        ticker: getStringField(row, ['ticker']),
        dateChanged: getStringField(row, ['date_changed', 'dateChanged']),
      }))
      .filter((row): row is ResearchSnapshotHistoricalTicker => row.ticker !== null)
  : [];
```
The snapshot now has `historicalTickers: ResearchSnapshotHistoricalTicker[]` instead of `identityEvents: ResearchSnapshotIdentityEvent[]`.

**File:** `lib/types.ts`
- Delete `ResearchSnapshotIdentityEvent` type. Add `ResearchSnapshotHistoricalTicker = { ticker: string; dateChanged: string | null }`.
- Rename the snapshot field `identityEvents` → `historicalTickers`.

### Step 4 — Update DilutionSection "Former Symbols" render

**File:** `components/trading/research-report-sections/DilutionSection.tsx`
- Delete the `FormerSymbolsTable` component (~line 335) and the `formerSymbolEvents` filter (~line 497).
- Replace the `<h4>Former Symbols</h4>` block with a smaller table that renders `data.historicalTickers`:

```tsx
function HistoricalTickersTable({ rows }: { rows: ResearchSnapshotHistoricalTicker[] }) {
  if (rows.length === 0) return <NoDataBadge />;
  return (
    <div className="scrollbar-hidden overflow-x-auto">
      <table className="min-w-full">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="py-2 pr-3 text-left">Former Ticker</th>
            <th className="py-2 text-left">Date Changed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.ticker}-${index}`} className="border-b border-border text-muted-foreground">
              <td className="py-2 pr-3 font-medium text-foreground">{row.ticker}</td>
              <td className="py-2">{formatDate(row.dateChanged)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```
And replace the render call with `<HistoricalTickersTable rows={data.historicalTickers} />`.

### Step 5 — New Historical Dilution Rating route + cache

**Reason this gets its own route instead of joining the snapshot fan-out:** the endpoint is keyed by `(ticker, date)`, not just `ticker`. Putting it in the fan-out registry would either burn a $0.30 call on every snapshot or require cross-cutting changes to the cache key. A dedicated route with per-`(ticker, date)` caching is simpler and matches how the UI consumes it (one card, one date).

**5a — Add fetcher in `lib/askedgar/endpoints.ts`** (NOT added to `ENDPOINT_REGISTRY`):
```ts
export async function fetchHistoricalDilutionRating(ticker: string, date: string) {
  const validated = validateTickerOrError<unknown>(ticker);
  if (typeof validated !== 'string') return validated;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return toErrorResponse<unknown>('Invalid date format');
  return requestAskEdgar<unknown>('/v1/historical-dilution', { ticker: validated, date });
}
```

**5b — New route `app/api/historical-dilution-rating/route.ts`:**
- `export const dynamic = 'force-dynamic'; export const maxDuration = 60;`
- GET handler with `requireUser()` gate.
- Parse query: `?ticker=X&date=YYYY-MM-DD`. Validate with Zod:
  ```ts
  const querySchema = z.object({
    ticker: z.string().regex(/^[A-Z]{1,5}$/, 'Invalid ticker'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format').refine((d) => {
      const parsed = Date.parse(d);
      if (Number.isNaN(parsed)) return false;
      const tenYearsAgo = Date.now() - 10 * 365 * 86_400_000;
      return parsed >= tenYearsAgo && parsed <= Date.now();
    }, 'Date must be within the last 10 years and not in the future'),
  });
  ```
  This 10-year sanity check is what prevents an authenticated user from burning $0.30 with `?date=1900-01-01`. Reject with 400 + `z.flattenError` on failure.
- Normalize: `const normalizedTicker = ticker.trim().toUpperCase();` (consistent with `cache.ts:360` so `tnxp` and `TNXP` cache as one row).
- Cache: reuse `askedgar_cache` table — `lib/db/schema.ts` defines it as `(id, cacheType, ticker text, payload jsonb, expiresAt timestamp, …)` with unique `(cacheType, ticker)`. Set `cache_type = 'historical-dilution-rating'` and `ticker = \`${normalizedTicker}:${date}\``. No migration needed; the `ticker` column is unbounded text and the composite key fits the unique constraint. Also update the inline comment at `lib/db/schema.ts:145` to include the new `cache_type` value in the documented enum.
- TTL: 30 days. `lib/askedgar/cache.ts` does NOT expose a generic per-cache_type TTL helper — every type defines its own constant + insert. Mirror the scanner-summary pattern at `cache.ts:471`–`516`:
  ```ts
  const HISTORICAL_DILUTION_RATING_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  ```
  Inline the insert in the route file (or add a `writeHistoricalDilutionRatingCache(ticker, date, payload)` helper in `cache.ts` that mirrors `writeScannerSummaryCache`). Use the existing `db.insert(askedgarCache).values({...}).onConflictDoUpdate({...})` pattern from `cache.ts:499–516`, with `id: \`historical-dilution-rating-${normalizedTicker}:${date}\``.
- Flow: cache lookup first (`SELECT … WHERE cacheType = 'historical-dilution-rating' AND ticker = ${normalizedTicker}:${date} AND expiresAt > NOW()`); on hit return cached payload. On miss, call `fetchHistoricalDilutionRating`; on success write the row; return `{ ticker, date, rating: <result> }`. Cost-log line: `console.log(\`[historical-dilution-rating] ticker=${normalizedTicker} date=${date} costMicrodollars=${result?.usage?.cost_microdollars ?? 0}\`)` (mirrors the fan-out's existing cost log per `askedgar-client.test.ts:344`).
- Error handling — mirror `app/api/research-report-snapshot/route.ts` (read it before writing — that's the canonical AE-backed route):
  - AE 429 rate-limited → return 429 with the structured `{ error, warnings, retryHint }` payload, NOT 503.
  - AE other errors → 503 with the upstream error message.
  - DB write failure → catch, log, return the live AE payload anyway (do not fail the user-visible request because of a cache write).

**5c — Verification:** add a route test in `__tests__/historical-dilution-rating-route.test.ts` covering:
- Unauthenticated → 401.
- Missing/malformed date (`?date=not-a-date`) → 400 with `z.flattenError` body.
- Out-of-window date (`?date=1900-01-01`, `?date=2099-01-01`) → 400 (the sanity check).
- Cache hit returns without calling AE (mock fetch, assert zero calls).
- Cache miss calls AE and writes the row (mock fetch, assert one call + one DB row).
- Case-insensitive ticker (`?ticker=tnxp` and `?ticker=TNXP` share one cache row).
- AE rate-limited (mock 429) → 429 with retryHint propagated.
- AE error (mock 503) → 503 with upstream message.
- DB write failure (mock `db.insert` to throw) → still returns live AE payload (verify response body is the AE result, not an error).

### Step 6 — UI: Historical Dilution Rating card next to Gap Up Days

**File:** `components/trading/research-report-sections/OverviewSection.tsx`

Wrap the existing `<div className="pt-4">` block (lines 130–173) in a responsive flex container with the new card on the right:
```tsx
<div className="pt-4 flex flex-col gap-4 lg:flex-row lg:items-start">
  <div className="min-w-0 flex-1">
    {/* existing Gap Up Days header + table */}
  </div>
  {latestGapDate ? (
    <div className="w-full lg:w-80 shrink-0">
      <HistoricalDilutionRatingCard ticker={ticker} date={latestGapDate} />
    </div>
  ) : null}
</div>
```
Where `const latestGapDate = data.gapStats[0]?.date ?? null;` (gap stats are already sorted desc).

**Pre-step: extract rating-color helpers** — `components/trading/DilutionRatingTile.tsx` defines `ratingLevel` (~line 20), `pillClasses` (~line 85), `bannerClasses` (~line 92), and `BarChartIcon` (~line 30) as **local non-exported** functions. They can't be reused as-is. Extract `ratingLevel` and `pillClasses` into `components/trading/research-report-sections/_shared.tsx` (the sibling shared module the other section files already import from). Then update `DilutionRatingTile.tsx` to import them from `_shared.tsx` instead of defining them locally. `BarChartIcon` and `bannerClasses` are tile-specific — leave them in `DilutionRatingTile.tsx`.

**While touching `_shared.tsx`**: line 10 of `NoDataBadge` still uses hardcoded `border-zinc-700` (a Sprint 3 escape that wasn't caught). Replace with `border-border`. This is a one-line fix that prevents an obvious dark-only border from leaking into the new card's empty state and any other section that renders the badge.

**New component `components/trading/research-report-sections/HistoricalDilutionRatingCard.tsx`:**
- Client component. Props: `{ ticker: string; date: string }`.
- Fetch with `AbortController` for cleanup — rapid ticker/date changes WILL race a `useEffect`-only pattern:
  ```tsx
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/historical-dilution-rating?ticker=${encodeURIComponent(ticker)}&date=${encodeURIComponent(date)}`, { signal: controller.signal })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((payload) => { setData(payload); setLoading(false); })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setError(err.message); setLoading(false);
      });
    return () => controller.abort();
  }, [ticker, date]);
  ```
- Render JMT-style two-column grid matching the screenshot:
  - Header: `<h4>Dilution Rating</h4>` with subheading `(as of {formatDate(date)})`.
  - **6 rows × 2 cols = 12 cells in `grid grid-cols-2 gap-x-3 gap-y-1.5`** (the previous spec's "11 rows" was wrong):
    | Left col | Right col |
    |---|---|
    | Overall Risk | Cash Need |
    | Offering Ability | Offering Frequency |
    | Dilution | Estimated Cash |
    | Cash Remaining (months) | Cash Burn |
    | Shelf Capacity | Offerings (2yr) |
    | Has Pending S-1 | RegSHO |
  - Each cell wraps its label+value in `flex items-center justify-between` so values right-align (matches the JMT layout).
  - Color rules: rating values (`Low/Medium/High`) use `ratingLevel` + `pillClasses` imported from `_shared.tsx` (extracted in the pre-step above). Money values via `formatMoney` from `@/lib/askedgar-utils`. Booleans render as `Yes`/`No`.
  - Loading state: skeleton rows. Error state: `<NoDataBadge />`.
- Container: `<div className="rounded-lg border border-border bg-card p-3 text-sm min-h-[280px]">` — the `min-h-[280px]` reserves space for the 6-row grid so the right column doesn't pop in and shift the layout when the async fetch resolves (CLS prevention). Matches existing card surfaces (`DilutionRatingTile`, `WeeklyReviewSheet`, `DailyReportSheet`).

### Step 7 — UI: Move theme toggle icon to right of text

**File:** `components/trading/SettingsMenu.tsx:91–97`

Change:
```tsx
{isDark ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
{isDark ? 'Switch to light mode' : 'Switch to dark mode'}
```
To:
```tsx
{isDark ? 'Switch to light mode' : 'Switch to dark mode'}
{isDark ? <Sun className="ml-auto h-4 w-4" /> : <Moon className="ml-auto h-4 w-4" />}
```

`DropdownMenuItem` already applies `flex items-center gap-2`, so `ml-auto` on the icon pushes it to the right edge. This matches shadcn's `DropdownMenuShortcut` idiom (see `components/ui/dropdown-menu.tsx:179`) and avoids an extra wrapper span.

### Step 7B — UI: News article expanded view light-mode contrast

**File:** `components/trading/research-report-sections/NewsSection.tsx:55`

The expanded article body uses hardcoded `bg-black` so in light mode the article reads as a black box against the off-white page — same look as dark mode. Replace the hardcoded class with semantic tokens so it adapts:

Change:
```tsx
<p className="rounded border border-border bg-black p-2 text-sm text-muted-foreground">{item.summary || '--'}</p>
```
To:
```tsx
<p className="rounded border border-border bg-muted p-2 text-sm text-foreground">{item.summary || '--'}</p>
```

Rationale:
- `bg-muted` → off-white in light mode, subtly raised dark surface in dark mode (matches the rest of the elevated panels migrated in Sprint 3).
- `text-foreground` → near-black in light mode, near-white in dark mode (was `text-muted-foreground` which is intentionally washed out and would be hard to read on the lighter background).
- No new tokens — reuses what's already in `app/globals.css`.

Acceptance: `rg "bg-black" components/trading/research-report-sections/` returns zero matches.

### Step 8 — Equity Lines status pill: NO CHANGE

User confirmed the "Inactive" / "Active" pill on Equity Line rows IS Ask-Edgar-sourced (`row.status` from AE `status`/`registration_status`/`effective_status_label`, fallback to `row.isEffective` from AE `effective_status`). Leave `ProgramSection` and `programStatusClass` untouched.

### Step 9 — Repo-cleanup doc maintenance

**File:** `docs/repo-cleanup.md`
- Delete finding **"Research Section Bundle Is Oversized"** (~lines 195–201). It was implemented in Sprint 1 — `components/trading/research-report-sections/` already contains the six split files (`OverviewSection`, `DilutionSection`, `FilingsSection`, etc.).
- Leave all other findings as-is; they are either open or deferred and weren't intersected by this sprint.

### Step 10 — Remove obsolete Open Follow-Up

**File:** `HANDOFF.md`
- As the final action of this sprint, delete the "Offerings extractors fresh-ticker smoke check" Open Follow-Up at the bottom. The offerings extractors are being deleted in Step 2c, so the follow-up no longer applies.

---

### Files Changed Summary

Deleted:
- `lib/sec/identity-events.ts`, `lib/sec/reverse-splits.ts`, `lib/sec/offerings.ts`, `lib/sec/offerings-extractors.ts`
- `__tests__/sec-identity-events*.test.ts`, `__tests__/sec-reverse-splits*.test.ts`, `__tests__/sec-offerings*.test.ts`

Added:
- `app/api/historical-dilution-rating/route.ts`
- `components/trading/research-report-sections/HistoricalDilutionRatingCard.tsx`
- `__tests__/historical-dilution-rating-route.test.ts`

Modified:
- `lib/askedgar/endpoints.ts` (add 4 fetchers including non-registry `fetchHistoricalDilutionRating`, drop 2; repoint registry; drop 2 scope keys)
- `lib/askedgar/snapshot-normalizer.ts` (drop ownership/split-status mappers; rewrite offerings/historical-tickers; trim reverse-splits; drop `RawOffering` import)
- `lib/askedgar/cache.ts` (add `HISTORICAL_DILUTION_RATING_CACHE_TTL_MS` constant + optional `writeHistoricalDilutionRatingCache` helper mirroring scanner-summary pattern)
- `lib/db/schema.ts` (update inline comment at line 145 to document new `cache_type = 'historical-dilution-rating'`; no migration)
- `lib/types.ts` (drop 3 types, add 1, rename 1 field)
- `lib/agents/blueprints/small-cap-research.ts` (drop `ownership` + `splitStatus` from Zod schemas, deterministic computations, prompt sections, deterministicAnalysisSchema outputs `splitApproved`/`splitEffectivePending`/`knownHolderOverhang`, and two separate `readResults` call sites)
- `lib/agents/blueprints/swing-trader-research.ts` (drop `ownership` from filingsSchema + runnerQualitySchema, delete `computeKnownHolderOverhang` function, drop prompt section, drop `readResults` call)
- `components/trading/DilutionRatingTile.tsx` (import `ratingLevel` + `pillClasses` from `_shared.tsx` instead of defining locally)
- `components/trading/research-report-sections/_shared.tsx` (export new `ratingLevel` + `pillClasses` helpers; fix `NoDataBadge` to use `border-border` instead of hardcoded `border-zinc-700`)
- `components/trading/research-report-sections/DilutionSection.tsx` (drop 3 render sections, swap Former Symbols renderer)
- `components/trading/research-report-sections/OverviewSection.tsx` (wrap gap-stats in flex + side card)
- `components/trading/research-report-sections/NewsSection.tsx` (article body uses semantic tokens, not hardcoded `bg-black`)
- `components/trading/SettingsMenu.tsx` (icon position via `ml-auto`)
- `__tests__/askedgar-client.test.ts` (drop ownership cases; update `toHaveLength(15) → 13`; update `toHaveBeenCalledTimes(6) → 7`; remove ownership from costUsd test at line 341; update comment at line 319)
- `__tests__/research-snapshot-mapper.test.ts` (delete identity-events test 13–55, rewrite reverse-splits test 57–82, rewrite offerings fixture+assertion 333–407, drop ownership/split-status from 4 empty-fixtures)
- `__tests__/research-report-sections.test.tsx` (drop ownership/splitStatus/identityEvents from buildSnapshot fixture, replace identityEvents array fixture with historicalTickers)
- `__tests__/agent-blueprints.test.ts` (drop dead `ownership` mock at line 1534–1536)
- `docs/repo-cleanup.md` (delete one shipped finding)

### Acceptance Criteria

1. `rg "'ownership'|'split-status'|'identity-events'|ownershipGroups|splitStatuses|identityEvents|splitApproved|splitEffectivePending|knownHolderOverhang|flattenOwnershipRecords|computeKnownHolderOverhang"` returns zero matches in `lib/`, `app/`, `components/`, `__tests__/`.
2. `rg "from '@/lib/sec/(identity-events|reverse-splits|offerings|offerings-extractors)'"` returns zero matches.
3. `rg "RawOffering"` returns zero matches.
4. `ENDPOINT_REGISTRY` contains `historical-tickers` and does NOT contain `ownership`, `split-status`, `identity-events`.
5. `SEC_BACKED_ENDPOINT_KEYS` only contains `historical-float-pro` and `sec-filings`.
6. New route `GET /api/historical-dilution-rating?ticker=TNXP&date=2024-12-17` returns the AE payload on first call and skips AE on the second call within 30 days. `GET …?date=1900-01-01` returns 400.
7. DilutionSection no longer renders the "Owners" `<h4>` or the "Split Status" `<h5>`.
8. OverviewSection renders the new `HistoricalDilutionRatingCard` to the right of the gap-stats table on `lg+` viewports, stacked below on smaller viewports, using the most-recent gap date. No layout shift on card-fetch resolution (min-height honored).
9. SettingsMenu theme-toggle row shows the label text on the left and the Sun/Moon icon on the right.
10. In light mode, expanding a News article shows an off-white body with near-black text (no hardcoded `bg-black` remaining in `components/trading/research-report-sections/`).
11. `_shared.tsx` `NoDataBadge` uses `border-border` (no hardcoded zinc).
12. `ratingLevel` and `pillClasses` are exported from `_shared.tsx` and imported by both `DilutionRatingTile.tsx` and `HistoricalDilutionRatingCard.tsx`.

### Validation

- `npm run lint`
- `npx tsc --noEmit`
- `npm test` (update fixtures so the 714+ tests stay green; some sec-parser tests will be deleted alongside their modules)
- Manual smoke (user-run): open Research on TNXP → confirm Historical Dilution Rating card renders next to Gap Up Days for the 2024-12-17 row; confirm Dilution section has no Owners or Split Status blocks; confirm Former Symbols renders historical-tickers; toggle theme from Settings and confirm icon sits to the right.
- Cost check (verified live on 2026-05-24 with throwaway probe): per-cold-call costs are `ownership` $0.014–$0.024 (removed), `split-status` $0.011–$0.044 (removed), `historical-tickers` $0.009 (added), `offerings` $0.015 (added), `reverse-splits` $0.009 (added). Net per-cold-snapshot delta is roughly break-even — saves ~$0.025–$0.068 on removed endpoints, costs ~$0.033 on added endpoints. The new `historical-dilution-rating` route is OUT of the fan-out and only fires when the user opens Research and the cache misses ($0.30 per cold call, 30-day TTL).

---

## Recently Completed

### Sprint 3 — Visual Light Mode (Full Token Migration)

Status: completed 2026-05-22 (commit `f0e37e2` + review-pass D5a patches + polish pass).

Outcome:
- Defined warm off-white `:root` palette in `app/globals.css` (`#FAFAF9` bg, `#1C1917` fg, `#059669` primary) plus three new scrollbar CSS vars in both `:root` and `.dark`; scrollbar selectors and `.scrollbar-thin` utility now reference `var(--scrollbar-*)`.
- Added theme toggle (Sun/Moon) as the first item in `SettingsMenu` dropdown with `e.preventDefault()` so the menu stays open; new `components/theme/themed-toaster.tsx` client wrapper reads `useTheme()` and replaces the hardcoded `<Toaster theme="dark" />` in `app/layout.tsx`.
- Migrated ~824 hardcoded color utilities across `app/**` and `components/**` to semantic tokens (`bg-background`, `text-foreground`, `border-border`, `bg-primary`, etc.) while leaving the four chart files (`BacktestChart`, `ResearchChart`, `CandlestickChart`, `ChartDrawings`) hardcoded dark per D4. `ResearchChart` got the single spec-mandated `bg-[#121214] border border-white/10` on its outer flex div.
- Review-pass cleanup: patched four leftover D5a half-migrations (`WatchlistSavePicker:124`, `WatchlistEditor:250`/`652`/`691`/`717`, `BacktestingTab:461-462`) from raw emerald to `primary` tokens. Active-state buttons now use `bg-primary/15 text-primary` so they remain visually distinct in both modes.
- Polish pass — theme contrast + sidebar settings label: Toolbar timeframe selector outlined; PerformanceTab + TradeTable segmented controls unified to `bg-primary/15 text-primary` selected fill; ResearchSubNav now constant-weight `font-semibold` (no shift between states); FilingsSection sub-tabs stay regular-weight; PerformanceCharts chrome (axes, grid, tooltips, ReferenceLine) themed via CSS vars while domain green/red P/L colors stay hardcoded; dropped `bg-black` overrides from Archive + Backtesting Select primitives; `BacktestManagerView.addIconButtonClass` now composes `greenButtonClass`; SettingsMenu trigger now shows "Settings" label when sidebar expanded, mirroring the Account button.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (98 files, 714 tests) — all green pre- and post-D5a patches.
- Acceptance greps: `bg-[#...]` returns only the four D4 chart files; `bg-zinc-[5-9]|bg-white/[0-9]|border-white/[0-9]|text-zinc-[3-9]` returns empty after the documented exclusions.
- User-run dev-server visual smoke: pass.

### Sprint 2 — Light Mode Infrastructure

Status: completed 2026-05-22 (commit `91dfeb0`).

Outcome:
- Installed `next-themes@^0.4.6` and added `components/theme/theme-provider.tsx` with `attribute="class"`, `defaultTheme="dark"`, `enableSystem={false}`, `disableTransitionOnChange`.
- Rewrote `app/layout.tsx`: removed hardcoded `className="dark"`, added `suppressHydrationWarning` on `<html>`, wrapped providers in `ThemeProvider` (outermost) → `SessionProvider` → `MotionConfig`; `Toaster` stays hardcoded `theme="dark"` per D6.
- Refactored `app/globals.css` `@theme inline` to reference per-token CSS vars; added matching `:root` and `.dark` blocks with identical dark-palette values (Sprint 3 will diverge `:root`).
- Sprint 1 follow-up: dropped local `toEpochMs` in `components/trading/BacktestChart.tsx` and pulled it from `@/lib/chart-time`.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (98 files, 714 tests) — all green.
- Static checks: no local `function toEpochMs`, `className="dark"` count = 0, `next-themes` appears once in `package.json`.
- Manual A/B browser smoke + DevTools `localStorage` light/dark swap remain user-run before merge.

### Tier 1 Mechanical Cleanup Pass

Status: completed 2026-05-22 (commit `61858f1`).

Outcome:
- Added `requireUser()` gates to `/api/agents/macro-summary/latest` and `/api/agents/market-pulse/latest`; both now 401 for unauth callers.
- Removed unused `@tailwindcss/typography` dep and broken `next clean` script; refreshed `package-lock.json`.
- Refreshed `docs/ARCHITECTURE.md`, `AGENTS.md`, and `docs/ae-buildout.md` for current helper layout + Ask Edgar scopes; cleared the five completed findings from `docs/repo-cleanup.md`.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (714 tests, +2 new auth-rejection cases), `npm run workflow:audit` — all green.
- `npm run clean` correctly reports `Missing script`; zero `@tailwindcss/typography` refs across `package.json` + `package-lock.json`.

### Persist Chart Drawings + Indicators to DB

Status: completed 2026-05-22 (commit `73dcc32`).

Outcome:
- New `chart_drawings` table (PK `(user_id, ticker, bucket)`, `bucket ∈ {intraday, higher}`) with `app/api/chart-drawings` GET/PUT under `requireUser()`.
- `BacktestChartGrid` runs two bucket-keyed controllers; drawings + per-slot indicators persist per `(user, ticker, bucket)` and `BacktestChart.tsx:424` no longer gates draw on `frame.intraday` — daily/weekly/monthly slots can draw too.
- Saved reviews remain read-only and render from `chartState`; `chartStateSchema` accepts both legacy flat and new bucketed shapes (back-compat covered by `normalizeChartState`).

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` — all green (98 files, 712 tests).
- `npm run db:migrate` applied `drizzle/0042_happy_felicia_hardy.sql`.
- Manual smoke (Step 8 paths) still pending user-run dev-server validation.

### Sprint 1 — Pre-Light-Mode Refactors

Status: completed 2026-05-22.

Outcome:
- Added shared `toTime()` in `lib/chart-time.ts` and extracted session-shading rect state/recalculation into `hooks/use-session-shading.ts`.
- Migrated `ResearchChart`, `CandlestickChart`, and `BacktestChart` to the hook while keeping their existing range-change, resize, and initial-layout scheduling triggers.
- Split `ResearchReportSections.tsx` into a thin 41-line dispatcher plus six tab/shared modules under `components/trading/research-report-sections/`; the default export path and caller set stayed unchanged.

Validation:
- Interim `npx tsc --noEmit` passed after Step 2 before any chart call site was migrated.
- `npm run lint`, `npx tsc --noEmit`, `npm test` — all green (98 files, 714 tests).
- Static acceptance checks passed: no local `function toTime` / `function toUTCSeconds` in `components/trading/`, one `useSessionShading` hook call per chart file, exactly six research section files, and unchanged `ResearchReportSections` callers.
- Manual browser smoke for chart shading and five Research sub-tabs remains post-merge/user-run; no dev-server smoke was run in this session.

---

## Session Maintenance

- Keep this file compact: active specs only while work is in flight, short summaries after validation.
- If a new multi-step feature starts, replace or append a self-contained execution spec with exact file paths, ordered changes, acceptance criteria, and validation requirements.
- If only docs/workflow assets change, run `npm run workflow:audit`.
- Do not modify `.env*` or secret files.

---

# Nexus Terminal — HANDOFF.md

> Updated: 2026-04-24
> Purpose: brief summary of recently completed work plus any active execution spec. Older implementation detail lives in git history and `specs/`.
> Historical completed sections were archived to keep this file focused. Agent Hardening #1 shipped in `7118598`; Agent Hardening #2 in `2a856f1`; Agent Hardening #3 in `bf13567`; Research agent report refinements in `9a69655` (2026-04-17); Trade Journal Enhancement (DRC + Weekly Review + Archive tab) shipped across `4757fa3`, `0e41b5a`, `8dd6b12`, `fe97e8c`, `c300153` (2026-04-19 → 2026-04-20); Tighten Trading Journal UI shipped in `f1fde41` (2026-04-20); Spend Enforcement Fix shipped across `7aad160`, `abdefe9`, `1bd5e1e`, `8ad674e`, `9f0a123` (2026-04-20); Research Gap-Stats Parser + Redundancy Fix shipped in `0e96e16` (2026-04-22); Research Chart History Polish shipped in `5fc5b9e` (2026-04-22); System Sheet Sync shipped in `63c3a3b` + `a694797` (2026-04-23). See git history for full records.

## Current State

**Active spec:** None. AskEdgar Gap-Stats Mapper Fix is implemented in the working tree and pending user review/commit. The mapper now reads the live `/v1/gap-stats` keys for high/low/tags/filing types, and the dead `vwap`/`premarketHigh` snapshot fields and table columns are removed.

## Validation Snapshot

Most recent validation (`2026-04-24`, AskEdgar Gap-Stats Mapper Fix):

- `npm run lint` — passed
- `npx tsc --noEmit` — passed
- `npm test` — passed (`55` files, `425` tests)
- `npm run workflow:audit` — passed

## Follow-Up Notes

- **AskEdgar paid API migration (Monday 2026-04-27).** Test key expires Monday. `https://eapi.askedgar.io` remains the correct base URL — the readme.io docs list `https://api.askedgar.com`, which redirects to a HugeDomains parking page. Only swap the `ASKEDGAR_API_KEY` env var; do not touch `ASKEDGAR_BASE_URL` in `lib/askedgar.ts:42`.
- **Cost-per-report estimate (after dropping `filing-titles` and `historical-float-pro`).** Per the free `/estimate` endpoint at `https://eapi.askedgar.io/estimate?endpoint={name}&ticker={t}` with no auth, an unbounded fresh report on a heavy-activity microcap (SPRC) costs ~$3.33 across 15 working endpoints (dilution-data /estimate is broken upstream so excluded). Dropping `filing-titles` (~$1.56) and `historical-float-pro` (~$0.63) brings the upper bound to **~$1.14 per fresh report**. The `limit` and filter parameters are honored by the real endpoints but ignored by `/estimate`, so real costs on `news` (limit=20) and `offerings` (limit=20) will run lower than the upper bound. With the 1-hour `(ticker)` cache, ~10 unique tickers per day projects to roughly **$5–$10/day** after the endpoint trim.
- **Endpoint trim (separate future spec).** Drop `filing-titles` and `historical-float-pro` from the `endpointConfigs` array in `lib/askedgar.ts:481-499`, plus the corresponding helper functions (`fetchHistoricalFloatPro`, `fetchFilingTitles`) and any consumer references in `lib/agents/blueprints/`. Confirm nothing reads from `rawData['filing-titles']` or `rawData['historical-float-pro']` before removing.
- **Cost telemetry (separate future spec).** AskEdgar v1 responses include a `usage.cost_microdollars` field. Once the paid key is live, log this per call (or per report) so we have real spend numbers instead of estimates.
- **Ask Edgar replacement research** is in `docs/ae-buildout.md`. `FUTURE-PLANS.md` and `AGENTIC_EXPANSIONV2.md` live under `docs/`.

---

## AskEdgar Gap-Stats Mapper Fix

> Generated: 2026-04-24 | Agent: plan (inline)
> Status: IMPLEMENTED — validation passed 2026-04-24; pending user review/commit.

### Goal

Fix the gap-stats mapper in `lib/askedgar.ts` so `ResearchSnapshotGapStat` populates correctly from the live `/v1/gap-stats` response. Six fields in the current mapper miss the actual API keys; four are silently broken (always `null` or empty), and two (`vwap`, `premarketHigh`) refer to fields the API does not return at all and should be dropped.

### Background

A real call against `/v1/gap-stats?ticker=SPRC&limit=5` (made 2026-04-24) confirmed the live response shape:

| Snapshot field | Mapper currently looks for | Live API key | Status |
|---|---|---|---|
| `intradayHigh` | `intraday_high`, `intradayHigh` | `high_price` | broken (always null) |
| `intradayLow` | `intraday_low`, `intradayLow` | `low_price` | broken (always null) |
| `vwap` | `vwap` | (not present — only `premarket_vwap` exists) | always null — drop in Phase 2 |
| `premarketHigh` | `premarket_high`, `premarketHigh` | (not present at all) | always null — drop in Phase 2 |
| `tags` | `tags` | `all_tags` | broken (always empty) |
| `form_types` | `form_types`, `formTypes` | `filing_types` | broken (always empty) |

Other fields (`date`, `gap_percentage`, `market_open`, `market_close`, `volume`) match the live shape and need no changes.

The current research-report Gap Stats tab in `components/trading/ResearchReportSections.tsx` reads `row.vwap` and `row.premarketHigh` — both render blank cells today because the mapper never populates them. Phase 2 removes those columns from the UI.

The blueprints (`lib/agents/blueprints/swing-trader-research.ts`, `small-cap-research.ts`) bypass the snapshot mapper entirely and read `rawData['gap-stats']` directly with their own field-lookup arrays that already include `high_price`. They are unaffected by this fix.

### Phase 1 — Mapper field-name fix + regression test

#### Step 1.1 — Update gap-stats lookups in `lib/askedgar.ts`

**File:** `lib/askedgar.ts`
**Action:** MODIFY

Replace the gap-stats mapping block at lines `831-847`. Current code:

```ts
const gapStats: ResearchSnapshotGapStat[] = getEndpointResponse(rawData, ['gap-stats', 'gapStats']).results.map((item) => {
    const row = toRecord(item);
    const tags = Array.isArray(getField(row, ['tags'])) ? (getField(row, ['tags']) as string[]) : [];
    const formTypes = Array.isArray(getField(row, ['form_types', 'formTypes'])) ? (getField(row, ['form_types', 'formTypes']) as string[]) : [];
    return {
      date: getStringField(row, ['date']),
      gapPercentage: toNumberValue(getField(row, ['gap_percentage', 'gapPercentage'])),
      marketOpen: toNumberValue(getField(row, ['market_open', 'marketOpen'])),
      marketClose: toNumberValue(getField(row, ['market_close', 'marketClose'])),
      intradayHigh: toNumberValue(getField(row, ['intraday_high', 'intradayHigh'])),
      intradayLow: toNumberValue(getField(row, ['intraday_low', 'intradayLow'])),
      vwap: toNumberValue(getField(row, ['vwap'])),
      premarketHigh: toNumberValue(getField(row, ['premarket_high', 'premarketHigh'])),
      volume: toNumberValue(getField(row, ['volume'])),
      tags: [...tags, ...formTypes],
    } satisfies ResearchSnapshotGapStat;
});
```

Replace with:

```ts
const gapStats: ResearchSnapshotGapStat[] = getEndpointResponse(rawData, ['gap-stats', 'gapStats']).results.map((item) => {
    const row = toRecord(item);
    const tags = Array.isArray(getField(row, ['all_tags', 'tags'])) ? (getField(row, ['all_tags', 'tags']) as string[]) : [];
    const formTypes = Array.isArray(getField(row, ['filing_types', 'form_types', 'formTypes'])) ? (getField(row, ['filing_types', 'form_types', 'formTypes']) as string[]) : [];
    return {
      date: getStringField(row, ['date']),
      gapPercentage: toNumberValue(getField(row, ['gap_percentage', 'gapPercentage'])),
      marketOpen: toNumberValue(getField(row, ['market_open', 'marketOpen'])),
      marketClose: toNumberValue(getField(row, ['market_close', 'marketClose'])),
      intradayHigh: toNumberValue(getField(row, ['high_price', 'intraday_high', 'intradayHigh'])),
      intradayLow: toNumberValue(getField(row, ['low_price', 'intraday_low', 'intradayLow'])),
      vwap: toNumberValue(getField(row, ['vwap'])),
      premarketHigh: toNumberValue(getField(row, ['premarket_high', 'premarketHigh'])),
      volume: toNumberValue(getField(row, ['volume'])),
      tags: [...tags, ...formTypes],
    } satisfies ResearchSnapshotGapStat;
});
```

Four diffs:
1. `tags` lookup: `['tags']` → `['all_tags', 'tags']`
2. `formTypes` lookup: `['form_types', 'formTypes']` → `['filing_types', 'form_types', 'formTypes']`
3. `intradayHigh` lookup: `['intraday_high', 'intradayHigh']` → `['high_price', 'intraday_high', 'intradayHigh']`
4. `intradayLow` lookup: `['intraday_low', 'intradayLow']` → `['low_price', 'intraday_low', 'intradayLow']`

`vwap` and `premarketHigh` lines stay unchanged in Phase 1. They are removed in Phase 2.

Old snake_case fallbacks are retained as second/third lookup keys to defend against the API reverting field names.

**Acceptance:**
- [ ] All four lookup arrays updated in the order listed (live API key first, legacy keys after as fallbacks).
- [ ] No other lines in the file changed.
- [ ] `npx tsc --noEmit` passes.

#### Step 1.2 — Add a regression test to `__tests__/askedgar-client.test.ts`

**File:** `__tests__/askedgar-client.test.ts`
**Action:** MODIFY

Add a new `it(...)` block at the end of the existing `describe('askedgar client', ...)` block, just before its closing `});` at line 200. The test feeds a verbatim copy of one row from the live SPRC response (captured 2026-04-24) into `normalizeAskEdgarResponse` and asserts every gap-stats snapshot field is correctly populated.

Add after the existing `it('falls back to float-outstanding header stats when screener data is sparse', ...)` test:

```ts
  it('maps live /v1/gap-stats response shape to ResearchSnapshotGapStat', async () => {
    // Canonical AskEdgar /v1/gap-stats row — captured live from SPRC on 2026-04-24.
    // If the API drifts, this test will catch it (the snapshot mapper is downstream of every research report).
    const sprcRow = {
      ticker: 'SPRC',
      date: '2026-04-21',
      market_open: 6.08,
      previous_day_close: 4.23,
      gap_percentage: 43.74,
      high_price: 6.57,
      high_time: '2026-04-21T09:33:00',
      low_price: 4.68,
      low_time: '2026-04-21T13:43:00',
      market_close: 6.0,
      closed_over_vwap: false,
      premarket_vwap: 6.9595,
      premarket_dollar_volume: 72234465.08,
      premarket_volume: 10379248.0,
      volume: 4606125.857634,
      dollar_volume: 25723436.06,
      market_cap: 2392065.0,
      all_tags: ['Upcoming Events', 'Patents'],
      filing_types: ['grok', '6-K'],
      afterhours_close: 5.55,
      last_updated: '2026-04-22T00:00:03.418652',
    };

    const client = await import('@/lib/askedgar');
    const normalized = client.normalizeAskEdgarResponse({
      'gap-stats': { status: 'success', count: 1, results: [sprcRow] },
    }, {
      ticker: 'SPRC',
      companyName: 'SciSparc',
      fetchedAt: '2026-04-24T00:00:00.000Z',
      warnings: [],
    });

    expect(normalized.gapStats).toHaveLength(1);
    const row = normalized.gapStats[0];
    expect(row).toMatchObject({
      date: '2026-04-21',
      gapPercentage: 43.74,
      marketOpen: 6.08,
      marketClose: 6.0,
      intradayHigh: 6.57,
      intradayLow: 4.68,
      volume: 4606125.857634,
    });
    // tags should merge all_tags + filing_types in that order
    expect(row.tags).toEqual(['Upcoming Events', 'Patents', 'grok', '6-K']);
  });
```

**Acceptance:**
- [ ] Test added to existing `describe('askedgar client', ...)` block in `__tests__/askedgar-client.test.ts`, just before the block's closing `});` at line 200.
- [ ] `npm test -- askedgar-client.test.ts` passes (test count for this file goes up by 1).
- [ ] If the assertion fails on any field, the failure message identifies which one (toMatchObject reports per-field diffs).

### Phase 2 — Drop dead `vwap` and `premarketHigh` fields

Phase 2 should only be applied AFTER Phase 1 lands and validation is green. The two fields being removed are guaranteed `null` today (the live API does not return `vwap` or `premarket_high` for `/v1/gap-stats`). Three files change.

#### Step 2.1 — Remove fields from `ResearchSnapshotGapStat`

**File:** `lib/types.ts`
**Action:** MODIFY

Delete two lines from the `ResearchSnapshotGapStat` interface around line 207-218. Specifically remove:

```ts
  vwap: number | null;
  premarketHigh: number | null;
```

The interface should read (after removal):

```ts
export interface ResearchSnapshotGapStat {
  date: string | null;
  gapPercentage: number | null;
  marketOpen: number | null;
  marketClose: number | null;
  intradayHigh: number | null;
  intradayLow: number | null;
  volume: number | null;
  tags: string[];
}
```

**Acceptance:**
- [ ] `vwap` and `premarketHigh` removed from `ResearchSnapshotGapStat` in `lib/types.ts`.
- [ ] No other interfaces or types changed.

#### Step 2.2 — Remove the corresponding mapper lines

**File:** `lib/askedgar.ts`
**Action:** MODIFY

Delete the two lines inside the gap-stats mapping that populate the dropped fields:

```ts
      vwap: toNumberValue(getField(row, ['vwap'])),
      premarketHigh: toNumberValue(getField(row, ['premarket_high', 'premarketHigh'])),
```

The post-Phase-1 block becomes (after Phase 2 removal):

```ts
const gapStats: ResearchSnapshotGapStat[] = getEndpointResponse(rawData, ['gap-stats', 'gapStats']).results.map((item) => {
    const row = toRecord(item);
    const tags = Array.isArray(getField(row, ['all_tags', 'tags'])) ? (getField(row, ['all_tags', 'tags']) as string[]) : [];
    const formTypes = Array.isArray(getField(row, ['filing_types', 'form_types', 'formTypes'])) ? (getField(row, ['filing_types', 'form_types', 'formTypes']) as string[]) : [];
    return {
      date: getStringField(row, ['date']),
      gapPercentage: toNumberValue(getField(row, ['gap_percentage', 'gapPercentage'])),
      marketOpen: toNumberValue(getField(row, ['market_open', 'marketOpen'])),
      marketClose: toNumberValue(getField(row, ['market_close', 'marketClose'])),
      intradayHigh: toNumberValue(getField(row, ['high_price', 'intraday_high', 'intradayHigh'])),
      intradayLow: toNumberValue(getField(row, ['low_price', 'intraday_low', 'intradayLow'])),
      volume: toNumberValue(getField(row, ['volume'])),
      tags: [...tags, ...formTypes],
    } satisfies ResearchSnapshotGapStat;
});
```

**Acceptance:**
- [ ] Two lines removed.
- [ ] `npx tsc --noEmit` passes (the type and the mapper agree).

#### Step 2.3 — Remove VWAP and PM High columns from the Gap Stats table

**File:** `components/trading/ResearchReportSections.tsx`
**Action:** MODIFY

Two edits:

**a)** In the `<thead>` block at lines `582-593`, delete these two `<th>` lines:

```tsx
                        <th className="py-2 pr-3 text-right">VWAP</th>
                        <th className="py-2 pr-3 text-right">PM High</th>
```

**b)** In the `GapStatRow` component at lines `139-166`, delete these two `<td>` lines:

```tsx
      <td className="py-2 pr-3 text-right text-zinc-300">{formatMoney(row.vwap)}</td>
      <td className="py-2 pr-3 text-right text-zinc-300">{formatMoney(row.premarketHigh)}</td>
```

After both edits, the Gap Stats table goes from 10 columns to 8: Date, Gap %, Open, Close, High, Low, Volume, Tags.

**Acceptance:**
- [ ] Two `<th>` cells removed from the gap-stats `<thead>`.
- [ ] Two `<td>` cells removed from `GapStatRow`.
- [ ] Header column count matches body column count (8 each).
- [ ] `npx tsc --noEmit` passes (TypeScript will flag any lingering reference to `row.vwap` or `row.premarketHigh`).

#### Step 2.4 — Verify no other consumers of dropped fields

Run from repo root:

```bash
grep -rn "premarketHigh\|gapStats\.vwap\|\.vwap\b" lib/ app/ components/ __tests__/ --include="*.ts" --include="*.tsx"
```

Expected matches AFTER Phase 2:
- `lib/indicators.ts` — defines a `vwap()` function (unrelated, indicator math)
- `components/trading/ChartsTab.tsx` — uses `vwap()` from `lib/indicators` (unrelated)
- `lib/massive-market.ts`, `__tests__/indicators.test.ts`, `__tests__/agent-blueprints.test.ts`, `lib/agents/blueprints/swing-trader-research.ts` — `vwap` references on aggregate/OHLC shapes (unrelated to `ResearchSnapshotGapStat.vwap`)

Any match on `gapStat.vwap`, `gapStat.premarketHigh`, or `row.vwap` / `row.premarketHigh` inside `ResearchReportSections.tsx` after the edits indicates an incomplete removal — fix it.

**Acceptance:**
- [ ] grep output above contains no remaining reference to the dropped fields on `ResearchSnapshotGapStat` or its rows.

### Phase 3 — Validation

From repo root `/home/jared/Nexus-Terminal`, run in order:

1. `npm run lint`
2. `npx tsc --noEmit`
3. `npm test`

Skip `npm run typecheck:services` — nothing under `services/` is touched. Skip `npm run workflow:audit` — no workflow assets are changed.

Expected test count delta: **+1 test** in `__tests__/askedgar-client.test.ts`. Update the Validation Snapshot at the top of this file with the new counts after Phase 2 completes.

**Manual sanity check (after the paid key swap on 2026-04-27 Monday):**

1. With the paid key set in `.env.local`, run a fresh research report on a recent gapper (any ticker that had a +20% gap day in the last 90 days — try one of: SPRC, AUUD, AGPU).
2. Open the Research Report → Gap Stats tab.
3. Confirm: `Open`, `Close`, `High`, `Low`, `Volume` columns all show numeric values (no blanks). Pre-fix, `High` and `Low` would have been blank.
4. Confirm the `Tags` column shows merged tag chips (e.g., "Upcoming Events", "Patents", "grok", "6-K"). Pre-fix it was always empty.
5. Confirm the table is 8 columns wide (after Phase 2 — VWAP and PM High columns gone).

### Files Changed Summary

| File | Action | Phase | Approx. lines | Risk |
|---|---|---|---|---|
| `lib/askedgar.ts` | MODIFY | 1 | 4 lookup arrays (~4 lines changed) | LOW |
| `__tests__/askedgar-client.test.ts` | MODIFY | 1 | +50 (1 new test) | LOW |
| `lib/types.ts` | MODIFY | 2 | -2 lines | LOW |
| `lib/askedgar.ts` | MODIFY | 2 | -2 lines | LOW |
| `components/trading/ResearchReportSections.tsx` | MODIFY | 2 | -4 lines (2 `<th>` + 2 `<td>`) | LOW |

All changes are LOW risk because: the mapper today produces guaranteed-null values for the fields we're either fixing or removing; no consumer code depends on those nulls; the live UI already renders blank cells where the broken/dead fields go.

### Files NOT to touch

- `lib/agents/blueprints/swing-trader-research.ts`, `lib/agents/blueprints/small-cap-research.ts` — these read `rawData['gap-stats']` directly with their own lookup arrays (which already include `high_price`/`low_price`). They are correctly handling the live API and need no changes.
- `__tests__/agent-blueprints.test.ts` — already has a regression guard for `extractGapStatsTable` at line 225. Leave it alone; it covers a different code path (the blueprint's parser, not the snapshot mapper).
- `lib/askedgar.ts:481-499` (`endpointConfigs` array) — do NOT remove `filing-titles` or `historical-float-pro` in this spec. That is a separate future change tracked in the Follow-Up Notes above.
- `.env*` files.

### Open Questions for Codex

None — both phases are locked. If Phase 2's `<th>`/`<td>` removal causes any visual regression on the Gap Stats tab (column alignment, missing data fallback), report it in the completion note and we'll address in a follow-up. Do not invent new columns to fill the gap.

# Nexus Terminal - HANDOFF.md

> Updated: 2026-10-05
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and durable docs such as `docs/repo-cleanup.md`.

Historical completed sections were removed to keep this file focused. Use git history and the `specs/` directory for archived implementation detail.

> **Parked:** the Scanner Epic 1 execution spec was moved to `specs/scanner-epic1-handoff.md` (not started — still waiting on the worktree + Neon-branch setup). Move it back here when you're ready to run it.

---

## Open Follow-Ups

Playbook rich text:
- Roll `RichTextEditor` into the daily/weekly journal review sections (same `type: 'text'` pattern).
- Optional: Notion-style slash (`/`) command menu; checklists / code blocks / highlight.

Deferred Sheets roadmap (not started):
- Manual authenticated smoke for sharing (invite logged-in coworker, flip role, remove; unknown-email error; viewer read-only / editor sees no manage buttons).
- Self-leave (non-owner removing own membership), ownership transfer, email/invite-link notifications for users who haven't signed in.
- Templates / per-day "start today's sheet" flow beyond plain Duplicate.
- CSV export, archive/unarchive UI, undo/redo, polling/SSE invalidation.

---

## Session Maintenance

- Keep this file compact: active specs only while work is in flight, short summaries after validation.
- If a new multi-step feature starts, replace or append a self-contained execution spec with exact file paths, ordered changes, acceptance criteria, and validation requirements.
- If only docs/workflow assets change, run `npm run workflow:audit`.
- Do not modify `.env*` or secret files.


---

## Sheets: AH/PM Session Highs, Extension Ratio, Numeric Filters

> Generated: 2026-10-05 | Author: Claude (plan)
> Status: PLANNED

### Goal

Let the team filter sheets for: **the stock printed a high above PDC + ⅓ of the prior day's range, at any point from the scan day's after-hours through 9:30 on the next day's pre-market.**

- The row's existing locked `date` column is the **scan date** (the day the stock ran). The **trade date** is the next NY trading day, derived with `getNextTradingSession()`.
- Six new auto-filled column types, filled by the existing **Fill data** button (`POST /api/sheets/[id]/fill-massive`):

| Type | Value | Source |
|---|---|---|
| `pdc` | Scan-day close | grouped daily bar (already fetched, unadjusted) |
| `pd_range` | Scan-day high − low | grouped daily bar |
| `ah_high` | Highest high, scan date 16:00–20:00 ET | 1-minute bars |
| `pm_high_early` | Highest high, trade date 04:00–07:00 ET | 1-minute bars |
| `pm_high_late` | Highest high, trade date 07:00–09:30 ET | 1-minute bars |
| `pm_extension` | `(max(ah, pmEarly, pmLate) − PDC) ÷ (PDH − PDL)` | computed |

- The team's filter is **Extension `>0.33`** plus **Share Vol `>10m`**. That needs numeric comparison filters (`>`, `>=`, `<`, `<=`, with optional `k`/`m`/`b` suffix), which this spec adds. Today, numeric-type columns (`share_volume`, `dollar_volume`, `float`) can't be filtered at all, because `isFilterableColumn` excludes them.

### Locked rules

1. **No migration.** Column types are plain strings inside the `sheets.columns` jsonb, the same as `share_volume`/`float`.
2. **Unadjusted prices everywhere.** Grouped daily bars are already `adjusted=false`. Minute bars must also be `adjusted=false` so PDC and the session highs come from the same price basis, even after a later reverse split.
3. **A window only fills after it has closed.** Fill only writes empty cells, so a partial high (e.g. clicking Fill at 06:00 ET) would otherwise be saved and never corrected. Each window's high is `null` until `now >= window end`. `pm_extension` is only written once the last window (trade date 09:30 ET) has closed.
4. **Windows are half-open `[start, end)` in ET, on minute-bar start time `t`.** A bar starting at 06:59 is early PM, 07:00 is late PM, and 09:30 is excluded.
5. **One minute-bar request per unique `ticker|scanDate`**, covering `from = scanDate 16:00 ET` to `to = tradeDate 09:30 ET` as epoch-ms strings. The `/api/market-data` route already passes epoch-ms `from`/`to` the same way.
6. **Blank stays blank.** A window with no trades writes nothing. If all three highs are null, Extension writes nothing. A `pd_range` of `<= 0` writes no Extension.
7. **Known limit (accepted, do not fix):** `isNyTradingDay` / `getNextTradingSession` skip weekends only, not market holidays. If the scan date is the day before a holiday, the "trade date" is the holiday: the PM windows come back empty and Extension reflects AH only. Rare. The user can fix it by hand.

---

### Step 1 — Allow unadjusted minute bars

**File:** `lib/massive-market.ts`
**Action:** MODIFY

1. In `fetchMassiveAggregateBars` (starts ~line 308), add an optional param `adjusted?: boolean;` to the `params` object type, after `limit?: number;`.
2. In the same function, change the query object from `{ adjusted: 'true', sort: 'asc', limit: ... }` to:
   ```ts
   { adjusted: String(params.adjusted ?? true), sort: 'asc', limit: String(params.limit ?? 50000) },
   ```
3. Expected: existing callers (`app/api/market-data/route.ts`, `fetchDailyAggregates`) are unchanged (default `true`).

**Acceptance criteria**
- [ ] `fetchMassiveAggregateBars({ ..., adjusted: false })` sends `adjusted=false`; omitting it still sends `adjusted=true`.

---

### Step 2 — Register the six column types

**File:** `lib/sheets/columns.ts`
**Action:** MODIFY

1. Extend the `SheetColumnType` union (after `| 'float'`):
   ```ts
     | 'float'
     | 'pdc'
     | 'pd_range'
     | 'ah_high'
     | 'pm_high_early'
     | 'pm_high_late'
     | 'pm_extension';
   ```
   (Move the existing `;` from `'float'` to the new last member.)

**File:** `lib/validations/sheets.ts`
**Action:** MODIFY

2. Append the same six strings, in the same order, to `SHEET_COLUMN_TYPES` after `'float',`.

**File:** `lib/sheets/grid.ts`
**Action:** MODIFY

3. Append the same six strings to `USER_COLUMN_TYPES` (~line 76) after `'float',`. This puts them in the Add/Edit Column and Import dropdowns automatically, labeled by their raw type string, which matches how `share_volume` is shown today.
4. Directly below `USER_COLUMN_TYPES`, add:
   ```ts
   export const NUMERIC_COLUMN_TYPES: SheetColumnType[] = [
     'number',
     'share_volume',
     'dollar_volume',
     'float',
     'pdc',
     'pd_range',
     'ah_high',
     'pm_high_early',
     'pm_high_late',
     'pm_extension',
   ];
   ```

**File:** `lib/sheets/import.ts`
**Action:** MODIFY

5. Change the existing import `import { nextColumnKey } from '@/lib/sheets/grid';` to `import { nextColumnKey, NUMERIC_COLUMN_TYPES } from '@/lib/sheets/grid';`.
6. In `coerceImportValue` (~line 153), replace
   `if (type === 'number' || type === 'share_volume' || type === 'dollar_volume' || type === 'float') {`
   with
   `if (NUMERIC_COLUMN_TYPES.includes(type)) {`
   Expected: CSV import parses the new types as numbers. Existing behavior for the four old types is unchanged.

**Acceptance criteria**
- [ ] `npx tsc --noEmit` passes with the six new union members.
- [ ] The Add Column dropdown lists the six new types.
- [ ] Existing `__tests__/sheets-import.test.ts` still passes.

---

### Step 3 — Pure fill helpers (session highs + new keys)

**File:** `lib/sheets/massive-fill.ts`
**Action:** MODIFY

1. Add an import at the top: `import { nyDateTimeToEpoch } from '@/lib/time-utils';`
2. Extend `MassiveFillKeys`:
   ```ts
   export type MassiveFillKeys = {
     shareKey?: string;
     dollarKey?: string;
     floatKey?: string;
     pdcKey?: string;
     pdRangeKey?: string;
     ahHighKey?: string;
     pmEarlyKey?: string;
     pmLateKey?: string;
     extensionKey?: string;
   };
   ```
3. In `getMassiveFillKeys`, add one line per new type after the `float` line, following the existing first-wins pattern:
   ```ts
   if (column.type === 'pdc' && !keys.pdcKey) keys.pdcKey = column.key;
   if (column.type === 'pd_range' && !keys.pdRangeKey) keys.pdRangeKey = column.key;
   if (column.type === 'ah_high' && !keys.ahHighKey) keys.ahHighKey = column.key;
   if (column.type === 'pm_high_early' && !keys.pmEarlyKey) keys.pmEarlyKey = column.key;
   if (column.type === 'pm_high_late' && !keys.pmLateKey) keys.pmLateKey = column.key;
   if (column.type === 'pm_extension' && !keys.extensionKey) keys.extensionKey = column.key;
   ```
4. After `isEmptySheetCell`, add the session-high helper:
   ```ts
   export type SessionHighs = {
     ahHigh: number | null;
     pmEarlyHigh: number | null;
     pmLateHigh: number | null;
     // True once the last window (trade date 09:30 ET) has closed.
     complete: boolean;
   };

   // Windows are [start, end) in ET on each minute bar's start time. A window
   // that hasn't ended yet returns null: fill only writes empty cells, so a
   // partial high written mid-session would never be corrected.
   export function computeSessionHighs(
     bars: Array<{ t: number; h: number }>,
     scanDate: string,
     tradeDate: string,
     nowMs: number,
   ): SessionHighs {
     const windowHigh = (date: string, start: string, end: string) => {
       const startMs = nyDateTimeToEpoch(date, start)!;
       const endMs = nyDateTimeToEpoch(date, end)!;
       if (nowMs < endMs) return null;
       let high: number | null = null;
       for (const bar of bars) {
         if (bar.t >= startMs && bar.t < endMs && (high == null || bar.h > high)) high = bar.h;
       }
       return high;
     };

     return {
       ahHigh: windowHigh(scanDate, '16:00:00', '20:00:00'),
       pmEarlyHigh: windowHigh(tradeDate, '04:00:00', '07:00:00'),
       pmLateHigh: windowHigh(tradeDate, '07:00:00', '09:30:00'),
       complete: nowMs >= nyDateTimeToEpoch(tradeDate, '09:30:00')!,
     };
   }
   ```
   (`!` is safe because callers only pass valid `YYYY-MM-DD` trading dates; the route gates on `isNyTradingDay`.)
5. Change `computeRowFill`:
   - `bar` type becomes `Pick<GroupedDailyBar, 'volume' | 'vwap' | 'close' | 'high' | 'low'> | null`.
   - Add a param `sessionHighs: SessionHighs | null;` (put it after `sharesOutstanding`, before `force`).
   - Inside the existing `if (bar) { ... }` block, after the dollar-volume write, add:
     ```ts
     if (keys.pdcKey && writable(keys.pdcKey)) {
       fill[keys.pdcKey] = bar.close;
     }

     if (keys.pdRangeKey && writable(keys.pdRangeKey)) {
       fill[keys.pdRangeKey] = Math.round((bar.high - bar.low) * 10000) / 10000;
     }
     ```
   - After the float block, before `return fill;`, add:
     ```ts
     if (sessionHighs) {
       if (keys.ahHighKey && sessionHighs.ahHigh != null && writable(keys.ahHighKey)) {
         fill[keys.ahHighKey] = sessionHighs.ahHigh;
       }
       if (keys.pmEarlyKey && sessionHighs.pmEarlyHigh != null && writable(keys.pmEarlyKey)) {
         fill[keys.pmEarlyKey] = sessionHighs.pmEarlyHigh;
       }
       if (keys.pmLateKey && sessionHighs.pmLateHigh != null && writable(keys.pmLateKey)) {
         fill[keys.pmLateKey] = sessionHighs.pmLateHigh;
       }

       // Extension = how far the AH/PM high got above PDC, in multiples of the
       // scan day's range. Filter ">0.33" = "high beat PDC + 1/3 range".
       const highs = [sessionHighs.ahHigh, sessionHighs.pmEarlyHigh, sessionHighs.pmLateHigh]
         .filter((high): high is number => high != null);
       const range = bar ? bar.high - bar.low : 0;
       if (bar && keys.extensionKey && sessionHighs.complete && highs.length > 0 && range > 0 && writable(keys.extensionKey)) {
         fill[keys.extensionKey] = Math.round(((Math.max(...highs) - bar.close) / range) * 10000) / 10000;
       }
     }
     ```
6. Expected: existing callers that pass `sessionHighs: null` behave exactly as before.

**Acceptance criteria**
- [ ] `computeSessionHighs` excludes a bar exactly at a window's end and includes a bar exactly at its start.
- [ ] A window whose end is after `nowMs` returns `null`. `complete` is false until trade date 09:30 ET.
- [ ] Extension is computed from the daily bar (`close`, `high − low`), not from the `pdc`/`pd_range` cells, so it works even if those columns aren't on the sheet.

---

### Step 4 — Fill route: fetch minute bars and pass session highs

**File:** `app/api/sheets/[id]/fill-massive/route.ts`
**Action:** MODIFY

1. Imports:
   - Add `fetchMassiveAggregateBars` to the `@/lib/massive-market` import list.
   - Change `import { computeRowFill, getMassiveFillKeys, isEmptySheetCell, type MassiveFillKeys } from '@/lib/sheets/massive-fill';` to also import `computeSessionHighs`.
   - Change `import { isNyTradingDay } from '@/lib/time-utils';` to `import { getNextTradingSession, isNyTradingDay, nyDateTimeToEpoch } from '@/lib/time-utils';`
2. Replace the body of `hasMassiveFillKey` (lines ~20-22) with:
   ```ts
   return Object.values(keys).some(Boolean);
   ```
3. Rename `needsVolume` to `needsDaily` (it now covers every value that comes from the grouped daily bar) and replace it with:
   ```ts
   function needsDaily(values: Record<string, unknown>, keys: MassiveFillKeys, force: boolean): boolean {
     const dailyKeys = [keys.shareKey, keys.dollarKey, keys.pdcKey, keys.pdRangeKey, keys.extensionKey];
     if (force) return dailyKeys.some(Boolean);
     return dailyKeys.some((key) => key && isEmptySheetCell(values[key]));
   }
   ```
   Update its one call site in the row loop (`needsVolume(values, keys, body.force)` → `needsDaily(values, keys, body.force)`).
4. Add below `needsFloat`:
   ```ts
   function needsSession(values: Record<string, unknown>, keys: MassiveFillKeys, force: boolean): boolean {
     const sessionKeys = [keys.ahHighKey, keys.pmEarlyKey, keys.pmLateKey, keys.extensionKey];
     if (force) return sessionKeys.some(Boolean);
     return sessionKeys.some((key) => key && isEmptySheetCell(values[key]));
   }
   ```
5. In `POST`, right after `const floatNeeds = new Map<...>();`, add:
   ```ts
   // Keyed by `${ticker}|${scanDate}`; one minute-bar request covers the scan
   // day's after-hours through the trade day's 9:30 open.
   const sessionNeeds = new Map<string, { ticker: string; date: string; tradeDate: string }>();
   const nowMs = Date.now();
   ```
6. Inside the first `for (const row of rows)` loop, after the `floatNeeds` block, add:
   ```ts
   const tradeDate = date && isNyTradingDay(date) ? getNextTradingSession(date) : null;
   // Skip until the AH window has closed — before that there's nothing to write.
   if (tradeDate && nowMs >= nyDateTimeToEpoch(date, '20:00:00')! && needsSession(values, keys, body.force)) {
     sessionNeeds.set(`${ticker}|${date}`, { ticker, date, tradeDate });
   }
   ```
7. After the `sharesByKey` block (after its `for (const result of shareResults)` loop), add:
   ```ts
   const minuteBarsByKey = new Map<string, Array<{ t: number; h: number }>>();
   await Promise.all([...sessionNeeds.entries()].map(async ([key, { ticker, date, tradeDate }]) => {
     try {
       const bars = await fetchMassiveAggregateBars({
         ticker,
         multiplier: '1',
         timespan: 'minute',
         from: String(nyDateTimeToEpoch(date, '16:00:00')),
         to: String(nyDateTimeToEpoch(tradeDate, '09:30:00')),
         adjusted: false,
       });
       minuteBarsByKey.set(key, bars.flatMap((bar) => {
         const t = Number(bar.t);
         const h = Number(bar.h);
         return Number.isFinite(t) && Number.isFinite(h) ? [{ t, h }] : [];
       }));
     } catch (error) {
       console.warn(`Massive minute bars unavailable for ${key}`, error);
     }
   }));
   ```
8. In the second `for (const row of rows)` loop (the write loop), after `const sharesOutstanding = ...;`, add:
   ```ts
   const minuteBars = minuteBarsByKey.get(`${ticker}|${date}`);
   const tradeDate = minuteBars ? getNextTradingSession(date) : null;
   const sessionHighs = minuteBars && tradeDate
     ? computeSessionHighs(minuteBars, date, tradeDate, nowMs)
     : null;
   ```
   and pass `sessionHighs,` into the `computeRowFill({ ... })` call (between `sharesOutstanding,` and `force: body.force,`).
9. Expected behavior:
   - Sheets with no new columns make **zero** minute-bar calls (`sessionNeeds` stays empty).
   - A Friday scan date pulls bars from Fri 16:00 ET to Mon 09:30 ET.
   - Rows whose windows are still open are counted as `missed` and get filled on a later click.

**Acceptance criteria**
- [ ] Minute bars are requested once per unique `ticker|scanDate`, with `adjusted: false` and epoch-ms `from`/`to`.
- [ ] A failed minute-bar request logs a warning and leaves the session cells empty; volume/PDC still fill.
- [ ] Existing volume/float behavior and the existing route tests are unchanged.

---

### Step 5 — Numeric comparison filters

**File:** `lib/sheets/grid.ts`
**Action:** MODIFY

1. Above `filterGridRows`, add:
   ```ts
   // ">0.33", ">= 10m", "<5k" — numeric comparisons with an optional k/m/b suffix.
   const COMPARISON_FILTER = /^(>=|<=|>|<)\s*(-?\d*\.?\d+)\s*([kmb])?$/i;
   const SUFFIX_MULTIPLIER: Record<string, number> = { k: 1_000, m: 1_000_000, b: 1_000_000_000 };
   ```
2. Inside `filterGridRows`'s `activeFilters.every(...)` callback, **after** the `checkbox` block and **before** the `multiselect` block, add:
   ```ts
   const comparison = COMPARISON_FILTER.exec(value.trim().replace(/,/g, ''));
   if (comparison) {
     const text = String(row[key] ?? '').replace(/,/g, '').trim();
     const cell = Number(text);
     // Blank cells never match a numeric filter (Number('') is 0).
     if (!text || !Number.isFinite(cell)) return false;
     const target = Number(comparison[2]) * (comparison[3] ? SUFFIX_MULTIPLIER[comparison[3].toLowerCase()] ?? 1 : 1);
     if (comparison[1] === '>') return cell > target;
     if (comparison[1] === '>=') return cell >= target;
     if (comparison[1] === '<') return cell < target;
     return cell <= target;
   }
   ```
3. Expected: text that doesn't start with a comparison operator still uses the existing case-insensitive "contains" match.

**File:** `components/trading/SheetsTab.tsx`
**Action:** MODIFY

4. Add `NUMERIC_COLUMN_TYPES` to the existing `@/lib/sheets/grid` import in this file.
5. In `isFilterableColumn` (~line 86), append `|| NUMERIC_COLUMN_TYPES.includes(type)` to the return expression. This makes `share_volume`, `dollar_volume`, `float` and the six new types filterable. (`number` is already listed; duplicating it via the array is harmless.)
6. In `FilterControl`'s text `<input>` (~line 132), change the placeholder to:
   ```tsx
   placeholder={NUMERIC_COLUMN_TYPES.includes(column.type) ? 'e.g. >0.33, >10m' : `Filter ${column.name}`}
   ```

**Acceptance criteria**
- [ ] `>0.33` on an Extension column keeps rows with a value above 0.33 and drops blank rows.
- [ ] `>10m` on a Share Vol column keeps rows with volume > 10,000,000.
- [ ] `>=`, `<`, `<=` work, and `1,000` style commas in either the filter or the cell are ignored.
- [ ] Existing text/select/multiselect/checkbox filter tests still pass.

---

### Step 6 — Render and fill the new columns in the grid

**File:** `lib/sheets/format.ts`
**Action:** MODIFY

1. Append:
   ```ts
   export function formatSheetPrice(n: number): string {
     if (!Number.isFinite(n)) return '';
     return n >= 1 ? n.toFixed(2) : n.toFixed(4);
   }
   ```

**File:** `components/trading/SheetsTab.tsx`
**Action:** MODIFY

2. Add `formatSheetPrice` to the existing `@/lib/sheets/format` import (the one that already imports `formatCompactShares` / `formatCompactUsd`).
3. Replace the body of `getMassiveCandidateRowIds`'s non-force path (the `needsVolume` / `needsFloat` consts and the `if (needsVolume || needsFloat)` push, ~lines 558-571) with:
   ```ts
   const needsFill = Boolean(
     date && Object.values(keys).some((key) => key && isEmptySheetCell(row.values[key])),
   );

   if (needsFill) rowIds.push(row.id);
   ```
   Expected: rows are queued when any Massive-backed cell is empty, including the new ones. The force path above it is unchanged.
4. In `defaultColumnWidth` (~line 591), add the six new types to the `share_volume` / `dollar_volume` / `float` case group (width 110).
5. In `buildColumn`, directly after the `if (column.type === 'float') { ... }` block (~line 827-836), add:
   ```tsx
   if (
     column.type === 'pdc'
     || column.type === 'pd_range'
     || column.type === 'ah_high'
     || column.type === 'pm_high_early'
     || column.type === 'pm_high_late'
   ) {
     return {
       ...base,
       renderCell: ({ row }) => (
         <ReadOnlyCompactNumberCell value={row[column.key]} formatter={formatSheetPrice} />
       ),
     };
   }

   if (column.type === 'pm_extension') {
     return {
       ...base,
       renderCell: ({ row }) => (
         <ReadOnlyCompactNumberCell value={row[column.key]} formatter={(n) => n.toFixed(2)} />
       ),
     };
   }
   ```
6. Replace `hasMassiveFillColumns` (~lines 964-966) with:
   ```ts
   const hasMassiveFillColumns = Object.values(massiveFillKeys).some(Boolean);
   ```
   Expected: the Fill data button appears on a sheet that only has the new columns.

**Acceptance criteria**
- [ ] A sheet with only an `ah_high` column shows the Fill data button.
- [ ] Price cells show 2 decimals (≥ $1) or 4 decimals (< $1). Extension shows 2 decimals. Empty cells show `—`.

---

### Step 7 — Tests

**File:** `__tests__/sheets-massive-fill.test.ts`
**Action:** MODIFY

1. Import `computeSessionHighs` and `nyDateTimeToEpoch` (from `@/lib/time-utils`).
2. Every existing `computeRowFill({...})` call must add `sessionHighs: null`, and any `bar` literal must add `high` and `low` fields (e.g. `high: 1.3, low: 1.1`) so the type checks.
3. Add tests (scan `2026-06-05` Fri → trade `2026-06-08` Mon; use `const at = (d: string, t: string) => nyDateTimeToEpoch(d, t)!;`):
   - `computeSessionHighs` buckets bars: bars at `at('2026-06-05','17:00:00')` h 2.4, `at('2026-06-08','06:59:00')` h 2.5, `at('2026-06-08','07:00:00')` h 2.9, `at('2026-06-08','09:30:00')` h 5 → `{ ahHigh: 2.4, pmEarlyHigh: 2.5, pmLateHigh: 2.9, complete: true }` with `nowMs = at('2026-06-08','12:00:00')`.
   - With `nowMs = at('2026-06-08','06:00:00')`: `ahHigh: 2.4`, `pmEarlyHigh: null`, `pmLateHigh: null`, `complete: false`.
   - `computeRowFill` with keys for all six new columns, `bar { volume: 1, vwap: null, close: 2, high: 3, low: 1 }` and complete highs (2.4 / 2.5 / 2.9) → `{ pdc: 2, pd_range: 2, ah: 2.4, pm_early: 2.5, pm_late: 2.9, ext: 0.45 }`.
   - Extension is NOT written when `complete: false`, even if AH is present.
   - Extension is NOT written when the range is 0 or all highs are null.

**File:** `__tests__/sheets-grid.test.ts`
**Action:** MODIFY

4. Add numeric filter tests on a small `number`-typed column with values `0.2`, `0.45`, `''`, `'1,200'`:
   - `>0.33` → only the `0.45` and `1,200` rows. The blank row is excluded.
   - `<=0.2` → only the `0.2` row.
   - `>1k` → only the `1,200` row. Also test `>10m` on a `share_volume` column with values `12000000` / `9000000`.
   - A non-operator value (`'0.4'`) still does a substring match.

**File:** `__tests__/sheets-routes.test.ts`
**Action:** MODIFY

5. Add `fetchMassiveAggregateBarsMock` to the `vi.hoisted` block and to the `vi.mock('@/lib/massive-market', ...)` factory as `fetchMassiveAggregateBars: fetchMassiveAggregateBarsMock`.
6. Add a test `POST /api/sheets/[id]/fill-massive fills session highs and extension`, modeled on the existing "fills empty volume cells" test:
   - Sheet columns: `DEFAULT_SHEET_COLUMNS` + `{ key: 'ah', type: 'ah_high' }`, `{ key: 'pm_late', type: 'pm_high_late' }`, `{ key: 'ext', type: 'pm_extension' }` (give each a `name`).
   - Row values `{ ticker: 'AAPL', date: '2026-06-05' }`.
   - Grouped mock: `{ ticker: 'AAPL', open: 1, high: 3, low: 1, close: 2, volume: 1000, vwap: 2.5, timestamp: 0 }`.
   - Minute mock returns `[{ t: <2026-06-05 17:00 ET>, h: 2.4 }, { t: <2026-06-08 08:00 ET>, h: 2.9 }]` (build the epochs with the real `nyDateTimeToEpoch`; `@/lib/time-utils` is not mocked).
   - Assert `fetchMassiveAggregateBarsMock` was called with `expect.objectContaining({ ticker: 'AAPL', timespan: 'minute', adjusted: false, from: String(nyDateTimeToEpoch('2026-06-05', '16:00:00')), to: String(nyDateTimeToEpoch('2026-06-08', '09:30:00')) })`.
   - Assert `updateSetMock` was called with values `{ ticker: 'AAPL', date: '2026-06-05', ah: 2.4, pm_late: 2.9, ext: 0.45 }`.
7. No `beforeEach` change is needed: it already calls `vi.clearAllMocks()`, and the new test sets its own `mockResolvedValue`. Existing fill tests never call the minute-bar mock because their sheets have no session columns.

**Acceptance criteria**
- [ ] `npm test` passes, including the new tests.

---

### Step 8 — AGENTS.md

**File:** `AGENTS.md`
**Action:** MODIFY

1. At the end of the **Sheets** bullet (line ~63), append this sentence:
   `Massive-backed column types (`share_volume`, `dollar_volume`, `float`, `pdc`, `pd_range`, `ah_high`, `pm_high_early`, `pm_high_late`, `pm_extension`) are filled by `POST /api/sheets/[id]/fill-massive` (pure helpers in `lib/sheets/massive-fill.ts`); the row `date` is the scan date, session highs use unadjusted 1-minute bars and only fill after their ET window closes, and numeric filters accept `>`, `>=`, `<`, `<=` with k/m/b suffixes.`
2. Run `npm run workflow:audit`.

---

### Files Changed Summary

| File | +/− (approx) | Risk |
|---|---|---|
| `lib/massive-market.ts` | +2 / −1 | Low |
| `lib/sheets/columns.ts` | +6 / −1 | Low |
| `lib/validations/sheets.ts` | +6 / 0 | Low |
| `lib/sheets/grid.ts` | +40 / 0 | Medium (filter logic shared by all sheets) |
| `lib/sheets/import.ts` | +1 / −1 | Low |
| `lib/sheets/massive-fill.ts` | +70 / −2 | Medium (time-window math) |
| `lib/sheets/format.ts` | +4 / 0 | Low |
| `app/api/sheets/[id]/fill-massive/route.ts` | +50 / −8 | Medium |
| `components/trading/SheetsTab.tsx` | +35 / −15 | Low |
| `__tests__/sheets-massive-fill.test.ts` | +60 / ~6 edits | Low |
| `__tests__/sheets-grid.test.ts` | +30 / 0 | Low |
| `__tests__/sheets-routes.test.ts` | +55 / 0 | Low |
| `AGENTS.md` | +1 / 0 | Low |

No migration. No new dependencies. No new routes.

### Verification Steps

1. `npm run lint`
2. `npx tsc --noEmit`
3. `npm test`
4. `npm run workflow:audit` (AGENTS.md changed)
5. Manual (dev server, Sheets tab):
   - Add columns of types `pdc`, `pd_range`, `ah_high`, `pm_high_early`, `pm_high_late`, `pm_extension`, `share_volume` to a sheet.
   - Add a row for a known past multi-day runner (scan date = the big day, a weekday at least one trading day back). Click **Fill data**. All seven cells fill.
   - Cross-check one row against the chart: AH high on the scan day, and the two PM highs on the next session.
   - Open the Filter toggle. Type `>0.33` in Extension and `>10m` in Share Vol. Only qualifying rows remain. Blank rows are hidden.
   - Add a row whose scan date is today. Fill leaves the session cells and Extension blank (they're counted as "unavailable").

## Implementation Style

Write the simplest correct code that satisfies this spec. Specifically:

- Match the existing conventions in the file you're editing. Do not introduce new patterns, helpers, abstractions, or file layouts unless this spec explicitly calls for them.
- No future-proofing. No feature flags, no "in case we need it later" parameters, no extracted helpers that have a single caller. If a value is only used once, inline it.
- No defensive code at internal boundaries. Trust your own code and framework guarantees; validate only at system boundaries (user input, external APIs, DB reads of untrusted JSON).
- No comments unless the *why* is non-obvious (a hidden constraint, a workaround, a surprising invariant). Don't restate what the code says.
- If a step in this spec looks more complex than it needs to be, flag it and propose the simpler version before implementing — don't silently "improve" the spec, but don't write code that's more elaborate than the problem requires either.
- If you spot an existing simpler pattern in the codebase that fits, use it instead of writing new code.

This is a personal trading platform built solo. Readability > cleverness; debuggable > elegant; small diff > sweeping refactor. Three similar lines beats a premature abstraction.

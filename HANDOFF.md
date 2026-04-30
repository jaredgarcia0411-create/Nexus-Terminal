# Nexus Terminal — HANDOFF.md

> Updated: 2026-04-30
> Purpose: brief summary of recently completed work plus any active execution spec. Older implementation detail lives in git history and `specs/`.
> Historical completed sections were removed to keep this file focused. Use git history and the `specs/` directory for archived implementation detail.

## Active Specs

## Build Spec — Dashboard Scanner Refactor + Performance Top Section + Research Cleanup

> Generated: 2026-04-30 | Agent: nexus-architect
> Status: IMPLEMENTED — code validation passed 2026-04-30; manual UI checks remain user-owned.

## Implementation Result

- Added the cached `/api/askedgar/scanner-summary` path and focused route coverage.
- Rebuilt Dashboard as the two-table scanner, moved the KPI/chart top section into Performance, and collapsed Research to single-column ticker lookup/view.
- Validation passed: `npm run lint`, `npx tsc --noEmit`, `npm test` (519/519). `services/` was not touched.

## Objective

Rebuild the Dashboard tab into a two-table scanner (Gainers Scan + Potential MDR Setup), move the KPI/chart top section to Performance, slim Research to a single-column search-and-view layout, and wire per-ticker SEC dilution fields through a new cached `/api/askedgar/scanner-summary` endpoint.

## Current State

Key observations derived from reading live source files:

- `/home/jared/Nexus-Terminal/app/page.tsx` (340 lines): `activeTab` and `performanceMetric` state live here. `ResearchTab` is rendered at line 296–301 with no props. `Toolbar` is rendered unconditionally for all tabs (lines 175–186). No `pendingResearchTicker` slot exists.
- `/home/jared/Nexus-Terminal/components/trading/DashboardTab.tsx` (212 lines): Contains the KPI cards (lines 137–180), PerformanceCharts (line 182), WeeklyCalendar, TradingCalendar, TradeTable, and the Net/Gross toggle (lines 121–135). All of this is scoped behind `trades.length === 0` guard.
- `/home/jared/Nexus-Terminal/components/trading/PerformanceTab.tsx` (123 lines): Has the $/R toggle (lines 44–57), tag filter, PerformanceCharts (line 77, no `pnlMode` prop today), PerformanceStatsTable (line 78), and the Symbol Distribution + Risk Summary grid (lines 80–120).
- `/home/jared/Nexus-Terminal/components/trading/PerformanceCharts.tsx`: Already accepts `pnlMode?: 'net' | 'gross'` prop (line 26) with default `'net'`. No change needed to this component's interface.
- `/home/jared/Nexus-Terminal/components/trading/PerformanceStatsTable.tsx` (334 lines): The last two cells of the 30-cell grid are intentionally blank — `{ label: '', value: '' }` at lines 278–279. These are the two cells to fill.
- `/home/jared/Nexus-Terminal/components/trading/ResearchTab.tsx` (71 lines): The layout is a flex row (line 54) with the gainers sidebar (lines 55–57) and ticker view (lines 59–68). The gainers list is imported from `ResearchGainersList`.
- `/home/jared/Nexus-Terminal/components/trading/ResearchGainersList.tsx` (103 lines): Polls `/api/tradingview/gainers` every 10 seconds. Defines `TradingViewGainer` interface locally.
- `/home/jared/Nexus-Terminal/app/api/tradingview/gainers/route.ts` (111 lines): Returns `{ gainers, count, totalCount, isRealtime, fetchedAt }`. Each gainer: `{ ticker, price, change, volume, avgVolume90d, marketCap, sector }`.
- `/home/jared/Nexus-Terminal/lib/askedgar.ts` (1304 lines): `toRegistrationRow` at line 735, `detectFormType` at line 711, `getBooleanField` at line 700, `registrationEquityLines` filter logic at lines 814–818, warrants reduce at lines 881–900. `getCachedTickerData` at line 1197. `fetchRegistrations` calls `/v1/registrations` with `effective_status: true` (line 421). `fetchEquityLines` calls `/v1/offerings` with `offering_type: 'NEW EQUITY LINE'` (line 415). The `askedgar_cache` table shape: `{ id, cacheType, ticker, dataJson, fetchedAt, expiresAt }`, unique on `(cacheType, ticker)`.
- `/home/jared/Nexus-Terminal/components/trading/Toolbar.tsx` (149 lines): Renders the date-filter controls unconditionally for every tab. The `pageTitle` prop drives the animated heading. No tab-awareness exists today — Toolbar must receive `activeTab` to hide date filters on Dashboard and Research.
- `/home/jared/Nexus-Terminal/lib/api-route-utils.ts`: `parseAndValidate` parses a JSON **body**. The scanner-summary route uses a query param (`?ticker=X`), so validation must be done manually via Zod `.safeParse()` on the parsed param — `parseAndValidate` is not applicable here (it calls `request.json()`).

---

## Required Changes

### Change 1 — New cache helper in `lib/askedgar.ts`

**File:** `lib/askedgar.ts`
**Action:** MODIFY

**Steps:**

1. After the closing brace of `getCachedGainers` (line 1303, end of file), add the following exported function. Do not modify any existing function.

```typescript
// ---------------------------------------------------------------------------
// Scanner Summary Cache — 3-hour TTL, cacheType = 'scanner-summary'
// ---------------------------------------------------------------------------

export interface ScannerSummaryResult {
  ticker: string;
  cashOnHand: number | null;
  hasAtm: boolean;
  hasEl: boolean;
  hasWarrants: boolean;
  hasS1: boolean;
  fetchedAt: string;
}

async function fetchScannerSummaryRaw(ticker: string): Promise<ScannerSummaryResult> {
  const normalizedTicker = ticker.trim().toUpperCase();

  // Run only the 4 endpoints needed for scanner fields — no full snapshot
  const [registrationsResp, dilutionRatingResp, dilutionDataResp, equityLinesResp] =
    await Promise.all([
      fetchRegistrations(normalizedTicker),
      fetchDilutionRating(normalizedTicker),
      fetchDilutionData(normalizedTicker),
      fetchEquityLines(normalizedTicker),
    ]);

  // --- cashOnHand: prefer dilution-rating.estimated_cash, then dilution-data[0] ---
  const dilutionRatingFirst = toRecord(dilutionRatingResp.results[0]);
  const dilutionDataFirst = toRecord(dilutionDataResp.results[0]);

  const cashOnHand: number | null =
    toNumberValue(getField(dilutionRatingFirst, ['estimated_cash', 'estimatedCash'])) ??
    toNumberValue(getField(dilutionDataFirst, ['cashOnHand', 'cash', 'estimatedCash']));

  // --- hasAtm: any registration with isAtm === true ---
  const registrationRows = registrationsResp.results.map((item, index) =>
    toRegistrationRow(toRecord(item), `Registration ${index + 1}`),
  );
  const hasAtm = registrationRows.some((row) => row.isAtm);

  // --- hasS1: any registration whose formType starts with 'S-1' (case-insensitive, allows S-1/A) ---
  const hasS1 = registrationRows.some((row) => {
    const ft = row.formType ?? '';
    return /^S-1/i.test(ft);
  });

  // --- hasEl: any equity-lines result OR any registration matching equity-line keywords (not ATM) ---
  const hasElFromEquityLines = equityLinesResp.results.length > 0;
  const hasElFromRegistrations = registrationRows.some((row) => {
    if (row.isAtm) return false;
    const headline = row.headline.toLowerCase();
    return (
      headline.includes('equity line') ||
      headline.includes('eloc') ||
      headline.includes('purchase agreement')
    );
  });
  const hasEl = hasElFromEquityLines || hasElFromRegistrations;

  // --- hasWarrants: any dilution-data row with warrants_amount > 0 ---
  const hasWarrants = dilutionDataResp.results.some((item) => {
    const row = toRecord(item);
    const amount = toNumberValue(getField(row, ['warrants_amount']));
    return amount !== null && amount > 0;
  });

  return {
    ticker: normalizedTicker,
    cashOnHand,
    hasAtm,
    hasEl,
    hasWarrants,
    hasS1,
    fetchedAt: new Date().toISOString(),
  };
}

const SCANNER_SUMMARY_CACHE_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours

/**
 * Cached scanner summary for a single ticker. Calls only the 4 endpoints needed
 * for the Dashboard scanner table (registrations, dilution-rating, dilution-data,
 * equity-lines). Shares the askedgar_cache table with cacheType = 'scanner-summary'.
 * TTL: 3 hours.
 */
export async function getCachedScannerSummary(ticker: string): Promise<ScannerSummaryResult> {
  const normalizedTicker = ticker.trim().toUpperCase();
  const db = getDb();

  if (db) {
    const now = new Date();
    const cached = await db
      .select()
      .from(askedgarCache)
      .where(
        and(
          eq(askedgarCache.cacheType, 'scanner-summary'),
          eq(askedgarCache.ticker, normalizedTicker),
          gt(askedgarCache.expiresAt, now),
        ),
      )
      .limit(1);

    if (cached.length > 0) {
      return cached[0].dataJson as ScannerSummaryResult;
    }
  }

  const result = await fetchScannerSummaryRaw(normalizedTicker);

  if (db) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SCANNER_SUMMARY_CACHE_TTL_MS);
    try {
      await db
        .insert(askedgarCache)
        .values({
          id: `scanner-summary-${normalizedTicker}`,
          cacheType: 'scanner-summary',
          ticker: normalizedTicker,
          dataJson: result,
          fetchedAt: now,
          expiresAt,
        })
        .onConflictDoUpdate({
          target: [askedgarCache.cacheType, askedgarCache.ticker],
          set: { dataJson: result, fetchedAt: now, expiresAt },
        });
    } catch (err) {
      console.warn('[askedgar-cache] Failed to write scanner-summary cache:', err);
    }
  }

  return result;
}
```

**Acceptance criteria:**
- [ ] `getCachedScannerSummary` and `ScannerSummaryResult` are exported from `lib/askedgar.ts`
- [ ] `fetchScannerSummaryRaw` calls exactly 4 endpoints in parallel (registrations, dilution-rating, dilution-data, equity-lines) — not the full snapshot
- [ ] Cache reads/writes use `cacheType = 'scanner-summary'` in the existing `askedgar_cache` table
- [ ] No new imports needed — all helpers (`toRegistrationRow`, `toRecord`, `toNumberValue`, `getField`, `getBooleanField`, `fetchRegistrations`, `fetchDilutionRating`, `fetchDilutionData`, `fetchEquityLines`, `askedgarCache`, `and`, `eq`, `gt`, `getDb`) are already in scope in this file
- [ ] `npx tsc --noEmit` passes

---

### Change 2 — New API route: `/api/askedgar/scanner-summary`

**File:** `app/api/askedgar/scanner-summary/route.ts`
**Action:** CREATE

**Steps:**

1. Create the directory `app/api/askedgar/scanner-summary/` and create `route.ts` with the following content:

```typescript
import { z } from 'zod';
import { internalServerError, logRouteError, TICKER_REGEX } from '@/lib/api-route-utils';
import { requireUser } from '@/lib/server-db-utils';
import { getCachedScannerSummary } from '@/lib/askedgar';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  ticker: z
    .string()
    .min(1)
    .max(10)
    .regex(TICKER_REGEX, 'Invalid ticker format')
    .transform((v) => v.trim().toUpperCase()),
});

export async function GET(request: Request) {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const { searchParams } = new URL(request.url);
  const rawTicker = searchParams.get('ticker') ?? '';

  const parsed = querySchema.safeParse({ ticker: rawTicker });
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation failed', details: z.flattenError(parsed.error) },
      { status: 400 },
    );
  }

  const { ticker } = parsed.data;

  try {
    const summary = await getCachedScannerSummary(ticker);
    return Response.json(summary);
  } catch (error) {
    logRouteError('askedgar-scanner-summary', error);
    return internalServerError();
  }
}
```

**Acceptance criteria:**
- [ ] `GET /api/askedgar/scanner-summary?ticker=AAPL` returns `{ ticker, cashOnHand, hasAtm, hasEl, hasWarrants, hasS1, fetchedAt }`
- [ ] Missing or invalid `ticker` param returns 400 with `{ error: 'Validation failed', details: { ... } }`
- [ ] Unauthenticated request returns 401
- [ ] `export const dynamic = 'force-dynamic'` is present
- [ ] Route uses `requireUser()`, `getCachedScannerSummary`, and `TICKER_REGEX` from existing helpers only — no new dependencies

---

### Change 3 — Top-level state plumbing (`app/page.tsx`)

**File:** `app/page.tsx`
**Action:** MODIFY

**Steps:**

1. After line 50 (`const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);`), add:

```typescript
  const [pendingResearchTicker, setPendingResearchTicker] = useState<string | null>(null);
```

2. On line 174 (the `<main>` open tag), `Toolbar` is rendered at lines 175–186. Add `activeTab` as a prop to Toolbar. Change the Toolbar JSX block to:

```typescript
      <Toolbar
        activeTab={activeTab}
        pageTitle={TAB_TITLES[activeTab]}
        error={error}
        filterPreset={filterPreset}
        selectedCount={selectedIds.size}
        onDeleteSelected={handleDeleteSelected}
        onFilterPresetChange={setFilterPreset}
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={setStartDate}
        onEndDateChange={setEndDate}
      />
```

3. Replace the `DashboardTab` render block (lines 193–212) with:

```typescript
            {activeTab === 'dashboard' ? (
              <TabErrorBoundary name="Dashboard">
                <DashboardTab
                  onNavigateToResearch={(ticker) => {
                    setPendingResearchTicker(ticker);
                    setActiveTab('research');
                  }}
                />
              </TabErrorBoundary>
            ) : null}
```

4. Replace the `ResearchTab` render block (lines 296–301) with:

```typescript
            {activeTab === 'research' ? (
              <TabErrorBoundary name="Research">
                <ResearchTab
                  pendingResearchTicker={pendingResearchTicker}
                  onClearPendingTicker={() => setPendingResearchTicker(null)}
                />
              </TabErrorBoundary>
            ) : null}
```

**Acceptance criteria:**
- [ ] `pendingResearchTicker` state (string | null) exists in the component
- [ ] `DashboardTab` receives `onNavigateToResearch` callback; all other old props removed from its render site
- [ ] `ResearchTab` receives `pendingResearchTicker` and `onClearPendingTicker` props at the call site
- [ ] `Toolbar` receives `activeTab` prop at the call site
- [ ] `npx tsc --noEmit` passes (will require matching changes in the component files below)

---

### Change 4 — Toolbar: hide date filters on Dashboard and Research

**File:** `components/trading/Toolbar.tsx`
**Action:** MODIFY

**Steps:**

1. Add `activeTab: string` to the `ToolbarProps` interface (after `pageTitle: string;`):

```typescript
  activeTab: string;
```

2. Add `activeTab` to the destructuring in the function signature.

3. Wrap the time-filter `<div>` block (lines 71–115, the `<div className="flex items-center gap-1">` that contains the preset buttons and date inputs) with a conditional. Replace the opening of that div with:

```typescript
          {activeTab !== 'dashboard' && activeTab !== 'research' ? (
          <div className="flex items-center gap-1">
```

And add a closing `</div>\n) : null}` after the existing closing `</div>` of that same block (before the closing `</div>` of the outer `flex items-center gap-2` container).

The full replacement of lines 71–115 should look like:

```typescript
          {activeTab !== 'dashboard' && activeTab !== 'research' ? (
            <div className="flex items-center gap-1">
              {[
                { id: 'all', label: 'All' },
                { id: '30', label: '30D' },
                { id: '60', label: '60D' },
                { id: '90', label: '90D' },
              ].map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => onFilterPresetChange(preset.id as 'all' | '30' | '60' | '90')}
                  className={`h-[38px] rounded-md px-3 text-xs font-semibold transition-colors ${
                    filterPreset === preset.id
                      ? 'bg-emerald-500 text-black'
                      : 'bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-zinc-200'
                  }`}
                  title={`Filter ${preset.label}`}
                >
                  {preset.label}
                </button>
              ))}

              {!isMobile ? (
                <>
                  <div className="mx-1 hidden h-4 w-px bg-white/10 sm:block" />
                  <div className="flex h-[38px] items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3">
                    <CalendarIcon className="h-4 w-4 text-zinc-500" />
                    <input
                      type="date"
                      value={startDate}
                      onChange={(event) => onStartDateChange(event.target.value)}
                      className="bg-transparent text-sm text-zinc-400 focus:outline-none"
                      title="Start date"
                    />
                    <span className="text-sm text-zinc-600">—</span>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(event) => onEndDateChange(event.target.value)}
                      className="bg-transparent text-sm text-zinc-400 focus:outline-none"
                      title="End date"
                    />
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
```

**Acceptance criteria:**
- [ ] Date filter buttons and calendar inputs do not render when `activeTab === 'dashboard'` or `activeTab === 'research'`
- [ ] Date filter renders normally on Performance, Journal, Trades, Backtesting, Archive
- [ ] `ToolbarProps` includes `activeTab: string`
- [ ] `npx tsc --noEmit` passes

---

### Change 5 — New scanner components

**File:** `components/trading/DashboardScannerTable.tsx`
**Action:** CREATE

This is one unified file containing both tables. The gainers list is shared state between them, fetched once. Decision rationale: both tables display the same ticker rows; putting them in one component avoids a second fetch and aligns the row order.

```typescript
'use client';

import { useCallback, useEffect, useState } from 'react';

// Shape returned by /api/tradingview/gainers
interface TradingViewGainer {
  ticker: string;
  price: number;   // this is "Mark" (current price)
  change: number;  // % change today
  volume: number;
  avgVolume90d: number | null;
  marketCap: number | null;
  sector: string | null;
}

// Shape returned by /api/askedgar/scanner-summary
interface ScannerSummary {
  ticker: string;
  cashOnHand: number | null;
  hasAtm: boolean;
  hasEl: boolean;
  hasWarrants: boolean;
  hasS1: boolean;
  fetchedAt: string;
}

interface Props {
  onNavigateToResearch: (ticker: string) => void;
}

// Format volume as e.g. "1.2M", "450K"
function fmtVolume(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(0);
}

// Format cash-on-hand as "$1.2M" / "$1.2B" or "—"
function fmtCash(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function BoolCell({ value }: { value: boolean }) {
  return (
    <span className={value ? 'text-emerald-400 font-semibold' : 'text-rose-500 font-semibold'}>
      {value ? 'Y' : 'N'}
    </span>
  );
}

const TH = ({ children, right }: { children: React.ReactNode; right?: boolean }) => (
  <th
    className={`px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-zinc-500 ${right ? 'text-right' : 'text-left'}`}
  >
    {children}
  </th>
);

const TD = ({ children, right, className }: { children: React.ReactNode; right?: boolean; className?: string }) => (
  <td className={`px-3 py-2 text-sm ${right ? 'text-right tabular-nums' : ''} ${className ?? ''}`}>
    {children}
  </td>
);

export default function DashboardScannerTable({ onNavigateToResearch }: Props) {
  const [gainers, setGainers] = useState<TradingViewGainer[]>([]);
  const [isRealtime, setIsRealtime] = useState(false);
  const [loading, setLoading] = useState(true);
  // Map of ticker -> ScannerSummary (fetched once per mount, not polled)
  const [summaries, setSummaries] = useState<Record<string, ScannerSummary>>({});

  const fetchGainers = useCallback(async () => {
    try {
      const res = await fetch('/api/tradingview/gainers');
      if (!res.ok) return;
      const data = (await res.json()) as {
        gainers: TradingViewGainer[];
        isRealtime: boolean;
      };
      setGainers(data.gainers ?? []);
      setIsRealtime(data.isRealtime ?? false);
    } catch {
      // silently ignore; retain previous state
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll gainers every 10 seconds (mirrors ResearchGainersList cadence)
  useEffect(() => {
    void fetchGainers();
    const interval = setInterval(() => void fetchGainers(), 10_000);
    return () => clearInterval(interval);
  }, [fetchGainers]);

  // Fetch SEC summaries once per ticker when gainers list first populates.
  // Hourly server-side cache means client fetching once per mount is sufficient.
  useEffect(() => {
    if (gainers.length === 0) return;
    for (const gainer of gainers) {
      if (summaries[gainer.ticker]) continue; // already fetched
      void (async () => {
        try {
          const res = await fetch(`/api/askedgar/scanner-summary?ticker=${encodeURIComponent(gainer.ticker)}`);
          if (!res.ok) return;
          const data = (await res.json()) as ScannerSummary;
          setSummaries((prev) => ({ ...prev, [data.ticker]: data }));
        } catch {
          // leave cell blank; no error state needed
        }
      })();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gainers]);

  const tableCard = 'rounded-xl border border-emerald-500/20 bg-[#121214] overflow-hidden';
  const headerRow = 'border-b border-white/5 bg-[#0f0f11]';
  const bodyRow =
    'border-b border-white/5 transition-colors hover:bg-white/5 cursor-pointer';

  if (loading) {
    return (
      <div className="space-y-6">
        <div className={tableCard}>
          <p className="px-4 py-6 text-sm text-zinc-500">Loading gainers...</p>
        </div>
      </div>
    );
  }

  if (gainers.length === 0) {
    return (
      <div className="space-y-6">
        <div className={tableCard}>
          <p className="px-4 py-6 text-sm text-zinc-500">No gainers found matching scan criteria.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Table 1: Gainers Scan (Day 1 Setup) ── */}
      <div className={tableCard}>
        <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
            Gainers Scan — Day 1 Setup
          </h2>
          <span className={`text-[10px] font-medium ${isRealtime ? 'text-emerald-500' : 'text-yellow-500'}`}>
            {isRealtime ? 'LIVE' : '15-MIN DELAY'}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-full table-fixed">
            <colgroup>
              <col className="w-[90px]" />
              <col className="w-[90px]" />
              <col className="w-[90px]" />
              <col className="w-[110px]" />
              <col className="w-[110px]" />
              <col className="w-[110px]" />
              <col className="w-[80px]" />
              <col className="w-[70px]" />
              <col className="w-[80px]" />
              <col className="w-[70px]" />
            </colgroup>
            <thead>
              <tr className={headerRow}>
                <TH>Ticker</TH>
                <TH right>PDC</TH>
                <TH right>Mark</TH>
                <TH right>Mark % Chg</TH>
                <TH right>Volume</TH>
                <TH right>Cash on Hand</TH>
                <TH right>Has ATM</TH>
                <TH right>Has EL</TH>
                <TH right>Has Warrants</TH>
                <TH right>Has S1</TH>
              </tr>
            </thead>
            <tbody>
              {gainers.map((g) => {
                // PDC = Mark / (1 + change/100), rounded to 3 decimals
                const pdc = g.price / (1 + g.change / 100);
                const summary = summaries[g.ticker];
                return (
                  <tr
                    key={g.ticker}
                    className={bodyRow}
                    onClick={() => onNavigateToResearch(g.ticker)}
                    title={`Open ${g.ticker} in Research`}
                  >
                    <TD>
                      <span className="font-bold text-zinc-100">{g.ticker}</span>
                    </TD>
                    <TD right>${pdc.toFixed(3)}</TD>
                    <TD right>${g.price.toFixed(3)}</TD>
                    <TD right>
                      <span className={g.change >= 0 ? 'text-emerald-400' : 'text-rose-500'}>
                        {g.change >= 0 ? '+' : ''}{g.change.toFixed(2)}%
                      </span>
                    </TD>
                    <TD right>{fmtVolume(g.volume)}</TD>
                    <TD right>
                      {summary ? fmtCash(summary.cashOnHand) : <span className="text-zinc-600">...</span>}
                    </TD>
                    <TD right>
                      {summary ? <BoolCell value={summary.hasAtm} /> : <span className="text-zinc-600">...</span>}
                    </TD>
                    <TD right>
                      {summary ? <BoolCell value={summary.hasEl} /> : <span className="text-zinc-600">...</span>}
                    </TD>
                    <TD right>
                      {summary ? <BoolCell value={summary.hasWarrants} /> : <span className="text-zinc-600">...</span>}
                    </TD>
                    <TD right>
                      {summary ? <BoolCell value={summary.hasS1} /> : <span className="text-zinc-600">...</span>}
                    </TD>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Table 2: Potential MDR Setup ── */}
      <div className={tableCard}>
        <div className="border-b border-white/5 px-4 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
            Potential MDR Setup
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-full table-fixed">
            <colgroup>
              <col className="w-[90px]" />
              <col className="w-[90px]" />
              <col className="w-[90px]" />
              <col className="w-[110px]" />
              <col className="w-[140px]" />
              <col className="w-[140px]" />
              <col className="w-[140px]" />
            </colgroup>
            <thead>
              <tr className={headerRow}>
                <TH>Ticker</TH>
                <TH right>PDC</TH>
                <TH right>Mark</TH>
                <TH right>Mark % Chg</TH>
                <TH right>PM Price Needed</TH>
                <TH right>Opening Gap Needed</TH>
                <TH right>Intraday Price Needed</TH>
              </tr>
            </thead>
            <tbody>
              {gainers.map((g) => {
                const pdc = g.price / (1 + g.change / 100);
                return (
                  <tr
                    key={g.ticker}
                    className={bodyRow}
                    onClick={() => onNavigateToResearch(g.ticker)}
                    title={`Open ${g.ticker} in Research`}
                  >
                    <TD>
                      <span className="font-bold text-zinc-100">{g.ticker}</span>
                    </TD>
                    <TD right>${pdc.toFixed(3)}</TD>
                    <TD right>${g.price.toFixed(3)}</TD>
                    <TD right>
                      <span className={g.change >= 0 ? 'text-emerald-400' : 'text-rose-500'}>
                        {g.change >= 0 ? '+' : ''}{g.change.toFixed(2)}%
                      </span>
                    </TD>
                    {/* TODO: MDR threshold formulas plug in here (next sprint) */}
                    <TD right className="text-zinc-600">—</TD>
                    <TD right className="text-zinc-600">—</TD>
                    <TD right className="text-zinc-600">—</TD>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
```

**Acceptance criteria:**
- [ ] Component file created at `components/trading/DashboardScannerTable.tsx`
- [ ] Gainers fetched from `/api/tradingview/gainers`, polled every 10 seconds
- [ ] Scanner summaries fetched once per ticker per mount from `/api/askedgar/scanner-summary`
- [ ] SEC summary cells show `...` while loading, populated values after fetch
- [ ] PDC computed as `price / (1 + change / 100)` rounded to 3 decimal places in display
- [ ] Mark % Change colored green (emerald-400) if >= 0, red (rose-500) if negative
- [ ] Has-* columns render colored Y/N
- [ ] MDR threshold columns render `—` with a TODO comment
- [ ] Clicking any row calls `onNavigateToResearch(ticker)`
- [ ] No new npm dependencies introduced

---

### Change 6 — Dashboard rebuild

**File:** `components/trading/DashboardTab.tsx`
**Action:** MODIFY (full replacement)

The current file is 212 lines and imports many things no longer needed. Replace the entire file contents:

```typescript
'use client';

import { motion } from 'motion/react';
import DashboardScannerTable from '@/components/trading/DashboardScannerTable';

interface DashboardTabProps {
  onNavigateToResearch: (ticker: string) => void;
}

export default function DashboardTab({ onNavigateToResearch }: DashboardTabProps) {
  return (
    <motion.div
      key="dashboard"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-6"
    >
      <DashboardScannerTable onNavigateToResearch={onNavigateToResearch} />
    </motion.div>
  );
}
```

**Acceptance criteria:**
- [ ] `DashboardTab` accepts only `onNavigateToResearch: (ticker: string) => void`
- [ ] No imports of `PerformanceCharts`, `TradeTable`, `TradingCalendar`, `WeeklyCalendar`, `KPI cards`, or `useMemo`/`useState` beyond what's needed
- [ ] Renders `DashboardScannerTable` with the callback passed through
- [ ] `npx tsc --noEmit` passes

---

### Change 7 — Performance tab: add top section, Net/Gross toggle, remove panels, fix PerformanceCharts prop

**File:** `components/trading/PerformanceTab.tsx`
**Action:** MODIFY (full replacement)

The current file is 123 lines. Replace the entire file contents with the following. The KPI JSX is copied verbatim from the blocks in DashboardTab (old lines 119–180). The `useMemo` stats computation is copied verbatim from DashboardTab (old lines 49–89) and made to use `filteredTrades` (the same trades array Performance already receives).

```typescript
'use client';

import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import PerformanceCharts from '@/components/trading/PerformanceCharts';
import PerformanceStatsTable from '@/components/trading/PerformanceStatsTable';
import TagFilterDropdown from '@/components/trading/TagFilterDropdown';
import { formatCurrency, getPnLColor } from '@/lib/trading-utils';
import type { Trade } from '@/lib/types';

interface PerformanceTabProps {
  filteredTrades: Trade[];
  globalTags: string[];
  performanceMetric: '$' | 'R';
  onMetricChange: (metric: '$' | 'R') => void;
  onTradeClick: (trade: Trade) => void;
}

export default function PerformanceTab({
  filteredTrades,
  globalTags,
  performanceMetric,
  onMetricChange,
  onTradeClick,
}: PerformanceTabProps) {
  const [selectedTagFilters, setSelectedTagFilters] = useState<Set<string>>(new Set());
  const [pnlMode, setPnlMode] = useState<'gross' | 'net'>('net');

  const performanceTrades = useMemo(() => {
    if (selectedTagFilters.size === 0) return filteredTrades;
    return filteredTrades.filter((trade) => (trade.tags ?? []).some((tag) => selectedTagFilters.has(tag)));
  }, [filteredTrades, selectedTagFilters]);

  // KPI stats — mirrors DashboardTab computation, applied to performanceTrades
  const stats = useMemo(() => {
    const pnlFor = (trade: Trade) => (pnlMode === 'gross' ? trade.grossPnl : trade.netPnl);
    const pnlValues = performanceTrades.map((trade) => pnlFor(trade));
    const totalPnl = pnlValues.reduce((sum, value) => sum + value, 0);
    const winningTrades = performanceTrades.filter((trade) => pnlFor(trade) > 0);
    const losingTrades = performanceTrades.filter((trade) => pnlFor(trade) < 0);
    const winRate = performanceTrades.length > 0 ? (winningTrades.length / performanceTrades.length) * 100 : 0;

    const wins = winningTrades.reduce((sum, trade) => sum + pnlFor(trade), 0);
    const losses = Math.abs(losingTrades.reduce((sum, trade) => sum + pnlFor(trade), 0));
    const profitFactor = losses === 0 ? (wins > 0 ? Infinity : 0) : wins / losses;

    const mfeValues = performanceTrades.map((trade) => trade.mfe).filter((value): value is number => typeof value === 'number');
    const maeValues = performanceTrades.map((trade) => trade.mae).filter((value): value is number => typeof value === 'number');
    const exitEffValues = performanceTrades
      .map((trade) => trade.exitEfficiency)
      .filter((value): value is number => typeof value === 'number');

    const averageMfe = mfeValues.length > 0 ? mfeValues.reduce((sum, value) => sum + value, 0) / mfeValues.length : null;
    const averageMae = maeValues.length > 0 ? maeValues.reduce((sum, value) => sum + value, 0) / maeValues.length : null;
    const averageExitEfficiency =
      exitEffValues.length > 0 ? exitEffValues.reduce((sum, value) => sum + value, 0) / exitEffValues.length : null;

    const largestWin = performanceTrades
      .map((trade) => ({ symbol: trade.symbol, value: pnlFor(trade) }))
      .sort((a, b) => b.value - a.value)[0] ?? null;
    const largestLoss = performanceTrades
      .map((trade) => ({ symbol: trade.symbol, value: pnlFor(trade) }))
      .sort((a, b) => a.value - b.value)[0] ?? null;

    return { totalPnl, winRate, profitFactor, averageMfe, averageMae, averageExitEfficiency, largestWin, largestLoss };
  }, [performanceTrades, pnlMode]);

  const fmtCurrency = (value: number | null) =>
    value == null ? '-' : value.toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
  const fmtPct = (value: number | null) => (value == null ? '-' : `${(value * 100).toFixed(1)}%`);

  return (
    <motion.div key="performance" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">

      {/* ── Net/Gross + KPI cards (moved from Dashboard) ── */}
      <div className="flex flex-wrap items-center justify-between">
        <p className="text-sm text-zinc-400">Detailed breakdowns of performance metrics.</p>
        <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 p-1">
          <button
            onClick={() => setPnlMode('net')}
            className={`rounded-md px-3 py-1 text-xs font-medium ${pnlMode === 'net' ? 'bg-emerald-500 text-black' : 'text-zinc-500 hover:text-white'}`}
          >
            Net PnL
          </button>
          <button
            onClick={() => setPnlMode('gross')}
            className={`rounded-md px-3 py-1 text-xs font-medium ${pnlMode === 'gross' ? 'bg-emerald-500 text-black' : 'text-zinc-500 hover:text-white'}`}
          >
            Gross PnL
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <div className="rounded-xl border border-white/10 bg-[#121214] p-6">
          <div className="mb-2 text-xs font-mono uppercase tracking-wider text-zinc-500">Total {pnlMode === 'net' ? 'Net' : 'Gross'} PnL</div>
          <div className={`text-3xl font-bold tracking-tight tabular-nums ${getPnLColor(stats.totalPnl)}`}>
            {fmtCurrency(stats.totalPnl)}
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-[#121214] p-6">
          <div className="mb-2 text-xs font-mono uppercase tracking-wider text-zinc-500">Win Rate</div>
          <div className="text-3xl font-bold tracking-tight tabular-nums">{stats.winRate.toFixed(1)}%</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-[#121214] p-6">
          <div className="mb-2 text-xs font-mono uppercase tracking-wider text-zinc-500">Profit Factor</div>
          <div className="text-3xl font-bold tracking-tight tabular-nums">
            {Number.isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : '∞'}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-white/10 bg-[#121214] p-5">
          <p className="text-xs font-mono uppercase tracking-wider text-zinc-500">Average MFE</p>
          <p className="mt-2 text-xl font-semibold tabular-nums">{fmtCurrency(stats.averageMfe)}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-[#121214] p-5">
          <p className="text-xs font-mono uppercase tracking-wider text-zinc-500">Average MAE</p>
          <p className="mt-2 text-xl font-semibold tabular-nums">{fmtCurrency(stats.averageMae)}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-[#121214] p-5">
          <p className="text-xs font-mono uppercase tracking-wider text-zinc-500">Average Exit Efficiency</p>
          <p className="mt-2 text-xl font-semibold tabular-nums">{fmtPct(stats.averageExitEfficiency)}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-[#121214] p-5">
          <p className="text-xs font-mono uppercase tracking-wider text-zinc-500">Largest Win / Loss</p>
          <div className="mt-2 space-y-1 text-sm">
            <p className="text-emerald-500">
              {stats.largestWin ? `${stats.largestWin.symbol} ${fmtCurrency(stats.largestWin.value)}` : '-'}
            </p>
            <p className="text-rose-500">
              {stats.largestLoss ? `${stats.largestLoss.symbol} ${fmtCurrency(stats.largestLoss.value)}` : '-'}
            </p>
          </div>
        </div>
      </div>

      {/* ── $/R toggle ── */}
      <div className="flex flex-wrap items-center justify-between">
        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 p-1">
          <button
            onClick={() => onMetricChange('$')}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${performanceMetric === '$' ? 'bg-emerald-500 text-black' : 'text-zinc-500 hover:text-white'}`}
          >
            $ Metrics
          </button>
          <button
            onClick={() => onMetricChange('R')}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${performanceMetric === 'R' ? 'bg-emerald-500 text-black' : 'text-zinc-500 hover:text-white'}`}
          >
            R Metrics
          </button>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs font-mono uppercase tracking-wider text-zinc-500">Tag Filter</span>
          <TagFilterDropdown
            globalTags={globalTags}
            selectedTags={selectedTagFilters}
            onToggleTag={(tag) => {
              setSelectedTagFilters((prev) => {
                const next = new Set(prev);
                if (next.has(tag)) next.delete(tag);
                else next.add(tag);
                return next;
              });
            }}
            onClearTags={() => setSelectedTagFilters(new Set())}
          />
        </div>
      </div>

      <PerformanceCharts trades={performanceTrades} metric={performanceMetric} pnlMode={pnlMode} />
      <PerformanceStatsTable trades={performanceTrades} onTradeClick={onTradeClick} />
    </motion.div>
  );
}
```

**Acceptance criteria:**
- [ ] Net/Gross toggle (`pnlMode`) renders above the KPI cards
- [ ] 3-card KPI grid (Total PnL, Win Rate, Profit Factor) renders
- [ ] 4-card secondary grid (Avg MFE, Avg MAE, Avg Exit Efficiency, Largest Win/Loss) renders
- [ ] $/R toggle renders below the secondary grid
- [ ] `PerformanceCharts` receives `pnlMode` prop
- [ ] Symbol Distribution panel is gone
- [ ] Risk Summary panel is gone (its metrics move to PerformanceStatsTable in the next step)
- [ ] `getPnLColor` imported from `@/lib/trading-utils` (verify it exists there — it was already used in DashboardTab line 11)
- [ ] `npx tsc --noEmit` passes

---

### Change 8 — PerformanceStatsTable: fill the two empty cells with Risk Summary metrics

**File:** `components/trading/PerformanceStatsTable.tsx`
**Action:** MODIFY

**Steps:**

The two empty cells are at lines 278–279 in the `cells` array:
```
{ label: '', value: '' },
{ label: '', value: '' },
```

These are the 29th and 30th cells (indices 28 and 29, the last two cells in the 30-cell grid displayed in a 10-row × 3-column layout). The two Risk Summary metrics from the deleted PerformanceTab panel are:

- "Avg Risk per Trade" — computed as: `performanceTrades.filter(t => t.initialRisk).reduce((acc, t) => acc + (t.initialRisk || 0), 0) / (performanceTrades.filter(t => t.initialRisk).length || 1)`. Formatted as `formatCurrency(value)`. Always $ regardless of $/R toggle.
- "Total R-Multiple" — computed as: `performanceTrades.filter(t => t.initialRisk).reduce((acc, t) => acc + t.netPnl / (t.initialRisk || 1), 0).toFixed(2) + 'R'`. Always R regardless of $/R toggle.

1. Replace lines 278–279 (the two `{ label: '', value: '' }` cells) with:

```typescript
      {
        label: 'Avg Risk per Trade',
        value: (() => {
          const riskedTrades = trades.filter((trade) => trade.initialRisk);
          if (riskedTrades.length === 0) return '-';
          const avg = riskedTrades.reduce((acc, trade) => acc + (trade.initialRisk ?? 0), 0) / riskedTrades.length;
          return formatCurrency(avg);
        })(),
      },
      {
        label: 'Total R-Multiple',
        value: (() => {
          const riskedTrades = trades.filter((trade) => trade.initialRisk);
          if (riskedTrades.length === 0) return '-';
          const total = riskedTrades.reduce((acc, trade) => acc + trade.netPnl / (trade.initialRisk ?? 1), 0);
          return `${total.toFixed(2)}R`;
        })(),
      },
```

**Acceptance criteria:**
- [ ] "Avg Risk per Trade" label appears in the stats table with a `$` currency value
- [ ] "Total R-Multiple" label appears with a value formatted as `X.XXR`
- [ ] Both cells render in the last row of the stats grid (row 10, cells 1 and 2)
- [ ] Values are computed from `trades` (the prop) — not affected by any toggle
- [ ] `formatCurrency` is already imported in this file (line 5 — confirmed)
- [ ] `npx tsc --noEmit` passes

---

### Change 9 — ResearchTab: remove gainers list, accept pending ticker prop, collapse layout

**File:** `components/trading/ResearchTab.tsx`
**Action:** MODIFY (full replacement)

```typescript
'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';

import ResearchTickerView from '@/components/trading/ResearchTickerView';

interface ResearchTabProps {
  pendingResearchTicker: string | null;
  onClearPendingTicker: () => void;
}

export default function ResearchTab({ pendingResearchTicker, onClearPendingTicker }: ResearchTabProps) {
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [tickerInput, setTickerInput] = useState('');
  const [companyName, setCompanyName] = useState<string | null>(null);

  // When the Dashboard scanner sends a ticker, pre-select it and clear the slot
  useEffect(() => {
    if (!pendingResearchTicker) return;
    setSelectedTicker(pendingResearchTicker);
    setCompanyName(null);
    onClearPendingTicker();
  }, [pendingResearchTicker, onClearPendingTicker]);

  const handleCompanyName = useCallback((name: string | null) => {
    setCompanyName(name);
  }, []);

  const handleTickerSubmit = () => {
    const ticker = tickerInput.trim().toUpperCase();
    if (ticker) {
      setSelectedTicker(ticker);
      setCompanyName(null);
      setTickerInput('');
    }
  };

  return (
    <motion.section
      key="research"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="flex flex-col gap-2"
    >
      <div className="flex items-center gap-2 px-1">
        <input
          value={tickerInput}
          onChange={(event) => setTickerInput(event.target.value.toUpperCase())}
          onKeyDown={(event) => {
            if (event.key === 'Enter') handleTickerSubmit();
          }}
          placeholder="Search ticker..."
          className="w-48 rounded-lg border border-white/10 bg-[#121214] px-3 py-1.5 text-sm text-zinc-200 transition-colors focus:border-emerald-500/50 focus:outline-none"
        />
        <span className="text-sm text-zinc-200">
          {selectedTicker
            ? companyName === null
              ? `Loading ${selectedTicker}...`
              : companyName || selectedTicker
            : 'Search a ticker above'}
        </span>
      </div>

      <div className="h-[calc(100vh-120px)] overflow-y-auto rounded-lg border border-white/10 bg-[#121214]">
        {selectedTicker ? (
          <ResearchTickerView ticker={selectedTicker} onCompanyName={handleCompanyName} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-zinc-500">
            Search a ticker above or click a row in the Scanner
          </div>
        )}
      </div>
    </motion.section>
  );
}
```

**Acceptance criteria:**
- [ ] `ResearchGainersList` is no longer imported or rendered
- [ ] The component file `components/trading/ResearchGainersList.tsx` is NOT deleted
- [ ] Layout is single-column: search input on top, ticker view below
- [ ] When `pendingResearchTicker` is non-null on mount or change, `selectedTicker` is set to that value and `onClearPendingTicker()` is called
- [ ] Search bar and `ResearchTickerView` still work as before
- [ ] `npx tsc --noEmit` passes

---

### Change 10 — Test: `__tests__/scanner-summary-route.test.ts`

**File:** `__tests__/scanner-summary-route.test.ts`
**Action:** CREATE

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireUserMock,
  getCachedScannerSummaryMock,
} = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  getCachedScannerSummaryMock: vi.fn(),
}));

vi.mock('@/lib/server-db-utils', () => ({
  requireUser: requireUserMock,
}));

vi.mock('@/lib/askedgar', () => ({
  getCachedScannerSummary: getCachedScannerSummaryMock,
}));

import { GET } from '@/app/api/askedgar/scanner-summary/route';

function makeRequest(ticker?: string): Request {
  const url = ticker
    ? `http://localhost/api/askedgar/scanner-summary?ticker=${encodeURIComponent(ticker)}`
    : 'http://localhost/api/askedgar/scanner-summary';
  return new Request(url);
}

function authedUser() {
  requireUserMock.mockResolvedValue({
    user: { id: 'user-1', email: 'test@example.com', name: 'Test', picture: null },
  });
}

describe('GET /api/askedgar/scanner-summary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    requireUserMock.mockResolvedValue({ error: Response.json({ error: 'Unauthorized' }, { status: 401 }) });
    const res = await GET(makeRequest('AAPL'));
    expect(res.status).toBe(401);
  });

  it('returns 400 when ticker param is missing', async () => {
    authedUser();
    const res = await GET(makeRequest());
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Validation failed');
  });

  it('returns 400 when ticker is invalid', async () => {
    authedUser();
    const res = await GET(makeRequest('this is bad!!'));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Validation failed');
  });

  it('returns scanner summary for a valid ticker', async () => {
    authedUser();
    const mockSummary = {
      ticker: 'ACME',
      cashOnHand: 5_000_000,
      hasAtm: true,
      hasEl: false,
      hasWarrants: true,
      hasS1: false,
      fetchedAt: '2026-04-30T00:00:00.000Z',
    };
    getCachedScannerSummaryMock.mockResolvedValue(mockSummary);

    const res = await GET(makeRequest('acme')); // lowercase — should normalize
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(getCachedScannerSummaryMock).toHaveBeenCalledWith('ACME');
    expect(body).toEqual(mockSummary);
  });

  it('returns 500 when getCachedScannerSummary throws', async () => {
    authedUser();
    getCachedScannerSummaryMock.mockRejectedValue(new Error('DB down'));
    const res = await GET(makeRequest('AAPL'));
    expect(res.status).toBe(500);
  });
});
```

**Acceptance criteria:**
- [ ] All 5 test cases pass (`npm test -- __tests__/scanner-summary-route.test.ts`)
- [ ] Mocking pattern matches existing AskEdgar route tests (vi.hoisted, vi.mock)

---

## Files Changed Summary

| File | Action | Est. lines added / removed | Risk |
|------|--------|---------------------------|------|
| `lib/askedgar.ts` | MODIFY (append) | +90 added / 0 removed | LOW |
| `app/api/askedgar/scanner-summary/route.ts` | CREATE | +40 | LOW |
| `app/page.tsx` | MODIFY | +8 added / ~20 removed (old Dashboard props) | MED |
| `components/trading/Toolbar.tsx` | MODIFY | +4 added / 0 removed | LOW |
| `components/trading/DashboardScannerTable.tsx` | CREATE | +220 | MED |
| `components/trading/DashboardTab.tsx` | MODIFY (replace) | +18 added / ~194 removed | MED |
| `components/trading/PerformanceTab.tsx` | MODIFY (replace) | +140 added / ~83 removed | MED |
| `components/trading/PerformanceStatsTable.tsx` | MODIFY | +20 added / 2 removed | LOW |
| `components/trading/ResearchTab.tsx` | MODIFY (replace) | +60 added / ~62 removed | MED |
| `__tests__/scanner-summary-route.test.ts` | CREATE | +75 | LOW |

---

## Order of Operations

1. `lib/askedgar.ts` — append `getCachedScannerSummary` and supporting code. Run `npx tsc --noEmit` after.
2. `app/api/askedgar/scanner-summary/route.ts` — create the route. Run `npx tsc --noEmit` after.
3. `__tests__/scanner-summary-route.test.ts` — create the test. Run `npm test -- __tests__/scanner-summary-route.test.ts` to verify.
4. `components/trading/DashboardScannerTable.tsx` — create the new scanner component.
5. `components/trading/DashboardTab.tsx` — replace with minimal wrapper.
6. `components/trading/PerformanceTab.tsx` — replace with new version including top section.
7. `components/trading/PerformanceStatsTable.tsx` — fill the two empty cells.
8. `components/trading/ResearchTab.tsx` — replace with single-column layout.
9. `components/trading/Toolbar.tsx` — add `activeTab` prop and conditional rendering.
10. `app/page.tsx` — add `pendingResearchTicker` state, update Toolbar/DashboardTab/ResearchTab call sites.
11. Run full validation suite.

---

## Verification Steps

### Commands

```bash
npm run lint
npx tsc --noEmit
npm test
```

All three must pass with 0 errors.

### Manual UI checks

1. **Dashboard tab** — loads two tables (Gainers Scan on top, Potential MDR Setup below). No KPI cards, no WeeklyCalendar, no TradeTable.
2. **Dashboard — Gainers Scan columns** — Ticker (left, bold), PDC (3 decimals), Mark (3 decimals), Mark % Change (green if positive / red if negative), Volume (M/K suffixed), Cash on Hand ($XM / $XB), Has ATM, Has EL, Has Warrants, Has S1 (colored Y/N). SEC summary cells show `...` while loading.
3. **Dashboard — PDC** — verify: if Mark is $2.00 and change is +100%, PDC = 2.00 / 2.0 = $1.000. Confirm calculation correct in browser console.
4. **Dashboard — MDR table** — same tickers, same PDC/Mark/Mark%Chg, last three threshold columns show `—`.
5. **Dashboard — row click** — click any row → Research tab opens with that ticker pre-selected and its data loaded. Search input is empty (ticker populated via state, not input).
6. **Dashboard — Toolbar** — date filter buttons (All / 30D / 60D / 90D) and the calendar date inputs are NOT visible.
7. **Performance tab** — top of page shows: Net/Gross toggle → 3 KPI cards → 4 secondary metric cards → $/R toggle + tag filter → PerformanceCharts → PerformanceStatsTable. No Symbol Distribution panel. No Risk Summary panel.
8. **Performance — Net/Gross toggle** — switching between Net and Gross updates all KPI card values and the charts.
9. **Performance — PerformanceStatsTable** — scroll to last row. "Avg Risk per Trade" and "Total R-Multiple" are in the last two cells (not blank).
10. **Performance — Toolbar** — date filter buttons and calendar inputs ARE visible.
11. **Research tab** — layout is single-column: search input row on top, ticker view below. No left-side gainers list panel. Placeholder text: "Search a ticker above or click a row in the Scanner."
12. **Research — search bar** — typing a ticker and pressing Enter still loads the ticker view correctly.
13. **Journal, Trades, Backtesting, Archive tabs** — Toolbar date filter is still visible on all of these.

---

## Security Considerations

- The new `/api/askedgar/scanner-summary` route is guarded by `requireUser()`. No unauthenticated access.
- `ticker` is validated against `TICKER_REGEX` (`/^[A-Z0-9.\-^]{1,10}$/`) before passing to `getCachedScannerSummary`. No injection vector.
- The cache key is `scanner-summary-{TICKER}` in the shared `askedgar_cache` table — same pattern as `ticker-{TICKER}`. No user-scoped data stored.
- `ASKEDGAR_API_KEY` stays server-side only; the new helper is called exclusively from the server route.

## Rollback Plan

All changes are additive or self-contained replacements. Git revert of this commit restores previous behavior. The `askedgar_cache` table gains new rows with `cacheType = 'scanner-summary'` — these can be ignored without cleanup (TTL expiration handles them automatically). No schema migrations were added.

## Complexity Estimate

**HIGH** — 10 files touched, 1 new API route, 1 new component (220 lines), 3 full component replacements, state threading through `app/page.tsx`. However each individual change is low-risk and narrowly scoped. Estimated wall-clock time: 2–3 hours for Codex including lint/typecheck cycles.

---

## Open Blockers / Follow-Ups

- **Backtesting drawings still don't render (2026-04-28).** Refactor work captured the `armedAction`/`onArmedClick`/`onAnchorChange` callbacks in refs and memoized `handleArmedClick`; execution arrows + stop line render fine, but user-drawn trendlines/horizontals/rectangles still don't appear. Suspect canvas overlay sizing (parent `clientWidth/Height` is 0 on first mount) or pointer-events stealing clicks before `chart.subscribeClick` fires. Investigate by adding console logs in `ChartDrawings.tsx:212` (handleClick), `ChartDrawings.tsx:289` (handleCrosshairMove), `ChartDrawings.tsx:405` (renderDrawings) and inspecting the canvas DOM rect in DevTools.
- **AskEdgar Sprint 3 Part B (`split-status`) — PARKED.** Researched + planned 2026-04-29; full design captured in auto-memory `project_split_status_research.md`. Pending endpoint-usage audit before commit. Reusable artifacts: state machine design (4 states), source precedence, section-locator approach for DEF 14A.
- **Endpoint review pending (2026-04-29).** Future scrutiny: `screener`, `ownership`, `nasdaq-compliance`; `historical-float-pro`, `float-outstanding` (review payload). `split-status` parked separately.
- **Sprint 4 — `screener` removal deferred.** Per-ticker `/v1/screener` feeds 9 header fields (`marketCap`, `outstandingShares`, `float`, `exchange`, `ipoDate`, `industry`, `country`, `shortInterest`, `volume`) in `normalizeAskEdgarResponse` (`lib/askedgar.ts:972-986`). Removing without a replacement breaks the Research card header. `getCachedGainers` / `fetchTopGainers` use the same `/v1/screener` endpoint with different params and stay independent. Plan a header-fields replacement (companyfacts gives shares-out, market cap needs price * shares, exchange/industry possibly from `sec_ticker_cik`) before removing.
- **Filings v2 (deferred) — in-app viewer.** AskEdgar-style filing reader (iframe of the SEC primary document with Exhibits sidebar from `<accession>/index.json`, browser-native Ctrl+F inside the iframe). ~1-2 days. Defer until we have user feedback on the click-out flow.
- **Filings v3 (deferred) — full-text search + AI Copilot.** "Search in Documents" across all filings for a ticker requires Postgres `tsvector` ingestion or external index. AI Copilot panel (Summarize / Key Points / Catalysts) plumbs into existing agent infra. Cost analysis required first.
- **Auto stop-out for Backtesting (deferred).** When intraday bar prints through a stop, simulator should auto-execute SELL/COVER. Schema supports it. UI: settings toggle defaulting OFF for parity. Add when user requests.
- **Sprint 4 follow-up — extended `OfferingType` union.** v1 intentionally excludes DEBT OFFERING / DEBT CONVERSION / CREDIT FACILITY / SHARE ISSUANCE FOR ACQUISITION / UPLIST. Add if real filings exercise them. Revisit if blueprints start filtering by type.
- **AskEdgar paid API key.** `https://eapi.askedgar.io` remains the correct base URL. Only swap `ASKEDGAR_API_KEY` env var; do not touch `ASKEDGAR_BASE_URL`.
- **Cost-per-report baseline.** Sprint 1 dropped `filing-titles`, Sprint 2 dropped `historical-float-pro`, Sprint 3 Part A dropped `reverse-splits`, Sprint 4 drops `offerings` + `pump-and-dump-tracker` from AskEdgar fan-out. Track via `[askedgar-fanout]` log's `costUsd` token.

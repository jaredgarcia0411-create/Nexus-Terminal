# Nexus Terminal — HANDOFF.md

## Active Handoff Only

Historical completed sections removed — use git history and `specs/` for archived detail.

### Session Maintenance Checklist

- [x] Review `AGENTIC_EXPANSIONV2.md` and replace `AEV2_REVISIONS.md` with a literal pre-sprint edit script for the next spec pass
- [x] Apply `AEV2_REVISIONS.md` to `AGENTIC_EXPANSIONV2.md` and rename the spec file from `AGENTIC_EXPANSION_V2.md`
- [x] Run the post-patch cleanup sweep on `AGENTIC_EXPANSIONV2.md`
- [x] Refresh `AEV2_REVISIONS.md` with sprint-board blockers, launch blockers, and locked routing/service-route decisions from the latest review
- [x] Convert `AEV2_REVISIONS.md` from redline checklist into a literal section-by-section patch plan for the next spec pass
- [x] **Execute R6 consolidation pass on AGENTIC_EXPANSIONV2.md** (this handoff)
- [x] Draft a tight pre-sprint blocker patch checklist in `HANDOFF.md` from the latest AGENTIC_EXPANSIONV2 review
- [x] Expand the blocker checklist into an exact section-by-section patch plan with replacement targets
- [x] Execute the pre-sprint blocker patch plan on `AGENTIC_EXPANSIONV2.md`
- [x] Draft `AEV2_DRAFT.md` with initiative/epic/story/sprint breakdown for `AGENTIC_EXPANSIONV2.md`

---

# Build Spec — Codebase Cleanup

> Generated: 2026-04-03 | Status: READY TO EXECUTE
> Pure refactor — no behavior changes, no new user-visible features.
> Items grouped by risk and dependency order.

## Execution Order

```
Group 1 (parallel): Steps 1-5  → validate → STOP & COMMIT
Group 2 (parallel): Steps 6-10 → validate → STOP & COMMIT
Group 3 (sequenced): Step 11 → Step 12 (12a→12b→12c→12d→12e→12f) → validate → STOP & COMMIT
Step 13: HANDOFF.md cleanup
```

---

## Group 1: Quick Wins

**Status:** complete

Delivered:
- Memoized `PerformanceTab` symbol distribution so the aggregation no longer runs inline on every render.
- Removed dead `RESEARCH_SCHEMA` / `buildResearchPrompt` from `lib/jarvis/prompts.ts`.
- Moved pure trade helpers from `hooks/trade-utils.ts` to `lib/trade-utils.ts` and updated imports.
- Removed obsolete trade migration / DB-availability fallback code and deleted `lib/trade-migration.ts`, `lib/storage.ts`, and `__tests__/trade-migration.test.ts`.
- Verified the old unchecked `Update AGENTS.md` item is not present.
- Updated `__tests__/markets-tab.test.tsx` to match the current Markets tab render during validation.

Validation:
- [x] `npm run lint`
- [x] `npx tsc --noEmit`
- [x] `npm test`

### ⛔ STOP — Commit Group 1 before proceeding to Group 2.

---

## Group 2: Medium Complexity (run in parallel)

### Step 6 — Extract `buildTradeMarkers()` to `lib/trading-utils.ts`

**Background:** Marker-building logic is duplicated in `JournalTradeChart.tsx` (lines 28-73) and `TradeDetailSheet.tsx` (lines 78-120). Both convert a trade's raw executions (or fallback entry/exit times) into `TradeMarker[]` for the candlestick chart.

Key difference between the two implementations:
- `JournalTradeChart`: uses `flatMap` + filters out executions with null timestamps
- `TradeDetailSheet`: uses `.map()` + `timeValue()` helper which returns `0` for null (no filtering)

The extracted function will use the filtering approach (better behavior — `0` timestamps cause markers at Unix epoch).

**Files affected:**
- `lib/types.ts` — MODIFY (add `TradeMarker` interface)
- `components/trading/CandlestickChart.tsx` — MODIFY (import `TradeMarker` from `lib/types`, re-export it)
- `lib/trading-utils.ts` — MODIFY (add `buildTradeMarkers`)
- `components/trading/JournalTradeChart.tsx` — MODIFY (use `buildTradeMarkers`)
- `components/trading/TradeDetailSheet.tsx` — MODIFY (use `buildTradeMarkers`)

**What to do:**

**6a. Find the `TradeMarker` type in `CandlestickChart.tsx`.** It should look like:
```ts
export type TradeMarker = {
  time: number;
  direction: 'LONG' | 'SHORT';
  price: number;
  label: string;
};
```
Copy its exact definition.

**6b. Add `TradeMarker` to `lib/types.ts`** at the bottom of the file.

**6c. In `components/trading/CandlestickChart.tsx`:**
- Remove the `TradeMarker` interface/type definition
- Add `import type { TradeMarker } from '@/lib/types';`
- Add `export type { TradeMarker };` so existing importers (`JournalTradeChart`, `TradeDetailSheet`) don't break

**6d. In `lib/trading-utils.ts`,** add these imports at the top:
```ts
import { nyDateTimeToEpoch, parseAbsoluteTimestampMs } from '@/lib/time-utils';
import type { Trade, TradeMarker } from '@/lib/types';
```

Then add at the bottom of the file:
```ts
// Converts a trade's executions (or entry/exit times) into candlestick chart markers.
// Filters out executions whose timestamp cannot be resolved to avoid epoch-time markers.
export function buildTradeMarkers(trade: Trade): TradeMarker[] {
  if (trade.rawExecutions.length > 0) {
    return trade.rawExecutions.flatMap((execution) => {
      const abs = parseAbsoluteTimestampMs(execution.timestamp);
      const time = abs ?? nyDateTimeToEpoch(trade.sortKey, execution.time);
      if (time == null || !Number.isFinite(time)) return [];
      const direction = execution.side === 'ENTRY'
        ? trade.direction
        : trade.direction === 'LONG' ? 'SHORT' : 'LONG';
      return [{ time, direction, price: execution.price, label: execution.side }];
    });
  }

  const markers: TradeMarker[] = [];
  const entry = nyDateTimeToEpoch(trade.sortKey, trade.entryTime);
  const exit = nyDateTimeToEpoch(trade.sortKey, trade.exitTime);
  if (entry != null) {
    markers.push({ time: entry, direction: trade.direction, price: trade.avgEntryPrice, label: 'ENTRY' });
  }
  if (exit != null) {
    markers.push({
      time: exit,
      direction: trade.direction === 'LONG' ? 'SHORT' : 'LONG',
      price: trade.avgExitPrice,
      label: 'EXIT',
    });
  }
  return markers;
}
```

**6e. In `components/trading/JournalTradeChart.tsx`:**
- Add import: `import { buildTradeMarkers } from '@/lib/trading-utils';`
- Remove imports of `nyDateTimeToEpoch` and `parseAbsoluteTimestampMs` from `@/lib/time-utils` if they are no longer used in this file after the change (check the rest of the file first)
- Replace the `useMemo` body (lines 29-72) with:
  ```ts
  const tradeMarkers = useMemo<TradeMarker[]>(() => buildTradeMarkers(trade), [trade]);
  ```

**6f. In `components/trading/TradeDetailSheet.tsx`:**
- Add import: `import { buildTradeMarkers } from '@/lib/trading-utils';`
- The local `timeValue()` function (lines 31-39) is still used by `sortedExecutions` — keep it
- Replace the `tradeMarkers` useMemo body (lines 79-119) with:
  ```ts
  const tradeMarkers = useMemo<TradeMarker[]>(() => {
    if (!trade) return [];
    return buildTradeMarkers(trade);
  }, [trade]);
  ```
  The dependency can be just `[trade]` since `buildTradeMarkers` reads `trade.rawExecutions` directly.

**Acceptance Criteria:**
- [ ] `TradeMarker` is defined in `lib/types.ts` and re-exported from `CandlestickChart.tsx`
- [ ] `buildTradeMarkers` is exported from `lib/trading-utils.ts`
- [ ] `JournalTradeChart.tsx` uses `buildTradeMarkers` — no inline flatMap/marker logic
- [ ] `TradeDetailSheet.tsx` uses `buildTradeMarkers` — no inline marker logic
- [ ] `npx tsc --noEmit` passes

---

### Step 7 — Move duplicated `FRAME_CONFIG` to `lib/chart-timeframes.ts`

**Background:** `FRAME_CONFIG` (timeframe-to-API-params mapping) is defined locally in both `ChartsTab.tsx` (lines 62-72, 9 timeframes) and `ResearchChart.tsx` (lines 19-26, 6 timeframes). The shared type `FrameConfig` is also defined locally in each.

The two configs have different key sets and slightly different key names (`'1d'` in ChartsTab vs `'1D'` in ResearchChart for daily). Export them as separate named configs.

**Files affected:**
- `lib/chart-timeframes.ts` — MODIFY (add exports)
- `components/trading/ChartsTab.tsx` — MODIFY (import, remove local defs)
- `components/trading/ResearchChart.tsx` — MODIFY (import, remove local defs)

**What to do:**

**7a.** In `lib/chart-timeframes.ts`, add at the end of the file:

```ts
export type FrameConfig = {
  label: string;
  periodType: string;
  period: string;
  frequencyType: string;
  frequency: string;
  intraday: boolean;
};

export type ChartsTabTimeframeKey = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w' | '1M';

export const CHARTS_TAB_FRAME_CONFIG: Record<ChartsTabTimeframeKey, FrameConfig> = {
  '1m': { label: '1m', periodType: 'day', period: '5', frequencyType: 'minute', frequency: '1', intraday: true },
  '5m': { label: '5m', periodType: 'day', period: '10', frequencyType: 'minute', frequency: '5', intraday: true },
  '15m': { label: '15m', periodType: 'month', period: '1', frequencyType: 'minute', frequency: '15', intraday: true },
  '30m': { label: '30m', periodType: 'month', period: '2', frequencyType: 'minute', frequency: '30', intraday: true },
  '1h': { label: '1h', periodType: 'month', period: '3', frequencyType: 'minute', frequency: '60', intraday: true },
  '4h': { label: '4h', periodType: 'month', period: '6', frequencyType: 'minute', frequency: '240', intraday: true },
  '1d': { label: '1D', periodType: 'year', period: '2', frequencyType: 'daily', frequency: '1', intraday: false },
  '1w': { label: '1W', periodType: 'year', period: '5', frequencyType: 'weekly', frequency: '1', intraday: false },
  '1M': { label: '1M', periodType: 'year', period: '10', frequencyType: 'monthly', frequency: '1', intraday: false },
};

export type ResearchChartTimeframeKey = '1m' | '5m' | '15m' | '30m' | '1h' | '1D';

export const RESEARCH_CHART_FRAME_CONFIG: Record<ResearchChartTimeframeKey, FrameConfig> = {
  '1m': { label: '1m', periodType: 'day', period: '5', frequencyType: 'minute', frequency: '1', intraday: true },
  '5m': { label: '5m', periodType: 'day', period: '10', frequencyType: 'minute', frequency: '5', intraday: true },
  '15m': { label: '15m', periodType: 'month', period: '1', frequencyType: 'minute', frequency: '15', intraday: true },
  '30m': { label: '30m', periodType: 'month', period: '2', frequencyType: 'minute', frequency: '30', intraday: true },
  '1h': { label: '1h', periodType: 'month', period: '3', frequencyType: 'minute', frequency: '60', intraday: true },
  '1D': { label: '1D', periodType: 'year', period: '2', frequencyType: 'daily', frequency: '1', intraday: false },
};
```

**7b.** In `components/trading/ChartsTab.tsx`:
- Add to existing `lib/chart-timeframes` import: `CHARTS_TAB_FRAME_CONFIG, type ChartsTabTimeframeKey, type FrameConfig`
- Remove local `type FrameConfig` (the type def block at ~line 53-60)
- Remove local `type TimeframeKey` (line 50 — `'1m' | '5m' | ...`)
- Remove local `const FRAME_CONFIG` (lines 62-72)
- Replace all uses of `FRAME_CONFIG` with `CHARTS_TAB_FRAME_CONFIG`
- Replace `TimeframeKey` type annotation with `ChartsTabTimeframeKey`

**7c.** In `components/trading/ResearchChart.tsx`:
- Add import: `import { RESEARCH_CHART_FRAME_CONFIG, type ResearchChartTimeframeKey, type FrameConfig } from '@/lib/chart-timeframes';`
- Remove local `type TimeframeKey` (line 8)
- Remove local `type FrameConfig` (lines 10-17)
- Remove local `const FRAME_CONFIG` (lines 19-26)
- Replace `FRAME_CONFIG` with `RESEARCH_CHART_FRAME_CONFIG`
- Replace `TimeframeKey` with `ResearchChartTimeframeKey`

**Acceptance Criteria:**
- [ ] `lib/chart-timeframes.ts` exports `FrameConfig`, `CHARTS_TAB_FRAME_CONFIG`, `ChartsTabTimeframeKey`, `RESEARCH_CHART_FRAME_CONFIG`, `ResearchChartTimeframeKey`
- [ ] No local `FRAME_CONFIG` or `FrameConfig` in `ChartsTab.tsx` or `ResearchChart.tsx`
- [ ] `npx tsc --noEmit` passes

---

### Step 8 — Fix double `fetchResults` on mount in `hooks/use-scanner.ts`

**Background:** `use-scanner.ts` has two effects that both fire on first render:

Effect A (line 174): fires on mount — calls `fetchResults()` and `fetchPresets()`.
Effect B (line 179): fires when `filters`, `sortBy`, `sortDir`, or `fetchResults` change — also fires on first render since they're initialized.

Result: `fetchResults` is called twice immediately on mount. Effect B should skip its first execution since Effect A already handled it.

**File:** `hooks/use-scanner.ts`
**Action:** MODIFY

**What to do:**

1. After the `sortDirRef` declaration (around line 71), add:
   ```ts
   const hasInitialFetchRef = useRef(false);
   ```

2. Leave Effect A (lines 174-177) unchanged — it handles the initial fetch.

3. Replace Effect B (lines 179-181) with:
   ```ts
   useEffect(() => {
     if (!hasInitialFetchRef.current) {
       hasInitialFetchRef.current = true;
       return;
     }
     void fetchResults();
   }, [filters, sortBy, sortDir, fetchResults]);
   ```

   How this works: on first render, Effect A fires first (declaration order) and Effect B fires second. Effect B sees `hasInitialFetchRef.current === false`, sets it to `true`, and returns without fetching. On all subsequent renders triggered by filter/sort changes, Effect B sees `true` and fetches normally.

**Acceptance Criteria:**
- [ ] `fetchResults` is called once on mount (not twice)
- [ ] Filter/sort changes after mount still trigger `fetchResults`
- [ ] `npx tsc --noEmit` passes

**Note:** The `sortTrades` alias in `use-trade-sync.ts` and `use-trades.ts` (`const sortTrades = sortTradesByDate`) is intentionally left — removing it would be a noisy diff for zero gain.

---

### Step 9 — Break up `app/api/market-data/snapshot/route.ts`

**Background:** The route is 607 lines with three distinct concerns embedded inline:
1. Massive API path: `toInstrument()`, `toMoverRows()`, `fetchFreshSnapshot()` (lines 61-228)
2. Realtime DB path: `getSchwabLinkStatus()`, `fetchRealtimeSnapshot()` (lines 230-330)
3. Route orchestration + cache + logging (lines 330-607)

**Files:**
- `lib/massive-snapshot.ts` — CREATE
- `lib/realtime-snapshot.ts` — CREATE
- `app/api/market-data/snapshot/route.ts` — MODIFY (remove extracted code, import from new files)

**What to do:**

**9a. Create `lib/massive-snapshot.ts`**

Move from `route.ts`:
- Helper functions: `normalizeTicker` (lines 61-63), `normalizeRealtimeSymbol` (65-67), `toNumberOrNull` (69-72), `getNyIsoDate` (74-81), `calculateExtendedChange` (83-92)
- `toInstrument()` (lines 94-177)
- `toMoverRows()` (lines 179-192)
- `fetchFreshSnapshot()` (lines 194-228)

Imports needed:
```ts
import { INDEX_SYMBOLS, COMMODITY_SYMBOLS, EQUITY_SYMBOLS } from '@/lib/market-symbols';
import {
  normalizeQuoteSymbol,
  type MarketInstrument,
  type MarketSnapshotPayload,
} from '@/lib/quote-mappers';
import {
  fetchBatchDailyTickerSummaries,
  fetchTopMarketMovers,
  fetchUnifiedSnapshot,
  getEasternMarketSession,
  normalizeMassiveTicker,
  type EasternMarketSession,
} from '@/lib/massive-market';
```

Export: `fetchFreshSnapshot`, `normalizeTicker` (needed by `lib/realtime-snapshot.ts`)

**9b. Create `lib/realtime-snapshot.ts`**

Move from `route.ts`:
- Module-level `realtimeCache` variable (line 51) and `REALTIME_CACHE_TTL_MS` (line 47), `REALTIME_STALE_MS` (line 45)
- `RealtimeSnapshotResult` type (lines 37-40)
- `getSchwabLinkStatus()` (lines 230-247)
- `fetchRealtimeSnapshot()` (lines 249-330)

Imports needed:
```ts
import { desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { INDEX_SYMBOLS, COMMODITY_SYMBOLS, EQUITY_SYMBOLS } from '@/lib/market-symbols';
import { marketSnapshots, realtimeQuotes, schwabLinks } from '@/lib/db/schema';
import {
  normalizeQuoteSymbol,
  quotesToSnapshot,
  schwabScreenerToMoverRows,
  type MarketMoverRow,
  type MarketSnapshotPayload,
  type SchwabScreenerItem,
} from '@/lib/quote-mappers';
import { getEasternMarketSession } from '@/lib/massive-market';
import { normalizeTicker } from '@/lib/massive-snapshot';
```

The `normalizeRealtimeSymbol` helper uses both `normalizeTicker` and `normalizeQuoteSymbol`. Move it to `lib/realtime-snapshot.ts` as a private helper.

Export: `getSchwabLinkStatus`, `fetchRealtimeSnapshot`, `type RealtimeSnapshotResult`

**9c. Update `app/api/market-data/snapshot/route.ts`**

Remove all extracted code. Add:
```ts
import { fetchFreshSnapshot } from '@/lib/massive-snapshot';
import { getSchwabLinkStatus, fetchRealtimeSnapshot, type RealtimeSnapshotResult } from '@/lib/realtime-snapshot';
```

Remove module-level `realtimeCache` variable — it now lives in `lib/realtime-snapshot.ts`.
Remove constants that moved: `REALTIME_STALE_MS`, `REALTIME_CACHE_TTL_MS`.
Keep: `CACHE_SNAPSHOT_TYPE`, `CACHE_TTL_MS`, `STALE_WARNING_MS`, `SCHWAB_SCREENER_SNAPSHOT_TYPE`, `SnapshotCoverage` type, `PgLikeError` type, `isUndefinedTableError`, `getErrorSummary`, `logSnapshotStage`, `countMissing`, `buildCoverage`, and the `GET` handler.

Target: route under 250 lines.

**Acceptance Criteria:**
- [ ] `lib/massive-snapshot.ts` exists and exports `fetchFreshSnapshot`
- [ ] `lib/realtime-snapshot.ts` exists and exports `fetchRealtimeSnapshot`, `getSchwabLinkStatus`, `RealtimeSnapshotResult`
- [ ] `app/api/market-data/snapshot/route.ts` is under 250 lines
- [ ] Markets tab still loads correctly
- [ ] `npx tsc --noEmit` passes

---

### Step 10 — Merge Jarvis chat + stream routes

**Background:** `app/api/jarvis/chat/route.ts` (93 lines) and `app/api/jarvis/chat/stream/route.ts` (112 lines) share ~60 lines of auth, rate limiting, DB setup, context building, and user-message saving. The stream route is called first by the frontend; if it returns `{ redirect: true }` (for commands), the frontend calls the non-stream route.

**Merge strategy:** Single `POST /api/jarvis/chat` route. Add `?stream=1` query param to trigger streaming. Keep `{ redirect: true }` sentinel for commands in stream mode — frontend logic stays unchanged, just update the URL.

**Files affected:**
- `app/api/jarvis/chat/route.ts` — MODIFY
- `app/api/jarvis/chat/stream/route.ts` — DELETE after merge
- `components/trading/JarvisChat.tsx` — MODIFY (1 line: URL update)
- `.claude/CLAUDE.md` — MODIFY (route count 32 → 31)

**What to do:**

**10a. In `app/api/jarvis/chat/route.ts`:**

Add these imports (currently only in stream route):
```ts
import { callJarvisStreaming } from '@/lib/jarvis/client';
import { createSSEResponse } from '@/lib/sse';
```

Add at file top:
```ts
export const maxDuration = 300;
```

Refactor `POST` handler. Insert a streaming branch after command handlers (which return early), before the non-streaming path:

```ts
// After command handlers, before non-streaming path:
const url = new URL(request.url);
if (url.searchParams.get('stream') === '1') {
  // Commands already returned above — if we're here, it's a regular chat message.
  const prompt = buildChatPrompt(context, message);
  try {
    const { stream } = await callJarvisStreaming(JARVIS_SYSTEM_PROMPT, prompt);
    const reader = stream.getReader();
    return createSSEResponse(request.signal, (send) => {
      let fullText = '';
      let closed = false;
      const closeReader = () => { if (closed) return; closed = true; reader.cancel().catch(() => {}); };
      void (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            fullText += value;
            send('token', { text: value });
          }
          send('done', { fullText, session_id: sessionId });
          await Promise.all([
            saveConversation({ db, userId, sessionId, role: 'assistant', content: fullText, mode: 'chat' }),
            logJarvisRequest({ userId, mode: 'chat', durationMs: Date.now() - startedAt, success: true }),
          ]);
        } catch {
          send('error', { message: 'Stream interrupted' });
          await logJarvisRequest({ userId, mode: 'chat', durationMs: Date.now() - startedAt, success: false });
        }
      })();
      return () => { closeReader(); };
    });
  } catch {
    await logJarvisRequest({ userId, mode: 'chat', durationMs: Date.now() - startedAt, success: false });
    return Response.json({ error: 'Failed to start stream' }, { status: 500 });
  }
}
// Non-streaming path continues below...
```

For commands in stream mode: the command handlers check message content and return early (before the stream branch). So commands always return JSON regardless of `?stream=1`. But the client expects `{ redirect: true }` from the stream endpoint for commands. **Simplest approach:** Move the `?stream=1` check BEFORE command handlers. When `?stream=1` AND a command is detected, return `Response.json({ redirect: true })`. The client then calls `/api/jarvis/chat` (no stream param) for commands — same flow as today, just a unified URL namespace.

**10b. In `components/trading/JarvisChat.tsx`, line 41:**
```ts
// Before:
const response = await fetch('/api/jarvis/chat/stream', {
// After:
const response = await fetch('/api/jarvis/chat?stream=1', {
```

**10c.** Delete `app/api/jarvis/chat/stream/route.ts`.

**10d.** In `.claude/CLAUDE.md`, update route count:
```
# Before: "to list all 32 routes"
# After: "to list all 31 routes"
```

**Security:** Merged route still calls `requireUser()` first. No auth regression.

**Acceptance Criteria:**
- [ ] `app/api/jarvis/chat/stream/route.ts` is deleted
- [ ] `app/api/jarvis/chat/route.ts` handles `?stream=1` (SSE) and normal (JSON) requests
- [ ] `JarvisChat.tsx` calls `/api/jarvis/chat?stream=1` for streaming
- [ ] Commands (`/research`, `/analyze`) still return JSON
- [ ] Streaming chat works end-to-end
- [ ] `npx tsc --noEmit` passes

---

### Group 2 Validation

```bash
npm run lint && npx tsc --noEmit
```

Then manually test: open Jarvis tab, send a chat message (verify streaming), send `/research AAPL` (verify JSON response), send `/analyze` (verify JSON response).

### ⛔ STOP — Commit Group 2 before proceeding to Group 3.

---

## Group 3: AskEdgar (sequenced — Step 11 before Step 12)

### Step 11 — Extract AskEdgar shared helpers to `lib/askedgar-utils.ts`

**Background:** Three components define `AskEdgarEndpointResponse` and `getField()` independently:
- `ResearchReportSections.tsx` (950 lines): defines `AskEdgarEndpointResponse`, `isRecord`, `toRecord`, `toNumberValue`, `formatNumber`, `formatMoney`, `getField`, `riskClass` (lines 5-118)
- `ResearchCompanyHeader.tsx`: defines `AskEdgarEndpointResponse` (lines 3-7), `toRecord` (15-17), `getField` (19-26)
- `ResearchTickerView.tsx`: defines `AskEdgarEndpointResponse` (lines 10-14)

**Files affected:**
- `lib/askedgar-utils.ts` — CREATE
- `components/trading/ResearchReportSections.tsx` — MODIFY
- `components/trading/ResearchCompanyHeader.tsx` — MODIFY
- `components/trading/ResearchTickerView.tsx` — MODIFY

**What to do:**

**11a. Create `lib/askedgar-utils.ts`:**

```ts
// Client-safe utilities for AskEdgar API response handling.
// No server-only imports — safe to use in client components.

export interface AskEdgarEndpointResponse {
  status: string;
  results: unknown[];
  error?: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function toRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export function toNumberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[$,%]/g, '').replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

// Looks up the first non-null, non-empty value among the given keys in a record.
// AskEdgar uses inconsistent snake_case vs camelCase — this handles both.
export function getField(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in record && record[key] !== null && record[key] !== undefined && record[key] !== '') {
      return record[key];
    }
  }
  return null;
}

export function formatNumber(value: unknown): string {
  const numeric = toNumberValue(value);
  return numeric === null ? 'N/A' : numeric.toLocaleString();
}

export function formatMoney(value: unknown): string {
  const numeric = toNumberValue(value);
  if (numeric === null) return 'N/A';
  return `$${numeric.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

// Returns Tailwind CSS classes for a dilution risk rating.
// Low/Compliant/Positive → emerald. Medium/Watch → amber. High/Risk/Non-compliant → rose.
export function riskClass(value: unknown): string {
  const normalized = String(value ?? '').toLowerCase();
  if (normalized.includes('low') || normalized.includes('compliant') || normalized.includes('positive')) {
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  }
  if (normalized.includes('medium') || normalized.includes('watch') || normalized.includes('warning')) {
    return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  }
  if (normalized.includes('high') || normalized.includes('risk') || normalized.includes('non-compliant') || normalized.includes('negative')) {
    return 'border-rose-500/30 bg-rose-500/10 text-rose-300';
  }
  return 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300';
}
```

**11b. In `components/trading/ResearchReportSections.tsx`:**

Add at the top (line 3):
```ts
import {
  AskEdgarEndpointResponse,
  formatMoney,
  formatNumber,
  getField,
  isRecord,
  riskClass,
  toNumberValue,
  toRecord,
} from '@/lib/askedgar-utils';
```

Delete lines 5-9 (`interface AskEdgarEndpointResponse`).
Delete the following function definitions (verify exact lines before deleting):
- `isRecord` (~line 25)
- `toRecord` (~line 29)
- `toStringValue` (~line 33) — check if still used locally. If yes, keep it. If no, delete.
- `toNumberValue` (~line 40)
- `formatNumber` (~line 49)
- `formatMoney` (~line 54)
- `getField` (~line 67)
- `riskClass` (~line 106)

Keep all other local functions: `formatDate`, `detectFormType`, `babyShelfBadge`, `endpoint`, `hasData`, `NoDataBadge`, `isWarrantRow` (if present), and the rest of the component.

**11c. In `components/trading/ResearchCompanyHeader.tsx`:**

Add import (line 1, after `'use client'`):
```ts
import { AskEdgarEndpointResponse, getField, toRecord } from '@/lib/askedgar-utils';
```

Delete lines 3-7 (`interface AskEdgarEndpointResponse`).
Delete lines 15-17 (`toRecord` function).
Delete lines 19-26 (`getField` function).
Keep `formatCompact` — it is unique to this component.

**11d. In `components/trading/ResearchTickerView.tsx`:**

Add import:
```ts
import type { AskEdgarEndpointResponse } from '@/lib/askedgar-utils';
```

Delete lines 10-14 (local `interface AskEdgarEndpointResponse`).
Keep `AskEdgarLookupData` interface — it is specific to this component.

**Acceptance Criteria:**
- [ ] `lib/askedgar-utils.ts` exists with all listed exports
- [ ] `ResearchReportSections.tsx`: no local definitions of `AskEdgarEndpointResponse`, `isRecord`, `toRecord`, `toNumberValue`, `formatNumber`, `formatMoney`, `getField`, `riskClass`
- [ ] `ResearchCompanyHeader.tsx`: no local definitions of `AskEdgarEndpointResponse`, `toRecord`, `getField`
- [ ] `ResearchTickerView.tsx`: imports `AskEdgarEndpointResponse` from `@/lib/askedgar-utils`
- [ ] Research tab renders identically
- [ ] `npx tsc --noEmit` passes

---

### Step 12 — Normalize AskEdgar data server-side (Deferred Item 1)

**Complexity: HIGH. Do not start without completing Step 11 first.**

**Background:** `/api/askedgar/lookup` returns raw AskEdgar data verbatim. All field normalization — `getField(['snake_case', 'camelCase'])` fallbacks, equity line deduplication, warrant classification, baby shelf logic — happens in `ResearchReportSections.tsx` (950 lines). Moving this to the server creates a `ResearchSnapshot` normalized shape and reduces the component to render-only JSX (~600 lines).

**Files:**
- `lib/types.ts` — MODIFY (add `ResearchSnapshot` + sub-types)
- `lib/jarvis/askedgar.ts` — MODIFY (add `normalizeAskEdgarResponse()`)
- `app/api/askedgar/snapshot/route.ts` — CREATE (new endpoint returning normalized shape)
- `components/trading/ResearchTickerView.tsx` — MODIFY (call `/api/askedgar/snapshot`)
- `components/trading/ResearchReportSections.tsx` — MODIFY (receive normalized data, strip transform logic)
- `components/trading/ResearchCompanyHeader.tsx` — MODIFY (receive `header` object instead of `rawData`)
- `.claude/CLAUDE.md` — MODIFY (route count 31 → 32)

**Step 12a — Define `ResearchSnapshot` in `lib/types.ts`**

Add at the bottom of `lib/types.ts`:

```ts
// Normalized server-side shape returned by /api/askedgar/snapshot.
// All field resolution (snake_case/camelCase, equity dedup, warrant classification)
// is done server-side in normalizeAskEdgarResponse().

export interface ResearchSnapshotHeader {
  marketCap: number | null;
  outstandingShares: number | null;
  float: number | null;
  exchange: string | null;
  ipoDate: string | null;
  industry: string | null;
  country: string | null;
}

export interface ResearchSnapshotWarrant {
  details: string;
  amount: number | null;
  remaining: number | null;
  exercisePrice: number | null;
  registered: string | null;
  exercisableDate: string | null;
  expirationDate: string | null;
  filedAt: string | null;
}

export interface ResearchSnapshotRegistration {
  headline: string;
  filedAt: string | null;
  effectiveDate: string | null;
  expirationDate: string | null;
  isEffective: boolean;
  offeringAmount: number | null;
  isAtm: boolean;
  bank: string | null;
  amountRemainingAtm: number | null;
  totalRaised: number | null;
  overBabyShelf: boolean;
  formType: string | null;
}

export interface ResearchSnapshotOffering {
  headline: string;
  filedAt: string | null;
  offeringType: string | null;
  sharesAmount: number | null;
  warrantsAmount: number | null;
  sharePrice: number | null;
  offeringAmount: number | null;
}

export interface ResearchSnapshotNewsItem {
  title: string;
  summary: string;
  filedAt: string | null;
  formType: string | null;
  isNews: boolean;
}

export interface ResearchSnapshot {
  ticker: string;
  fetchedAt: string;
  companyName: string | null;
  warnings: string[];
  header: ResearchSnapshotHeader;
  dilutionRating: string | null;
  cashNeedRating: string | null;
  offeringFrequencyRating: string | null;
  offeringAbilityRating: string | null;
  overallRisk: string | null;
  regsho: boolean;
  nasdaqCompliance: string | null;
  warrants: ResearchSnapshotWarrant[];
  registrations: ResearchSnapshotRegistration[];
  offerings: ResearchSnapshotOffering[];
  news: ResearchSnapshotNewsItem[];
  // rawData preserved for any sections not yet fully normalized
  rawData: Record<string, { status: string; results: unknown[]; error?: string }>;
}
```

**Step 12b — Add `normalizeAskEdgarResponse()` to `lib/jarvis/askedgar.ts`**

This function takes `rawData: Record<string, AskEdgarResponse<unknown>>` and options `{ ticker, companyName, fetchedAt, warnings }`, and returns a `ResearchSnapshot`.

The implementation must port the following logic from `ResearchReportSections.tsx`:
- `screener` key → `header` fields (using `getField` with known key variants)
- `warrants` key → `warrants[]` array
- `offering_ability` / `offeringAbility` key → `registrations[]` (with equity dedup: skip rows where headline contains "equity line"; include warrant rows separately)
- `offerings` key → `offerings[]` (deduplicated by headline)
- `news` + `filings` keys → `news[]`
- Rating extraction from relevant endpoints
- `regsho`, `nasdaqCompliance` from compliance data

Import `getField`, `toRecord`, `toNumberValue` from `@/lib/askedgar-utils` (after Step 11 created it).

**Step 12c — Create `app/api/askedgar/snapshot/route.ts`**

```ts
import { normalizeTicker, TICKER_REGEX, internalServerError, logRouteError } from '@/lib/api-route-utils';
import { getCachedTickerData, normalizeAskEdgarResponse } from '@/lib/jarvis/askedgar';
import { fetchUnifiedSnapshot } from '@/lib/massive-market';
import { requireUser } from '@/lib/server-db-utils';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const url = new URL(request.url);
  const ticker = normalizeTicker(url.searchParams.get('ticker') ?? undefined);

  if (!ticker || !TICKER_REGEX.test(ticker)) {
    return Response.json({ error: 'Valid ticker parameter required' }, { status: 400 });
  }

  try {
    const [result, snapshot] = await Promise.all([
      getCachedTickerData(ticker),
      fetchUnifiedSnapshot([ticker]).catch(() => ({ results: [] as unknown[] })),
    ]);

    const companyName =
      (snapshot.results?.[0] as Record<string, unknown> | undefined)?.name as string | undefined ?? null;

    const normalized = normalizeAskEdgarResponse(result.rawData, {
      ticker,
      companyName,
      fetchedAt: result.fetchedAt,
      warnings: result.warnings,
    });

    return Response.json(normalized);
  } catch (error) {
    logRouteError('askedgar-snapshot', error);
    return internalServerError();
  }
}
```

**Step 12d — Update `ResearchTickerView.tsx`**

- Import `ResearchSnapshot` from `@/lib/types`
- Change fetch URL from `/api/askedgar/lookup?ticker=...` to `/api/askedgar/snapshot?ticker=...`
- Update the `data` state type from `AskEdgarLookupData` to `ResearchSnapshot`
- Update props passed to child components:
  - `ResearchCompanyHeader`: pass `header={data.header}` instead of `rawData={data.rawData}`
  - `ResearchReportSections`: pass `data={data}` instead of `rawData={data.rawData}`
- Remove `AskEdgarLookupData` interface (replaced by `ResearchSnapshot` from lib/types)

**Step 12e — Update `ResearchReportSections.tsx`**

- Change props from `{ ticker, rawData: Record<string, AskEdgarEndpointResponse> }` to `{ ticker, data: ResearchSnapshot }`
- Replace all `getField(...)`, `endpoint(rawData, ...)`, `hasData(...)` calls with direct field access on `data.*`
- The tab rendering logic (tabs, layout, colors) stays unchanged
- Target line count: ~600 (down from 950)
- Keep any remaining render-only helper functions (`formatDate`, `babyShelfBadge`, `detectFormType`) that operate on already-normalized data

**Step 12f — Update `ResearchCompanyHeader.tsx`**

- Change props from `{ ticker, rawData, companyName }` to `{ ticker, companyName, header: ResearchSnapshotHeader }`
- Import `ResearchSnapshotHeader` from `@/lib/types`
- Replace `getField(screener, [...])` calls with direct field access on `header.*`
- Remove `firstResult`, `getField`, `toRecord` usages entirely
- `formatCompact` stays (still needed for display formatting)

**Step 12g — Update `.claude/CLAUDE.md`**

Change route count from 31 to 32 (new `/api/askedgar/snapshot` route added).

**Acceptance Criteria:**
- [ ] `app/api/askedgar/snapshot/route.ts` exists and returns `ResearchSnapshot` shape
- [ ] `ResearchTickerView.tsx` calls `/api/askedgar/snapshot` instead of `/api/askedgar/lookup`
- [ ] `ResearchReportSections.tsx` is under 650 lines
- [ ] `ResearchReportSections.tsx` no longer calls `getField()` or `endpoint()` (or < 5 remaining for edge cases)
- [ ] `ResearchCompanyHeader.tsx` no longer calls `getField()`
- [ ] Research tab renders identically for a real ticker (MARA, AAPL, etc.)
- [ ] `npx tsc --noEmit` passes
- [ ] CLAUDE.md route count updated to 32

---

### Group 3 Validation

```bash
npm run lint && npx tsc --noEmit
```

Then open the Research tab, look up a ticker, verify all sections display correctly.

### ⛔ STOP — Commit Group 3 before proceeding to Step 13.

---

## Step 13 — Final HANDOFF.md Cleanup

After all steps above complete:

**File:** `HANDOFF.md`
**Action:** REWRITE

Replace this entire spec with a clean HANDOFF.md containing only:
1. The Session Maintenance Checklist (with `- [x] Execute codebase cleanup spec` added)
2. The `## Low-Priority Spec Cleanup (AGENTIC_EXPANSIONV2.md)` section (preserved below — explicitly out of scope)

Target: HANDOFF.md under 40 lines.

---

## Files Affected Summary

| File | Action | Risk |
|------|--------|------|
| `components/trading/PerformanceTab.tsx` | MODIFY | LOW |
| `lib/jarvis/prompts.ts` | MODIFY | LOW |
| `hooks/trade-utils.ts` | DELETE | LOW |
| `lib/trade-utils.ts` | CREATE | LOW |
| `hooks/use-trade-sync.ts` | MODIFY | MEDIUM |
| `hooks/use-trades.ts` | MODIFY (import only) | LOW |
| `lib/trade-migration.ts` | DELETE | LOW |
| `lib/storage.ts` | DELETE | LOW |
| `__tests__/trade-migration.test.ts` | DELETE | LOW |
| `HANDOFF.md` | MODIFY | LOW |
| `lib/types.ts` | MODIFY (add TradeMarker + ResearchSnapshot) | MEDIUM |
| `lib/trading-utils.ts` | MODIFY (add buildTradeMarkers) | MEDIUM |
| `components/trading/CandlestickChart.tsx` | MODIFY (re-export TradeMarker) | LOW |
| `components/trading/JournalTradeChart.tsx` | MODIFY | LOW |
| `components/trading/TradeDetailSheet.tsx` | MODIFY | LOW |
| `lib/chart-timeframes.ts` | MODIFY | LOW |
| `components/trading/ChartsTab.tsx` | MODIFY | LOW |
| `components/trading/ResearchChart.tsx` | MODIFY | LOW |
| `hooks/use-scanner.ts` | MODIFY | LOW |
| `lib/massive-snapshot.ts` | CREATE | MEDIUM |
| `lib/realtime-snapshot.ts` | CREATE | MEDIUM |
| `app/api/market-data/snapshot/route.ts` | MODIFY | MEDIUM |
| `app/api/jarvis/chat/route.ts` | MODIFY | MEDIUM |
| `app/api/jarvis/chat/stream/route.ts` | DELETE | LOW |
| `components/trading/JarvisChat.tsx` | MODIFY (1 line) | LOW |
| `lib/askedgar-utils.ts` | CREATE | LOW |
| `components/trading/ResearchReportSections.tsx` | MODIFY | LOW-MEDIUM |
| `components/trading/ResearchCompanyHeader.tsx` | MODIFY | LOW |
| `components/trading/ResearchTickerView.tsx` | MODIFY | LOW |
| `lib/jarvis/askedgar.ts` | MODIFY (add normalizer) | HIGH |
| `app/api/askedgar/snapshot/route.ts` | CREATE | MEDIUM |
| `.claude/CLAUDE.md` | MODIFY (route counts) | LOW |

---

## Security Considerations

- **Step 4:** Removing the localStorage fallback is intentional and safe. If the DB is unavailable, users see an error — they do not silently get stale/empty local data.
- **Step 10:** Merged Jarvis route still calls `requireUser()` as the first operation. No auth bypass possible.
- **Step 11/12:** `lib/askedgar-utils.ts` must not import `process.env` or server-only modules. The `ASKEDGAR_API_KEY` stays in `lib/jarvis/askedgar.ts` (server-only). The new `/api/askedgar/snapshot` endpoint calls `requireUser()`.

---

## Low-Priority Spec Cleanup (AGENTIC_EXPANSIONV2.md)

These are minor issues found during the 2026-03-29 spec review. None block sprint import, but should be cleaned up when convenient.

- **R8 — `step_log` guidance stated twice.** Line ~822 repeats the same `step_log` content rules from Section 3.2. Replace with a cross-reference: "See Section 3.2 for `step_log` content rules."
- **R9 — "Multi-agent fanout deferred to V2" stated 4 times.** Keep in Executive Summary + Section 13 closing note. Trim the other two instances (Section 6.1 ~line 557 and Section 13 ~line 1649) to short cross-references.
- **R10 — Polling timeout (120s/60 attempts) stated twice.** Section 20 Discord Adapter should reference Section 13 for timeout details instead of restating them.
- **M2 — Budget is per-agent but env var name doesn't clarify.** Add note to Section 19: "Each agent enforces its own budget independently — $5/day default means $15/day total across 3 agents."
- **M3 — `swing:research` step 6 missing `idempotencyKey`.** Add `idempotencyKey: 'swing-research-{ticker}-{date}'` to the metadata.
- **M4 — `getDb()` vs `getAgentDb()` distinction never stated.** Add note: "Vercel routes use `getDb()` from `lib/server-db-utils.ts` (HTTP client). Docker agent workers use `getAgentDb()` from `lib/agents/db.ts` (WebSocket pool). Never mix them."
- **B11 — Two `lib/jarvis/` files missing from Phase 7 delete list.** Add `chat-helpers.ts` and `historical-summary.ts` to the Phase 7 delete list in Section 18.
- **B15 — `services/discord-bot/` already exists with a `dist/` directory.** Audit existing contents before Phase 5 Step 44 — the spec treats it as a fresh creation but files may already be there.
- **B18 — `services/.env.example` contents never specified.** Generate from Docker Compose `environment:` blocks or include a template in Section 15.

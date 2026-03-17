# Nexus Terminal — HANDOFF.md

## Active Handoff Only

Historical completed sections (Scanner Realtime Data Pipeline, etc.) were removed to keep this file focused.
Use git history and the `specs/` directory for archived implementation detail.

### Session Maintenance Checklist

- [x] Refreshed `AGENTS.md` with current build/lint/test commands, single-test workflows, and coding conventions for agentic coding tools.
- [x] Verified command set and conventions against the current repository configuration (`package.json`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.mjs`).
- [ ] After all 5 PRs: remove `parseJsonBody` from `lib/api-route-utils.ts` if no routes still use it

---

## Schwab Relay Auth — Parallel Blocker

> Generated: 2026-03-16 | Status: OPEN

- Relay logs show repeated `Failed to load Schwab user preference (401)`.
- This keeps `realtime_quotes` stale or empty, which directly degrades Scanner results.
- Schwab refresh tokens expire every **7 days** — you need to re-login via the Schwab OAuth flow weekly.

### Next steps

1. Re-link Schwab account in the app (Markets tab → Schwab status)
2. After relinking, check Fly logs for `LOGIN successful, subscribing...` and quote-write activity
3. If 401 persists after fresh relink, investigate whether the relay is loading the correct tokens from the DB

---

## Discord Research Report Extraction

> Generated: 2026-03-16 | Status: PLANNED
> Priority: HIGH — unlocks ticker auto-subscription + historical research archive

*(Full spec preserved from prior session — see git history for details. Implementation deferred until tech debt PRs are complete.)*

---

## Custom Dilution Research Report

> Generated: 2026-03-16 | Status: PLANNED
> Priority: HIGH — replaces $200/mo third-party report
> Depends on: Sprint 8 AskEdgar integration (partially built in `lib/jarvis/research.ts`)

*(Full spec preserved from prior session — see git history for details. Implementation deferred until tech debt PRs are complete.)*

---

# Tech Debt Fixes — Implementation Specs

> Generated: 2026-03-16 | Agent: nexus-architect
> Status: PLANNED (5 PRs, execute in order)

## Workflow Instructions for opencode

**Execute these PRs in order (1 → 2 → 3 → 4 → 5).** After each PR:

1. Run `npm run lint && npx tsc --noEmit && npm test`
2. **STOP and report results.** Do not proceed to the next PR until confirmed.
3. PRs 1+2 may be done in a single session (both LOW risk). PRs 3-5 must stop-and-verify individually.

**Corrections from HANDOFF audit:**
- Issue 4 (indexes): `jarvis_conversations_user_session_idx` already exists at schema.ts:200. Only 1 new index needed, not 3.
- Issue 3 (rate limit): `/api/jarvis/research` and `/api/jarvis/trade-analysis` never call `checkRateLimit` — must be added.
- Issue 5 (ApiTrade): Two definitions are structurally different — server is 37-line explicit, client is 1-line `Omit` pattern.

**Routes NOT in scope for PR 4 (Zod) — to be done in a future PR:**
- `/api/tags` — POST/DELETE
- `/api/saved-tickers` — POST/PATCH/DELETE
- `/api/scanner/presets` — POST/PATCH/DELETE
- `/api/market-data/snapshot` — POST
- `/api/market-data/daily-summary` — POST

---

## PR 1: ApiTrade Dedup + DB Index

> Generated: 2026-03-16 | Agent: nexus-architect
> Status: PLANNED | Risk: LOW | Est: 30 min

### Objective

Consolidate the duplicated `ApiTrade` type into `lib/types.ts` and add a missing `(userId, date)` index to the trades table.

### Change 1: Add `ApiTrade` to `lib/types.ts`

**File:** `lib/types.ts`
**Action:** MODIFY

Add after the closing `}` of the `Trade` interface (after line 41):

```typescript

/**
 * Wire format of a trade returned by / sent to API routes.
 * Identical to Trade except `date` is an ISO string (JSON has no Date type).
 */
export type ApiTrade = {
  id: string;
  date: string;
  sortKey: string;
  symbol: string;
  direction: Direction;
  avgEntryPrice: number;
  avgExitPrice: number;
  totalQuantity: number;
  grossPnl: number;
  netPnl: number;
  entryTime: string;
  exitTime: string;
  executionCount: number;
  rawExecutions: Execution[];
  mfe?: number;
  mae?: number;
  bestExitPnl?: number;
  exitEfficiency?: number;
  pnl: number;
  executions: number;
  initialRisk?: number;
  commission?: number;
  fees?: number;
  tags: string[];
  notes?: string;
};
```

**Why explicit instead of `Omit<Trade, 'date'>`:** The explicit version serves as documentation — you can see every field at a glance. Both produce the same TS type; explicit is more readable.

**Why `Execution[]` instead of inline array:** `Execution` (lines 3-12 of same file) is structurally identical to the inline version in the old server definition. Using the named type avoids repetition.

### Change 2: Update `lib/server-db-utils.ts`

**File:** `lib/server-db-utils.ts`
**Action:** MODIFY

**Step 2a:** Add import after line 4 (after the schema import):
```typescript
import type { ApiTrade } from '@/lib/types';
```

**Step 2b:** Delete lines 6-42 (the entire `export type ApiTrade = { ... };` block).

**Step 2c:** Add re-export right after the new import:
```typescript
export type { ApiTrade };
```

After these steps, the top of the file should look like:
```typescript
import { and, eq, inArray, or } from 'drizzle-orm';
import { auth } from '@/lib/auth-config';
import { type Db, type PoolDb } from '@/lib/db';
import { users, trades, tradeTags } from '@/lib/db/schema';
import type { ApiTrade } from '@/lib/types';
export type { ApiTrade };

type QueryDb = Db | PoolDb;
```

### Change 3: Update `hooks/use-trades.ts`

**File:** `hooks/use-trades.ts`
**Action:** MODIFY

**Step 3a:** Change line 7 from:
```typescript
import type { Trade } from '@/lib/types';
```
to:
```typescript
import type { ApiTrade, Trade } from '@/lib/types';
```

**Step 3b:** Delete line 19:
```typescript
type ApiTrade = Omit<Trade, 'date'> & { date: string };
```

### Change 4: Add `idx_trades_user_date` index

**File:** `lib/db/schema.ts`
**Action:** MODIFY

Add after line 43 (after the existing `idx_trades_user_sort_key` index), before the closing `]);`:

```typescript
  index('idx_trades_user_date').on(table.userId, table.date),
```

Then run:
```bash
npm run db:generate   # generates migration
npm run db:migrate    # applies it
```

### Acceptance Criteria

- [ ] `ApiTrade` exported from `lib/types.ts` with `date: string` and `Execution[]`
- [ ] No `ApiTrade` type definition in `server-db-utils.ts` (only import + re-export)
- [ ] No local `ApiTrade` in `use-trades.ts` (import from `@/lib/types`)
- [ ] `idx_trades_user_date` exists in schema
- [ ] Migration generated and applied
- [ ] `npm run lint && npx tsc --noEmit && npm test` all pass

### Verification

```bash
npm run lint && npx tsc --noEmit && npm test
npm run db:generate
npm run db:migrate
# Confirm single ApiTrade definition:
grep -rn "export type ApiTrade" lib/
# Should return exactly 1 result in lib/types.ts
```

### Files Changed Summary

| File | Action | Risk |
|------|--------|------|
| `lib/types.ts` | MODIFY — add `ApiTrade` export | LOW |
| `lib/server-db-utils.ts` | MODIFY — remove type, add import + re-export | LOW |
| `hooks/use-trades.ts` | MODIFY — replace local type with import | LOW |
| `lib/db/schema.ts` | MODIFY — add 1 index | LOW |

---

## PR 2: Error Boundaries Per Tab

> Generated: 2026-03-16 | Agent: nexus-architect
> Status: PLANNED | Risk: LOW | Est: 30 min

### Objective

Create a reusable `TabErrorBoundary` class component and wrap each of the 8 tabs so a crash in one tab shows an inline error + retry button instead of crashing the whole app.

### Change 1: Create `components/ui/TabErrorBoundary.tsx`

**File:** `components/ui/TabErrorBoundary.tsx`
**Action:** CREATE

```tsx
'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface TabErrorBoundaryProps {
  /** Display name shown in the error message, e.g. "Markets" */
  name: string;
  children: ReactNode;
}

interface TabErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Wraps a single tab so that a render crash shows an inline
 * error message instead of taking down the entire app.
 *
 * This is a class component because React does not provide a
 * hook-based API for catching render errors (componentDidCatch).
 */
export class TabErrorBoundary extends Component<TabErrorBoundaryProps, TabErrorBoundaryState> {
  constructor(props: TabErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): TabErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[TabErrorBoundary:${this.props.name}]`, error, info.componentStack);
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center rounded-xl border border-amber-500/20 bg-[#121214] px-6 py-16 text-center">
          <p className="mb-1 text-xs font-medium uppercase tracking-[0.2em] text-amber-400">
            Tab Error
          </p>
          <h2 className="text-lg font-semibold text-[#E4E4E7]">
            {this.props.name} encountered an error
          </h2>
          <p className="mt-2 max-w-md text-sm text-zinc-400">
            Something went wrong rendering this tab. Other tabs are unaffected.
          </p>

          <button
            onClick={this.handleReset}
            className="mt-6 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-emerald-400"
            type="button"
          >
            Try again
          </button>

          {process.env.NODE_ENV === 'development' && this.state.error ? (
            <p className="mt-4 max-w-lg break-all text-xs text-zinc-500">
              {this.state.error.message}
            </p>
          ) : null}
        </div>
      );
    }

    return this.props.children;
  }
}
```

**Why class component:** React has no hook equivalent for `componentDidCatch`/`getDerivedStateFromError`. This is the one place where a class component is justified.

**Why amber (not rose):** This is a contained, recoverable error — less alarming than the global boundary which uses rose.

### Change 2: Wrap each tab in `app/page.tsx`

**File:** `app/page.tsx`
**Action:** MODIFY

**Step 2a:** Add import after the existing component imports (after the `JarvisTab` import):
```tsx
import { TabErrorBoundary } from '@/components/ui/TabErrorBoundary';
```

**Step 2b:** Wrap each of the 8 tab components. The boundary goes INSIDE the ternary conditional, around the component. This preserves AnimatePresence exit animations.

Pattern for each tab:
```tsx
{activeTab === 'xxx' ? (
  <TabErrorBoundary name="DisplayName">
    <XxxTab ... />  {/* all existing props unchanged */}
  </TabErrorBoundary>
) : null}
```

Tab name mapping:

| activeTab key | `name` prop | Component |
|---------------|-------------|-----------|
| `dashboard` | `"Dashboard"` | `<DashboardTab>` |
| `journal` | `"Journal"` | `<JournalTab>` |
| `performance` | `"Performance"` | `<PerformanceTab>` |
| `filter` | `"Trades"` | `<TradesTab>` |
| `charts` | `"Charts"` | `<ChartsTab>` |
| `markets` | `"Markets"` | `<MarketsTab>` |
| `research` | `"Research"` | `<ResearchTab>` |
| `jarvis` | `"Jarvis"` | `<JarvisTab>` |

**Do NOT change any props on any tab component.** Only add the wrapping `<TabErrorBoundary>` tags.

### Acceptance Criteria

- [ ] `TabErrorBoundary` exists at `components/ui/TabErrorBoundary.tsx`
- [ ] All 8 tabs wrapped with correct `name` prop
- [ ] No tab props changed
- [ ] `npm run lint && npx tsc --noEmit && npm test` all pass
- [ ] Manual: all 8 tabs render correctly
- [ ] Manual: add `throw new Error('test')` in one tab — only that tab shows amber error, others work, "Try again" recovers

### Files Changed Summary

| File | Action | Risk |
|------|--------|------|
| `components/ui/TabErrorBoundary.tsx` | CREATE | LOW |
| `app/page.tsx` | MODIFY — add import + wrap 8 blocks | LOW |

---

## PR 3: Fix In-Memory Rate Limiting

> Generated: 2026-03-16 | Agent: nexus-architect
> Status: COMPLETE | Risk: LOW-MEDIUM | Completed: 2026-03-16

### Delivered

- Replaced in-memory Jarvis rate limiting with DB-backed counting from `jarvis_request_log` in `lib/jarvis/rate-limit.ts`.
- Made `checkRateLimit` async and updated `app/api/jarvis/chat/route.ts` to await it.
- Added rate-limit enforcement + 429 `Retry-After` handling to `app/api/jarvis/research/route.ts` and `app/api/jarvis/trade-analysis/route.ts`.
- Added `logJarvisRequest` success logging to research and trade-analysis routes so those requests are counted toward limits.
- Updated async rate-limit mocks in `__tests__/jarvis-chat-route.test.ts`, `__tests__/jarvis-research-route.test.ts`, and `__tests__/jarvis-trade-analysis-route.test.ts`.

### Validation

- [x] `npm run lint`
- [x] `npx tsc --noEmit`
- [x] `npm test`

---

## PR 4: Zod Validation (High-Risk Routes)

> Generated: 2026-03-16 | Agent: nexus-architect
> Status: COMPLETE | Risk: MEDIUM | Completed: 2026-03-16

### Delivered

- Added `parseAndValidate` to `lib/api-route-utils.ts` using Zod v4 `z.flattenError(...)`, while keeping `parseJsonBody` with a TODO note for remaining routes.
- Added shared schemas in `lib/validations/trades.ts` and `lib/validations/jarvis.ts` for all PR 4 payloads.
- Migrated 7 routes from `parseJsonBody` to `parseAndValidate`:
  - `app/api/jarvis/trade-analysis/route.ts`
  - `app/api/jarvis/research/route.ts`
  - `app/api/jarvis/chat/route.ts`
  - `app/api/trades/[id]/route.ts` (PATCH)
  - `app/api/trades/bulk/route.ts`
  - `app/api/trades/route.ts` (POST)
  - `app/api/trades/import/route.ts` (POST)
- Removed inline payload types (`ChatBody`, `ResearchBody`, `TradeAnalysisBody`, `BulkPayload`, `ImportPayload`) plus legacy import validators (`validateTradePayload`, `normalizeStringArray`).
- Updated `__tests__/trades-import-route.test.ts` assertions to match standardized Zod validation response shape.

### Validation

- [x] `npm run lint`
- [x] `npx tsc --noEmit`
- [x] `npm test`

---

## PR 5: Decompose `use-trades.ts` God Hook

> Generated: 2026-03-16 | Agent: nexus-architect
> Status: PLANNED | Risk: MEDIUM-HIGH | Est: 3 hrs (4 sub-steps)

### Objective

Break the 938-line `useTrades` hook into composable sub-hooks. The return type of `useTrades()` must NOT change — this is a pure refactor with zero consumer changes.

### Current Structure (from audit)

| Line Range | Responsibility |
|------------|---------------|
| 33-63 | Pure functions: `normalizeTrade()`, `toApiTrade()`, `fromApiTrade()` |
| 71-91 | `apiRequest<T>()` — duplicates logic from `lib/api-route-utils` |
| 93-100 | `appendCsvParseWarnings()` |
| 102-349 | Auth, DB loading, localStorage/cloud sync, migration |
| 351-363 | localStorage persistence effect |
| 365-596 | Selection, filtering, tagging, bulk operations |
| 648-887 | CSV file/folder import (~80% duplicated between handlers) |

### Sub-step 5a: Extract shared utilities to `hooks/trade-utils.ts`

**File:** `hooks/trade-utils.ts`
**Action:** CREATE

Move these pure functions out of `use-trades.ts`:
- `normalizeTrade()` (lines ~33-42)
- `toApiTrade()` (lines ~43-52)
- `fromApiTrade()` (lines ~53-63)
- `apiRequest<T>()` (lines ~71-91)
- `appendCsvParseWarnings()` (lines ~93-100)
- Types: `TradeLike`, `CsvParseIssue`

Export all of them. Update `use-trades.ts` to import from `./trade-utils`.

**Verify:** `npm run lint && npx tsc --noEmit && npm test`

### Sub-step 5b: Deduplicate file/folder upload

**File:** `hooks/use-trades.ts`
**Action:** MODIFY

`handleFileUpload` (~lines 648-770) and `handleFolderUpload` (~lines 770-887) share ~80% logic. Extract a shared function:

```typescript
async function processImportFiles(
  files: FileList,
  resolveParser: (files: FileList) => BrokerParserConfig | null,
  // ... other shared deps passed as params
): Promise<void> {
  // Shared parsing, validation, API call logic
}
```

Both handlers become thin wrappers that call `processImportFiles` with different parser resolution strategies.

**Verify:** `npm run lint && npx tsc --noEmit && npm test`

### Sub-step 5c: Extract `useTradeFilters()` to `hooks/use-trade-filters.ts`

**File:** `hooks/use-trade-filters.ts`
**Action:** CREATE

Move filter/search/selection state and handlers:

**State:** `selectedIds`, `startDate`, `endDate`, `searchQuery`, `filterPreset`, `selectedFilterTags`, `bulkTagInput`

**Computed:** `filteredTrades` (useMemo), `hasActiveFilters`, `activeFilterCount`

**Handlers:** `handleToggleSelect`, `handleSelectAll`, `handleBulkAddTag`

**Interface:**
```typescript
export function useTradeFilters(trades: Trade[], globalTags: string[]) {
  // ... state + handlers
  return {
    selectedIds, setSelectedIds,
    startDate, setStartDate,
    endDate, setEndDate,
    searchQuery, setSearchQuery,
    filterPreset, setFilterPreset,
    selectedFilterTags, setSelectedFilterTags,
    bulkTagInput, setBulkTagInput,
    filteredTrades,
    hasActiveFilters,
    activeFilterCount,
    handleToggleSelect,
    handleSelectAll,
    handleBulkAddTag,
  };
}
```

Update `use-trades.ts` to call `useTradeFilters(trades, globalTags)` and spread its return into the main return object.

**Verify:** `npm run lint && npx tsc --noEmit && npm test`

### Sub-step 5d: Extract `useTradeSync()` to `hooks/use-trade-sync.ts`

**File:** `hooks/use-trade-sync.ts`
**Action:** CREATE

Move auth + persistence logic (lines ~102-363):

**State:** `trades`, `globalTags`, `mounted`, `error`, `useLocalStorage`

**Logic:** All the auth checking, DB loading, localStorage hydration, migration, cloud sync, localStorage persistence effect

**Interface:**
```typescript
export function useTradeSync() {
  // ... auth, loading, persistence
  return {
    trades, setTrades,
    globalTags, setGlobalTags,
    mounted,
    error,
    useLocalStorage, setUseLocalStorage,
    refreshTrades, // re-fetch from DB
  };
}
```

Update `use-trades.ts` to call `useTradeSync()` and compose with `useTradeFilters`.

**Final state of `use-trades.ts`:** ~350 lines. Composes `useTradeSync()` + `useTradeFilters()`, owns CRUD handlers (create, delete, risk, notes, tags, import), returns the same 37-property object.

**Verify:** `npm run lint && npx tsc --noEmit && npm test`

### Acceptance Criteria

- [ ] `hooks/trade-utils.ts` exists with pure functions
- [ ] `hooks/use-trade-filters.ts` exists and exports `useTradeFilters`
- [ ] `hooks/use-trade-sync.ts` exists and exports `useTradeSync`
- [ ] `hooks/use-trades.ts` is under 400 lines
- [ ] File/folder upload share one code path
- [ ] `useTrades()` return type is IDENTICAL — no consumer changes
- [ ] `app/page.tsx` is NOT modified
- [ ] All existing tests pass
- [ ] `npm run lint && npx tsc --noEmit && npm test` all pass

### Files Changed Summary

| File | Action | Risk |
|------|--------|------|
| `hooks/trade-utils.ts` | CREATE | LOW |
| `hooks/use-trade-filters.ts` | CREATE | MEDIUM |
| `hooks/use-trade-sync.ts` | CREATE | MEDIUM |
| `hooks/use-trades.ts` | MODIFY (shrink from 938 → ~350 lines) | HIGH |

# Build Spec — Scanner Feature v1 (Markets Tab)

> Generated: 2026-03-16 | Agent: nexus-architect
> Status: PENDING — ready for opencode to execute

## Objective

Add a Scanner section to the existing Markets tab that queries the `realtime_quotes` table with user-defined filters (price range, change %, volume min, asset type), displays results in a sortable table, and supports saved presets stored in a new `scanner_presets` DB table. The scanner auto-refreshes on the same cadence as the Markets tab (5s realtime, 60s delayed).

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Location | Section inside Markets tab (below movers, above macro summary) | Markets is the "market awareness" hub |
| Table columns | Ticker, Price, Change, Change%, Volume | Simple v1 — OHLC available in `realtime_quotes` for future |
| Filter UI | Collapsible panel (click "Filters" to expand) | Clean when browsing, detailed when filtering |
| Preset storage | DB table (`scanner_presets`) | Persists across devices, agent-callable later |
| Auto-refresh | 5s realtime / 60s delayed | Matches existing Markets tab pattern |
| Agent integration | Deferred — API accepts filter params so agents can call it later | Blocked on AGENTIC_EXPANSION_V2 |
| Symbol coverage | Existing `realtime_quotes` data only | No relay changes needed for v1 |

## Current State

- **MarketsTab** lives at `components/trading/MarketsTab.tsx` (~417 lines). Scanner section goes after Market Movers, before macro summary.
- **`realtime_quotes` table** (`lib/db/schema.ts` lines 237-258) has: `symbol`, `assetType`, `lastPrice`, `netChange`, `netChangePercent`, `totalVolume`, `bidPrice`, `askPrice`, `openPrice`, `highPrice`, `lowPrice`, `closePrice`, `description`, `updatedAt`.
- **No `scanner_presets` table** exists yet.
- **No `/api/scanner` route** exists yet.
- **UI primitives available** at `components/ui/`: button, input, select, label, dialog, dropdown-menu, popover, sheet, textarea, command.
- **DB access pattern**: `getDb()` from `@/lib/db`, `requireUser()` from `@/lib/server-db-utils`, error helpers from `@/lib/api-route-utils`.
- **Drizzle operators**: `and`, `eq`, `gte`, `lte`, `desc`, `asc`, `sql` from `drizzle-orm`.

---

## Files Affected

| File | Action | Risk |
|------|--------|------|
| `lib/db/schema.ts` | MODIFY (add table) | LOW |
| `app/api/scanner/route.ts` | CREATE | LOW |
| `app/api/scanner/presets/route.ts` | CREATE | LOW |
| `hooks/use-scanner.ts` | CREATE | LOW |
| `components/trading/ScannerSection.tsx` | CREATE | MEDIUM |
| `components/trading/MarketsTab.tsx` | MODIFY (add import + 1 JSX line) | LOW |

---

## Order of Operations

1. Change 1 → schema + migration
2. Change 2 → scanner API route
3. Change 3 → presets API route
4. Change 4 → useScanner hook
5. Change 5 → ScannerSection component
6. Change 6 → wire into MarketsTab

Run `npm run lint && npx tsc --noEmit` after every change.

---

## Change 1: Add `scanner_presets` table to schema

**File:** `lib/db/schema.ts`
**Action:** MODIFY — add after the `realtimeQuotes` table definition (after line 258)

```typescript
export const scannerPresets = pgTable('scanner_presets', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  filtersJson: jsonb('filters_json').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique().on(table.userId, table.name),
  index('scanner_presets_user_idx').on(table.userId),
]);
```

The `filtersJson` column stores a JSON object matching this TypeScript shape (defined in the hook later):

```typescript
{
  minPrice?: number;
  maxPrice?: number;
  minChangePercent?: number;
  maxChangePercent?: number;
  minVolume?: number;
  assetType?: 'equity' | 'etf' | 'future' | 'forex' | 'index' | 'crypto';
}
```

**Note:** `unique` and `index` must be imported from `drizzle-orm/pg-core` if not already imported. Check existing imports at the top of the file — `unique` may need to be added.

**After this change, run:**

```bash
npm run db:generate
npm run db:migrate
npm run lint && npx tsc --noEmit
```

**Acceptance criteria:**
- `scannerPresets` export exists in schema.ts
- Has `id`, `userId`, `name`, `filtersJson`, `createdAt`, `updatedAt` columns
- Has unique constraint on `(userId, name)`
- Has index on `userId`
- Migration generates and runs cleanly

---

## Change 2: Create Scanner API route

**File:** `app/api/scanner/route.ts` (CREATE)

This is a GET endpoint that queries `realtime_quotes` with optional filter params. It's agent-callable — same filters work as query params from any caller.

```typescript
import { and, asc, desc, gte, lte, eq, sql } from 'drizzle-orm';
import { internalServerError, logRouteError } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { realtimeQuotes } from '@/lib/db/schema';
import { requireUser } from '@/lib/server-db-utils';

// Columns the client is allowed to sort by
const SORTABLE_COLUMNS = {
  symbol: realtimeQuotes.symbol,
  lastPrice: realtimeQuotes.lastPrice,
  netChange: realtimeQuotes.netChange,
  netChangePercent: realtimeQuotes.netChangePercent,
  totalVolume: realtimeQuotes.totalVolume,
} as const;

type SortableKey = keyof typeof SORTABLE_COLUMNS;

function isSortableKey(value: string): value is SortableKey {
  return value in SORTABLE_COLUMNS;
}

const VALID_ASSET_TYPES = ['equity', 'etf', 'future', 'forex', 'index', 'crypto'] as const;

function toNumberOrUndefined(value: string | null): number | undefined {
  if (value == null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export async function GET(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) {
      return Response.json({ error: 'Database not configured' }, { status: 503 });
    }

    const { searchParams } = new URL(request.url);

    // Parse filter params
    const minPrice = toNumberOrUndefined(searchParams.get('minPrice'));
    const maxPrice = toNumberOrUndefined(searchParams.get('maxPrice'));
    const minChangePercent = toNumberOrUndefined(searchParams.get('minChangePercent'));
    const maxChangePercent = toNumberOrUndefined(searchParams.get('maxChangePercent'));
    const minVolume = toNumberOrUndefined(searchParams.get('minVolume'));
    const assetTypeParam = searchParams.get('assetType');
    const assetType = assetTypeParam && VALID_ASSET_TYPES.includes(assetTypeParam as typeof VALID_ASSET_TYPES[number])
      ? (assetTypeParam as typeof VALID_ASSET_TYPES[number])
      : undefined;

    // Parse sort params
    const sortByParam = searchParams.get('sortBy') ?? 'netChangePercent';
    const sortBy = isSortableKey(sortByParam) ? sortByParam : 'netChangePercent';
    const sortDir = searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc';

    // Parse limit (default 100, max 500)
    const limitParam = toNumberOrUndefined(searchParams.get('limit'));
    const limit = Math.min(Math.max(limitParam ?? 100, 1), 500);

    // Build WHERE conditions
    const conditions = [];

    // Always require a non-null lastPrice so we don't show empty rows
    conditions.push(sql`${realtimeQuotes.lastPrice} IS NOT NULL`);

    if (minPrice !== undefined) conditions.push(gte(realtimeQuotes.lastPrice, minPrice));
    if (maxPrice !== undefined) conditions.push(lte(realtimeQuotes.lastPrice, maxPrice));
    if (minChangePercent !== undefined) conditions.push(gte(realtimeQuotes.netChangePercent, minChangePercent));
    if (maxChangePercent !== undefined) conditions.push(lte(realtimeQuotes.netChangePercent, maxChangePercent));
    if (minVolume !== undefined) conditions.push(gte(realtimeQuotes.totalVolume, minVolume));
    if (assetType !== undefined) conditions.push(eq(realtimeQuotes.assetType, assetType));

    const sortColumn = SORTABLE_COLUMNS[sortBy];
    const orderFn = sortDir === 'asc' ? asc : desc;

    const rows = await db
      .select({
        symbol: realtimeQuotes.symbol,
        assetType: realtimeQuotes.assetType,
        lastPrice: realtimeQuotes.lastPrice,
        netChange: realtimeQuotes.netChange,
        netChangePercent: realtimeQuotes.netChangePercent,
        totalVolume: realtimeQuotes.totalVolume,
        updatedAt: realtimeQuotes.updatedAt,
      })
      .from(realtimeQuotes)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(orderFn(sortColumn))
      .limit(limit);

    return Response.json({
      results: rows,
      count: rows.length,
      filters: { minPrice, maxPrice, minChangePercent, maxChangePercent, minVolume, assetType },
      sort: { sortBy, sortDir },
    });
  } catch (error) {
    logRouteError('scanner.get', error);
    return internalServerError();
  }
}
```

**Acceptance criteria:**
- `GET /api/scanner` returns 401 without auth
- `GET /api/scanner` returns `{ results, count, filters, sort }` with auth
- Filter params (`minPrice`, `maxPrice`, `minChangePercent`, `maxChangePercent`, `minVolume`, `assetType`) correctly narrow results
- Sort params (`sortBy`, `sortDir`) work for all sortable columns
- Default sort is `netChangePercent desc`, default limit is 100, max 500
- `npm run lint && npx tsc --noEmit` passes

---

## Change 3: Create Scanner Presets API route

**File:** `app/api/scanner/presets/route.ts` (CREATE)

CRUD for scanner presets. GET lists all for user. POST creates/upserts by name. DELETE removes by id.

```typescript
import { and, desc, eq } from 'drizzle-orm';
import { internalServerError, logRouteError, parseJsonBody } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { scannerPresets } from '@/lib/db/schema';
import { requireUser } from '@/lib/server-db-utils';

interface PresetBody {
  name?: string;
  filters?: Record<string, unknown>;
}

export async function GET() {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) {
      return Response.json({ error: 'Database not configured' }, { status: 503 });
    }

    const rows = await db
      .select({
        id: scannerPresets.id,
        name: scannerPresets.name,
        filtersJson: scannerPresets.filtersJson,
        createdAt: scannerPresets.createdAt,
        updatedAt: scannerPresets.updatedAt,
      })
      .from(scannerPresets)
      .where(eq(scannerPresets.userId, authState.user.id))
      .orderBy(desc(scannerPresets.updatedAt));

    return Response.json({ presets: rows });
  } catch (error) {
    logRouteError('scanner-presets.get', error);
    return internalServerError();
  }
}

export async function POST(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) {
      return Response.json({ error: 'Database not configured' }, { status: 503 });
    }

    const bodyState = await parseJsonBody<PresetBody>(request);
    if (bodyState.error) return bodyState.error;

    const name = (bodyState.data.name ?? '').trim();
    if (!name) {
      return Response.json({ error: 'name is required' }, { status: 400 });
    }

    if (name.length > 100) {
      return Response.json({ error: 'name must be 100 characters or fewer' }, { status: 400 });
    }

    const filters = bodyState.data.filters ?? {};
    const now = new Date();

    await db
      .insert(scannerPresets)
      .values({
        id: crypto.randomUUID(),
        userId: authState.user.id,
        name,
        filtersJson: filters,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [scannerPresets.userId, scannerPresets.name],
        set: {
          filtersJson: filters,
          updatedAt: now,
        },
      });

    return Response.json({ name, filters });
  } catch (error) {
    logRouteError('scanner-presets.post', error);
    return internalServerError();
  }
}

export async function DELETE(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) {
      return Response.json({ error: 'Database not configured' }, { status: 503 });
    }

    const { searchParams } = new URL(request.url);
    const id = (searchParams.get('id') ?? '').trim();
    if (!id) {
      return Response.json({ error: 'id is required' }, { status: 400 });
    }

    await db
      .delete(scannerPresets)
      .where(and(eq(scannerPresets.userId, authState.user.id), eq(scannerPresets.id, id)));

    return Response.json({ success: true });
  } catch (error) {
    logRouteError('scanner-presets.delete', error);
    return internalServerError();
  }
}
```

**Acceptance criteria:**
- `GET /api/scanner/presets` returns `{ presets: [...] }` for authenticated user
- `POST /api/scanner/presets` with `{ name, filters }` creates or upserts preset
- `DELETE /api/scanner/presets?id=xxx` removes the preset
- All routes return 401 without auth
- `npm run lint && npx tsc --noEmit` passes

**Dependencies:** Change 1 (schema must have `scannerPresets`)

---

## Change 4: Create `useScanner` hook

**File:** `hooks/use-scanner.ts` (CREATE)

Client-side hook that manages scanner filter state, fetches from `/api/scanner`, manages presets via `/api/scanner/presets`, and auto-refreshes.

```typescript
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// ---- Types ----

export type ScannerFilters = {
  minPrice?: number;
  maxPrice?: number;
  minChangePercent?: number;
  maxChangePercent?: number;
  minVolume?: number;
  assetType?: string;
};

export type ScannerSortKey = 'symbol' | 'lastPrice' | 'netChange' | 'netChangePercent' | 'totalVolume';
export type ScannerSortDir = 'asc' | 'desc';

export type ScannerRow = {
  symbol: string;
  assetType: string;
  lastPrice: number | null;
  netChange: number | null;
  netChangePercent: number | null;
  totalVolume: number | null;
  updatedAt: string;
};

export type ScannerPreset = {
  id: string;
  name: string;
  filtersJson: ScannerFilters;
  createdAt: string;
  updatedAt: string;
};

// ---- Helpers ----

function buildQueryString(
  filters: ScannerFilters,
  sortBy: ScannerSortKey,
  sortDir: ScannerSortDir,
  limit: number,
): string {
  const params = new URLSearchParams();

  if (filters.minPrice !== undefined) params.set('minPrice', String(filters.minPrice));
  if (filters.maxPrice !== undefined) params.set('maxPrice', String(filters.maxPrice));
  if (filters.minChangePercent !== undefined) params.set('minChangePercent', String(filters.minChangePercent));
  if (filters.maxChangePercent !== undefined) params.set('maxChangePercent', String(filters.maxChangePercent));
  if (filters.minVolume !== undefined) params.set('minVolume', String(filters.minVolume));
  if (filters.assetType) params.set('assetType', filters.assetType);

  params.set('sortBy', sortBy);
  params.set('sortDir', sortDir);
  params.set('limit', String(limit));

  return params.toString();
}

// ---- Hook ----

export function useScanner(refreshIntervalMs: number) {
  const [filters, setFilters] = useState<ScannerFilters>({});
  const [sortBy, setSortBy] = useState<ScannerSortKey>('netChangePercent');
  const [sortDir, setSortDir] = useState<ScannerSortDir>('desc');
  const [results, setResults] = useState<ScannerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [presets, setPresets] = useState<ScannerPreset[]>([]);
  const [presetsLoading, setPresetsLoading] = useState(false);
  const filtersRef = useRef(filters);
  const sortByRef = useRef(sortBy);
  const sortDirRef = useRef(sortDir);

  // Keep refs in sync so the interval callback always uses latest values
  useEffect(() => { filtersRef.current = filters; }, [filters]);
  useEffect(() => { sortByRef.current = sortBy; }, [sortBy]);
  useEffect(() => { sortDirRef.current = sortDir; }, [sortDir]);

  const fetchResults = useCallback(async () => {
    setLoading(true);
    try {
      const qs = buildQueryString(filtersRef.current, sortByRef.current, sortDirRef.current, 100);
      const res = await fetch(`/api/scanner?${qs}`);
      if (!res.ok) return;
      const data = (await res.json()) as { results: ScannerRow[] };
      setResults(data.results);
    } catch {
      // Silently fail — stale data stays visible
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchPresets = useCallback(async () => {
    setPresetsLoading(true);
    try {
      const res = await fetch('/api/scanner/presets');
      if (!res.ok) return;
      const data = (await res.json()) as { presets: ScannerPreset[] };
      setPresets(data.presets);
    } catch {
      // Silently fail
    } finally {
      setPresetsLoading(false);
    }
  }, []);

  const savePreset = useCallback(async (name: string) => {
    try {
      await fetch('/api/scanner/presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, filters: filtersRef.current }),
      });
      await fetchPresets();
    } catch {
      // Silently fail
    }
  }, [fetchPresets]);

  const deletePreset = useCallback(async (id: string) => {
    try {
      await fetch(`/api/scanner/presets?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      setPresets((prev) => prev.filter((p) => p.id !== id));
    } catch {
      // Silently fail
    }
  }, []);

  const loadPreset = useCallback((preset: ScannerPreset) => {
    setFilters(preset.filtersJson);
  }, []);

  const toggleSort = useCallback((column: ScannerSortKey) => {
    setSortBy((prev) => {
      if (prev === column) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir('desc');
      return column;
    });
  }, []);

  const clearFilters = useCallback(() => {
    setFilters({});
  }, []);

  // Initial load
  useEffect(() => {
    void fetchResults();
    void fetchPresets();
  }, [fetchResults, fetchPresets]);

  // Re-fetch when filters or sort change
  useEffect(() => {
    void fetchResults();
  }, [filters, sortBy, sortDir, fetchResults]);

  // Auto-refresh interval
  useEffect(() => {
    if (refreshIntervalMs <= 0) return;
    const interval = window.setInterval(() => {
      void fetchResults();
    }, refreshIntervalMs);
    return () => window.clearInterval(interval);
  }, [refreshIntervalMs, fetchResults]);

  return {
    filters,
    setFilters,
    sortBy,
    sortDir,
    toggleSort,
    results,
    loading,
    presets,
    presetsLoading,
    savePreset,
    deletePreset,
    loadPreset,
    clearFilters,
    fetchResults,
  };
}
```

**Acceptance criteria:**
- Hook compiles with no type errors
- All state/actions returned: `filters`, `setFilters`, `sortBy`, `sortDir`, `toggleSort`, `results`, `loading`, `presets`, `savePreset`, `deletePreset`, `loadPreset`, `clearFilters`, `fetchResults`
- Auto-refresh fires at the given `refreshIntervalMs`
- Changing filters or sort triggers a re-fetch
- `npm run lint && npx tsc --noEmit` passes

**Dependencies:** Changes 2 and 3 (API routes must exist for runtime, but hook compiles independently)

---

## Change 5: Create `ScannerSection` component

**File:** `components/trading/ScannerSection.tsx` (CREATE)

Self-contained scanner UI. Contains: collapsible filter panel, sortable results table, preset save/load/delete. Receives `refreshIntervalMs` as a prop.

```typescript
'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useScanner, type ScannerSortKey } from '@/hooks/use-scanner';

// ---- Helpers (match MarketsTab formatting) ----

function formatNumber(value: number | null, digits = 2) {
  if (value == null || !Number.isFinite(value)) return '--';
  return value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatPercent(value: number | null) {
  if (value == null || !Number.isFinite(value)) return '--';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function formatChange(value: number | null) {
  if (value == null || !Number.isFinite(value)) return '--';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}`;
}

function formatVolume(value: number | null) {
  if (value == null || !Number.isFinite(value)) return '--';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
}

// ---- Column config ----

const COLUMNS: { key: ScannerSortKey; label: string; align: 'left' | 'right' }[] = [
  { key: 'symbol', label: 'Ticker', align: 'left' },
  { key: 'lastPrice', label: 'Price', align: 'right' },
  { key: 'netChange', label: 'Change', align: 'right' },
  { key: 'netChangePercent', label: 'Change %', align: 'right' },
  { key: 'totalVolume', label: 'Volume', align: 'right' },
];

const PAGE_SIZE = 25;

// ---- Component ----

export default function ScannerSection({ refreshIntervalMs }: { refreshIntervalMs: number }) {
  const {
    filters,
    setFilters,
    sortBy,
    sortDir,
    toggleSort,
    results,
    loading,
    presets,
    savePreset,
    deletePreset,
    loadPreset,
    clearFilters,
    fetchResults,
  } = useScanner(refreshIntervalMs);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [page, setPage] = useState(1);

  // Reset page when results change
  useEffect(() => { setPage(1); }, [results.length]);

  // ---- Filter input handler ----
  // Reads the current filters object and updates a single field.
  // Empty string -> removes the field (undefined).
  const updateFilter = (key: string, raw: string) => {
    const value = raw.trim();
    if (value === '') {
      setFilters((prev) => {
        const next = { ...prev };
        delete (next as Record<string, unknown>)[key];
        return next;
      });
      return;
    }
    const num = Number(value);
    if (Number.isFinite(num)) {
      setFilters((prev) => ({ ...prev, [key]: num }));
    }
  };

  const handleSavePreset = () => {
    const name = presetName.trim();
    if (!name) return;
    void savePreset(name);
    setPresetName('');
  };

  // Count active filters for badge
  const activeFilterCount = [
    filters.minPrice, filters.maxPrice,
    filters.minChangePercent, filters.maxChangePercent,
    filters.minVolume, filters.assetType,
  ].filter((v) => v !== undefined).length;

  // Pagination
  const totalPages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = results.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-[#121214] p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-zinc-100">Scanner</h2>
          {loading && (
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          )}
        </div>
        <div className="flex items-center gap-2">
          <p className="text-sm text-zinc-500">{results.length} results</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setFiltersOpen((prev) => !prev)}
            className="border-white/10 bg-white/5 text-xs text-zinc-200 hover:bg-white/10"
          >
            Filters
            {activeFilterCount > 0 && (
              <span className="ml-1 rounded-full bg-emerald-500/20 px-1.5 text-[10px] text-emerald-400">
                {activeFilterCount}
              </span>
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void fetchResults()}
            className="border-white/10 bg-white/5 text-xs text-zinc-200 hover:bg-white/10"
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* Collapsible filter panel */}
      <AnimatePresence>
        {filtersOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 space-y-3">
              {/* Row 1: Price + Change % */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <label className="mb-1 block text-[11px] text-zinc-400">Min Price</label>
                  <Input
                    type="number"
                    step="any"
                    placeholder="0"
                    value={filters.minPrice ?? ''}
                    onChange={(e) => updateFilter('minPrice', e.target.value)}
                    className="h-8 border-white/10 bg-white/5 text-xs text-zinc-200"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-zinc-400">Max Price</label>
                  <Input
                    type="number"
                    step="any"
                    placeholder="any"
                    value={filters.maxPrice ?? ''}
                    onChange={(e) => updateFilter('maxPrice', e.target.value)}
                    className="h-8 border-white/10 bg-white/5 text-xs text-zinc-200"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-zinc-400">Min Change %</label>
                  <Input
                    type="number"
                    step="any"
                    placeholder="-100"
                    value={filters.minChangePercent ?? ''}
                    onChange={(e) => updateFilter('minChangePercent', e.target.value)}
                    className="h-8 border-white/10 bg-white/5 text-xs text-zinc-200"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-zinc-400">Max Change %</label>
                  <Input
                    type="number"
                    step="any"
                    placeholder="any"
                    value={filters.maxChangePercent ?? ''}
                    onChange={(e) => updateFilter('maxChangePercent', e.target.value)}
                    className="h-8 border-white/10 bg-white/5 text-xs text-zinc-200"
                  />
                </div>
              </div>

              {/* Row 2: Volume + Asset Type + Actions */}
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-32">
                  <label className="mb-1 block text-[11px] text-zinc-400">Min Volume</label>
                  <Input
                    type="number"
                    step="any"
                    placeholder="0"
                    value={filters.minVolume ?? ''}
                    onChange={(e) => updateFilter('minVolume', e.target.value)}
                    className="h-8 border-white/10 bg-white/5 text-xs text-zinc-200"
                  />
                </div>
                <div className="w-32">
                  <label className="mb-1 block text-[11px] text-zinc-400">Asset Type</label>
                  <Select
                    value={filters.assetType ?? 'all'}
                    onValueChange={(value) => {
                      if (value === 'all') {
                        setFilters((prev) => {
                          const next = { ...prev };
                          delete next.assetType;
                          return next;
                        });
                      } else {
                        setFilters((prev) => ({ ...prev, assetType: value }));
                      }
                    }}
                  >
                    <SelectTrigger className="h-8 border-white/10 bg-white/5 text-xs text-zinc-200">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="equity">Equity</SelectItem>
                      <SelectItem value="etf">ETF</SelectItem>
                      <SelectItem value="future">Future</SelectItem>
                      <SelectItem value="forex">Forex</SelectItem>
                      <SelectItem value="index">Index</SelectItem>
                      <SelectItem value="crypto">Crypto</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={clearFilters}
                  className="text-xs text-zinc-400 hover:text-zinc-200"
                >
                  Clear
                </Button>
              </div>

              {/* Presets row */}
              <div className="flex flex-wrap items-center gap-2 border-t border-white/5 pt-3">
                <span className="text-[11px] text-zinc-500">Presets:</span>
                {presets.map((preset) => (
                  <div key={preset.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => loadPreset(preset)}
                      className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-white/10"
                    >
                      {preset.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => void deletePreset(preset.id)}
                      className="text-[10px] text-zinc-500 hover:text-rose-400"
                      title="Delete preset"
                    >
                      x
                    </button>
                  </div>
                ))}
                <div className="flex items-center gap-1">
                  <Input
                    type="text"
                    placeholder="Preset name"
                    value={presetName}
                    onChange={(e) => setPresetName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSavePreset(); }}
                    className="h-6 w-28 border-white/10 bg-white/5 text-[11px] text-zinc-200"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleSavePreset}
                    disabled={!presetName.trim()}
                    className="text-[11px] text-emerald-400 hover:text-emerald-300"
                  >
                    Save
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Results table */}
      <div className="overflow-x-auto">
        <table className="min-w-full tabular-nums text-left text-sm">
          <thead>
            <tr className="border-b border-white/10 text-zinc-400">
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className={`cursor-pointer select-none px-2 py-2 hover:text-zinc-200 ${col.align === 'right' ? 'text-right' : ''}`}
                  onClick={() => toggleSort(col.key)}
                >
                  {col.label}
                  {sortBy === col.key && (
                    <span className="ml-1 text-emerald-400">
                      {sortDir === 'asc' ? '\u25B2' : '\u25BC'}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => {
              const positive = (row.netChangePercent ?? 0) >= 0;
              return (
                <tr key={row.symbol} className="border-b border-white/5 text-zinc-200">
                  <td className="px-2 py-2 font-medium">{row.symbol}</td>
                  <td className="px-2 py-2 text-right">{formatNumber(row.lastPrice)}</td>
                  <td className={`px-2 py-2 text-right ${positive ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {formatChange(row.netChange)}
                  </td>
                  <td className={`px-2 py-2 text-right ${positive ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {formatPercent(row.netChangePercent)}
                  </td>
                  <td className="px-2 py-2 text-right text-zinc-400">{formatVolume(row.totalVolume)}</td>
                </tr>
              );
            })}
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-2 py-4 text-zinc-500">
                  {loading ? 'Loading...' : 'No results. Adjust filters or wait for quote data.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-[11px] text-zinc-500">Page {safePage} of {totalPages}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              disabled={safePage <= 1}
              className="rounded border border-white/15 px-2 py-1 text-[11px] text-zinc-200 disabled:opacity-40"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={safePage >= totalPages}
              className="rounded border border-white/15 px-2 py-1 text-[11px] text-zinc-200 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

**Important implementation notes for opencode:**

1. The `Button` component's `size` prop — check what sizes exist in `components/ui/button.tsx`. The spec uses `size="sm"`. If only `"default"` and `"lg"` exist, either use `"default"` or add `"sm"` to the button variants. Check the existing MarketsTab for what button sizes it uses and match that.

2. The `SelectTrigger` — check if it accepts a `className` for height override. The existing select component in `components/ui/select.tsx` should support this via Radix.

3. The `motion` import — the project uses `motion/react` (not `framer-motion`). This is already used in MarketsTab, so follow the same import pattern.

**Acceptance criteria:**
- Component renders scanner header, collapsible filter panel, sortable table, pagination
- Clicking "Filters" toggles the filter panel with smooth animation
- Changing any filter input triggers a re-fetch
- Clicking column headers toggles sort direction (emerald arrow indicator)
- Preset save/load/delete all work
- Pagination works at 25 rows per page
- Styling matches MarketsTab dark theme (same border colors, bg, text colors)
- `npm run lint && npx tsc --noEmit` passes

**Dependencies:** Change 4 (hook must exist)

---

## Change 6: Integrate ScannerSection into MarketsTab

**File:** `components/trading/MarketsTab.tsx`
**Action:** MODIFY

Two small changes:

**1. Add import** at the top of the file, after existing imports:

```typescript
import ScannerSection from '@/components/trading/ScannerSection';
```

**2. Add JSX** between the Market Movers closing `</div>` and the Macro Summary opening `<div>`. Look for the closing `</div>` of the Market Movers section (the one that contains the gainers/losers tables) and insert after it:

```tsx
<ScannerSection refreshIntervalMs={dataSource === 'realtime' ? 5_000 : 60_000} />
```

The `dataSource` variable already exists in the component — it's set based on the snapshot API response.

**Acceptance criteria:**
- `ScannerSection` appears between Market Movers and Macro Summary
- Receives correct `refreshIntervalMs` based on `dataSource`
- No changes to existing MarketsTab behavior
- `npm run lint && npx tsc --noEmit` passes

**Dependencies:** Change 5 (ScannerSection must exist)

---

## Post-Implementation Checklist

After all 6 changes are complete:

```bash
npm run lint && npx tsc --noEmit
npm run dev  # Manual test the full flow
```

**Manual tests:**
- [ ] Navigate to Markets tab — scanner section visible below movers
- [ ] Expand filters — inputs render in grid layout
- [ ] Set min price = 1 — results update
- [ ] Click column header to sort — arrow indicator shows, results reorder
- [ ] Save a preset — it appears in the presets row
- [ ] Reload page — preset persists
- [ ] Load a preset — filter inputs populate, results update
- [ ] Delete a preset — it disappears
- [ ] `GET /api/scanner` returns 401 when not authenticated
- [ ] `GET /api/scanner?minPrice=5&maxPrice=50&minVolume=100000` returns filtered results

## Update CLAUDE.md After Completion

1. **Tables section:** Change `(17)` to `(18)`, add `scanner_presets` to the list
2. **API Routes section:** Add:
   ```
   ## Scanner
   - GET `/api/scanner` (query realtime_quotes with filters)
   - GET/POST/DELETE `/api/scanner/presets`
   ```

## Rollback Plan

1. Delete: `app/api/scanner/route.ts`, `app/api/scanner/presets/route.ts`, `hooks/use-scanner.ts`, `components/trading/ScannerSection.tsx`
2. Remove `scannerPresets` export from `lib/db/schema.ts`
3. Remove the `ScannerSection` import and JSX line from `MarketsTab.tsx`
4. DB table can remain (empty, no side effects) or drop: `DROP TABLE IF EXISTS scanner_presets;`

# Nexus Terminal — HANDOFF.md

> Updated: 2026-04-27
> Purpose: brief summary of recently completed work plus any active execution spec. Older implementation detail lives in git history and `specs/`.
> Historical completed sections were archived to keep this file focused. Recent ships: Agent Hardening #1 (`7118598`), #2 (`2a856f1`), #3 (`bf13567`); Research agent report refinements (`9a69655`, 2026-04-17); Trade Journal Enhancement (DRC + Weekly Review + Archive tab) across `4757fa3`/`0e41b5a`/`8dd6b12`/`fe97e8c`/`c300153` (2026-04-19→20); Tighten Trading Journal UI (`f1fde41`, 2026-04-20); Spend Enforcement Fix across `7aad160`/`abdefe9`/`1bd5e1e`/`8ad674e`/`9f0a123` (2026-04-20); Research Gap-Stats Parser + Redundancy Fix (`0e96e16`, 2026-04-22); Research Chart History Polish (`5fc5b9e`, 2026-04-22); System Sheet Sync (`63c3a3b` + `a694797`, 2026-04-23); AskEdgar Gap-Stats Mapper Fix (`aa3ea65`, 2026-04-24); AskEdgar Conditional Fan-Out + Cost Telemetry (`29a3820`, 2026-04-27); SEC EDGAR Foundations + Filing-Titles Replacement (`b4a3e73` + `2fb02ab`, 2026-04-27, **COMPLETE 2026-04-27**).

## Current State

**Active spec: AskEdgar Sprint 2 (IMPLEMENTED; pending manual migration apply).** See "Active Spec" section below. Sprint 1 (SEC EDGAR foundations + `filing-titles` swap) is COMPLETE: shipped in `b4a3e73` + `2fb02ab`, migration `0023_abnormal_ser_duncan.sql` applied to Neon via `npm run db:migrate`, smoke-tested with ZZZZZ (no-CIK warning fired, report still completed empty as expected) and GLND (real filings rendered).

## Validation Snapshot

Most recent validation (`2026-04-27`, AskEdgar Sprint 2 implementation):

- `npm run lint` — passed
- `npx tsc --noEmit` — passed
- `npm test -- sec-companyfacts` — passed (1 file, 11 tests)
- `npm test -- agent-blueprints` — passed (1 file, 42 tests)
- `npm test -- askedgar-client` — passed (1 file, 14 tests)
- `npm test` — passed (59 files, 458 tests)
- `npm run workflow:audit` — passed; rerun after HANDOFF status update
- `git diff --check` — passed
- `npm run db:migrate` — not run; Jared applies `0024_acoustic_jocasta.sql` manually to Neon

## Follow-Up Notes

- **Financial commentary missing in agent output (logged 2026-04-27).** GLND research report from a Sprint 1 smoke run claimed "no financial commentary available," which is almost never true for a real ticker. Desired behavior: agents should surface the source commentary **verbatim** in the report, then add their own analysis on top — not replace the source text with a summary. Investigate which AskEdgar/SEC field feeds the "financial commentary" section and why the agent suppressed it. Likely candidates: `dilution-data` notes, MD&A sections from 10-Q/10-K, or the `news` endpoint's commentary field. Not Sprint 2 scope; track separately.
- **AskEdgar paid API migration (today, Monday 2026-04-27).** Test key expires today. `https://eapi.askedgar.io` remains the correct base URL — the readme.io docs list `https://api.askedgar.com`, which redirects to a HugeDomains parking page. Only swap the `ASKEDGAR_API_KEY` env var; do not touch `ASKEDGAR_BASE_URL` in `lib/askedgar.ts`.
- **Cost-per-report baseline.** Sprint 1 dropped `filing-titles` from the AskEdgar fan-out, so projected daily spend at ~10 unique tickers/day falls below the post-trim ~$5–$10/day estimate. Measure with the `[askedgar-fanout]` log's `costUsd` token over the next few report runs.
- **News-formatter UX trade.** Filing feeds now default to `${formType} filing` labels (e.g. "8-K filing") via the existing fallback in `lib/agents/news-formatter.ts:198`. AI headlines are deferred to buildout-doc Phase 8 (`docs/ae-buildout.md:396`).

## Active Spec: AskEdgar Sprint 2 — `historical-float-pro` via XBRL companyfacts

> Generated: 2026-04-27 | Agent: nexus-architect
> Status: IMPLEMENTED 2026-04-27; validation passed; `npm run db:migrate` intentionally not run

Replace AskEdgar's `/v1/historical-float-pro` with a Nexus-owned `lib/sec/companyfacts.ts` module that fetches SEC XBRL companyfacts and emits historical outstanding-share snapshots. Same `ENDPOINT_REGISTRY` key, same `AskEdgarResponse<T>` shape. `float` and `tradableFloat` pass through as null; blueprint normalizers fall back to `outstanding`.

After Sprint 2, the planned 8-K parsing trio (`offerings`, `reverse-splits`, `split-status`) reuses the EDGAR client and starts wiring the buildout doc's "first-wave candidates" checklist (`docs/ae-buildout.md:58`).

---

### Step 1 — Schema change

**File:** `lib/db/schema.ts`
**Action:** MODIFY

1. Verify the import on line 1 already includes `pgTable`, `text`, `timestamp`, `jsonb`, and `index`. It does — no import changes needed.
2. After the closing `]);` of the `secTickerCik` definition (line 222), insert:

```ts
// SEC companyfacts cache — full raw XBRL JSON keyed by CIK.
// ~3-5 MB per entry; Postgres TOAST handles compression automatically.
// TTL: 24h soft expiry enforced in lib/sec/companyfacts.ts.
export const secCompanyfactsCache = pgTable('sec_companyfacts_cache', {
  cik: text('cik').primaryKey(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).defaultNow().notNull(),
  payload: jsonb('payload').notNull(),
}, (table) => [
  index('sec_companyfacts_cache_fetched_idx').on(table.fetchedAt),
]);
```

**Acceptance criteria:**
- [x] `secCompanyfactsCache` is exported from `lib/db/schema.ts`.
- [x] `npx tsc --noEmit` passes.

---

### Step 2 — Generate migration

**Action:** RUN COMMAND (do not hand-edit migration SQL)

1. From repo root, run: `npm run db:generate`
2. Confirm a new file matching `drizzle/0024_*.sql` was created. Read it to verify it contains:
   - `CREATE TABLE "sec_companyfacts_cache"` with columns `cik TEXT PRIMARY KEY`, `fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `payload JSONB NOT NULL`.
   - A `CREATE INDEX` on `fetched_at`.
   - **No `GIN` index.**
3. Confirm `drizzle/meta/_journal.json` lists `0024` as the latest entry.
4. Confirm `drizzle/meta/0024_snapshot.json` was created.
5. Stage the SQL file and the updated meta files. **DO NOT run `npm run db:migrate`.**

**Acceptance criteria:**
- [x] `drizzle/0024_*.sql` exists with the expected DDL and no GIN index.
- [x] `drizzle/meta/_journal.json` lists `0024` as latest.
- [x] `drizzle/meta/0024_snapshot.json` exists.

---

### Step 3 — New SEC module

**File:** `lib/sec/companyfacts.ts`
**Action:** CREATE

```ts
import { sql } from 'drizzle-orm';

import { getDb } from '@/lib/db';
import { secCompanyfactsCache } from '@/lib/db/schema';
import { SecHttpError, secFetchJson } from '@/lib/sec/client';
import { getCikForTicker, padCik } from '@/lib/sec/cik-map';

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface ShareSnapshot {
  date: string;
  outstanding: number;
}

export interface CompanyFactsResponse {
  status: 'success' | 'error';
  count: number;
  results: ShareSnapshot[];
  error?: string;
}

interface FactEntry {
  end: string;
  val: number;
  filed: string;
  accn: string;
  frame?: string;
}

interface CompanyFactsPayload {
  facts: {
    dei?: {
      EntityCommonStockSharesOutstanding?: {
        units?: { shares?: FactEntry[] };
      };
    };
    'us-gaap'?: {
      CommonStockSharesOutstanding?: {
        units?: { shares?: FactEntry[] };
      };
      CommonStockSharesIssued?: {
        units?: { shares?: FactEntry[] };
      };
    };
  };
}

// Picks the first non-empty shares array from the concept fallback chain.
// Bracket notation on 'us-gaap' is required because of the hyphen.
// Dual-class issuers: companyfacts strips per-class dimensions; the chain
// returns the aggregate total naturally without special handling.
function pickShareEntries(facts: CompanyFactsPayload['facts']): FactEntry[] {
  const candidates = [
    facts.dei?.EntityCommonStockSharesOutstanding?.units?.shares,
    facts['us-gaap']?.CommonStockSharesOutstanding?.units?.shares,
    facts['us-gaap']?.CommonStockSharesIssued?.units?.shares,
  ];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length > 0) return c;
  }
  return [];
}

// Dedupes entries that share the same `end` date.
// Priority: (1) entry where frame !== undefined (SEC's canonical pick);
// (2) latest filed date; (3) lexicographically greatest accn.
// NEVER uses max val — that breaks reverse splits and silent restatements.
function dedupeByEnd(entries: FactEntry[]): FactEntry[] {
  const byEnd = new Map<string, FactEntry>();
  for (const entry of entries) {
    const existing = byEnd.get(entry.end);
    if (!existing) {
      byEnd.set(entry.end, entry);
      continue;
    }
    const existingHasFrame = existing.frame !== undefined;
    const entryHasFrame = entry.frame !== undefined;
    if (entryHasFrame && !existingHasFrame) { byEnd.set(entry.end, entry); continue; }
    if (!entryHasFrame && existingHasFrame) { continue; }
    if (entry.filed > existing.filed) { byEnd.set(entry.end, entry); continue; }
    if (entry.filed < existing.filed) { continue; }
    if (entry.accn > existing.accn) { byEnd.set(entry.end, entry); }
  }
  return Array.from(byEnd.values());
}

async function hydrateFromDb(cik: string): Promise<{ payload: CompanyFactsPayload; fetchedAt: Date } | null> {
  const db = getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(secCompanyfactsCache)
    .where(sql`${secCompanyfactsCache.cik} = ${cik}`);
  const row = rows[0];
  if (!row) return null;
  return { payload: row.payload as CompanyFactsPayload, fetchedAt: row.fetchedAt };
}

async function persistCache(cik: string, payload: CompanyFactsPayload): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db
    .insert(secCompanyfactsCache)
    .values({ cik, fetchedAt: new Date(), payload })
    .onConflictDoUpdate({
      target: secCompanyfactsCache.cik,
      set: {
        fetchedAt: sql`excluded.fetched_at`,
        payload: sql`excluded.payload`,
      },
    });
}

function parsePayload(payload: CompanyFactsPayload, limit: number): ShareSnapshot[] {
  const entries = pickShareEntries(payload.facts);
  const deduped = dedupeByEnd(entries);
  deduped.sort((a, b) => (a.end < b.end ? 1 : a.end > b.end ? -1 : 0));
  return deduped.slice(0, limit).map((e) => ({ date: e.end, outstanding: e.val }));
}

export async function getHistoricalOutstanding(
  rawTicker: string,
  options?: { limit?: number },
): Promise<CompanyFactsResponse> {
  const limit = options?.limit ?? 20;

  const entry = await getCikForTicker(rawTicker);
  if (!entry) {
    console.warn(`[sec-companyfacts] no CIK for ticker ${rawTicker}`);
    return { status: 'success', count: 0, results: [] };
  }
  const { cik } = entry;
  const ticker = rawTicker.trim().toUpperCase();

  const cached = await hydrateFromDb(cik);
  if (cached && Date.now() - cached.fetchedAt.getTime() < TTL_MS) {
    const results = parsePayload(cached.payload, limit);
    console.log(`[sec-companyfacts] hydrated ${results.length} entries from db for ${ticker}`);
    return { status: 'success', count: results.length, results };
  }

  const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${padCik(cik)}.json`;
  try {
    const payload = await secFetchJson<CompanyFactsPayload>(url);
    await persistCache(cik, payload).catch((err) => {
      console.warn('[sec-companyfacts] persist failed:', err);
    });
    const results = parsePayload(payload, limit);
    console.log(`[sec-companyfacts] loaded ${results.length} entries from SEC for ${ticker}`);
    return { status: 'success', count: results.length, results };
  } catch (err) {
    if (err instanceof SecHttpError && err.status === 404) {
      console.warn(`[sec-companyfacts] no companyfacts for CIK ${cik}`);
      return { status: 'success', count: 0, results: [] };
    }
    if (cached) {
      const results = parsePayload(cached.payload, limit);
      console.warn(`[sec-companyfacts] SEC failed, serving stale cache for ${ticker}`);
      return { status: 'success', count: results.length, results };
    }
    const message = err instanceof Error ? err.message : 'SEC fetch failed';
    return { status: 'error', count: 0, results: [], error: message };
  }
}
```

**Acceptance criteria:**
- [x] File exists at `lib/sec/companyfacts.ts`.
- [x] Exports `ShareSnapshot`, `CompanyFactsResponse`, and `getHistoricalOutstanding`.
- [x] `npx tsc --noEmit` passes.

---

### Step 4 — Registry swap in `lib/askedgar.ts`

**File:** `lib/askedgar.ts`
**Action:** MODIFY

1. After line 6 (`import { getRecentFilings } from '@/lib/sec/submissions';`), insert:
   ```ts
   import { getHistoricalOutstanding } from '@/lib/sec/companyfacts';
   ```
2. **Delete** the `fetchHistoricalFloatPro` function in its entirety (lines 438–442):
   ```ts
   async function fetchHistoricalFloatPro(ticker: string, limit = 20) {
     const validated = validateTickerOrError<unknown>(ticker);
     if (typeof validated !== 'string') return validated;
     return requestAskEdgar<unknown>('/v1/historical-float-pro', { ticker: validated, limit });
   }
   ```
3. In `ENDPOINT_REGISTRY` (line 480), replace the `'historical-float-pro'` entry's `run`:
   - Old: `run: (ticker) => fetchHistoricalFloatPro(ticker, 20)`
   - New: `run: (ticker) => getHistoricalOutstanding(ticker, { limit: 20 })`

**Acceptance criteria:**
- [x] `fetchHistoricalFloatPro` is no longer present anywhere in `lib/askedgar.ts`.
- [x] `getHistoricalOutstanding` is imported and used in the registry.
- [x] `ENDPOINT_SCOPES` arrays at lines 501 and 506 still include `'historical-float-pro'` (unchanged).
- [x] `npx tsc --noEmit` passes.

---

### Step 5 — Mapper verification (NO CODE CHANGE)

**File:** `lib/askedgar.ts:887-895`
**Action:** VERIFY ONLY

1. Re-read lines 887–895.
2. Confirm `getField(row, ['outstandingShares', 'outstanding_shares', 'outstanding'])` is present — matches our `outstanding` field.
3. Confirm `float` and `tradableFloat` resolve to `null` (correct).
4. Make zero edits.

**Acceptance criteria:**
- [x] Codex's run log explicitly notes that lines 887–895 were read and match expected key list.
- [x] No edits were made to this block.

---

### Step 6 — Blueprint normalizer (swing-trader-research)

**File:** `lib/agents/blueprints/swing-trader-research.ts`
**Action:** MODIFY

Locate `normalizeHistoricalFloatRow` (lines 438–454). On line 447, replace:
```ts
const floatValue = getNumberField(value, ['float', 'tradableFloat', 'tradable_float']);
```
with:
```ts
// Sprint 2 — historical-float-pro now sources outstanding shares from SEC XBRL companyfacts;
// float/tradable are null and we fall back to outstanding for trend computation.
const floatValue = getNumberField(value, ['float', 'tradableFloat', 'tradable_float', 'outstanding', 'outstandingShares', 'outstanding_shares']);
```

**Acceptance criteria:**
- [x] Key list includes `'outstanding'`, `'outstandingShares'`, `'outstanding_shares'`.
- [x] Sprint 2 comment is on the line immediately above.
- [x] `npx tsc --noEmit` passes.

---

### Step 7 — Blueprint normalizer (small-cap-research)

**File:** `lib/agents/blueprints/small-cap-research.ts`
**Action:** MODIFY

Locate `normalizeHistoricalFloatRow` (lines 408–424). On line 417, replace:
```ts
const floatValue = getNumberField(value, ['float', 'tradableFloat', 'tradable_float']);
```
with:
```ts
// Sprint 2 — historical-float-pro now sources outstanding shares from SEC XBRL companyfacts;
// float/tradable are null and we fall back to outstanding for trend computation.
const floatValue = getNumberField(value, ['float', 'tradableFloat', 'tradable_float', 'outstanding', 'outstandingShares', 'outstanding_shares']);
```

**Acceptance criteria:**
- [x] Key list includes `'outstanding'`, `'outstandingShares'`, `'outstanding_shares'`.
- [x] Sprint 2 comment is on the line immediately above.
- [x] `npx tsc --noEmit` passes.

---

### Step 8 — New test file

**File:** `__tests__/sec-companyfacts.test.ts`
**Action:** CREATE

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SecHttpError } from '@/lib/sec/client';

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));

vi.mock('@/lib/db', async () => {
  const actual = await vi.importActual<typeof import('@/lib/db')>('@/lib/db');
  return { ...actual, getDb: getDbMock };
});

vi.mock('@/lib/sec/cik-map', () => ({
  getCikForTicker: vi.fn(),
  padCik: (cik: string | number) => String(cik).padStart(10, '0'),
}));

function emptyDb() {
  return {
    select: () => ({ from: () => ({ where: async () => [] }) }),
    insert: () => ({ values: () => ({ onConflictDoUpdate: async () => undefined }) }),
  };
}

function dbWithRow(row: { cik: string; fetchedAt: Date; payload: unknown }) {
  return {
    select: () => ({ from: () => ({ where: async () => [row] }) }),
    insert: () => ({ values: () => ({ onConflictDoUpdate: async () => undefined }) }),
  };
}

function makeFacts(override?: {
  deiShares?: { end: string; val: number; filed: string; accn: string; frame?: string }[];
  gaapOutstanding?: { end: string; val: number; filed: string; accn: string; frame?: string }[];
  gaapIssued?: { end: string; val: number; filed: string; accn: string; frame?: string }[];
}) {
  const facts: Record<string, unknown> = {};
  if (override?.deiShares) {
    facts['dei'] = {
      EntityCommonStockSharesOutstanding: { units: { shares: override.deiShares } },
    };
  }
  if (override?.gaapOutstanding || override?.gaapIssued) {
    facts['us-gaap'] = {
      ...(override.gaapOutstanding
        ? { CommonStockSharesOutstanding: { units: { shares: override.gaapOutstanding } } }
        : {}),
      ...(override.gaapIssued
        ? { CommonStockSharesIssued: { units: { shares: override.gaapIssued } } }
        : {}),
    };
  }
  return { facts };
}

function mockFetch(payload: unknown) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(payload), { status: 200 }),
  );
}

function mockFetchError(status: number) {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(
    new SecHttpError(status, `SEC ${status}`),
  );
}

describe('sec-companyfacts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.resetModules();
    getDbMock.mockReset();
    getDbMock.mockReturnValue(emptyDb());
  });

  it('returns dei entries when EntityCommonStockSharesOutstanding is present', async () => {
    const { getCikForTicker } = await import('@/lib/sec/cik-map');
    vi.mocked(getCikForTicker).mockResolvedValue({ ticker: 'AAPL', cik: '0000320193', name: 'Apple', exchange: 'Nasdaq' });
    mockFetch(makeFacts({ deiShares: [{ end: '2024-09-30', val: 15_000_000, filed: '2024-10-01', accn: 'A001' }] }));
    const mod = await import('@/lib/sec/companyfacts');
    const result = await mod.getHistoricalOutstanding('AAPL');
    expect(result.status).toBe('success');
    expect(result.results[0]).toMatchObject({ date: '2024-09-30', outstanding: 15_000_000 });
  });

  it('falls back to us-gaap CommonStockSharesOutstanding when dei is empty', async () => {
    const { getCikForTicker } = await import('@/lib/sec/cik-map');
    vi.mocked(getCikForTicker).mockResolvedValue({ ticker: 'AAPL', cik: '0000320193', name: 'Apple', exchange: 'Nasdaq' });
    mockFetch(makeFacts({ deiShares: [], gaapOutstanding: [{ end: '2024-09-30', val: 9_000_000, filed: '2024-10-01', accn: 'B001' }] }));
    const mod = await import('@/lib/sec/companyfacts');
    const result = await mod.getHistoricalOutstanding('AAPL');
    expect(result.status).toBe('success');
    expect(result.results[0]).toMatchObject({ date: '2024-09-30', outstanding: 9_000_000 });
  });

  it('falls back to CommonStockSharesIssued when dei and Outstanding are empty', async () => {
    const { getCikForTicker } = await import('@/lib/sec/cik-map');
    vi.mocked(getCikForTicker).mockResolvedValue({ ticker: 'GLND', cik: '0001234567', name: 'Galena', exchange: 'Nasdaq' });
    mockFetch(makeFacts({ deiShares: [], gaapOutstanding: [], gaapIssued: [{ end: '2024-06-30', val: 4_000_000, filed: '2024-07-15', accn: 'C001' }] }));
    const mod = await import('@/lib/sec/companyfacts');
    const result = await mod.getHistoricalOutstanding('GLND');
    expect(result.status).toBe('success');
    expect(result.results[0]).toMatchObject({ date: '2024-06-30', outstanding: 4_000_000 });
  });

  it('prefers framed entry over unframed for the same end date', async () => {
    const { getCikForTicker } = await import('@/lib/sec/cik-map');
    vi.mocked(getCikForTicker).mockResolvedValue({ ticker: 'AAPL', cik: '0000320193', name: 'Apple', exchange: 'Nasdaq' });
    mockFetch(makeFacts({
      deiShares: [
        { end: '2025-09-30', val: 10_000_000, filed: '2025-10-01', accn: 'D001' },
        { end: '2025-09-30', val: 11_000_000, filed: '2025-10-05', accn: 'D002', frame: 'CY2025Q3I' },
      ],
    }));
    const mod = await import('@/lib/sec/companyfacts');
    const result = await mod.getHistoricalOutstanding('AAPL');
    expect(result.results[0]).toMatchObject({ date: '2025-09-30', outstanding: 11_000_000 });
  });

  it('picks entry with later filed date when no frame is present', async () => {
    const { getCikForTicker } = await import('@/lib/sec/cik-map');
    vi.mocked(getCikForTicker).mockResolvedValue({ ticker: 'AAPL', cik: '0000320193', name: 'Apple', exchange: 'Nasdaq' });
    mockFetch(makeFacts({
      deiShares: [
        { end: '2025-03-31', val: 5_000_000, filed: '2025-04-01', accn: 'E001' },
        { end: '2025-03-31', val: 5_100_000, filed: '2025-04-15', accn: 'E002' },
      ],
    }));
    const mod = await import('@/lib/sec/companyfacts');
    const result = await mod.getHistoricalOutstanding('AAPL');
    expect(result.results[0]).toMatchObject({ date: '2025-03-31', outstanding: 5_100_000 });
  });

  it('limits results to 20 by default', async () => {
    const { getCikForTicker } = await import('@/lib/sec/cik-map');
    vi.mocked(getCikForTicker).mockResolvedValue({ ticker: 'AAPL', cik: '0000320193', name: 'Apple', exchange: 'Nasdaq' });
    const shares = Array.from({ length: 30 }, (_, i) => ({
      end: `202${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-28`,
      val: 1_000_000 + i,
      filed: `202${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-30`,
      accn: `F${String(i).padStart(3, '0')}`,
    }));
    mockFetch(makeFacts({ deiShares: shares }));
    const mod = await import('@/lib/sec/companyfacts');
    const result = await mod.getHistoricalOutstanding('AAPL');
    expect(result.results.length).toBe(20);
  });

  it('returns results sorted newest-first', async () => {
    const { getCikForTicker } = await import('@/lib/sec/cik-map');
    vi.mocked(getCikForTicker).mockResolvedValue({ ticker: 'AAPL', cik: '0000320193', name: 'Apple', exchange: 'Nasdaq' });
    mockFetch(makeFacts({
      deiShares: [
        { end: '2023-12-31', val: 1_000_000, filed: '2024-01-15', accn: 'G001' },
        { end: '2024-12-31', val: 2_000_000, filed: '2025-01-15', accn: 'G002' },
        { end: '2024-06-30', val: 1_500_000, filed: '2024-07-15', accn: 'G003' },
      ],
    }));
    const mod = await import('@/lib/sec/companyfacts');
    const result = await mod.getHistoricalOutstanding('AAPL');
    expect(result.results[0].date).toBe('2024-12-31');
    expect(result.results[1].date).toBe('2024-06-30');
    expect(result.results[2].date).toBe('2023-12-31');
  });

  it('returns success-empty and warns when CIK is not found', async () => {
    const { getCikForTicker } = await import('@/lib/sec/cik-map');
    vi.mocked(getCikForTicker).mockResolvedValue(null);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await import('@/lib/sec/companyfacts');
    const result = await mod.getHistoricalOutstanding('ZZZZZ');
    expect(result).toMatchObject({ status: 'success', count: 0, results: [] });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[sec-companyfacts] no CIK for ticker ZZZZZ'));
  });

  it('returns success-empty and warns on SEC 404', async () => {
    const { getCikForTicker } = await import('@/lib/sec/cik-map');
    vi.mocked(getCikForTicker).mockResolvedValue({ ticker: 'FAKE', cik: '0000000001', name: 'Fake Co', exchange: null });
    mockFetchError(404);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await import('@/lib/sec/companyfacts');
    const result = await mod.getHistoricalOutstanding('FAKE');
    expect(result).toMatchObject({ status: 'success', count: 0, results: [] });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[sec-companyfacts] no companyfacts for CIK 0000000001'));
  });

  it('serves stale cache and warns when SEC fails and stale row exists', async () => {
    const { getCikForTicker } = await import('@/lib/sec/cik-map');
    vi.mocked(getCikForTicker).mockResolvedValue({ ticker: 'STALE', cik: '0000000002', name: 'Stale Co', exchange: null });
    const stalePayload = makeFacts({ deiShares: [{ end: '2024-01-01', val: 7_000_000, filed: '2024-01-10', accn: 'H001' }] });
    getDbMock.mockReturnValue(
      dbWithRow({ cik: '0000000002', fetchedAt: new Date(Date.now() - 48 * 60 * 60 * 1000), payload: stalePayload }),
    );
    mockFetchError(503);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await import('@/lib/sec/companyfacts');
    const result = await mod.getHistoricalOutstanding('STALE');
    expect(result.status).toBe('success');
    expect(result.results[0]).toMatchObject({ date: '2024-01-01', outstanding: 7_000_000 });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[sec-companyfacts] SEC failed, serving stale cache for STALE'));
  });

  it('returns cached data without calling fetch when cache is fresh', async () => {
    const { getCikForTicker } = await import('@/lib/sec/cik-map');
    vi.mocked(getCikForTicker).mockResolvedValue({ ticker: 'WARM', cik: '0000000003', name: 'Warm Co', exchange: null });
    const freshPayload = makeFacts({ deiShares: [{ end: '2025-03-31', val: 8_000_000, filed: '2025-04-01', accn: 'I001' }] });
    getDbMock.mockReturnValue(
      dbWithRow({ cik: '0000000003', fetchedAt: new Date(Date.now() - 60 * 60 * 1000), payload: freshPayload }),
    );
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const mod = await import('@/lib/sec/companyfacts');
    const result = await mod.getHistoricalOutstanding('WARM');
    expect(result.status).toBe('success');
    expect(result.results[0]).toMatchObject({ date: '2025-03-31', outstanding: 8_000_000 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
```

**Acceptance criteria:**
- [x] File exists at `__tests__/sec-companyfacts.test.ts`.
- [x] All 11 cases pass under `npm test -- sec-companyfacts`.

---

### Step 9 — Existing test verification

**File:** `__tests__/agent-blueprints.test.ts`
**Action:** VERIFY ONLY (no edits unless test fails)

1. Run `npm test -- agent-blueprints`.
2. The test mocks `@/lib/askedgar` wholesale, so the registry-key-unchanged change requires no mock update.
3. If all tests pass, make no changes.
4. If any test fails due solely to the `normalizeHistoricalFloatRow` key-list change, update only the relevant fixture or mock value to supply an `outstanding` field instead of a `float` field.

**Acceptance criteria:**
- [x] `agent-blueprints.test.ts` passes with no regressions.

---

### Validation Block

Run in this exact order from repo root:

1. `npm run lint` — must pass.
2. `npx tsc --noEmit` — must pass.
3. `npm test` — must pass; `sec-companyfacts.test.ts` shows 11 passing cases; `agent-blueprints.test.ts` shows no regressions.
4. `npm run workflow:audit` — must pass.

Pre-deploy log strings that must appear in the new module's source (greppable):
- `[sec-companyfacts] loaded N entries from SEC for`
- `[sec-companyfacts] hydrated N entries from db for`
- `[sec-companyfacts] SEC failed, serving stale cache for`
- `[sec-companyfacts] no companyfacts for CIK`
- `[sec-companyfacts] no CIK for ticker`

**DO NOT run `npm run db:migrate`.** Jared applies it manually to Neon before pushing.

---

### Files Changed Summary

| File | Action | Risk | Est. LOC |
|---|---|---|---|
| `lib/db/schema.ts` | MODIFY | low | +10 |
| `drizzle/0024_*.sql` | CREATE (generated) | low | ~10 |
| `drizzle/meta/_journal.json` | MODIFY (generated) | low | ~5 |
| `drizzle/meta/0024_snapshot.json` | CREATE (generated) | low | ~50 |
| `lib/sec/companyfacts.ts` | CREATE | med | ~165 |
| `lib/askedgar.ts` | MODIFY | med | -5/+2 |
| `lib/agents/blueprints/swing-trader-research.ts` | MODIFY | low | +2 |
| `lib/agents/blueprints/small-cap-research.ts` | MODIFY | low | +2 |
| `__tests__/sec-companyfacts.test.ts` | CREATE | low | ~225 |

**Complexity: MEDIUM.**

---

### Out of scope (defer to buildout-doc Phase 3)

- Float and tradable-float reconstruction (cover-page parsing, ownership-based estimates).
- A separate `sec_share_snapshots` derived table.
- Per-class breakdown UI/types.
- Other endpoint replacements (`offerings`, `reverse-splits`, `split-status`).

---

### Pre-push Reminders for Jared

- Run `npm run db:migrate` against Neon before `git push`. (`db:push` is forbidden — known false positive on this repo's composite PKs.)
- First production request after deploy: log shows `[sec-companyfacts] loaded N entries from SEC for {ticker}` (cold).
- Subsequent request within 24h for the same ticker: log shows `[sec-companyfacts] hydrated N entries from db for {ticker}` (warm).
- Smoke on bad ticker (`ZZZZZ`): `[sec-companyfacts] no CIK for ticker ZZZZZ` warn fires; report still completes empty.
- Smoke on a real ticker (`GLND` or `AAPL`): Research view "history" tab renders ≥1 outstanding row.

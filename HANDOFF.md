# Nexus Terminal — HANDOFF.md

> Updated: 2026-04-27
> Purpose: brief summary of recently completed work plus any active execution spec. Older implementation detail lives in git history and `specs/`.
> Historical completed sections were archived to keep this file focused. Agent Hardening #1 shipped in `7118598`; Agent Hardening #2 in `2a856f1`; Agent Hardening #3 in `bf13567`; Research agent report refinements in `9a69655` (2026-04-17); Trade Journal Enhancement (DRC + Weekly Review + Archive tab) shipped across `4757fa3`, `0e41b5a`, `8dd6b12`, `fe97e8c`, `c300153` (2026-04-19 → 2026-04-20); Tighten Trading Journal UI shipped in `f1fde41` (2026-04-20); Spend Enforcement Fix shipped across `7aad160`, `abdefe9`, `1bd5e1e`, `8ad674e`, `9f0a123` (2026-04-20); Research Gap-Stats Parser + Redundancy Fix shipped in `0e96e16` (2026-04-22); Research Chart History Polish shipped in `5fc5b9e` (2026-04-22); System Sheet Sync shipped in `63c3a3b` + `a694797` (2026-04-23); AskEdgar Gap-Stats Mapper Fix shipped in `aa3ea65` (2026-04-24); AskEdgar Conditional Fan-Out + Cost Telemetry shipped in `29a3820` (2026-04-27). See git history for full records.

## Current State

**Active spec:** SEC EDGAR Foundations + Filing-Titles Replacement (AskEdgar Sprint 1) — IMPLEMENTED + VALIDATED (2026-04-27), pending review/commit.

## Validation Snapshot

Most recent validation (`2026-04-27`, SEC EDGAR Foundations + Filing-Titles Replacement):

- `npm run lint` — passed
- `npx tsc --noEmit` — passed
- `npm test` — passed (`58` files, `447` tests)
- `npx vitest run __tests__/sec-client.test.ts __tests__/sec-cik-map.test.ts __tests__/sec-submissions.test.ts __tests__/askedgar-client.test.ts __tests__/news-formatter.test.ts` — passed (`5` files, `35` tests)
- `npm run workflow:audit` — passed

## Follow-Up Notes

- **AskEdgar paid API migration (Monday 2026-04-27).** Test key expires Monday. `https://eapi.askedgar.io` remains the correct base URL — the readme.io docs list `https://api.askedgar.com`, which redirects to a HugeDomains parking page. Only swap the `ASKEDGAR_API_KEY` env var; do not touch `ASKEDGAR_BASE_URL` in `lib/askedgar.ts:53`.
- **Cost-per-report baseline.** With Sprint 1 removing `filing-titles` from the AskEdgar fan-out (~$1.56 upper bound saved per fresh ticker), the projected daily spend at ~10 unique tickers/day drops further from the post-trim ~$5–$10/day estimate. Measure with the `[askedgar-fanout]` log's `costUsd` token.
- **Ask Edgar replacement research** is in `docs/ae-buildout.md`. `FUTURE-PLANS.md` and `AGENTIC_EXPANSIONV2.md` live under `docs/`.
- **Sprint roadmap.** Sprint 1 (this spec): EDGAR client + CIK map + `filing-titles` swap. Sprint 2 (planned): `historical-float-pro` via XBRL companyfacts. Sprint 3+: 8-K parsing trio (`offerings`, `reverse-splits`, `split-status`) reusing the EDGAR client.
- **News-formatter UX side effect.** Once SEC replaces AskEdgar's AI-generated `headline` field, news items default to `${formType} filing` (e.g. "8-K filing") via the existing fallback in `lib/agents/news-formatter.ts:198`. AI headlines are deferred to buildout-doc Phase 8 (`docs/ae-buildout.md:396`). User explicitly accepted this trade.

---

## Active Spec: SEC EDGAR Foundations + Filing-Titles Replacement (AskEdgar Sprint 1)

> Generated: 2026-04-27 | Author: planning session (inline, no architect handoff)
> Status: IMPLEMENTED + VALIDATED (2026-04-27)
> Goal: Stop calling AskEdgar's `/v1/filing-titles` endpoint. Replace it with a direct SEC EDGAR submissions-JSON fetch, reusing the existing endpoint-registry plumbing so consumers see no contract change. Also lay down the foundational SEC HTTP client + ticker→CIK map that subsequent sprints (8-K parsing, XBRL companyfacts) will reuse.

### Implementation Result

- Added shared SEC infrastructure in `lib/sec/client.ts`, `lib/sec/cik-map.ts`, and `lib/sec/submissions.ts`.
- Added the shared `sec_ticker_cik` table definition in `lib/db/schema.ts`; no migration or `db:push` was run.
- Swapped `ENDPOINT_REGISTRY['filing-titles']` to SEC-sourced `getRecentFilings(ticker, { limit: 20 })` while preserving the same `rawData['filing-titles']` slot.
- Added SEC client, CIK map, submissions, AskEdgar registry-routing, and news-formatter contract coverage.
- Updated `AGENTS.md` with the SEC client convention and the filing-titles source change.
- Manual smoke checks below still need to be run after Jared pushes the schema to Neon and exercises the app against live SEC data.

### Background

Today, `lib/askedgar.ts:487` registers `'filing-titles'` as one of 17 AskEdgar endpoints. It's invoked by every scope (`snapshot`, `tldr`, `lookup`, `small-cap-research`, `swing-trader-research`) and the result lands in `rawData['filing-titles']`. The only consumer that actually reads the data is `lib/agents/news-formatter.ts:133-157` (`buildFilingTitleLookup`), which uses four fields: `accession_number`, `form_type`, `filed_at`, `headline`.

Of those four fields, three are pure SEC metadata (`data.sec.gov/submissions/CIK##########.json`). The fourth — `headline` — is AskEdgar's AI-generated catalyst title and is the only thing AskEdgar uniquely provides for this endpoint. The `news-formatter` already has a deterministic fallback (`${formType} filing`) when no headline matches, so dropping AskEdgar's headline cleanly degrades to "8-K filing"-style labels until Phase 8 of the buildout doc.

This sprint also builds the shared SEC infrastructure (`lib/sec/{client,cik-map,submissions}.ts`) that every future SEC-sourced endpoint will import. No new provider abstraction, no `getResearchData` wrapper — we wedge into the existing `ENDPOINT_REGISTRY` so the swap is invisible to consumers.

**SEC API facts Codex must respect:**

- The submissions endpoint requires the CIK to be **zero-padded to 10 digits** in the URL: `https://data.sec.gov/submissions/CIK0000320193.json`. An unpadded CIK returns 404.
- SEC requires a `User-Agent` header identifying the requester. Use the literal string `Nexus Terminal jared.garcia0411@gmail.com`. Generic UAs may be 403'd.
- SEC's published rate limit is **10 requests/second**. We enforce a minimum 100 ms gap between calls to stay well under it.
- The CIK map at `https://www.sec.gov/files/company_tickers_exchange.json` is column-oriented: `{ fields: [...], data: [[cik, name, ticker, exchange], ...] }`. Tickers are uppercase; share-class tickers use hyphens (`BRK-B`, `BF-A`).
- `filings.recent` inside the submissions JSON is also column-oriented — parallel arrays of equal length keyed by field name. Codex must zip these into row objects.
- Filing URLs construct from the unpadded CIK and dash-stripped accession: `https://www.sec.gov/Archives/edgar/data/{cik_unpadded}/{accession_no_dashes}/{primaryDocument}`.

---

### File: `lib/db/schema.ts`
**Action:** MODIFY

#### Step 1 — Add `sec_ticker_cik` table

1.1. Locate the `askedgarCache` table definition at line 199. **Just below** that table block (after the closing `]);` at line 209), insert a new table:

```ts
// SEC ticker → CIK identity map. Hydrated from
// https://www.sec.gov/files/company_tickers_exchange.json with a 24h refresh.
// Shared across all users; no userId.
export const secTickerCik = pgTable('sec_ticker_cik', {
  ticker: text('ticker').primaryKey(),     // uppercase, share-class hyphenated (e.g. "BRK-B")
  cik: text('cik').notNull(),               // 10-digit zero-padded (e.g. "0000320193")
  name: text('name').notNull(),
  exchange: text('exchange'),               // "Nasdaq" | "NYSE" | "OTC" | null
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('sec_ticker_cik_fetched_idx').on(table.fetchedAt),
]);
```

1.2. No imports to add — `pgTable`, `text`, `timestamp`, `index` are already imported at the top of the file.

1.3. **Do not run `npm run db:push`.** That's a manual step Jared will run against Neon after merge.

#### Acceptance

- [ ] `secTickerCik` exported from `lib/db/schema.ts`.
- [ ] Schema compiles under `npx tsc --noEmit`.

---

### File: `lib/sec/client.ts`
**Action:** CREATE

#### Step 2 — SEC HTTP client (User-Agent + rate limit + retry)

2.1. Create the directory `lib/sec/` and the file `lib/sec/client.ts` with the following contents:

```ts
const SEC_USER_AGENT = 'Nexus Terminal jared.garcia0411@gmail.com';
const MIN_REQUEST_GAP_MS = 100;            // SEC limit is 10 req/s; 100ms is the safe floor
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 3;

let lastRequestAt = 0;
let pacingPromise: Promise<void> = Promise.resolve();

export class SecHttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'SecHttpError';
  }
}

// Serialize the rate-limit gap so concurrent callers respect the 100ms floor.
function paceRequest(): Promise<void> {
  pacingPromise = pacingPromise.then(async () => {
    const wait = Math.max(0, MIN_REQUEST_GAP_MS - (Date.now() - lastRequestAt));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
  });
  return pacingPromise;
}

async function delay(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

export async function secFetchJson<T = unknown>(url: string): Promise<T> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    await paceRequest();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': SEC_USER_AGENT,
          'Accept': 'application/json',
        },
        signal: controller.signal,
        cache: 'no-store',
      });

      clearTimeout(timeoutId);

      // Retry on transient server errors and rate-limit responses
      if (response.status === 429 || response.status === 503) {
        lastError = new SecHttpError(response.status, `SEC ${response.status} on attempt ${attempt + 1}`);
        await delay(Math.pow(2, attempt) * 1000);   // 1s, 2s, 4s
        continue;
      }

      if (!response.ok) {
        throw new SecHttpError(response.status, `SEC request failed: ${response.status} ${response.statusText}`);
      }

      return (await response.json()) as T;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof SecHttpError && error.status >= 400 && error.status < 500 && error.status !== 429) {
        throw error;   // 4xx (other than 429) is not retryable
      }

      lastError = error;

      if (attempt < MAX_RETRIES - 1) {
        await delay(Math.pow(2, attempt) * 1000);
      }
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new Error('SEC request failed after retries');
}
```

> **Why a serialized pacing promise:** SEC's rate limit applies across all concurrent calls in a single process. A simple `lastRequestAt` check would race when two `secFetchJson` calls fire at the same time. Threading every call through one shared promise serializes the 100 ms wait without needing a heavier queue library.

#### Acceptance

- [ ] `secFetchJson` exported and types as `<T>(url: string) => Promise<T>`.
- [ ] `SecHttpError` class exported with `status` field.
- [ ] Concurrent calls respect the 100 ms minimum gap.
- [ ] 429 / 503 responses retry with 1s / 2s / 4s backoff.
- [ ] Other 4xx responses throw `SecHttpError` immediately (no retry).

---

### File: `lib/sec/cik-map.ts`
**Action:** CREATE

#### Step 3 — Ticker → CIK lookup

3.1. Create `lib/sec/cik-map.ts`:

```ts
import { eq, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { secTickerCik } from '@/lib/db/schema';
import { secFetchJson } from '@/lib/sec/client';

const CIK_MAP_URL = 'https://www.sec.gov/files/company_tickers_exchange.json';
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;   // 24 hours

export interface CikMapEntry {
  ticker: string;       // uppercase, share-class hyphenated (e.g. "BRK-B")
  cik: string;          // 10-digit zero-padded
  name: string;
  exchange: string | null;
}

interface CikMapResponse {
  fields: string[];
  data: Array<[number, string, string, string | null]>;
}

let inMemoryMap: Map<string, CikMapEntry> | null = null;
let lastLoadAt = 0;
let inFlightLoad: Promise<Map<string, CikMapEntry>> | null = null;

export function normalizeTicker(input: string): string {
  return input.trim().toUpperCase().replace(/\./g, '-');
}

export function padCik(cik: string | number): string {
  return String(cik).padStart(10, '0');
}

async function fetchCikMapFromSec(): Promise<Map<string, CikMapEntry>> {
  const payload = await secFetchJson<CikMapResponse>(CIK_MAP_URL);
  const map = new Map<string, CikMapEntry>();

  for (const row of payload.data) {
    const [cikNum, name, ticker, exchange] = row;
    if (!ticker || typeof ticker !== 'string') continue;
    map.set(ticker.toUpperCase(), {
      ticker: ticker.toUpperCase(),
      cik: padCik(cikNum),
      name,
      exchange: exchange ?? null,
    });
  }

  return map;
}

async function persistCikMap(map: Map<string, CikMapEntry>): Promise<void> {
  const db = getDb();
  if (!db) return;

  const rows = Array.from(map.values()).map((entry) => ({
    ticker: entry.ticker,
    cik: entry.cik,
    name: entry.name,
    exchange: entry.exchange,
    fetchedAt: new Date(),
  }));

  // Chunk to avoid hitting parameter limits on bulk insert
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await db
      .insert(secTickerCik)
      .values(chunk)
      .onConflictDoUpdate({
        target: secTickerCik.ticker,
        set: {
          cik: sql`excluded.cik`,
          name: sql`excluded.name`,
          exchange: sql`excluded.exchange`,
          fetchedAt: sql`excluded.fetched_at`,
        },
      });
  }
}

async function hydrateFromDb(): Promise<{ map: Map<string, CikMapEntry>; fetchedAt: Date | null }> {
  const db = getDb();
  if (!db) return { map: new Map(), fetchedAt: null };

  const rows = await db
    .select()
    .from(secTickerCik);

  const map = new Map<string, CikMapEntry>();
  let newest: Date | null = null;
  for (const row of rows) {
    map.set(row.ticker, {
      ticker: row.ticker,
      cik: row.cik,
      name: row.name,
      exchange: row.exchange,
    });
    if (!newest || row.fetchedAt > newest) newest = row.fetchedAt;
  }

  return { map, fetchedAt: newest };
}

async function loadCikMap(): Promise<Map<string, CikMapEntry>> {
  if (inFlightLoad) return inFlightLoad;

  inFlightLoad = (async () => {
    const { map: dbMap, fetchedAt } = await hydrateFromDb();
    const dbStale = !fetchedAt || (Date.now() - fetchedAt.getTime() > REFRESH_INTERVAL_MS);

    if (dbMap.size > 0 && !dbStale) {
      inMemoryMap = dbMap;
      lastLoadAt = Date.now();
      console.log(`[sec-cik-map] hydrated ${dbMap.size} entries from db`);
      return dbMap;
    }

    try {
      const freshMap = await fetchCikMapFromSec();
      inMemoryMap = freshMap;
      lastLoadAt = Date.now();
      await persistCikMap(freshMap).catch((err) => {
        console.warn('[sec-cik-map] persist failed:', err);
      });
      console.log(`[sec-cik-map] loaded ${freshMap.size} entries from SEC`);
      return freshMap;
    } catch (error) {
      // Fall back to whatever we have in DB even if stale
      if (dbMap.size > 0) {
        inMemoryMap = dbMap;
        console.warn('[sec-cik-map] SEC fetch failed; using stale db copy:', error);
        return dbMap;
      }
      throw error;
    }
  })();

  try {
    return await inFlightLoad;
  } finally {
    inFlightLoad = null;
  }
}

export async function getCikForTicker(rawTicker: string): Promise<CikMapEntry | null> {
  const normalized = normalizeTicker(rawTicker);
  if (!normalized) return null;

  if (!inMemoryMap || Date.now() - lastLoadAt > REFRESH_INTERVAL_MS) {
    await loadCikMap();
  }

  return inMemoryMap?.get(normalized) ?? null;
}

// Test-only reset hook. Do not call from runtime code.
export function __resetCikMapForTests(): void {
  inMemoryMap = null;
  lastLoadAt = 0;
  inFlightLoad = null;
}
```

#### Acceptance

- [ ] `getCikForTicker('AAPL')` returns `{ cik: '0000320193', ticker: 'AAPL', name: 'Apple Inc.', exchange: 'Nasdaq' }`.
- [ ] `getCikForTicker('brk.b')` returns the BRK-B entry (normalization works).
- [ ] `getCikForTicker('NOTAREALSYMBOL')` returns `null`.
- [ ] Two parallel `getCikForTicker` calls trigger only one SEC fetch (in-flight dedupe).
- [ ] After a successful SEC fetch, the `sec_ticker_cik` table contains the rows.
- [ ] If SEC fetch fails but DB has rows, fall back to DB without throwing.

---

### File: `lib/sec/submissions.ts`
**Action:** CREATE

#### Step 4 — Filing fetcher (returns AskEdgar-shaped response)

4.1. Create `lib/sec/submissions.ts`:

```ts
import { secFetchJson, SecHttpError } from '@/lib/sec/client';
import { getCikForTicker, padCik } from '@/lib/sec/cik-map';

const SUBMISSIONS_BASE = 'https://data.sec.gov/submissions';
const DEFAULT_LIMIT = 20;
const DEFAULT_SINCE_DAYS = 90;

export interface SecFiling {
  accession_number: string;
  form_type: string;
  filed_at: string;             // 'YYYY-MM-DD'
  headline: string;             // primary_doc_description if present, else `${form_type} filing`
  url: string;                  // archives URL to primary document
  primary_doc_description: string | null;
}

// Matches the AskEdgarResponse<T> shape so the result slots into ENDPOINT_REGISTRY
// without changing the runner contract.
export interface SubmissionsResponse {
  status: 'success' | 'error';
  count: number;
  results: SecFiling[];
  error?: string;
}

interface RawSubmissionsPayload {
  cik: string;
  filings?: {
    recent?: {
      accessionNumber?: string[];
      filingDate?: string[];
      form?: string[];
      primaryDocument?: string[];
      primaryDocDescription?: string[];
      acceptanceDateTime?: string[];
    };
  };
}

export interface GetRecentFilingsOptions {
  limit?: number;          // default 20
  sinceDays?: number;      // default 90; pass 0 to disable the recency filter
}

function buildFilingUrl(cikUnpadded: string, accession: string, primaryDocument: string): string {
  const accessionNoDashes = accession.replace(/-/g, '');
  return `https://www.sec.gov/Archives/edgar/data/${cikUnpadded}/${accessionNoDashes}/${primaryDocument}`;
}

function zipRecent(payload: RawSubmissionsPayload): SecFiling[] {
  const recent = payload.filings?.recent;
  if (!recent || !Array.isArray(recent.accessionNumber)) return [];

  const cikUnpadded = String(parseInt(payload.cik, 10));   // strip leading zeros for URL
  const out: SecFiling[] = [];
  const len = recent.accessionNumber.length;

  for (let i = 0; i < len; i++) {
    const accession = recent.accessionNumber[i];
    const formType = recent.form?.[i] ?? 'unknown';
    const filedAt = recent.filingDate?.[i] ?? '';
    const primaryDocument = recent.primaryDocument?.[i] ?? '';
    const description = recent.primaryDocDescription?.[i] ?? '';

    if (!accession || !filedAt) continue;

    const headline = description.trim() || `${formType} filing`;

    out.push({
      accession_number: accession,
      form_type: formType,
      filed_at: filedAt,
      headline,
      url: primaryDocument ? buildFilingUrl(cikUnpadded, accession, primaryDocument) : '',
      primary_doc_description: description.trim() || null,
    });
  }

  return out;
}

function filterAndLimit(filings: SecFiling[], opts: Required<GetRecentFilingsOptions>): SecFiling[] {
  const sinceMs = opts.sinceDays > 0 ? Date.now() - opts.sinceDays * 86400000 : 0;

  const filtered = sinceMs === 0
    ? filings
    : filings.filter((f) => {
        const ts = new Date(f.filed_at).getTime();
        return Number.isFinite(ts) ? ts >= sinceMs : true;
      });

  // SEC submissions JSON returns recent filings already in newest-first order, but
  // sort defensively in case ordering changes upstream.
  filtered.sort((a, b) => (b.filed_at < a.filed_at ? -1 : b.filed_at > a.filed_at ? 1 : 0));

  return filtered.slice(0, opts.limit);
}

export async function getRecentFilings(
  rawTicker: string,
  options: GetRecentFilingsOptions = {},
): Promise<SubmissionsResponse> {
  const opts: Required<GetRecentFilingsOptions> = {
    limit: options.limit ?? DEFAULT_LIMIT,
    sinceDays: options.sinceDays ?? DEFAULT_SINCE_DAYS,
  };

  let cikEntry;
  try {
    cikEntry = await getCikForTicker(rawTicker);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'CIK lookup failed';
    console.warn(`[sec-submissions] cik lookup failed for ${rawTicker}: ${message}`);
    return { status: 'error', count: 0, results: [], error: message };
  }

  if (!cikEntry) {
    console.warn(`[sec-submissions] no CIK for ticker ${rawTicker}`);
    return { status: 'success', count: 0, results: [] };
  }

  const url = `${SUBMISSIONS_BASE}/CIK${padCik(cikEntry.cik)}.json`;

  try {
    const payload = await secFetchJson<RawSubmissionsPayload>(url);
    const all = zipRecent(payload);
    const results = filterAndLimit(all, opts);
    return { status: 'success', count: results.length, results };
  } catch (error) {
    const message = error instanceof Error
      ? `${error instanceof SecHttpError ? `SEC ${error.status}` : 'SEC request failed'}: ${error.message}`
      : 'SEC request failed';
    console.warn(`[sec-submissions] fetch failed for ${rawTicker}: ${message}`);
    return { status: 'error', count: 0, results: [], error: message };
  }
}
```

> **Why a missing CIK returns `status: 'success'` with empty results:** The news-formatter already handles empty `filing-titles` cleanly (it just doesn't populate the lookup map and falls back to `${formType} filing`). Returning `status: 'error'` would surface as a warning in the AskEdgar fan-out log, which is misleading because the absence of a CIK is expected for many small-caps not in SEC's ticker file.

#### Acceptance

- [ ] `getRecentFilings('AAPL')` returns up to 20 filings filed within the last 90 days.
- [ ] Each result has all six `SecFiling` fields populated (with `url` empty if `primaryDocument` was missing).
- [ ] Unknown ticker returns `{ status: 'success', count: 0, results: [] }` and a `[sec-submissions] no CIK` warning.
- [ ] SEC HTTP error returns `{ status: 'error', ... }` with an error message and a warning log.
- [ ] Result conforms to the `AskEdgarResponse<unknown>`-compatible shape (status, count, results, optional error).

---

### File: `lib/askedgar.ts`
**Action:** MODIFY

#### Step 5 — Swap `filing-titles` registry entry to SEC

5.1. Add the import near the top of the file (just after the existing `@/lib/types` imports at line 19):

```ts
import { getRecentFilings } from '@/lib/sec/submissions';
```

5.2. Locate the `fetchFilingTitles` helper at line 449 and **delete the entire function** (lines 449-453).

5.3. In `ENDPOINT_REGISTRY` at line 487, replace:

```ts
'filing-titles': { label: 'Filing Titles', run: (ticker) => fetchFilingTitles(ticker, 20) },
```

with:

```ts
'filing-titles': { label: 'Filing Titles (SEC)', run: (ticker) => getRecentFilings(ticker, { limit: 20 }) },
```

> **Why this works without changing the runner type:** `getRecentFilings` returns `SubmissionsResponse`, which has the same `{ status, count, results }` shape as `AskEdgarResponse<unknown>`. The optional `usage` field is absent, so `sumCostUsd` contributes 0 for this endpoint — exactly what we want to demonstrate the savings in the `[askedgar-fanout] costUsd=` log token.

5.4. Verify nothing else in `lib/askedgar.ts` references `fetchFilingTitles` after the deletion. Run `grep -n "fetchFilingTitles" lib/askedgar.ts` — expect zero matches.

#### Acceptance

- [ ] `fetchFilingTitles` deleted; no remaining references in `lib/askedgar.ts`.
- [ ] `ENDPOINT_REGISTRY['filing-titles'].run('AAPL')` returns SEC-sourced filings without making any network call to AskEdgar.
- [ ] `getCachedTickerData('AAPL')` (snapshot scope) populates `rawData['filing-titles']` with the SEC shape.
- [ ] The `[askedgar-fanout]` log line for a snapshot call shows `costUsd` reduced by AskEdgar's filing-titles per-call cost (anecdotally ~$0.04 per `/estimate`).

---

### File: `__tests__/sec-client.test.ts`
**Action:** CREATE

#### Step 6 — SEC client tests

6.1. Create `__tests__/sec-client.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('sec client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends the SEC-required User-Agent header', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const { secFetchJson } = await import('@/lib/sec/client');

    await secFetchJson('https://data.sec.gov/example.json');

    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['User-Agent']).toBe('Nexus Terminal jared.garcia0411@gmail.com');
    expect(headers['Accept']).toBe('application/json');
  });

  it('retries on 503 and succeeds on the second attempt', async () => {
    let call = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      call++;
      if (call === 1) return new Response('boom', { status: 503 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const { secFetchJson } = await import('@/lib/sec/client');

    const result = await secFetchJson<{ ok: boolean }>('https://data.sec.gov/example.json');

    expect(call).toBe(2);
    expect(result.ok).toBe(true);
  });

  it('throws SecHttpError on 404 without retrying', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('not found', { status: 404, statusText: 'Not Found' }),
    );
    const { secFetchJson, SecHttpError } = await import('@/lib/sec/client');

    await expect(secFetchJson('https://data.sec.gov/missing.json')).rejects.toBeInstanceOf(SecHttpError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('paces concurrent requests at least 100ms apart', async () => {
    const callTimes: number[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      callTimes.push(Date.now());
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const { secFetchJson } = await import('@/lib/sec/client');

    await Promise.all([
      secFetchJson('https://data.sec.gov/a.json'),
      secFetchJson('https://data.sec.gov/b.json'),
      secFetchJson('https://data.sec.gov/c.json'),
    ]);

    expect(callTimes.length).toBe(3);
    expect(callTimes[1] - callTimes[0]).toBeGreaterThanOrEqual(100);
    expect(callTimes[2] - callTimes[1]).toBeGreaterThanOrEqual(100);
  });
});
```

#### Acceptance

- [ ] All four tests pass.

---

### File: `__tests__/sec-cik-map.test.ts`
**Action:** CREATE

#### Step 7 — CIK map tests

7.1. Create `__tests__/sec-cik-map.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));

vi.mock('@/lib/db', async () => {
  const actual = await vi.importActual<typeof import('@/lib/db')>('@/lib/db');
  return { ...actual, getDb: getDbMock };
});

function emptyDb() {
  return {
    select: () => ({ from: async () => [] }),
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: async () => undefined,
      }),
    }),
  };
}

const SEC_PAYLOAD = {
  fields: ['cik', 'name', 'ticker', 'exchange'],
  data: [
    [320193, 'Apple Inc.', 'AAPL', 'Nasdaq'],
    [1067983, 'BERKSHIRE HATHAWAY INC', 'BRK-B', 'NYSE'],
  ],
};

describe('sec cik map', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.resetModules();
    getDbMock.mockReset();
    getDbMock.mockReturnValue(emptyDb());
  });

  afterEach(() => {});

  it('maps tickers to padded CIKs', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(SEC_PAYLOAD), { status: 200 }),
    );
    const mod = await import('@/lib/sec/cik-map');
    mod.__resetCikMapForTests();

    const entry = await mod.getCikForTicker('AAPL');

    expect(entry).toEqual({
      ticker: 'AAPL',
      cik: '0000320193',
      name: 'Apple Inc.',
      exchange: 'Nasdaq',
    });
  });

  it('normalizes lowercase and dot-suffix tickers', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(SEC_PAYLOAD), { status: 200 }),
    );
    const mod = await import('@/lib/sec/cik-map');
    mod.__resetCikMapForTests();

    const lowercased = await mod.getCikForTicker('aapl');
    const dotted = await mod.getCikForTicker('brk.b');

    expect(lowercased?.cik).toBe('0000320193');
    expect(dotted?.cik).toBe('0001067983');
  });

  it('returns null for unknown tickers', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(SEC_PAYLOAD), { status: 200 }),
    );
    const mod = await import('@/lib/sec/cik-map');
    mod.__resetCikMapForTests();

    const entry = await mod.getCikForTicker('NOTREAL');

    expect(entry).toBeNull();
  });

  it('dedupes parallel loads into a single SEC fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(SEC_PAYLOAD), { status: 200 }),
    );
    const mod = await import('@/lib/sec/cik-map');
    mod.__resetCikMapForTests();

    await Promise.all([mod.getCikForTicker('AAPL'), mod.getCikForTicker('BRK-B')]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
```

#### Acceptance

- [ ] All four tests pass.

---

### File: `__tests__/sec-submissions.test.ts`
**Action:** CREATE

#### Step 8 — Submissions tests

8.1. Create `__tests__/sec-submissions.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/sec/cik-map', () => ({
  getCikForTicker: vi.fn(),
  padCik: (cik: string | number) => String(cik).padStart(10, '0'),
  normalizeTicker: (t: string) => t.trim().toUpperCase().replace(/\./g, '-'),
}));

const sampleSubmissions = {
  cik: '0000320193',
  filings: {
    recent: {
      accessionNumber: ['0000320193-26-000001', '0000320193-26-000002', '0000320193-25-999999'],
      filingDate: ['2026-04-20', '2026-04-15', '2025-01-01'],   // last entry is >90 days old
      form: ['8-K', '10-Q', '10-K'],
      primaryDocument: ['doc1.htm', 'doc2.htm', 'doc3.htm'],
      primaryDocDescription: ['Item 1.01', '', 'Annual report'],
      acceptanceDateTime: ['2026-04-20T20:00:00.000Z', '2026-04-15T20:00:00.000Z', '2025-01-01T20:00:00.000Z'],
    },
  },
};

describe('sec submissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  afterEach(() => {});

  it('zips column-oriented filings into row objects', async () => {
    const cikMap = await import('@/lib/sec/cik-map');
    vi.mocked(cikMap.getCikForTicker).mockResolvedValue({
      ticker: 'AAPL', cik: '0000320193', name: 'Apple Inc.', exchange: 'Nasdaq',
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(sampleSubmissions), { status: 200 }),
    );
    const { getRecentFilings } = await import('@/lib/sec/submissions');

    const result = await getRecentFilings('AAPL', { sinceDays: 0 });

    expect(result.status).toBe('success');
    expect(result.count).toBe(3);
    expect(result.results[0]).toMatchObject({
      accession_number: '0000320193-26-000001',
      form_type: '8-K',
      filed_at: '2026-04-20',
      headline: 'Item 1.01',
      primary_doc_description: 'Item 1.01',
    });
    expect(result.results[0].url).toBe('https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/doc1.htm');
  });

  it('falls back to "${formType} filing" when description is empty', async () => {
    const cikMap = await import('@/lib/sec/cik-map');
    vi.mocked(cikMap.getCikForTicker).mockResolvedValue({
      ticker: 'AAPL', cik: '0000320193', name: 'Apple Inc.', exchange: 'Nasdaq',
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(sampleSubmissions), { status: 200 }),
    );
    const { getRecentFilings } = await import('@/lib/sec/submissions');

    const result = await getRecentFilings('AAPL', { sinceDays: 0 });

    expect(result.results[1].headline).toBe('10-Q filing');
    expect(result.results[1].primary_doc_description).toBeNull();
  });

  it('filters out filings older than sinceDays', async () => {
    const cikMap = await import('@/lib/sec/cik-map');
    vi.mocked(cikMap.getCikForTicker).mockResolvedValue({
      ticker: 'AAPL', cik: '0000320193', name: 'Apple Inc.', exchange: 'Nasdaq',
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(sampleSubmissions), { status: 200 }),
    );
    const { getRecentFilings } = await import('@/lib/sec/submissions');

    const result = await getRecentFilings('AAPL', { sinceDays: 90 });

    // 10-K from 2025-01-01 is excluded
    expect(result.results.map((r) => r.form_type)).toEqual(['8-K', '10-Q']);
  });

  it('respects the limit parameter', async () => {
    const cikMap = await import('@/lib/sec/cik-map');
    vi.mocked(cikMap.getCikForTicker).mockResolvedValue({
      ticker: 'AAPL', cik: '0000320193', name: 'Apple Inc.', exchange: 'Nasdaq',
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(sampleSubmissions), { status: 200 }),
    );
    const { getRecentFilings } = await import('@/lib/sec/submissions');

    const result = await getRecentFilings('AAPL', { sinceDays: 0, limit: 1 });

    expect(result.count).toBe(1);
    expect(result.results).toHaveLength(1);
  });

  it('returns empty success for unknown tickers', async () => {
    const cikMap = await import('@/lib/sec/cik-map');
    vi.mocked(cikMap.getCikForTicker).mockResolvedValue(null);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { getRecentFilings } = await import('@/lib/sec/submissions');

    const result = await getRecentFilings('NOTREAL');

    expect(result).toEqual({ status: 'success', count: 0, results: [] });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns error status on SEC HTTP failure', async () => {
    const cikMap = await import('@/lib/sec/cik-map');
    vi.mocked(cikMap.getCikForTicker).mockResolvedValue({
      ticker: 'AAPL', cik: '0000320193', name: 'Apple Inc.', exchange: 'Nasdaq',
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('not found', { status: 404, statusText: 'Not Found' }),
    );
    const { getRecentFilings } = await import('@/lib/sec/submissions');

    const result = await getRecentFilings('AAPL');

    expect(result.status).toBe('error');
    expect(result.count).toBe(0);
    expect(result.error).toContain('404');
  });
});
```

#### Acceptance

- [ ] All six tests pass.

---

### File: `__tests__/askedgar-client.test.ts`
**Action:** MODIFY

#### Step 9 — Mock the SEC submissions boundary

The existing `mockSuccessfulEndpointFetch` returns AskEdgar-shaped JSON for any URL. Once `'filing-titles'` is wired to `getRecentFilings`, that mock would feed AskEdgar JSON into the SEC zipper and crash. Mock at the `lib/sec/submissions` boundary instead so the askedgar tests stay focused on cache/scope logic.

9.1. At the top of the file (just after the `vi.mock('@/lib/db', ...)` block at line 7), add a mock for the SEC submissions module:

```ts
const { getRecentFilingsMock } = vi.hoisted(() => ({
  getRecentFilingsMock: vi.fn(),
}));

vi.mock('@/lib/sec/submissions', () => ({
  getRecentFilings: getRecentFilingsMock,
}));
```

9.2. In the `beforeEach` block at line 94, after the `getDbMock.mockReturnValue(undefined);` line, add a default SEC mock:

```ts
getRecentFilingsMock.mockReset();
getRecentFilingsMock.mockResolvedValue({
  status: 'success',
  count: 1,
  results: [{
    accession_number: '0001234567-26-000001',
    form_type: '8-K',
    filed_at: '2026-04-20',
    headline: '8-K filing',
    url: 'https://www.sec.gov/Archives/edgar/data/0/000123456726000001/doc.htm',
    primary_doc_description: null,
  }],
});
```

9.3. The existing tests should keep passing because:
- `Object.keys(result.rawData)` length is still 17 — `filing-titles` is now sourced from the mock, not the AskEdgar fetch.
- `dataSources` length is still 17.
- Cost-summing tests still see `cost_microdollars` from the AskEdgar mock (SEC contributes 0).

9.4. Add a new test verifying the registry routes `'filing-titles'` to SEC and not AskEdgar:

```ts
it('routes filing-titles through getRecentFilings, not AskEdgar', async () => {
  const fetchSpy = mockSuccessfulEndpointFetch();
  const client = await import('@/lib/askedgar');

  await client.fetchTickerData('AAPL', { endpoints: ['filing-titles'] });

  expect(getRecentFilingsMock).toHaveBeenCalledWith('AAPL', { limit: 20 });
  // No AskEdgar URL should have been called for filing-titles
  const calledUrls = fetchCallUrls(fetchSpy).map((u) => u.pathname);
  expect(calledUrls.some((p) => p.includes('filing-titles'))).toBe(false);
});
```

#### Acceptance

- [ ] All previously-passing askedgar-client tests still pass without modification beyond the mock additions.
- [ ] New `routes filing-titles through getRecentFilings` test passes.
- [ ] No real network calls leave the test suite.

---

### File: `AGENTS.md`
**Action:** MODIFY

#### Step 10a — Document the SEC client convention

10a.1. Locate the "Architecture Guardrails" section. Just below the existing **Ask Edgar API is usage-billed** bullet (currently around line 62), insert a new bullet:

```md
- **SEC EDGAR fetches go through `lib/sec/`** — use `getRecentFilings(ticker, opts)` from `lib/sec/submissions.ts` for filings, `getCikForTicker(ticker)` from `lib/sec/cik-map.ts` for ticker→CIK lookups, and `secFetchJson(url)` from `lib/sec/client.ts` for any other SEC endpoint. The shared client enforces SEC's User-Agent requirement (`Nexus Terminal jared.garcia0411@gmail.com`), the 10 req/sec rate limit, and 429/503 retries. Do not call SEC URLs with `fetch()` directly.
```

10a.2. Update the existing **Ask Edgar API is usage-billed** bullet by appending one sentence at the end:

```md
The `filing-titles` endpoint is sourced from SEC EDGAR (not AskEdgar) via `lib/sec/submissions.ts`; the swap is invisible to callers because the result lands in the same `rawData['filing-titles']` slot.
```

#### Acceptance

- [ ] AGENTS.md has the new SEC bullet under Architecture Guardrails.
- [ ] AGENTS.md's AskEdgar bullet mentions the filing-titles SEC swap.
- [ ] `npm run workflow:audit` passes (workflow assets changed).

---

### File: `__tests__/news-formatter.test.ts`
**Action:** VERIFY (no edits expected)

#### Step 10 — Confirm contract holds

10.1. Run `npx vitest run __tests__/news-formatter.test.ts`. All existing tests must pass without modification because the SEC shape (`accession_number`, `form_type`, `filed_at`, `headline`) matches what `buildFilingTitleLookup` reads.

10.2. If any test fails because it relied on AskEdgar-specific field names (e.g. `title` in addition to `headline`), update the fixture data to use the SEC field names and document why in the test comment.

#### Acceptance

- [ ] `news-formatter.test.ts` passes unchanged, OR — if a fixture needed updating — the change is field-name only with a one-line comment explaining the SEC contract.

---

### Files Changed Summary

| File | Action | Approx. lines added/removed | Risk |
|---|---|---|---|
| `lib/db/schema.ts` | MODIFY | +12 / -0 | Low — additive table |
| `lib/sec/client.ts` | CREATE | +90 / -0 | Medium — new HTTP client; covered by tests |
| `lib/sec/cik-map.ts` | CREATE | +130 / -0 | Medium — new module with DB persistence |
| `lib/sec/submissions.ts` | CREATE | +110 / -0 | Medium — central swap point |
| `lib/askedgar.ts` | MODIFY | +1 / -6 | Low — registry entry swap + helper deletion |
| `__tests__/sec-client.test.ts` | CREATE | +75 / -0 | Low |
| `__tests__/sec-cik-map.test.ts` | CREATE | +90 / -0 | Low |
| `__tests__/sec-submissions.test.ts` | CREATE | +130 / -0 | Low |
| `__tests__/askedgar-client.test.ts` | MODIFY | +30 / -0 | Low |
| `AGENTS.md` | MODIFY | +2 / -0 | Low — guardrails update |

No change to: API routes (`/snapshot`, `/tldr`, `/lookup`), blueprints, news-formatter source, UI components.

---

### Verification Steps

From repo root, in order:

1. `npm run lint`
2. `npx tsc --noEmit`
3. `npm test`

`npm run typecheck:services` is **not** required (no `services/` files touched).

4. `npm run workflow:audit` — required because `AGENTS.md` changed.

**Manual smoke checks** (after Jared runs `npm run db:push` against Neon and `npm run dev`):

- [ ] First request after deploy: confirm `[sec-cik-map] loaded N entries from SEC` log appears (cold load).
- [ ] Subsequent requests: confirm `[sec-cik-map]` does **not** re-log (in-memory cache hit).
- [ ] Open Research Tab on AAPL. Confirm filings appear in the news feed under their form-type labels (e.g. "10-K filing"). No "Filing Titles" section in the Research UI should be empty.
- [ ] Run a small-cap research report on a fresh ticker. Confirm `[askedgar-fanout]` log shows `costUsd` reduced compared to pre-Sprint-1 baseline (filing-titles no longer billed).
- [ ] Try a known-bad ticker (e.g. `ZZZZZ`). Confirm `[sec-submissions] no CIK for ticker ZZZZZ` warning appears and the report still completes (empty filings list, not a crash).
- [ ] Confirm `sec_ticker_cik` table in Neon has ~10,300 rows after the first cold load.

### Rollback

Revert the commit. The `sec_ticker_cik` table can stay in Neon (orphaned, harmless) or be dropped manually with `DROP TABLE sec_ticker_cik;`. Cache rows written under the new code remain valid for old code — `rawData['filing-titles']` rows are still JSON arrays of objects with `accession_number` / `form_type` / `filed_at` / `headline`, and the news-formatter reads only those fields.

### Out of Scope (future sprints)

- Pagination of `filings.files[]` (older than the most-recent-1000 window). AskEdgar capped at 20 anyway.
- New SEC tables for raw filings, exhibits, or extracted facts (per `docs/ae-buildout.md` Storage Model). Defer to Sprint 2+ once we have a second SEC-sourced endpoint to justify the schema.
- The `getResearchData` adapter pattern from the buildout doc. Wedging into the existing registry is sufficient for one endpoint; the adapter can land when we have 3+ SEC endpoints with mixed-source freshness metadata.
- AI/LLM-generated catalyst headlines (buildout doc Phase 8).
- The advisory `Endpoint trim` note about removing AskEdgar's `historical-float-pro` — that's its own Sprint 2 spec replacing it with XBRL companyfacts.

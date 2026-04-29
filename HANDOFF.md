# Nexus Terminal — HANDOFF.md

> Updated: 2026-04-29
> Purpose: brief summary of recently completed work plus any active execution spec. Older implementation detail lives in git history and `specs/`.
> Recent ships: Backtesting Tab full rollout (Phase 1 → Phase 3 + polish, last commit `6456f69`). AskEdgar Sprint 1 (`filing-titles` → `lib/sec/submissions.ts`) and Sprint 2 (`historical-float-pro` → `lib/sec/companyfacts.ts`) are live but the snapshot mapper still reads AskEdgar-style field names, which is why the Filings rows render with broken summaries. That bug is the entry point for the next two specs.

## Active Specs

Two specs queued. **Filings v1 now exists in the local worktree and is paused for review/commit/compact before Sprint 3** — it's the validation surface Sprint 3 will need (clickable links from filing rows back to the source SEC document).

1. **Filings v1** — implemented locally on 2026-04-29; review/commit pending before compaction.
2. **AskEdgar Sprint 3 (reverse-splits)** — replace AskEdgar's `reverse-splits` endpoint with our own 8-K Item 5.03 parser.

Run `npm run lint`, `npx tsc --noEmit`, `npm test`, and `npm run workflow:audit` after each phase. Schema changes use `npm run db:migrate`, **never** `db:push`.

---

## Spec 1 — Filings v1 (bucketed Filings tab + SEC field-mapping fix)

### Phase 1.1 — Plumb SEC URL + accession through the snapshot

**Step 1.1.1 — Extend `ResearchSnapshotNewsItem` and add `ResearchSnapshotFiling`** in `lib/types.ts:169`:

```ts
export interface ResearchSnapshotNewsItem {
  title: string;
  summary: string;
  filedAt: string | null;
  formType: string | null;
  isNews: boolean;
}

export type FilingBucket =
  | 'financials' | 'news' | 'registrations' | 'prospectus'
  | 'proxies' | 'ownerships' | 'other';

export interface ResearchSnapshotFiling {
  formType: string;            // raw SEC form type, e.g. '10-K', '8-K', '424B3'
  bucket: FilingBucket;        // computed via lib/filings-bucket.ts (Step 1.2.1)
  title: string;               // primary_doc_description if present, else `${formType} filing`
  filedAt: string | null;      // 'YYYY-MM-DD'
  url: string | null;          // direct SEC archives URL to primary document
  accessionNumber: string | null;
}
```

Add `filings: ResearchSnapshotFiling[]` to `ResearchSnapshotFull` (search the file for the existing `historicalFloat:` field — add `filings:` near `news:`).

**Step 1.1.2 — Create `lib/filings-bucket.ts` (new file)**:

```ts
import type { FilingBucket } from '@/lib/types';

// SEC form-type → research-tab bucket. Matches AskEdgar's UX layout.
// Unknown / less-common forms fall through to 'other' on purpose; we surface
// them rather than dropping them so users still see them in the All view.
export function bucketForFormType(formType: string): FilingBucket {
  const f = formType.trim().toUpperCase();

  // Financials (annual/quarterly + amendments)
  if (/^10-[KQ](\/A)?$/.test(f)) return 'financials';
  if (/^20-F(\/A)?$/.test(f)) return 'financials';            // foreign private issuers
  if (/^40-F(\/A)?$/.test(f)) return 'financials';            // Canadian filers

  // News (current reports)
  if (/^8-K(\/A)?$/.test(f)) return 'news';
  if (/^6-K(\/A)?$/.test(f)) return 'news';                   // foreign private issuer interim reports

  // Registrations (and amendments)
  if (/^S-(1|3|4|8|11)(\/A)?$/.test(f)) return 'registrations';
  if (/^F-(1|3|4)(\/A)?$/.test(f)) return 'registrations';

  // Prospectus
  if (/^424[AB]\d?$/.test(f)) return 'prospectus';
  if (f === 'EFFECT') return 'prospectus';                    // notice of effectiveness rides with prospectus flow

  // Proxies (definitive, preliminary, additional materials, contested)
  if (/^(DEF|PRE|DEFA|DEFM|DEFC|DFAN|DFRN|PREM|PREC|PRER)/.test(f) && /14[AC]/.test(f)) return 'proxies';

  // Ownerships (insider + institutional beneficial-ownership filings)
  if (/^SC\s?13[GD](\/A)?$/.test(f)) return 'ownerships';
  if (/^[345](\/A)?$/.test(f)) return 'ownerships';

  return 'other';
}
```

**Step 1.1.3 — Update `lib/sec/submissions.ts`** to expose what the snapshot needs:
- Add optional `items?: string[]` to `RawSubmissionsPayload.filings.recent` (line 37).
- Add `items: string | null` to `SecFiling` (line 8). The SEC submissions JSON returns `items` as a single comma-joined string per filing (e.g. `'5.03,9.01'`); store it as-is.
- In `zipRecent` (line 50), read `recent.items?.[i] ?? null` and emit it on the row.
- Tests: extend any existing `__tests__/sec-submissions*.test.ts` (or add `__tests__/sec-submissions.test.ts` if none) to assert `items` is preserved when present and `null` when absent.

**Step 1.1.4 — Fix the snapshot mapper** in `lib/askedgar.ts`. Two changes:

(a) The existing `news` array at `lib/askedgar.ts:813-834` currently includes filings rows (the second spread, line 824). **Remove the filings spread from the `news` array entirely.** News should be news only.

(b) Add a new `filings: ResearchSnapshotFiling[]` immediately after the `news` const, sourced from the SEC submissions response:

```ts
import { bucketForFormType } from '@/lib/filings-bucket';

// ... inside normalizeAskEdgarResponse, after the `news` block:
const filings: ResearchSnapshotFiling[] = getEndpointResponse(rawData, ['filing-titles', 'filingTitles'])
  .results
  .map((item) => {
    const row = toRecord(item);
    const formType = getStringField(row, ['form_type', 'formType', 'form']) ?? 'unknown';
    const filedAt = getStringField(row, ['filed_at', 'filedAt', 'date']);
    const headline = getStringField(row, ['headline', 'title', 'primary_doc_description', 'primaryDocDescription'])
      ?? `${formType} filing`;
    return {
      formType,
      bucket: bucketForFormType(formType),
      title: headline,
      filedAt,
      url: getStringField(row, ['url', 'document_url', 'documentUrl']) ?? null,
      accessionNumber: getStringField(row, ['accession_number', 'accessionNumber', 'accn']) ?? null,
    } satisfies ResearchSnapshotFiling;
  })
  .sort((a, b) => {
    if (!a.filedAt && !b.filedAt) return 0;
    if (!a.filedAt) return 1;
    if (!b.filedAt) return -1;
    return b.filedAt.localeCompare(a.filedAt);
  });
```

Add `filings` to the returned snapshot object.

**Step 1.1.5 — Snapshot mapper unit tests** in `__tests__/research-snapshot-mapper.test.ts` (new file):
- Build a fixture `rawData` shaped like `Record<string, AskEdgarResponse<unknown>>` with realistic SEC outputs for `'filing-titles'` (a `SecFiling[]`) and `'historical-float-pro'` (a `ShareSnapshot[]`), plus minimal stubs for the other endpoints `normalizeAskEdgarResponse` reads (you can copy the empty-response shape from any existing askedgar test).
- Assert: `snapshot.filings` length matches input, `formType` is preserved (e.g. `'10-K'`, not `'Filing'`), `bucket` is correct for at least one row of each bucket type, `url` flows through, rows sort newest-first.
- Assert: `snapshot.historicalFloat` rows have `outstanding` populated from `ShareSnapshot.outstanding`.
- Assert: `snapshot.news` no longer includes filing-titles rows.

### Phase 1.2 — UI: split News tab, add Filings tab with buckets

**Step 1.2.1 — Update tab key union** in `components/trading/ResearchReportSections.tsx:29`:

```ts
type TabKey = 'overview' | 'offering-ability' | 'dilution' | 'news' | 'filings'
  | 'offerings' | 'history' | 'gap-stats';
```

Update the `TABS` array at line 138: replace `{ key: 'news-filings', label: 'News & Filings' }` with two entries: `{ key: 'news', label: 'News' }` and `{ key: 'filings', label: 'Filings' }`. Keep `'filings'` immediately after `'news'`.

**Step 1.2.2 — Update the news tab body** at `components/trading/ResearchReportSections.tsx:409-434`:
- Change the conditional from `activeTab === 'news-filings'` to `activeTab === 'news'`.
- The map already iterates `data.news` — leave the rendering logic alone; just update the ternary at line 412 (which currently says `item.formType ?? (item.isNews ? 'News' : 'Filing')`) to drop the filing fallback. Since news now only contains `isNews: true` rows, the type label is always `'News'` (or `item.formType` when set, e.g. `'Grok'` for AI-tagged news).
- Drop the badge `sourceClass` orange branch (`!item.isNews`) — it's unreachable now. Keep cyan for default news, violet for grok-tagged.

**Step 1.2.3 — Add Filings section** as a new conditional block right after the news block. Render it inline in `ResearchReportSections.tsx` rather than a new file (the file is already the home for all tab bodies). Layout:

```
{activeTab === 'filings' ? (
  <FilingsView filings={data.filings} />
) : null}
```

Define `FilingsView` near the other helper components in the same file (e.g. above the main exported component). It should:

- Maintain a local `bucket` state with default `'all'` and possible values `'all' | 'chronological' | FilingBucket`.
- Render a row of sub-tabs in this order: `All`, `Chronological`, `Financials`, `News`, `Registrations`, `Prospectus`, `Proxies`, `Ownerships`, `Other`. Match the existing tab styling at `ResearchReportSections.tsx:138-180` (small pill buttons; reuse the same classes).
- For `bucket === 'all'`: render six per-bucket tables stacked vertically (Financials → News → Registrations → Prospectus → Proxies → Ownerships). Skip Other from the All view (matches AskEdgar's behaviour) but include it as a selectable sub-tab.
- For `bucket === 'chronological'`: one flat table sorted by `filedAt DESC`.
- For any specific bucket: one table filtered to that bucket.

Each table has columns: `Type` (form-type badge), `Headline` (linked to `url` when present, opens in new tab via `target="_blank" rel="noopener noreferrer"`), `Filed At` (formatted via existing `formatDate`). When `url` is `null`, render the headline as plain text. Reuse the `<details>` collapsible pattern from the news tab is **not** appropriate here — use a flat table per AskEdgar's layout (refer to `data.offerings` table at `ResearchReportSections.tsx:441-462` as the reference for table styling).

When `data.filings` is empty for a given bucket, render `<NoDataBadge />`.

**Step 1.2.4 — Form-type badge styling**: render every form-type badge with white lettering on a neutral background. Use `rounded border border-white/15 bg-white/5 px-2 py-0.5 text-sm text-white` regardless of bucket. Do **not** add per-bucket color helpers — uniform styling across all buckets.

### Phase 1.3 — Validation

**Step 1.3.1 — Bucketing unit test** in `__tests__/filings-bucket.test.ts` (new file): assert the function returns the expected bucket for each form type listed in Step 1.1.2's regex tables. Cover at least one match per bucket plus a clearly-`other` form like `'CORRESP'` or `'UPLOAD'`.

**Step 1.3.2 — Validation commands**: `npm run lint && npx tsc --noEmit && npm test && npm run workflow:audit`. All must pass.

**Step 1.3.3 — Manual smoke** (note in commit message that you couldn't run it because dev server requires login): pick 2-3 tickers from `system_tickers`, open Research tab, verify Filings tab populates with bucketed tables, click a headline → opens correct SEC archives URL, News tab now shows only news (no filing rows).

**Commit** as `Filings v1 — bucketed Filings tab + SEC field-mapping fix`.

---

## Spec 2 — AskEdgar Sprint 3, Part A: reverse-splits parser

Replace AskEdgar's `/v1/reverse-splits` endpoint with a Nexus-owned 8-K Item 5.03 parser. Output shape stays compatible with the existing snapshot mapper at `lib/askedgar.ts:892-900` (which reads `ratio` and `executionDate`/`execution_date`/`date`).

### Phase 2.1 — SEC body-fetch infrastructure

**Step 2.1.1 — Add `secFetchText()`** to `lib/sec/client.ts`. Mirror `secFetchJson` (rate-pacing, retry, timeout, SecHttpError) but:
- `Accept: 'text/html, text/plain'`
- Return `string` (the response body via `await response.text()`)
- Same retry/backoff rules.

Export it alongside `secFetchJson`.

**Step 2.1.2 — Filing body cache table** in `lib/db/schema.ts` (append after `secCompanyfactsCache` at line 233):

```ts
// Cached filing primary-document HTML/text. Keyed by accession number
// (globally unique across SEC). TTL: 30 days soft expiry — filings are
// immutable once filed, so cache invalidation is purely a freshness concern
// for re-parsing if our parsers improve.
export const secFilingBodyCache = pgTable('sec_filing_body_cache', {
  accessionNumber: text('accession_number').primaryKey(),
  cik: text('cik').notNull(),
  formType: text('form_type').notNull(),
  filedAt: text('filed_at').notNull(),       // 'YYYY-MM-DD'
  body: text('body').notNull(),              // sanitized text (HTML tags stripped)
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('sec_filing_body_cache_cik_form_idx').on(table.cik, table.formType),
  index('sec_filing_body_cache_fetched_idx').on(table.fetchedAt),
]);
```

Then: `npm run db:generate` → inspect the produced `drizzle/0026_*.sql` (one CREATE TABLE + 2 indexes; no other tables touched) → `npm run db:migrate` to apply to Neon. Commit the migration file.

**Step 2.1.3 — Body-fetch helper** `lib/sec/filing-body.ts` (new file). Exports:

```ts
export interface FilingBody {
  accessionNumber: string;
  cik: string;
  formType: string;
  filedAt: string;
  text: string;            // stripped of HTML tags, whitespace-collapsed
}

// Fetches a filing's primary document, strips HTML, caches the result.
// `primaryDocUrl` is the URL already built by lib/sec/submissions.ts (SecFiling.url).
export async function getFilingBody(args: {
  accessionNumber: string;
  cik: string;
  formType: string;
  filedAt: string;
  primaryDocUrl: string;
}): Promise<FilingBody | null>;
```

Implementation:
1. Hit `secFilingBodyCache` by `accessionNumber`. If a row exists, return it (no TTL refetch — filings are immutable; we re-fetch only if cache row is missing).
2. Otherwise call `secFetchText(primaryDocUrl)`.
3. Strip HTML: replace `<script…>…</script>` and `<style…>…</style>` blocks with empty string, replace all `<[^>]+>` with a space, decode the standard HTML entities (`&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#39;`, `&nbsp;`), collapse whitespace runs to single spaces. Keep this minimal — do **not** pull in a full HTML parser. Tests cover the cases that matter.
4. Cache and return. On fetch failure, return `null` (don't throw — the caller is one of many parsers and a single-filing failure shouldn't kill the fan-out).

### Phase 2.2 — Reverse-split parser

**Step 2.2.1 — `lib/sec/reverse-splits.ts`** (new file). Exports:

```ts
import { getRecentFilings } from '@/lib/sec/submissions';
import { getCikForTicker } from '@/lib/sec/cik-map';
import { getFilingBody } from '@/lib/sec/filing-body';

export interface ReverseSplit {
  ratio: string;                       // normalized 'X-for-Y' (e.g. '1-for-25')
  executionDate: string | null;        // 'YYYY-MM-DD' or null if not extracted
  announcementDate: string;            // the 8-K filing date
  accessionNumber: string;
  url: string;                         // direct SEC link to the source 8-K
}

export interface ReverseSplitsResponse {
  status: 'success' | 'error';
  count: number;
  results: ReverseSplit[];
  error?: string;
}

export async function getReverseSplits(
  rawTicker: string,
  options?: { sinceDays?: number },
): Promise<ReverseSplitsResponse>;
```

Implementation:
1. Resolve CIK via `getCikForTicker`. Return empty success if no CIK.
2. Call `getRecentFilings(ticker, { limit: 200, sinceDays: options?.sinceDays ?? 365 * 10 })`.
3. Filter to rows where `form_type` matches `/^8-K(\/A)?$/` AND `items` (the new field from Step 1.1.3) contains `'5.03'`. If `items` is null on a given row (older filings), still include the row — older 8-Ks may lack the items field upstream and we'd rather false-positive a body fetch than miss a real split.
4. For each surviving row, call `getFilingBody`. Skip rows where the body fetch returns null.
5. Run the body through `extractReverseSplit(body)` (Step 2.2.2). Skip rows where the parser returns null.
6. Return the matches sorted newest-first by `announcementDate`.

**Step 2.2.2 — Parser** in the same file:

```ts
interface RawSplit {
  ratio: string;
  executionDate: string | null;
}

export function extractReverseSplit(text: string): RawSplit | null;
```

Detection strategy — try patterns in order, return first non-null:

```ts
// Ratio: covers '1-for-25', '1 for 25', '1:25', 'one-for-twenty-five', and 'X-to-Y' phrasings.
const RATIO_PATTERNS: RegExp[] = [
  /(\d+)\s*[-\s]?\s*(?:for|to|:)\s*[-\s]?\s*(\d+)\s+reverse\s+(?:stock\s+)?split/i,
  /reverse\s+(?:stock\s+)?split\s+(?:at\s+(?:a\s+)?ratio\s+of\s+)?(\d+)\s*[-\s]?\s*(?:for|to|:)\s*[-\s]?\s*(\d+)/i,
  /(\d+)\s*[-\s]?\s*(?:for|to)\s*[-\s]?\s*(\d+)\s+(?:share\s+)?consolidation/i,
];
```

For each pattern, capture group 1 = numerator, group 2 = denominator. **Reverse splits have denominator > numerator** (e.g. `1-for-25` not `25-for-1`); if the captured pair has `numerator >= denominator`, treat as a no-match and try the next pattern. Normalize output as `${numerator}-for-${denominator}` (always hyphen-for-hyphen, regardless of input separator).

Effective-date extraction: search for a date phrase in the same paragraph (or within ±200 chars of the ratio match). Pattern bank:

```ts
const DATE_PATTERNS: RegExp[] = [
  /effective\s+(?:on\s+|as\s+of\s+|date\s+of\s+)?([A-Z][a-z]+\s+\d{1,2},\s*\d{4})/i,
  /effective\s+(?:on\s+|as\s+of\s+)?(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
  /effective\s+(?:on\s+|as\s+of\s+)?(\d{4}-\d{2}-\d{2})/i,
];
```

Convert the matched date string to ISO `YYYY-MM-DD` (write a small `parseFlexibleDate` helper at the bottom of the file). If no date found, return `executionDate: null` — having the ratio is more important than having the date. The 8-K filing date (`announcementDate` in the outer caller) is always present as a fallback.

Cap the `text` slice you scan to the first 50,000 chars of the body — Item 5.03 disclosures appear near the top, and 8-Ks can be very long with exhibits. Saves regex backtracking time.

### Phase 2.3 — Wire into the registry

**Step 2.3.1 — Replace** `lib/askedgar.ts:439-442` (`fetchReverseSplits`) and `lib/askedgar.ts:476` (registry entry):

- Import: `import { getReverseSplits } from '@/lib/sec/reverse-splits';`
- Delete the local `fetchReverseSplits` function (it now becomes dead code).
- Update registry: `'reverse-splits': { label: 'Reverse Splits', run: (ticker) => getReverseSplits(ticker) },`

The snapshot mapper at `lib/askedgar.ts:892-900` already reads `ratio` and `executionDate|execution_date|date`. `getReverseSplits` returns `executionDate` (camelCase) — that already matches the alias chain. **Verify by re-reading lines 892-900** before assuming. If field names drift, add aliases there.

### Phase 2.4 — Tests

**Step 2.4.1 — Parser unit tests** in `__tests__/sec-reverse-splits-parser.test.ts` (new file): import `extractReverseSplit`. Cover:
- `'effected a 1-for-25 reverse stock split, effective March 14, 2026'` → `{ ratio: '1-for-25', executionDate: '2026-03-14' }`
- `'1 for 50 reverse stock split'` (no date) → `{ ratio: '1-for-50', executionDate: null }`
- `'reverse stock split at a ratio of 1:100'` → `{ ratio: '1-for-100', executionDate: null }`
- `'25-for-1 forward stock split'` (forward, denominator < numerator) → `null`
- Empty string → `null`
- Item 5.03 about a non-split charter amendment (e.g. `'amend the bylaws to increase the size of the board'`) → `null`

**Step 2.4.2 — HTML stripping** unit test in `__tests__/sec-filing-body.test.ts` (new file): pass HTML containing `<script>` blocks, `<style>` blocks, mixed tags, and entities; assert the stripped output is whitespace-clean and entity-decoded. Don't test the full `getFilingBody` flow with DB cache here — keep the test focused on the strip helper. Export the strip helper from `filing-body.ts` for testability.

**Step 2.4.3 — Integration test** in `__tests__/sec-reverse-splits.test.ts` (new file): mock `getRecentFilings` and `getFilingBody`, run `getReverseSplits('GLND')`, assert it filters to Item 5.03 8-Ks, calls the parser, and returns the expected shape. One happy-path test is enough — parser correctness is covered by Step 2.4.1.

### Phase 2.5 — Validation

**Step 2.5.1 — Validation commands**: `npm run lint && npx tsc --noEmit && npm test && npm run workflow:audit`. All must pass.

**Step 2.5.2 — Manual smoke** (note in commit message that you couldn't run live unless prompted): pick a ticker known to have had a recent reverse split. From the Research tab, confirm the snapshot's reverse-splits section populates and matches the SEC 8-K source filing (use the URL from the new Filings tab to cross-check).

**Commit** as `AskEdgar Sprint 3 — reverse-splits via SEC 8-K Item 5.03`.

---

## Validation Snapshot

- Filings v1 (`2026-04-29`, pending review/commit): added `filings` to the research snapshot contract, bucketed SEC form-type mapping via `lib/filings-bucket.ts`, SEC `items` passthrough in `lib/sec/submissions.ts`, a split Research `News`/`Filings` UI, and focused tests in `__tests__/filings-bucket.test.ts`, `__tests__/research-snapshot-mapper.test.ts`, and `__tests__/sec-submissions.test.ts`. `npm run lint`, `npx tsc --noEmit`, `npm test` (474/474), and `npm run workflow:audit` passed. Manual browser smoke remains pending because the Research tab requires an authenticated session.
- Backtesting Phase 3 (`2026-04-28`, committed `8032710` + polish `f2f4087`/`c29b25a`/`6456f69`): `npm run lint`, `npx tsc --noEmit`, `npm test` (466/466), `npm run workflow:audit` all passed at Phase 3 ship.
- Backtesting Phase 2 (`2026-04-28`, committed `745958d`): tests 457/457 green.
- Backtesting Phase 1 (`2026-04-28`, committed `4633b30`): `drizzle/0025_blue_joseph.sql` applied to Neon; tests 454/454 green.
- AskEdgar Sprint 2 (`2026-04-27`, committed `cbde6ee`): `historical-float-pro` swapped to SEC companyfacts; `0024_acoustic_jocasta.sql` applied.
- AskEdgar Sprint 1 (`2026-04-27`, committed `b4a3e73`): `filing-titles` swapped to SEC submissions.

## Follow-Up Notes

- **Backtesting drawings still don't render (2026-04-28).** Refactor work captured the `armedAction`/`onArmedClick`/`onAnchorChange` callbacks in refs and memoized `handleArmedClick`; execution arrows + stop line render fine, but user-drawn trendlines/horizontals/rectangles still don't appear. Suspect canvas overlay sizing (parent `clientWidth/Height` is 0 on first mount, leaving the canvas at 0×0) or pointer-events stealing clicks before `chart.subscribeClick` fires. Investigate by adding console logs in `ChartDrawings.tsx:212` (handleClick), `ChartDrawings.tsx:289` (handleCrosshairMove), `ChartDrawings.tsx:405` (renderDrawings) and inspecting the canvas DOM rect in DevTools.
- **GLND "no financial commentary" (2026-04-27).** Originally suspected to be a Sprint 1 bug. Confirmed unrelated: `managementCommentary` is read from AskEdgar's `dilution-data[0].management_commentary`, not from `filing-titles` (`lib/agents/blueprints/small-cap-research.ts:816`). The GLND `dilution-data` payload was likely just empty for that field. Re-check after Sprint 3 ships; if it persists, triage as a separate AskEdgar payload investigation.
- **Filings v2 (deferred) — in-app viewer.** AskEdgar-style filing reader (iframe of the SEC primary document with Exhibits sidebar from `<accession>/index.json`, browser-native Ctrl+F inside the iframe). ~1-2 days. Defer until Filings v1 ships and we have user feedback on the click-out flow.
- **Filings v3 (deferred) — full-text search + AI Copilot.** "Search in Documents" across all filings for a ticker requires Postgres `tsvector` ingestion or external index. AI Copilot panel (Summarize / Key Points / Catalysts) plumbs into existing agent infra. Cost analysis required first.
- **Auto stop-out for Backtesting (deferred).** When intraday bar prints through a stop, simulator should auto-execute SELL/COVER. Schema supports it. UI: settings toggle defaulting OFF for parity. Add when user requests.
- **Backtest analytics roll-up (idea).** REVIEWED sessions are a corpus of practiced setups — could surface aggregate stats. Out of scope for Backtesting v1.
- **News-formatter UX trade.** Filing feeds default to `${formType} filing` labels via fallback in `lib/agents/news-formatter.ts:198`. AI headlines deferred to buildout-doc Phase 8.
- **AskEdgar Sprint 3 sequencing.** After reverse-splits ships, the next two endpoints are `split-status` (state machine across multiple events — uses the same SEC body-fetch infra from Spec 2 Phase 2.1) and basic `offerings` (parses 424B prospectus bodies). Both reuse `getFilingBody` and `secFilingBodyCache` from this spec.
- **AskEdgar paid API key.** `https://eapi.askedgar.io` remains the correct base URL. Only swap `ASKEDGAR_API_KEY` env var; do not touch `ASKEDGAR_BASE_URL`.
- **Cost-per-report baseline.** Sprint 1 dropped `filing-titles` and Sprint 2 dropped `historical-float-pro` from AskEdgar fan-out. Sprint 3 will drop `reverse-splits`. Track via `[askedgar-fanout]` log's `costUsd` token.
- **Endpoint review pending (2026-04-29).** User flagged for future scrutiny: `pump-and-dump-tracker`, `screener`, `ownership`, `split-status`, `nasdaq-compliance` (likely-removable); `historical-float-pro`, `float-outstanding` (review payload). Park the audit until Sprint 3 ships.

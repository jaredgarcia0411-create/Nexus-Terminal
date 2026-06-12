# Nexus Terminal - HANDOFF.md

> Updated: 2026-06-11
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and durable docs such as `docs/repo-cleanup.md`.

Historical completed sections (Sprints 1-16, Tier 1 Cleanup, Chart Drawings, Multi-Day Charts, CSV/Cover-Close flows, Sheets Sprints 1-7 + Massive Wave 1-2, backtest user-id fixes, Filing headline parser, Calendar Year Overview, Workflow Maintenance, Nav Reorg, Sheets Today-filter + report-by-ticker/date, EODHD News API swap) were removed to keep this file focused. Use git history and `docs/repo-cleanup.md` for archived implementation detail.

> **Parked:** the Scanner Epic 1 execution spec was moved to `specs/scanner-epic1-handoff.md` (not started — still waiting on the worktree + Neon-branch setup). Move it back here when you're ready to run it.

---

## Active Spec — Unified News Feed (EODHD articles + material SEC filings)

> Goal: make the Research **News** tab a single date-sorted "what happened" feed by merging
> EODHD press articles with material first-party SEC filings. The **Filings** tab stays
> unchanged (full filing list). The research agent is **not** touched — it builds its news
> input from `rawData['news']` directly (`lib/agents/blueprints/small-cap-research.ts:707`),
> not from the snapshot's `news` field, so this change is UI-only.
>
> Context: EODHD's coverage of thin micro-caps lags and misses some PRs (confirmed: GMM's
> June 8/9 GlobeNewswire articles are absent from EODHD entirely). Filing-backed events
> (reverse splits → 6-K, offerings → 424B/S-1) are recoverable from our own SEC data; this
> spec surfaces them in the News feed. **Known residual (accepted):** pure-promo PRs with no
> filing (e.g. a co-investment announcement) still won't appear, and EODHD's own feed can
> carry false positives — neither is fixed here.

### Step 1 — Merge filings into the snapshot news feed

File: `lib/askedgar/snapshot-normalizer.ts`

1. Add `FilingBucket` to the existing `import type { ... } from '@/lib/types'` block (lines 3-15). `ResearchSnapshotNewsItem` is already imported — leave it.
2. The EODHD news array is built at lines 228-235 (`const news: ResearchSnapshotNewsItem[] = ...`). `secFilingRows` is built at 237-257 and assigned `const filings = secFilingRows;` at line 259. **Immediately after line 259**, insert:

```ts
// Unified "what happened" feed: EODHD articles + material SEC filings, newest first.
// Whitelist by bucket so the News tab surfaces structural events (8-K/6-K, S-1/S-3/F-*,
// 424B prospectuses) without drowning in routine forms (Form 4, 13G, 10-K, proxies).
const MATERIAL_FILING_BUCKETS: ReadonlySet<FilingBucket> = new Set(['news', 'registrations', 'prospectus']);

const filingNewsItems: ResearchSnapshotNewsItem[] = filings
  .filter((filing) => MATERIAL_FILING_BUCKETS.has(filing.bucket))
  .map((filing) => ({
    title: filing.title,
    summary: '',
    filedAt: filing.filedAt,
    formType: filing.formType,
    url: filing.url,
    isNews: false,
  }));

const unifiedNews = [...news, ...filingNewsItems].sort((a, b) => {
  const at = a.filedAt ? new Date(a.filedAt).getTime() : NaN;
  const bt = b.filedAt ? new Date(b.filedAt).getTime() : NaN;
  if (Number.isNaN(at) && Number.isNaN(bt)) return 0;
  if (Number.isNaN(at)) return 1;   // null/invalid dates sink to the bottom
  if (Number.isNaN(bt)) return -1;
  return bt - at;                   // newest first
});
```

3. In the returned object (line 431), change `news,` to `news: unifiedNews,`. Leave `filings,` (line 432) unchanged.

### Step 2 — Distinguish filing rows in the News UI

File: `components/trading/research-report-sections/NewsSection.tsx`

The list maps `news` to clickable `<button>`s (lines 109-121) that open the in-app `ArticleReader`. Filing items have no article body (`summary: ''`), so they must open the SEC document directly instead of an empty reader, and carry a small form-type badge.

1. Replace the `news.map(...)` block (lines 109-121) so each row branches on `item.isNews`:
   - **`item.isNews === true`** (EODHD article): keep the existing `<button>` that calls `setSelectedIndex(index)` → reader.
   - **`item.isNews === false`** (filing): render an `<a href={item.url ?? '#'} target="_blank" rel="noopener noreferrer">` with the **same** card classes (`block w-full cursor-pointer rounded-xl border border-border bg-card p-4 text-left transition-colors hover:bg-accent`).
2. In **both** branches render the same inner content as today (relative time · timestamp, then the title). For filing rows only, add a form-type pill on the meta line, styled to match the existing `$ticker` pill in `ArticleReader` (line 50) for consistency:

```tsx
<span className="rounded-sm bg-accent px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
  {item.formType}
</span>
```

   Suggested row shape (apply to both branches; only the wrapper element + the pill differ):

```tsx
<div className="flex items-center gap-2 text-xs text-muted-foreground">
  {!item.isNews && item.formType ? (
    <span className="rounded-sm bg-accent px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
      {item.formType}
    </span>
  ) : null}
  <span>{formatRelativeTime(item.filedAt)} · {formatListTimestamp(item.filedAt)}</span>
</div>
<div className="mt-1 text-sm font-semibold text-foreground">{item.title}</div>
```

3. Keep the `key={`news-${index}`}` pattern and the `NoDataBadge` empty-state (line 122) as-is.

### Step 3 — Tests

File: `__tests__/research-snapshot-mapper.test.ts`

**3a. Update the existing test that this change breaks.** The case at line 66 (`'uses first-party SEC filing metadata for the filings tab while preserving news rows'`) feeds 1 EODHD article (dated 2026-04-25) plus a `10-K` and an `S-1`. After the merge, `snapshot.news` will contain the article **and** the `S-1` (bucket `registrations` = material; the `10-K` is bucket `financials` = excluded). Its `snapshot.news` assertion (line 136) currently expects only the article and will fail. Change that assertion to expect, newest-first:
  - the article (`isNews: true`, `formType: 'News'`, filedAt `2026-04-25T13:00:00Z`), then
  - the `S-1` (`isNews: false`, `formType: 'S-1'`, filedAt `2024-12-15`).
  Leave the `snapshot.filings` assertion (line 145) unchanged — both filings still belong to the Filings tab. (The case at line 163, with empty `sec-filings`, needs no change.)

**3b. Add one focused case** proving the whitelist + sort: feed a `news` article and a `sec-filings` set with a `6-K` dated **newer** than the article plus a non-material `4` (Form 4). Assert `snapshot.news`:
  - includes the EODHD article (`isNews: true`) and the `6-K` (`isNews: false`, `formType: '6-K'`),
  - **excludes** the Form 4,
  - is sorted newest-first (the newer `6-K` precedes the older article),
  - and that `snapshot.filings` still contains all filings (Form 4 included).

> **Filing headline note (intended behavior, not a bug):** a merged filing row's `title` is the deterministic form label from `summarizeFilingMetadata` (`lib/sec/filing-summary.ts`), NOT the press-release headline. The GMM reverse-split `6-K` shows as **"foreign issuer report"**; an offering `8-K` shows its parsed item label (e.g. "unregistered sale of equity"); a `424B` shows "prospectus supplement". The readable PR headline only exists in the news article (which EODHD lacks for GMM). So filing rows surface the *event + date + form badge*; the user clicks through to the SEC doc for detail. This is expected and acceptable per the chosen approach.

### Validation

Run from repo root:
- `npm run lint`
- `npx tsc --noEmit`
- `npm run typecheck:services`
- `npm test`

### Acceptance criteria

- Research → News for a ticker with a recent material filing (try **GMM**) shows the 6-K reverse-split filing inline, date-sorted among the EODHD articles, with a `6-K` badge; clicking it opens the SEC document in a new tab.
- Research → Filings is visually unchanged.
- EODHD-only articles still open the in-app reader as before.
- No Form 4 / 13G / 10-K / proxy noise appears in the News tab.

> Note: the `limit` bump for EODHD news (`lib/askedgar/endpoints.ts:284`, 20→50) is already applied in the working tree and is part of this change set — commit it together.

---

## Open Follow-Ups

Playbook rich text:
- Roll `RichTextEditor` into the daily/weekly journal review sections (same `type: 'text'` pattern).
- Optional: Notion-style slash (`/`) command menu; checklists / code blocks / highlight.

Deferred — filing-headline parser for the News feed (not started):
- Merged filing rows currently show a generic form label (e.g. a 6-K reads "foreign issuer report"), not the real PR headline. The actual press release is attached to the 6-K/8-K as an `EX-99.1` exhibit.
- To recover real headlines: per material filing, fetch `…/edgar/data/CIK/ACCESSION/index.json` → find the `EX-99.1` doc → fetch + extract its `<title>`/first heading. Needs a per-accession cache (so each filing is parsed once), a SEC User-Agent, ~10/sec rate limiting, and a graceful fallback to the form label when a filing has no PR exhibit.
- Cheap partial alt (no network): expand the 8-K item-code map in `lib/sec/filing-summary.ts`. Helps 8-Ks only, not 6-Ks.
- Pick this up only if the generic 6-K labels prove annoying in daily use.

Deferred Sheets roadmap (not started):
- Manual authenticated smoke for sharing (invite logged-in coworker, flip role, remove; unknown-email error; viewer read-only / editor sees no manage buttons).
- Self-leave (non-owner removing own membership), ownership transfer, email/invite-link notifications for users who haven't signed in.
- Templates / per-day "start today's sheet" flow beyond plain Duplicate.
- CSV export, archive/unarchive UI, undo/redo, polling/SSE invalidation.

> Historical completed sections (Rich Text + Autosave for Reviews/Notes, Playbook Auto-Save + Font-Size, Playbook Rich Text, News Section Redesign) were removed to keep this file focused. Use git history and the `specs/` directory for archived implementation detail.

---

## Recently Completed

### Mobile Optimization — 7 Responsive Fixes

Status: completed 2026-06-11.

Outcome:
- Responsive fixes across bottom nav, macro/report headers, Performance Stats, Career P/L, Playbook header, Research restack, and global page padding — desktop (≥768px) unchanged.
- Research mobile fix: dropped the fixed-height inner-scroll anchor on mobile (`min-h-[60vh] md:h-[calc(100vh-120px)]`) so the stacked header+chart+report flow and the page scrolls (was clipping the Overview chart).
- Moved Research "Add to Sheets" next to the symbol search box on mobile (`md:hidden`); desktop keeps the overlaid button.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (830 passed).
- Founder confirmed on mobile: Overview chart fully visible, Add-to-Sheets beside search.

---

## Session Maintenance

- Keep this file compact: active specs only while work is in flight, short summaries after validation.
- If a new multi-step feature starts, replace or append a self-contained execution spec with exact file paths, ordered changes, acceptance criteria, and validation requirements.
- If only docs/workflow assets change, run `npm run workflow:audit`.
- Do not modify `.env*` or secret files.

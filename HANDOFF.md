# Nexus Terminal - HANDOFF.md

> Updated: 2026-10-29
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and durable docs such as `docs/repo-cleanup.md`.

Historical completed sections were removed to keep this file focused. Use git history and the `specs/` directory for archived implementation detail.

> **Parked:** the Scanner Epic 1 execution spec was moved to `specs/scanner-epic1-handoff.md` (not started — still waiting on the worktree + Neon-branch setup). Move it back here when you're ready to run it. The Parabolic Short Scanner (completed below) is deliberately **independent** of that epic.

---

## Open Follow-Ups

Playbook rich text:
- Roll `RichTextEditor` into the daily/weekly journal review sections (same `type: 'text'` pattern).
- Optional: Notion-style slash (`/`) command menu; checklists / code blocks / highlight.

Sheets:
- Manual smoke for the AH/PM + numeric filter columns (known past runner, `>0.33` + `>10m` filter) not yet run.
- Deferred roadmap (not started): manual authenticated sharing smoke (invite logged-in coworker, flip role, remove; unknown-email error; viewer read-only / editor sees no manage buttons); self-leave, ownership transfer, invite notifications; templates / per-day "start today's sheet"; archive/unarchive UI, undo/redo, polling/SSE invalidation.

---

## Session Maintenance

- Keep this file compact: active specs only while work is in flight, short summaries after validation.
- If a new multi-step feature starts, replace or append a self-contained execution spec with exact file paths, ordered changes, acceptance criteria, and validation requirements.
- If only docs/workflow assets change, run `npm run workflow:audit`.
- Do not modify `.env*` or secret files.

---

## Triple Beat Earnings Scanner v1 — Pre-Market Long Scan + Historical Replay

> Generated: 2026-10-29 | Author: Claude (plan)
> Status: PLANNED

### Goal

Every trading day at `TRIPLE_BEAT_CRON_HOUR_ET` (default 9 ET), the Optiplex orchestrator worker finds stocks gapping up 4%+ premarket on a fresh earnings report and scores them with the coworker's Triple Beat Earnings (TBE) playbook v1.0, a blend of Stockbee's EP, Qullamaggie's EP and SMB's Money Trade. It posts grade-colored Discord cards to `DISCORD_WEBHOOK_TRIPLE_BEAT`. A CLI replay scores past sessions and writes outcome CSVs so `RULES` can be tuned.

This mirrors the Parabolic Short Scanner (`lib/parabolic/*`, `orchestrator-parabolic-scan.ts`, `startParabolicCron`, `buildParabolicScanEmbeds`, `scripts/parabolic-replay.ts`). Copy those files' conventions.

### Locked decisions (do not change)

- Long-only. Earnings gap-ups only.
- **Data we have:**
  - Massive: snapshot, bars and news.
  - EODHD: **news only**. The EODHD earnings calendar, trends and fundamentals endpoints, and Massive's Benzinga add-on, all return 403 on our plans. Do not call them.
  - SEC EDGAR: free.
- **Catalyst gate (mandatory):**
  - An SEC **8-K whose items include `2.02`** (Results of Operations), accepted between the prior session's 16:00 ET and the scan time.
  - **Or** a **6-K** in that window (foreign filers have no item codes) **plus** an earnings-titled news headline in the window.
  - SEC `acceptance_datetime` is true UTC. Verified: NCLH's 2026-10-29 earnings 8-K shows `2026-10-29T11:00:29.000Z`, which is 07:00 ET. Parse it with `Date.parse`.
- **LLM role: small, deterministic and verified.**
  - Uses the existing `callLlm(..., 'background')` (Together on the server) at `temperature: 0` with strict JSON.
  - It reads the press release (8-K/6-K exhibit 99.1) plus Massive and EODHD headlines in the window.
  - It returns:
    - EPS beat and revenue beat vs. **analyst consensus**: `yes|no|unknown`.
    - Guidance: `raised|maintained|lowered|none|unknown`.
    - A `mixedCatalyst` flag and a one-line note.
    - An evidence quote for each answer.
  - **Code then checks each quote is a verbatim excerpt of the inputs** (whitespace- and case-insensitive). If not, that answer is downgraded to `unknown`.
  - Everything else is pure code driven by a `RULES` constant.
- **Score (100 points; max 90 premarket):**
  - Earnings 25, chart 20, volume 20, gap and overnight 15, entry/risk 10, liquidity 10.
  - "Projected RVOL 3x+" (10 points) is always `unknown` before the open, so `MAX_PREMARKET_SCORE = 90`.
  - Grades: **A+ ≥ 85, A ≥ 75, B ≥ 60, Pass < 60**. These are absolute cutoffs, the same convention as the parabolic scanner.
  - If all three beats are `unknown`, the maximum is 65 (grade B, watch-only). A stock can't be sized without verified beats.
- **Mandatory disqualifiers:**
  - No earnings filing (handled by the gate).
  - Price < $5.
  - 20-day average dollar volume < $5M.
  - Premarket gap < 4% (a faded gap).
  - No entry/stop (premarket high ≤ premarket low, or ATR 0).
- **Plan:**
  - Entry = break of the premarket high. Stop = premarket low (a proxy for the session low).
  - Risk per share = entry − stop.
  - T1 partial = entry + 2R. The runner trails on a daily close below the 10EMA.
  - Cards show entry, stop, risk per share and R fraction. **No share counts.**
- **Risk by grade:** A+ = 1R, A = ½R, B = watch only (0).
  - The stop is too wide when risk > 1.5 ATR14, and then the R fraction is forced to 0 (watch only) whatever the grade. The playbook says a stock with a distant stop stays on the watchlist and is not bought.
- **Delivery:**
  - Discord cards via the new `DISCORD_WEBHOOK_TRIPLE_BEAT`: one header card plus up to 9 setup cards in one webhook message.
  - Posts even when there are zero setups. Skips market holidays.
- **Replay:**
  - `npx tsx scripts/triple-beat-replay.ts --from … --to …` writes a CSV to the home directory, outside the repo.
  - Prints summaries by grade, by gap bucket (`4-7.9`, `8-9.9`, `10+`), and for strict triple beats.
  - **The replay caches LLM reads in `~/triple-beat-llm-cache.json` keyed by `TICKER:YYYY-MM-DD`**, so reruns only call the LLM for ticker/dates it hasn't seen.
  - News in the replay is limited to items published before 09:30 ET on the trade date, so there's no lookahead.
- No DB migration. Report and job columns are text/JSON, as with the parabolic scanner.
- Independent of the parked Scanner Epic.

### Data flow (live)

```
fetchAllTickerSnapshots ── passesLivePrefilter (gap ≥3.5%, close ≥4.5, prior-day $vol ≥$1M) ── gappers
  └─ per ticker (batches of 5):
     getRecentFilings(limit 20, sinceDays 5) ── findEarningsFiling(window) ── none → drop      (earningsFilings += 1 when found)
     fetchDailyBars(−400d → prior session) + fetchExtendedHoursStats(prior 16:00 ET → min(now, 09:30))
     evaluateTripleBeatSetup(…, UNKNOWN_EARNINGS_READ) ── not qualified → drop                 (cheap technical gate before any LLM call)
     fetchEarningsNews(window) ── 6-K without an earnings headline → drop
     fetchPressReleaseText(filing) + news ── buildEarningsEvidence ── classifyEarnings (LLM + quote verification)
     evaluateTripleBeatSetup(…, earnings) ── keep if plan && grade !== 'Pass'
  sort score desc, then gapPct desc ── report ── buildTripleBeatScanEmbeds ── DISCORD_WEBHOOK_TRIPLE_BEAT
```

---

### Step 1 — Massive helpers

**File:** `lib/massive-market.ts`
**Action:** MODIFY

1. In `interface MassiveMarketMoverTicker` (near the top), change `prevDay?: { c?: number };` to `prevDay?: { c?: number; v?: number };`. This only widens the type; existing readers of `prevDay.c` are unaffected.
2. Directly after `fetchTopMarketMovers` (anchor: `export async function fetchTopMarketMovers`), add:

```ts
// Whole-market snapshot. Populated from 04:00 ET, so todaysChangePerc is the premarket gap before the open.
export async function fetchAllTickerSnapshots() {
  return fetchMassiveJson<MassiveTopMoversResponse>('/v2/snapshot/locale/us/markets/stocks/tickers', {
    include_otc: 'false',
  });
}
```

3. Directly after `fetchTickerNews` (anchor: `export async function fetchTickerNews`), add:

```ts
export async function fetchTickerNewsBetween(ticker: string, fromIso: string, toIso: string): Promise<MassiveNewsArticle[]> {
  const response = await fetchMassiveJson<{
    results?: MassiveNewsArticle[];
  }>('/v2/reference/news', {
    ticker: normalizeMassiveTicker(ticker),
    'published_utc.gte': fromIso,
    'published_utc.lte': toIso,
    order: 'desc',
    sort: 'published_utc',
    limit: '20',
  });

  return response.results ?? [];
}
```

**Acceptance:**
- [ ] `fetchAllTickerSnapshots` and `fetchTickerNewsBetween` are exported.
- [ ] `fetchTickerNews` is unchanged.

---

### Step 2 — EODHD news date range

**File:** `lib/eodhd.ts`
**Action:** MODIFY

1. Change the signature to `export async function fetchEodhdNews(ticker: string, limit = 20, range?: { from: string; to: string }): Promise<AskEdgarResponse<unknown>>`.
2. After the `const params = new URLSearchParams({...});` block, add:

```ts
  if (range) {
    params.set('from', range.from);
    params.set('to', range.to);
  }
```

`from` and `to` are `YYYY-MM-DD`. The only existing caller, `lib/askedgar/endpoints.ts` (`fetchEodhdNews(ticker, 50)`), is unaffected.

**File:** `__tests__/eodhd.test.ts`
**Action:** MODIFY. Add one test asserting that passing `{ from: '2026-10-28', to: '2026-10-29' }` puts `from=2026-10-28&to=2026-10-29` in the fetched URL. Follow the file's existing fetch-mock style.

**Acceptance:**
- [ ] Existing EODHD tests still pass, and the new range test passes.

---

### Step 3 — Press-release exhibit fetch (reuse + fix)

**File:** `lib/sec/filing-headline.ts`
**Action:** MODIFY

Today `fetchExhibitHeadline` finds the EX-99.1 exhibit and returns only its headline. Two problems:
- SEC `index.json` items have `type: "text.gif"`, so the `type` match never hits.
- The name regex `/ex-?99[._-]?0?1/i` misses `exh_991.htm`, the name NCLH's 2026-10-29 earnings 8-K uses.

1. Replace the body of `fetchExhibitHeadline` (anchor: `async function fetchExhibitHeadline`) by splitting it into an exported fetcher plus the existing wrapper:

```ts
// Exhibit names vary by filing agent: ex99-1.htm, ex-99_1.htm, d123dex991.htm, exh_991.htm.
export async function fetchPressReleaseHtml(cik: string, accession: string): Promise<string | null> {
  const cikUnpadded = String(parseInt(cik, 10));
  const accNoDashes = accession.replace(/-/g, '');
  const baseUrl = `https://www.sec.gov/Archives/edgar/data/${cikUnpadded}/${accNoDashes}`;
  const idx = await secFetchJson<{
    directory?: { item?: Array<{ name?: string; type?: string }> };
  }>(`${baseUrl}/index.json`);
  const items = idx.directory?.item ?? [];
  const exhibit = items.find((item) => item.type && /^EX-99(\.0?1)?$/i.test(item.type))
    ?? items.find((item) => item.name && /exh?[-_]?99[._-]?0?1/i.test(item.name));

  if (!exhibit?.name) return null;

  return secFetchText(`${baseUrl}/${exhibit.name}`);
}

async function fetchExhibitHeadline(cik: string, accession: string): Promise<string | null> {
  const html = await fetchPressReleaseHtml(cik, accession);
  return html ? extractPrHeadline(html) : null;
}
```

**File:** `__tests__/sec-filing-headline.test.ts`
**Action:** MODIFY. Add a `describe('fetchPressReleaseHtml')` test using the file's existing `vi.mock('@/lib/sec/client')`:
- `secFetchJson` resolves `{ directory: { item: [{ name: 'f8k_102826.htm', type: 'text.gif' }, { name: 'exh_991.htm', type: 'text.gif' }] } }`.
- `secFetchText` resolves `'<p>release</p>'`.
- Assert the result is `'<p>release</p>'`, and that `secFetchText` was called with `https://www.sec.gov/Archives/edgar/data/1513761/000117184326006957/exh_991.htm` for cik `'0001513761'` and accession `'0001171843-26-006957'`.

**Acceptance:**
- [ ] `fetchPressReleaseHtml` is exported; `enrichFilingHeadlines` behavior is unchanged except that it now also finds `exh_991`-style exhibits.

---

### Step 4 — TBE data loaders

**File:** `lib/triple-beat/data.ts`
**Action:** CREATE

```ts
import { fetchEodhdNews } from '@/lib/eodhd';
import { fetchMassiveAggregateBars, fetchTickerNewsBetween } from '@/lib/massive-market';
import { stripFilingBodyHtml } from '@/lib/sec/filing-body';
import { fetchPressReleaseHtml } from '@/lib/sec/filing-headline';
import type { SecFiling } from '@/lib/sec/submissions';
import { nyDateTimeToEpoch } from '@/lib/time-utils';

const PRESS_RELEASE_MAX_CHARS = 12_000;
const NEWS_TEXT_MAX_CHARS = 1_500;
const EARNINGS_HEADLINE_RE = /\b(earnings|financial results|quarterly results|EPS)\b/i;

export interface ExtendedHoursStats {
  last: number;
  high: number;
  low: number;
  volume: number;
  premarketHigh: number;
  premarketLow: number;
}

export interface NewsItem {
  source: 'massive' | 'eodhd';
  title: string;
  text: string;
}

// Split-adjusted 1-minute bars from `priorSession` 16:00 ET (after-hours) through `date` premarket,
// ending at the earlier of `untilMs` and the 09:30 open. high/low/volume span both sessions.
export async function fetchExtendedHoursStats(
  ticker: string,
  priorSession: string,
  date: string,
  untilMs: number,
): Promise<ExtendedHoursStats | null> {
  const start = nyDateTimeToEpoch(priorSession, '16:00:00');
  const premarketStart = nyDateTimeToEpoch(date, '04:00:00');
  const open = nyDateTimeToEpoch(date, '09:30:00');
  if (start == null || premarketStart == null || open == null) return null;

  const bars = (await fetchMassiveAggregateBars({
    ticker,
    multiplier: '1',
    timespan: 'minute',
    from: String(start),
    to: String(Math.min(untilMs, open)),
  })).filter((bar) => Number(bar.t) >= start && Number(bar.t) < open
    && [bar.h, bar.l, bar.c].every((value) => value != null && Number.isFinite(Number(value))));
  const premarket = bars.filter((bar) => Number(bar.t) >= premarketStart);
  if (premarket.length === 0) return null;

  return {
    last: Number(premarket[premarket.length - 1].c),
    high: Math.max(...bars.map((bar) => Number(bar.h))),
    low: Math.min(...bars.map((bar) => Number(bar.l))),
    volume: bars.reduce((sum, bar) => sum + Number(bar.v ?? 0), 0),
    premarketHigh: Math.max(...premarket.map((bar) => Number(bar.h))),
    premarketLow: Math.min(...premarket.map((bar) => Number(bar.l))),
  };
}

// 8-K item 2.02 is an exact earnings signal; foreign filers' 6-Ks carry no item codes, so callers
// must confirm a 6-K with an earnings headline.
export function findEarningsFiling(filings: SecFiling[], startMs: number, endMs: number): SecFiling | null {
  const inWindow = filings.filter((filing) => {
    const accepted = Date.parse(filing.acceptance_datetime ?? '');
    return accepted >= startMs && accepted <= endMs;
  });
  return inWindow.find((filing) => filing.form_type === '8-K'
    && (filing.items ?? '').split(',').map((item) => item.trim()).includes('2.02'))
    ?? inWindow.find((filing) => filing.form_type === '6-K')
    ?? null;
}

export function isEarningsHeadline(title: string): boolean {
  return EARNINGS_HEADLINE_RE.test(title);
}

export async function fetchPressReleaseText(filing: SecFiling): Promise<string> {
  const html = await fetchPressReleaseHtml(filing.cik, filing.accession_number);
  return html ? stripFilingBodyHtml(html).slice(0, PRESS_RELEASE_MAX_CHARS) : '';
}

export async function fetchEarningsNews(ticker: string, startMs: number, endMs: number): Promise<NewsItem[]> {
  const [massive, eodhd] = await Promise.all([
    fetchTickerNewsBetween(ticker, new Date(startMs).toISOString(), new Date(endMs).toISOString()).catch(() => []),
    fetchEodhdNews(ticker, 20, {
      from: new Date(startMs).toISOString().slice(0, 10),
      to: new Date(endMs).toISOString().slice(0, 10),
    }),
  ]);
  const eodhdItems = (eodhd.results as Array<{ date?: string; title?: string; content?: string }>).filter((item) => {
    const published = Date.parse(item.date ?? '');
    return published >= startMs && published <= endMs;
  });
  return [
    ...massive.map((article): NewsItem => ({ source: 'massive', title: article.title ?? '', text: article.description ?? '' })),
    ...eodhdItems.map((item): NewsItem => ({
      source: 'eodhd', title: item.title ?? '', text: (item.content ?? '').slice(0, NEWS_TEXT_MAX_CHARS),
    })),
  ].filter((item) => item.title);
}
```

Behavior notes:
- The 12,000-char press-release cap is deliberate. NCLH's EX-99.1 strips to about 48k chars, and its highlights plus "Raised full year 2026 guidance" sit in the first 3k.
- News failures degrade to fewer headlines rather than dropping the ticker. Massive throws, so it is caught; EODHD already returns `{ results: [] }` on error.

**File:** `__tests__/triple-beat-data.test.ts`
**Action:** CREATE. Mock `@/lib/massive-market` (`fetchMassiveAggregateBars`, `fetchTickerNewsBetween`) and `@/lib/eodhd` (`fetchEodhdNews`). Tests:

1. `fetchExtendedHoursStats('NCLH', '2026-10-28', '2026-10-29', Date.parse('2026-10-29T13:00:00Z'))`:
   - **Bars:**
     - after hours `t = Date.parse('2026-10-28T20:30:00Z')` `{h:22,l:21,c:21.8,v:100000}`
     - premarket `t = Date.parse('2026-10-29T09:00:00Z')` `{h:23.4,l:22.6,c:23,v:300000}`
     - premarket `t = Date.parse('2026-10-29T12:59:00Z')` `{h:23.2,l:22.9,c:23.1,v:50000}`
     - a regular-session bar at `2026-10-29T13:30:00Z` `{h:30,l:10,c:25,v:9}`
   - **Expect:** `{ last: 23.1, high: 23.4, low: 21, volume: 450000, premarketHigh: 23.4, premarketLow: 22.6 }`. The aggregate call uses `from: String(Date.parse('2026-10-28T20:00:00Z'))` and `to: String(Date.parse('2026-10-29T13:00:00Z'))`.
2. `fetchExtendedHoursStats` returns `null` when only after-hours bars exist.
3. `findEarningsFiling`, with window `[Date.parse('2026-10-28T20:00:00Z'), Date.parse('2026-10-29T13:00:00Z')]`:
   - Picks the 8-K with `items: '2.02,9.01'` accepted `2026-10-29T11:00:29.000Z`.
   - Ignores an 8-K with `items: '5.02,9.01'` in the window.
   - Ignores an 8-K `2.02` accepted `2026-07-30T10:50:20.000Z`.
   - Returns a 6-K in the window when no 8-K 2.02 exists.
   - Returns `null` when nothing is in the window.
4. `isEarningsHeadline`: true for `'SK hynix Announces 3Q26 Financial Results'` and `'Norwegian Cruise Line (NCLH) Q3 Earnings and Revenues Beat Estimates'`; false for `'Marvell nears deal to acquire Lumentum'`.
5. `fetchEarningsNews`:
   - Drops EODHD items dated outside the window.
   - Maps Massive `title`/`description`.
   - Truncates EODHD `content` to 1,500 chars.
   - Still returns the EODHD items when `fetchTickerNewsBetween` rejects.

**Acceptance:**
- [ ] All five test groups pass.

---

### Step 5 — Verified LLM earnings read

**File:** `lib/triple-beat/classify.ts`
**Action:** CREATE

```ts
import { z } from 'zod';
import { callLlm } from '@/lib/agents/llm-client';
import type { NewsItem } from '@/lib/triple-beat/data';

const MIN_QUOTE_CHARS = 12;

const earningsReadSchema = z.object({
  epsBeat: z.enum(['yes', 'no', 'unknown']),
  epsQuote: z.string(),
  revenueBeat: z.enum(['yes', 'no', 'unknown']),
  revenueQuote: z.string(),
  guidance: z.enum(['raised', 'maintained', 'lowered', 'none', 'unknown']),
  guidanceQuote: z.string(),
  mixedCatalyst: z.boolean(),
  note: z.string(),
});

export type EarningsRead = z.infer<typeof earningsReadSchema>;

export const UNKNOWN_EARNINGS_READ: EarningsRead = {
  epsBeat: 'unknown',
  epsQuote: '',
  revenueBeat: 'unknown',
  revenueQuote: '',
  guidance: 'unknown',
  guidanceQuote: '',
  mixedCatalyst: false,
  note: '',
};

const SYSTEM_PROMPT = `You read an earnings press release and news excerpts for one stock and classify the report.
Reply with JSON only, no prose and no code fences, in exactly this shape:
{"epsBeat":"yes|no|unknown","epsQuote":"","revenueBeat":"yes|no|unknown","revenueQuote":"","guidance":"raised|maintained|lowered|none|unknown","guidanceQuote":"","mixedCatalyst":false,"note":""}
Rules:
- epsBeat and revenueBeat compare the reported number with the analyst consensus estimate. Company guidance and prior-year results are not consensus. If no source states the consensus comparison, answer "unknown".
- guidance is "raised" only when the company increased its forward outlook versus its previous outlook, "maintained" when reaffirmed or unchanged, "lowered" when cut, "none" when a source says no outlook was given, otherwise "unknown".
- Each quote must be copied character-for-character from the sources, one sentence or less, and must contain the evidence for that answer. Use "" when the answer is "unknown".
- mixedCatalyst is true when the same report announces another major event that could explain the move: merger, acquisition, buyout, FDA decision, major contract, or offering.
- note is one plain sentence under 160 characters on what drove the report. No trading advice.`;

export function buildEarningsEvidence(pressRelease: string, news: NewsItem[]): string {
  const sections = news.map((item, index) => `[NEWS ${index + 1} · ${item.source}] ${item.title}\n${item.text}`);
  if (pressRelease) sections.unshift(`[PRESS RELEASE]\n${pressRelease}`);
  return sections.join('\n\n');
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

// The LLM may only point at evidence: an answer whose quote is not a verbatim excerpt of the inputs becomes unknown.
export function verifyEarningsRead(read: EarningsRead, evidence: string): EarningsRead {
  const source = normalize(evidence);
  const verified = (quote: string) => normalize(quote).length >= MIN_QUOTE_CHARS && source.includes(normalize(quote));
  return {
    ...read,
    epsBeat: verified(read.epsQuote) ? read.epsBeat : 'unknown',
    revenueBeat: verified(read.revenueQuote) ? read.revenueBeat : 'unknown',
    guidance: verified(read.guidanceQuote) ? read.guidance : 'unknown',
    note: read.note.slice(0, 200),
  };
}

// null means the LLM call or its JSON failed, so the replay knows not to cache it.
export async function classifyEarnings(ticker: string, evidence: string): Promise<EarningsRead | null> {
  if (!evidence) return UNKNOWN_EARNINGS_READ;
  try {
    const response = await callLlm({
      systemPrompt: SYSTEM_PROMPT,
      userMessage: `Ticker: ${ticker}\n\n${evidence}`,
      temperature: 0,
      maxTokens: 600,
    }, 'background');
    const json = response.content.replace(/^```(?:json)?\s*|\s*```$/g, '');
    return verifyEarningsRead(earningsReadSchema.parse(JSON.parse(json)), evidence);
  } catch (error) {
    console.warn('triple beat earnings read failed', ticker, error);
    return null;
  }
}
```

**File:** `__tests__/triple-beat-classify.test.ts`
**Action:** CREATE. Mock `@/lib/agents/llm-client` (`callLlm`). Use this real NCLH evidence string: `'[NEWS 1 · massive] Norwegian Cruise Line (NCLH) Q3 Earnings and Revenues Beat Estimates\nNorwegian Cruise Line reported Q3 2026 earnings of $1.12 per share, beating consensus estimates of $0.93 and delivering a 20.43% surprise. Revenue of $2.95 billion also exceeded expectations by 2.25%.'`, with the press-release line `'Raised full year 2026 guidance, with 2026 Adjusted EBITDA now expected to be approximately $2.55 billion'` prepended via `buildEarningsEvidence`. Tests:

1. `verifyEarningsRead` keeps `epsBeat: 'yes'` when `epsQuote` is `'beating  consensus estimates of $0.93'`. The double space and different case still verify.
2. `verifyEarningsRead` downgrades `revenueBeat: 'yes'` to `'unknown'` when the quote is `'revenue of $3.10 billion beat estimates'`, which is not in the evidence.
3. `verifyEarningsRead` downgrades a quote shorter than 12 chars (`'$0.93'`) to `'unknown'`, and downgrades `guidance: 'none'` with `guidanceQuote: ''` to `'unknown'`.
4. `classifyEarnings`:
   - Returns the verified read when `callLlm` resolves fenced JSON (```json … ```).
   - Calls `callLlm` with `temperature: 0` and lane `'background'`.
5. `classifyEarnings`:
   - Returns `null` when `callLlm` rejects, and when it returns non-JSON.
   - Returns `UNKNOWN_EARNINGS_READ` without calling `callLlm` when the evidence is `''`.

**Acceptance:**
- [ ] All tests pass.
- [ ] No answer can be `yes`, `raised` etc. without a verified quote.

---

### Step 6 — Pure scoring module

**File:** `lib/triple-beat/scan.ts`
**Action:** CREATE

`ScoreItem` and `ScoreItemStatus` are reused from `lib/parabolic/scan.ts` (type-only import), so the Discord checklist code stays identical.

```ts
import { atr, ema } from '@/lib/indicators';
import type { DailyOhlcBar } from '@/lib/massive-market';
import type { ScoreItem, ScoreItemStatus } from '@/lib/parabolic/scan';
import type { EarningsRead } from '@/lib/triple-beat/classify';
import type { ExtendedHoursStats } from '@/lib/triple-beat/data';

// Thresholds from the Triple Beat Earnings playbook v1.0. Provisional until the replay validates them.
const RULES = {
  minPrice: 5,
  minDollarVolume: 5_000_000,
  minGapPct: 4,
  bigGapPct: 10,
  preferredPrice: 10,
  preferredDollarVolume: 20_000_000,
  basePeriod: 60,
  maxBaseRangePct: 40,
  runUpPeriod: 20,
  maxRunUpPct: 20,
  minExtendedVolumeRatio: 0.25,
  minHoldPct: 65,
  maxStopAtr: 1.5,
  target1R: 2,
  atrPeriod: 14,
  trailEmaPeriod: 10,
  maxSwingSessions: 60,
  outcomeWindow: 20,
  // Loose live prefilter on the market snapshot; the exact filters run after the per-ticker fetch.
  livePrefilterMinGapPct: 3.5,
  livePrefilterMinClose: 4.5,
  livePrefilterMinDollarVolume: 1_000_000,
};

export const MIN_HISTORY_BARS = 61;
export const MAX_PREMARKET_SCORE = 90;

export type TripleBeatGrade = 'A+' | 'A' | 'B' | 'Pass';
export type GapBucket = '<4' | '4-7.9' | '8-9.9' | '10+';

export interface TripleBeatMetrics {
  referencePrice: number;
  priorClose: number;
  gapPct: number;
  holdPct: number;
  extendedVolumeRatio: number;
  avgVolume20: number;
  avgDollarVolume20: number;
  baseHigh: number;
  baseRangePct: number;
  runUpPct: number;
  atr14: number;
  ema10: number;
}

export interface TripleBeatPlan {
  riskFraction: 1 | 0.5 | 0;
  entry: number;
  stop: number;
  riskPerShare: number;
  riskAtr: number;
  target1: number;
}

export interface TripleBeatSetup {
  qualified: boolean;
  failedFilters: string[];
  grade: TripleBeatGrade;
  score: number;
  maxScore: number;
  scoreItems: ScoreItem[];
  metrics: TripleBeatMetrics;
  plan: TripleBeatPlan | null;
  earnings: EarningsRead;
  strictTripleBeat: boolean;
}

export interface TripleBeatScanReport {
  tradingDate: string;
  asOf: string;
  gappersChecked: number;
  earningsFilings: number;
  setups: Array<TripleBeatSetup & { ticker: string; plan: TripleBeatPlan }>;
}

export interface TripleBeatOutcome {
  triggered: boolean;
  fill: number | null;
  stoppedOutDay0: boolean | null;
  dayR: number | null;
  hit2R: boolean | null;
  runnerR: number | null;
  totalR: number | null;
  daysHeld: number | null;
  openAtEnd: boolean | null;
  mfe20R: number | null;
  mae20R: number | null;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function pctChange(from: number, to: number): number {
  return (to / from - 1) * 100;
}

function gradeFor(score: number): TripleBeatGrade {
  if (score >= 85) return 'A+';
  if (score >= 75) return 'A';
  if (score >= 60) return 'B';
  return 'Pass';
}

export function gapBucket(gapPct: number): GapBucket {
  if (gapPct >= 10) return '10+';
  if (gapPct >= 8) return '8-9.9';
  if (gapPct >= 4) return '4-7.9';
  return '<4';
}

export function passesLivePrefilter(snapshot: { gapPct: number; priorClose: number; priorVolume: number }): boolean {
  return snapshot.gapPct >= RULES.livePrefilterMinGapPct
    && snapshot.priorClose >= RULES.livePrefilterMinClose
    && snapshot.priorClose * snapshot.priorVolume >= RULES.livePrefilterMinDollarVolume;
}

// Replay: the trade-day open is known, so apply the exact price/gap/dollar-volume floors.
export function passesReplayPrefilter(bars: DailyOhlcBar[], tradeOpen: number): boolean {
  if (bars.length < 20) return false;
  const priorClose = bars[bars.length - 1].close;
  return tradeOpen >= RULES.minPrice
    && pctChange(priorClose, tradeOpen) >= RULES.minGapPct
    && mean(bars.slice(-20).map((bar) => bar.volume * bar.close)) >= RULES.minDollarVolume;
}

export function evaluateTripleBeatSetup(
  history: DailyOhlcBar[],
  extended: ExtendedHoursStats,
  earnings: EarningsRead,
): TripleBeatSetup | null {
  const bars = history.slice(-260);
  const n = bars.length;
  if (n < MIN_HISTORY_BARS) return null;

  const prior = bars[n - 1];
  const closes = bars.map((bar) => bar.close);
  const base = bars.slice(-RULES.basePeriod);
  const baseHigh = Math.max(...base.map((bar) => bar.high));
  const baseLow = Math.min(...base.map((bar) => bar.low));
  const last20 = bars.slice(-20);
  const avgVolume20 = mean(last20.map((bar) => bar.volume));
  const atr14 = atr(bars.map((bar, index) => ({
    time: index, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume,
  })), RULES.atrPeriod)[n - 1] ?? 0;
  const metrics: TripleBeatMetrics = {
    referencePrice: extended.last,
    priorClose: prior.close,
    gapPct: pctChange(prior.close, extended.last),
    holdPct: extended.high === extended.low ? 100 : ((extended.last - extended.low) / (extended.high - extended.low)) * 100,
    extendedVolumeRatio: extended.volume / avgVolume20,
    avgVolume20,
    avgDollarVolume20: mean(last20.map((bar) => bar.volume * bar.close)),
    baseHigh,
    baseRangePct: pctChange(baseLow, baseHigh),
    runUpPct: pctChange(closes[n - 1 - RULES.runUpPeriod], prior.close),
    atr14,
    ema10: ema(closes, RULES.trailEmaPeriod)[n - 1] ?? prior.close,
  };
  const entry = extended.premarketHigh;
  const stop = extended.premarketLow;
  const riskPerShare = entry - stop;
  const riskAtr = atr14 > 0 ? riskPerShare / atr14 : Number.POSITIVE_INFINITY;

  const failedFilters: string[] = [];
  if (metrics.referencePrice < RULES.minPrice) failedFilters.push('Price < $5');
  if (metrics.avgDollarVolume20 < RULES.minDollarVolume) failedFilters.push('Dollar volume < $5M');
  if (metrics.gapPct < RULES.minGapPct) failedFilters.push('Gap < 4%');
  if (riskPerShare <= 0 || atr14 <= 0) failedFilters.push('No entry/stop');
  const qualified = failedFilters.length === 0;

  const beat = (status: EarningsRead['epsBeat']): ScoreItemStatus => (
    status === 'yes' ? 'met' : status === 'no' ? 'not met' : 'unknown'
  );
  const items: Array<[string, number, boolean | ScoreItemStatus]> = [
    ['EPS beat', 8, beat(earnings.epsBeat)],
    ['Revenue beat', 8, beat(earnings.revenueBeat)],
    ['Guidance raised', 9, earnings.guidance === 'raised' ? 'met' : earnings.guidance === 'unknown' ? 'unknown' : 'not met'],
    ['3-month base', 8, metrics.baseRangePct <= RULES.maxBaseRangePct],
    ['Clears 3-month high', 8, metrics.referencePrice > baseHigh],
    ['Not extended into earnings', 4, metrics.runUpPct <= RULES.maxRunUpPct],
    ['Heavy extended-hours volume', 10, metrics.extendedVolumeRatio >= RULES.minExtendedVolumeRatio],
    ['Projected RVOL 3x+', 10, 'unknown'],
    ['Gap 10%+', 8, metrics.gapPct >= RULES.bigGapPct],
    ['Holding near highs', 7, metrics.holdPct >= RULES.minHoldPct],
    ['Stop within 1.5 ATR', 10, riskPerShare > 0 && riskAtr <= RULES.maxStopAtr],
    ['Price $10+', 4, metrics.referencePrice >= RULES.preferredPrice],
    ['$20M+ dollar volume', 6, metrics.avgDollarVolume20 >= RULES.preferredDollarVolume],
  ];
  const scoreItems = items.map(([label, maxPoints, condition]): ScoreItem => {
    const status = typeof condition === 'boolean' ? (condition ? 'met' : 'not met') : condition;
    return { label, maxPoints, status, points: status === 'met' ? maxPoints : 0 };
  });
  const score = scoreItems.reduce((sum, item) => sum + item.points, 0);
  const grade = gradeFor(score);
  const plan: TripleBeatPlan | null = !qualified ? null : {
    riskFraction: riskAtr > RULES.maxStopAtr ? 0 : grade === 'A+' ? 1 : grade === 'A' ? 0.5 : 0,
    entry,
    stop,
    riskPerShare,
    riskAtr,
    target1: entry + RULES.target1R * riskPerShare,
  };
  return {
    qualified,
    failedFilters,
    grade,
    score,
    maxScore: MAX_PREMARKET_SCORE,
    scoreItems,
    metrics,
    plan,
    earnings,
    strictTripleBeat: scoreItems.slice(0, 3).every((item) => item.status === 'met'),
  };
}

// Daily bars cannot order intraday events, so any day that touches the stop counts as stopped before the target.
export function measureTripleBeatOutcome(
  history: DailyOhlcBar[],
  plan: TripleBeatPlan,
  sessions: DailyOhlcBar[],
): TripleBeatOutcome {
  const day0 = sessions[0];
  if (day0.high < plan.entry) {
    return {
      triggered: false, fill: null, stoppedOutDay0: null, dayR: null, hit2R: null, runnerR: null,
      totalR: null, daysHeld: null, openAtEnd: null, mfe20R: null, mae20R: null,
    };
  }
  const fill = Math.max(day0.open, plan.entry);
  const risk = fill - plan.stop;
  const toR = (price: number) => (price - fill) / risk;
  const stoppedOutDay0 = day0.low <= plan.stop;
  const target = fill + RULES.target1R * risk;
  const window = sessions.slice(0, RULES.maxSwingSessions);
  const closes = history.map((bar) => bar.close);
  let hit2R = false;
  let exit: number | null = null;
  let daysHeld = window.length - 1;
  for (let k = 0; k < window.length; k += 1) {
    const bar = window[k];
    if (bar.low <= plan.stop) {
      exit = plan.stop;
      daysHeld = k;
      break;
    }
    if (bar.high >= target) hit2R = true;
    closes.push(bar.close);
    const ema10 = ema(closes, RULES.trailEmaPeriod).at(-1);
    if (k > 0 && ema10 != null && bar.close < ema10) {
      exit = bar.close;
      daysHeld = k;
      break;
    }
  }
  const runnerR = toR(exit ?? window[window.length - 1].close);
  const outcomeBars = sessions.slice(0, RULES.outcomeWindow);
  return {
    triggered: true,
    fill,
    stoppedOutDay0,
    dayR: stoppedOutDay0 ? -1 : toR(day0.close),
    hit2R,
    runnerR,
    totalR: hit2R ? 0.5 * RULES.target1R + 0.5 * runnerR : runnerR,
    daysHeld,
    openAtEnd: exit === null,
    mfe20R: toR(Math.max(...outcomeBars.map((bar) => bar.high))),
    mae20R: toR(Math.min(...outcomeBars.map((bar) => bar.low))),
  };
}
```

**File:** `__tests__/triple-beat-scan.test.ts`
**Action:** CREATE. Fixture: 80 flat daily bars ending 2026-10-28, each `{open:19.9, high:20.4, low:19.6, close:20, volume:2_000_000}`. That gives ATR14 = 0.8, base range ≈ 4.1%, run-up 0%, and $40M dollar volume. `STRICT` is a read with `epsBeat:'yes'`, `revenueBeat:'yes'`, `guidance:'raised'`. Tests:

1. **Strict beat, A+:** extended `{last:23, high:23.4, low:21.5, volume:800_000, premarketHigh:23.4, premarketLow:22.6}` with STRICT gives:
   - `qualified`; `score 90`; `grade 'A+'`; `strictTripleBeat true`.
   - Plan: `{riskFraction:1, entry:23.4, stop:22.6}`; `riskPerShare` ≈ 0.8; `riskAtr` ≈ 1; `target1` ≈ 25.0.
   - The `'Projected RVOL 3x+'` item is `unknown`.
2. **Unknown beats, B:** the same inputs with `UNKNOWN_EARNINGS_READ` give `score 65`, `grade 'B'`, `plan.riskFraction 0`, and three `unknown` earnings items.
3. **Wide stop:** `premarketLow: 21.0` and `low: 21.0` with STRICT means risk 2.4 and riskAtr 3. The `'Stop within 1.5 ATR'` item is `not met`, giving `score 80`, `grade 'A'`, `plan.riskFraction 0`.
4. **Faded gap:** `last: 20.5` (gap 2.5%, keep premarketHigh > premarketLow) gives `failedFilters` containing `'Gap < 4%'`, `qualified false`, `plan null`.
5. Returns `null` with 60 history bars.
6. `gapBucket(4)`, `gapBucket(9.99)`, `gapBucket(10)` and `gapBucket(3)` return `'4-7.9'`, `'8-9.9'`, `'10+'` and `'<4'`.
7. `passesLivePrefilter`: `{gapPct:3.5, priorClose:4.5, priorVolume:300_000}` → true; gap 3.4 → false. `passesReplayPrefilter` is false for 19 bars, and false for an open below $5.
8. **`measureTripleBeatOutcome`** with plan `{entry:23.4, stop:22.6, …}` and the 80-bar history:
   - **Not triggered:** day0 high 23.3 → `triggered false`.
   - **Stopped on day 0:** day0 `{open:23, high:23.6, low:22.5, close:23.2}` → `fill 23.4`, `stoppedOutDay0 true`, `dayR -1`, `runnerR -1`, `totalR -1`, `daysHeld 0`.
   - **Winner:**
     - Sessions:
       - day0 `{open:23.1, high:25.2, low:23.0, close:25}`
       - then `{open:25, high:26.2, low:25.1, close:26}`, `{… close:27, low:26.1}`, `{… close:28, low:27.1}`
       - then `{open:24, high:24.2, low:23.0, close:23.2}`
     - Expect `hit2R true`, `dayR` ≈ 2, `runnerR` ≈ -0.25 (exit at the 23.2 close below the ~23.6 10EMA), `totalR` ≈ 0.875, `daysHeld 4`, `openAtEnd false`.

**Acceptance:**
- [ ] All tests pass.
- [ ] `RULES` is the only place numeric thresholds live.

---

### Step 7 — Job type + agent registration

**File:** `lib/agents/types.ts`
**Action:** MODIFY. Append `| 'triple-beat-scan'` to the `JobType` union, after `| 'parabolic-scan'` (move the `;`).

**File:** `lib/agents/config.ts`
**Action:** MODIFY

1. Import: `import { orchestratorTripleBeatScanBlueprint } from './blueprints/orchestrator-triple-beat-scan';`, next to the parabolic import.
2. Add `'triple-beat-scan'` to the orchestrator `capabilities` array, after `'parabolic-scan'`.
3. Add `'triple-beat-scan': orchestratorTripleBeatScanBlueprint,` to the orchestrator `blueprints`, after the parabolic entry.

**File:** `__tests__/agent-config.test.ts`
**Action:** MODIFY. Next to the parabolic resolution assertion (anchor: `jobType: 'parabolic-scan'`), add the same assertion for `jobType: 'triple-beat-scan'` resolving to id `'orchestrator:triple-beat-scan'`.

---

### Step 8 — Orchestrator blueprint

**File:** `lib/agents/blueprints/orchestrator-triple-beat-scan.ts`
**Action:** CREATE. Copy the structure of `orchestrator-parabolic-scan.ts`: `jobInputSchema`, the `ScanStepOutput` union, the `completedResult` helper, and two steps.

```ts
import { z } from 'zod';
import { fetchAllTickerSnapshots } from '@/lib/massive-market';
import { addCalendarDays, fetchDailyBars } from '@/lib/parabolic/data';
import { getRecentFilings } from '@/lib/sec/submissions';
import { UNKNOWN_EARNINGS_READ, buildEarningsEvidence, classifyEarnings } from '@/lib/triple-beat/classify';
import {
  fetchEarningsNews, fetchExtendedHoursStats, fetchPressReleaseText, findEarningsFiling, isEarningsHeadline,
} from '@/lib/triple-beat/data';
import { evaluateTripleBeatSetup, passesLivePrefilter, type TripleBeatScanReport } from '@/lib/triple-beat/scan';
import { getPreviousTradingSession, isNyTradingDay, nyDateTimeToEpoch } from '@/lib/time-utils';
import { writeAndDeliverReport } from '../discord';
import type { Blueprint, StepResult } from '../types';

const jobInputSchema = z.object({ tradingDate: z.string().max(10).date() });
// Small batches: SEC requests are serialized at 10/s and each survivor may make one LLM call.
const BATCH_SIZE = 5;

type ScanStepOutput =
  | ({ skipped: false } & TripleBeatScanReport)
  | { skipped: true; tradingDate: string };

// completedResult: copy verbatim from orchestrator-parabolic-scan.ts

export const orchestratorTripleBeatScanBlueprint: Blueprint = {
  id: 'orchestrator:triple-beat-scan',
  description: 'Score premarket Triple Beat earnings gap-ups and deliver ranked Discord cards.',
  steps: [
    {
      name: 'scan-triple-beat-setups',
      type: 'code',
      metadata: { canRetry: true, timeoutMs: 300000, maxRepairAttempts: 0, sideEffect: false },
      run: async ({ jobInput }) => {
        const startedAt = Date.now();
        const { tradingDate } = jobInputSchema.parse(jobInput);
        const priorSession = getPreviousTradingSession(tradingDate);
        if (!isNyTradingDay(tradingDate) || !priorSession) {
          return completedResult<ScanStepOutput>({ skipped: true, tradingDate }, Date.now() - startedAt);
        }
        const asOfMs = Date.now();
        const windowStart = nyDateTimeToEpoch(priorSession, '16:00:00') ?? asOfMs;
        // Premarket data stops at the open, so a late run is still "as of" 9:30.
        const windowEnd = Math.min(asOfMs, nyDateTimeToEpoch(tradingDate, '09:30:00') ?? asOfMs);
        const snapshot = await fetchAllTickerSnapshots();
        const gappers = (snapshot.tickers ?? []).flatMap((ticker) => (
          ticker.ticker && passesLivePrefilter({
            gapPct: ticker.todaysChangePerc ?? 0,
            priorClose: ticker.prevDay?.c ?? 0,
            priorVolume: ticker.prevDay?.v ?? 0,
          }) ? [ticker.ticker] : []
        ));
        const from = addCalendarDays(tradingDate, -400);
        let earningsFilings = 0;
        const setups: TripleBeatScanReport['setups'] = [];
        for (let offset = 0; offset < gappers.length; offset += BATCH_SIZE) {
          const results = await Promise.allSettled(gappers.slice(offset, offset + BATCH_SIZE).map(async (ticker) => {
            const filings = await getRecentFilings(ticker, { limit: 20, sinceDays: 5 });
            const filing = findEarningsFiling(filings.results, windowStart, windowEnd);
            if (!filing) return null;
            earningsFilings += 1;
            const [history, extended] = await Promise.all([
              fetchDailyBars(ticker, from, priorSession),
              fetchExtendedHoursStats(ticker, priorSession, tradingDate, asOfMs),
            ]);
            if (!extended) return null;
            // Cheap technical gate first so the LLM only runs on names that can qualify.
            if (!evaluateTripleBeatSetup(history, extended, UNKNOWN_EARNINGS_READ)?.qualified) return null;
            const news = await fetchEarningsNews(ticker, windowStart, windowEnd);
            if (filing.form_type === '6-K' && !news.some((item) => isEarningsHeadline(item.title))) return null;
            const evidence = buildEarningsEvidence(await fetchPressReleaseText(filing), news);
            const earnings = await classifyEarnings(ticker, evidence) ?? UNKNOWN_EARNINGS_READ;
            const setup = evaluateTripleBeatSetup(history, extended, earnings);
            if (!setup?.plan || setup.grade === 'Pass') return null;
            return { ticker, ...setup, plan: setup.plan };
          }));
          for (const result of results) {
            if (result.status === 'fulfilled') {
              if (result.value) setups.push(result.value);
            } else {
              console.warn('triple beat scan ticker failed', result.reason);
            }
          }
        }
        setups.sort((a, b) => b.score - a.score || b.metrics.gapPct - a.metrics.gapPct);
        return completedResult<ScanStepOutput>({
          skipped: false, tradingDate, asOf: new Date(windowEnd).toISOString(),
          gappersChecked: gappers.length, earningsFilings, setups,
        }, Date.now() - startedAt);
      },
    },
    {
      name: 'deliver-triple-beat-scan',
      type: 'code',
      metadata: { canRetry: false, timeoutMs: 10000, maxRepairAttempts: 0, sideEffect: true },
      run: async ({ previousOutput, job, db }) => {
        // Same shape as deliver-parabolic-scan, with these differences:
        // - upstreamStepIds ['scan-triple-beat-setups']
        // - reportJson: { tradingDate, asOf, gappersChecked, earningsFilings, setups }
        // - summary: n === 0 ? 'No Triple Beat earnings setups.' : `${n} setups (A+ ${aPlus} • A ${a} • B ${b})`
        // - reportType 'triple-beat-scan', title `${tradingDate} triple beat earnings scan`
      },
    },
  ],
};
```

Write `deliver-triple-beat-scan` out in full by copying `deliver-parabolic-scan` and applying the four differences in the comment. Do not leave the comment in the code.

**File:** `__tests__/agent-triple-beat-scan.test.ts`
**Action:** CREATE. Copy the mock and fake-timer setup of `__tests__/agent-parabolic-scan.test.ts`. Mock:
- `@/lib/massive-market` → `fetchAllTickerSnapshots`
- `@/lib/sec/submissions` → `getRecentFilings`
- `@/lib/parabolic/data` → partial; mock only `fetchDailyBars`
- `@/lib/triple-beat/data` → partial; mock `fetchExtendedHoursStats`, `fetchEarningsNews` and `fetchPressReleaseText`, keeping `findEarningsFiling` and `isEarningsHeadline` real
- `@/lib/triple-beat/classify` → partial; mock only `classifyEarnings`
- `@/lib/agents/discord` → `writeAndDeliverReport`

Use trading date `2026-10-29` and system time `2026-10-29T13:00:00Z` (09:00 ET). Tests:

1. **Holiday:** `2026-11-26` (Thanksgiving) → `{ skipped: true }`; neither `fetchAllTickerSnapshots` nor `writeAndDeliverReport` is called.
2. **Happy path.** Snapshot tickers:
   - `AAA` (gap 15) and `DDD` (gap 12): 8-K `2.02` accepted `2026-10-29T11:00:29.000Z`.
   - `CCC` (gap 12): only an 8-K `5.02`.
   - `BBB` (gap 2): filtered by the prefilter.
   - `ZZZ` (gap 20): `getRecentFilings` rejects.

   All tickers use `prevDay: { c: 20, v: 2_000_000 }`. Use the Step 6 flat-bar history and extended stats. `classifyEarnings` returns the strict read for `AAA` and `null` for `DDD`. Expect:
   - `gappersChecked 4` and `earningsFilings 2`.
   - Setups `['AAA', 'DDD']`, with grades `'A+'` and `'B'`.
   - One `console.warn` (for ZZZ).
   - `getRecentFilings` called with `('AAA', { limit: 20, sinceDays: 5 })`.
   - `fetchDailyBars` called with `('AAA', '2025-09-24', '2026-10-28')`.
   - `fetchExtendedHoursStats` called with `('AAA', '2026-10-28', '2026-10-29', Date.now())`.
   - `classifyEarnings` not called for `CCC`.
   - `asOf` is `'2026-10-29T13:00:00.000Z'`.
   - The deliver step calls `writeAndDeliverReport` with `reportType: 'triple-beat-scan'`, `summary: '2 setups (A+ 1 • A 0 • B 1)'`, and the full `reportJson`.
3. **6-K without an earnings headline:** dropped, while still counted in `earningsFilings`.
4. **Empty market:** `fetchAllTickerSnapshots` resolves `{ tickers: [] }`, and the deliver step's summary is `'No Triple Beat earnings setups.'`.

**Acceptance:**
- [ ] The blueprint id is `orchestrator:triple-beat-scan`.
- [ ] A failing ticker never fails the job.
- [ ] The LLM runs only for technically qualified names with an earnings filing.

---

### Step 9 — Discord cards + webhook

**File:** `lib/agents/discord.ts`
**Action:** MODIFY

1. Import: `import type { TripleBeatGrade, TripleBeatScanReport } from '@/lib/triple-beat/scan';`, next to the parabolic import.
2. In the delivery function (anchor: `const embeds = report.reportType === 'parabolic-scan' ? buildParabolicScanEmbeds(report) : [selectEmbed(report)];`), replace that line with:

```ts
  const embeds = report.reportType === 'parabolic-scan' ? buildParabolicScanEmbeds(report)
    : report.reportType === 'triple-beat-scan' ? buildTripleBeatScanEmbeds(report)
      : [selectEmbed(report)];
```

3. In `resolveWebhookUrl`, directly after the `parabolic-scan` branch, add:

```ts
  } else if (agentId === 'orchestrator' && reportType === 'triple-beat-scan') {
    envName = 'DISCORD_WEBHOOK_TRIPLE_BEAT';
```

4. After `buildParabolicScanEmbeds` (before `export function buildSystemEmbed`), add the constants and builder below. Reuse `PARABOLIC_HEADER_COLOR`, `PARABOLIC_SIZE_LABELS` and `PARABOLIC_MAX_CARDS` as-is; do not rename them.

```ts
const TRIPLE_BEAT_GRADE_COLORS: Record<TripleBeatGrade, number> = {
  'A+': 0x23A55A,
  A: 0xF0B232,
  B: 0x80848E,
  Pass: 0x80848E,
};
// Short checklist names for the card footer, keyed by the score item labels in lib/triple-beat/scan.ts.
const TRIPLE_BEAT_SHORT_LABELS: Record<string, string> = {
  'EPS beat': 'EPS',
  'Revenue beat': 'Rev',
  'Guidance raised': 'Guide',
  '3-month base': 'Base',
  'Clears 3-month high': 'Breakout',
  'Not extended into earnings': 'Fresh',
  'Heavy extended-hours volume': 'PM vol',
  'Projected RVOL 3x+': 'RVOL',
  'Gap 10%+': 'Gap 10',
  'Holding near highs': 'Hold',
  'Stop within 1.5 ATR': 'Stop',
  'Price $10+': '$10+',
  '$20M+ dollar volume': '$Vol',
};

export function buildTripleBeatScanEmbeds(report: AgentReport): DiscordEmbed[] {
  const payload = report.reportJson as TripleBeatScanReport;
  // pct, usd, dayLabel, asOfEt: copy the four declarations from buildParabolicScanEmbeds verbatim.
  const scanned = `${payload.gappersChecked} gappers · ${payload.earningsFilings} with earnings filings · premarket as of ${asOfEt} ET`;
  const title = `Triple Beat earnings · ${dayLabel}`;

  if (payload.setups.length === 0) {
    return [{ title, description: `No setups today · ${scanned}`, color: TRIPLE_BEAT_GRADE_COLORS.B }];
  }

  const count = (grade: TripleBeatGrade) => payload.setups.filter((setup) => setup.grade === grade).length;
  const shown = payload.setups.slice(0, PARABOLIC_MAX_CARDS);
  const overflow = payload.setups.length > shown.length ? `\nShowing the top ${shown.length} of ${payload.setups.length}.` : '';
  const header: DiscordEmbed = {
    title,
    description: `🟢 A+ ${count('A+')} · 🟡 A ${count('A')} · ⚪ B ${count('B')} · ${scanned}${overflow}`,
    color: PARABOLIC_HEADER_COLOR,
    footer: { text: '⚠️ Entry needs a premarket-high break with 3x+ RVOL. Partial at 2R; trail the runner on a 10EMA close.' },
  };

  const cards = shown.map((setup): DiscordEmbed => {
    const { metrics, plan, earnings } = setup;
    const checklist = setup.scoreItems.map((item) => {
      const icon = item.status === 'met' ? '✅' : item.status === 'unknown' ? '❔' : '❌';
      return `${icon} ${TRIPLE_BEAT_SHORT_LABELS[item.label] ?? item.label}`;
    });
    const description = [
      setup.strictTripleBeat ? '🏆 Strict triple beat' : null,
      earnings.note || null,
      earnings.mixedCatalyst ? '⚠️ Mixed catalyst. Check headlines.' : null,
    ].filter(Boolean).join('\n');
    return {
      title: `${setup.ticker} · ${setup.grade} · ${setup.score}/${setup.maxScore} · ${PARABOLIC_SIZE_LABELS[plan.riskFraction]}`,
      ...(description ? { description } : {}),
      color: TRIPLE_BEAT_GRADE_COLORS[setup.grade],
      fields: [
        buildField('Entry · PM high', usd(plan.entry)),
        buildField('Stop · PM low', usd(plan.stop)),
        buildField('Risk / share', `${usd(plan.riskPerShare)} · ${plan.riskAtr.toFixed(1)} ATR`),
        buildField('T1 partial', `${usd(plan.target1)} · 2R`),
        buildField('Runner', `Trail 10EMA (${usd(metrics.ema10)})`),
        buildField('Gap · hold', `${pct(metrics.gapPct)} · ${metrics.holdPct.toFixed(0)}% of range`),
      ],
      footer: { text: checklist.join(' ') },
    };
  });

  return [header, ...cards];
}
```

Replace the `// pct, usd, dayLabel, asOfEt` comment with the four real declarations. `target` is not needed here; do not copy it.

**File:** `__tests__/agent-discord.test.ts`
**Action:** MODIFY. Add a `createTripleBeatReportJson()` helper next to `createParabolicReportJson()`, with one NCLH A+ setup using realistic numbers from the Step 6 fixture and `earnings.note: 'Beat on EPS and revenue and raised full-year guidance.'`. Tests:

1. `resolveWebhookUrl('orchestrator', 'triple-beat-scan')` returns the stubbed `DISCORD_WEBHOOK_TRIPLE_BEAT`.
2. An empty report renders one gray card titled `'Triple Beat earnings · Thu, Oct 29'` with the `No setups today · …` description.
3. One setup renders a header card plus one card:
   - Title `'NCLH · A+ · 90/90 · Full size (1R)'`.
   - Description starts with `'🏆 Strict triple beat'`.
   - Six inline fields in the order above.
   - Footer `'✅ EPS ✅ Rev ✅ Guide ✅ Base ✅ Breakout ✅ Fresh ✅ PM vol ❔ RVOL ✅ Gap 10 ✅ Hold ✅ Stop ✅ $10+ ✅ $Vol'`.
4. A `triple-beat-scan` report posts all cards in a single webhook call. Copy the parabolic single-post test.

**Acceptance:**
- [ ] Parabolic and all other report types render exactly as before.

---

### Step 10 — Daily cron

**File:** `lib/agents/macro-cron.ts`
**Action:** MODIFY

1. After `readDefaultParabolicCronHour`, add:

```ts
function readDefaultTripleBeatCronHour(): number {
  return Number(process.env.TRIPLE_BEAT_CRON_HOUR_ET) || 9;
}
```

2. Change `type CronTriggerType` to `'macro-summary' | 'macro-intraday' | 'parabolic-scan' | 'triple-beat-scan'`.
3. After `startParabolicCron`, add `startTripleBeatCron`. It is an exact copy of `startParabolicCron` with these changes:
   - It uses `readDefaultTripleBeatCronHour()`.
   - `triggerType: 'triple-beat-scan'` and `jobType: 'triple-beat-scan'`.
   - The log message is `'triple beat cron tick failed'`.

Both crons default to 9 ET. They claim separate `agent_scheduled_runs` rows because `triggerType` differs, and the worker runs the two jobs one after the other.

**File:** `__tests__/agent-macro-cron.test.ts`
**Action:** MODIFY. Import `startTripleBeatCron`, and copy the `describe('startParabolicCron', …)` block as `describe('startTripleBeatCron', …)`, replacing `parabolic-scan` with `triple-beat-scan` in the assertions.

---

### Step 11 — Worker entrypoint + compose

**File:** `services/agent-entrypoint.ts`
**Action:** MODIFY

1. Add `startTripleBeatCron` to the `../lib/agents/macro-cron` import.
2. Declare `let tripleBeatCron: MacroCronHandle | null = null;` after `parabolicCron`.
3. Start it with `tripleBeatCron = startTripleBeatCron(db);` directly after `parabolicCron = startParabolicCron(db);`.
4. Stop it in both places that stop `parabolicCron`: the startup-failure path and the shutdown handler. Use the same `if (tripleBeatCron) { await tripleBeatCron.stop(); }` shape.

**File:** `services/docker-compose.yml`
**Action:** MODIFY. In the orchestrator `environment` list, after `- PARABOLIC_CRON_HOUR_ET=${PARABOLIC_CRON_HOUR_ET}`, add:

```yaml
      - DISCORD_WEBHOOK_TRIPLE_BEAT=${DISCORD_WEBHOOK_TRIPLE_BEAT}
      - TRIPLE_BEAT_CRON_HOUR_ET=${TRIPLE_BEAT_CRON_HOUR_ET}
```

`BACKGROUND_LLM_*`, `EODHD_API_KEY` and `MASSIVE_API_KEY` are already passed to the orchestrator. Do **not** edit any `.env*` file; Jared adds the webhook on the server.

---

### Step 12 — Replay CLI

**File:** `scripts/triple-beat-replay.ts`
**Action:** CREATE. Copy the structure of `scripts/parabolic-replay.ts` (dotenv, `readArg`, argument validation, the 25-session lookback cursor, pass 1, batches of 10 with `Promise.allSettled`, the split factor, `rounded`, and `Papa.unparse` to the home directory).

Header comment:

```ts
/**
 * triple-beat-replay.ts
 *
 * Replay the Triple Beat Earnings scorecard over historical sessions and export CSV outcomes.
 * Reads MASSIVE_API_KEY, EODHD_API_KEY, BACKGROUND_LLM_* and DATABASE_URL (CIK map) from .env.local.
 * Usage: npx tsx scripts/triple-beat-replay.ts --from 2024-11-01 --to 2026-10-15 [--out /path/file.csv]
 *
 * Entry is a break of the premarket high, filled at the open when it gaps above. A day that touches the
 * stop counts as stopped before any target. News is limited to items published before 09:30 ET on the
 * trade date. LLM earnings reads are cached in ~/triple-beat-llm-cache.json so reruns only call the LLM
 * for new ticker/dates. Tickers missing from today's SEC CIK map (delisted/renamed) are skipped.
 */
```

Differences from the parabolic replay:

1. **Pass 1:**
   - Identical, except candidates use `passesReplayPrefilter(window, bar.open)` from `@/lib/triple-beat/scan`.
   - Keep `while (window.length > 20) window.shift();`. Use the literal `20`; the TBE `MIN_HISTORY_BARS` is 61 and must not be used here.
2. **Caches, declared before pass 2:**

```ts
  const cachePath = join(homedir(), 'triple-beat-llm-cache.json');
  const llmCache: Record<string, EarningsRead> = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {};
  const sinceDays = Math.ceil((Date.now() - Date.parse(from)) / 86_400_000) + 10;
  const filingsByTicker = new Map<string, Promise<SecFiling[]>>();
  const filingsFor = (ticker: string) => {
    if (!filingsByTicker.has(ticker)) {
      filingsByTicker.set(ticker, getRecentFilings(ticker, { limit: 5000, sinceDays, includeArchives: true }).then((result) => result.results));
    }
    return filingsByTicker.get(ticker)!;
  };
  let newLlmReads = 0;
```

3. **Per candidate**, inside the batch map. Order matters: the cheap gates run before news and the LLM.

```ts
      const priorSession = getPreviousTradingSession(date)!;
      const windowStart = nyDateTimeToEpoch(priorSession, '16:00:00')!;
      const windowEnd = nyDateTimeToEpoch(date, '09:30:00')!;
      const filing = findEarningsFiling(await filingsFor(ticker), windowStart, windowEnd);
      if (!filing) return null;
      const [bars, extended, splits] = await Promise.all([
        fetchDailyBars(ticker, addCalendarDays(date, -400), addCalendarDays(date, 100)),
        fetchExtendedHoursStats(ticker, priorSession, date, Number.POSITIVE_INFINITY),
        fetchSplitHistory(ticker).catch(() => []),
      ]);
      if (!extended) return null;
      // Same split rule as scripts/parabolic-replay.ts: undo splits executed after `date`.
      const factor = splits.find((split) => split.executionDate > date)?.factor ?? 1;
      // asOfBars: copy the parabolic asOfBars map verbatim.
      const asOfExtended = {
        last: extended.last / factor, high: extended.high / factor, low: extended.low / factor,
        volume: extended.volume * factor, premarketHigh: extended.premarketHigh / factor, premarketLow: extended.premarketLow / factor,
      };
      const history = asOfBars.filter((bar) => bar.date < date);
      const sessions = asOfBars.filter((bar) => bar.date >= date);
      if (sessions[0]?.date !== date) return null;
      if (!evaluateTripleBeatSetup(history, asOfExtended, UNKNOWN_EARNINGS_READ)?.qualified) return null;
      const news = await fetchEarningsNews(ticker, windowStart, windowEnd);
      if (filing.form_type === '6-K' && !news.some((item) => isEarningsHeadline(item.title))) return null;
      const key = `${ticker}:${date}`;
      let earnings = llmCache[key];
      if (!earnings) {
        const read = await classifyEarnings(ticker, buildEarningsEvidence(await fetchPressReleaseText(filing), news));
        newLlmReads += 1;
        if (read) llmCache[key] = read;
        earnings = read ?? UNKNOWN_EARNINGS_READ;
      }
      const setup = evaluateTripleBeatSetup(history, asOfExtended, earnings)!;
      const { metrics, plan } = setup;
      const outcome = plan ? measureTripleBeatOutcome(history, plan, sessions) : null;
```

   Note that news is fetched before the cache check, because the 6-K gate needs it. Cached reruns therefore still make news API calls but **zero LLM calls**. That's acceptable.

4. **CSV row** (use `rounded` for numbers):
   - `date, ticker, gapBucket: gapBucket(metrics.gapPct), grade, score, strictTripleBeat`
   - `epsBeat, revenueBeat, guidance, mixedCatalyst, note` (from `earnings`), `filingForm: filing.form_type`
   - `gapPct, holdPct, extendedVolumeRatio, baseRangePct, runUpPct`
   - `clearsBaseHigh` (the `'Clears 3-month high'` item status), `avgDollarVolume20, riskAtr` (from plan)
   - `riskFraction, entry, stop, splitFactor: factor`
   - `triggered, fill, stoppedOutDay0, dayR, hit2R, runnerR, totalR, daysHeld, openAtEnd, mfe20R, mae20R`
   - Booleans and `null`: write `''` for null, as the parabolic replay does with `?? ''`.
5. **After each batch's results loop:** `writeFileSync(cachePath, JSON.stringify(llmCache));`. An interrupted run then keeps the reads it paid for.
6. **Summary**, replacing the parabolic per-grade loop. Write the CSV, then:

```ts
  const summarize = (label: string, group: typeof rows) => {
    const traded = group.filter((row) => typeof row.totalR === 'number');
    const wins = traded.filter((row) => Number(row.totalR) > 0).length;
    const average = (key: 'dayR' | 'totalR') => (traded.length
      ? (traded.reduce((sum, row) => sum + Number(row[key]), 0) / traded.length).toFixed(2) : 'n/a');
    console.log(`${label}: ${group.length} setups, ${traded.length} triggered, win rate ${traded.length ? (100 * wins / traded.length).toFixed(1) + '%' : 'n/a'}, avg dayR ${average('dayR')}, avg totalR ${average('totalR')}`);
  };
  for (const grade of ['A+', 'A', 'B', 'Pass']) summarize(`Grade ${grade}`, rows.filter((row) => row.grade === grade));
  for (const bucket of ['4-7.9', '8-9.9', '10+']) summarize(`Gap ${bucket}%`, rows.filter((row) => row.gapBucket === bucket));
  summarize('Strict triple beat', rows.filter((row) => row.strictTripleBeat === true));
  console.log(`New LLM reads: ${newLlmReads} (cache: ${cachePath})`);
  console.log(`Output: ${out}`);
```

7. The default output is `join(homedir(), `triple-beat-replay-${from}-to-${to}.csv`)`. Sort rows by date, then score descending.

**Acceptance:**
- [ ] A smoke run over one earnings-season day writes the CSV and the cache file.
- [ ] Re-running the same command prints `New LLM reads: 0`.

---

### Step 13 — Docs

`AGENTS.md` already has a Triple Beat bullet next to the parabolic one (added during planning). Do not edit it unless a file name in this spec changes.

---

### Files Changed Summary

| File | Action | ~Lines | Risk |
|---|---|---|---|
| `lib/massive-market.ts` | MODIFY | +30 | Low |
| `lib/eodhd.ts` | MODIFY | +5 | Low |
| `lib/sec/filing-headline.ts` | MODIFY | +8 / −6 | Low (headline enrichment now also finds `exh_991` exhibits) |
| `lib/triple-beat/data.ts` | CREATE | ~110 | Medium |
| `lib/triple-beat/classify.ts` | CREATE | ~90 | Medium (LLM boundary) |
| `lib/triple-beat/scan.ts` | CREATE | ~260 | Medium |
| `lib/agents/types.ts` | MODIFY | +1 | Low |
| `lib/agents/config.ts` | MODIFY | +3 | Low |
| `lib/agents/blueprints/orchestrator-triple-beat-scan.ts` | CREATE | ~130 | Medium |
| `lib/agents/discord.ts` | MODIFY | +85 | Low |
| `lib/agents/macro-cron.ts` | MODIFY | +30 | Low |
| `services/agent-entrypoint.ts` | MODIFY | +8 | Low |
| `services/docker-compose.yml` | MODIFY | +2 | Low |
| `scripts/triple-beat-replay.ts` | CREATE | ~170 | Low (offline CLI) |
| `__tests__/triple-beat-scan.test.ts` | CREATE | ~140 | — |
| `__tests__/triple-beat-data.test.ts` | CREATE | ~110 | — |
| `__tests__/triple-beat-classify.test.ts` | CREATE | ~90 | — |
| `__tests__/agent-triple-beat-scan.test.ts` | CREATE | ~130 | — |
| `__tests__/agent-config.test.ts`, `agent-macro-cron.test.ts`, `agent-discord.test.ts`, `sec-filing-headline.test.ts`, `eodhd.test.ts` | MODIFY | ~+150 | — |

No DB migration.

### Verification Steps

1. `npm run lint`
2. `npx tsc --noEmit`
3. `npm run typecheck:services`
4. `npm test` (all green; new tests included)
5. `npm run build`
6. `npm run workflow:audit` (because `HANDOFF.md`/`AGENTS.md` changed)
7. **Replay smoke (Jared, on his PC):**
   - First confirm `.env.local` has `BACKGROUND_LLM_API_KEY`, `BACKGROUND_LLM_API_BASE_URL` and `BACKGROUND_LLM_MODEL` (Together). Jared checks this; agents must not read the file.
   - Run `npx tsx scripts/triple-beat-replay.ts --from 2026-10-28 --to 2026-10-29`.
   - Expect NCLH on 2026-10-29 in the CSV with `filingForm 8-K` and `epsBeat yes`.
   - Re-run and expect `New LLM reads: 0`.
8. **Server (Jared):**
   - Add `DISCORD_WEBHOOK_TRIPLE_BEAT` to the server's `services/.env`.
   - Run `git pull --ff-only`, then `docker compose up -d --build orchestrator`.
   - Next trading day at 9:00 ET, expect a header card that reads `N gappers · M with earnings filings`.
   - In earnings season, `0 gappers` would mean the snapshot's `todaysChangePerc` is not premarket-aware; report it back rather than patching blind.

## Implementation Style

Write the simplest correct code that satisfies this spec. Specifically:

- Match the existing conventions in the file you're editing. Do not introduce new patterns, helpers, abstractions, or file layouts unless this spec explicitly calls for them.
- No future-proofing. No feature flags, no "in case we need it later" parameters, no extracted helpers that have a single caller. If a value is only used once, inline it.
- No defensive code at internal boundaries. Trust your own code and framework guarantees; validate only at system boundaries (user input, external APIs, DB reads of untrusted JSON).
- No comments unless the *why* is non-obvious (a hidden constraint, a workaround, a surprising invariant). Don't restate what the code says.
- If a step in this spec looks more complex than it needs to be, flag it and propose the simpler version before implementing — don't silently "improve" the spec, but don't write code that's more elaborate than the problem requires either.
- If you spot an existing simpler pattern in the codebase that fits, use it instead of writing new code.

This is a personal trading platform built solo. Readability > cleverness; debuggable > elegant; small diff > sweeping refactor. Three similar lines beats a premature abstraction.

---

## Recently Completed

### Parabolic Short Scanner v1 — Pre-Market Scan + Historical Replay

Status: completed 2026-10-29.

Outcome:
- Orchestrator worker scores premarket parabolic short setups at `PARABOLIC_CRON_HOUR_ET` (default 9 ET) and posts a ranked embed to `DISCORD_WEBHOOK_PARABOLIC`; pure code, no LLM; thresholds live in `RULES` in `lib/parabolic/scan.ts`.
- `scripts/parabolic-replay.ts` replays the scorecard over a date range and writes an outcome CSV to the home directory; review fix rescales split-adjusted bars to as-of-date prices so the $5 / 1M filters are point-in-time.
- Discord post redesigned as cards (option 1 of `~/Downloads/parabolic-discord-options.html`): blue header card + one grade-colored card per setup (top 9), sent as one multi-embed webhook message; "as of" time capped at 9:30 ET.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm run typecheck:services`, `npm test` (907/907), `npm run build`, `npm run workflow:audit`
- Replay smoke 2026-10-14→15: 1 B setup, CSV written. Optiplex orchestrator rebuilt on 597e670 (healthy) and a live test post landed in Discord on 2026-10-29.

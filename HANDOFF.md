# Nexus Terminal - HANDOFF.md

> Updated: 2026-10-29
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and durable docs such as `docs/repo-cleanup.md`.

Historical completed sections were removed to keep this file focused. Use git history and the `specs/` directory for archived implementation detail.

> **Parked:** the Scanner Epic 1 execution spec was moved to `specs/scanner-epic1-handoff.md` (not started — still waiting on the worktree + Neon-branch setup). Move it back here when you're ready to run it. The Parabolic Short Scanner (completed below) is deliberately **independent** of that epic.

---

## Scanner Rules: Align Triple Beat + Parabolic With the Coworker's thinkorswim Scans

> Generated: 2026-10-29 | Author: Claude (plan)
> Status: PLANNED

### Context

Jared's coworker shared the exact thinkorswim scans he trades from. Jared chose:

- **Triple Beat:**
  - Copy his gap rule: the stock's **highest price since the prior close** (after-hours + premarket) reached **+5%**, and the current premarket price is **still at or above the prior close**.
  - Lower the price floor to **$3**.
  - Add a **$250M minimum market cap**.
  - Keep the $5M average-dollar-volume floor and everything else.
- **Parabolic:**
  - Loosen the filters to his "pre-scan v2": **2 of the last 3 days green** (was 3 in a row), and **25%+ above the 10SMA OR up 35%+ in 5 days** (was 30%+ above the 10SMA).
  - Keep the 3% trade-day gap requirement.

Why the Triple Beat pipeline changes:
- Today's live scan starts from a whole-market snapshot filtered on the *current* gap ≥3.5%. That snapshot can't see the overnight high, so names that spiked and faded would never reach the scan.
- New flow: start from SEC's "latest filings" Atom feed, which lists every 8-K's items and acceptance time. Take the earnings filers (8-K item 2.02, plus 6-Ks), then check each one's after-hours/premarket minute bars.
- Verified live on 2026-10-29: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&owner=include&count=100&start=0&output=atom` returns entries shaped like this, and `start` pages back about 1,900 filings (several days):

```xml
<entry>
<title>8-K - Atomera Inc (0001420520) (Filer)</title>
<summary type="html"> ... &lt;br&gt;Item 2.02: Results of Operations and Financial Condition ...</summary>
<updated>2026-10-29T16:45:45-04:00</updated>
<category scheme="https://www.sec.gov/" label="form type" term="8-K"/>
```

- The replay has the same blind spot: it picks candidates by the 9:30 open gap. It now checks every liquid ticker-day for an earnings filing first, then measures the overnight gap from minute bars.

### Step 1 — `lib/sec/cik-map.ts` (MODIFY)

1. After `getCikForTicker`, add a reverse lookup that uses the same map-loading guard:

```ts
export async function getTickersForCiks(ciks: Set<string>): Promise<string[]> {
  if (!inMemoryMap || Date.now() - lastLoadAt > REFRESH_INTERVAL_MS) {
    await loadCikMap();
  }
  return [...(inMemoryMap?.values() ?? [])].filter((entry) => ciks.has(entry.cik)).map((entry) => entry.ticker);
}
```

`CikMapEntry.cik` is already 10-digit zero-padded, which matches the feed's `(0001420520)`.

### Step 2 — `lib/triple-beat/data.ts` (MODIFY)

1. Add these imports:
   - `import { secFetchText } from '@/lib/sec/client';`
   - `import { getTickersForCiks } from '@/lib/sec/cik-map';`
2. Below the existing constants, add:

```ts
const SEC_LATEST_FILINGS_URL = 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&owner=include&count=100&output=atom';
const SEC_LATEST_FILINGS_MAX_START = 2000;
```

3. Add this function above `findEarningsFiling`:

```ts
// SEC's "latest filings" feed lists each filing's 8-K items and acceptance time, newest first, and pages back
// ~2,000 filings (several days). 6-Ks carry no items, so callers still confirm them with an earnings headline.
export async function fetchEarningsFilerTickers(startMs: number, endMs: number): Promise<string[]> {
  const ciks = new Set<string>();
  for (const form of ['8-K', '6-K']) {
    for (let start = 0; start < SEC_LATEST_FILINGS_MAX_START; start += 100) {
      const entries = (await secFetchText(`${SEC_LATEST_FILINGS_URL}&type=${form}&start=${start}`)).split('<entry>').slice(1);
      let oldest = Number.POSITIVE_INFINITY;
      for (const entry of entries) {
        const accepted = Date.parse(entry.match(/<updated>([^<]+)<\/updated>/)?.[1] ?? '');
        const cik = entry.match(/\((\d{10})\) \(Filer\)/)?.[1];
        const formType = entry.match(/label="form type" term="([^"]+)"/)?.[1];
        oldest = Math.min(oldest, accepted);
        if (cik && formType === form && accepted >= startMs && accepted <= endMs
          && (form === '6-K' || entry.includes('Item 2.02'))) ciks.add(cik);
      }
      if (entries.length < 100 || oldest < startMs) break;
    }
  }
  return getTickersForCiks(ciks);
}
```

Expected behavior:
- `type=8-K` also returns `8-K/A` entries. The exact `formType === form` check drops them, which matches `findEarningsFiling`.
- If the feed request fails, `secFetchText` throws and the scan step fails (the step has `canRetry: true`). It does not silently post "No setups."

### Step 3 — `lib/triple-beat/scan.ts` (MODIFY)

1. In `RULES`:
   - `minPrice: 5` → `minPrice: 3`.
   - Replace `minGapPct: 4,` with `minMaxGapPct: 5,` and `minCurrentGapPct: 0,`.
   - Add `minMarketCap: 250_000_000,`.
   - Delete the three `livePrefilter*` keys and their comment.
   - Change the header comment to: `// Thresholds from the Triple Beat Earnings playbook v1.0; price, gap and market-cap floors match the coworker's thinkorswim scan.`
2. Add `maxGapPct: number;` (after `gapPct`) and `marketCap: number | null;` (after `avgDollarVolume20`) to `TripleBeatMetrics`.
3. In `TripleBeatScanReport`, delete `gappersChecked: number;`.
4. Delete `passesLivePrefilter`.
5. Replace `passesReplayPrefilter` with:

```ts
// Replay: any liquid ticker-day; the earnings-filing check and overnight gap rules run per ticker.
export function passesReplayPrefilter(bars: DailyOhlcBar[]): boolean {
  return bars.length >= 20 && mean(bars.slice(-20).map((bar) => bar.volume * bar.close)) >= RULES.minDollarVolume;
}
```

6. Change the `evaluateTripleBeatSetup` signature by adding a fourth parameter, `sharesOutstanding: number | null = null`. Existing three-argument callers in tests keep working, and the market-cap check is skipped when it's null.
7. In the `metrics` object:
   - Add `maxGapPct: pctChange(prior.close, extended.high),` after `gapPct`.
   - Add `marketCap: sharesOutstanding == null ? null : sharesOutstanding * extended.last,` after `avgDollarVolume20`.
8. Replace the `failedFilters` lines with:

```ts
if (metrics.referencePrice < RULES.minPrice) failedFilters.push('Price < $3');
if (metrics.avgDollarVolume20 < RULES.minDollarVolume) failedFilters.push('Dollar volume < $5M');
if (metrics.marketCap != null && metrics.marketCap < RULES.minMarketCap) failedFilters.push('Market cap < $250M');
if (metrics.maxGapPct < RULES.minMaxGapPct) failedFilters.push('Overnight high < +5%');
if (metrics.gapPct < RULES.minCurrentGapPct) failedFilters.push('Below prior close');
if (riskPerShare <= 0 || atr14 <= 0) failedFilters.push('No entry/stop');
```

Leave scoring alone. `Gap 10%+` still scores the current gap. `gapBucket` already returns `'<4'` for faded names.

### Step 4 — `lib/massive-market.ts` (MODIFY)

1. Delete `fetchAllTickerSnapshots` and its comment line. Step 5 removes its only caller. Leave the `prevDay` type alone.

### Step 5 — `lib/agents/blueprints/orchestrator-triple-beat-scan.ts` (MODIFY)

1. Imports:
   - Replace the `fetchAllTickerSnapshots` import with `import { fetchSharesOutstanding } from '@/lib/massive-market';`.
   - Add `fetchEarningsFilerTickers` to the `@/lib/triple-beat/data` import.
   - Remove `passesLivePrefilter` from the scan import.
2. Change the `BATCH_SIZE` comment to: `// Small batches: each filer makes 3 Massive calls; survivors add SEC requests (10/s) and one LLM call.`
3. Replace everything from `const snapshot = await fetchAllTickerSnapshots();` through the end of the batch loop with the following. It uses the same batching and `allSettled` handling:

```ts
const tickers = await fetchEarningsFilerTickers(windowStart, windowEnd);
const from = addCalendarDays(tradingDate, -400);
const setups: TripleBeatScanReport['setups'] = [];
for (let offset = 0; offset < tickers.length; offset += BATCH_SIZE) {
  const results = await Promise.allSettled(tickers.slice(offset, offset + BATCH_SIZE).map(async (ticker) => {
    const [history, extended, sharesOutstanding] = await Promise.all([
      fetchDailyBars(ticker, from, priorSession),
      fetchExtendedHoursStats(ticker, priorSession, tradingDate, asOfMs),
      fetchSharesOutstanding(ticker, priorSession).catch(() => null),
    ]);
    if (!extended) return null;
    // Cheap technical gate first so SEC and the LLM only run on names that can qualify.
    if (!evaluateTripleBeatSetup(history, extended, UNKNOWN_EARNINGS_READ, sharesOutstanding)?.qualified) return null;
    const filings = await getRecentFilings(ticker, { limit: 20, sinceDays: 5 });
    const filing = findEarningsFiling(filings.results, windowStart, windowEnd);
    if (!filing) return null;
    const news = await fetchEarningsNews(ticker, windowStart, windowEnd);
    if (filing.form_type === '6-K' && !news.some((item) => isEarningsHeadline(item.title))) return null;
    const evidence = buildEarningsEvidence(await fetchPressReleaseText(filing), news);
    const earnings = await classifyEarnings(ticker, evidence) ?? UNKNOWN_EARNINGS_READ;
    const setup = evaluateTripleBeatSetup(history, extended, earnings, sharesOutstanding);
    if (!setup?.plan || setup.grade === 'Pass') return null;
    return { ticker, ...setup, plan: setup.plan };
  }));
  // keep the existing fulfilled/rejected loop unchanged
}
```

4. Delete `let earningsFilings = 0;` and `earningsFilings += 1;`. In the step-1 return, replace `gappersChecked: gappers.length, earningsFilings, setups,` with `earningsFilings: tickers.length, setups,`.
5. In step 2's `reportJson`, remove `gappersChecked: output.gappersChecked,`.

### Step 6 — `lib/agents/discord.ts` (MODIFY), inside `buildTripleBeatScanEmbeds`

1. Change `scanned` to: `` `${payload.earningsFilings} earnings filers · premarket as of ${asOfEt} ET` ``.
2. Change the `'Gap · hold'` field value to: `` `${pct(metrics.gapPct)} (high ${pct(metrics.maxGapPct)}) · ${metrics.holdPct.toFixed(0)}% of range` ``.

### Step 7 — `scripts/triple-beat-replay.ts` (MODIFY)

1. Header comment: replace the sentence "Entry is a break of the premarket high…" up to (but not including) "LLM earnings reads are cached" with:

```
 * Candidates are liquid ticker-days ($5M+ 20-day dollar volume) with an SEC earnings filing accepted between the
 * prior session's 16:00 ET and 09:00 ET on the trade date, matching the live cron; gap, price and market-cap rules
 * then use minute bars and shares outstanding as of the prior session. The first run pulls SEC filing history for
 * every liquid ticker (roughly 10–20 minutes at SEC's 10 requests/second). Entry is a break of the premarket high,
 * filled at the open when it gaps above. A day that touches the stop counts as stopped before any target.
```

2. Change `fetchGroupedDailyAggregates, fetchSplitHistory` in the massive-market import to also include `fetchSharesOutstanding`.
3. In pass 1, change `passesReplayPrefilter(window, bar.open)` → `passesReplayPrefilter(window)`.
4. In pass 2, inside the `for (let offset …)` loop:
   - Add `const readsBefore = newLlmReads;` before `Promise.allSettled`.
   - Replace the unconditional `writeFileSync(cachePath, …)` with `if (newLlmReads > readsBefore) writeFileSync(cachePath, JSON.stringify(llmCache));`. There are now ~1M+ candidates, and most batches add no reads.
   - Add a progress log at the top of the loop: `if (offset % 20000 === 0) console.log(`pass 2: ${offset}/${candidates.length} (${rows.length} rows)`);`.
5. Add `fetchSharesOutstanding(ticker, priorSession).catch(() => null),` to the `Promise.all` and destructure it as `sharesOutstanding`.
   - Shares as of `priorSession` are already as-traded, so no split factor is needed.
   - Pass `sharesOutstanding` as the 4th argument to **both** `evaluateTripleBeatSetup` calls.
6. In the row object:
   - Add `maxGapPct: rounded(metrics.maxGapPct),` after `gapPct`.
   - Add `marketCapM: metrics.marketCap == null ? '' : Math.round(metrics.marketCap / 1e6),` after `avgDollarVolume20`.
7. Change the summary bucket list to `['<4', '4-7.9', '8-9.9', '10+']`.

### Step 8 — `lib/parabolic/scan.ts` (MODIFY)

1. In `RULES`:
   - Keep `minGreenDays: 3`. The `3+ consecutive green days` score item still uses it.
   - Add `greenLookback: 3,` and `minGreenInLookback: 2,`.
   - Change `minExt10Pct: 30` → `25`.
   - Add `minGain5Pct: 35,` and `livePrefilterMinGain5Pct: 20,`.
   - Change the header comment to: `// Research thresholds from the parabolic short playbook; mandatory filters match the coworker's thinkorswim pre-scan v2.`
2. Add `gain5Pct: number;` to `ParabolicMetrics` after `ext20Pct`.
3. Rename `hasGreenStreakAndVolume` → `hasGreenDaysAndVolume`, update both callers, and change the green check to:
   `&& bars.slice(-RULES.greenLookback).filter((bar) => bar.close > bar.open).length >= RULES.minGreenInLookback`
4. Add a helper after `countExpansions`:

```ts
// Matches the thinkorswim pre-scan: its 10SMA includes the current price; the 5-day gain is vs the close 5 sessions back.
function extension(closes: number[], price: number): { ext10Pct: number; gain5Pct: number } {
  return {
    ext10Pct: pctChange(mean([...closes.slice(-(RULES.sma10Period - 1)), price]), price),
    gain5Pct: pctChange(closes[closes.length - 5], price),
  };
}
```

5. `passesLivePrefilter` stays loose because the premarket price isn't known yet. Change its return to:

```ts
const closes = bars.map((bar) => bar.close);
return priorClose >= RULES.livePrefilterMinClose
  && (priorClose >= sma10 * RULES.livePrefilterMinSma10Ratio
    || pctChange(closes[closes.length - 5], priorClose) >= RULES.livePrefilterMinGain5Pct);
```

6. `passesReplayPrefilter`: replace the last condition, `pctChange(sma10, tradeOpen) >= RULES.minExt10Pct`, with:

```ts
&& (ext.ext10Pct >= RULES.minExt10Pct || ext.gain5Pct >= RULES.minGain5Pct)
```

   - Define `const ext = extension(bars.map((bar) => bar.close), tradeOpen);` first.
   - Delete the now-unused `sma10` local.
7. In `evaluateParabolicSetup`:
   - Replace the `ext10Pct:` metrics line with `...extension(closes, referencePrice),`. This also supplies `gain5Pct`.
   - Replace the green filter with:

```ts
if (bars.slice(-RULES.greenLookback).filter((bar) => bar.close > bar.open).length < RULES.minGreenInLookback) failedFilters.push('< 2 of last 3 green');
```

   - Replace the extension filter with:

```ts
if (metrics.ext10Pct < RULES.minExt10Pct && metrics.gain5Pct < RULES.minGain5Pct) failedFilters.push('< 25% above 10SMA and < 35% in 5 days');
```

   - Keep the gap filter and every score item unchanged.

### Step 9 — Tests (MODIFY)

1. `__tests__/triple-beat-scan.test.ts`:
   - Drop `passesLivePrefilter`.
   - Faded case: `{ ...extended, last: 20.5 }` now **qualifies** (high +17%, still green). Assert that.
   - Add `{ ...extended, last: 19.9 }` → contains `'Below prior close'`.
   - Add `{ ...extended, high: 20.9, low: 20.3, premarketHigh: 20.9, premarketLow: 20.3, last: 20.5 }` → failedFilters equals exactly `['Overnight high < +5%']`. The low has to drop too; otherwise premarketLow > premarketHigh also trips 'No entry/stop'.
   - Price case: `last: 2.9` → `'Price < $3'`.
   - Market cap: `evaluateTripleBeatSetup(history, extended, STRICT, 10_000_000)` (10M shares × $23 = $230M) → `'Market cap < $250M'`. With `20_000_000` shares it qualifies, and `marketCap` is `460_000_000`.
   - `passesReplayPrefilter`: `(history)` → true; `(history.slice(-19))` → false; `(history.map((bar) => ({ ...bar, volume: 1 })))` → false.
2. `__tests__/triple-beat-data.test.ts`: add a test for `fetchEarningsFilerTickers`.
   - Mock `@/lib/sec/client` (`secFetchText`) and `@/lib/sec/cik-map` (`getTickersForCiks` echoes the CIKs it receives).
   - Feed fixture with 5 entries:
     - an 8-K with Item 2.02 inside the window (kept);
     - an 8-K without 2.02 (dropped);
     - an `8-K/A` with 2.02 (dropped);
     - a 6-K inside the window (kept);
     - an 8-K with 2.02 accepted before the window (dropped).
   - Assert that paging stops: fewer than 100 entries means one request per form.
3. `__tests__/agent-triple-beat-scan.test.ts`:
   - Replace the `fetchAllTickerSnapshots` mock and the `snapshot()` helper with `vi.mock('@/lib/massive-market', () => ({ fetchSharesOutstanding: vi.fn() }))` (default `mockResolvedValue(null)`) and a `fetchEarningsFilerTickers` mock in the existing `@/lib/triple-beat/data` mock.
   - Remove the `gappersChecked` assertions and assert `earningsFilings` = number of filer tickers.
   - Keep the existing scenarios: ticker failure isolation, sorting, 6-K headline gate, and no LLM call when the technical gate fails.
   - Add one test: a ticker whose `fetchExtendedHoursStats` shows a faded gap that fails the gate never calls `getRecentFilings`.
   - The Thanksgiving test asserts `fetchEarningsFilerTickers` was not called.
4. `__tests__/agent-discord.test.ts`:
   - Remove `gappersChecked` from the Triple Beat fixture.
   - Add `maxGapPct` and `marketCap` to its metrics.
   - Update the header/description and `Gap · hold` expectations.
5. `__tests__/parabolic-scan.test.ts`:
   - The live-prefilter test currently makes only the last bar red, which now still passes (2 of 3 green). Make the last **two** bars red and expect false.
   - Add a test: one red bar among the last 3 still qualifies, with failedFilters free of `'< 2 of last 3 green'`.
   - Add a test: ext10 under 25% but a 5-day gain of 35%+ still qualifies.
   - Re-check the 20/50-bar score expectations (score items are unchanged, so they should hold).

### Files Changed Summary

| File | Change | Risk |
|---|---|---|
| `lib/sec/cik-map.ts` | +8 | Low |
| `lib/triple-beat/data.ts` | +30 | Med (new SEC feed parser) |
| `lib/triple-beat/scan.ts` | ~±30 | Med |
| `lib/massive-market.ts` | −6 | Low |
| `lib/agents/blueprints/orchestrator-triple-beat-scan.ts` | ~±30 | Med (candidate source swap) |
| `lib/agents/discord.ts` | ±2 | Low |
| `scripts/triple-beat-replay.ts` | ~±20 | Med (runtime grows) |
| `lib/parabolic/scan.ts` | ~±25 | Low |
| 5 test files | updates | Low |

### Acceptance Criteria

- [ ] The live Triple Beat scan no longer uses the market snapshot. Its candidates come from `fetchEarningsFilerTickers`.
- [ ] A name that hit +5% overnight and sits at +1% premarket qualifies. A name below its prior close, or that never reached +5%, does not.
- [ ] Price floor is $3. Market cap under $250M fails when shares are known and is skipped when they're null.
- [ ] `getRecentFilings` and the LLM run only after the technical gate passes.
- [ ] Discord header reads `N earnings filers · premarket as of …`. The gap field shows the current gap and the overnight high.
- [ ] Replay candidates come from `passesReplayPrefilter(window)`. The CSV has `maxGapPct` and `marketCapM`. The cache is written only when a batch adds reads. The summary includes the `<4` bucket.
- [ ] Parabolic mandatory filters are 2 of the last 3 green; 25%+ above a 10SMA that includes the current price, OR 35%+ in 5 days; 3%+ gap; $5; 1M average volume.
- [ ] `fetchAllTickerSnapshots` and `passesLivePrefilter` (Triple Beat) are gone with no orphan imports.

### Verification Steps

1. `npm run lint && npx tsc --noEmit && npm run typecheck:services && npm test`
2. `npm run build`
3. Manual (Jared): after deploy, the next 9:00 ET Triple Beat post should list setups that overlap the coworker's thinkorswim list for that morning (minus OTC names like PBCRY, which file no 8-K).
4. Manual (Jared): rerun `npx tsx scripts/triple-beat-replay.ts --from 2026-10-28 --to 2026-10-29`. Expect more rows than the previous 44, including some `<4` bucket faders.

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

## Recently Completed

### Triple Beat Earnings Scanner v1 — Pre-Market Long Scan + Historical Replay

Status: completed 2026-10-29.

Outcome:
- Orchestrator worker scans premarket earnings gap-ups (SEC 8-K Item 2.02 / 6-K gate) at `TRIPLE_BEAT_CRON_HOUR_ET` (default 9 ET) and posts grade-colored cards to `DISCORD_WEBHOOK_TRIPLE_BEAT`; scoring is pure code in `lib/triple-beat/scan.ts`, the LLM only reads EPS/revenue/guidance with quotes verified against the evidence.
- `scripts/triple-beat-replay.ts` replays over a date range (CSV + LLM cache in the home directory). Review fixes: replay cuts off at 09:00 ET to match the live run; SEC press-release failures fall back to news-only; LLM `maxTokens` 600 → 4096 because the MiniMax reasoning model was truncating the JSON (~20% failed reads).
- Known replay limits: candidates are picked by the 9:30 open gap (premarket faders missed); delisted tickers skipped.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm run typecheck:services`, `npm test` (945/945), `npm run workflow:audit`
- Replay smoke 2026-10-28→29: 44 rows, NCLH B/64 strict triple beat (yes/yes/raised); rerun `New LLM reads: 0`. Optiplex orchestrator rebuilt on 4f8f1bb (healthy, webhook set); first live post 2026-10-30 9:00 ET.

### Parabolic Short Scanner v1 — Pre-Market Scan + Historical Replay

Status: completed 2026-10-29.

Outcome:
- Orchestrator worker scores premarket parabolic short setups at `PARABOLIC_CRON_HOUR_ET` (default 9 ET) and posts a ranked embed to `DISCORD_WEBHOOK_PARABOLIC`; pure code, no LLM; thresholds live in `RULES` in `lib/parabolic/scan.ts`.
- `scripts/parabolic-replay.ts` replays the scorecard over a date range and writes an outcome CSV to the home directory; review fix rescales split-adjusted bars to as-of-date prices so the $5 / 1M filters are point-in-time.
- Discord post redesigned as cards (option 1 of `~/Downloads/parabolic-discord-options.html`): blue header card + one grade-colored card per setup (top 9), sent as one multi-embed webhook message; "as of" time capped at 9:30 ET.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm run typecheck:services`, `npm test` (907/907), `npm run build`, `npm run workflow:audit`
- Replay smoke 2026-10-14→15: 1 B setup, CSV written. Optiplex orchestrator rebuilt on 597e670 (healthy) and a live test post landed in Discord on 2026-10-29.

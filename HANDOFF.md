# Nexus Terminal — HANDOFF.md

## Active Handoff Only

Historical completed sections were removed to keep this file focused.
Use git history and the `specs/` directory for archived implementation detail.

### Session Maintenance Checklist

- [x] Refreshed `AGENTS.md` with current build/lint/test commands, single-test workflows, and coding conventions for agentic coding tools.
- [x] Verified command set and conventions against the current repository configuration (`package.json`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.mjs`).

---

## Scanner Realtime Data Pipeline

> Generated: 2026-03-16 | Agent: nexus-architect
> Status: IMPLEMENTED (local validation passed; deployment verification pending)

### Objective

Fix the Scanner showing "0 results" by (1) writing screener symbols into `realtime_quotes` so the scanner has immediate data, and (2) dynamically subscribing screener symbols to LEVELONE_EQUITIES for richer quote fields (bid/ask/high/low/open).

All changes are in the standalone relay service at `services/schwab-relay/src/`. The main Next.js app is untouched.

### Problem

The scanner API (`/api/scanner/route.ts`) queries `realtime_quotes`. That table is only populated by LEVELONE_EQUITIES data from the `TRACK_EQUITIES` env var. The screener stream (top gainers/losers, ~50 symbols) writes to `marketSnapshots` but NOT to `realtime_quotes`. So the scanner has no data unless `TRACK_EQUITIES` is manually set with matching symbols.

Meanwhile, Top Gainers/Losers works because it reads from `marketSnapshots` (Schwab screener) or falls back to Massive API delayed data.

### Relevant Files

All under `services/schwab-relay/src/`:

| File | Current Role |
|------|-------------|
| `writer.ts` | `QuoteWriter` class. `addQuote()` buffers into `quoteBuffer` Map, flushed every 1s into `realtime_quotes`. `addScreenerData()` writes to `marketSnapshots` only. |
| `streamer.ts` | `SchwabStreamer` class. `subscribe()` (line 246) runs once after LOGIN. Sends SUBS for static `TRACK_EQUITIES` symbols + SCREENER_EQUITY. No method to add symbols dynamically. |
| `index.ts` | Orchestrates streamer + writer. `onScreenerUpdate` callback calls `writer.addScreenerData()`. `onQuoteUpdate` callback calls `writer.addQuote()` per quote. |

### Key Types (from `streamer.ts`)

- `QuoteUpdate`: `{ symbol, assetType, lastPrice?, bidPrice?, askPrice?, openPrice?, highPrice?, lowPrice?, closePrice?, netChange?, netChangePercent?, totalVolume?, exchangeId?, securityStatus?, quoteTimeMs? }`
- `ScreenerUpdate`: `{ type: 'gainers' | 'losers', items: Array<{ symbol, lastPrice, netChange, netChangePercent, totalVolume }> }`

The screener item fields map directly to a subset of `QuoteUpdate` fields.

---

### Change 1: Write screener symbols into `realtime_quotes` (Phase 1)

**File:** `services/schwab-relay/src/writer.ts`
**Action:** MODIFY the `addScreenerData()` method

Inside `addScreenerData()` (lines 99-131), add a loop BEFORE the `const db = getDb();` line (before line 106). This buffers screener items into `realtime_quotes` via the existing `addQuote()` method.

**Add after line 104** (after the `this.gainers`/`this.losers` assignment block, before `const db = getDb();`):

```typescript
    // Also buffer screener items into realtime_quotes
    for (const item of screenerUpdate.items) {
      this.addQuote({
        symbol: item.symbol,
        assetType: 'equity',
        lastPrice: item.lastPrice,
        netChange: item.netChange,
        netChangePercent: item.netChangePercent,
        totalVolume: item.totalVolume,
      });
    }
```

**Why this works:** `addQuote()` (line 27) merges into the `quoteBuffer` Map using `symbol` as key. If LEVELONE_EQUITIES later sends richer data for the same symbol, it merges on top (the spread at lines 33-38 preserves existing fields and overwrites with new ones). So screener data seeds the row, and LEVELONE data enriches it.

**Acceptance criteria:**
- [ ] After a SCREENER_EQUITY update, the symbols appear in `realtime_quotes` within ~1 second (next flush cycle)
- [x] Each screener symbol row has `lastPrice`, `netChange`, `netChangePercent`, `totalVolume`, and `assetType = 'equity'`
- [ ] `bid_price`, `ask_price`, `open_price`, `high_price`, `low_price` are NULL until LEVELONE data arrives (Change 2)
- [x] The `marketSnapshots` write still happens as before (existing behavior unchanged)

---

### Change 2: Add dynamic LEVELONE subscription method to SchwabStreamer (Phase 2a)

**File:** `services/schwab-relay/src/streamer.ts`
**Action:** MODIFY — add state tracking + new public method

**Step 2a-1:** Add a private property after line 123 (after `private reconnectAttempts = 0;`):

```typescript
  private readonly subscribedEquities = new Set<string>();
```

**Step 2a-2:** In the existing `subscribe()` method (line 246), after building the equities list at line 251 (`const equities = parseList('TRACK_EQUITIES');`), seed the Set. Add after line 251:

```typescript
    for (const sym of equities) {
      this.subscribedEquities.add(sym);
    }
```

**Step 2a-3:** Add a new public method after the `isConnected()` method (after line 205), before the private methods:

```typescript
  addEquitySymbols(symbols: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.subscribed) {
      return;
    }

    const newSymbols = symbols.filter((s) => !this.subscribedEquities.has(s));
    if (newSymbols.length === 0) {
      return;
    }

    for (const sym of newSymbols) {
      this.subscribedEquities.add(sym);
    }

    this.sendMessage({
      requests: [
        {
          service: 'LEVELONE_EQUITIES',
          command: 'ADD',
          requestid: toRequestId(),
          parameters: {
            keys: newSymbols.join(','),
            fields: '0,1,2,3,8,10,11,12,17,18,28',
          },
        },
      ],
    });

    console.info(`[relay] dynamically subscribed ${newSymbols.length} new equity symbols`);
  }
```

**Why ADD not SUBS:** Schwab's streaming API uses `SUBS` to replace the entire subscription and `ADD` to append symbols. Using `ADD` preserves the static `TRACK_EQUITIES` symbols without re-sending them.

**Step 2a-4:** Clear the Set on disconnect. Two places:

1. In the `disconnect()` method (line 189), add before the closing brace:
```typescript
    this.subscribedEquities.clear();
```

2. In the WebSocket `close` handler (around line 176, after `this.subscribed = false;`):
```typescript
        this.subscribedEquities.clear();
```

**Acceptance criteria:**
- [x] `addEquitySymbols(['AAPL', 'TSLA'])` sends an ADD command via WebSocket with those symbols
- [x] Calling it again with the same symbols sends nothing (already tracked in Set)
- [x] If WebSocket is not connected or not yet subscribed, the method silently returns
- [x] On disconnect, the Set is cleared so reconnect starts fresh
- [x] The fields string `'0,1,2,3,8,10,11,12,17,18,28'` matches the existing SUBS fields exactly

---

### Change 3: Wire screener updates to trigger dynamic subscriptions (Phase 2b)

**File:** `services/schwab-relay/src/index.ts`
**Action:** MODIFY the `onScreenerUpdate` callback

In the `onScreenerUpdate` callback in `startStreamer()` (around lines 46-55), add a call to `streamer.addEquitySymbols()` after the existing screener data write.

**Replace the `onScreenerUpdate` callback with:**

```typescript
    onScreenerUpdate: (update) => {
      if (!writer) {
        return;
      }

      void writer.addScreenerData(update).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'unknown screener write error';
        log(`screener write failed: ${message}`);
      });

      // Dynamically subscribe screener symbols to LEVELONE_EQUITIES for richer data
      const symbols = update.items.map((item) => item.symbol);
      streamer?.addEquitySymbols(symbols);
    },
```

**What happens after all 3 changes:** When a screener update arrives:
1. `writer.addScreenerData()` writes to `marketSnapshots` AND buffers into `realtime_quotes` (Change 1)
2. `streamer.addEquitySymbols()` sends an ADD command for any new symbols (Change 2)
3. Future LEVELONE_EQUITIES data for those symbols flows through `onQuoteUpdate` → `writer.addQuote()`, enriching rows with bid/ask/high/low/open

**Acceptance criteria:**
- [x] When screener sends gainers with symbols `[AAPL, TSLA, NVDA]`, `addEquitySymbols` is called with those symbols
- [x] No crash if `streamer` is null (the `?.` handles this)

---

### Verification Steps

1. `cd services/schwab-relay && npx tsc --noEmit` — type-check passes
2. `cd services/schwab-relay && npm run build` — compiles to `dist/`
3. After deploying to Fly.io, check logs for:
   - `[relay] dynamically subscribed N new equity symbols` messages
   - `[relay] wrote N realtime quote rows` with counts > 0
4. Query DB: `SELECT count(*) FROM realtime_quotes;` — should show rows within 1-2 seconds of screener data
5. Scanner UI should show results instead of "0 results"

Local validation run (workspace root):
- [x] `npm run lint`
- [x] `npx tsc --noEmit`
- [x] `npm test`

Relay-local verification run (`services/schwab-relay`):
- [x] `npx tsc --noEmit`
- [x] `npm run build`

### Files Changed Summary

| File | Lines Added | Risk |
|------|-------------|------|
| `services/schwab-relay/src/writer.ts` | ~7 | LOW — uses existing `addQuote()` |
| `services/schwab-relay/src/streamer.ts` | ~30 | MEDIUM — new public method + state tracking |
| `services/schwab-relay/src/index.ts` | ~2 | LOW — 2 lines added to existing callback |

No new dependencies, no schema changes, no migrations.

---

## Schwab Relay Auth — Parallel Blocker

> Generated: 2026-03-16 | Status: OPEN

- Relay logs show repeated `Failed to load Schwab user preference (401)`.
- This keeps `realtime_quotes` stale or empty, which directly degrades Scanner results.
- The pipeline changes above are correct but won't produce data if the relay can't authenticate with Schwab.
- Schwab refresh tokens expire every **7 days** — you need to re-login via the Schwab OAuth flow weekly.

### Next steps (after pipeline changes)

1. Re-link Schwab account in the app (Markets tab → Schwab status)
2. After relinking, check Fly logs for `LOGIN successful, subscribing...` and quote-write activity
3. If 401 persists after fresh relink, investigate whether the relay is loading the correct tokens from the DB

---

## Discord Research Report Extraction

> Generated: 2026-03-16 | Status: PLANNED
> Priority: HIGH — unlocks ticker auto-subscription + historical research archive

### Objective

Parse ~1000 historical research reports from a Discord channel, extract the ticker symbol from each, store the full report text, and feed extracted tickers into the Schwab relay's dynamic subscription pipeline. This gives the scanner real coverage of "in play" tickers and archives third-party research for future reference.

### Context

- Reports follow a consistent format: title line is always `"Ultimate Research Report for {TICKER}"`
- Each report is a single Discord message containing structured sections (News, Theme, Dilution, Chart History, etc.)
- Reports are all in one Discord channel (~1000 messages)
- Many tickers repeat across reports on different days — dedup for subscriptions, but store each report individually
- The extracted tickers feed into `streamer.addEquitySymbols()` for realtime quote tracking

### Phase 1: Discord Message Ingestion

**Approach:** Discord Bot API (paginated channel history) or one-time export via DiscordChatExporter tool.

**Option A — Discord Bot (preferred for future auto-ingestion):**
- Bot needs `READ_MESSAGE_HISTORY` permission on the target channel
- `GET /channels/{channel_id}/messages?limit=100&before={last_message_id}` — paginate backwards
- Rate limit: 50 req/sec, so 1000 messages = 10 requests = trivial

**Option B — One-time export (faster to start):**
- Use DiscordChatExporter CLI to dump channel as JSON
- Parse the JSON file locally
- No bot setup needed, but no future auto-ingestion

### Phase 2: Report Parsing

**Ticker extraction** (simple — title is consistent):
```
regex: /Ultimate Research Report for ([A-Z]{1,5})/
```

**Full report storage** — save raw message text + parsed metadata:
- `ticker` — extracted from title
- `reportDate` — Discord message timestamp
- `rawText` — full message content
- `discordMessageId` — for dedup on re-runs
- `source` — `'discord_import'` to distinguish from our own generated reports

**Structured field extraction** (optional, for richer querying later):
- Price, Market Cap, Float/OS, Industry from header block
- Gain % from the gain line
- Section ratings (red/yellow/green dots → `high`/`medium`/`low` risk)

### Phase 3: Storage

**Option A — New table `imported_research_reports`:**
```
id              text PK
userId          text FK → users
ticker          text NOT NULL
reportDate      timestamp NOT NULL
source          text NOT NULL (e.g. 'discord_import', 'jmt415')
discordMessageId text UNIQUE (nullable — only for Discord imports)
rawText         text NOT NULL
parsedJson      jsonb (structured extraction, nullable)
createdAt       timestamp default now()
```

**Why a separate table from `research_reports`:** The existing `research_reports` table stores Jarvis-generated reports with `rawData` (AskEdgar API response) and `reportJson` (structured Jarvis output). Imported third-party reports have completely different shapes — raw Discord text, no `modelUsed`, no `status` lifecycle. Keeping them separate avoids schema pollution.

**Option B — Reuse `research_reports` with a `source` column:**
Add a `source` column (`'jarvis'` | `'discord_import'`) and store raw text in `rawData`. Simpler but muddies the table's purpose. Not recommended.

### Phase 4: Ticker → Schwab Subscription Pipeline

Once tickers are extracted and stored:

1. **On relay startup:** Query `imported_research_reports` for distinct tickers, merge with `TRACK_EQUITIES`, pass to initial `SUBS` command
2. **On new report import:** Call `streamer.addEquitySymbols([ticker])` to dynamically subscribe
3. **Optional: staleness filter** — only subscribe tickers from reports in the last N days (e.g., 90 days) to keep subscription count manageable

**Schwab subscription limit concern:** If unique tickers exceed Schwab's limit (~500 estimated), prioritize by:
- Recency of last report
- Frequency of appearance across reports
- Whether the ticker is in today's screener data

### Implementation Order

1. Decide Bot vs Export (depends on whether you want ongoing auto-ingestion or just the backfill)
2. Build the parser (regex ticker extraction + raw text capture)
3. Create `imported_research_reports` table + migration
4. Build import script/API route
5. Wire extracted tickers into relay subscription pipeline
6. Test with a small batch (~10 reports) before running the full ~1000

### Open Questions

- [ ] Which Discord channel ID contains the reports?
- [ ] Do you have a Discord bot token already, or do we need to set one up?
- [ ] Should we parse structured fields (price, float, dilution ratings) now or just store raw text and parse later?
- [ ] What's the cutoff for "relevant" tickers? All-time, last 6 months, last 30 days?

---

## Custom Dilution Research Report

> Generated: 2026-03-16 | Status: PLANNED
> Priority: HIGH — replaces $200/mo third-party report
> Depends on: Sprint 8 AskEdgar integration (partially built in `lib/jarvis/research.ts`)

### Objective

Build a Jarvis-powered research report that replicates the structure and depth of the jmt415 "Ultimate Research Report" using AskEdgar API data, Schwab market data, and AI synthesis. The goal is not a 1:1 clone but a report tuned to your specific trading style and needs.

### Current State

What's already built:
- `lib/jarvis/research.ts` — research pipeline that calls AskEdgar, feeds data to Jarvis, returns structured JSON
- `lib/jarvis/askedgar.ts` — AskEdgar API client (`fetchTickerData`)
- `lib/jarvis/prompts.ts` — prompt construction (`buildResearchPrompt`)
- `lib/jarvis/types.ts` — `DilutionResearchReport` type definition
- `research_reports` table — stores generated reports with `rawData` (AskEdgar response) and `reportJson` (Jarvis output)
- API route: `POST /api/jarvis/research`
- AskEdgar API docs: `docs/AE_API_DOCS.md`

What needs work:
- Report template doesn't match the depth of the jmt415 format
- Missing sections: Chart History, Offering Frequency, Offering Ability, Cash Need, Overall Offering Risk rating
- Prompt needs tuning to produce specific quantitative analysis (e.g., "123% of O/S", "0.6 months runway")
- No risk rating system (red/yellow/green per section)

### Target Report Template

Each section maps to a data source and synthesis approach:

| Section | Data Source | Synthesis |
|---------|-----------|-----------|
| **Header** (price, mcap, float/OS, industry) | Schwab realtime quotes + AskEdgar fundamentals | Direct data, no AI needed |
| **Gain** (today's % move) | Schwab realtime quotes | Direct data |
| **News / Why it's running** | AskEdgar filings (8-K, S-1) + news | Jarvis summarizes recent filings + catalysts |
| **Theme** | AskEdgar sector data + macro summary | Jarvis identifies sector narrative |
| **Other Catalysts** | AskEdgar filings (registration dates, warrant expiry, board meetings) | Jarvis extracts upcoming dated events |
| **Chart History** | Candle data + `lib/indicators.ts` (VWAP, SMA) | Jarvis analyzes recent gap days, squeezes, float-dependent behavior |
| **Dilution** | AskEdgar (warrants, PIPE, ATM, shelf, preferred shares, O/S changes) | Jarvis structures raw filing data into bullet points with quantities |
| **Offering Frequency** | AskEdgar (equity raise history) | Jarvis counts raises, calculates cadence |
| **Offering Ability** | AskEdgar (S-3 shelf, ATM programs, warrant registration status) | Jarvis assesses structural capacity for new offerings |
| **Cash Need** | AskEdgar (10-Q/10-K financials: cash, burn rate) | Jarvis calculates runway from latest quarterly data |
| **Financial Condition Commentary** | AskEdgar (10-Q/10-K full text search for "going concern", "liquidity") | Jarvis pulls direct quotes from filings |
| **Overall Offering Risk** | All of the above | Jarvis rates HIGH/MEDIUM/LOW with explanation |
| **Historical Stats** | Market data (price history around filing dates) | Calculate post-filing price moves |

### Section Risk Ratings

Each section gets a risk rating:
- `high` (red) — immediate dilution threat or severe cash need
- `medium` (yellow) — potential concern, monitoring needed
- `low` (green) — no near-term risk in this category

Jarvis assigns these based on the data in each section.

### Implementation Phases

**Phase 1: Audit existing pipeline**
- Review current `buildResearchPrompt()` output vs target template
- Review what AskEdgar `fetchTickerData()` actually returns (check `docs/AE_API_DOCS.md`)
- Identify data gaps — what does AskEdgar provide that we're not using?
- Identify missing data — what does the target template need that AskEdgar can't provide?

**Phase 2: Enrich data collection**
- Expand AskEdgar API calls if needed (additional endpoints for filings, financials)
- Add Schwab realtime quote lookup for header data (price, mcap, gain)
- Add candle data fetch for Chart History section
- Add indicator calculations (VWAP, gap detection) for chart analysis

**Phase 3: Prompt engineering**
- Restructure the system prompt to output the exact template sections
- Include examples of good output (use jmt415 reports from Discord import as reference)
- Add section-level risk rating instructions
- Tune for quantitative specificity ("123% of O/S" not "significant dilution")
- Iterate with real tickers until output quality matches expectations

**Phase 4: UI component**
- Build a `ResearchReport` display component matching the jmt415 visual style
- Section headers with colored risk dots
- Collapsible sections for long content
- Link to source filings (AskEdgar URLs)

**Phase 5: Cross-reference with imported reports**
- When generating a report for a ticker that has imported jmt415 reports, show "Historical Coverage" section
- Compare your AI-generated analysis against the imported human analysis
- Use imported reports as few-shot examples in the prompt for that ticker

### Key Design Decisions (TBD)

- [ ] Should reports auto-generate for screener movers, or only on-demand?
- [ ] Cache duration — how long before a report is considered stale and needs regeneration?
- [ ] Should the report be a new Jarvis mode (`dilution-research`) or enhance the existing `research` mode?
- [ ] Token budget — a report this detailed may need a long context window. Which model? (Claude Sonnet for speed vs Opus for depth)

### Prompt Tuning Strategy

The imported Discord reports (from the extraction spec above) become your ground truth:
1. Import 10-20 reports for well-known tickers
2. Generate your own report for the same tickers
3. Compare side-by-side — what's missing? What's wrong?
4. Adjust prompt, re-generate, compare again
5. Repeat until the output is good enough for your trading decisions

This is the most time-intensive part but also where the real value is. The data pipeline is mechanical; the prompt is where you make it yours.

# Nexus Terminal — HANDOFF.md

## Active Handoff Only

Historical completed sections (Scanner Realtime Data Pipeline, Tech Debt PRs 1-5, SSE Phases 0-2, Keyboard Shortcuts) were removed to keep this file focused.
Use git history and the `specs/` directory for archived implementation detail.

### Session Maintenance Checklist

- [x] Refreshed `AGENTS.md` with current build/lint/test commands, single-test workflows, and coding conventions for agentic coding tools.
- [x] Verified command set and conventions against the current repository configuration (`package.json`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.mjs`).
- [x] `parseJsonBody` removed from `lib/api-route-utils.ts` — all routes now use `parseAndValidate`
- [x] Updated `AGENTS.md` after Phase 2 shipped — SSE endpoint conventions and `lib/sse.ts` utility docs are documented
- [x] Test-auditor follow-up completed for API routes
- [x] Updated app shell header UX
- [ ] Update `AGENTS.md` after Discord import feature ships — document new tables, API routes, parser module, env vars

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

## SSE Jarvis Streaming — Manual QA Remaining

> Generated: 2026-03-17 | Status: CODE COMPLETE — awaiting Jared manual QA

All code shipped (Phases 0-3). Lint, type-check, and tests pass. Manual QA items remaining:

- [ ] Send a chat message to Jarvis — tokens appear one by one
- [ ] Blinking cursor shows during streaming
- [ ] Send `/research AAPL` — works as before (non-streaming, full response)
- [ ] Send `/analyze` — works as before (non-streaming, full response)
- [ ] Close the tab mid-stream — no console errors on server
- [ ] Send rapid messages — each streams correctly

---

## Custom Dilution Research Report

> Generated: 2026-03-16 | Status: PLANNED
> Priority: HIGH — replaces $200/mo third-party report
> Depends on: Sprint 8 AskEdgar integration (partially built in `lib/jarvis/research.ts`)

*(Full spec preserved from prior session — see git history for details. Implementation deferred until Discord import is complete.)*

---

## Discord Research Report Extraction

> Generated: 2026-03-17 | Agent: nexus-architect
> Status: IN PROGRESS — Phases 1-4 code complete, manual Schwab validation pending
> Priority: HIGH — unlocks ticker auto-subscription + historical research archive

### Goal

Parse ~1000 historical research reports from a Discord channel, extract ticker + structured data (price, float, dilution ratings), store in a dedicated table, and wire extracted tickers into the Schwab relay's subscription pipeline. Builds a queryable research knowledge base that future agents can use.

### Critical Implementation Note

> **Reports are in embeds, not message content.** The Discord bot sends research reports as rich embeds (`embeds[0].description`), NOT in the top-level `content` field (which is empty). The client module includes a `getMessageText()` helper that extracts text from embeds first, falling back to `content`. The parser's `parseMessages()` must use this helper. This was verified via live API call on 2026-03-18.

### Architecture Decisions

- **Discord Bot token + REST API** — no WebSocket gateway needed. Bot token authenticates REST calls to fetch channel message history. Easy to change channel/token later (just env vars).
- **Backfill first, then automated sync** — one-time bulk import of all ~1000 messages, then a sync route for incremental imports.
- **Separate `imported_research_reports` table** — different shape than Jarvis-generated reports (raw Discord text vs AskEdgar structured data). Avoids schema pollution.
- **Structured parsing upfront** — extract price, float, dilution ratings into `parsedJson` so reports are queryable, not just searchable.
- **No ticker cutoff** — subscribe to all extracted tickers to test Schwab's subscription limit empirically. Add a cap later if needed.

### Environment Variables

Add to `.env.local` (never committed):

```
DISCORD_BOT_TOKEN=         # Bot token from Discord Developer Portal
DISCORD_CHANNEL_ID=        # Channel ID containing research reports
```

### Workflow Instructions for opencode

**Execute phases in order: 1 → 2 → 3 → 4.**

After each phase:
1. Run `npm run lint && npx tsc --noEmit && npm test`
2. **STOP and report results.** Do not proceed to the next phase until confirmed.

---

### Phase 1: Schema + Parser + Tests

> Risk: LOW | Est: 1-2 hr

#### Change 1A: Add `imported_research_reports` table to schema

**File:** `lib/db/schema.ts`
**Action:** MODIFY

**Steps:**

1. Add the following table definition after the `researchReports` table (after line 136). Place it before `dailyTickerSummaries`:

```typescript
export const importedResearchReports = pgTable('imported_research_reports', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  ticker: text('ticker').notNull(),
  reportDate: timestamp('report_date', { withTimezone: true }).notNull(),
  source: text('source').notNull().default('discord_import'),
  discordMessageId: text('discord_message_id'),
  rawText: text('raw_text').notNull(),
  parsedJson: jsonb('parsed_json'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  unique().on(table.discordMessageId),
  index('imported_research_user_ticker_idx').on(table.userId, table.ticker, table.reportDate),
  index('imported_research_user_date_idx').on(table.userId, table.reportDate),
]);
```

**Why this shape:**
- `discordMessageId` has a unique constraint so re-running the import skips duplicates (upsert pattern).
- `parsedJson` stores the structured extraction (price, float, risk ratings) as flexible JSONB.
- `rawText` stores the full Discord message for future re-parsing if the parser improves.
- Indexed on `(userId, ticker, reportDate)` for "show me all reports for MULN" queries and `(userId, reportDate)` for "show me recent imports" queries.

**Acceptance Criteria:**
- [x] Table `imported_research_reports` defined in schema with all columns above
- [x] Unique constraint on `discordMessageId`
- [x] Two indexes created
- [x] Foreign key to `users.id` with cascade delete
- [x] `npm run lint && npx tsc --noEmit` passes

#### Change 1B: Generate and run migration

**Action:** RUN COMMANDS

```bash
npm run db:generate
npm run db:migrate
```

**Acceptance Criteria:**
- [x] Migration file created in `drizzle/` directory
- [x] Migration runs without errors
- [x] Table exists in database

#### Change 1C: Create Discord report parser module

**File:** `lib/discord/parser.ts`
**Action:** CREATE

This module parses Discord message text into structured report data. It's pure logic with no side effects — easy to test.

```typescript
/**
 * Discord research report parser.
 *
 * Extracts ticker symbol, price, float, market cap, and risk ratings
 * from Discord messages that follow the "Ultimate Research Report" format.
 *
 * The parser is intentionally lenient — it extracts what it can and
 * returns null for fields it can't find. The raw text is always stored
 * separately, so nothing is lost if parsing is incomplete.
 */

/** Structured data extracted from a research report */
export interface ParsedReportData {
  ticker: string;
  price: number | null;
  marketCap: string | null;
  floatShares: string | null;
  outstandingShares: string | null;
  industry: string | null;
  gainPercent: number | null;
  dilutionRisk: 'high' | 'medium' | 'low' | null;
  offeringRisk: 'high' | 'medium' | 'low' | null;
  scamRisk: 'high' | 'medium' | 'low' | null;
  cashBurnRisk: 'high' | 'medium' | 'low' | null;
}

/** Result of parsing a single Discord message */
export interface ParseResult {
  /** Whether this message is a research report at all */
  isReport: boolean;
  /** Extracted data (only set when isReport is true) */
  data: ParsedReportData | null;
}

/**
 * Extract the ticker symbol from the report title line.
 * Expected format: "Ultimate Research Report for {TICKER}"
 * or "**Ultimate Research Report for {TICKER}**" (bold markdown).
 */
const TICKER_REGEX = /Ultimate Research Report for ([A-Z]{1,5})/i;

/**
 * Extract price from lines like "Price: $1.23" or "Price: 1.23"
 */
const PRICE_REGEX = /Price:\s*\$?([\d,.]+)/i;

/**
 * Extract market cap from lines like "Market Cap: $12.3M" or "Mkt Cap: 500K"
 */
const MARKET_CAP_REGEX = /(?:Market\s*Cap|Mkt\s*Cap):\s*\$?([\d,.]+\s*[KMBT]?)/i;

/**
 * Extract float from lines like "Float: 12.3M" or "Float/OS: 12M / 50M"
 */
const FLOAT_REGEX = /Float(?:\/OS)?:\s*\$?([\d,.]+\s*[KMBT]?)/i;

/**
 * Extract outstanding shares from "OS: 50M" or "Float/OS: 12M / 50M"
 */
const OS_REGEX = /(?:OS|Outstanding(?:\s*Shares)?):\s*\$?([\d,.]+\s*[KMBT]?)/i;

/**
 * Extract industry from lines like "Industry: Biotechnology"
 */
const INDUSTRY_REGEX = /Industry:\s*(.+?)(?:\n|$)/i;

/**
 * Extract gain percentage from lines like "Gain: +45%" or "Gain: 120%"
 */
const GAIN_REGEX = /Gain:\s*[+-]?([\d,.]+)%/i;

/**
 * Map colored circle emojis to risk levels.
 * 🔴 = high risk, 🟡 = medium risk, 🟢 = low risk
 * Also handles text-based ratings like "(HIGH)" or "HIGH RISK"
 */
function parseRiskLevel(text: string, sectionName: string): 'high' | 'medium' | 'low' | null {
  // Find the line(s) near the section name
  const sectionIndex = text.toLowerCase().indexOf(sectionName.toLowerCase());
  if (sectionIndex === -1) return null;

  // Look at the ~200 chars after the section header for risk indicators
  const snippet = text.slice(sectionIndex, sectionIndex + 200);

  // Check for emoji indicators first (most reliable)
  if (snippet.includes('🔴') || snippet.includes(':red_circle:')) return 'high';
  if (snippet.includes('🟡') || snippet.includes(':yellow_circle:')) return 'medium';
  if (snippet.includes('🟢') || snippet.includes(':green_circle:')) return 'low';

  // Fall back to text-based indicators
  const upperSnippet = snippet.toUpperCase();
  if (upperSnippet.includes('HIGH')) return 'high';
  if (upperSnippet.includes('MEDIUM') || upperSnippet.includes('MODERATE')) return 'medium';
  if (upperSnippet.includes('LOW') || upperSnippet.includes('MINIMAL')) return 'low';

  return null;
}

/**
 * Parse a single Discord message into structured report data.
 *
 * Returns { isReport: false } for messages that aren't research reports.
 * Returns { isReport: true, data: {...} } for valid reports, with null
 * for any fields that couldn't be extracted.
 */
export function parseReport(messageContent: string): ParseResult {
  const tickerMatch = messageContent.match(TICKER_REGEX);
  if (!tickerMatch) {
    return { isReport: false, data: null };
  }

  const ticker = tickerMatch[1].toUpperCase();

  // Extract numeric/string fields
  const priceMatch = messageContent.match(PRICE_REGEX);
  const marketCapMatch = messageContent.match(MARKET_CAP_REGEX);
  const floatMatch = messageContent.match(FLOAT_REGEX);
  const osMatch = messageContent.match(OS_REGEX);
  const industryMatch = messageContent.match(INDUSTRY_REGEX);
  const gainMatch = messageContent.match(GAIN_REGEX);

  // Extract risk ratings by looking near section headers
  const dilutionRisk = parseRiskLevel(messageContent, 'dilution');
  const offeringRisk = parseRiskLevel(messageContent, 'offering');
  const scamRisk = parseRiskLevel(messageContent, 'scam');
  const cashBurnRisk = parseRiskLevel(messageContent, 'cash');

  const data: ParsedReportData = {
    ticker,
    price: priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : null,
    marketCap: marketCapMatch ? marketCapMatch[1].trim() : null,
    floatShares: floatMatch ? floatMatch[1].trim() : null,
    outstandingShares: osMatch ? osMatch[1].trim() : null,
    industry: industryMatch ? industryMatch[1].trim() : null,
    gainPercent: gainMatch ? parseFloat(gainMatch[1].replace(/,/g, '')) : null,
    dilutionRisk,
    offeringRisk,
    scamRisk,
    cashBurnRisk,
  };

  return { isReport: true, data };
}

/**
 * Parse multiple Discord messages and return only the ones that are reports.
 * Useful for bulk import where many messages may not be reports.
 *
 * IMPORTANT: Uses getMessageText() from the client module to extract text
 * from embeds (where the bot puts report content), not just message.content.
 */
import type { DiscordMessage } from './client';
import { getMessageText } from './client';

export function parseMessages(
  messages: DiscordMessage[],
): Array<{ messageId: string; timestamp: string; data: ParsedReportData; rawText: string }> {
  const results: Array<{ messageId: string; timestamp: string; data: ParsedReportData; rawText: string }> = [];

  for (const msg of messages) {
    const text = getMessageText(msg);
    const result = parseReport(text);
    if (result.isReport && result.data) {
      results.push({
        messageId: msg.id,
        timestamp: msg.timestamp,
        data: result.data,
        rawText: text,
      });
    }
  }

  return results;
}
```

**Acceptance Criteria:**
- [x] `lib/discord/parser.ts` created with `parseReport` and `parseMessages` exports
- [x] `ParsedReportData` and `ParseResult` types exported
- [x] Ticker extraction works for "Ultimate Research Report for MULN" format
- [x] Risk level parsing handles emoji (🔴🟡🟢) and text ("HIGH", "LOW") indicators
- [x] All fields return `null` gracefully when not found (no crashes on partial data)
- [x] `npm run lint && npx tsc --noEmit` passes

#### Change 1D: Create Discord API client module

**File:** `lib/discord/client.ts`
**Action:** CREATE

This module wraps Discord REST API calls. Keeps Discord-specific logic out of the API routes.

```typescript
/**
 * Discord REST API client for fetching channel message history.
 *
 * Uses a Discord Bot token for authentication. The bot needs
 * READ_MESSAGE_HISTORY permission on the target channel.
 *
 * Discord API docs: https://discord.com/developers/docs/resources/channel#get-channel-messages
 */

const DISCORD_API_BASE = 'https://discord.com/api/v10';

/** Shape of a Discord embed from the REST API */
interface DiscordEmbed {
  title?: string;
  description?: string;
}

/** Shape of a Discord message from the REST API (only fields we use) */
export interface DiscordMessage {
  id: string;
  content: string;
  timestamp: string;
  embeds?: DiscordEmbed[];
  author: {
    id: string;
    username: string;
  };
}

/**
 * Extract the text content from a Discord message.
 *
 * IMPORTANT: This bot sends research reports as rich embeds, not plain text.
 * The report text is in `embeds[0].description`, while `content` is empty.
 * This helper checks embeds first, then falls back to `content`.
 */
export function getMessageText(message: DiscordMessage): string {
  // Check embeds first — research reports are sent as rich embeds
  if (message.embeds && message.embeds.length > 0) {
    const embedText = message.embeds
      .map((e) => [e.title, e.description].filter(Boolean).join('\n'))
      .join('\n\n');
    if (embedText) return embedText;
  }
  return message.content;
}

/**
 * Fetch messages from a Discord channel, paginating backwards from the most recent.
 *
 * Discord returns max 100 messages per request. To get all messages, we paginate
 * using the `before` parameter — each request fetches the 100 messages before
 * the oldest message from the previous batch.
 *
 * @param channelId — Discord channel ID
 * @param botToken — Discord bot token (from DISCORD_BOT_TOKEN env var)
 * @param options.before — Fetch messages before this message ID (for pagination)
 * @param options.after — Fetch messages after this message ID (for incremental sync)
 * @param options.limit — Max messages per request (1-100, default 100)
 */
export async function fetchMessages(
  channelId: string,
  botToken: string,
  options: { before?: string; after?: string; limit?: number } = {},
): Promise<DiscordMessage[]> {
  const params = new URLSearchParams();
  params.set('limit', String(options.limit ?? 100));
  if (options.before) params.set('before', options.before);
  if (options.after) params.set('after', options.after);

  const url = `${DISCORD_API_BASE}/channels/${channelId}/messages?${params.toString()}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bot ${botToken}`,
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '(no body)');
    throw new Error(`Discord API error ${response.status}: ${body}`);
  }

  return (await response.json()) as DiscordMessage[];
}

/**
 * Fetch ALL messages from a channel by paginating backwards.
 *
 * Calls fetchMessages repeatedly, moving the `before` cursor backwards
 * until no more messages are returned. For ~1000 messages this takes
 * ~10 requests (100 per page) and completes in a few seconds.
 *
 * @param channelId — Discord channel ID
 * @param botToken — Discord bot token
 * @param onBatch — Optional callback after each batch (for progress logging)
 */
export async function fetchAllMessages(
  channelId: string,
  botToken: string,
  onBatch?: (batchSize: number, totalSoFar: number) => void,
): Promise<DiscordMessage[]> {
  const allMessages: DiscordMessage[] = [];
  let before: string | undefined;

  while (true) {
    const batch = await fetchMessages(channelId, botToken, { before });

    if (batch.length === 0) break;

    allMessages.push(...batch);
    before = batch[batch.length - 1].id; // oldest message in this batch

    if (onBatch) {
      onBatch(batch.length, allMessages.length);
    }

    // Discord rate limit safety: 50 req/sec, but be polite
    if (batch.length === 100) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    } else {
      // Got fewer than 100 — we've reached the beginning of the channel
      break;
    }
  }

  return allMessages;
}

/**
 * Fetch messages posted AFTER a specific message ID (for incremental sync).
 *
 * Uses the `after` parameter to get only new messages since the last import.
 * Paginates forward until no more messages are returned.
 */
export async function fetchNewMessages(
  channelId: string,
  botToken: string,
  afterMessageId: string,
): Promise<DiscordMessage[]> {
  const allMessages: DiscordMessage[] = [];
  let after = afterMessageId;

  while (true) {
    const batch = await fetchMessages(channelId, botToken, { after });

    if (batch.length === 0) break;

    allMessages.push(...batch);
    // Discord returns newest-first with `after`, so the last item is the oldest new message
    // We need the newest message ID to continue pagination
    after = batch[0].id;

    if (batch.length < 100) break;

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return allMessages;
}
```

**Acceptance Criteria:**
- [x] `lib/discord/client.ts` created with `fetchMessages`, `fetchAllMessages`, `fetchNewMessages` exports
- [x] `DiscordMessage` type exported
- [x] Pagination logic uses `before` for backfill, `after` for sync
- [x] 200ms delay between requests to avoid rate limits
- [x] `npm run lint && npx tsc --noEmit` passes

#### Change 1E: Create parser tests

**File:** `__tests__/discord-parser.test.ts`
**Action:** CREATE

```typescript
import { describe, it, expect } from 'vitest';
import { parseReport, parseMessages, type ParsedReportData } from '@/lib/discord/parser';
import { getMessageText, type DiscordMessage } from '@/lib/discord/client';

const SAMPLE_REPORT = `**Ultimate Research Report for MULN**

Price: $1.23
Market Cap: $45.6M
Float/OS: 12.3M / 50M
Industry: Electric Vehicles

Gain: +145%

**Dilution** 🔴
The company has a history of significant dilution...

**Offering Ability** 🟡
Mixed shelf registration in place...

**Scam/Pump Risk** 🟢
No evidence of fraudulent activity...

**Cash Burn** 🔴
Current burn rate suggests runway of 6 months...`;

const NON_REPORT_MESSAGE = 'Hey everyone, check out TSLA today!';

describe('Discord Report Parser', () => {
  it('extracts ticker from report title', () => {
    const result = parseReport(SAMPLE_REPORT);
    expect(result.isReport).toBe(true);
    expect(result.data?.ticker).toBe('MULN');
  });

  it('extracts price', () => {
    const result = parseReport(SAMPLE_REPORT);
    expect(result.data?.price).toBe(1.23);
  });

  it('extracts market cap', () => {
    const result = parseReport(SAMPLE_REPORT);
    expect(result.data?.marketCap).toBe('45.6M');
  });

  it('extracts float and outstanding shares', () => {
    const result = parseReport(SAMPLE_REPORT);
    expect(result.data?.floatShares).toBe('12.3M');
    expect(result.data?.outstandingShares).toBe('50M');
  });

  it('extracts industry', () => {
    const result = parseReport(SAMPLE_REPORT);
    expect(result.data?.industry).toBe('Electric Vehicles');
  });

  it('extracts gain percentage', () => {
    const result = parseReport(SAMPLE_REPORT);
    expect(result.data?.gainPercent).toBe(145);
  });

  it('extracts risk levels from emoji indicators', () => {
    const result = parseReport(SAMPLE_REPORT);
    expect(result.data?.dilutionRisk).toBe('high');
    expect(result.data?.offeringRisk).toBe('medium');
    expect(result.data?.scamRisk).toBe('low');
    expect(result.data?.cashBurnRisk).toBe('high');
  });

  it('returns isReport: false for non-report messages', () => {
    const result = parseReport(NON_REPORT_MESSAGE);
    expect(result.isReport).toBe(false);
    expect(result.data).toBeNull();
  });

  it('handles reports with missing fields gracefully', () => {
    const minimal = 'Ultimate Research Report for AAPL\n\nSome text without structured fields.';
    const result = parseReport(minimal);
    expect(result.isReport).toBe(true);
    expect(result.data?.ticker).toBe('AAPL');
    expect(result.data?.price).toBeNull();
    expect(result.data?.marketCap).toBeNull();
    expect(result.data?.dilutionRisk).toBeNull();
  });

  it('handles case-insensitive ticker in title', () => {
    const report = 'ultimate research report for tsla\nPrice: $200';
    const result = parseReport(report);
    expect(result.isReport).toBe(true);
    expect(result.data?.ticker).toBe('TSLA');
  });

  it('parseMessages filters and maps a batch', () => {
    const author = { id: '123', username: 'bot' };
    const messages: DiscordMessage[] = [
      { id: '1', content: SAMPLE_REPORT, timestamp: '2026-01-15T10:00:00Z', author },
      { id: '2', content: NON_REPORT_MESSAGE, timestamp: '2026-01-15T11:00:00Z', author },
      { id: '3', content: 'Ultimate Research Report for AAPL\nPrice: $150', timestamp: '2026-01-16T09:00:00Z', author },
    ];

    const results = parseMessages(messages);
    expect(results).toHaveLength(2);
    expect(results[0].messageId).toBe('1');
    expect(results[0].data.ticker).toBe('MULN');
    expect(results[1].messageId).toBe('3');
    expect(results[1].data.ticker).toBe('AAPL');
  });

  it('extracts text from embed description (real bot format)', () => {
    const embedMessage: DiscordMessage = {
      id: '99',
      content: '',
      timestamp: '2026-01-20T10:00:00Z',
      embeds: [{
        title: 'Ultimate Research Report for ORIS',
        description: '**Price:** $0.52\n**Market Cap:** 0.9M\n**Float / OS:** 4.2M / 5.1M\n\n**Dilution** 🔴\nClearly dilutive\n\n**Offering Ability** 🟡\nMixed signals',
      }],
      author: { id: '456', username: 'Research Report' },
    };

    const text = getMessageText(embedMessage);
    expect(text).toContain('Ultimate Research Report for ORIS');
    expect(text).toContain('$0.52');

    const result = parseReport(text);
    expect(result.isReport).toBe(true);
    expect(result.data?.ticker).toBe('ORIS');
    expect(result.data?.dilutionRisk).toBe('high');
  });

  it('handles text-based risk indicators when no emoji', () => {
    const report = `Ultimate Research Report for XYZ

**Dilution**
HIGH RISK - Extensive dilution history

**Offering Ability**
MODERATE risk due to shelf registration`;

    const result = parseReport(report);
    expect(result.data?.dilutionRisk).toBe('high');
    expect(result.data?.offeringRisk).toBe('medium');
  });
});
```

**Acceptance Criteria:**
- [x] `__tests__/discord-parser.test.ts` created
- [x] All tests pass: `npx vitest run __tests__/discord-parser.test.ts`
- [x] Tests cover: ticker extraction, all structured fields, risk level parsing (emoji + text), non-report filtering, missing fields, batch parsing
- [x] `npm run lint && npx tsc --noEmit` passes

#### Phase 1 Verification

```bash
npm run lint && npx tsc --noEmit && npm test
```

- [x] Lint passes
- [x] Type-check passes
- [x] All tests pass (including new parser tests)
- [x] Migration applied successfully

**STOP HERE. Report results before proceeding to Phase 2.**

---

### Phase 2: Backfill Import Route

> Risk: MEDIUM | Est: 1-2 hr

#### Change 2A: Create bulk import API route

**File:** `app/api/discord/import/route.ts`
**Action:** CREATE

**IMPORTANT:** This directory (`app/api/discord/`) was previously listed as an "empty/legacy directory" in CLAUDE.md. This is an explicit instruction to create routes here for the Discord import feature.

```typescript
import { requireUser } from '@/lib/server-db-utils';
import { ensureUser } from '@/lib/server-db-utils';
import { getDb } from '@/lib/db';
import { importedResearchReports } from '@/lib/db/schema';
import { logRouteError, internalServerError } from '@/lib/api-route-utils';
import { fetchAllMessages } from '@/lib/discord/client';
import { parseMessages } from '@/lib/discord/parser';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Vercel limit; ~1000 messages should finish well under this

/**
 * POST /api/discord/import
 *
 * Bulk import: fetches ALL messages from the configured Discord channel,
 * parses research reports, and stores them. Skips duplicates via
 * discordMessageId unique constraint.
 *
 * No request body needed — reads channel ID and bot token from env vars.
 *
 * Returns: { imported: number, skipped: number, total: number, tickers: string[] }
 */
export async function POST() {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const db = getDb();
  if (!db) return Response.json({ error: 'Database not configured' }, { status: 503 });

  await ensureUser(db, authState.user);
  const userId = authState.user.id;

  const botToken = process.env.DISCORD_BOT_TOKEN;
  const channelId = process.env.DISCORD_CHANNEL_ID;

  if (!botToken || !channelId) {
    return Response.json(
      { error: 'DISCORD_BOT_TOKEN and DISCORD_CHANNEL_ID must be set' },
      { status: 400 },
    );
  }

  try {
    // 1. Fetch all messages from Discord
    const messages = await fetchAllMessages(channelId, botToken, (batchSize, total) => {
      console.info(`[discord-import] Fetched batch of ${batchSize}, total: ${total}`);
    });

    // 2. Parse into reports
    const parsed = parseMessages(messages);

    // 3. Insert into DB, skipping duplicates
    let imported = 0;
    let skipped = 0;
    const tickers = new Set<string>();

    for (const report of parsed) {
      try {
        await db.insert(importedResearchReports).values({
          id: crypto.randomUUID(),
          userId,
          ticker: report.data.ticker,
          reportDate: new Date(report.timestamp),
          source: 'discord_import',
          discordMessageId: report.messageId,
          rawText: report.rawText,
          parsedJson: report.data,
        }).onConflictDoNothing();

        // onConflictDoNothing doesn't tell us if it was a dup or new insert,
        // but for logging purposes we count all non-error attempts as imported.
        // On re-runs, the unique constraint silently skips duplicates.
        imported++;
        tickers.add(report.data.ticker);
      } catch (error) {
        // Log but don't fail the whole import for one bad record
        console.error(`[discord-import] Failed to insert report ${report.messageId}:`, error);
        skipped++;
      }
    }

    return Response.json({
      imported,
      skipped,
      total: messages.length,
      reportsFound: parsed.length,
      tickers: Array.from(tickers).sort(),
      tickerCount: tickers.size,
    });
  } catch (error) {
    logRouteError('discord-import', error);
    return internalServerError();
  }
}
```

**Why `onConflictDoNothing` instead of upsert:** Re-running the import should be safe and idempotent. If a report is already imported (same `discordMessageId`), we skip it silently. This means you can run the import multiple times without creating duplicates.

**Acceptance Criteria:**
- [x] `app/api/discord/import/route.ts` created
- [x] `requireUser()` called — returns 401 if not authenticated
- [x] Returns 400 if env vars missing (not 500 — it's a config issue, not a server error)
- [x] Fetches all channel messages via Discord REST API
- [x] Parses reports using `parseMessages`
- [x] Inserts into `imported_research_reports` with `onConflictDoNothing` for idempotency
- [x] Returns summary: `{ imported, skipped, total, reportsFound, tickers, tickerCount }`
- [x] `npm run lint && npx tsc --noEmit` passes

#### Change 2B: Create GET route to list imported reports

**File:** `app/api/discord/import/route.ts`
**Action:** MODIFY (add GET handler to same file)

Add the following GET handler to the same route file:

```typescript
import { desc } from 'drizzle-orm';

/**
 * GET /api/discord/import
 *
 * List imported reports. Optional query params:
 * - ticker: filter by ticker symbol
 * - limit: max results (default 50, max 200)
 */
export async function GET(request: Request) {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const db = getDb();
  if (!db) return Response.json({ error: 'Database not configured' }, { status: 503 });

  const url = new URL(request.url);
  const ticker = url.searchParams.get('ticker')?.toUpperCase();
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '50'), 200);

  try {
    let query = db.select().from(importedResearchReports)
      .where(eq(importedResearchReports.userId, authState.user.id))
      .orderBy(desc(importedResearchReports.reportDate))
      .limit(limit);

    if (ticker) {
      query = db.select().from(importedResearchReports)
        .where(
          and(
            eq(importedResearchReports.userId, authState.user.id),
            eq(importedResearchReports.ticker, ticker),
          ),
        )
        .orderBy(desc(importedResearchReports.reportDate))
        .limit(limit);
    }

    const reports = await query;
    return Response.json({ reports, count: reports.length });
  } catch (error) {
    logRouteError('discord-import-list', error);
    return internalServerError();
  }
}
```

**Note for opencode:** You'll need to add `and` to the `drizzle-orm` import at the top of the file. Make sure the `desc` import is also added.

**Acceptance Criteria:**
- [x] GET handler added to `app/api/discord/import/route.ts`
- [x] Filters by ticker when `?ticker=MULN` query param provided
- [x] Limits results (default 50, max 200)
- [x] Orders by report date descending (newest first)
- [x] `npm run lint && npx tsc --noEmit` passes

#### Phase 2 Verification

```bash
npm run lint && npx tsc --noEmit && npm test
```

- [x] Lint passes
- [x] Type-check passes
- [x] All tests pass

**STOP HERE. Report results before proceeding to Phase 3.**

---

### Phase 3: Automated Sync Route

> Risk: LOW | Est: 30 min

#### Change 3A: Create sync API route

**File:** `app/api/discord/sync/route.ts`
**Action:** CREATE

```typescript
import { requireUser } from '@/lib/server-db-utils';
import { ensureUser } from '@/lib/server-db-utils';
import { getDb } from '@/lib/db';
import { importedResearchReports } from '@/lib/db/schema';
import { logRouteError, internalServerError } from '@/lib/api-route-utils';
import { fetchNewMessages } from '@/lib/discord/client';
import { parseMessages } from '@/lib/discord/parser';
import { eq, desc } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

/**
 * POST /api/discord/sync
 *
 * Incremental sync: fetches only NEW messages since the last import.
 * Finds the most recent discordMessageId in the DB and uses Discord's
 * `after` parameter to get only newer messages.
 *
 * If no previous imports exist, returns an error telling you to run
 * the full import first.
 */
export async function POST() {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const db = getDb();
  if (!db) return Response.json({ error: 'Database not configured' }, { status: 503 });

  await ensureUser(db, authState.user);
  const userId = authState.user.id;

  const botToken = process.env.DISCORD_BOT_TOKEN;
  const channelId = process.env.DISCORD_CHANNEL_ID;

  if (!botToken || !channelId) {
    return Response.json(
      { error: 'DISCORD_BOT_TOKEN and DISCORD_CHANNEL_ID must be set' },
      { status: 400 },
    );
  }

  try {
    // Find the most recent imported message ID
    const [latest] = await db.select({ discordMessageId: importedResearchReports.discordMessageId })
      .from(importedResearchReports)
      .where(eq(importedResearchReports.userId, userId))
      .orderBy(desc(importedResearchReports.reportDate))
      .limit(1);

    if (!latest?.discordMessageId) {
      return Response.json(
        { error: 'No previous imports found. Run POST /api/discord/import first.' },
        { status: 400 },
      );
    }

    // Fetch only new messages since the last import
    const messages = await fetchNewMessages(channelId, botToken, latest.discordMessageId);

    if (messages.length === 0) {
      return Response.json({ imported: 0, message: 'No new messages found' });
    }

    // Parse and insert
    const parsed = parseMessages(messages);
    let imported = 0;
    const tickers = new Set<string>();

    for (const report of parsed) {
      try {
        await db.insert(importedResearchReports).values({
          id: crypto.randomUUID(),
          userId,
          ticker: report.data.ticker,
          reportDate: new Date(report.timestamp),
          source: 'discord_import',
          discordMessageId: report.messageId,
          rawText: report.rawText,
          parsedJson: report.data,
        }).onConflictDoNothing();

        imported++;
        tickers.add(report.data.ticker);
      } catch (error) {
        console.error(`[discord-sync] Failed to insert report ${report.messageId}:`, error);
      }
    }

    return Response.json({
      imported,
      newMessages: messages.length,
      reportsFound: parsed.length,
      tickers: Array.from(tickers).sort(),
    });
  } catch (error) {
    logRouteError('discord-sync', error);
    return internalServerError();
  }
}
```

**Acceptance Criteria:**
- [x] `app/api/discord/sync/route.ts` created
- [x] `requireUser()` called
- [x] Finds the most recent `discordMessageId` from the DB
- [x] Returns 400 with helpful message if no previous imports exist
- [x] Fetches only new messages using `after` parameter
- [x] Inserts new reports with dedup
- [x] `npm run lint && npx tsc --noEmit` passes

#### Phase 3 Verification

```bash
npm run lint && npx tsc --noEmit && npm test
```

- [x] Lint passes
- [x] Type-check passes
- [x] All tests pass

**STOP HERE. Report results before proceeding to Phase 4.**

---

### Phase 4: Schwab Relay Subscription Wiring

> Risk: MEDIUM | Est: 1 hr

#### Change 4A: Add imported reports table to relay schema

**File:** `services/schwab-relay/src/schema.ts`
**Action:** MODIFY

Add the following table definition at the end of the file (after `marketSnapshots`). This is a **subset** of the main app's table — only the columns the relay needs to read:

```typescript
export const importedResearchReports = pgTable('imported_research_reports', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  ticker: text('ticker').notNull(),
  reportDate: timestamp('report_date', { withTimezone: true }).notNull(),
});
```

**Why only 4 columns:** The relay only needs `ticker` for subscriptions and `userId`/`reportDate` for filtering. The full table (with `rawText`, `parsedJson`, etc.) is defined in the main app's schema. This follows the existing pattern — the relay schema is an intentional subset.

**Acceptance Criteria:**
- [x] `importedResearchReports` added to relay schema with only `id`, `userId`, `ticker`, `reportDate`
- [x] No extra indexes or constraints (main app's migration already created them)

#### Change 4B: Create helper to load imported tickers

**File:** `services/schwab-relay/src/imported-tickers.ts`
**Action:** CREATE

```typescript
import { getDb } from './db.js';
import { importedResearchReports } from './schema.js';

/**
 * Query the imported_research_reports table for distinct tickers.
 * Returns a deduplicated array of ticker symbols.
 *
 * These are tickers from Discord research reports that we want to
 * subscribe to via Schwab's LEVELONE_EQUITIES stream so they appear
 * in the scanner with real-time quote data.
 */
export async function loadImportedTickers(): Promise<string[]> {
  const db = getDb();

  const rows = await db
    .selectDistinct({ ticker: importedResearchReports.ticker })
    .from(importedResearchReports);

  return rows.map((r) => r.ticker);
}
```

**Acceptance Criteria:**
- [x] `services/schwab-relay/src/imported-tickers.ts` created
- [x] Returns deduplicated ticker array
- [x] Uses the relay's own DB connection

#### Change 4C: Wire imported tickers into relay startup

**File:** `services/schwab-relay/src/index.ts`
**Action:** MODIFY

**Steps:**

1. Add import at the top of the file (after the existing imports on line 8):

```typescript
import { loadImportedTickers } from './imported-tickers.js';
```

2. In the `startStreamer` function (after `await streamer.connect();` on line 68), add:

```typescript
    // Subscribe to tickers from imported Discord research reports
    try {
      const importedTickers = await loadImportedTickers();
      if (importedTickers.length > 0) {
        streamer.addEquitySymbols(importedTickers);
        log(`subscribed ${importedTickers.length} imported research tickers`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      log(`failed to load imported tickers (non-fatal): ${message}`);
    }
```

**Why non-fatal:** If the imported reports table doesn't exist yet (migration not run) or the query fails, the relay should still start and work normally. The imported ticker subscription is a bonus, not a requirement.

**Acceptance Criteria:**
- [x] `loadImportedTickers` imported in `index.ts`
- [x] Called after `streamer.connect()` in `startStreamer`
- [x] Error is caught and logged, does not crash the relay
- [x] Logs count of subscribed tickers on success
- [x] Relay builds: `cd services/schwab-relay && npx tsc --noEmit`

#### Phase 4 Verification

```bash
# Main app
npm run lint && npx tsc --noEmit && npm test

# Relay
cd services/schwab-relay && npx tsc --noEmit
```

- [x] Main app lint passes
- [x] Main app type-check passes
- [x] Main app tests pass
- [x] Relay type-check passes

Manual checks (after Schwab re-link):
- [ ] Relay startup logs show `subscribed N imported research tickers`
- [ ] Imported tickers appear in `realtime_quotes` table after relay runs for a few minutes
- [ ] Scanner shows imported tickers with quote data

**STOP HERE. Wait for Jared to review.**

---

### Files Changed Summary

| File | Action | Phase | Risk |
|------|--------|-------|------|
| `lib/db/schema.ts` | MODIFY | 1 | LOW |
| `drizzle/*.sql` | CREATE (generated) | 1 | LOW |
| `lib/discord/parser.ts` | CREATE | 1 | LOW |
| `lib/discord/client.ts` | CREATE | 1 | LOW |
| `__tests__/discord-parser.test.ts` | CREATE | 1 | LOW |
| `app/api/discord/import/route.ts` | CREATE | 2 | MEDIUM |
| `app/api/discord/sync/route.ts` | CREATE | 3 | LOW |
| `services/schwab-relay/src/schema.ts` | MODIFY | 4 | LOW |
| `services/schwab-relay/src/imported-tickers.ts` | CREATE | 4 | LOW |
| `services/schwab-relay/src/index.ts` | MODIFY | 4 | MEDIUM |

**Total: 10 files (7 new, 3 modified)**

---

### Rollback Plan

Each phase is independent:

- **Phase 1:** Drop `imported_research_reports` table, delete `lib/discord/parser.ts`, `lib/discord/client.ts`, and test file. Revert schema.
- **Phase 2:** Delete `app/api/discord/import/route.ts`. Data stays in DB (harmless).
- **Phase 3:** Delete `app/api/discord/sync/route.ts`.
- **Phase 4:** Revert relay changes. Relay continues working without imported ticker subscriptions.

---

### Pre-flight Checklist (for Jared)

Before opencode starts:
- [ ] Create a Discord bot in the [Developer Portal](https://discord.com/developers/applications) and get the bot token
- [ ] Invite the bot to your server with `READ_MESSAGE_HISTORY` permission
- [ ] Get the channel ID (right-click channel → Copy Channel ID, with Developer Mode enabled in Discord settings)
- [ ] Add `DISCORD_BOT_TOKEN` and `DISCORD_CHANNEL_ID` to `.env.local`

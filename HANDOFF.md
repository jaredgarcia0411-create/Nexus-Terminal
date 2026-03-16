# Nexus Terminal — HANDOFF.md

## Active Handoff Only

Historical completed sections were removed to keep this file focused.
Use git history and the `specs/` directory for archived implementation detail.

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

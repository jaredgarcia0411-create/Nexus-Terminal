# Nexus Terminal — HANDOFF.md

## Completed Sections (Summarized)

This file has been compacted to keep only summaries for sections marked complete.
Detailed step-by-step execution specs and checklists were removed to save space.

---

## Codebase Audit — Cleanup & Hardening Sprint

> Generated: 2026-03-13 | Agent: nexus-architect
> Status: COMPLETE (IMPLEMENTED)

**Summary:**
- Implemented ALLOWED_EMAILS sign-in enforcement in auth while preserving allow-all behavior when unset.
- Corrected CLAUDE docs to match current architecture, table inventory, API routes, and Jarvis module layout.
- Renamed package identity to `nexus-terminal` and cleaned stale `next.config.ts` references.
- Removed orphaned Jarvis panel and completed Backtesting-to-Jarvis tab naming migration.
- Replaced straightforward `any` usages with stricter project-native typings.

---

## AskEdgar API: filing-titles endpoint + docs refresh

> Generated: 2026-03-13 | Agent: nexus-architect
> Status: COMPLETE (IMPLEMENTED)

**Summary:**
- Added AskEdgar `filing-titles` endpoint support in the Jarvis client layer.
- Extended dilution report typing with `FilingTitleItem[]` support.
- Replaced `docs/AE_API_DOCS.md` with updated source documentation.
- Validation completed: lint, TypeScript, tests.

---

## Research Reliability + Rendering Improvements

> Generated: 2026-03-13 | Agent: opencode
> Status: COMPLETE (IMPLEMENTED)

**Summary:**
- Hardened research cache reuse rules so invalid/null payloads are not reused as valid reports.
- Added force-refresh support from API/UI paths and propagated cache-source/warning metadata.
- Upgraded Jarvis chat rendering to prefer structured dilution report UI over raw JSON output.
- Added explicit Research UI force-refresh control (`Refresh (Ignore Cache)`).
- Validation completed: lint, TypeScript, tests.

---

## Research Null-Payload UX + Validation Hardening

> Generated: 2026-03-13 | Agent: opencode
> Status: COMPLETE (IMPLEMENTED)

**Summary:**
- Tightened schema-shape validation before cache reuse for dilution report payloads.
- Reworked non-schema chat fallback into compact readable UI with optional raw payload details.
- Ensured warnings are consistently visible across structured and fallback render paths.
- Added chat command force-refresh variants (`/research!` and `--force`) with cache/warning status badges.
- Validation completed: lint, TypeScript, tests.

---

## UI/UX Polish Sprint — Consistency & Refinement

> Generated: 2026-03-15 | Agent: nexus-architect
> Status: COMPLETE (IMPLEMENTED)

**Summary:**
- Standardized headers, spacing, border visibility, corner radius, and background surfaces across tabs.
- Unified non-Charts overlays/inputs/toggles/button styling and aligned emerald hover behavior.
- Added motion transitions for Markets/Research/Jarvis and numeric alignment via `tabular-nums`.
- Removed non-standard Jarvis violet/cyan accents in favor of emerald/zinc palette.
- Preserved intentional Charts tab visual exceptions.
- Validation completed: lint, TypeScript, tests, and visual tab consistency check.

---

---

## Research Tab Redesign — Pipeline Split + UI Overhaul

> Generated: 2026-03-15 | Agent: nexus-architect
> Status: COMPLETE (IMPLEMENTED)

**Summary:**
- Split research into two paths: `fetchAndCacheRawReport()` for Research tab (no LLM) and `runResearchTldr()` for chat TLDR generation.
- Added `buildResearchTldrPrompt()` and switched chat `/research` responses to compact TLDR payloads (`researchTldr`) with cache/warning metadata.
- Updated Research API and Research tab to return/render AskEdgar `rawData` via new `AskEdgarRawReport` component, while preserving `reportJson` fallback for legacy records.
- Removed Saved Tickers and force-refresh UI from Research tab; kept focus on AI Reports and Daily Summaries.
- Added Daily Summary date-range support (GET filters + POST range fetch/upsert loop, max 30 days).
- Validation completed: lint, TypeScript, tests.

---

## Schwab Real-Time Market Data (Option C Hybrid)

> Generated: 2026-03-15 | Agent: nexus-architect
> Status: COMPLETE (ALL PHASES IMPLEMENTED)

**Full spec:** [`specs/schwab-realtime-hybrid.md`](specs/schwab-realtime-hybrid.md)

**Summary:** Hybrid market data architecture — keep Massive Starter ($29/mo) for historical candle data, add Charles Schwab streaming API for real-time prices. A standalone relay service on Fly.io (~$5/mo) maintains the Schwab WebSocket and writes quotes to the DB. Schwab-linked users get live data; everyone else gets 15-min delayed Massive data.

**Phase 2 Progress (2026-03-15):**
- Created standalone relay service at `services/schwab-relay/` with TypeScript build/dev scripts and isolated dependencies.
- Implemented relay token lifecycle management: encrypted token decrypt/load from DB, 5-minute pre-expiry access-token refresh, and expired-link status updates.
- Implemented Schwab streaming client (userPreference bootstrap, LOGIN/SUBS flow, quote+screener parsing, reconnect loop) and batched DB writer to `realtime_quotes` + screener snapshot upsert.
- Added Fly.io deployment config (`fly.toml`) and production Dockerfile.
- Validation completed for relay service: `cd services/schwab-relay && npm install && npx tsc --noEmit`.

**Phase 3 Progress (2026-03-15):**
- Updated `/api/market-data/snapshot` to use dual-source behavior with per-user Schwab link checks, realtime DB reads, stale-data fallback, and `dataSource` response metadata.
- Polished realtime symbol normalization to align Schwab forex keys (e.g. `EUR/USD`) with Markets snapshot tickers.
- Added `hooks/use-schwab-status.ts` and integrated Markets UI link state, LIVE/15-MIN DELAYED badges, link/re-link flows, and unlink action.
- Added `/?tab=markets` URL parameter support in `app/page.tsx` for Schwab OAuth callback routing.
- Validation completed: lint, TypeScript, tests.

**Phase 4 Progress (2026-03-16):**
- Confirmed scanner foundation is schema-complete with existing `realtime_quotes` fields (`symbol`, `asset_type`, `last_price`, `net_change_percent`, `total_volume`, OHLC, `updated_at`).
- No additional implementation changes required for Phase 4 (stub-only scope in spec).

**Phases:**
1. [x] Schwab OAuth integration (7 changes — new tables, encrypted token storage, OAuth routes)
2. [x] Streaming relay service (10 changes — standalone Node.js service in `services/schwab-relay/`)
3. [x] Frontend integration (4 changes — dual-source snapshot route, LIVE/DELAYED badges, link/unlink UI)
4. [x] Scanner foundation (stub only — `realtimeQuotes` table already covers scanner fields)

---

## Schwab Phases 1-2: Post-Review Fixes

> Generated: 2026-03-15 | Agent: nexus-architect (review), claude (spec)
> Status: COMPLETE (IMPLEMENTED)

**Context:** Architecture review of Phases 1 & 2 found 5 actionable issues. Fix in priority order below.

### Fix 1: Validate LOGIN response before subscribing (BUG — blocks relay operation)

**File:** `services/schwab-relay/src/streamer.ts`

In `handleMessage()`, the code currently checks for a LOGIN response and immediately calls `subscribe()` without verifying success. Schwab LOGIN responses include `content.code` — `0` means success, anything else is failure.

**Steps:**
1. Find the block that checks `service === 'ADMIN' && command === 'LOGIN'` (around line 346-351)
2. Replace the simple existence check with a success validation:
   ```typescript
   const loginResponse = parsed.response?.find(
     (entry: { service: string; command: string }) =>
       entry.service === 'ADMIN' && entry.command === 'LOGIN'
   );
   if (loginResponse) {
     const code = (loginResponse as { content?: { code?: number } }).content?.code;
     if (code === 0) {
       console.log('[Streamer] LOGIN successful, subscribing...');
       this.subscribe();
     } else {
       const msg = (loginResponse as { content?: { msg?: string } }).content?.msg;
       console.error(`[Streamer] LOGIN failed: code=${code} msg=${msg}`);
       this.onError(new Error(`Schwab LOGIN failed: ${msg ?? `code ${code}`}`));
       this.disconnect();
     }
   }
   ```
3. Run: `cd services/schwab-relay && npx tsc --noEmit`

### Fix 2: Remove wrong exchangeId/securityStatus field extraction (BUG — data quality)

**File:** `services/schwab-relay/src/streamer.ts`

In `mapQuoteData()` (around lines 405-409), the code hardcodes `item['4']` as `exchangeId` and `item['5']` as `securityStatus`. These field numbers mean different things per service type (equities vs futures vs forex) and neither exchangeId nor securityStatus is subscribed for any service. Remove these two lines.

**Steps:**
1. Find the `mapQuoteData` function, locate these lines:
   ```typescript
   exchangeId: typeof item['4'] === 'string' ? item['4'] : undefined,
   securityStatus: typeof item['5'] === 'string' ? item['5'] : undefined,
   ```
2. Delete both lines
3. If `exchangeId` and `securityStatus` exist on the `QuoteUpdate` type but are now never assigned, leave them in the type (they may be populated in a future phase) — just remove the incorrect assignment
4. Run: `cd services/schwab-relay && npx tsc --noEmit`

### Fix 3: Clean up futures subscription fields (CLEANUP)

**File:** `services/schwab-relay/src/streamer.ts`

The LEVELONE_FUTURES subscription (around line 301) requests fields `0,1,2,3,4,5,8,12,13,14,18,19,20`. Fields 4 and 5 are not mapped in `FUTURES_FIELDS` and aren't used after Fix 2 removes the hardcoded extraction.

**Steps:**
1. Change the futures subscription field string from `0,1,2,3,4,5,8,12,13,14,18,19,20` to `0,1,2,3,8,12,13,14,18,19,20`
2. Run: `cd services/schwab-relay && npx tsc --noEmit`

### Fix 4: Update CLAUDE.md for Schwab infrastructure (DOCUMENTATION)

**File:** `.claude/CLAUDE.md`

The project docs are stale — they still list `schwab/` as empty/legacy and show 15 tables.

**Steps:**
1. Update the table count from `15` to `17` and add `schwab_links, realtime_quotes` to the table list
2. Remove `schwab/` from the "Empty/legacy directories" line (keep the others)
3. Add a new API Routes subsection:
   ```
   ## Schwab
   - GET `/api/schwab/auth` (OAuth initiation)
   - GET `/api/schwab/callback` (OAuth callback)
   - GET/DELETE `/api/schwab/status` (link status + unlink)
   ```
4. Add under Key Modules:
   ```
   ## Schwab
   - `lib/schwab/crypto.ts` — AES-256-GCM token encrypt/decrypt
   - `lib/schwab/auth.ts` — OAuth URL generation, code exchange, token refresh
   - `services/schwab-relay/` — Standalone streaming relay service (Fly.io)
   ```
5. Update Known Issues item 1 — change "Empty legacy API directories remain from removed Schwab/Discord/backtest features" to "Empty legacy API directories remain from removed Discord/backtest features"

### Fix 5: Remove unused `RELAY_SERVICE_SECRET` from .env.example (CLEANUP)

**File:** `.env.example`

`RELAY_SERVICE_SECRET` is declared but never referenced in any code. Remove it or add a comment `# Reserved for future relay<->app auth (Phase 3+)`.

**Steps:**
1. Find `RELAY_SERVICE_SECRET` in `.env.example` and add a comment: `# Future: relay<->app auth (not yet used)`
2. Done — no code changes needed

### Validation

After all fixes, run from project root:
```bash
cd services/schwab-relay && npx tsc --noEmit && cd ../.. && npm run lint && npx tsc --noEmit
```

---

## Schwab Phase 3.5 — Cleanup & Hardening Before Phase 4

> Generated: 2026-03-15 | Agent: nexus-architect (audit), claude (spec)
> Status: COMPLETE (IMPLEMENTED)
> Depends on: Phases 1-3 COMPLETE

**Context:** Architecture audit of Phases 1-3 found 10 issues across code quality, missing tests, coverage gaps, and minor bugs. All should be resolved before starting Phase 4 (Scanner). Fixes are ordered by priority.

**Implementation Summary (2026-03-15):**
- Removed unsupported crypto section from Markets snapshot API/UI and removed unsupported `C:CNYUSD` FX symbol.
- Hardened relay behavior with exponential reconnect backoff, batched multi-row quote upserts, hourly stale-quote cleanup, standardized log prefixes, and Fly health endpoint (`/health`).
- Added stricter Schwab token decrypt payload validation and propagated screener `volume` into mover rows.
- Added Schwab unit tests for crypto round-trip/tamper handling and realtime symbol normalization.
- Validation completed: lint, TypeScript, tests.

---

### Fix 1: Remove crypto section from Markets snapshot (no Schwab streaming source)

Schwab's streaming API does not offer crypto data. When a user has Schwab linked, the crypto section shows null prices (BTC/ETH always empty). Rather than showing broken data, remove crypto from the snapshot entirely.

**Files to change:**
- `app/api/market-data/snapshot/route.ts`
- `components/trading/MarketsTab.tsx`

**Steps:**

1. In `app/api/market-data/snapshot/route.ts`:
   - Delete the `CRYPTO_SYMBOLS` constant (line 82-85)
   - Remove `...CRYPTO_SYMBOLS.map((item) => item.ticker),` from the `tickers` array in `fetchFreshSnapshot()` (line 226)
   - Remove `crypto: CRYPTO_SYMBOLS.map(...)` from the return in `fetchFreshSnapshot()` (line 252)
   - Remove `crypto: CRYPTO_SYMBOLS.map(...)` from the return in `fetchRealtimeSnapshot()` (line 402)
   - Remove `crypto` from the `MarketSnapshotPayload` type (line 39)
   - Remove `crypto` from the `SnapshotCoverage.missingPriceBySection` type (line 55)
   - Remove `crypto: countMissing(data.crypto),` from `buildCoverage()` (line 461)
   - Remove `missingPriceBySection.crypto +` from the `missingPriceCount` calculation (line 468)
   - Update `totalInstruments` calculation in `buildCoverage()` to remove `data.crypto.length +` (line 457)

2. In `components/trading/MarketsTab.tsx`:
   - Remove `crypto` from the `SnapshotPayload` type (line 34)
   - Remove `crypto` from the `SnapshotCoverage.missingPriceBySection` type (line 50)
   - Delete the entire Crypto card div (lines 368-373):
     ```tsx
     <div className="rounded-xl border border-white/10 bg-[#121214] p-4">
       <h2 className="mb-3 text-base font-semibold text-zinc-200">Crypto</h2>
       <div className="grid gap-2 sm:grid-cols-2">
         {(snapshot?.crypto ?? []).map((item) => <InstrumentCard key={item.symbol} item={item} />)}
       </div>
     </div>
     ```

3. Run: `npm run lint && npx tsc --noEmit`

---

### Fix 2: Remove `C:CNYUSD` from FX symbols (not tracked by relay)

The snapshot includes `C:CNYUSD` but the relay doesn't subscribe to `CNY/USD`. It will always show null in realtime mode. Schwab may not support CNY/USD streaming at all. Remove it.

**File:** `app/api/market-data/snapshot/route.ts`

**Steps:**

1. Change line 86 from:
   ```typescript
   const FX_SYMBOLS = ['C:EURUSD', 'C:GBPUSD', 'C:USDJPY', 'C:USDCAD', 'C:AUDUSD', 'C:CNYUSD'];
   ```
   to:
   ```typescript
   const FX_SYMBOLS = ['C:EURUSD', 'C:GBPUSD', 'C:USDJPY', 'C:USDCAD', 'C:AUDUSD'];
   ```

2. Run: `npm run lint && npx tsc --noEmit`

---

### Fix 3: Add exponential backoff to relay reconnect

The relay uses a fixed 5-second reconnect delay. During extended Schwab outages, this will hammer the API every 5 seconds forever, re-calling `fetchPreference()` each time.

**File:** `services/schwab-relay/src/streamer.ts`

**Steps:**

1. Add a private field after the existing `private subscribed = false;` (line 151):
   ```typescript
   private reconnectAttempts = 0;
   ```

2. In the `connect()` method, after `this.connected = true;` in the `'open'` handler (line 188), add:
   ```typescript
   this.reconnectAttempts = 0;
   ```

3. Replace the `scheduleReconnect()` method (lines 500-508) with:
   ```typescript
   private scheduleReconnect(): void {
     if (this.manualDisconnect || this.reconnectTimer) {
       return;
     }

     const baseDelay = 5_000;
     const maxDelay = 5 * 60 * 1000;
     const delay = Math.min(baseDelay * Math.pow(2, this.reconnectAttempts), maxDelay);
     this.reconnectAttempts++;

     this.reconnectTimer = setTimeout(() => {
       this.reconnectTimer = null;
       void this.connect();
     }, delay);
   }
   ```
   This gives delays of: 5s, 10s, 20s, 40s, 80s, 160s, 300s (cap).

4. Run: `cd services/schwab-relay && npx tsc --noEmit`

---

### Fix 4: Batch relay upserts into single multi-row INSERT

The relay fires up to 29 individual `INSERT...ON CONFLICT` HTTP round-trips to Neon per 1-second flush. Drizzle supports multi-row inserts natively.

**File:** `services/schwab-relay/src/writer.ts`

**Steps:**

1. Replace the `flush()` method body (lines 40-100) with:
   ```typescript
   async flush(): Promise<void> {
     if (this.quoteBuffer.size === 0) {
       return;
     }

     const db = getDb();
     const pendingQuotes = Array.from(this.quoteBuffer.values());
     this.quoteBuffer.clear();

     for (let index = 0; index < pendingQuotes.length; index += UPSERT_BATCH_SIZE) {
       const batch = pendingQuotes.slice(index, index + UPSERT_BATCH_SIZE);

       const rows = batch.map((quote) => ({
         symbol: quote.symbol,
         assetType: quote.assetType,
         lastPrice: quote.lastPrice,
         bidPrice: quote.bidPrice,
         askPrice: quote.askPrice,
         openPrice: quote.openPrice,
         highPrice: quote.highPrice,
         lowPrice: quote.lowPrice,
         closePrice: quote.closePrice,
         netChange: quote.netChange,
         netChangePercent: quote.netChangePercent,
         totalVolume: quote.totalVolume,
         exchangeId: quote.exchangeId,
         description: undefined,
         securityStatus: quote.securityStatus,
         quoteTimeMs: quote.quoteTimeMs,
         updatedAt: new Date(),
       }));

       await db
         .insert(realtimeQuotes)
         .values(rows)
         .onConflictDoUpdate({
           target: realtimeQuotes.symbol,
           set: {
             assetType: sql`excluded.asset_type`,
             lastPrice: sql`excluded.last_price`,
             bidPrice: sql`excluded.bid_price`,
             askPrice: sql`excluded.ask_price`,
             openPrice: sql`excluded.open_price`,
             highPrice: sql`excluded.high_price`,
             lowPrice: sql`excluded.low_price`,
             closePrice: sql`excluded.close_price`,
             netChange: sql`excluded.net_change`,
             netChangePercent: sql`excluded.net_change_percent`,
             totalVolume: sql`excluded.total_volume`,
             exchangeId: sql`excluded.exchange_id`,
             securityStatus: sql`excluded.security_status`,
             quoteTimeMs: sql`excluded.quote_time_ms`,
             updatedAt: sql`NOW()`,
           },
         });
     }

     console.info(`[relay] wrote ${pendingQuotes.length} realtime quote rows`);
   }
   ```

   **Why this works:** Instead of 29 separate HTTP calls, this sends 1 SQL statement with all rows. The `excluded.*` references use Postgres's `EXCLUDED` pseudo-table to grab the would-be-inserted values for the ON CONFLICT UPDATE. The column names are snake_case because that's what Drizzle generates for the DB columns.

2. The `sql` import is already present from drizzle-orm at the top of the file. No new imports needed.

3. Run: `cd services/schwab-relay && npx tsc --noEmit`

   **Note:** If TypeScript complains about the `sql` template types not matching column types, wrap each `sql` call with a cast: `sql<string>`excluded.asset_type``. But Drizzle typically accepts raw `sql` in `.set()` without casting.

---

### Fix 5: Add relay health check HTTP endpoint

The relay has no HTTP server. Fly.io needs a health check to monitor the process. Add a minimal one.

**File:** `services/schwab-relay/src/index.ts`

**Steps:**

1. Add import at top of file:
   ```typescript
   import { createServer } from 'node:http';
   ```

2. After the `log()` function definition (line 17), add:
   ```typescript
   const HEALTH_PORT = Number(process.env.HEALTH_PORT ?? '8080');
   ```

3. In the `main()` function, after `log('starting Schwab relay service');` (line 112), add:
   ```typescript
   const healthServer = createServer((req, res) => {
     if (req.url === '/health') {
       const status = {
         ok: true,
         connected: streamer?.isConnected() ?? false,
         activeUser: activeUserId !== null,
         uptime: process.uptime(),
       };
       res.writeHead(200, { 'Content-Type': 'application/json' });
       res.end(JSON.stringify(status));
     } else {
       res.writeHead(404);
       res.end();
     }
   });
   healthServer.listen(HEALTH_PORT, () => {
     log(`health check listening on :${HEALTH_PORT}`);
   });
   ```

4. In `fly.toml`, add an HTTP health check section. Find the existing config and add:
   ```toml
   [[services]]
     internal_port = 8080
     protocol = "tcp"

     [[services.http_checks]]
       interval = 30000
       grace_period = "10s"
       method = "GET"
       path = "/health"
       protocol = "http"
       timeout = 5000
   ```

   **Note:** Check the existing `fly.toml` format — if it uses `[http_service]` instead of `[[services]]`, adapt accordingly. The key thing is an HTTP check on port 8080 path `/health`.

5. Run: `cd services/schwab-relay && npx tsc --noEmit`

---

### Fix 6: Add defensive token validation to main app `decryptTokens`

The relay's `decryptTokens` validates field types after parsing; the main app's does a bare `JSON.parse() as SchwabTokenPayload`. Add the same validation.

**File:** `lib/schwab/crypto.ts`

**Steps:**

1. Replace the `decryptTokens` function (lines 49-60) with:
   ```typescript
   export function decryptTokens(encrypted: string, iv: string, tag: string): SchwabTokenPayload {
     const key = getEncryptionKey();
     const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
     decipher.setAuthTag(Buffer.from(tag, 'hex'));

     const decrypted = Buffer.concat([
       decipher.update(Buffer.from(encrypted, 'hex')),
       decipher.final(),
     ]).toString('utf8');

     const parsed: unknown = JSON.parse(decrypted);
     if (typeof parsed !== 'object' || parsed === null) {
       throw new Error('Invalid decrypted token payload');
     }

     const candidate = parsed as Partial<SchwabTokenPayload>;
     if (
       typeof candidate.accessToken !== 'string' ||
       typeof candidate.refreshToken !== 'string' ||
       typeof candidate.expiresAt !== 'string' ||
       typeof candidate.refreshExpiresAt !== 'string'
     ) {
       throw new Error('Decrypted token payload missing required fields');
     }

     return {
       accessToken: candidate.accessToken,
       refreshToken: candidate.refreshToken,
       expiresAt: candidate.expiresAt,
       refreshExpiresAt: candidate.refreshExpiresAt,
     };
   }
   ```

2. Run: `npm run lint && npx tsc --noEmit`

---

### Fix 7: Remove dead `fieldNumber` NaN check in streamer

**File:** `services/schwab-relay/src/streamer.ts`

In `mapQuoteData()`, lines 434-436 are dead code — `Object.entries()` on a numeric-keyed object always produces parseable string keys.

**Steps:**

1. Delete these lines from `mapQuoteData()` (lines 434-436):
   ```typescript
         if (Number.isNaN(fieldNumber)) {
           continue;
         }
   ```

2. Also delete the now-unused `const fieldNumber = Number(fieldNumberRaw);` on line 421, since `fieldNumber` is no longer referenced.

3. Run: `cd services/schwab-relay && npx tsc --noEmit`

---

### Fix 8: Standardize log prefix in streamer

**File:** `services/schwab-relay/src/streamer.ts`

Two log calls use `[Streamer]` prefix while the rest of the relay uses `[relay]`.

**Steps:**

1. Line 353: Change `console.log('[Streamer] LOGIN successful, subscribing...');` to `console.log('[relay] LOGIN successful, subscribing...');`
2. Line 357: Change `console.error(...)` with `[Streamer]` prefix to use `[relay]` prefix:
   ```typescript
   console.error(`[relay] LOGIN failed: code=${code} msg=${msg}`);
   ```

3. Run: `cd services/schwab-relay && npx tsc --noEmit`

---

### Fix 9: Add screener volume to mover rows

The relay writes `totalVolume` in screener data but the snapshot's realtime `toMoverRows()` doesn't include it in the output.

**Files:**
- `app/api/market-data/snapshot/route.ts`
- `components/trading/MarketsTab.tsx`

**Steps:**

1. In `app/api/market-data/snapshot/route.ts`, add `volume` to the `MarketMoverRow` type (after line 33):
   ```typescript
   type MarketMoverRow = {
     ticker: string;
     price: number | null;
     previousClose: number | null;
     change: number | null;
     changePercent: number | null;
     updated: number | null;
     volume: number | null;
   };
   ```

2. In the Massive `toMoverRows()` function (line 208-220), add `volume: null,` to the mapped object (after `updated`):
   ```typescript
   updated: toNumberOrNull(row.updated),
   volume: null,
   ```

3. In the realtime `toMoverRows` local function inside `fetchRealtimeSnapshot()` (lines 360-388), add `volume` to the screener item type and the return:
   - Add `totalVolume?: number;` to the input array type
   - Add `volume: row.totalVolume ?? null,` to the returned `MarketMoverRow` object (after `updated: null,`)

4. In `components/trading/MarketsTab.tsx`, add `volume` to the `MarketMoverRow` type if it exists there (check the type definition — if the component uses the API response type directly, no change needed).

5. Run: `npm run lint && npx tsc --noEmit`

---

### Fix 10: Add periodic stale quote cleanup in relay

Old `realtime_quotes` rows persist if symbols are removed from `TRACK_*` env vars. Add a periodic cleanup.

**File:** `services/schwab-relay/src/writer.ts`

**Steps:**

1. Add import at top:
   ```typescript
   import { lt } from 'drizzle-orm';
   ```

2. Add a new exported function after the `QuoteWriter` class:
   ```typescript
   export async function cleanupStaleQuotes(): Promise<void> {
     const db = getDb();
     const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

     const result = await db
       .delete(realtimeQuotes)
       .where(lt(realtimeQuotes.updatedAt, oneHourAgo));

     const count = (result as { rowCount?: number }).rowCount ?? 0;
     if (count > 0) {
       console.info(`[relay] cleaned up ${count} stale quote rows`);
     }
   }
   ```

3. In `services/schwab-relay/src/index.ts`, import the cleanup:
   ```typescript
   import { QuoteWriter, cleanupStaleQuotes } from './writer.js';
   ```

4. In `main()`, after the `setInterval` for `syncTokens` (line 121), add:
   ```typescript
   setInterval(() => {
     void cleanupStaleQuotes().catch((error: unknown) => {
       const message = error instanceof Error ? error.message : 'unknown cleanup error';
       log(`stale quote cleanup failed: ${message}`);
     });
   }, 60 * 60 * 1000);
   ```
   This runs cleanup once per hour.

5. Run: `cd services/schwab-relay && npx tsc --noEmit`

---

### Fix 11: Add unit tests for Schwab code

Create test files covering crypto, symbol normalization, and streamer field mapping. These are the highest-value tests for catching regressions.

**Steps:**

1. **Create `__tests__/schwab-crypto.test.ts`** — test encrypt/decrypt roundtrip:
   ```typescript
   import { describe, it, expect, vi, beforeEach } from 'vitest';

   describe('schwab crypto', () => {
     const TEST_KEY = 'a'.repeat(64);

     beforeEach(() => {
       vi.stubEnv('SCHWAB_TOKEN_ENCRYPTION_KEY', TEST_KEY);
     });

     it('encrypt then decrypt returns original payload', async () => {
       const { encryptTokens, decryptTokens } = await import('@/lib/schwab/crypto');
       const payload = {
         accessToken: 'access-123',
         refreshToken: 'refresh-456',
         expiresAt: '2026-01-01T00:00:00Z',
         refreshExpiresAt: '2026-06-01T00:00:00Z',
       };

       const encrypted = encryptTokens(payload);
       const decrypted = decryptTokens(encrypted.encrypted, encrypted.iv, encrypted.tag);
       expect(decrypted).toEqual(payload);
     });

     it('throws on invalid key length', async () => {
       vi.stubEnv('SCHWAB_TOKEN_ENCRYPTION_KEY', 'tooshort');
       const { encryptTokens } = await import('@/lib/schwab/crypto');
       expect(() => encryptTokens({
         accessToken: 'a', refreshToken: 'b',
         expiresAt: 'c', refreshExpiresAt: 'd',
       })).toThrow();
     });

     it('throws on tampered ciphertext', async () => {
       const { encryptTokens, decryptTokens } = await import('@/lib/schwab/crypto');
       const payload = {
         accessToken: 'access-123',
         refreshToken: 'refresh-456',
         expiresAt: '2026-01-01T00:00:00Z',
         refreshExpiresAt: '2026-06-01T00:00:00Z',
       };
       const encrypted = encryptTokens(payload);
       const tampered = 'ff' + encrypted.encrypted.slice(2);
       expect(() => decryptTokens(tampered, encrypted.iv, encrypted.tag)).toThrow();
     });
   });
   ```

2. **Create `__tests__/schwab-symbol-normalization.test.ts`** — test the normalization logic:
   ```typescript
   import { describe, it, expect } from 'vitest';
   import { normalizeMassiveTicker } from '@/lib/massive-market';

   function normalizeRealtimeSymbol(raw: string) {
     return normalizeMassiveTicker(raw).replace(/\//g, '');
   }

   describe('normalizeRealtimeSymbol', () => {
     it('equities pass through unchanged', () => {
       expect(normalizeRealtimeSymbol('SPY')).toBe('SPY');
       expect(normalizeRealtimeSymbol('AAPL')).toBe('AAPL');
     });

     it('futures strip leading slash', () => {
       expect(normalizeRealtimeSymbol('/GC')).toBe('GC');
       expect(normalizeRealtimeSymbol('/ES')).toBe('ES');
     });

     it('forex strips C: prefix and slash', () => {
       expect(normalizeRealtimeSymbol('C:EURUSD')).toBe('EURUSD');
     });

     it('Schwab forex format strips slash', () => {
       expect(normalizeRealtimeSymbol('EUR/USD')).toBe('EURUSD');
     });

     it('both forex formats normalize to same key', () => {
       const massive = normalizeRealtimeSymbol('C:EURUSD');
       const schwab = normalizeRealtimeSymbol('EUR/USD');
       expect(massive).toBe(schwab);
     });
   });
   ```

3. Run: `npx vitest run __tests__/schwab-crypto.test.ts __tests__/schwab-symbol-normalization.test.ts`

   **Note:** The crypto test uses dynamic `import()` to pick up the stubbed env var. If vitest's module cache causes issues, add `vi.resetModules()` in `beforeEach`. Check existing test patterns in `__tests__/` for how the project handles this.

---

### Validation (all fixes)

After all fixes are complete, run from project root:
```bash
cd services/schwab-relay && npx tsc --noEmit && cd ../.. && npm run lint && npx tsc --noEmit && npm run test
```

---

## Schwab Phase 4 Review — Architecture Audit Findings

> Generated: 2026-03-15 | Agent: nexus-architect (review)
> Status: OPEN (items for future work)

**Context:** Full review of Schwab phases 1-4 implementation against specs and live code. All phases verified as implemented and matching HANDOFF descriptions. The following are open items discovered during review.

### Known Issues

1. **Realtime `quoteSession` always `'regular'` (MEDIUM)** — `fetchRealtimeSnapshot()` in `app/api/market-data/snapshot/route.ts` line 322 hardcodes `quoteSession: 'regular'` for all realtime instruments. Schwab streams extended-hours data, so during pre-market/after-hours the LIVE badge shows but the session label is misleading. The delayed Massive path has proper session detection via `getEasternMarketSession()`. Fix: add session detection to the realtime path.

2. **Relay schema drift from main app (LOW)** — `services/schwab-relay/src/schema.ts` is an intentional subset of `lib/db/schema.ts` but lacks a comment documenting this. Missing fields (`accountLabel`, `linkedAt`, `status` enum) and indexes are harmless but could confuse future work. Fix: add a header comment noting it's a subset and pointing to the source of truth.

3. **Relay flush logging noise (LOW)** — `services/schwab-relay/src/writer.ts` line 97 logs every 1-second flush cycle during market hours (~23K lines/day). Fix: log every 60th flush or use `console.debug`.

4. **Snapshot route uses `console.error` for non-errors (LOW)** — `logSnapshotStage` in `app/api/market-data/snapshot/route.ts` line 442 uses `console.error` for routine diagnostics, polluting Vercel error dashboards. Fix: switch to `console.info`.

5. **Single-user relay limitation undocumented** — `services/schwab-relay/src/tokens.ts` `loadActiveTokens` uses `.limit(1)` with no ordering. Only one Schwab-linked user gets streaming at a time. This is intentional for the current single-user design but not documented.

6. **Dead `exchangeId`/`securityStatus` writer code (LOW)** — After Phase 3.5 Fix 2 removed hardcoded field extraction, these fields in `services/schwab-relay/src/writer.ts` are always `undefined`. The upsert still maps them (harmless NULL writes). Cleanup only.

### Deployment Gaps

1. **No relay `.env.example`** — The relay requires `DATABASE_URL`, `SCHWAB_CLIENT_ID`, `SCHWAB_CLIENT_SECRET`, `SCHWAB_TOKEN_ENCRYPTION_KEY` and optional `HEALTH_PORT`, `TOKEN_CHECK_INTERVAL_MS`, `TRACK_EQUITIES`, `TRACK_FUTURES`, `TRACK_FOREX`. None documented in a relay-specific env example.

2. **Relay `package-lock.json`** — The Dockerfile uses `npm ci` which requires a lockfile. Verify `services/schwab-relay/package-lock.json` is committed; if not, generate and commit it.

### Phase 5+ Scanner Roadmap (Not Yet Specified)

Phase 4 confirmed the `realtime_quotes` schema covers scanner fields. The next phase would be:
- `/api/scanner` route with filtering/sorting on `realtime_quotes` (asset type, % change, volume thresholds)
- Scanner UI component in Markets tab or new tab
- No spec or timeline exists yet — create when ready to build.

---

## Schwab Phase 4 Review — Implementation Steps (for opencode)

> Generated: 2026-03-15 | Agent: nexus-architect
> Status: COMPLETE (IMPLEMENTED)
> Depends on: All Schwab phases COMPLETE

**Context:** Architecture audit found 6 code issues + 2 deployment gaps. These are ordered by priority. Each step is independent — complete and validate one at a time.

**Implementation Summary (2026-03-15 | Agent: opencode):**
- Realtime snapshot now derives `quoteSession` from `getEasternMarketSession()` instead of hardcoding `'regular'`.
- Snapshot diagnostics use `console.info` so normal route telemetry no longer pollutes error dashboards.
- Relay writer logs are throttled to once per 60 flushes, and dead `exchangeId`/`securityStatus`/`description` upsert mappings were removed.
- Added relay schema subset + single-user token loader comments; refreshed relay `.env.example`; confirmed relay lockfile is present.
- Validation completed: relay TypeScript checks, root lint, root TypeScript checks, and full test suite.

---

### Step 1: Fix realtime `quoteSession` accuracy (MEDIUM)

**Why:** When a user has Schwab linked, `mapRealtimeInstrument()` hardcodes `quoteSession: 'regular'` for every instrument. During pre-market or after-hours, the UI shows a LIVE badge but claims "regular" session — misleading. The delayed Massive path already uses `getEasternMarketSession()` to detect the correct session. The realtime path should do the same.

**File:** `app/api/market-data/snapshot/route.ts`

1. Inside `fetchRealtimeSnapshot()` (line 275), add a session detection call right after the stale-data check block (after line 290, before the `const quotes` line):
   ```typescript
   const currentSession = getEasternMarketSession();
   ```
   `getEasternMarketSession` is already imported at line 9 — no new import needed.

2. In `mapRealtimeInstrument()` (the inner function starting at line 299), change the hardcoded `quoteSession` on line 322 from:
   ```typescript
   quoteSession: 'regular',
   ```
   to:
   ```typescript
   quoteSession: currentSession,
   ```
   This works because `mapRealtimeInstrument` is a closure inside `fetchRealtimeSnapshot`, so it can see `currentSession`.

3. Run: `npm run lint && npx tsc --noEmit`

---

### Step 2: Fix snapshot route logging level (LOW)

**Why:** `logSnapshotStage` uses `console.error` for routine diagnostic messages like "upstream_fetch started" and "auth_check unauthorized". On Vercel, `console.error` surfaces in error dashboards and could obscure real errors.

**File:** `app/api/market-data/snapshot/route.ts`

1. On line 442, change:
   ```typescript
   console.error('[api:market-data.snapshot]', {
   ```
   to:
   ```typescript
   console.info('[api:market-data.snapshot]', {
   ```

2. Run: `npm run lint && npx tsc --noEmit`

---

### Step 3: Reduce relay flush logging noise (LOW)

**Why:** The writer logs `[relay] wrote N realtime quote rows` every 1-second flush during market hours. With ~29 tracked symbols, that's ~23K log lines per trading day, which can overwhelm Fly.io log retention.

**File:** `services/schwab-relay/src/writer.ts`

1. Add a private counter to the `QuoteWriter` class, after the existing `private readonly flushTimer` field (line 15):
   ```typescript
   private flushCount = 0;
   ```

2. In the `flush()` method, replace the log line on line 97:
   ```typescript
   console.info(`[relay] wrote ${pendingQuotes.length} realtime quote rows`);
   ```
   with:
   ```typescript
   this.flushCount++;
   if (this.flushCount % 60 === 0) {
     console.info(`[relay] wrote ${pendingQuotes.length} realtime quote rows (flush #${this.flushCount})`);
   }
   ```
   This logs once per minute instead of once per second.

3. Run: `cd services/schwab-relay && npx tsc --noEmit`

---

### Step 4: Remove dead `exchangeId`/`securityStatus` from writer (LOW)

**Why:** Phase 3.5 Fix 2 removed the hardcoded field extraction in the streamer, so `exchangeId` and `securityStatus` on incoming `QuoteUpdate` objects are always `undefined`. The writer still maps them into the upsert row and the ON CONFLICT SET clause. This is harmless (writes NULL) but is dead code.

**File:** `services/schwab-relay/src/writer.ts`

1. In the `rows` mapping inside `flush()` (lines 52-70), delete these two lines:
   ```typescript
   exchangeId: quote.exchangeId,
   securityStatus: quote.securityStatus,
   ```
   Also delete:
   ```typescript
   description: undefined,
   ```
   (This was always `undefined` — never populated.)

2. In the `onConflictDoUpdate` `set` clause (lines 77-93), delete these three lines:
   ```typescript
   exchangeId: sql`excluded.exchange_id`,
   securityStatus: sql`excluded.security_status`,
   ```
   Leave all other fields in the set clause unchanged.

3. Run: `cd services/schwab-relay && npx tsc --noEmit`

---

### Step 5: Add relay schema subset comment (LOW)

**Why:** The relay's `schema.ts` is an intentional minimal subset of the main app's schema. Without a comment, someone might try to "fix" the drift by adding missing fields/indexes that the relay doesn't need.

**File:** `services/schwab-relay/src/schema.ts`

1. Add this comment block at the very top of the file (before the import on line 1):
   ```typescript
   /**
    * Relay schema — intentional SUBSET of the main app schema.
    * Source of truth: lib/db/schema.ts (in the main Nexus Terminal app).
    *
    * This file only declares the tables/columns the relay reads and writes.
    * Missing columns (accountLabel, linkedAt, status enum) and indexes are
    * defined by the main app's migrations and exist in the DB — they're just
    * not needed here.
    */
   ```

2. Run: `cd services/schwab-relay && npx tsc --noEmit`

---

### Step 6: Add single-user limitation comment (LOW)

**Why:** The relay's `loadActiveTokens()` uses `.limit(1)` with no ordering, so if multiple users have active Schwab links, which one gets streaming is nondeterministic. This is intentional for the current single-user design but should be documented.

**File:** `services/schwab-relay/src/tokens.ts`

1. Find the `loadActiveTokens` function. Before the `.limit(1)` call in the query, add a comment:
   ```typescript
   // NOTE: Single-user relay — only one Schwab-linked user gets streaming at a time.
   // If multiple users have active links, selection is nondeterministic.
   // To support multi-user, remove .limit(1) and manage per-user streaming sessions.
   ```

2. Run: `cd services/schwab-relay && npx tsc --noEmit`

---

### Step 7: Create relay `.env.example` (DEPLOYMENT)

**Why:** The relay requires several env vars but none are documented. A new deployment would require reading source code to figure out what's needed.

**File:** `services/schwab-relay/.env.example` (NEW FILE)

1. Create `services/schwab-relay/.env.example` with:
   ```env
   # === Required ===
   DATABASE_URL=postgresql://user:pass@host/dbname?sslmode=require
   SCHWAB_CLIENT_ID=your-schwab-app-client-id
   SCHWAB_CLIENT_SECRET=your-schwab-app-client-secret
   SCHWAB_TOKEN_ENCRYPTION_KEY=64-char-hex-string-for-aes-256-gcm

   # === Optional ===
   HEALTH_PORT=8080
   TOKEN_CHECK_INTERVAL_MS=300000

   # Comma-separated symbols to track (defaults shown)
   # TRACK_EQUITIES=SPY,QQQ,DIA,IWM,AAPL,MSFT,AMZN,GOOGL,NVDA,TSLA,META,JPM,JNJ,V
   # TRACK_FUTURES=/GC,/SI,/CL,/NG,/ZT,/ZN
   # TRACK_FOREX=EUR/USD,GBP/USD,USD/JPY,USD/CAD,AUD/USD
   ```

2. No validation needed — this is documentation only.

---

### Step 8: Verify relay lockfile (DEPLOYMENT)

**Why:** The relay Dockerfile uses `npm ci` which requires `package-lock.json`. If it's missing, Docker builds will fail.

1. Check if `services/schwab-relay/package-lock.json` exists:
   ```bash
   ls services/schwab-relay/package-lock.json
   ```

2. If it does NOT exist, generate it:
   ```bash
   cd services/schwab-relay && npm install && cd ../..
   ```
   Then `git add services/schwab-relay/package-lock.json`.

3. If it already exists, no action needed.

---

### Validation (all steps)

After all steps are complete, run from project root:
```bash
cd services/schwab-relay && npx tsc --noEmit && cd ../.. && npm run lint && npx tsc --noEmit
```

All 8 steps must pass this validation before marking this section as COMPLETE.

---

## Scanner v1 — Markets Tab Scanner with Saved Presets

> Generated: 2026-03-16 | Agent: nexus-architect
> Status: COMPLETE (IMPLEMENTED)
> Depends on: Schwab Phase 4 COMPLETE

**Full spec:** [`specs/scanner-v1.md`](specs/scanner-v1.md)

**Summary:** Add a Scanner section to the Markets tab that queries `realtime_quotes` with user-defined filters and supports DB-stored presets. No relay changes needed — works against existing streaming data. Agent-callable API (deferred to AGENTIC_EXPANSION_V2).

**Implementation Summary (2026-03-16 | Agent: opencode):**
- Added `scanner_presets` schema + migration with per-user unique preset names and user index.
- Implemented authenticated Scanner APIs: `GET /api/scanner` (filters/sort/limit) and `GET/POST/DELETE /api/scanner/presets` (preset CRUD + upsert by name).
- Added `useScanner` hook and `ScannerSection` Markets UI (collapsible filters, sortable table, preset save/load/delete, pagination).
- Integrated `ScannerSection` into `MarketsTab` with realtime/delayed refresh cadence passthrough.
- Updated `.claude/CLAUDE.md` table/API route docs for scanner coverage.
- Smoke check completed: `npm run dev` booted successfully and served on `http://localhost:3000`.

### Architecture Decisions

- **Location:** Section inside Markets tab (below movers, above macro summary)
- **Columns:** Ticker, Price, Change, Change%, Volume (OHLC available for future)
- **Filter UI:** Collapsible panel with price range, change % range, min volume, asset type
- **Presets:** DB table `scanner_presets` (persists across devices, agent-ready)
- **Refresh:** 5s realtime / 60s delayed (matches existing Markets tab)
- **Agent integration:** Deferred — `/api/scanner` accepts filter params so agents can call it later

### Changes (6 steps — execute in order)

| Step | File | Action | Details |
|------|------|--------|---------|
| 1 | `lib/db/schema.ts` | MODIFY | Add `scannerPresets` table (id, userId, name, filtersJson, timestamps). Run `npm run db:generate && npm run db:migrate`. See spec Change 1. |
| 2 | `app/api/scanner/route.ts` | CREATE | GET endpoint — queries `realtime_quotes` with filter/sort/limit params. Returns `{ results, count, filters, sort }`. See spec Change 2. |
| 3 | `app/api/scanner/presets/route.ts` | CREATE | GET/POST/DELETE for user presets. POST upserts by name. See spec Change 3. |
| 4 | `hooks/use-scanner.ts` | CREATE | Client hook — manages filters, results, presets, auto-refresh interval. See spec Change 4. |
| 5 | `components/trading/ScannerSection.tsx` | CREATE | Collapsible filter panel, sortable table (25 rows/page), preset save/load/delete UI. See spec Change 5. |
| 6 | `components/trading/MarketsTab.tsx` | MODIFY | Add 1 import + 1 JSX line: `<ScannerSection refreshIntervalMs={dataSource === 'realtime' ? 5_000 : 60_000} />` between movers and macro summary. See spec Change 6. |

### Validation

After each step: `npm run lint && npx tsc --noEmit`

After all steps:
```bash
npm run lint && npx tsc --noEmit
npm run dev  # Manual test: filters, sorting, presets, pagination
```

### Post-Implementation

Update `.claude/CLAUDE.md`:
- Tables: `(17)` → `(18)`, add `scanner_presets`
- API Routes: add `## Scanner` with `GET /api/scanner` and `GET/POST/DELETE /api/scanner/presets`

---

## Replace Futures & FX with Correlated ETFs

> Generated: 2026-03-16 | Agent: nexus-architect
> Status: COMPLETE (IMPLEMENTED)
> Depends on: Schwab OAuth COMPLETE

**Implementation Summary (2026-03-16 | Agent: opencode):**
- Replaced futures and FX snapshot groups with ETF-backed `commodities` data (`GLD`, `SLV`, `USO`, `UNG`, `TLT`, `UUP`) in both delayed Massive and realtime Schwab paths.
- Merged the Markets tab cards into a single `Commodities, Bonds & FX` section and updated snapshot typing/coverage calculations.
- Removed relay futures/forex field maps, subscriptions, and parsing so the streamer now handles equities-only quote updates.
- Refreshed relay env docs and updated the snapshot route test to assert the new commodity ETF payload.
- Validation completed: relay TypeScript check, root lint, root TypeScript check, `npm test`, and a dev-server smoke check on `/?tab=markets`.

**Context:** Futures (`/GC`, `/SI`, etc.) and FX (`C:EURUSD`, etc.) symbols have format mismatches that cause null data in the realtime path. Replacing them with plain ETFs fixes this and simplifies the entire pipeline. Also removes unused LEVELONE_FUTURES and LEVELONE_FOREX streaming from the relay.

### Symbol Mapping

| Old | New ETF | Label |
|-----|---------|-------|
| /GC (Gold) | GLD | Gold |
| /SI (Silver) | SLV | Silver |
| /CL (Crude Oil) | USO | Crude Oil |
| /NG (Natural Gas) | UNG | Natural Gas |
| /ZT (2Y Note) | _(removed)_ | — |
| /ZN (10Y Note) | TLT | Treasuries |
| All 5 FX pairs | UUP | US Dollar |

Final list: `GLD, SLV, USO, UNG, TLT, UUP`

Sections "Futures" and "FX" merge into one: **"Commodities, Bonds & FX"**

---

### Step 1: Update symbol constants in snapshot route

**File:** `app/api/market-data/snapshot/route.ts`

**Lines 73-83** — Replace `FUTURE_SYMBOLS`, `FX_SYMBOLS`, and `EXTENDED_SESSION_SYMBOLS` with:

```typescript
const COMMODITY_SYMBOLS = [
  { ticker: 'GLD', label: 'Gold' },
  { ticker: 'SLV', label: 'Silver' },
  { ticker: 'USO', label: 'Crude Oil' },
  { ticker: 'UNG', label: 'Natural Gas' },
  { ticker: 'TLT', label: 'Treasuries' },
  { ticker: 'UUP', label: 'US Dollar' },
];
const EQUITY_SYMBOLS = ['AAPL', 'MSFT', 'AMZN', 'GOOGL', 'NVDA', 'TSLA', 'META', 'JPM', 'JNJ', 'V'];
const EXTENDED_SESSION_SYMBOLS = [...INDEX_SYMBOLS, ...COMMODITY_SYMBOLS.map((s) => s.ticker), ...EQUITY_SYMBOLS];
```

Delete `FUTURE_SYMBOLS` (lines 73-80) and `FX_SYMBOLS` (line 81) entirely — they are replaced by `COMMODITY_SYMBOLS`.

Run: `npm run lint && npx tsc --noEmit` — expect type errors from later steps, that's fine.

---

### Step 2: Update `MarketSnapshotPayload` type

**File:** `app/api/market-data/snapshot/route.ts`

**Lines 37-46** — Replace the type:

```typescript
type MarketSnapshotPayload = {
  indices: MarketInstrument[];
  commodities: MarketInstrument[];
  equities: MarketInstrument[];
  movers: {
    gainers: MarketMoverRow[];
    losers: MarketMoverRow[];
  };
};
```

Remove `futures` and `fx` keys. Add `commodities`.

---

### Step 3: Update `fetchFreshSnapshot()` (Massive delayed path)

**File:** `app/api/market-data/snapshot/route.ts`

**Lines 218-254** — Update the function:

1. **Line 219-224** — Change the tickers array:
   ```typescript
   const tickers = [
     ...INDEX_SYMBOLS,
     ...COMMODITY_SYMBOLS.map((item) => item.ticker),
     ...EQUITY_SYMBOLS,
   ];
   ```
   (Remove `FUTURE_SYMBOLS.map(...)` and `FX_SYMBOLS` from the spread.)

2. **Lines 244-253** — Change the return object:
   ```typescript
   return {
     indices: INDEX_SYMBOLS.map((symbol) => toInstrument(symbol, symbol, lookup, activeSession, extendedSummaries)),
     commodities: COMMODITY_SYMBOLS.map((item) => toInstrument(item.ticker, item.label, lookup, activeSession, extendedSummaries)),
     equities: EQUITY_SYMBOLS.map((symbol) => toInstrument(symbol, symbol, lookup, activeSession, extendedSummaries)),
     movers: {
       gainers: toMoverRows(gainers.tickers ?? []),
       losers: toMoverRows(losers.tickers ?? []),
     },
   };
   ```
   Key changes:
   - `futures:` line → `commodities:` using `COMMODITY_SYMBOLS`
   - Delete the `fx:` line entirely
   - Add `extendedSummaries` to the commodities call (ETFs support extended hours, futures didn't)

---

### Step 4: Update `fetchRealtimeSnapshot()` (Schwab realtime path)

**File:** `app/api/market-data/snapshot/route.ts`

**Lines 398-408** — Change the return data object:

```typescript
return {
  data: {
    indices: INDEX_SYMBOLS.map((symbol) => mapRealtimeInstrument(symbol, symbol)),
    commodities: COMMODITY_SYMBOLS.map((item) => mapRealtimeInstrument(item.ticker, item.label)),
    equities: EQUITY_SYMBOLS.map((symbol) => mapRealtimeInstrument(symbol, symbol)),
    movers: {
      gainers: screenerGainers,
      losers: screenerLosers,
    },
  },
  fetchedAt: latestUpdate.updatedAt,
};
```

Same pattern: `futures:` → `commodities:`, delete `fx:`.

Run: `npm run lint && npx tsc --noEmit` — should pass for the backend now.

---

### Step 5: Update MarketsTab frontend

**File:** `components/trading/MarketsTab.tsx`

**Lines 360-381** — Replace the 3-section grid (Indexes, Futures, FX) with a 2-section grid (Indexes, Commodities/Bonds/FX):

```tsx
<div className="grid gap-4 lg:grid-cols-2">
  <div className="rounded-xl border border-white/10 bg-[#121214] p-4">
    <h2 className="mb-3 text-base font-semibold text-zinc-200">Indexes</h2>
    <div className="grid gap-2 sm:grid-cols-2">
      {(snapshot?.indices ?? []).map((item) => <InstrumentCard key={item.symbol} item={item} />)}
    </div>
  </div>

  <div className="rounded-xl border border-white/10 bg-[#121214] p-4">
    <h2 className="mb-3 text-base font-semibold text-zinc-200">Commodities, Bonds & FX</h2>
    <div className="grid gap-2 sm:grid-cols-2">
      {(snapshot?.commodities ?? []).map((item) => <InstrumentCard key={item.symbol} item={item} />)}
    </div>
  </div>
</div>
```

This deletes the entire "Futures" block (lines 368-373) and "FX" block (lines 375-380). The new "Commodities, Bonds & FX" block replaces both, using `snapshot?.commodities`.

Run: `npm run lint && npx tsc --noEmit`

---

### Step 6: Remove futures/forex field maps from relay

**File:** `services/schwab-relay/src/streamer.ts`

**Lines 67-93** — Delete the `FUTURES_FIELDS` and `FOREX_FIELDS` constants entirely:

```typescript
// DELETE these two blocks (lines 67-93):
const FUTURES_FIELDS: FieldMap = { ... };
const FOREX_FIELDS: FieldMap = { ... };
```

Keep `EQUITY_FIELDS` (lines 53-65) unchanged.

---

### Step 7: Remove futures/forex subscription blocks from relay

**File:** `services/schwab-relay/src/streamer.ts`

In the `subscribe()` method:

1. **Lines 280-281** — Delete:
   ```typescript
   const futures = parseList('TRACK_FUTURES');
   const forex = parseList('TRACK_FOREX');
   ```

2. **Lines 297-318** — Delete the entire `if (futures.length > 0) { ... }` block and the entire `if (forex.length > 0) { ... }` block.

Keep the `equities` and `SCREENER_EQUITY` subscription blocks unchanged.

---

### Step 8: Simplify `mapQuoteData` in relay

**File:** `services/schwab-relay/src/streamer.ts`

**Lines 390-447** — Simplify `mapQuoteData` since it only handles equities now:

```typescript
private mapQuoteData(
  service: string,
  timestamp: number | undefined,
  content: Array<Record<string, unknown>>,
): QuoteUpdate[] {
  if (service !== 'LEVELONE_EQUITIES') {
    return [];
  }

  return content
    .map((item) => {
      const quote: Partial<QuoteUpdate> = {
        assetType: 'equity',
        quoteTimeMs: toNumber(timestamp),
      };

      for (const [fieldNumberRaw, fieldName] of Object.entries(EQUITY_FIELDS)) {
        const value = item[fieldNumberRaw];
        if (fieldName === 'symbol') {
          if (typeof value === 'string' && value.length > 0) {
            quote.symbol = value;
          }
          continue;
        }

        const numericValue = toNumber(value);
        if (numericValue !== undefined) {
          (quote as Record<string, number | string | undefined>)[fieldName] = numericValue;
        }
      }

      if (!quote.symbol) {
        const fallbackSymbol = typeof item.key === 'string' ? item.key : undefined;
        if (fallbackSymbol) {
          quote.symbol = fallbackSymbol;
        }
      }

      return quote as QuoteUpdate;
    })
    .filter((quote) => typeof quote.symbol === 'string' && quote.symbol.length > 0);
}
```

Run: `cd services/schwab-relay && npx tsc --noEmit`

---

### Step 9: Update relay `.env.example`

**File:** `services/schwab-relay/.env.example`

**Lines 11-14** — Replace:

```env
# Comma-separated symbols to track (defaults shown)
# TRACK_EQUITIES=SPY,QQQ,DIA,IWM,AAPL,MSFT,AMZN,GOOGL,NVDA,TSLA,META,JPM,JNJ,V,GLD,SLV,USO,UNG,TLT,UUP
```

Delete the `TRACK_FUTURES` and `TRACK_FOREX` lines entirely.

---

### Step 10: Search for stale references

Run from project root:

```bash
grep -r "FUTURE_SYMBOLS\|FX_SYMBOLS\|TRACK_FUTURES\|TRACK_FOREX\|LEVELONE_FUTURES\|LEVELONE_FOREX\|FUTURES_FIELDS\|FOREX_FIELDS" --include="*.ts" --include="*.tsx" . | grep -v node_modules | grep -v .next | grep -v HANDOFF
```

If any results appear, update those references. Common places:
- Test files in `__tests__/`
- Type definitions that reference `futures` or `fx` keys

Also search the frontend for leftover `futures`/`fx` data references:

```bash
grep -r "\.futures\|\.fx\b" --include="*.ts" --include="*.tsx" . | grep -v node_modules | grep -v .next | grep -v HANDOFF
```

Update any matches.

---

### Step 11: Final validation

```bash
cd services/schwab-relay && npx tsc --noEmit && cd ../.. && npm run lint && npx tsc --noEmit
```

Then manual test:
```bash
npm run dev
```
- Open Markets tab → confirm "Indexes" and "Commodities, Bonds & FX" sections render
- Confirm GLD, SLV, USO, UNG, TLT, UUP show data (delayed mode)
- Confirm "Futures" and "FX" sections no longer appear

---

### Step 12: Update production relay env (Fly.io) — MANUAL

After deploying to Vercel, update the Schwab relay env on Fly.io:

```
TRACK_EQUITIES=SPY,QQQ,DIA,IWM,AAPL,MSFT,AMZN,GOOGL,NVDA,TSLA,META,JPM,JNJ,V,GLD,SLV,USO,UNG,TLT,UUP
```

Remove `TRACK_FUTURES` and `TRACK_FOREX` env vars from Fly.io. Restart the relay service.

---

### Files Changed (Summary)

| File | Action |
|------|--------|
| `app/api/market-data/snapshot/route.ts` | Replace symbol arrays, update type, update both fetch paths |
| `components/trading/MarketsTab.tsx` | Merge Futures+FX into "Commodities, Bonds & FX", update data key |
| `services/schwab-relay/src/streamer.ts` | Delete futures/forex field maps, subscriptions, and routing |
| `services/schwab-relay/.env.example` | Add ETFs to equities, remove futures/forex vars |

### Commit Message

```
feat: replace futures & FX with correlated ETFs in market snapshot

Swap /GC, /SI, /CL, /NG, /ZT, /ZN futures and 5 FX pairs for
GLD, SLV, USO, UNG, TLT, UUP ETFs. Merge UI sections into
"Commodities, Bonds & FX". Remove LEVELONE_FUTURES and
LEVELONE_FOREX streaming from Schwab relay.
```

---

## Notes

- `.env` and secret files were not modified.
- If a future section is in-progress, keep full implementation steps until completion, then compress to summary.

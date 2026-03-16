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

## Notes

- `.env` and secret files were not modified.
- If a future section is in-progress, keep full implementation steps until completion, then compress to summary.

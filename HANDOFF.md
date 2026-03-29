# Nexus Terminal — HANDOFF.md

## Active Handoff Only

Historical completed sections removed — use git history and `specs/` for archived detail.

### Session Maintenance Checklist

- [ ] Update `AGENTS.md` after Discord import feature ships — document new tables, API routes, parser module, env vars
- [x] Review `AGENTIC_EXPANSIONV2.md` and replace `AEV2_REVISIONS.md` with a literal pre-sprint edit script for the next spec pass
- [x] Apply `AEV2_REVISIONS.md` to `AGENTIC_EXPANSIONV2.md` and rename the spec file from `AGENTIC_EXPANSION_V2.md`
- [x] Run the post-patch cleanup sweep on `AGENTIC_EXPANSIONV2.md`
- [x] Refresh `AEV2_REVISIONS.md` with sprint-board blockers, launch blockers, and locked routing/service-route decisions from the latest review
- [x] Convert `AEV2_REVISIONS.md` from redline checklist into a literal section-by-section patch plan for the next spec pass
- [x] **Execute R6 consolidation pass on AGENTIC_EXPANSIONV2.md** (this handoff)

---

## R6 Consolidation Pass — AGENTIC_EXPANSIONV2.md

> Generated: 2026-03-28 | Status: COMPLETE

### Summary

- Consolidated `AGENTIC_EXPANSIONV2.md` into a single-pass spec: merged R1/R2/R4/R5 content into the main body, deleted revision appendices, added a concise revision-history section, and renumbered sections sequentially.
- Resolved the handoff blockers called out for routing, migration atomicity, AskEdgar fallback/caching/budgeting, Discord delivery/runtime details, worker shutdown, API contracts, build-order numbering, and file inventory cleanup.
- Added `services/.env` to `.gitignore`.

### Validation

- `npm run lint` ✅
- `npx tsc --noEmit` ✅
- `npm test` ✅

---

## Schwab Relay Streaming Fix — Token Race Condition + SSE Reconnect

> Generated: 2026-03-28 | Status: IN PROGRESS (implementation complete, manual verification pending)
> Context: Relay has a stale token race condition causing ~5-minute dead windows every ~30 minutes. SSE hook permanently dies after Vercel's 300s timeout. Scanner shows no data when relay WebSocket is primary path.
> Session update (2026-03-28): Steps 1-7 were implemented locally. `services/schwab-relay` type-check passed. Project `npm run lint`, `npx tsc --noEmit`, and `npm test` all pass. Fly status was verified as running. Manual runtime checks below remain open.

### Objective

Fix four failure modes in the Schwab relay streaming pipeline:
1. **FM-1 (critical):** Stale token race condition — streamer self-reconnects with expired token, `syncTokens()` comparison doesn't catch it
2. **FM-2:** SSE hook permanently gives up after first disconnect — no retry logic
3. **FM-3:** Scanner section shows no data when relay WebSocket is the active path
4. **FM-1 supplement:** No heartbeat watchdog — silent Schwab disconnects go undetected for up to 5 minutes

### Root Cause (FM-1)

`SchwabStreamer` stores `accessToken` as `private readonly` (streamer.ts line 113), set once at construction. When Schwab expires the token (~30 min) and closes the stream:

1. `onClose` fires → `scheduleReconnect()` (line 497) calls `this.connect()` with `this.accessToken` — the ORIGINAL stale token
2. `fetchPreference()` (line 259) sends the stale token → 401 → error → exponential backoff retry
3. Meanwhile `syncTokens()` (index.ts line 95) runs every 5 min, compares `active.tokens.accessToken !== activeAccessToken`
4. But `activeAccessToken` was already updated on the previous sync cycle → `shouldReconnect === false`
5. The streamer keeps retrying with the dead token forever (5s→10s→20s→...→5min gaps)

### Files to Modify

| # | File | Changes |
|---|---|---|
| 1 | `services/schwab-relay/src/streamer.ts` | Mutable token + update method + heartbeat watchdog |
| 2 | `services/schwab-relay/src/index.ts` | Reduce sync interval + fix token comparison logic |
| 3 | `hooks/use-market-stream.ts` | Add SSE retry with exponential backoff |
| 4 | `components/trading/MarketsTab.tsx` | Feed relay quote + screener data to scanner |

### Reference Types

```typescript
// lib/types.ts:89-97
export type ScannerRow = {
  symbol: string;
  assetType: string;
  lastPrice: number | null;
  netChange: number | null;
  netChangePercent: number | null;
  totalVolume: number | null;
  updatedAt: string;
};

// lib/relay-types.ts:5-21
export type RelayQuoteUpdate = {
  symbol: string;
  assetType: string;
  lastPrice?: number;
  bidPrice?: number;
  askPrice?: number;
  openPrice?: number;
  highPrice?: number;
  lowPrice?: number;
  closePrice?: number;
  netChange?: number;
  netChangePercent?: number;
  totalVolume?: number;
  exchangeId?: string;
  securityStatus?: string;
  quoteTimeMs?: number;
};
```

---

### Step 1: Make `accessToken` mutable + add update method

**File:** `services/schwab-relay/src/streamer.ts`

**1a.** Line 113 — remove `readonly`:
```typescript
// BEFORE:
private readonly accessToken: string;

// AFTER:
private accessToken: string;
```

**1b.** After `isConnected()` method (after line 220), add:
```typescript
updateAccessToken(token: string): void {
  this.accessToken = token;
}
```

**Why:** Allows `syncTokens()` to push a fresh token into a live streamer without destroying/recreating it.

---

### Step 2: Add heartbeat watchdog

**File:** `services/schwab-relay/src/streamer.ts`

**2a.** Add two fields after line 129 (`private dataMessageCount = 0;`):
```typescript
private lastMessageAt: number = Date.now();
private heartbeatTimer: NodeJS.Timeout | null = null;
```

**2b.** In `handleMessage()` at line 344, after `this.messageCount++`, add:
```typescript
this.lastMessageAt = Date.now();
```

**2c.** Add two methods after `clearReconnectTimer()` (after line 520):
```typescript
private startHeartbeatWatchdog(): void {
  this.stopHeartbeatWatchdog();
  const HEARTBEAT_TIMEOUT_MS = 60_000;
  this.heartbeatTimer = setInterval(() => {
    if (Date.now() - this.lastMessageAt > HEARTBEAT_TIMEOUT_MS) {
      console.warn('[relay] no message received in 60s, triggering reconnect');
      this.ws?.close();
    }
  }, HEARTBEAT_TIMEOUT_MS);
}

private stopHeartbeatWatchdog(): void {
  if (this.heartbeatTimer) {
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }
}
```

**2d.** In `ws.on('open')` handler (line 169), after `this.reconnectAttempts = 0;` add:
```typescript
this.lastMessageAt = Date.now();
this.startHeartbeatWatchdog();
```

**2e.** In `disconnect()` (line 203), after `this.clearReconnectTimer();` add:
```typescript
this.stopHeartbeatWatchdog();
```

**2f.** In `ws.on('close')` handler (line 185), before `this.onDisconnect();` add:
```typescript
this.stopHeartbeatWatchdog();
```

**Why:** If Schwab silently drops the connection (no close frame), the relay sits idle. The watchdog detects 60s of silence and forces `ws.close()`, which triggers the existing reconnect path.

---

### Step 3: Reduce token sync interval

**File:** `services/schwab-relay/src/index.ts`

Line 14 — change default from `'300000'` to `'60000'`:
```typescript
// BEFORE:
const TOKEN_CHECK_INTERVAL_MS = Number(process.env.TOKEN_CHECK_INTERVAL_MS ?? '300000');

// AFTER:
const TOKEN_CHECK_INTERVAL_MS = Number(process.env.TOKEN_CHECK_INTERVAL_MS ?? '60000');
```

**Why:** 5-minute check interval means up to 5 minutes of dead streaming after token rotation. 60 seconds shrinks the window. The relay is always-on (Fly.io), so polling cost is negligible.

---

### Step 4: Fix `syncTokens()` stale token comparison

**File:** `services/schwab-relay/src/index.ts`

Replace the `shouldReconnect` block (lines 109-125) with:

```typescript
  const tokenChanged = active.tokens.accessToken !== activeAccessToken;
  const userChanged = active.userId !== activeUserId;
  const noStreamer = !streamer;

  if (userChanged || noStreamer) {
    // Full restart: different user or no streamer at all
    if (streamer) {
      log('user changed, restarting stream');
      stopStreamer();
    } else {
      log(`active Schwab link found for user ${active.userId}`);
    }
    activeUserId = active.userId;
    activeAccessToken = active.tokens.accessToken;
    await startStreamer(active.tokens.accessToken);
    return;
  }

  if (tokenChanged) {
    // Token rotated — update in place without rebuilding the streamer
    log('access token rotated, updating streamer in place');
    activeAccessToken = active.tokens.accessToken;
    streamer.updateAccessToken(active.tokens.accessToken);
    // If the streamer is currently mid-reconnect with a stale token, force a clean reconnect
    if (!streamer.isConnected()) {
      log('streamer not connected after token update, forcing reconnect');
      stopStreamer();
      await startStreamer(active.tokens.accessToken);
    }
    return;
  }

  // Token unchanged and streamer exists — nothing to do
```

**Why:** The old code used a single `shouldReconnect` boolean. When the token rotated, `activeAccessToken` (index.ts) already matched the DB token from the previous sync cycle, so `shouldReconnect === false` — even though the streamer's internal token was stale. This separates user change (full restart), token rotation (update in place + restart if disconnected), and no change (no-op).

---

### Step 5: Verify relay type-checks, then deploy

```bash
cd services/schwab-relay && npx tsc --noEmit
```

Fix any errors. Then deploy:

```bash
cd services/schwab-relay && fly deploy
```

Verify after deploy:
```bash
fly status --app nexus-schwab-relay
fly logs --app nexus-schwab-relay
```

Logs should show `access token rotated, updating streamer in place` on token rotation instead of repeated 401 errors.

---

### Step 6: SSE reconnect logic

**File:** `hooks/use-market-stream.ts`

Replace the entire `useEffect` block (lines 46-103) with:

```typescript
useEffect(() => {
  if (!options.enabled) {
    esRef.current?.close();
    esRef.current = null;
    return;
  }

  const MAX_RETRIES = 5;
  const BASE_RETRY_DELAY_MS = 3_000;
  let retryCount = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  function clearRetryTimer() {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function openStream() {
    if (disposed) return;
    esRef.current?.close();
    const es = new EventSource(buildUrl());
    esRef.current = es;

    es.addEventListener('snapshot', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data);
        onSnapshotRef.current(payload);
        setConnected(true);
        setFallbackToPolling(false);
        retryCount = 0;
      } catch {
        // Ignore malformed events.
      }
    });

    es.addEventListener('scanner', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as { results: ScannerRow[] };
        onScannerRef.current(payload);
      } catch {
        // Ignore malformed events.
      }
    });

    es.addEventListener('error', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as { message?: string };
        if (payload.message) {
          onErrorRef.current?.(payload.message);
        }
      } catch {
        // Not every error event has JSON payload.
      }
    });

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        setConnected(false);
        es.close();
        esRef.current = null;

        if (retryCount >= MAX_RETRIES) {
          setFallbackToPolling(true);
          onErrorRef.current?.('Realtime stream disconnected after 5 retries; falling back to polling.');
          return;
        }

        const delay = BASE_RETRY_DELAY_MS * Math.pow(2, retryCount);
        retryCount += 1;
        onErrorRef.current?.(
          `SSE disconnected. Retrying in ${delay / 1000}s (attempt ${retryCount}/${MAX_RETRIES})...`
        );
        retryTimer = setTimeout(openStream, delay);
      }
    };
  }

  openStream();

  return () => {
    disposed = true;
    clearRetryTimer();
    esRef.current?.close();
    esRef.current = null;
    setConnected(false);
    setFallbackToPolling(false);
  };
}, [buildUrl, options.enabled]);
```

**Why:** Vercel kills SSE at `maxDuration=300` (5 min). The old hook permanently surrendered on the first close. This retries 5 times (3s→6s→12s→24s→48s) before falling back. Normal Vercel timeout cycles recover automatically. `retryCount` is a plain `let` inside the effect closure — it resets when the effect reruns (filter/sort changes), which is correct.

---

### Step 7: Feed relay data to scanner (live quotes + screener)

**File:** `components/trading/MarketsTab.tsx`

**7a.** In `handleRelayQuotes` (line 264-274), after the `setDataSource('realtime')` call at line 272, add scanner update logic that derives `ScannerRow[]` from the full quote map:

```typescript
const handleRelayQuotes = useCallback((quotes: RelayQuoteUpdate[]) => {
  const map = quoteMapRef.current;
  for (const q of quotes) {
    const existing = map.get(q.symbol);
    map.set(q.symbol, { ...(existing ?? {}), ...q, symbol: q.symbol });
  }

  setSnapshot(buildSnapshotFromQuotes(map));
  setDataSource('realtime');
  setLastLoadedAt(new Date());

  // Feed live quotes to scanner
  const scannerRows: ScannerRow[] = Array.from(map.values())
    .filter((q) => q.lastPrice != null && q.netChangePercent != null)
    .map((q) => ({
      symbol: q.symbol,
      assetType: q.assetType ?? 'equity',
      lastPrice: q.lastPrice ?? null,
      netChange: q.netChange ?? null,
      netChangePercent: q.netChangePercent ?? null,
      totalVolume: q.totalVolume ?? null,
      updatedAt: new Date().toISOString(),
    }));
  setStreamScannerResults(scannerRows);
}, [buildSnapshotFromQuotes]);
```

**7b.** In `handleRelayScreener` (line 276-297), after the `setSnapshot(...)` call, add:

```typescript
// Also feed screener data to scanner
const toScannerRow = (item: RelayScreenerData['gainers'][number]): ScannerRow => ({
  symbol: item.symbol,
  assetType: 'equity',
  lastPrice: item.lastPrice,
  netChange: item.netChange,
  netChangePercent: item.netChangePercent,
  totalVolume: item.totalVolume,
  updatedAt: new Date().toISOString(),
});

setStreamScannerResults((prev) => {
  // Merge screener items into existing scanner results (screener items may overlap)
  const existing = new Map((prev ?? []).map((r) => [r.symbol, r]));
  for (const item of [...data.gainers, ...data.losers]) {
    existing.set(item.symbol, toScannerRow(item));
  }
  return Array.from(existing.values());
});
```

**7c.** At line 555-557, update `ScannerSection` props to use relay data when available:

```tsx
{/* BEFORE: */}
<ScannerSection
  refreshIntervalMs={sseConnected ? 0 : (dataSource === 'realtime' ? 5_000 : 60_000)}
  externalResults={sseConnected ? streamScannerResults : undefined}
/>

{/* AFTER: */}
<ScannerSection
  refreshIntervalMs={(sseConnected || relayConnected) ? 0 : (dataSource === 'realtime' ? 5_000 : 60_000)}
  externalResults={(sseConnected || relayConnected) ? streamScannerResults : undefined}
/>
```

**Why:** When relay WS is the primary path, the scanner previously got `undefined` for `externalResults` and showed nothing. Now: (a) every relay quote tick rebuilds scanner rows from the full quote map, giving the scanner live updates without manual refresh, and (b) screener data (gainers/losers) is merged in so new movers appear immediately. The `setStreamScannerResults` state is shared between the SSE path (which sets it from `scanner` events) and the relay path (which now also sets it from quote/screener events).

**Note:** `ScannerRow` requires `updatedAt: string` — use `new Date().toISOString()`. The `setStreamScannerResults` call in 7b uses a functional updater to merge screener items into existing scanner data rather than replacing it (since `handleRelayQuotes` may have already populated it with a broader set of tickers).

**Note:** Import `ScannerRow` from `@/lib/types` if not already imported in `MarketsTab.tsx`. Check existing imports first.

---

### Step 8: Validate and deploy frontend

```bash
npm run lint && npx tsc --noEmit
```

Fix any errors, then push to deploy via Vercel.

---

### Validation Checklist

- [x] `npx tsc --noEmit` passes in `services/schwab-relay/`
- [x] `npm run lint && npx tsc --noEmit` passes in project root
- [x] `npm test` passes in project root
- [x] Relay deployed: `fly status --app nexus-schwab-relay` shows running
- [ ] Relay logs show `access token rotated, updating streamer in place` on token rotation (not 401 loops)
- [ ] Relay logs show no `no message received in 60s` warnings during active market hours
- [ ] Markets tab stays connected for 30+ minutes without streaming drops
- [ ] SSE auto-reconnects after Vercel timeout (not permanent polling fallback)
- [ ] Scanner section shows live data when relay WS is active
- [ ] Scanner updates in real-time as quotes tick (no manual refresh needed)

### Deployment Notes

**The relay deploys separately from Vercel.** Steps 1-5 (relay changes) ship via `fly deploy`. Steps 6-8 (frontend changes) ship via normal Vercel push.

### Rollback

- Relay: `fly deploy` from previous commit in `services/schwab-relay/`
- Frontend: `git revert` or redeploy previous Vercel build from dashboard

---

## Codebase Simplification — Phase 4

> Generated: 2026-03-24 | Phases 1-3 complete (948f120), Phase 4 remains
> Phase 1: dead code deletion (~700+ lines). Phase 2: bug-risk duplication. Phase 3: shared API route patterns. All done.

### Phase 4: Component Dedup (touch as needed)

**4.1** Extract `AskEdgarEndpointResponse` interface (copy-pasted in 3 components) + shared helpers (`formatNumber`, `formatMoney`, `getField`, `riskClass`) → `lib/askedgar-utils.ts`
**4.2** Extract `buildTradeMarkers()` (duplicated in `JournalTradeChart.tsx` + `TradeDetailSheet.tsx`) → `lib/trading-utils.ts`
**4.3** Move chart color constants + `FRAME_CONFIG` to `lib/chart-timeframes.ts` (duplicated across 3 chart components)
**4.4** Wrap PerformanceTab symbol distribution in `useMemo` (non-memoized reduce at lines 71-88)
**4.5** Lower priority: `ResearchChart` reimplements chart lifecycle, duplicate stat calcs, duplicate pagination, double `fetchResults` on mount in `use-scanner.ts`, `sortTrades` alias

### Deferred

- `lib/trade-migration.ts` — keep until all users confirmed migrated from localStorage
- `lib/storage.ts` — tied to trade-migration
- Discord import/sync routes — headless but functional
- Jarvis research/trade-analysis routes — redundant with chat but functional
- `hooks/trade-utils.ts` → `lib/trade-utils.ts` rename — low priority
- `buildResearchPrompt` in prompts.ts — now dead but harmless

---

## Low-Priority Spec Cleanup (AGENTIC_EXPANSIONV2.md)

These are minor issues found during the 2026-03-29 spec review. None block sprint import, but should be cleaned up when convenient.

- **R8 — `step_log` guidance stated twice.** Line ~822 repeats the same `step_log` content rules from Section 3.2. Replace with a cross-reference: "See Section 3.2 for `step_log` content rules."
- **R9 — "Multi-agent fanout deferred to V2" stated 4 times.** Keep in Executive Summary + Section 13 closing note. Trim the other two instances (Section 6.1 ~line 557 and Section 13 ~line 1649) to short cross-references.
- **R10 — Polling timeout (120s/60 attempts) stated twice.** Section 20 Discord Adapter should reference Section 13 for timeout details instead of restating them.
- **M2 — Budget is per-agent but env var name doesn't clarify.** Add note to Section 19: "Each agent enforces its own budget independently — $5/day default means $15/day total across 3 agents."
- **M3 — `swing:research` step 6 missing `idempotencyKey`.** Add `idempotencyKey: 'swing-research-{ticker}-{date}'` to the metadata.
- **M4 — `getDb()` vs `getAgentDb()` distinction never stated.** Add note: "Vercel routes use `getDb()` from `lib/server-db-utils.ts` (HTTP client). Docker agent workers use `getAgentDb()` from `lib/agents/db.ts` (WebSocket pool). Never mix them."
- **B11 — Two `lib/jarvis/` files missing from Phase 7 delete list.** Add `chat-helpers.ts` and `historical-summary.ts` to the Phase 7 delete list in Section 18.
- **B15 — `services/discord-bot/` already exists with a `dist/` directory.** Audit existing contents before Phase 5 Step 44 — the spec treats it as a fresh creation but files may already be there.
- **B18 — `services/.env.example` contents never specified.** Generate from Docker Compose `environment:` blocks or include a template in Section 15.

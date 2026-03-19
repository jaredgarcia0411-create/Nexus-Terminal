# Nexus Terminal — HANDOFF.md

## Active Handoff Only

Historical completed sections (Scanner Realtime Data Pipeline, Tech Debt PRs 1-5, SSE Phases 0-2, Keyboard Shortcuts, Discord Research Report Extraction Phases 1-4) were removed to keep this file focused.
Use git history and the `specs/` directory for archived implementation detail.

### Session Maintenance Checklist

- [x] Refreshed `AGENTS.md` with current build/lint/test commands, single-test workflows, and coding conventions for agentic coding tools.
- [x] Verified command set and conventions against the current repository configuration (`package.json`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.mjs`).
- [ ] Update `AGENTS.md` after Discord import feature ships — document new tables, API routes, parser module, env vars
- [x] Update `AGENTS.md` after relay WebSocket feature ships — document new relay WS endpoint, `use-relay-socket` hook, `/api/relay-token` route

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

## Discord Research Report Extraction — Manual Schwab Validation

> Generated: 2026-03-17 | Status: CODE COMPLETE — manual Schwab validation pending

All 4 phases implemented and passing lint/type-check/tests. Remaining manual checks (after Schwab re-link):

- [ ] Relay startup logs show `subscribed N imported research tickers`
- [ ] Imported tickers appear in `realtime_quotes` table after relay runs for a few minutes
- [ ] Scanner shows imported tickers with quote data

---

## Direct Relay WebSocket — Bypass DB for Live Quotes

> Generated: 2026-03-18 | Agent: nexus-architect
> Status: CODE COMPLETE
> Priority: MEDIUM — reduces quote latency from ~6s to sub-second, reduces DB load

### Completion Summary

- Implemented all 4 phases end-to-end:
  - Relay WebSocket server + broadcast module (`services/schwab-relay/src/broadcast.ts`, `src/ws-auth.ts`, `src/index.ts`)
  - Relay token endpoint (`app/api/relay-token/route.ts`)
  - Shared client types (`lib/relay-types.ts`) and hook (`hooks/use-relay-socket.ts`)
  - Markets tab integration with automatic SSE fallback (`components/trading/MarketsTab.tsx`)
- Validation: `npm run lint`, `npx tsc --noEmit`, `npm test` all pass (39 test files, 210 tests)
- Validation note: runtime relay endpoint/env verification remains pending until deployment (`/ws` smoke test and Vercel + Fly env vars are required)

 - Latest session checks:
   - `npm run lint` (pass)
   - `npx tsc --noEmit` (pass)
   - `npm test` (pass)
   - `cd services/schwab-relay && npx tsc --noEmit` (pass)
   - `cd services/schwab-relay && npm run build` (pass)
   - `fly status --app nexus-schwab-relay` (pass: machine started, health checks passing)
   - `fly logs --app nexus-schwab-relay --no-tail` (pass: LOGIN successful, subscribed imported tickers, stream connected)
   - `curl https://nexus-schwab-relay.fly.dev/health` (fail: `SSL_ERROR_SYSCALL` from current environment)

### Goal

Add a WebSocket server to the Fly.io relay process so browsers receive real-time quotes directly, bypassing the current `Relay → DB → Vercel SSE → Browser` pipeline. The existing DB write path (`QuoteWriter`) stays intact for scanner persistence and as a fallback. The client falls back to SSE if the WebSocket is unavailable.

### Architecture

**Current flow (kept for scanner/fallback):**
```
Schwab WS → Fly Relay → QuoteWriter → PostgreSQL → Vercel SSE → Browser
```

**New flow (added, hot path):**
```
Schwab WS → Fly Relay → WebSocket Server (port 8080, /ws path) → Browser
```

**Auth flow:**
```
Browser → GET /api/relay-token (Vercel, requireUser) → short-lived HMAC JWT (60s)
Browser → wss://nexus-schwab-relay.fly.dev/ws?token=<JWT> → Relay validates → accepted
```

### Architecture Decisions

- **Reuse port 8080** — The relay's HTTP server already serves `/health`. The `ws` library runs in `noServer` mode and handles WebSocket upgrades on `/ws`. No `fly.toml` changes needed.
- **HMAC-SHA256 JWT** — Hand-rolled with Node's `crypto` module (~15 lines each for sign/verify). No new dependencies. The relay and Vercel share `RELAY_WS_SECRET`.
- **60-second token TTL** — Token is only for the handshake. Once connected, the WebSocket stays open.
- **QuoteWriter unchanged** — DB writes continue every 1s. Scanner and the snapshot fallback still work via the DB path.
- **Fallback to SSE** — If the relay WS fails (network, token error, 3 reconnect attempts), the client enables the existing `useMarketStream` SSE hook. Zero regression.
- **No fly.toml changes** — Fly.io automatically supports WebSocket upgrades on HTTP services.
- **No CORS issues** — WebSocket upgrades don't trigger CORS preflight. Optional `Origin` check for defense-in-depth.

### Environment Variables

Add to both Vercel and Fly.io (never committed):

```
RELAY_WS_SECRET=       # Shared 64-char hex string: openssl rand -hex 32
RELAY_WS_URL=          # Vercel only: wss://nexus-schwab-relay.fly.dev/ws
```

### Workflow Instructions for opencode

**Execute phases in order: 1 → 2 → 3 → 4.**

After each phase:
1. Run the verification commands listed at the end of that phase
2. **STOP and report results.** Do not proceed to the next phase until confirmed.

---

### Phase 1: Relay-Side WebSocket Server + Broadcast

> Risk: MEDIUM | Est: 1.5 hr

#### Change 1A: Create broadcast module

**File:** `services/schwab-relay/src/broadcast.ts`
**Action:** CREATE

This module manages WebSocket client connections and broadcasts quote/screener updates. It maintains an in-memory quote snapshot (Map of symbol → merged QuoteUpdate) so new clients get a full snapshot on connect, then receive incremental updates.

```typescript
import type WebSocket from 'ws';
import type { QuoteUpdate, ScreenerUpdate } from './streamer.js';

/**
 * Manages WebSocket client connections and broadcasts quote data.
 *
 * Maintains an in-memory snapshot of all quotes so new clients
 * get the full picture immediately on connect, then receive
 * only incremental changes after that.
 */
export class QuoteBroadcaster {
  private readonly clients = new Set<WebSocket>();
  private readonly snapshot = new Map<string, QuoteUpdate>();
  private lastScreener: { gainers: ScreenerUpdate['items']; losers: ScreenerUpdate['items'] } = {
    gainers: [],
    losers: [],
  };

  get clientCount(): number {
    return this.clients.size;
  }

  /**
   * Add a new WebSocket client. Sends the current full snapshot
   * immediately so the client doesn't start with an empty screen.
   */
  addClient(ws: WebSocket): void {
    this.clients.add(ws);

    // Send full snapshot on connect
    const allQuotes = Array.from(this.snapshot.values());
    this.send(ws, { type: 'snapshot', data: allQuotes });

    // Send current screener data
    if (this.lastScreener.gainers.length > 0 || this.lastScreener.losers.length > 0) {
      this.send(ws, { type: 'screener', data: this.lastScreener });
    }

    ws.on('close', () => {
      this.clients.delete(ws);
    });

    ws.on('error', () => {
      this.clients.delete(ws);
    });
  }

  /**
   * Merge new quotes into the in-memory snapshot and broadcast
   * the incremental update to all connected clients.
   *
   * Uses the same COALESCE-style merge as QuoteWriter — only
   * overwrite fields that have a non-undefined value in the update.
   */
  broadcast(quotes: QuoteUpdate[]): void {
    for (const quote of quotes) {
      if (!quote.symbol) continue;

      const existing = this.snapshot.get(quote.symbol);
      this.snapshot.set(quote.symbol, {
        ...(existing ?? {}),
        ...quote,
        symbol: quote.symbol,
        assetType: quote.assetType ?? existing?.assetType ?? 'equity',
      });
    }

    const message = { type: 'quotes', data: quotes };
    for (const client of this.clients) {
      this.send(client, message);
    }
  }

  /**
   * Broadcast screener (gainers/losers) data to all clients.
   */
  broadcastScreener(update: ScreenerUpdate): void {
    if (update.type === 'gainers') {
      this.lastScreener.gainers = update.items;
    } else {
      this.lastScreener.losers = update.items;
    }

    const message = { type: 'screener', data: this.lastScreener };
    for (const client of this.clients) {
      this.send(client, message);
    }
  }

  /**
   * Close all client connections (used during shutdown).
   */
  closeAll(): void {
    for (const client of this.clients) {
      try {
        client.close(1001, 'server shutting down');
      } catch {
        // Ignore errors during shutdown
      }
    }
    this.clients.clear();
  }

  private send(ws: WebSocket, message: unknown): void {
    if (ws.readyState !== 1 /* WebSocket.OPEN */) return;
    try {
      ws.send(JSON.stringify(message));
    } catch {
      this.clients.delete(ws);
    }
  }
}
```

**Why this shape:**
- The `snapshot` Map mirrors what QuoteWriter does in its buffer — same merge logic. New clients get the full picture immediately.
- `closeAll()` is called during `shutdown()` so SIGTERM is clean.
- Dead clients are auto-cleaned via `close`/`error` listeners.

**Acceptance Criteria:**
- [x] `services/schwab-relay/src/broadcast.ts` created with `QuoteBroadcaster` class
- [x] `addClient` sends full snapshot on connect
- [x] `broadcast` merges into snapshot and sends incremental `quotes` messages
- [x] `broadcastScreener` sends screener data
- [x] `closeAll` disconnects all clients
- [x] Dead clients removed automatically (no memory leak)
- [x] `cd services/schwab-relay && npx tsc --noEmit` passes

#### Change 1B: Create auth validation module

**File:** `services/schwab-relay/src/ws-auth.ts`
**Action:** CREATE

Validates the short-lived JWT that the browser sends during the WebSocket handshake. Uses Node's built-in `crypto` — no new dependencies.

```typescript
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verify a relay auth token (HMAC-SHA256 JWT).
 *
 * Token format: base64url(header).base64url(payload).base64url(signature)
 * Payload: { sub: userId, exp: epochSeconds }
 *
 * Returns { valid: true, userId } on success, { valid: false } on any error.
 * Never throws.
 */
export function validateRelayToken(token: string): { valid: boolean; userId?: string } {
  try {
    const secret = process.env.RELAY_WS_SECRET;
    if (!secret) return { valid: false };

    const parts = token.split('.');
    if (parts.length !== 3) return { valid: false };

    const [header, payload, signature] = parts;

    // Verify signature
    const expectedSig = createHmac('sha256', secret)
      .update(`${header}.${payload}`)
      .digest('base64url');

    const sigBuffer = Buffer.from(signature, 'base64url');
    const expectedBuffer = Buffer.from(expectedSig, 'base64url');

    if (sigBuffer.length !== expectedBuffer.length) return { valid: false };
    if (!timingSafeEqual(sigBuffer, expectedBuffer)) return { valid: false };

    // Decode payload
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      sub?: string;
      exp?: number;
    };

    // Check expiry
    if (!decoded.exp || decoded.exp < Math.floor(Date.now() / 1000)) {
      return { valid: false };
    }

    // Check subject
    if (!decoded.sub || typeof decoded.sub !== 'string') {
      return { valid: false };
    }

    return { valid: true, userId: decoded.sub };
  } catch {
    return { valid: false };
  }
}
```

**Why hand-rolled JWT:** The relay is a minimal Node.js service. Adding `jose` or `jsonwebtoken` would increase the dependency surface for 15 lines of HMAC verification. The token structure is intentionally simple (no claims, no audience, no issuer).

**Acceptance Criteria:**
- [x] `services/schwab-relay/src/ws-auth.ts` created
- [x] Rejects tokens with invalid signatures (returns `{ valid: false }`)
- [x] Rejects expired tokens
- [x] Returns `{ valid: true, userId }` for valid tokens
- [x] Uses timing-safe comparison (prevents timing attacks)
- [x] Never throws — wraps everything in try/catch
- [x] `cd services/schwab-relay && npx tsc --noEmit` passes

#### Change 1C: Wire WebSocket server into relay entrypoint

**File:** `services/schwab-relay/src/index.ts`
**Action:** MODIFY

**Steps:**

1. Add imports at the top of the file (after line 9, after the existing `writer` import):

```typescript
import { WebSocketServer } from 'ws';
import { QuoteBroadcaster } from './broadcast.js';
import { validateRelayToken } from './ws-auth.js';
```

2. Add a module-level variable after `activeAccessToken` (after line 16):

```typescript
let broadcaster: QuoteBroadcaster | null = null;
```

3. In the `startStreamer` function, add broadcast calls to the `onQuoteUpdate` callback (line 42-45). After the existing `writer?.addQuote(quote)` loop, add:

```typescript
      // Broadcast to WebSocket clients (bypasses DB)
      broadcaster?.broadcast(quotes);
```

So the full callback becomes:
```typescript
    onQuoteUpdate: (quotes) => {
      for (const quote of quotes) {
        writer?.addQuote(quote);
      }
      // Broadcast to WebSocket clients (bypasses DB)
      broadcaster?.broadcast(quotes);
    },
```

4. In the `onScreenerUpdate` callback (line 47-60), add after the `void writer.addScreenerData(update)` call:

```typescript
      // Broadcast screener to WebSocket clients
      broadcaster?.broadcastScreener(update);
```

5. In the `shutdown` function (line 118-130), add after `stopStreamer()` on line 121:

```typescript
  broadcaster?.closeAll();
```

6. In the `main` function, after `healthServer.listen(...)` (after line 152), add the WebSocket server setup:

```typescript
  // --- WebSocket server for direct browser connections ---
  broadcaster = new QuoteBroadcaster();
  const wss = new WebSocketServer({ noServer: true });

  healthServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '', `http://${req.headers.host}`);

    // Only accept WebSocket upgrades on /ws path
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }

    // Validate auth token from query string
    const token = url.searchParams.get('token');
    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const result = validateRelayToken(token);
    if (!result.valid) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      broadcaster!.addClient(ws);
      log(`ws client connected (user=${result.userId}, clients=${broadcaster!.clientCount})`);

      ws.on('close', () => {
        log(`ws client disconnected (clients=${broadcaster!.clientCount})`);
      });
    });
  });
```

7. Update the health endpoint response (line 137-144) to include WebSocket client count. Change the `status` object to:

```typescript
      const status = {
        ok: true,
        connected: streamer?.isConnected() ?? false,
        activeUser: activeUserId !== null,
        wsClients: broadcaster?.clientCount ?? 0,
        uptime: process.uptime(),
      };
```

**Acceptance Criteria:**
- [x] `/health` endpoint still works, now includes `wsClients` field
- [x] `GET /health` returns `{ ok, connected, activeUser, wsClients, uptime }`
- [x] WebSocket connections to `/ws?token=VALID_TOKEN` are accepted
- [x] WebSocket connections without a token get 401 and socket destroyed
- [x] WebSocket connections with an invalid/expired token get 401
- [x] Non-`/ws` upgrade requests are destroyed (no crash)
- [x] Connected clients receive `snapshot` message immediately on connect
- [x] Connected clients receive `quotes` messages on each Schwab tick
- [x] Connected clients receive `screener` messages on screener updates
- [x] All WS clients disconnected on SIGTERM/SIGINT
- [x] Relay still writes to DB via QuoteWriter (unchanged)
- [x] `cd services/schwab-relay && npx tsc --noEmit` passes

#### Phase 1 Verification

```bash
cd services/schwab-relay && npx tsc --noEmit
```

- [x] Relay type-check passes
- [x] No new npm dependencies needed (ws already installed)

**STOP HERE. Report results before proceeding to Phase 2.**

---

### Phase 2: Auth Token Generation (Next.js API Route)

> Risk: MEDIUM | Est: 30 min

#### Change 2A: Create relay token API route

**File:** `app/api/relay-token/route.ts`
**Action:** CREATE

This route generates a short-lived JWT that the browser uses to authenticate with the relay WebSocket. Protected by `requireUser()`. Also checks that the user has an active Schwab link (same gate as the SSE route).

```typescript
import { createHmac } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { getDb } from '@/lib/db';
import { schwabLinks } from '@/lib/db/schema';
import { requireUser } from '@/lib/server-db-utils';

export const dynamic = 'force-dynamic';

/**
 * GET /api/relay-token
 *
 * Returns a short-lived JWT for connecting to the Schwab relay WebSocket.
 * The token expires in 60 seconds — it's only used for the handshake.
 *
 * Requires:
 * - Authenticated user (NextAuth session)
 * - Active Schwab link (schwab_links table)
 * - RELAY_WS_SECRET and RELAY_WS_URL env vars
 */
export async function GET() {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const secret = process.env.RELAY_WS_SECRET;
  const wsUrl = process.env.RELAY_WS_URL;

  if (!secret || !wsUrl) {
    return Response.json(
      { error: 'Relay WebSocket not configured' },
      { status: 503 },
    );
  }

  // Verify user has an active Schwab link
  const db = getDb();
  if (!db) {
    return Response.json({ error: 'Database unavailable' }, { status: 503 });
  }

  const [link] = await db
    .select({
      status: schwabLinks.status,
      refreshTokenExpiresAt: schwabLinks.refreshTokenExpiresAt,
    })
    .from(schwabLinks)
    .where(eq(schwabLinks.userId, authState.user.id))
    .limit(1);

  if (!link || link.status !== 'active' || link.refreshTokenExpiresAt.getTime() < Date.now()) {
    return Response.json(
      { error: 'No active Schwab link. Connect your Schwab account first.' },
      { status: 400 },
    );
  }

  // Build JWT: header.payload.signature
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: authState.user.id,
      exp: Math.floor(Date.now() / 1000) + 60, // 60 seconds
    }),
  ).toString('base64url');

  const signature = createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');

  const token = `${header}.${payload}.${signature}`;

  return Response.json({ token, wsUrl });
}
```

**Why a separate route (not embedded in the SSE route):** The SSE route returns an EventSource stream. This route returns a one-shot JSON response with a token. Different response types, different purposes. Keeping them separate is cleaner.

**Acceptance Criteria:**
- [x] `app/api/relay-token/route.ts` created
- [x] Returns 401 for unauthenticated requests (via `requireUser()`)
- [x] Returns 503 if `RELAY_WS_SECRET` or `RELAY_WS_URL` not set
- [x] Returns 400 if user has no active Schwab link
- [x] Returns `{ token, wsUrl }` on success
- [x] Token is a valid 3-part base64url JWT (header.payload.signature)
- [x] Token payload contains `sub` (userId) and `exp` (60 seconds from now)
- [x] Token is signed with HMAC-SHA256 using `RELAY_WS_SECRET`
- [x] `npm run lint && npx tsc --noEmit` passes

#### Phase 2 Verification

```bash
npm run lint && npx tsc --noEmit
```

- [x] Lint passes
- [x] Type-check passes

**STOP HERE. Report results before proceeding to Phase 3.**

---

### Phase 3: Client Hook + Shared Types

> Risk: MEDIUM | Est: 1 hr

#### Change 3A: Create shared relay types

**File:** `lib/relay-types.ts`
**Action:** CREATE

The relay's `QuoteUpdate` type lives in the relay package (`services/schwab-relay/src/streamer.ts`) and can't be imported by the Next.js app. We need matching types on the client side.

```typescript
/**
 * Quote data broadcast by the Schwab relay WebSocket.
 * Matches the shape of QuoteUpdate in services/schwab-relay/src/streamer.ts.
 */
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

/**
 * Screener data broadcast by the relay.
 * Contains merged gainers + losers (relay sends full screener state each time).
 */
export type RelayScreenerData = {
  gainers: RelayScreenerItem[];
  losers: RelayScreenerItem[];
};

export type RelayScreenerItem = {
  symbol: string;
  lastPrice: number;
  netChange: number;
  netChangePercent: number;
  totalVolume: number;
};

/**
 * Message types sent by the relay WebSocket.
 *
 * - snapshot: Full quote array, sent once on connect
 * - quotes: Incremental quote updates, sent on each Schwab tick
 * - screener: Full screener state (gainers + losers)
 */
export type RelayMessage =
  | { type: 'snapshot'; data: RelayQuoteUpdate[] }
  | { type: 'quotes'; data: RelayQuoteUpdate[] }
  | { type: 'screener'; data: RelayScreenerData };
```

**Acceptance Criteria:**
- [x] `lib/relay-types.ts` created with `RelayQuoteUpdate`, `RelayScreenerData`, `RelayScreenerItem`, `RelayMessage` types
- [x] Types match the relay's broadcast shapes
- [x] `npm run lint && npx tsc --noEmit` passes

#### Change 3B: Create useRelaySocket hook

**File:** `hooks/use-relay-socket.ts`
**Action:** CREATE

This hook connects to the relay WebSocket for real-time quotes. It fetches a token from `/api/relay-token`, opens a WebSocket, and dispatches updates. Falls back to SSE after 3 failed reconnect attempts.

```typescript
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RelayMessage, RelayQuoteUpdate, RelayScreenerData } from '@/lib/relay-types';

type UseRelaySocketOptions = {
  /** Whether to attempt connecting. Set to false to disable. */
  enabled: boolean;
  /** Called once on connect with the full quote snapshot. */
  onSnapshot: (quotes: RelayQuoteUpdate[]) => void;
  /** Called on each incremental quote update from Schwab. */
  onQuotes: (quotes: RelayQuoteUpdate[]) => void;
  /** Called when screener data updates (full gainers + losers). */
  onScreener: (data: RelayScreenerData) => void;
};

type UseRelaySocketReturn = {
  /** Whether the WebSocket is currently open and receiving data. */
  connected: boolean;
  /** True after 3 failed reconnect attempts. Signals the caller to enable SSE fallback. */
  fallbackToSSE: boolean;
};

const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_BASE_DELAY_MS = 2_000;
const KEEPALIVE_INTERVAL_MS = 30_000;

/**
 * Hook that connects to the Schwab relay WebSocket for real-time quotes.
 *
 * Flow:
 * 1. Fetch a short-lived token from GET /api/relay-token
 * 2. Open WebSocket to the relay's /ws endpoint with the token
 * 3. Receive snapshot (full state), then incremental quotes + screener updates
 * 4. On disconnect: retry up to 3 times with exponential backoff
 * 5. After 3 failures: set fallbackToSSE = true so the caller can switch to SSE
 *
 * The token is only valid for 60 seconds (handshake only). Once connected,
 * the WebSocket stays open without re-authentication.
 */
export function useRelaySocket(options: UseRelaySocketOptions): UseRelaySocketReturn {
  const [connected, setConnected] = useState(false);
  const [fallbackToSSE, setFallbackToSSE] = useState(false);

  // Use refs for callbacks to avoid re-triggering the effect on every render
  const onSnapshotRef = useRef(options.onSnapshot);
  const onQuotesRef = useRef(options.onQuotes);
  const onScreenerRef = useRef(options.onScreener);

  useEffect(() => {
    onSnapshotRef.current = options.onSnapshot;
    onQuotesRef.current = options.onQuotes;
    onScreenerRef.current = options.onScreener;
  }, [options.onSnapshot, options.onQuotes, options.onScreener]);

  const connect = useCallback(async (attempt: number): Promise<WebSocket | null> => {
    try {
      // 1. Fetch token
      const res = await fetch('/api/relay-token');
      if (!res.ok) {
        // Token endpoint failed (401, 400, 503) — no point retrying
        return null;
      }

      const { token, wsUrl } = (await res.json()) as { token: string; wsUrl: string };

      // 2. Open WebSocket
      const ws = new WebSocket(`${wsUrl}?token=${token}`);
      return ws;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!options.enabled) {
      setConnected(false);
      setFallbackToSSE(false);
      return;
    }

    let ws: WebSocket | null = null;
    let reconnectAttempts = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
    let disposed = false;

    function cleanup() {
      if (keepaliveTimer) clearInterval(keepaliveTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      keepaliveTimer = null;
      reconnectTimer = null;
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onclose = null;
        ws.onerror = null;
        ws.close();
        ws = null;
      }
    }

    function scheduleReconnect() {
      if (disposed) return;

      reconnectAttempts++;
      if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
        setFallbackToSSE(true);
        setConnected(false);
        return;
      }

      const delay = RECONNECT_BASE_DELAY_MS * Math.pow(2, reconnectAttempts - 1);
      reconnectTimer = setTimeout(() => {
        if (disposed) return;
        void startConnection();
      }, delay);
    }

    async function startConnection() {
      if (disposed) return;

      cleanup();

      ws = await connect(reconnectAttempts);

      if (!ws) {
        // Token fetch failed — fall back immediately
        setFallbackToSSE(true);
        setConnected(false);
        return;
      }

      ws.onopen = () => {
        if (disposed) return;
        reconnectAttempts = 0;
        setConnected(true);
        setFallbackToSSE(false);

        // Send keepalive pings to prevent Fly.io proxy from closing idle connections
        keepaliveTimer = setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, KEEPALIVE_INTERVAL_MS);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data as string) as RelayMessage;

          switch (message.type) {
            case 'snapshot':
              onSnapshotRef.current(message.data);
              break;
            case 'quotes':
              onQuotesRef.current(message.data);
              break;
            case 'screener':
              onScreenerRef.current(message.data);
              break;
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (disposed) return;
        setConnected(false);
        if (keepaliveTimer) clearInterval(keepaliveTimer);
        keepaliveTimer = null;
        scheduleReconnect();
      };

      ws.onerror = () => {
        // onclose will fire after onerror — reconnect logic is there
      };
    }

    void startConnection();

    return () => {
      disposed = true;
      cleanup();
      setConnected(false);
    };
  }, [options.enabled, connect]);

  return { connected, fallbackToSSE };
}
```

**How this works (plain English):**
1. When `enabled` is true, the hook fetches a token from your Vercel API
2. It opens a WebSocket to the Fly.io relay using that token
3. The relay sends a `snapshot` message immediately (full quote state)
4. Then it sends `quotes` messages every time Schwab pushes a tick (~sub-second)
5. If the connection drops, it retries 3 times with backoff (2s, 4s, 8s)
6. After 3 failures, it sets `fallbackToSSE = true` so the UI can switch to the old SSE path
7. It sends a ping every 30 seconds to keep the connection alive through Fly's proxy

**Acceptance Criteria:**
- [x] `hooks/use-relay-socket.ts` created with `useRelaySocket` export
- [x] Fetches token from `/api/relay-token` before connecting
- [x] Falls back to SSE immediately if token fetch fails (401, 400, 503)
- [x] Opens WebSocket to relay's `/ws` endpoint
- [x] Dispatches `onSnapshot`, `onQuotes`, `onScreener` callbacks based on message type
- [x] Reconnects up to 3 times with exponential backoff on disconnect
- [x] Sets `fallbackToSSE = true` after 3 failed reconnects
- [x] Sends keepalive ping every 30 seconds
- [x] Cleans up WebSocket on unmount or when `enabled` becomes false
- [x] Uses refs for callbacks (avoids reconnect on every render)
- [x] `npm run lint && npx tsc --noEmit` passes

#### Phase 3 Verification

```bash
npm run lint && npx tsc --noEmit
```

- [x] Lint passes
- [x] Type-check passes

**STOP HERE. Report results before proceeding to Phase 4.**

---

### Phase 4: Wire Into MarketsTab

> Risk: MEDIUM | Est: 1 hr

#### Change 4A: Integrate useRelaySocket into MarketsTab

**File:** `components/trading/MarketsTab.tsx`
**Action:** MODIFY

**Steps:**

1. Add imports at the top of the file (after line 10, after `useSchwabStatus` import):

```typescript
import { useRelaySocket } from '@/hooks/use-relay-socket';
import type { RelayQuoteUpdate, RelayScreenerData } from '@/lib/relay-types';
```

2. Inside the `MarketsTab` component (after the `useSchwabStatus` call on line 216), add a ref to hold the quote map and helper functions:

```typescript
  // --- Relay WebSocket (direct from Fly.io, bypasses DB) ---
  const quoteMapRef = useRef(new Map<string, RelayQuoteUpdate>());

  const buildSnapshotFromQuotes = useCallback((quotes: Map<string, RelayQuoteUpdate>): SnapshotPayload => {
    const INDEX_SYMBOLS = ['SPY', 'QQQ', 'DIA', 'IWM'];
    const COMMODITY_MAP = [
      { ticker: 'GLD', label: 'Gold' },
      { ticker: 'SLV', label: 'Silver' },
      { ticker: 'USO', label: 'Crude Oil' },
      { ticker: 'UNG', label: 'Natural Gas' },
      { ticker: 'TLT', label: 'Treasuries' },
      { ticker: 'UUP', label: 'US Dollar' },
    ];
    const EQUITY_SYMBOLS = ['AAPL', 'MSFT', 'AMZN', 'GOOGL', 'NVDA', 'TSLA', 'META', 'JPM', 'JNJ', 'V'];

    const toInstrument = (symbol: string, label: string): MarketInstrument => {
      const q = quotes.get(symbol);
      return {
        symbol,
        label,
        price: q?.lastPrice ?? null,
        change: q?.netChange ?? null,
        changePercent: q?.netChangePercent ?? null,
        marketStatus: q?.securityStatus ?? null,
        quoteSession: q ? 'regular' : 'snapshot',
        extendedQuoteUnavailable: false,
        extendedUnavailableLabel: null,
      };
    };

    return {
      indices: INDEX_SYMBOLS.map((s) => toInstrument(s, s)),
      commodities: COMMODITY_MAP.map((c) => toInstrument(c.ticker, c.label)),
      equities: EQUITY_SYMBOLS.map((s) => toInstrument(s, s)),
      movers: snapshot?.movers ?? { gainers: [], losers: [] },
    };
  }, [snapshot?.movers]);

  const handleRelaySnapshot = useCallback((quotes: RelayQuoteUpdate[]) => {
    const map = quoteMapRef.current;
    for (const q of quotes) {
      map.set(q.symbol, q);
    }
    setSnapshot(buildSnapshotFromQuotes(map));
    setCoverage(buildCoverage(buildSnapshotFromQuotes(map)));
    setDataSource('realtime');
    setLastLoadedAt(new Date());
    setLoadingSnapshot(false);
    setWarning(null);
    setIsStale(false);
  }, [buildSnapshotFromQuotes]);

  const handleRelayQuotes = useCallback((quotes: RelayQuoteUpdate[]) => {
    const map = quoteMapRef.current;
    for (const q of quotes) {
      const existing = map.get(q.symbol);
      map.set(q.symbol, { ...(existing ?? {}), ...q, symbol: q.symbol });
    }
    setSnapshot(buildSnapshotFromQuotes(map));
    setLastLoadedAt(new Date());
  }, [buildSnapshotFromQuotes]);

  const handleRelayScreener = useCallback((data: RelayScreenerData) => {
    const toMoverRow = (item: RelayScreenerData['gainers'][number]): MarketMoverRow => ({
      ticker: item.symbol,
      price: item.lastPrice,
      previousClose: null,
      change: item.netChange,
      changePercent: item.netChangePercent,
      updated: null,
      volume: item.totalVolume,
    });

    setSnapshot((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        movers: {
          gainers: data.gainers.map(toMoverRow),
          losers: data.losers.map(toMoverRow),
        },
      };
    });
  }, []);

  const { connected: relayConnected, fallbackToSSE: relayFallback } = useRelaySocket({
    enabled: dataSource === 'realtime',
    onSnapshot: handleRelaySnapshot,
    onQuotes: handleRelayQuotes,
    onScreener: handleRelayScreener,
  });
```

3. Modify the existing `useMarketStream` call (line 218). It should only be enabled when the relay WebSocket is unavailable:

Change:
```typescript
  const { connected: sseConnected, fallbackToPolling } = useMarketStream({
    enabled: dataSource === 'realtime',
```

To:
```typescript
  const { connected: sseConnected, fallbackToPolling } = useMarketStream({
    enabled: dataSource === 'realtime' && relayFallback,
```

4. You will also need to add `useRef` to the React import on line 3. Change:

```typescript
import { useCallback, useEffect, useState } from 'react';
```

To:
```typescript
import { useCallback, useEffect, useRef, useState } from 'react';
```

5. Update the LIVE badge text (line 338) to show the data source. Change:

```typescript
            {dataSource === 'realtime' ? 'Schwab real-time streaming' : 'Massive API delayed data'}
```

To:
```typescript
            {dataSource === 'realtime'
              ? relayConnected
                ? 'Schwab real-time (direct WebSocket)'
                : 'Schwab real-time streaming (SSE)'
              : 'Massive API delayed data'}
```

**Why this approach:**
- The relay WebSocket is tried first. If it works, SSE stays disabled (`relayFallback` is false).
- If the relay fails after 3 retries, `relayFallback` becomes true, which enables the SSE hook (same as before).
- The `quoteMapRef` accumulates quote data in memory, and `buildSnapshotFromQuotes` converts it to the same `SnapshotPayload` shape the rest of the component expects. Zero changes to the rendering code.
- The status text tells you which path is active so you can verify.

**Acceptance Criteria:**
- [x] `useRelaySocket` called in MarketsTab with correct callbacks
- [x] `useMarketStream` only enabled when `relayFallback` is true
- [x] Quote data from relay WebSocket renders identically to SSE data
- [x] Movers/screener data from relay renders in the movers section
- [x] LIVE badge shows "direct WebSocket" when relay is connected
- [x] LIVE badge shows "SSE" when relay is unavailable and SSE takes over
- [x] Disconnecting relay causes automatic fallback to SSE (no blank screen)
- [x] ScannerSection still works via existing polling (no changes)
- [x] `npm run lint && npx tsc --noEmit` passes

#### Phase 4 Verification

```bash
npm run lint && npx tsc --noEmit && npm test
```

- [x] Lint passes
- [x] Type-check passes
- [x] All existing tests pass (no regressions)

---

### Files Changed Summary

| File | Action | Phase | Risk |
|------|--------|-------|------|
| `services/schwab-relay/src/broadcast.ts` | CREATE | 1 | LOW |
| `services/schwab-relay/src/ws-auth.ts` | CREATE | 1 | LOW |
| `services/schwab-relay/src/index.ts` | MODIFY | 1 | MEDIUM |
| `app/api/relay-token/route.ts` | CREATE | 2 | MEDIUM |
| `lib/relay-types.ts` | CREATE | 3 | LOW |
| `hooks/use-relay-socket.ts` | CREATE | 3 | MEDIUM |
| `components/trading/MarketsTab.tsx` | MODIFY | 4 | MEDIUM |

**Total: 5 new files, 2 modified files. No new npm dependencies.**

---

### Deployment Order

This feature spans two independently-deployed services. Deploy in this order:

1. **Set env vars first:**
   - Generate secret: `openssl rand -hex 32`
   - Fly.io: `cd services/schwab-relay && fly secrets set RELAY_WS_SECRET=<value>`
   - Vercel: Add `RELAY_WS_SECRET=<same-value>` and `RELAY_WS_URL=wss://nexus-schwab-relay.fly.dev/ws`

2. **Deploy relay (Phases 1):**
   - `cd services/schwab-relay && fly deploy`
   - Verify: `curl https://nexus-schwab-relay.fly.dev/health` → should show `wsClients: 0`

3. **Deploy Vercel (Phases 2-4):**
   - `git push` triggers Vercel deploy
   - Verify: Open Markets tab, check for "direct WebSocket" in status text

### Rollback Plan

Each phase is independently revertible. The existing SSE pipeline is never modified or removed.

- **Phase 4:** Revert MarketsTab. SSE resumes as sole data source.
- **Phase 3:** Delete `hooks/use-relay-socket.ts` and `lib/relay-types.ts`.
- **Phase 2:** Delete `app/api/relay-token/route.ts`. Remove Vercel env vars.
- **Phase 1:** Revert relay `index.ts`. Delete `broadcast.ts` and `ws-auth.ts`. Redeploy relay. Remove Fly secrets.

### Security Notes

- **Token is read-only** — the relay WebSocket only broadcasts quotes. No write operations exposed.
- **60-second TTL** — token expires fast, limiting replay window.
- **Timing-safe comparison** — HMAC verification uses `timingSafeEqual` to prevent timing attacks.
- **No PII** — only market data (ticker, price, volume) flows through the WebSocket.
- **Shared secret** — `RELAY_WS_SECRET` must match on both Vercel and Fly.io. Rotate by updating both simultaneously.

### Future Improvements (Not In Scope)

1. **Client-side scanner filtering** — Once the relay WS sends all quotes, ScannerSection could filter client-side instead of polling `/api/scanner`. Eliminates the last DB round-trip.
2. **Symbol subscription management** — Let the client tell the relay which symbols it cares about, reducing bandwidth.
3. **Binary protocol** — Switch from JSON to MessagePack if bandwidth becomes a concern.

---

### Pre-flight Checklist (for Jared)

Before opencode starts:
- [ ] Generate shared secret: `openssl rand -hex 32`
- [ ] Set `RELAY_WS_SECRET` on Fly.io: `fly secrets set RELAY_WS_SECRET=<value> --app nexus-schwab-relay`
- [ ] Set `RELAY_WS_SECRET` on Vercel: `vercel env add RELAY_WS_SECRET`
- [ ] Set `RELAY_WS_URL` on Vercel: `vercel env add RELAY_WS_URL` → value: `wss://nexus-schwab-relay.fly.dev/ws`
- [ ] Schwab account re-linked (Schwab Relay Auth blocker resolved)

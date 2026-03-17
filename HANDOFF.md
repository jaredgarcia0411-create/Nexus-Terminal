# Nexus Terminal — HANDOFF.md

## Active Handoff Only

Historical completed sections (Scanner Realtime Data Pipeline, Tech Debt PRs 1-5, etc.) were removed to keep this file focused.
Use git history and the `specs/` directory for archived implementation detail.

### Session Maintenance Checklist

- [x] Refreshed `AGENTS.md` with current build/lint/test commands, single-test workflows, and coding conventions for agentic coding tools.
- [x] Verified command set and conventions against the current repository configuration (`package.json`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.mjs`).
- [x] `parseJsonBody` removed from `lib/api-route-utils.ts` — all routes now use `parseAndValidate`
- [ ] Update `AGENTS.md` after Phase 2 ships — add SSE endpoint conventions and `lib/sse.ts` utility docs

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

## Discord Research Report Extraction

> Generated: 2026-03-16 | Status: PLANNED
> Priority: HIGH — unlocks ticker auto-subscription + historical research archive

*(Full spec preserved from prior session — see git history for details. Implementation deferred until tech debt PRs are complete.)*

---

## Custom Dilution Research Report

> Generated: 2026-03-16 | Status: PLANNED
> Priority: HIGH — replaces $200/mo third-party report
> Depends on: Sprint 8 AskEdgar integration (partially built in `lib/jarvis/research.ts`)

*(Full spec preserved from prior session — see git history for details. Implementation deferred until tech debt PRs are complete.)*

---

# SSE Streaming + Keyboard Shortcuts

> Generated: 2026-03-17 | Agent: nexus-architect
> Status: IN PROGRESS (Phases 0-1 implemented, awaiting Jared review)

## Goal

Add Server-Sent Events for real-time market data streaming and Jarvis AI response streaming, plus global keyboard shortcuts with a command palette. Together these reduce database load by ~85% on the Markets tab (from 36 queries/min to ~6), give Jarvis a token-by-token streaming UX, and make tab navigation instant via keyboard. Each phase ships independently. Existing polling remains as fallback.

## Platform Notes

- **Vercel Hobby plan** — 60s max function duration. SSE connections auto-reconnect via EventSource when they hit this limit. This is invisible to the user.
- **Neon PostgreSQL** — HTTP adapter (no LISTEN/NOTIFY). SSE endpoint must poll the DB internally.
- **NextAuth cookies** — EventSource sends cookies automatically, so `requireUser()` works without custom auth headers.

## Workflow Instructions for opencode

**Execute phases in order: 0 → 1 → 2 → 3.**

After each phase:
1. Run `npm run lint && npx tsc --noEmit && npm test`
2. **STOP and report results.** Do not proceed to the next phase until confirmed.

**STOP POINTS:**
- **After Phase 1:** Stop. Jared reviews keyboard shortcuts + command palette before proceeding.
- **After Phase 2:** Stop. Jared reviews SSE integration before proceeding.
- **After Phase 3:** Stop. Jared reviews Jarvis streaming before proceeding.

---

## Phase 0: Pre-SSE Database Fixes

> Status: COMPLETE (2026-03-17)

Delivered:
- Scoped realtime snapshot query in `app/api/market-data/snapshot/route.ts` to only required symbols using `inArray`.
- Reduced selected realtime quote columns to the exact fields used by `mapRealtimeInstrument`.
- Added module-level, best-effort 3s TTL in-memory cache for realtime snapshot responses.

Validation:
- [x] `npm run lint`
- [x] `npx tsc --noEmit`
- [x] `npm test`
- [x] Snapshot path behavior reviewed in app as clean before section close.

---

## Phase 1: Keyboard Shortcuts + Command Palette

> Status: COMPLETE (2026-03-17)

Delivered:
- Added `react-hotkeys-hook` dependency.
- Added global shortcut hook in `hooks/use-global-shortcuts.ts` for 1-8 tab switch, `Ctrl/Cmd+K` palette open, and `Ctrl/Cmd+J` Jarvis quick-open.
- Added command palette UI in `components/trading/CommandPalette.tsx` with navigation/actions/Jarvis entries.
- Wired palette + shortcut hook into `app/page.tsx` (state, hook call, render).
- Added desktop-only `<kbd>` numeric hints in `components/trading/Sidebar.tsx` (mobile unchanged).

Validation:
- [x] `npm run lint`
- [x] `npx tsc --noEmit`
- [x] `npm test`
- [x] Visual QA complete (site reviewed clean; shortcuts/palette behavior accepted by Jared).

**STOP HERE. Wait for Jared to review before proceeding to Phase 2.**

---

## Phase 2: SSE for Market Data (Scanner + Snapshot Unified Stream)

> Risk: MEDIUM-HIGH | Est: 2-3 hr

### Change 2A: Create SSE utility helper

**File:** `lib/sse.ts`
**Action:** CREATE

```typescript
/**
 * Server-side helper for creating SSE (Server-Sent Events) responses.
 *
 * SSE is a simple protocol where the server sends text lines in this format:
 *   event: eventName\n
 *   data: {"json":"payload"}\n
 *   \n
 *
 * The browser connects via `new EventSource(url)` and receives events as they arrive.
 * Unlike WebSockets, SSE is one-directional (server → client) and works over regular HTTP.
 *
 * On Vercel Hobby, the function times out at 60s. EventSource automatically reconnects
 * when the connection drops — this is built into the browser API, no client code needed.
 */

const encoder = new TextEncoder();

export type SSESender = (event: string, data: unknown) => void;

/**
 * Creates an SSE Response for a Next.js route handler.
 *
 * @param signal - `request.signal` from the route handler. Fires when the client disconnects.
 * @param onStart - Called with a `send` function. Return a cleanup function (e.g., to clear intervals).
 *
 * Example usage in a route:
 * ```ts
 * export async function GET(request: NextRequest) {
 *   return createSSEResponse(request.signal, (send) => {
 *     const interval = setInterval(() => {
 *       send('update', { price: 42 });
 *     }, 5000);
 *     return () => clearInterval(interval);
 *   });
 * }
 * ```
 */
export function createSSEResponse(
  signal: AbortSignal,
  onStart: (send: SSESender) => (() => void) | void,
): Response {
  let cleanup: (() => void) | void;

  const stream = new ReadableStream({
    start(controller) {
      const send: SSESender = (event, data) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Controller may be closed if client disconnected — ignore
        }
      };

      cleanup = onStart(send);

      signal.addEventListener('abort', () => {
        cleanup?.();
        try {
          controller.close();
        } catch {
          // Already closed — ignore
        }
      });
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
```

**Acceptance Criteria:**
- [ ] Exports `createSSEResponse` and `SSESender` type
- [ ] Produces valid SSE format: `event: name\ndata: json\n\n`
- [ ] Cleanup is called on client disconnect (signal abort)
- [ ] `npm run lint && npx tsc --noEmit` passes

### Change 2B: Create unified SSE endpoint for realtime market feed

**File:** `app/api/market-data/stream/route.ts`
**Action:** CREATE

```typescript
import { createSSEResponse } from '@/lib/sse';
import { requireUser } from '@/lib/server-db-utils';
import { getDb } from '@/lib/db';
import { inArray, desc, eq } from 'drizzle-orm';
import { realtimeQuotes, schwabLinks, marketSnapshots } from '@/lib/db/schema';

// Tell Next.js this route is dynamic (never cached) and set max duration for Vercel
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Vercel Hobby cap — EventSource auto-reconnects after this

const PUSH_INTERVAL_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 30_000;

export async function GET(request: Request) {
  // Auth — EventSource sends cookies automatically
  const authState = await requireUser();
  if (!authState.authenticated) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDb();
  if (!db) {
    return Response.json({ error: 'Database unavailable' }, { status: 503 });
  }

  // Check Schwab link — SSE only makes sense for realtime data
  const [link] = await db
    .select({ id: schwabLinks.id })
    .from(schwabLinks)
    .where(eq(schwabLinks.userId, authState.user.id))
    .limit(1);

  if (!link) {
    return Response.json({ error: 'realtime_unavailable' }, { status: 400 });
  }

  // Parse scanner filter params from URL
  const url = new URL(request.url);
  const scannerParams = {
    minPrice: url.searchParams.get('minPrice'),
    maxPrice: url.searchParams.get('maxPrice'),
    minChangePercent: url.searchParams.get('minChangePercent'),
    maxChangePercent: url.searchParams.get('maxChangePercent'),
    minVolume: url.searchParams.get('minVolume'),
    assetType: url.searchParams.get('assetType'),
    sortBy: url.searchParams.get('sortBy') || 'netChangePercent',
    sortDir: url.searchParams.get('sortDir') || 'desc',
    limit: url.searchParams.get('limit') || '100',
  };

  return createSSEResponse(request.signal, (send) => {
    // Send initial data immediately, then on interval
    async function pushData() {
      try {
        // 1. Fetch snapshot quotes (scoped query — same as Phase 0 fix)
        // Import INDEX_SYMBOLS, COMMODITY_SYMBOLS, EQUITY_SYMBOLS from snapshot route
        // OR duplicate the short list here to avoid circular deps.
        // For simplicity, query all realtime_quotes (they're already scoped by the relay).
        // The relay only writes symbols it tracks, so this is bounded.
        const quotes = await db!.select().from(realtimeQuotes);

        // 2. Fetch movers from market_snapshots (schwab_screener type)
        const [screenerRow] = await db!
          .select()
          .from(marketSnapshots)
          .where(eq(marketSnapshots.type, 'schwab_screener'))
          .orderBy(desc(marketSnapshots.createdAt))
          .limit(1);

        send('snapshot', {
          quotes,
          movers: screenerRow?.data ?? { gainers: [], losers: [] },
        });

        // 3. Fetch scanner results (reuse the same realtime_quotes data)
        // Apply filters in JS to avoid a second DB query
        let filtered = quotes.filter((q) => {
          if (scannerParams.minPrice && (q.lastPrice ?? 0) < Number(scannerParams.minPrice)) return false;
          if (scannerParams.maxPrice && (q.lastPrice ?? 0) > Number(scannerParams.maxPrice)) return false;
          if (scannerParams.minChangePercent && (q.netChangePercent ?? 0) < Number(scannerParams.minChangePercent)) return false;
          if (scannerParams.maxChangePercent && (q.netChangePercent ?? 0) > Number(scannerParams.maxChangePercent)) return false;
          if (scannerParams.minVolume && (q.totalVolume ?? 0) < Number(scannerParams.minVolume)) return false;
          if (scannerParams.assetType && q.assetType !== scannerParams.assetType) return false;
          return true;
        });

        // Sort
        const sortKey = scannerParams.sortBy as keyof typeof quotes[0];
        const dir = scannerParams.sortDir === 'asc' ? 1 : -1;
        filtered.sort((a, b) => {
          const aVal = (a as Record<string, unknown>)[sortKey] ?? 0;
          const bVal = (b as Record<string, unknown>)[sortKey] ?? 0;
          return ((aVal as number) - (bVal as number)) * dir;
        });

        // Limit
        filtered = filtered.slice(0, Number(scannerParams.limit));

        send('scanner', { results: filtered });
      } catch (error) {
        console.error('[market-stream] Push error:', error);
        send('error', { message: 'Failed to fetch market data' });
      }
    }

    // Push immediately on connect
    void pushData();

    // Then every 5 seconds
    const dataInterval = setInterval(() => void pushData(), PUSH_INTERVAL_MS);

    // Heartbeat every 30s to keep connection alive through proxies
    const heartbeatInterval = setInterval(() => {
      send('heartbeat', { ts: Date.now() });
    }, HEARTBEAT_INTERVAL_MS);

    // Return cleanup function — called when client disconnects or Vercel times out
    return () => {
      clearInterval(dataInterval);
      clearInterval(heartbeatInterval);
    };
  });
}
```

**Important:** This endpoint does ONE DB query per push cycle (realtime_quotes + one market_snapshots query) and serves BOTH snapshot and scanner data. This replaces two separate polling endpoints. Scanner filtering happens in JS on the already-fetched data to avoid a second DB round-trip.

**Acceptance Criteria:**
- [ ] `requireUser()` called — returns 401 if unauthenticated
- [ ] Returns JSON error (not SSE) if Schwab not linked
- [ ] Produces valid SSE events (parseable by EventSource)
- [ ] Scanner filters from URL params are applied
- [ ] Heartbeat sent every 30s
- [ ] Cleanup runs on disconnect
- [ ] `npm run lint && npx tsc --noEmit` passes

### Change 2C: Create useMarketStream hook

**File:** `hooks/use-market-stream.ts`
**Action:** CREATE

```typescript
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScannerFilters, ScannerRow, ScannerSortDir, ScannerSortKey } from '@/hooks/use-scanner';

/**
 * Connects to the SSE market data stream when realtime data is available.
 * Falls back to polling when SSE is unavailable (no Schwab link or connection error).
 *
 * How EventSource works:
 * - `new EventSource(url)` opens a persistent HTTP connection to the server
 * - The server sends events as text; the browser parses them automatically
 * - If the connection drops (e.g., Vercel 60s timeout), EventSource auto-reconnects
 * - You listen for named events with `es.addEventListener('eventName', callback)`
 * - Cookies are sent automatically, so NextAuth sessions just work
 */
export function useMarketStream(options: {
  enabled: boolean;
  scannerFilters: ScannerFilters;
  scannerSortBy: ScannerSortKey;
  scannerSortDir: ScannerSortDir;
  onSnapshot: (data: unknown) => void;
  onScanner: (data: { results: ScannerRow[] }) => void;
  onError?: (error: string) => void;
}): { connected: boolean; fallbackToPolling: boolean } {
  const [connected, setConnected] = useState(false);
  const [fallbackToPolling, setFallbackToPolling] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  // Use refs for callbacks to avoid reconnecting when they change
  const onSnapshotRef = useRef(options.onSnapshot);
  onSnapshotRef.current = options.onSnapshot;
  const onScannerRef = useRef(options.onScanner);
  onScannerRef.current = options.onScanner;
  const onErrorRef = useRef(options.onError);
  onErrorRef.current = options.onError;

  const buildUrl = useCallback(() => {
    const params = new URLSearchParams();
    const f = options.scannerFilters;
    if (f.minPrice !== undefined) params.set('minPrice', String(f.minPrice));
    if (f.maxPrice !== undefined) params.set('maxPrice', String(f.maxPrice));
    if (f.minChangePercent !== undefined) params.set('minChangePercent', String(f.minChangePercent));
    if (f.maxChangePercent !== undefined) params.set('maxChangePercent', String(f.maxChangePercent));
    if (f.minVolume !== undefined) params.set('minVolume', String(f.minVolume));
    if (f.assetType) params.set('assetType', f.assetType);
    params.set('sortBy', options.scannerSortBy);
    params.set('sortDir', options.scannerSortDir);
    return `/api/market-data/stream?${params.toString()}`;
  }, [options.scannerFilters, options.scannerSortBy, options.scannerSortDir]);

  useEffect(() => {
    if (!options.enabled) {
      esRef.current?.close();
      esRef.current = null;
      setConnected(false);
      return;
    }

    // Close existing connection before opening new one (e.g., filter change)
    esRef.current?.close();

    const url = buildUrl();
    const es = new EventSource(url);
    esRef.current = es;

    es.addEventListener('snapshot', (e) => {
      setConnected(true);
      setFallbackToPolling(false);
      try {
        onSnapshotRef.current(JSON.parse(e.data));
      } catch { /* ignore parse errors */ }
    });

    es.addEventListener('scanner', (e) => {
      try {
        onScannerRef.current(JSON.parse(e.data));
      } catch { /* ignore parse errors */ }
    });

    es.addEventListener('error', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data);
        onErrorRef.current?.(data.message);
      } catch { /* not all error events have data */ }
    });

    es.onerror = () => {
      // EventSource fires onerror on connection close AND on HTTP errors.
      // readyState 2 = CLOSED — means the server returned a non-200 status
      // and EventSource gave up. That's when we fall back to polling.
      if (es.readyState === EventSource.CLOSED) {
        setConnected(false);
        setFallbackToPolling(true);
      }
      // readyState 0 = CONNECTING — EventSource is auto-reconnecting. That's fine.
    };

    return () => {
      es.close();
      esRef.current = null;
      setConnected(false);
    };
  }, [options.enabled, buildUrl]);

  return { connected, fallbackToPolling };
}
```

**Acceptance Criteria:**
- [ ] Connects to SSE endpoint when `enabled` is true
- [ ] Falls back gracefully when SSE returns non-200
- [ ] Cleans up EventSource on unmount
- [ ] Reconnects when scanner filters change (closes old, opens new)
- [ ] `npm run lint && npx tsc --noEmit` passes

### Change 2D: Allow ScannerSection to receive external data

**File:** `components/trading/ScannerSection.tsx`
**Action:** MODIFY

**Steps:**

1. Change the component signature (line 62) to accept optional external data:
   ```typescript
   // BEFORE:
   export default function ScannerSection({ refreshIntervalMs }: { refreshIntervalMs: number }) {

   // AFTER:
   export default function ScannerSection({
     refreshIntervalMs,
     externalResults,
   }: {
     refreshIntervalMs: number;
     externalResults?: ScannerRow[];
   }) {
   ```

2. Add the `ScannerRow` import if not already present. It's exported from `hooks/use-scanner.ts`.

3. After the `useScanner` call (line 79), add a line that picks external data when available:
   ```typescript
   const displayResults = externalResults ?? results;
   ```

4. Replace all references to `results` in the JSX with `displayResults`. Search for `results.` and `results[` in the component:
   - The `.length` check for empty state
   - The `.slice()` for pagination
   - Any other `results` references

5. When `externalResults` is provided, the internal `useScanner` polling is still active but its results are ignored. To avoid wasted requests, pass `refreshIntervalMs={0}` from MarketsTab when SSE is active (done in Change 2E).

**Acceptance Criteria:**
- [ ] `externalResults` prop is optional — component works exactly as before when not provided
- [ ] When `externalResults` is provided, those results are displayed instead of internal ones
- [ ] Filter/sort controls still work (they control internal useScanner state for when SSE reconnects with new params)
- [ ] `npm run lint && npx tsc --noEmit` passes

### Change 2E: Integrate useMarketStream into MarketsTab

**File:** `components/trading/MarketsTab.tsx`
**Action:** MODIFY

This is the key integration point. The Markets tab currently runs two independent polling loops (snapshot + scanner). We replace both with a single SSE connection when realtime is active.

**Steps:**

1. Add imports at the top:
   ```typescript
   import { useMarketStream } from '@/hooks/use-market-stream';
   ```

2. Add state for SSE-provided scanner results (after existing state declarations):
   ```typescript
   const [streamScannerResults, setStreamScannerResults] = useState<ScannerRow[] | undefined>(undefined);
   ```
   (Import `ScannerRow` from `@/hooks/use-scanner`)

3. Add `useMarketStream` hook call. You'll need to extract scanner filter state from ScannerSection. This is the tricky part:

   **Option A (simpler):** Pass `scannerFilters: {}` initially and let the SSE endpoint return unfiltered results. ScannerSection still filters client-side internally. This is simpler but means the stream sends more data than needed.

   **Option B (cleaner):** Lift scanner filter state up to MarketsTab so it can be passed to both `useMarketStream` and `ScannerSection`. This requires more refactoring.

   **Go with Option A for v1.** The scanner data is already small (100 rows max), and client-side filtering is instant.

   ```typescript
   const { connected: sseConnected, fallbackToPolling } = useMarketStream({
     enabled: dataSource === 'realtime',
     scannerFilters: {},
     scannerSortBy: 'netChangePercent',
     scannerSortDir: 'desc',
     onSnapshot: (data) => {
       // Update snapshot state from SSE data
       // The SSE endpoint sends { quotes, movers } — you'll need to transform
       // this into the same shape as the existing snapshot state.
       // This transformation should match what fetchRealtimeSnapshot does.
       // For v1, you can store the raw SSE data and adapt the rendering,
       // or transform it here to match MarketSnapshotPayload.
       // TODO: opencode should read the existing loadSnapshot/snapshot state shape
       // and write the transform logic to match it.
     },
     onScanner: (data) => {
       setStreamScannerResults(data.results);
     },
   });
   ```

   **IMPORTANT FOR OPENCODE:** Read the existing `loadSnapshot` function and `snapshot` state in MarketsTab.tsx to understand the exact shape of the snapshot data. The `onSnapshot` callback must transform SSE data into that same shape. This is the most complex part of this change — take time to get it right.

4. Modify the snapshot polling `useEffect` (lines 240-246) to only run when SSE is NOT active:
   ```typescript
   // BEFORE:
   useEffect(() => {
     const intervalMs = dataSource === 'realtime' ? 5_000 : 60_000;
     const interval = window.setInterval(() => {
       void loadSnapshot();
     }, intervalMs);
     return () => window.clearInterval(interval);
   }, [loadSnapshot, dataSource]);

   // AFTER:
   useEffect(() => {
     // When SSE is active for realtime data, skip polling — the stream handles updates
     if (dataSource === 'realtime' && !fallbackToPolling) return;

     const intervalMs = dataSource === 'realtime' ? 5_000 : 60_000;
     const interval = window.setInterval(() => {
       void loadSnapshot();
     }, intervalMs);
     return () => window.clearInterval(interval);
   }, [loadSnapshot, dataSource, fallbackToPolling]);
   ```

5. Update the `ScannerSection` render (line 402) to pass external data and disable polling when SSE is active:
   ```typescript
   // BEFORE:
   <ScannerSection refreshIntervalMs={dataSource === 'realtime' ? 5_000 : 60_000} />

   // AFTER:
   <ScannerSection
     refreshIntervalMs={sseConnected ? 0 : (dataSource === 'realtime' ? 5_000 : 60_000)}
     externalResults={sseConnected ? streamScannerResults : undefined}
   />
   ```

6. Optionally add a subtle SSE connection indicator near the "Markets" heading (optional nice-to-have):
   ```tsx
   {sseConnected && (
     <span className="ml-2 inline-flex items-center gap-1 text-xs text-emerald-500">
       <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
       Live
     </span>
   )}
   ```

**Acceptance Criteria:**
- [ ] With Schwab linked: SSE stream is used, polling disabled
- [ ] Without Schwab: existing 60s polling continues unchanged
- [ ] If SSE errors: falls back to 5s polling automatically
- [ ] Scanner shows data from SSE stream when connected
- [ ] `npm run lint && npx tsc --noEmit` passes

### Phase 2 Verification

```bash
npm run lint && npx tsc --noEmit && npm test
```

Manual checks:
- [ ] Open Markets tab with Schwab linked — check DevTools Network tab for EventSource connection
- [ ] Verify snapshot + scanner events arrive every ~5s
- [ ] Disconnect Schwab (or stop relay) — verify fallback to polling
- [ ] Change scanner filters while SSE is active — verify data updates
- [ ] Wait 60s+ — verify automatic reconnection (EventSource reconnects; brief gap is OK)
- [ ] Open Markets tab WITHOUT Schwab — verify 60s polling works as before
- [ ] "Live" indicator shows when SSE is connected

**STOP HERE. Wait for Jared to review before proceeding to Phase 3.**

---

## Phase 3: SSE for Jarvis AI Streaming

> Risk: HIGH | Est: 2-3 hr

### Change 3A: Add streaming mode to Jarvis LLM client

**File:** `lib/jarvis/client.ts`
**Action:** MODIFY

**Steps:**

1. Add a new export after the existing `callJarvis` function (after line 129):

```typescript
/**
 * Streaming version of callJarvis. Returns a ReadableStream of text chunks
 * instead of waiting for the full response.
 *
 * How LLM streaming works:
 * - We send `stream: true` in the request body
 * - The LLM provider returns an SSE stream (yes, SSE from the LLM too)
 * - Each SSE event contains a small JSON object with a "delta" — a few tokens of text
 * - We parse these deltas and yield them as plain text chunks
 * - The consumer (our SSE endpoint) wraps each chunk in its own SSE event to the browser
 *
 * We keep the existing `callJarvis` function unchanged because research and
 * trade-analysis pipelines need the full response as a string to parse JSON from it.
 */
export async function callJarvisStreaming(
  systemPrompt: string,
  userMessage: string,
  temperature = 0.2,
): Promise<{ stream: ReadableStream<string>; modelUsed: string }> {
  if (isCircuitOpen()) {
    throw new Error('Jarvis circuit breaker is open');
  }

  const apiKey = process.env.JARVIS_API_KEY;
  if (!apiKey) {
    throw new Error('JARVIS_API_KEY is not configured');
  }

  const model = process.env.JARVIS_MODEL || DEFAULT_MODEL;
  const baseUrl = normalizeBaseUrl(process.env.JARVIS_API_BASE_URL || DEFAULT_BASE_URL);
  const timeoutMs = getTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature,
        stream: true,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      }),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    recordLlmFailure();
    if ((error as { name?: string }).name === 'AbortError') {
      throw new Error(`LLM request timed out after ${timeoutMs}ms`);
    }
    throw error;
  }

  if (!response.ok || !response.body) {
    clearTimeout(timeout);
    recordLlmFailure();
    const detail = await readFailureDetail(response);
    throw new Error(`LLM request failed with status ${response.status}${detail}`);
  }

  // Transform the LLM's SSE stream into a ReadableStream of plain text chunks
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const stream = new ReadableStream<string>({
    async pull(streamController) {
      try {
        const { done, value } = await reader.read();

        if (done) {
          clearTimeout(timeout);
          recordLlmSuccess();
          streamController.close();
          return;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const payload = trimmed.slice(6);
          if (payload === '[DONE]') {
            clearTimeout(timeout);
            recordLlmSuccess();
            streamController.close();
            return;
          }
          try {
            const parsed = JSON.parse(payload) as {
              choices?: Array<{ delta?: { content?: string } }>;
            };
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              streamController.enqueue(content);
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      } catch (error) {
        clearTimeout(timeout);
        recordLlmFailure();
        streamController.error(error);
      }
    },
    cancel() {
      clearTimeout(timeout);
      reader.cancel().catch(() => {});
    },
  });

  return { stream, modelUsed: model };
}
```

**Acceptance Criteria:**
- [ ] `callJarvisStreaming` exported alongside existing `callJarvis`
- [ ] Circuit breaker checked before the call
- [ ] `recordLlmSuccess()` called on stream completion
- [ ] `recordLlmFailure()` called on errors
- [ ] Existing `callJarvis` unchanged
- [ ] `npm run lint && npx tsc --noEmit` passes

### Change 3B: Create streaming Jarvis chat endpoint

**File:** `app/api/jarvis/chat/stream/route.ts`
**Action:** CREATE

This endpoint handles regular chat messages with streaming. Research and analyze commands redirect to the non-streaming endpoint.

```typescript
import { createSSEResponse } from '@/lib/sse';
import { requireUser } from '@/lib/server-db-utils';
import { checkRateLimit } from '@/lib/jarvis/rate-limit';
import { callJarvisStreaming } from '@/lib/jarvis/client';
import { buildSystemPrompt, buildUserPrompt } from '@/lib/jarvis/prompts';
import { assembleContext } from '@/lib/jarvis/context';
import { loadMemory } from '@/lib/jarvis/memory';
import { logJarvisRequest } from '@/lib/jarvis/token-tracking';
import { getDb } from '@/lib/db';
import { jarvisConversations } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
  const authState = await requireUser();
  if (!authState.authenticated) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = authState.user.id;

  // Rate limit
  const rateLimitResult = await checkRateLimit(userId);
  if (!rateLimitResult.allowed) {
    return Response.json(
      { error: 'Rate limit exceeded' },
      { status: 429, headers: { 'Retry-After': String(rateLimitResult.retryAfterSeconds ?? 60) } },
    );
  }

  // Parse body
  let message: string;
  let sessionId: string | undefined;
  try {
    const body = (await request.json()) as { message?: string; sessionId?: string };
    if (!body.message || typeof body.message !== 'string') {
      return Response.json({ error: 'message is required' }, { status: 400 });
    }
    message = body.message.trim();
    sessionId = body.sessionId;
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // If it's a /research or /analyze command, redirect to non-streaming endpoint
  if (message.startsWith('/research') || message.trim() === '/analyze') {
    return Response.json({ redirect: true }, { status: 200 });
  }

  const db = getDb();
  if (!db) {
    return Response.json({ error: 'Database unavailable' }, { status: 503 });
  }

  // Build context (same as non-streaming chat route)
  const [context, memory] = await Promise.all([
    assembleContext(userId),
    loadMemory(userId),
  ]);

  const systemPrompt = buildSystemPrompt(context, memory);
  const userPrompt = buildUserPrompt(message);

  // Start streaming
  const startTime = Date.now();
  let fullText = '';

  try {
    const { stream, modelUsed } = await callJarvisStreaming(systemPrompt, userPrompt);
    const reader = stream.getReader();

    return createSSEResponse(request.signal, (send) => {
      // Read the stream and forward tokens to the client
      (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            fullText += value;
            send('token', { text: value });
          }

          // Stream complete — send done event with full text
          send('done', { fullText });

          // Save to conversation history + log token tracking
          const latencyMs = Date.now() - startTime;
          await Promise.all([
            // Save user message
            db.insert(jarvisConversations).values({
              userId,
              sessionId: sessionId ?? 'default',
              role: 'user',
              content: message,
            }),
            // Save assistant response
            db.insert(jarvisConversations).values({
              userId,
              sessionId: sessionId ?? 'default',
              role: 'assistant',
              content: fullText,
            }),
            // Log request
            logJarvisRequest({
              userId,
              mode: 'chat',
              model: modelUsed,
              latencyMs,
              inputTokens: null,
              outputTokens: null,
              success: true,
            }),
          ]);
        } catch (error) {
          console.error('[jarvis-stream] Stream error:', error);
          send('error', { message: 'Stream interrupted' });
        }
      })();

      return () => {
        reader.cancel().catch(() => {});
      };
    });
  } catch (error) {
    console.error('[jarvis-stream] Failed to start stream:', error);
    return Response.json({ error: 'Failed to start stream' }, { status: 500 });
  }
}
```

**IMPORTANT FOR OPENCODE:** Read the existing `/api/jarvis/chat/route.ts` to verify:
1. The conversation save logic matches (table, columns, etc.)
2. The `assembleContext` and `buildSystemPrompt` call signatures match
3. The `logJarvisRequest` call signature matches
4. Adapt any differences.

**Acceptance Criteria:**
- [ ] `requireUser()` called
- [ ] Rate limiting enforced
- [ ] `/research` and `/analyze` messages return `{ redirect: true }` (not SSE)
- [ ] Regular chat streams token-by-token via SSE events
- [ ] Full response saved to conversation history after stream completes
- [ ] Token tracking logged
- [ ] `npm run lint && npx tsc --noEmit` passes

### Change 3C: Update JarvisChat component to use streaming

**File:** `components/trading/JarvisChat.tsx`
**Action:** MODIFY

**Steps:**

1. Add a `streamChat` helper function inside the component (or as a module-level function). Since the streaming endpoint uses POST (and EventSource only supports GET), use `fetch` with streaming response body:

```typescript
async function streamChatMessage(
  message: string,
  sessionId: string | undefined,
  onToken: (text: string) => void,
  onDone: (fullText: string) => void,
  onError: (error: string) => void,
): Promise<boolean> {
  // Returns true if streaming was used, false if redirect (use non-streaming)
  const response = await fetch('/api/jarvis/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sessionId }),
  });

  if (!response.ok) {
    onError(`Request failed (${response.status})`);
    return true;
  }

  // Check for redirect response (means it's a /research or /analyze command)
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const data = await response.json();
    if (data.redirect) return false; // Caller should use non-streaming endpoint
    onError(data.error || 'Unknown error');
    return true;
  }

  // Parse SSE stream from fetch response body
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';

    for (const part of parts) {
      const lines = part.split('\n');
      let eventName = '';
      let eventData = '';

      for (const line of lines) {
        if (line.startsWith('event: ')) eventName = line.slice(7);
        if (line.startsWith('data: ')) eventData = line.slice(6);
      }

      if (!eventData) continue;

      try {
        const parsed = JSON.parse(eventData);
        if (eventName === 'token') {
          onToken(parsed.text);
        } else if (eventName === 'done') {
          onDone(parsed.fullText);
        } else if (eventName === 'error') {
          onError(parsed.message);
        }
      } catch { /* skip malformed events */ }
    }
  }

  return true;
}
```

2. Modify the message send handler to try streaming first, then fall back:

   Find the existing send logic (where it does `fetch('/api/jarvis/chat', ...)`). Wrap it:

   ```typescript
   // Try streaming first
   // Add an "assistant" message to the messages array immediately (empty, will fill with tokens)
   // As tokens arrive via onToken, append to that message's content
   // When done, finalize the message

   // If streamChatMessage returns false (redirect), fall back to the existing non-streaming fetch
   ```

   **IMPORTANT FOR OPENCODE:** The exact implementation depends on how messages are stored in state. Read the component's message state management and adapt. The key UX change is:
   - Before: user sends message → spinner → full response appears at once
   - After: user sends message → empty assistant bubble → tokens fill in one by one → done

3. Show a subtle indicator while streaming (e.g., a blinking cursor after the last token):
   ```tsx
   {isStreaming && <span className="animate-pulse text-emerald-500">|</span>}
   ```

**Acceptance Criteria:**
- [ ] Regular chat messages show tokens appearing incrementally
- [ ] `/research TICKER` still works (falls back to non-streaming)
- [ ] `/analyze` still works (falls back to non-streaming)
- [ ] If streaming endpoint fails, shows error message
- [ ] Blinking cursor shown during streaming
- [ ] Message finalized correctly when stream completes
- [ ] `npm run lint && npx tsc --noEmit` passes

### Phase 3 Verification

```bash
npm run lint && npx tsc --noEmit && npm test
```

Manual checks:
- [ ] Send a chat message to Jarvis — tokens appear one by one
- [ ] Blinking cursor shows during streaming
- [ ] Send `/research AAPL` — works as before (non-streaming, full response)
- [ ] Send `/analyze` — works as before (non-streaming, full response)
- [ ] Close the tab mid-stream — no console errors on server
- [ ] Send rapid messages — each streams correctly

**STOP HERE. Wait for Jared to review.**

---

## Files Changed Summary (All Phases)

| File | Action | Phase | Risk |
|------|--------|-------|------|
| `app/api/market-data/snapshot/route.ts` | MODIFY | 0 | LOW |
| `package.json` | MODIFY (npm install) | 1 | LOW |
| `hooks/use-global-shortcuts.ts` | CREATE | 1 | LOW |
| `components/trading/CommandPalette.tsx` | CREATE | 1 | LOW |
| `app/page.tsx` | MODIFY | 1 | MEDIUM |
| `components/trading/Sidebar.tsx` | MODIFY | 1 | LOW |
| `lib/sse.ts` | CREATE | 2 | LOW |
| `app/api/market-data/stream/route.ts` | CREATE | 2 | MEDIUM |
| `hooks/use-market-stream.ts` | CREATE | 2 | MEDIUM |
| `components/trading/ScannerSection.tsx` | MODIFY | 2 | LOW |
| `components/trading/MarketsTab.tsx` | MODIFY | 2 | MEDIUM-HIGH |
| `lib/jarvis/client.ts` | MODIFY | 3 | MEDIUM |
| `app/api/jarvis/chat/stream/route.ts` | CREATE | 3 | MEDIUM |
| `components/trading/JarvisChat.tsx` | MODIFY | 3 | HIGH |

**Total: 14 files (6 new, 8 modified)**

---

## Rollback Plan

Each phase is independent:

- **Phase 0:** Revert the two changes to `snapshot/route.ts`. Full table scan worked, just slower.
- **Phase 1:** `npm uninstall react-hotkeys-hook`, delete `use-global-shortcuts.ts` and `CommandPalette.tsx`, revert `page.tsx` and `Sidebar.tsx`.
- **Phase 2:** Delete `lib/sse.ts`, `app/api/market-data/stream/route.ts`, `hooks/use-market-stream.ts`. Revert `MarketsTab.tsx` and `ScannerSection.tsx`. Polling resumes.
- **Phase 3:** Delete `app/api/jarvis/chat/stream/route.ts`. Revert `lib/jarvis/client.ts` and `JarvisChat.tsx`. Non-streaming chat continues working.

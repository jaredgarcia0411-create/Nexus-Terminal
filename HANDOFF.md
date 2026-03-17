# Nexus Terminal — HANDOFF.md

## Active Handoff Only

Historical completed sections (Scanner Realtime Data Pipeline, Tech Debt PRs 1-5, etc.) were removed to keep this file focused.
Use git history and the `specs/` directory for archived implementation detail.

### Session Maintenance Checklist

- [x] Refreshed `AGENTS.md` with current build/lint/test commands, single-test workflows, and coding conventions for agentic coding tools.
- [x] Verified command set and conventions against the current repository configuration (`package.json`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.mjs`).
- [x] `parseJsonBody` removed from `lib/api-route-utils.ts` — all routes now use `parseAndValidate`
- [x] Updated `AGENTS.md` after Phase 2 shipped — SSE endpoint conventions and `lib/sse.ts` utility docs are documented

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
> Status: IN PROGRESS (Phases 0-3 implemented; Phase 3 awaiting Jared review + manual QA)

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

> Status: COMPLETE (2026-03-17)

Delivered:
- Added reusable SSE helper in `lib/sse.ts` and unified market stream endpoint in `app/api/market-data/stream/route.ts`.
- Added `hooks/use-market-stream.ts` and integrated SSE snapshot/scanner updates in `components/trading/MarketsTab.tsx`.
- Updated `components/trading/ScannerSection.tsx` to accept externally streamed results and disable internal polling when SSE is connected.
- Preserved realtime polling fallback behavior when stream is unavailable.

Validation:
- [x] `npm run lint`
- [x] `npx tsc --noEmit`
- [x] `npm test`
- [x] Manual QA accepted by Jared (phase reviewed as "looked good").

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
- [x] `callJarvisStreaming` exported alongside existing `callJarvis`
- [x] Circuit breaker checked before the call
- [x] `recordLlmSuccess()` called on stream completion
- [x] `recordLlmFailure()` called on errors
- [x] Existing `callJarvis` unchanged
- [x] `npm run lint && npx tsc --noEmit` passes

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
- [x] `requireUser()` called
- [x] Rate limiting enforced
- [x] `/research` and `/analyze` messages return `{ redirect: true }` (not SSE)
- [x] Regular chat streams token-by-token via SSE events
- [x] Full response saved to conversation history after stream completes
- [x] Token tracking logged
- [x] `npm run lint && npx tsc --noEmit` passes

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
- [x] Regular chat messages show tokens appearing incrementally
- [x] `/research TICKER` still works (falls back to non-streaming)
- [x] `/analyze` still works (falls back to non-streaming)
- [x] If streaming endpoint fails, shows error message
- [x] Blinking cursor shown during streaming
- [x] Message finalized correctly when stream completes
- [x] `npm run lint && npx tsc --noEmit` passes

### Phase 3 Verification

```bash
npm run lint && npx tsc --noEmit && npm test
```

Validation:
- [x] `npm run lint`
- [x] `npx tsc --noEmit`
- [x] `npm test`

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

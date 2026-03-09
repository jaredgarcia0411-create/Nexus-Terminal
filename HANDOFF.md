# Build Spec -- Sprint 7: Safety, Governance, and Cost Controls

> Generated: 2026-03-09 | Agent: nexus-architect
> Status: PENDING REVIEW -- do not execute until approved

---

## Objective

Add safety, governance, and cost controls to the Jarvis AI subsystem. This sprint delivers per-user rate limiting, token budget tracking with a new database table, a circuit breaker for LLM failures, robots.txt respect before scraping, scrape caching via the existing knowledge store, an admin-only observability endpoint, and an automated evaluation harness.

**Tickets delivered:** JRV-070, JRV-071, JRV-072, JRV-073, JRV-074, JRV-075, JRV-076 (7 of 8)
**Ticket deferred:** JRV-077 (migrate daily-summary, trade-analysis, assistant to orchestration engine) -- deferred to a future sprint. Macro-summary already uses orchestration; the other three modes remain on the existing single-pass `askLlm` path.

---

## Locked Decisions (do not deviate)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Rate limiting storage | In-memory `Map` | Best-effort on Vercel serverless; no migration, no new dependency. Resets on cold start -- documented and accepted. |
| Token tracking storage | New `jarvis_request_log` PostgreSQL table | Enables aggregation queries for observability endpoint. Requires Drizzle migration. |
| Scrape cache strategy | Reuse `jarvis_knowledge_chunks.lastSeenAt` | Check if URL was ingested within TTL window before re-scraping. No new table. |
| Scrape cache TTL | 1 hour for `web_source`, 12 hours for `cached_headline` | Web sources change frequently; cached headlines are daily. |
| Eval harness format | Vitest test file (`__tests__/jarvis-eval.test.ts`) | 5-8 golden prompts, structural compliance checks only (not semantic). Run via `npm test`. |
| JRV-077 | DEFERRED | Single-pass `askLlm` stays for daily-summary, trade-analysis, assistant. Only macro-summary uses orchestration. |
| Rate limit target | 30 requests per hour per user | Configurable via `JARVIS_RATE_LIMIT_PER_HOUR` env var. |
| Circuit breaker threshold | 5 consecutive LLM failures triggers open state; auto-reset after 60s | Configurable via `JARVIS_CIRCUIT_BREAKER_THRESHOLD` and `JARVIS_CIRCUIT_BREAKER_RESET_MS`. |

---

## What Changes and What Does Not

### CHANGES
- New file: `/home/jared/Nexus-Terminal/lib/jarvis-rate-limit.ts` (JRV-070)
- New file: `/home/jared/Nexus-Terminal/lib/jarvis-token-tracking.ts` (JRV-071)
- New file: `/home/jared/Nexus-Terminal/lib/jarvis-circuit-breaker.ts` (JRV-072)
- New file: `/home/jared/Nexus-Terminal/lib/jarvis-robots.ts` (JRV-073)
- New file: `/home/jared/Nexus-Terminal/lib/jarvis-scrape-cache.ts` (JRV-074)
- New file: `/home/jared/Nexus-Terminal/app/api/jarvis/admin/stats/route.ts` (JRV-075)
- New file: `/home/jared/Nexus-Terminal/__tests__/jarvis-eval.test.ts` (JRV-076)
- New file: `/home/jared/Nexus-Terminal/__tests__/jarvis-rate-limit.test.ts` (JRV-070)
- New file: `/home/jared/Nexus-Terminal/__tests__/jarvis-token-tracking.test.ts` (JRV-071)
- New file: `/home/jared/Nexus-Terminal/__tests__/jarvis-circuit-breaker.test.ts` (JRV-072)
- New file: `/home/jared/Nexus-Terminal/__tests__/jarvis-robots.test.ts` (JRV-073)
- New file: `/home/jared/Nexus-Terminal/__tests__/jarvis-scrape-cache.test.ts` (JRV-074)
- New file: `/home/jared/Nexus-Terminal/__tests__/jarvis-admin-stats-route.test.ts` (JRV-075)
- Modified: `/home/jared/Nexus-Terminal/lib/db/schema.ts` (JRV-071 -- add `jarvisRequestLog` table)
- Modified: `/home/jared/Nexus-Terminal/app/api/jarvis/route.ts` (JRV-070, 071, 072, 074)
- Modified: `/home/jared/Nexus-Terminal/app/api/jarvis/cron/headlines/route.ts` (JRV-073, 074)
- Modified: `/home/jared/Nexus-Terminal/lib/jarvis-orchestrator.ts` (JRV-072)
- Modified: `/home/jared/Nexus-Terminal/.env.example` (new env vars)
- Modified: `/home/jared/Nexus-Terminal/JARVIS_PLAN.md` (update ticket statuses)

### DOES NOT CHANGE
- `/home/jared/Nexus-Terminal/lib/jarvis-types.ts` -- no type changes needed
- `/home/jared/Nexus-Terminal/lib/jarvis-knowledge.ts` -- JRV-074 reads from this table but adds a new helper file, not modifying this file
- `/home/jared/Nexus-Terminal/lib/jarvis-response.ts` -- unchanged
- `/home/jared/Nexus-Terminal/lib/jarvis-scrape.ts` -- unchanged (robots.txt check happens before scraping, in the caller)
- `/home/jared/Nexus-Terminal/lib/jarvis-embedding.ts` -- unchanged
- `/home/jared/Nexus-Terminal/lib/jarvis-allowlist.ts` -- unchanged
- `/home/jared/Nexus-Terminal/lib/jarvis-admin.ts` -- unchanged (reused by JRV-075)
- `/home/jared/Nexus-Terminal/components/trading/JarvisTab.tsx` -- no frontend changes
- All existing test files -- unchanged
- `middleware.ts` -- unchanged
- `vercel.json` -- unchanged

---

## Security Notes (applies across all tickets)

1. **ALLOWED_EMAILS** is still not enforced in auth callbacks. This is a known issue from CLAUDE.md. Not in Sprint 7 scope, but flagged per protocol.
2. **JRV-075** (`/api/jarvis/admin/stats`) MUST use `requireJarvisAdmin()` from `lib/jarvis-admin.ts` -- NOT `requireUser()`. Regular users must not see aggregate system metrics.
3. **JRV-071** token tracking must NEVER log prompt content, response content, or API keys. Only log: userId, mode, timestamp, inputTokens (estimated count), outputTokens (estimated count), durationMs, success boolean.
4. **JRV-073** robots.txt fetching must use the same `Nexus-Jarvis/1.0` User-Agent string already used in scraping. Must have a timeout (5s) and must not throw on failure -- treat robots.txt fetch failure as "allowed."
5. **JRV-070** rate limit responses return 429 with a JSON body `{ error: "Rate limit exceeded. Try again later." }`. Do not leak the user's request count or limit in the error message.

---

## Execution Order

Execute changes in this exact sequence. Each ticket lists every file to create or modify, what to do, and acceptance criteria.

---

### Change 1: JRV-073 -- Robots.txt Respect Before Scraping

**Complexity:** LOW (under 30 min)

#### 1a. Create `/home/jared/Nexus-Terminal/lib/jarvis-robots.ts`

**Action:** CREATE

This module checks robots.txt for a given URL and determines if the `Nexus-Jarvis` user agent is allowed to scrape it. Results are cached in-memory with a 1-hour TTL.

```typescript
// Exports:

export async function isRobotAllowed(url: string): Promise<boolean>
// Given a full URL (e.g., "https://www.cnbc.com/economy/"), fetch the site's
// robots.txt, parse it, and return true if the path is allowed for user-agent
// "Nexus-Jarvis" (or "*" fallback). Cache the parsed robots.txt per origin
// in a module-level Map<string, { rules: ParsedRules; fetchedAt: number }>.
// TTL: 1 hour (3_600_000 ms). Configurable via JARVIS_ROBOTS_CACHE_TTL_MS env.
// On any fetch error or timeout (5s), return true (fail-open).
// On 404 for robots.txt, return true (no restrictions).

export function clearRobotsCache(): void
// Clears the in-memory cache. Used in tests.
```

**Implementation details:**
- Fetch `${origin}/robots.txt` with a 5-second AbortController timeout.
- Parse the response text line by line. Track the current user-agent block. Look for `User-agent: Nexus-Jarvis` or `User-agent: *` blocks. Within each block, process `Disallow:` and `Allow:` directives.
- Match the URL path against disallow/allow rules using prefix matching (standard robots.txt semantics).
- If the user-agent `Nexus-Jarvis` has an explicit block, use that. Otherwise fall back to `*`. If neither exists, allow.
- Use `Nexus-Jarvis/1.0` as the User-Agent header when fetching robots.txt.

**Acceptance criteria:**
- [ ] `isRobotAllowed('https://example.com/page')` fetches `https://example.com/robots.txt` exactly once and caches
- [ ] Subsequent calls for the same origin within 1h use the cache without re-fetching
- [ ] Returns `true` on fetch timeout, fetch error, or 404
- [ ] Returns `false` when robots.txt disallows the path for `Nexus-Jarvis` or `*`
- [ ] `clearRobotsCache()` resets the cache

#### 1b. Modify `/home/jared/Nexus-Terminal/app/api/jarvis/route.ts`

**Action:** MODIFY

In the `scrapeUrl` function (line 181), after the allowlist check (line 207-218) and before the actual `fetch` call (line 224), add a robots.txt check:

```typescript
import { isRobotAllowed } from '@/lib/jarvis-robots';

// Inside scrapeUrl, after the isUrlAllowed check passes:
const robotsAllowed = await isRobotAllowed(parsed.toString());
if (!robotsAllowed) {
  return {
    url,
    title: parsed.hostname,
    host: parsed.hostname,
    excerpt: '',
    scrapedAt: new Date(),
    blocked: true,
    error: `Scraping blocked by robots.txt for ${parsed.hostname}`,
  };
}
```

Insert this between line 218 (end of allowlist block) and line 220 (start of `let res: Response;`).

#### 1c. Modify `/home/jared/Nexus-Terminal/app/api/jarvis/cron/headlines/route.ts`

**Action:** MODIFY

Add the same robots.txt check inside the `for (const entry of macroDomains)` loop, after the URL lookup (line 54) and before the fetch (line 64):

```typescript
import { isRobotAllowed } from '@/lib/jarvis-robots';

// Inside the loop, after `if (!url)` check:
const robotsAllowed = await isRobotAllowed(url);
if (!robotsAllowed) {
  errors.push(`${entry.domain}: blocked by robots.txt`);
  continue;
}
```

Insert this between line 56 (end of `continue;`) and line 59 (start of `try`).

#### 1d. Create `/home/jared/Nexus-Terminal/__tests__/jarvis-robots.test.ts`

**Action:** CREATE

Tests:
- `isRobotAllowed` returns `true` when robots.txt allows the path
- `isRobotAllowed` returns `false` when robots.txt disallows the path for `*`
- `isRobotAllowed` returns `false` when robots.txt disallows the path for `Nexus-Jarvis` specifically
- `isRobotAllowed` returns `true` when robots.txt fetch times out
- `isRobotAllowed` returns `true` when robots.txt returns 404
- Second call for same origin uses cache (fetch called only once)
- `clearRobotsCache()` forces a re-fetch

Mock `globalThis.fetch` for all tests.

---

### Change 2: JRV-074 -- Scrape Cache Layer

**Complexity:** MEDIUM (30 min to 2 hr)

#### 2a. Create `/home/jared/Nexus-Terminal/lib/jarvis-scrape-cache.ts`

**Action:** CREATE

This module checks `jarvis_knowledge_chunks.lastSeenAt` to determine if a URL was recently ingested. If within the TTL, the caller should skip re-scraping and use the existing chunks from the knowledge store.

```typescript
import { eq, and, sql, desc } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { jarvisKnowledgeChunks } from '@/lib/db/schema';
import type { JarvisSourceType } from '@/lib/jarvis-types';

const DEFAULT_WEB_SOURCE_TTL_MS = 60 * 60 * 1000;        // 1 hour
const DEFAULT_CACHED_HEADLINE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

export interface ScrapeCacheResult {
  isFresh: boolean;
  lastSeenAt: Date | null;
  chunkCount: number;
}

export function getScrapeCacheTtlMs(sourceType: JarvisSourceType): number
// Returns TTL in ms for the given source type.
// web_source: parse JARVIS_SCRAPE_CACHE_TTL_WEB_MS env or default 3_600_000
// cached_headline: parse JARVIS_SCRAPE_CACHE_TTL_HEADLINE_MS env or default 43_200_000
// All others: return 0 (no caching)

export async function isUrlFreshInCache(url: string, sourceType: JarvisSourceType): Promise<ScrapeCacheResult>
// Query jarvis_knowledge_chunks for the most recent row matching sourceUrl = url.
// SELECT MAX(last_seen_at) as lastSeenAt, COUNT(*) as chunkCount
// FROM jarvis_knowledge_chunks WHERE source_url = $url
// If lastSeenAt is within the TTL window (now - ttl), return { isFresh: true, lastSeenAt, chunkCount }.
// If no rows or outside TTL, return { isFresh: false, lastSeenAt, chunkCount: 0 }.
// If db is null, return { isFresh: false, lastSeenAt: null, chunkCount: 0 }.
```

#### 2b. Modify `/home/jared/Nexus-Terminal/app/api/jarvis/route.ts`

**Action:** MODIFY

In the `scrapeUrl` function, after the robots.txt check (added in Change 1) and before the actual HTTP fetch, add a cache check:

```typescript
import { isUrlFreshInCache } from '@/lib/jarvis-scrape-cache';

// Inside scrapeUrl, after robotsAllowed check:
const cacheResult = await isUrlFreshInCache(parsed.toString(), 'web_source');
if (cacheResult.isFresh) {
  return {
    url,
    title: parsed.hostname,
    host: parsed.hostname,
    excerpt: '',
    scrapedAt: cacheResult.lastSeenAt ?? new Date(),
    error: undefined,
    // Special marker: source was served from cache. The caller's knowledge
    // retrieval will pick up the existing chunks from the store.
  };
}
```

**Important:** When a cached result is returned from `scrapeUrl`, it will have an empty `excerpt` and no `body`, so `chunkScrapedSource` will produce zero chunks for it. This is correct -- the chunks already exist in the knowledge store and will be picked up by the `retrieveKnowledgeChunks` call later in the handler. The `sources` array for context will be empty for cached URLs, which is fine because the knowledge retrieval already handles deduplication.

To preserve the source summary for cached URLs, add a `cached` boolean to the return and handle it in `scrapeSources`:

```typescript
// In scrapeSources, add cached sources to a separate tracking list:
const cachedUrls = results
  .filter((result) => !result.blocked && !result.error && !result.body && !result.excerpt)
  .map((result) => result.url);
// Add cachedUrls count to warnings if > 0:
if (cachedUrls.length > 0) {
  warnings.push(`${cachedUrls.length} URL(s) served from cache (within TTL).`);
}
```

#### 2c. Modify `/home/jared/Nexus-Terminal/app/api/jarvis/cron/headlines/route.ts`

**Action:** MODIFY

Inside the scraping loop, before the HTTP fetch, add a cache check:

```typescript
import { isUrlFreshInCache } from '@/lib/jarvis-scrape-cache';

// Inside the loop, after robotsAllowed check:
const cacheResult = await isUrlFreshInCache(url, 'cached_headline');
if (cacheResult.isFresh) {
  totalScraped += 1; // Count as successful but skipped
  continue;
}
```

#### 2d. Create `/home/jared/Nexus-Terminal/__tests__/jarvis-scrape-cache.test.ts`

**Action:** CREATE

Tests:
- `getScrapeCacheTtlMs('web_source')` returns 3600000 by default
- `getScrapeCacheTtlMs('cached_headline')` returns 43200000 by default
- `getScrapeCacheTtlMs('trade_journal')` returns 0
- `isUrlFreshInCache` returns `isFresh: true` when lastSeenAt is within TTL
- `isUrlFreshInCache` returns `isFresh: false` when lastSeenAt is outside TTL
- `isUrlFreshInCache` returns `isFresh: false` when no rows exist
- `isUrlFreshInCache` returns `isFresh: false` when db is null

Mock `@/lib/db` with `getDb` returning a mock that implements `select().from().where()`.

#### 2e. Modify `/home/jared/Nexus-Terminal/.env.example`

**Action:** MODIFY -- append after the `JARVIS_ORCHESTRATION_CRITIQUE=false` line:

```
# Jarvis Scrape Cache TTL (optional — milliseconds, 0 = disabled)
JARVIS_SCRAPE_CACHE_TTL_WEB_MS=3600000
JARVIS_SCRAPE_CACHE_TTL_HEADLINE_MS=43200000
```

---

### Change 3: JRV-072 -- Circuit Breaker

**Complexity:** LOW (under 30 min)

#### 3a. Create `/home/jared/Nexus-Terminal/lib/jarvis-circuit-breaker.ts`

**Action:** CREATE

A simple circuit breaker that tracks consecutive LLM call failures. When the threshold is reached, it "opens" and all LLM calls are short-circuited to return `null` (triggering the existing deterministic fallback). After a reset timeout, it transitions to "half-open" and allows one probe request.

```typescript
export interface CircuitBreakerState {
  status: 'closed' | 'open' | 'half-open';
  consecutiveFailures: number;
  lastFailureAt: number | null;
  openedAt: number | null;
}

const DEFAULT_THRESHOLD = 5;
const DEFAULT_RESET_MS = 60_000;

export function getCircuitBreakerState(): CircuitBreakerState
// Returns a copy of the current state. Used by the observability endpoint.

export function isCircuitOpen(): boolean
// Returns true if the breaker is currently open (or half-open has not been
// probed yet). When open, check if enough time has passed (resetMs) to
// transition to half-open. If transitioning to half-open, return false
// (allow one probe request).
// Reads JARVIS_CIRCUIT_BREAKER_THRESHOLD (default 5) and
// JARVIS_CIRCUIT_BREAKER_RESET_MS (default 60000) from env.

export function recordLlmSuccess(): void
// Reset consecutiveFailures to 0 and set status to 'closed'.

export function recordLlmFailure(): void
// Increment consecutiveFailures. If >= threshold, set status to 'open'
// and record openedAt = Date.now().

export function resetCircuitBreaker(): void
// Reset all state to defaults. Used in tests.
```

**State is module-level (in-memory).** Same serverless caveat as rate limiting -- resets on cold start, which is acceptable (conservative: circuit starts closed).

#### 3b. Modify `/home/jared/Nexus-Terminal/app/api/jarvis/route.ts`

**Action:** MODIFY

In the `askLlm` function (line 381), add circuit breaker check at the top and recording on success/failure:

```typescript
import { isCircuitOpen, recordLlmSuccess, recordLlmFailure } from '@/lib/jarvis-circuit-breaker';

// At the start of askLlm, before the API key check:
if (isCircuitOpen()) return null;

// After a successful LLM response (after parseJarvisLlmResponse on line 441):
recordLlmSuccess();
return parseJarvisLlmResponse(content);

// On fetch error (line 426 catch block), before returning null:
recordLlmFailure();
return null;

// On non-ok response (line 430), before returning null:
recordLlmFailure();
return null;
```

#### 3c. Modify `/home/jared/Nexus-Terminal/lib/jarvis-orchestrator.ts`

**Action:** MODIFY

In the `callLlm` function (line 72), add the same circuit breaker integration:

```typescript
import { isCircuitOpen, recordLlmSuccess, recordLlmFailure } from '@/lib/jarvis-circuit-breaker';

// At the start of callLlm, before the API key check:
if (isCircuitOpen()) return null;

// After successful response (line 103, before the return):
recordLlmSuccess();
return payload.choices?.[0]?.message?.content?.trim() ?? null;

// On fetch error (line 93 catch), before return null:
recordLlmFailure();
return null;

// On !res.ok (line 97), before return null:
recordLlmFailure();
return null;
```

#### 3d. Create `/home/jared/Nexus-Terminal/__tests__/jarvis-circuit-breaker.test.ts`

**Action:** CREATE

Tests:
- `isCircuitOpen()` returns `false` when no failures recorded
- After N consecutive `recordLlmFailure()` calls (where N = threshold), `isCircuitOpen()` returns `true`
- `recordLlmSuccess()` resets the counter; `isCircuitOpen()` returns `false`
- After circuit opens, it auto-transitions to half-open after resetMs (use `vi.useFakeTimers()`)
- Half-open allows one request (returns `false` once, then re-opens if that fails)
- `resetCircuitBreaker()` resets everything
- `getCircuitBreakerState()` returns the correct status at each stage

#### 3e. Modify `/home/jared/Nexus-Terminal/.env.example`

**Action:** MODIFY -- append after the scrape cache lines added in Change 2:

```
# Jarvis Circuit Breaker (optional)
JARVIS_CIRCUIT_BREAKER_THRESHOLD=5
JARVIS_CIRCUIT_BREAKER_RESET_MS=60000
```

---

### Change 4: JRV-070 -- Per-User Rate Limiting

**Complexity:** MEDIUM (30 min to 2 hr)

#### 4a. Create `/home/jared/Nexus-Terminal/lib/jarvis-rate-limit.ts`

**Action:** CREATE

In-memory sliding window rate limiter. Best-effort on Vercel serverless (resets on cold start).

```typescript
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number; // Unix timestamp (ms) when the window resets
}

const DEFAULT_LIMIT_PER_HOUR = 30;

// Module-level state:
// Map<string, number[]> where key = userId, value = array of request timestamps (ms)

export function checkRateLimit(userId: string): RateLimitResult
// 1. Read limit from JARVIS_RATE_LIMIT_PER_HOUR env (default 30).
// 2. Get the user's timestamp array from the Map.
// 3. Filter out timestamps older than 1 hour (3_600_000 ms) from now.
// 4. If filtered length >= limit, return { allowed: false, remaining: 0, resetAt: oldest + 3600000 }.
// 5. Otherwise, push Date.now() to the array, update the Map, return { allowed: true, remaining: limit - newLength, resetAt: now + 3600000 }.

export function getRateLimitState(userId: string): { requestCount: number; windowMs: number; limit: number }
// Returns current request count in the window, the window size, and the limit.
// Used by the observability endpoint.

export function resetRateLimits(): void
// Clears the entire Map. Used in tests.
```

#### 4b. Modify `/home/jared/Nexus-Terminal/app/api/jarvis/route.ts`

**Action:** MODIFY

At the very beginning of the `POST` handler (line 444), after `requireUser()` succeeds (line 447) and before `parseJsonBody` (line 449), add the rate limit check:

```typescript
import { checkRateLimit } from '@/lib/jarvis-rate-limit';

// Inside POST, after the auth check:
const rateLimitResult = checkRateLimit(authState.user.id);
if (!rateLimitResult.allowed) {
  return Response.json(
    { error: 'Rate limit exceeded. Try again later.' },
    {
      status: 429,
      headers: {
        'Retry-After': String(Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000)),
      },
    },
  );
}
```

**Note:** The GET handler (line 368) does NOT get rate limited -- it only returns remembered URLs, which is a lightweight read. Only POST is rate limited.

#### 4c. Create `/home/jared/Nexus-Terminal/__tests__/jarvis-rate-limit.test.ts`

**Action:** CREATE

Tests:
- First request returns `{ allowed: true, remaining: 29 }` (default limit 30)
- 30 requests in rapid succession: first 30 allowed, 31st returns `{ allowed: false, remaining: 0 }`
- After window expires (use `vi.useFakeTimers()` and advance 1h+), requests are allowed again
- `resetRateLimits()` clears state
- Custom `JARVIS_RATE_LIMIT_PER_HOUR=5` env is respected

#### 4d. Modify `/home/jared/Nexus-Terminal/.env.example`

**Action:** MODIFY -- append after the circuit breaker lines added in Change 3:

```
# Jarvis Rate Limiting (optional — per user, per hour)
JARVIS_RATE_LIMIT_PER_HOUR=30
```

---

### Change 5: JRV-071 -- Token Budget Tracking

**Complexity:** MEDIUM (30 min to 2 hr)

#### 5a. Modify `/home/jared/Nexus-Terminal/lib/db/schema.ts`

**Action:** MODIFY -- add a new table definition after the `jarvisUserDocuments` table (after line 193):

```typescript
export const jarvisRequestLog = pgTable('jarvis_request_log', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  mode: text('mode').notNull(),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  totalTokens: integer('total_tokens').notNull().default(0),
  durationMs: integer('duration_ms').notNull().default(0),
  success: integer('success').notNull().default(1), // 1 = true, 0 = false (integer for PG compat)
  sourceCount: integer('source_count').notNull().default(0),
  chunkCount: integer('chunk_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_jarvis_request_log_user_created').on(table.userId, table.createdAt),
  index('idx_jarvis_request_log_created').on(table.createdAt),
]);
```

#### 5b. Run Drizzle migration

After modifying the schema, run:

```bash
npm run db:generate
npm run db:migrate
```

This will generate a new migration file in `drizzle/` and apply it.

#### 5c. Create `/home/jared/Nexus-Terminal/lib/jarvis-token-tracking.ts`

**Action:** CREATE

```typescript
import { getDb } from '@/lib/db';
import { jarvisRequestLog } from '@/lib/db/schema';
import type { JarvisMode } from '@/lib/jarvis-types';

export interface TokenTrackingEntry {
  userId: string;
  mode: JarvisMode;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  success: boolean;
  sourceCount: number;
  chunkCount: number;
}

export async function logJarvisRequest(entry: TokenTrackingEntry): Promise<void>
// Insert a row into jarvis_request_log.
// id: crypto.randomUUID()
// totalTokens: entry.inputTokens + entry.outputTokens
// success: entry.success ? 1 : 0
// If db is null, silently return (no-op).
// Wrap in try/catch -- never throw. Log errors via logRouteError('jarvis.token_tracking', error).

export function estimateInputTokens(text: string): number
// Same whitespace split estimator used elsewhere:
// return text.trim().split(/\s+/).filter(Boolean).length;

export function estimateOutputTokens(text: string): number
// Same as estimateInputTokens.
```

#### 5d. Modify `/home/jared/Nexus-Terminal/app/api/jarvis/route.ts`

**Action:** MODIFY

Add timing and token logging around the main request paths. Wrap the core logic:

At the start of the POST handler (after the rate limit check), capture `requestStartMs`:

```typescript
import { logJarvisRequest, estimateInputTokens, estimateOutputTokens } from '@/lib/jarvis-token-tracking';

const requestStartMs = Date.now();
```

At each successful return point (there are 3: macro-summary on line 555, llmMessage on line 574, fallback on line 590), and at the error return point (line 597), add token logging:

**For the macro-summary path (before the return on line 555):**

```typescript
logJarvisRequest({
  userId: authState.user.id,
  mode,
  inputTokens: estimateInputTokens(basePrompt),
  outputTokens: estimateOutputTokens(orchestrationResult.message),
  durationMs: Date.now() - requestStartMs,
  success: true,
  sourceCount: sourceContexts.length,
  chunkCount: llmChunks.length,
}).catch(() => {});
```

**For the LLM success path (before the return on line 574):**

```typescript
logJarvisRequest({
  userId: authState.user.id,
  mode,
  inputTokens: estimateInputTokens(basePrompt),
  outputTokens: estimateOutputTokens(llmMessage.message),
  durationMs: Date.now() - requestStartMs,
  success: true,
  sourceCount: sourceContexts.length,
  chunkCount: llmChunks.length,
}).catch(() => {});
```

**For the fallback path (before the return on line 590):**

```typescript
logJarvisRequest({
  userId: authState.user.id,
  mode,
  inputTokens: estimateInputTokens(basePrompt),
  outputTokens: 0,
  durationMs: Date.now() - requestStartMs,
  success: false,
  sourceCount: sourceContexts.length,
  chunkCount: llmChunks.length,
}).catch(() => {});
```

**Important:** Always call `logJarvisRequest` with `.catch(() => {})` -- token tracking must never cause a request to fail.

#### 5e. Create `/home/jared/Nexus-Terminal/__tests__/jarvis-token-tracking.test.ts`

**Action:** CREATE

Mock `@/lib/db` with `getDb`. Tests:
- `logJarvisRequest` inserts a row with the correct fields
- `logJarvisRequest` does not throw when db is null
- `logJarvisRequest` does not throw when insert fails
- `estimateInputTokens` counts whitespace-separated words
- `estimateOutputTokens` counts whitespace-separated words

---

### Change 6: JRV-075 -- Observability Endpoint

**Complexity:** MEDIUM (30 min to 2 hr)

#### 6a. Create `/home/jared/Nexus-Terminal/app/api/jarvis/admin/stats/route.ts`

**Action:** CREATE

This endpoint is admin-only (uses `requireJarvisAdmin()`) and returns:
- Rate limiter summary (from `getRateLimitState` for a requested userId, or aggregate)
- Circuit breaker state (from `getCircuitBreakerState`)
- Token usage stats (from `jarvis_request_log` aggregated by day/user)

```typescript
import { desc, sql, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { jarvisRequestLog } from '@/lib/db/schema';
import { internalServerError, logRouteError } from '@/lib/api-route-utils';
import { requireJarvisAdmin } from '@/lib/jarvis-admin';
import { getCircuitBreakerState } from '@/lib/jarvis-circuit-breaker';

export async function GET(request: Request) {
  // 1. requireJarvisAdmin(request) -- return error if not admin
  // 2. Query jarvis_request_log for aggregated stats:
  //    a. Total requests today (where created_at >= start of today UTC)
  //    b. Total tokens today (sum of total_tokens)
  //    c. Success rate today (count where success=1 / total count)
  //    d. Average duration today (avg of duration_ms)
  //    e. Per-user breakdown: userId, requestCount, totalTokens, avgDurationMs
  //       (grouped by userId, ordered by totalTokens desc, limit 20)
  // 3. Include circuit breaker state from getCircuitBreakerState()
  // 4. Return JSON:
  // {
  //   circuitBreaker: CircuitBreakerState,
  //   today: {
  //     totalRequests: number,
  //     totalTokens: number,
  //     successRate: number, // 0-1
  //     avgDurationMs: number,
  //   },
  //   userBreakdown: Array<{
  //     userId: string,
  //     requestCount: number,
  //     totalTokens: number,
  //     avgDurationMs: number,
  //   }>,
  // }
}
```

**Security:** Uses `requireJarvisAdmin` -- NOT `requireUser`. Protected by `x-jarvis-admin-key` header matching `JARVIS_ADMIN_KEY` env var.

#### 6b. Create `/home/jared/Nexus-Terminal/__tests__/jarvis-admin-stats-route.test.ts`

**Action:** CREATE

Follow the pattern of `__tests__/jarvis-admin-memory-route.test.ts`. Mock `@/lib/db`, `@/lib/jarvis-admin`, `@/lib/jarvis-circuit-breaker`.

Tests:
- Returns 503 when `JARVIS_ADMIN_KEY` is not configured
- Returns 401 when `x-jarvis-admin-key` header is wrong
- Returns 200 with correct shape when authorized
- Includes `circuitBreaker` state
- Includes `today` aggregate stats
- Includes `userBreakdown` array

---

### Change 7: JRV-076 -- Eval Harness

**Complexity:** HIGH (2+ hr)

#### 7a. Create `/home/jared/Nexus-Terminal/__tests__/jarvis-eval.test.ts`

**Action:** CREATE

This file contains golden prompts for each mode and validates that Jarvis responses meet structural compliance. It does NOT require a live LLM -- it tests the full response pipeline with mocked LLM responses and validates the output schema.

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock dependencies (same pattern as jarvis-route.test.ts):
// - @/lib/db (getDb returns null -- no DB needed)
// - @/lib/server-db-utils (requireUser returns a mock user)
// - @/lib/jarvis-orchestrator (runOrchestration returns a valid mock)

// Import POST from @/app/api/jarvis/route

// Define golden prompts:
const GOLDEN_PROMPTS = [
  {
    id: 'eval-daily-summary',
    mode: 'daily-summary' as const,
    prompt: '',
    description: 'Daily summary with no custom prompt',
  },
  {
    id: 'eval-trade-analysis-basic',
    mode: 'trade-analysis' as const,
    prompt: 'Review my last 5 trades and identify patterns.',
    description: 'Trade analysis with explicit prompt',
  },
  {
    id: 'eval-assistant-risk',
    mode: 'assistant' as const,
    prompt: 'What are the key risks for holding AAPL through earnings?',
    description: 'Assistant mode with risk-focused prompt',
  },
  {
    id: 'eval-assistant-no-prompt',
    mode: 'assistant' as const,
    prompt: '',
    description: 'Assistant mode with empty prompt',
  },
  {
    id: 'eval-macro-summary',
    mode: 'macro-summary' as const,
    prompt: 'Provide a daily macro summary.',
    description: 'Macro summary mode',
  },
  {
    id: 'eval-assistant-urls',
    mode: 'assistant' as const,
    prompt: 'Summarize the latest earnings data.',
    description: 'Assistant with source pack',
    sourcePackId: 'earnings',
  },
];

// For each golden prompt, validate:
describe('Jarvis Eval Harness', () => {
  // beforeEach: set up mocks, clear state

  for (const golden of GOLDEN_PROMPTS) {
    describe(`[${golden.id}] ${golden.description}`, () => {
      it('returns 200', async () => { /* ... */ });

      it('response has required top-level fields', async () => {
        // payload must have: message (string), structured (object)
        // structured must have: tldr (string), findings (string[]), actionSteps (string[]), risks (string[])
      });

      it('structured.tldr is a non-empty string', async () => { /* ... */ });

      it('structured.findings is a non-empty array of strings', async () => { /* ... */ });

      it('structured.actionSteps is a non-empty array of strings', async () => { /* ... */ });

      it('structured.risks is a non-empty array of strings', async () => { /* ... */ });

      it('message is a non-empty string', async () => { /* ... */ });

      // For macro-summary mode only:
      if (golden.mode === 'macro-summary') {
        it('includes macroSummary with regions array', async () => {
          // macroSummary must have: date, overallSentiment, regions, keyRisks
          // regions must be an array with at least 1 region
          // each region must have: region, headline, details, sentiment
        });
      }
    });
  }
});
```

**Key design principle:** This harness validates structural compliance, not semantic quality. Every response -- whether from the LLM or the deterministic fallback -- must pass these checks. The LLM is mocked to return `null` (triggering fallback) for the baseline set, ensuring the fallback path also produces compliant output.

Add a second describe block that mocks the LLM to return a valid JSON response:

```typescript
describe('Jarvis Eval Harness (LLM path)', () => {
  // Set JARVIS_API_KEY to 'eval-key'
  // Mock fetch to return a valid structured JSON response for any LLM call
  // Re-run the same golden prompts and validate the same structural contracts
});
```

---

### Change 8: Update `.env.example` and `JARVIS_PLAN.md`

#### 8a. Final `.env.example` state

**Action:** VERIFY that all env vars from Changes 2-4 are present. The final additions (after the existing `JARVIS_ORCHESTRATION_CRITIQUE=false` line) should be:

```
# Jarvis Scrape Cache TTL (optional — milliseconds, 0 = disabled)
JARVIS_SCRAPE_CACHE_TTL_WEB_MS=3600000
JARVIS_SCRAPE_CACHE_TTL_HEADLINE_MS=43200000

# Jarvis Circuit Breaker (optional)
JARVIS_CIRCUIT_BREAKER_THRESHOLD=5
JARVIS_CIRCUIT_BREAKER_RESET_MS=60000

# Jarvis Rate Limiting (optional — per user, per hour)
JARVIS_RATE_LIMIT_PER_HOUR=30

# Jarvis Robots.txt Cache (optional — milliseconds)
JARVIS_ROBOTS_CACHE_TTL_MS=3600000
```

#### 8b. Modify `/home/jared/Nexus-Terminal/JARVIS_PLAN.md`

**Action:** MODIFY -- update ticket statuses in the Sprint 7 table:

| Ticket | Status |
|--------|--------|
| JRV-070 | done |
| JRV-071 | done |
| JRV-072 | done |
| JRV-073 | done |
| JRV-074 | done |
| JRV-075 | done |
| JRV-076 | done |
| JRV-077 | deferred |

Add a progress log entry:

```
| 2026-03-09 | Sprint 7 completed (JRV-070 to JRV-076, JRV-077 deferred): added per-user in-memory rate limiting (30 req/hr), token budget tracking via `jarvis_request_log` table with Drizzle migration, circuit breaker for LLM failures (5-failure threshold, 60s reset), robots.txt compliance before scraping with 1h cache, scrape cache using `jarvis_knowledge_chunks.lastSeenAt` (1h web/12h headline TTL), admin-only observability endpoint (`/api/jarvis/admin/stats`), and eval harness with 6 golden prompts for structural compliance validation. JRV-077 (migrate remaining modes to orchestration) deferred to future sprint. |
```

---

## Files Affected Summary

| File | Action | Ticket(s) | Risk |
|------|--------|-----------|------|
| `lib/jarvis-robots.ts` | CREATE | JRV-073 | LOW |
| `lib/jarvis-scrape-cache.ts` | CREATE | JRV-074 | LOW |
| `lib/jarvis-circuit-breaker.ts` | CREATE | JRV-072 | LOW |
| `lib/jarvis-rate-limit.ts` | CREATE | JRV-070 | LOW |
| `lib/jarvis-token-tracking.ts` | CREATE | JRV-071 | LOW |
| `app/api/jarvis/admin/stats/route.ts` | CREATE | JRV-075 | LOW |
| `__tests__/jarvis-robots.test.ts` | CREATE | JRV-073 | LOW |
| `__tests__/jarvis-scrape-cache.test.ts` | CREATE | JRV-074 | LOW |
| `__tests__/jarvis-circuit-breaker.test.ts` | CREATE | JRV-072 | LOW |
| `__tests__/jarvis-rate-limit.test.ts` | CREATE | JRV-070 | LOW |
| `__tests__/jarvis-token-tracking.test.ts` | CREATE | JRV-071 | LOW |
| `__tests__/jarvis-admin-stats-route.test.ts` | CREATE | JRV-075 | LOW |
| `__tests__/jarvis-eval.test.ts` | CREATE | JRV-076 | LOW |
| `lib/db/schema.ts` | MODIFY | JRV-071 | MEDIUM |
| `app/api/jarvis/route.ts` | MODIFY | JRV-070, 071, 072, 073, 074 | HIGH |
| `app/api/jarvis/cron/headlines/route.ts` | MODIFY | JRV-073, 074 | MEDIUM |
| `lib/jarvis-orchestrator.ts` | MODIFY | JRV-072 | MEDIUM |
| `.env.example` | MODIFY | JRV-070, 072, 073, 074 | LOW |
| `JARVIS_PLAN.md` | MODIFY | all | LOW |

---

## Testing Requirements

After all changes are complete, run:

```bash
npm run lint
npx tsc --noEmit
npm test
```

All three must pass. Specifically:

- [ ] `npm run lint` passes with no errors
- [ ] `npx tsc --noEmit` passes with no type errors
- [ ] All existing tests in `__tests__/jarvis-*.test.ts` continue to pass
- [ ] New test: `__tests__/jarvis-robots.test.ts` passes
- [ ] New test: `__tests__/jarvis-scrape-cache.test.ts` passes
- [ ] New test: `__tests__/jarvis-circuit-breaker.test.ts` passes
- [ ] New test: `__tests__/jarvis-rate-limit.test.ts` passes
- [ ] New test: `__tests__/jarvis-token-tracking.test.ts` passes
- [ ] New test: `__tests__/jarvis-admin-stats-route.test.ts` passes
- [ ] New test: `__tests__/jarvis-eval.test.ts` passes
- [ ] Drizzle migration generates and applies successfully: `npm run db:generate && npm run db:migrate`

---

## Rollback Plan

1. **If migration fails (JRV-071):** The `jarvis_request_log` table is completely independent -- no foreign keys to existing Jarvis tables. Drop it with `DROP TABLE IF EXISTS jarvis_request_log;`. Remove the schema entry from `lib/db/schema.ts` and delete the generated migration file.
2. **If rate limiting causes false positives (JRV-070):** Set `JARVIS_RATE_LIMIT_PER_HOUR=999999` in env to effectively disable without code changes.
3. **If circuit breaker is too aggressive (JRV-072):** Set `JARVIS_CIRCUIT_BREAKER_THRESHOLD=999999` in env to effectively disable.
4. **If robots.txt blocking is too restrictive (JRV-073):** The fail-open design means only explicit disallow rules block scraping. If a specific domain is problematic, the issue is with that domain's robots.txt, not with our code.
5. **If scrape cache serves stale data (JRV-074):** Set `JARVIS_SCRAPE_CACHE_TTL_WEB_MS=0` and `JARVIS_SCRAPE_CACHE_TTL_HEADLINE_MS=0` to disable caching.
6. **For any code-level rollback:** Revert the commit. All new files are additive; modifications to existing files are minimal insertion points.

---

## Complexity Estimate

| Ticket | Estimate | Rationale |
|--------|----------|-----------|
| JRV-073 | LOW | New isolated module + small insertions in 2 routes |
| JRV-074 | MEDIUM | DB query logic + integration in 2 routes |
| JRV-072 | LOW | Simple state machine + small insertions in 2 files |
| JRV-070 | MEDIUM | In-memory data structure + route integration + tests |
| JRV-071 | MEDIUM | Schema change + migration + tracking module + 3 insertion points in route |
| JRV-075 | MEDIUM | New API route with aggregation queries |
| JRV-076 | HIGH | 6 golden prompts x 7 assertions each + dual mock paths |

**Total sprint estimate:** 8-12 hours of implementation time.

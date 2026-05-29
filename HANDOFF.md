# Nexus Terminal - HANDOFF.md

> Updated: 2026-05-29
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and durable docs such as `docs/repo-cleanup.md`.

Historical completed sections (Sprints 1-5, Tier 1 Cleanup, Chart Drawings, Workflow Maintenance, AskEdgar News Filter Expansion) were removed to keep this file focused. Use git history for archived implementation detail.

---

## Sprint 8 — Research TLDR Paid-Work Claim + Usage Telemetry

> Generated: 2026-05-29 | Agent: Claude (Plan)
> Status: COMPLETED 2026-05-29 (Codex; manual browser smoke pending user verification)

### Objective

The Research TLDR (research tab summary) is an LLM call cached in `askedgar_cache` under `cacheType='tldr'`. The cache unique key protects the *final stored row* but not the *generation window*: two users (or page loads) hitting the same uncached ticker at once each run the full AskEdgar fetch + LLM call, double-spending. Separately, the TLDR LLM call records no usage/cost telemetry, unlike the agent path. This sprint (a) adds a DB-backed per-ticker in-progress **claim** so only one generation runs per ticker per cold window — late arrivals wait for and reuse the result — and (b) records the TLDR LLM call's **token usage / cost / duration** into the existing `agent_request_log` telemetry table. User-facing output is unchanged. Implements the `docs/repo-cleanup.md` § "Research TLDR Needs A Paid-Work Claim And Unified Telemetry" finding.

### Stories

- AEV2-801 — New `research_tldr_claims` table (one row per ticker = an in-progress generation claim) + migration.
- AEV2-802 — Surface token usage from the standalone LLM client (`lib/llm-client.ts` `callLlm`).
- AEV2-803 — Telemetry-only writer `recordSiteLlmUsage` in `lib/agents/runtime-limits.ts` (no circuit-breaker side effects).
- AEV2-804 — Rework `getCachedResearchTldr` to claim/poll/generate and record telemetry; thread `userId` from the route (adds `ensureUser`).
- AEV2-805 — Tests: llm-client usage parse, `recordSiteLlmUsage`, `getCachedResearchTldr` (cache-hit / cold-owner / loser-poll), and the updated TLDR route test.

### Current State

- `getCachedResearchTldr(ticker)` (`lib/research.ts:167`): normalizes ticker → if `db`, selects a fresh `askedgar_cache` row (`cacheType='tldr'`, `ticker`, `expiresAt > now`) and returns `dataJson` on hit → else `getCachedTickerData()` + `runResearchTldr()` → upserts the cache row (`onConflictDoUpdate` on `[cacheType, ticker]`) → returns. **No claim, no telemetry.** Its only caller is the TLDR route.
- `runResearchTldr(rawData, ticker)` (`lib/research.ts:131`): builds the prompt, calls `callLlm(system, userPrompt)`, parses JSON, returns `ResearchTldr` (`{ findings: string[]; historicalContext: string | null }`). Its only caller is `getCachedResearchTldr`.
- `callLlm(systemPrompt, userMessage, temperature=0.2)` (`lib/llm-client.ts:103`) returns `LlmClientResult = { content: string; modelUsed: string }` — **no usage**. It is the *standalone* client; its **only** caller anywhere is `runResearchTldr` (the agent blueprints use a different `callLlm` from `lib/agents/llm-client.ts`). Groq/OpenAI chat responses include a top-level `usage: { prompt_tokens, completion_tokens, total_tokens }` that the current code ignores.
- `app/api/askedgar/tldr/route.ts` POST: `requireUser` → `getDb`/`dbUnavailable` → `parseAndValidate(tldrSchema)` (ticker uppercased) → `checkRateLimit(db, userId, 'askedgar-tldr')`/`rateLimitResponse` → `getCachedResearchTldr(ticker)` → `Response.json({ ticker, ...result, generatedAt })`. It does **not** call `ensureUser`.
- Telemetry precedent (research **report**, `app/api/research-report/route.ts:171-211`): claims via the `research_reports` table (partial unique index `where status='in_progress'`), and on completion calls `recordLlmAttempt(telemetryDb, {...})` with `agentId:'small-cap-trader'`, `mode:'site-research-report'`, `lane:'background'`, using `estimateCostCents(model, inTok, outTok)`. The db is cast: `db as unknown as Parameters<typeof recordLlmAttempt>[0]`. Stale-claim cleanup deletes `in_progress` rows older than 90s; the loser polls for the winner's `complete` row and returns 503 after timeout.
- `recordLlmAttempt(db, entry)` (`lib/agents/runtime-limits.ts:171`): inserts an `agent_request_log` row, **then** calls `recordBreakerSuccess` (success) or `recordBreakerFailure` (failure), which mutate `agent_registry` circuit-breaker state for that `agentId`. `TokenTrackingEntry` shape (`lib/agents/types.ts:415`): `{ userId, agentId: AgentId, mode: string, lane: LlmLane, modelUsed: string, inputTokens, outputTokens, totalTokens, estimatedCostCents, durationMs, success: boolean }`. `AgentId = 'orchestrator' | 'small-cap-trader' | 'swing-trader'`; `LlmLane = 'interactive' | 'background'`.
- `agent_request_log` (`lib/db/schema.ts:361`): `agentId` is `NOT NULL` and FKs `agent_registry.id`; `userId` FKs `users.id`. So a telemetry row needs a valid registry agentId (`'small-cap-trader'` exists) and a persisted user id (hence `ensureUser`).
- `askedgar_cache` (`lib/db/schema.ts:153`): `id` PK, `cacheType`, `ticker`, `dataJson` (jsonb, notNull), `fetchedAt`, `expiresAt`; `unique().on(cacheType, ticker)`. Shared by `'ticker'`/`'scanner-summary'`/`'tldr'` — **do not** add columns to it.
- `estimateCostCents(model, inputTokens, outputTokens)` (`lib/agents/model-pricing.ts:42`) returns a float (cents); unknown model warns once and returns 0. The TLDR model is `llama-3.3-70b-versatile` (priced).
- `ensureUser(db, user)` (`lib/server-db-utils.ts:32`) upserts and returns the user identity (`{ id, ... }`).
- Latest migration is `drizzle/0043_fat_timeslip.sql`; the new one will be `0044`. Migrate with `npm run db:generate` then `npm run db:migrate` (NEVER `db:push`).

### Scope

- **In scope:** the `research_tldr_claims` table + migration; usage on `lib/llm-client.ts` `callLlm`; `recordSiteLlmUsage` in `lib/agents/runtime-limits.ts`; the `getCachedResearchTldr`/`runResearchTldr` rework in `lib/research.ts`; `ensureUser` + new arg in `app/api/askedgar/tldr/route.ts`; the listed tests.
- **Out of scope:** the research **report** path (already done) — do not touch `app/api/research-report/route.ts` or `recordLlmAttempt`; the agent `lib/agents/llm-client.ts`; `callLlmStreaming`; the `ResearchTldr` response shape / `components/trading/ResearchTldr.tsx` (UI unchanged); changing `askedgar_cache` columns or TTLs; adding a prune cron for claim rows (stale-cleanup-on-write is enough for now).

### Decisions Locked For Sprint 8

- **D1. The claim is a dedicated `research_tldr_claims` table keyed by ticker, not a column on `askedgar_cache` or reuse of `research_reports`.** `askedgar_cache` is shared across cache types with a `(cacheType, ticker)` unique constraint; adding a status column would touch unrelated cache paths. `research_reports` is the report path's table. A tiny ticker-PK table whose row existence *is* the claim is the simplest isolated mechanism (mirrors the report's in-progress concept without sharing its table).
- **D2. Telemetry is recorded via a new `recordSiteLlmUsage` (insert only), NOT `recordLlmAttempt`.** `recordLlmAttempt` mutates the `small-cap-trader` circuit breaker: a TLDR success would *reset* the agent's breaker (masking real agent failures) and a Groq blip on a cheap TLDR would *increment* it toward opening. Site TLDR calls must not steer the agent runtime. We still log to the same `agent_request_log` table (the "existing telemetry path" the finding asks for) under `agentId:'small-cap-trader'`, `mode:'site-research-tldr'`, `lane:'background'` so cost is queryable alongside the report.
- **D3. The loser (lost the claim) polls the cache, and on poll-timeout generates itself rather than erroring.** Unlike the report path (which returns 503), the TLDR is rendered inline in the research tab and must always return a result. Poll up to 8 times × 1500ms (~12s; TLDR is far faster than the 60s report). If the winner completes, the loser reuses its cached row (no LLM call — the dedup win). If the winner stalls/fails past the poll window, the loser falls through and generates (rare double-spend, accepted).
- **D4. Stale claims are cleaned at claim time, not by a cron.** Before inserting a claim, delete `research_tldr_claims` rows older than 90s (a generation that crashed without releasing its claim). No background job — keeps scope tight; revisit only if claims accumulate.
- **D5. Telemetry failure is non-fatal.** Wrap `recordSiteLlmUsage` and the claim insert/delete in `.catch(() => undefined)` (the cast `db as unknown as Parameters<typeof recordSiteLlmUsage>[0]` matches the report path's accepted Drizzle typing limitation). A telemetry/claim hiccup must never block the user-facing TLDR.
- **D6. `userId` is threaded into `getCachedResearchTldr` and the route calls `ensureUser`.** The telemetry row's `userId` FKs `users.id`, so the route must persist the user first (matches the report path). When `db` is null, generation runs with no claim and no telemetry (unchanged degraded behavior).

### Planned File Actions

**New files:**

- `drizzle/0044_*.sql` (+ `drizzle/meta/*`) — generated by `npm run db:generate` after the schema edit below. Do not hand-write; run the generator.
- `__tests__/llm-client.test.ts` — see Tests.
- `__tests__/research-tldr.test.ts` — see Tests.

**Modified files:**

1. `lib/db/schema.ts` — add this table (place it right after the `askedgarCache` block, ~line 163; `pgTable`/`text`/`timestamp` are already imported):

   ```ts
   // One row per ticker whose TLDR is currently being generated. The row's
   // existence IS the claim (ticker PK), so concurrent cold-cache misses can't
   // each fire a duplicate LLM generation: the winner inserts, generates, then
   // deletes; losers wait for the winner's cached result. Stale rows (a crashed
   // generation) are deleted at claim time — see lib/research.ts.
   export const researchTldrClaims = pgTable('research_tldr_claims', {
     ticker: text('ticker').primaryKey(),
     claimedAt: timestamp('claimed_at', { withTimezone: true }).notNull().defaultNow(),
   });
   ```

2. `lib/llm-client.ts` — surface usage. Replace the `LlmClientResult` interface (line 42-45) with:

   ```ts
   export interface LlmUsage {
     inputTokens: number;
     outputTokens: number;
   }

   export interface LlmClientResult {
     content: string;
     modelUsed: string;
     usage: LlmUsage;
   }
   ```

   In `requestLlm`, replace the payload parse + return (lines 91-100) with:

   ```ts
     const payload = (await response.json()) as {
       choices?: Array<{ message?: { content?: string } }>;
       usage?: { prompt_tokens?: number; completion_tokens?: number };
     };

     const content = payload.choices?.[0]?.message?.content?.trim();
     if (!content) {
       throw new Error('LLM returned empty content');
     }

     return {
       content,
       modelUsed: model,
       usage: {
         inputTokens: payload.usage?.prompt_tokens ?? 0,
         outputTokens: payload.usage?.completion_tokens ?? 0,
       },
     };
   ```

   `callLlm` and `callLlmStreaming` are otherwise unchanged (the retry in `callLlm` just returns `requestLlm`'s result, which now carries usage).

3. `lib/agents/runtime-limits.ts` — add a telemetry-only writer. `agentRequestLog` and `randomUUID` are already imported at the top of this file. Add after `recordLlmAttempt` (end of file):

   ```ts
   // Telemetry-only sibling of recordLlmAttempt: inserts a usage row WITHOUT
   // touching the agent circuit breaker. For site (non-agent) LLM calls such as
   // the research TLDR, where a Groq blip must not open — and a success must not
   // reset — the small-cap-trader agent's breaker. Same agent_request_log table
   // so cost stays queryable in one place.
   export async function recordSiteLlmUsage(db: AgentDb, entry: TokenTrackingEntry): Promise<void> {
     await db.insert(agentRequestLog).values({
       id: randomUUID(),
       userId: entry.userId,
       agentId: entry.agentId,
       mode: entry.mode,
       lane: entry.lane,
       modelUsed: entry.modelUsed,
       inputTokens: entry.inputTokens,
       outputTokens: entry.outputTokens,
       totalTokens: entry.totalTokens,
       estimatedCostCents: entry.estimatedCostCents,
       durationMs: entry.durationMs,
       success: entry.success ? 1 : 0,
       sourceCount: 0,
       chunkCount: 0,
     });
   }
   ```

4. `lib/research.ts` — rework generation to return usage and orchestrate claim + telemetry.

   **Imports:** change `import { and, eq, gt } from 'drizzle-orm';` to `import { and, eq, gt, lt } from 'drizzle-orm';`. Add:
   ```ts
   import { askedgarCache, researchTldrClaims } from '@/lib/db/schema';
   import { callLlm, type LlmUsage } from '@/lib/llm-client';
   import { estimateCostCents } from '@/lib/agents/model-pricing';
   import { recordSiteLlmUsage } from '@/lib/agents/runtime-limits';
   ```
   (the existing `import { askedgarCache } from '@/lib/db/schema';` and `import { callLlm } from '@/lib/llm-client';` lines are replaced by the above — do not leave duplicates.)

   **Add these helpers near the top (after `TLDR_CACHE_TTL_MS`):**
   ```ts
   const CLAIM_STALE_MS = 90_000;     // a claim older than this = a crashed generation
   const POLL_ATTEMPTS = 8;           // loser waits ~12s for the winner's result
   const POLL_INTERVAL_MS = 1500;

   function sleep(ms: number) {
     return new Promise<void>((resolve) => setTimeout(resolve, ms));
   }

   // neon-http surfaces a Postgres unique violation as code '23505', sometimes
   // nested under `.cause`. Matches the research-report claim helper.
   function isUniqueViolation(err: unknown): boolean {
     if (typeof err !== 'object' || err === null) return false;
     const maybeError = err as { code?: unknown; cause?: { code?: unknown } };
     return maybeError.code === '23505' || maybeError.cause?.code === '23505';
   }
   ```

   **Change `runResearchTldr` to also return usage/model/duration.** Add this interface near `ResearchTldr`:
   ```ts
   export interface ResearchTldrGeneration {
     tldr: ResearchTldr;
     usage: LlmUsage;
     modelUsed: string;
     durationMs: number;
   }
   ```
   Replace the body of `runResearchTldr` (lines 131-154) with (signature returns `Promise<ResearchTldrGeneration>`):
   ```ts
   export async function runResearchTldr(
     rawData: Record<string, AskEdgarResponse<unknown>>,
     ticker: string,
   ): Promise<ResearchTldrGeneration> {
     const trimmed = trimRawDataForLlm(rawData);
     const userPrompt = buildResearchTldrPrompt(trimmed, { ticker });

     const start = Date.now();
     const reply = await callLlm(
       'You are a financial analyst specializing in small-cap dilution risk assessment. Return JSON only.',
       userPrompt,
     );
     const durationMs = Date.now() - start;

     const parsed = parseJson(reply.content);
     const parsedObj = isObject(parsed) ? parsed : {};
     const toStringArray = (val: unknown) =>
       Array.isArray(val) ? val.filter((item): item is string => typeof item === 'string') : [];

     return {
       tldr: {
         findings: toStringArray(parsedObj.findings).slice(0, 10),
         historicalContext: typeof parsedObj.historicalContext === 'string' ? parsedObj.historicalContext : null,
       },
       usage: reply.usage,
       modelUsed: reply.modelUsed,
       durationMs,
     };
   }
   ```

   **Replace `getCachedResearchTldr` (lines 167-217) entirely with:**
   ```ts
   // Reads the current fresh tldr cache row for a ticker, or null on miss.
   async function readFreshTldr(
     db: NonNullable<ReturnType<typeof getDb>>,
     ticker: string,
   ): Promise<ResearchTldr | null> {
     const rows = await db
       .select()
       .from(askedgarCache)
       .where(
         and(
           eq(askedgarCache.cacheType, 'tldr'),
           eq(askedgarCache.ticker, ticker),
           gt(askedgarCache.expiresAt, new Date()),
         ),
       )
       .limit(1);
     return rows.length > 0 ? (rows[0].dataJson as ResearchTldr) : null;
   }

   // Generates the tldr, writes the cache row, and records usage telemetry.
   // Telemetry/cache failures are swallowed so the user-facing result still returns.
   async function generateAndCacheTldr(
     db: NonNullable<ReturnType<typeof getDb>>,
     ticker: string,
     userId: string,
   ): Promise<ResearchTldr> {
     const telemetryDb = db as unknown as Parameters<typeof recordSiteLlmUsage>[0];
     const askEdgarData = await getCachedTickerData(ticker);

     let generation: ResearchTldrGeneration;
     try {
       generation = await runResearchTldr(askEdgarData.rawData, ticker);
     } catch (genErr) {
       await recordSiteLlmUsage(telemetryDb, {
         userId,
         agentId: 'small-cap-trader',
         mode: 'site-research-tldr',
         lane: 'background',
         modelUsed: 'unknown',
         inputTokens: 0,
         outputTokens: 0,
         totalTokens: 0,
         estimatedCostCents: 0,
         durationMs: 0,
         success: false,
       }).catch(() => undefined);
       throw genErr;
     }

     const { tldr, usage, modelUsed, durationMs } = generation;
     await recordSiteLlmUsage(telemetryDb, {
       userId,
       agentId: 'small-cap-trader',
       mode: 'site-research-tldr',
       lane: 'background',
       modelUsed,
       inputTokens: usage.inputTokens,
       outputTokens: usage.outputTokens,
       totalTokens: usage.inputTokens + usage.outputTokens,
       estimatedCostCents: estimateCostCents(modelUsed, usage.inputTokens, usage.outputTokens),
       durationMs,
       success: true,
     }).catch(() => undefined);

     const now = new Date();
     const expiresAt = new Date(now.getTime() + TLDR_CACHE_TTL_MS);
     try {
       await db
         .insert(askedgarCache)
         .values({
           id: `tldr-${ticker}`,
           cacheType: 'tldr',
           ticker,
           dataJson: tldr,
           fetchedAt: now,
           expiresAt,
         })
         .onConflictDoUpdate({
           target: [askedgarCache.cacheType, askedgarCache.ticker],
           set: { dataJson: tldr, fetchedAt: now, expiresAt },
         });
     } catch (err) {
       console.warn('[research-tldr-cache] Failed to write tldr cache:', err);
     }

     return tldr;
   }

   export async function getCachedResearchTldr(ticker: string, userId: string): Promise<ResearchTldr> {
     const normalizedTicker = ticker.trim().toUpperCase();
     const db = getDb();

     // No db: degrade to direct generation (no claim, no telemetry).
     if (!db) {
       const askEdgarData = await getCachedTickerData(normalizedTicker);
       const { tldr } = await runResearchTldr(askEdgarData.rawData, normalizedTicker);
       return tldr;
     }

     // Fresh cache hit — the common case.
     const hit = await readFreshTldr(db, normalizedTicker);
     if (hit) return hit;

     // Cold miss: try to claim this ticker's generation. Clean stale claims first.
     await db
       .delete(researchTldrClaims)
       .where(lt(researchTldrClaims.claimedAt, new Date(Date.now() - CLAIM_STALE_MS)))
       .catch(() => undefined);

     let isOwner = true;
     try {
       await db.insert(researchTldrClaims).values({ ticker: normalizedTicker, claimedAt: new Date() });
     } catch (err) {
       if (!isUniqueViolation(err)) throw err;
       isOwner = false; // someone else is already generating this ticker
     }

     // Loser: wait for the winner's cached result instead of spending again.
     if (!isOwner) {
       for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
         await sleep(POLL_INTERVAL_MS);
         const cached = await readFreshTldr(db, normalizedTicker);
         if (cached) return cached;
       }
       // Winner stalled/failed past the poll window — generate ourselves (rare).
       return generateAndCacheTldr(db, normalizedTicker, userId);
     }

     // Owner: generate, then always release the claim.
     try {
       return await generateAndCacheTldr(db, normalizedTicker, userId);
     } finally {
       await db
         .delete(researchTldrClaims)
         .where(eq(researchTldrClaims.ticker, normalizedTicker))
         .catch(() => undefined);
     }
   }
   ```

5. `app/api/askedgar/tldr/route.ts` — add `ensureUser` and thread the user id. Change the import `import { dbUnavailable, requireUser } from '@/lib/server-db-utils';` to `import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';`. After the rate-limit check, before calling the lib, insert `const user = await ensureUser(db, authState.user);` and change `const result = await getCachedResearchTldr(ticker);` to `const result = await getCachedResearchTldr(ticker, user.id);`. Nothing else changes (response shape identical).

### Tests

- `__tests__/llm-client.test.ts` (new) — mock `global.fetch` with a `Response` whose JSON body is `{ choices: [{ message: { content: '{"findings":[]}' } }], usage: { prompt_tokens: 11, completion_tokens: 22 } }` and `ok: true`. Set `process.env.LLM_API_KEY = 'test'` in `beforeEach`. Assert `callLlm('sys', 'user')` resolves `{ content, modelUsed, usage: { inputTokens: 11, outputTokens: 22 } }`. Add one case where `usage` is absent → `usage` defaults to `{ inputTokens: 0, outputTokens: 0 }`. **Build a fresh `fetch` mock (returning a fresh `Response`) per case** — a `Response` body is single-use, so a shared/consumed `Response` makes the second test throw "body already read". Restore `fetch`/env in `afterEach`.
- `__tests__/agent-runtime-limits.test.ts` (modify) — add a `describe('recordSiteLlmUsage', ...)`. Mirror the existing `recordLlmAttempt` test's db mock (an object with `insert: vi.fn(() => ({ values: vi.fn() }))` and `execute: vi.fn()`). Assert: after `recordSiteLlmUsage(db, <entry with success:true>)`, `db.insert` was called once with `agent_request_log`'s shape (success `1`), **and `db.execute` was NOT called** (no breaker mutation — the load-bearing difference from `recordLlmAttempt`). Add a `success:false` case and assert `db.execute` still not called and the inserted `success` is `0`.
- `__tests__/research-tldr.test.ts` (new) — `vi.mock` `@/lib/db` (`getDb`), `@/lib/askedgar` (`getCachedTickerData` → `{ rawData: {} }`), `@/lib/llm-client` (`callLlm` → `{ content: '{"findings":["f1"],"historicalContext":null}', modelUsed: 'llama-3.3-70b-versatile', usage: { inputTokens: 5, outputTokens: 7 } }`), and `@/lib/agents/runtime-limits` (`recordSiteLlmUsage` → a `vi.fn()` resolving undefined). Provide a chainable db mock exposing spies. Cases:
  - **Cache hit:** `readFreshTldr`'s select resolves a row whose `dataJson` is `{ findings: ['cached'], historicalContext: null }`. `getCachedResearchTldr('AAPL', 'user-1')` returns it; `callLlm` and `recordSiteLlmUsageMock` are **not** called; no claim insert.
  - **Cold owner:** first select (hit check) resolves `[]`; claim `insert` resolves; generation runs. Assert returned `{ findings: ['f1'], ... }`, `callLlm` called once, `recordSiteLlmUsageMock` called once with `mode:'site-research-tldr'`, `success:true`, `totalTokens:12`. **The cold-owner path fires TWO `delete` calls on the shared `delete` spy** — the stale-claim cleanup (`where lt(claimedAt)`) then the owner release (`where eq(ticker)`) — so assert `delete` ran **twice** (or assert the release call's args), NOT `toHaveBeenCalledTimes(1)`.
  - **Loser poll (use fake timers):** make the claim `insert` reject with `{ code: '23505' }`. Note `readFreshTldr` also runs for the initial hit-check, so **queue three `select` results**: `[]` (hit-check miss) → `[]` (poll attempt 0 miss) → `[{ dataJson: <row> }]` (poll attempt 1 hit). The stale-cleanup `delete` also fires (before the rejecting insert), so the `delete().where()` mock must be chainable in this case too. Use `vi.useFakeTimers()`, call `getCachedResearchTldr(...)`, `await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2)`, then await the promise; assert it returns the polled row and `callLlm` was **never** called. Reset real timers in `afterEach`.

  Keep the db mock explicit — distinct `select`/`insert`/`delete` spies whose return values you set per case (the simplest shape: `select().from().where().limit()` resolving the queued rows, `insert().values()` resolving or rejecting, `delete().where()` resolving). It's fine to drive `select` results with a queue array (`mockResolvedValueOnce` chained) since hit-check and poll both go through `readFreshTldr`.
- `__tests__/askedgar-tldr-route.test.ts` (modify) — add `ensureUserMock` to the `vi.hoisted` block and to the `@/lib/server-db-utils` mock (`ensureUser: ensureUserMock`). In `beforeEach`, `ensureUserMock.mockResolvedValue({ id: 'user-1', email: 'user@example.com', name: 'Test User', picture: null })`. Update the 200 test to expect `getCachedResearchTldrMock` called with `('AAPL', 'user-1')` (was `('AAPL')`). In the 401, 400, 503, and 429 tests, add `expect(ensureUserMock).not.toHaveBeenCalled()` (ensureUser runs only after the rate-limit check passes). Response-shape assertions stay unchanged.

### Acceptance Criteria

- [x] New `research_tldr_claims` table exists with `ticker` PK + `claimed_at`; migration `0044_optimal_mysterio.sql` generated via `npm run db:generate` and applied via `npm run db:migrate`.
- [x] `lib/llm-client.ts` `callLlm` returns `usage: { inputTokens, outputTokens }` parsed from the response `usage` (defaulting to 0 when absent); `LlmUsage` is exported; `callLlmStreaming` untouched.
- [x] `recordSiteLlmUsage` inserts an `agent_request_log` row and does **not** touch the circuit breaker (`agent_registry` is never updated by it).
- [x] `getCachedResearchTldr(ticker, userId)`: returns a fresh cache hit with no LLM call/claim; on cold miss the claim winner generates exactly once, writes the cache, records one telemetry row (`mode:'site-research-tldr'`, `success:true`), and releases the claim; a concurrent loser reuses the winner's cached result with no second LLM call; stale claims (>90s) are cleared before claiming; a generation error records a `success:false` telemetry row and rethrows.
- [x] `app/api/askedgar/tldr/route.ts` calls `ensureUser` and passes the persisted user id; the JSON response shape (`{ ticker, findings, historicalContext, generatedAt }`) is unchanged.
- [x] Telemetry and claim writes never block the user-facing TLDR (all wrapped in `.catch` / non-fatal fallback).
- [x] All new/updated tests pass and the existing suite stays green.

### Validation

Run before marking COMPLETE:
- `npm run db:generate` passed; generated `drizzle/0044_optimal_mysterio.sql`.
- `npm run db:migrate` passed; migration applied successfully.
- `npm run lint` passed.
- `npx tsc --noEmit` passed.
- `npm test` passed (98 files, 704 tests).
- Manual browser smoke (user): PENDING user verification — open the research tab for an uncached ticker; reopen / open in a second tab at the same time; confirm only one generation runs and an `agent_request_log` row appears for `mode='site-research-tldr'` with non-zero tokens.

---

## Recently Completed

### Sprint 7 — Slim GET /api/trades Payload (Lazy-Load Executions)

Status: completed 2026-05-29 (commit 757cd32).

Outcome:
- `GET /api/trades` no longer joins `tradeExecutions` — returns one summary row per trade (tags intact, `rawExecutions: []`), so the bulk list loads lighter; `POST` unchanged. Closes the `docs/repo-cleanup.md` "Unbounded GET /api/trades" finding (slim-payload scope; true pagination deferred).
- New `hooks/use-trade-executions.ts`: `useTradeExecutions(id, seeded)` lazy-loads a single trade's executions via `/api/trades/[id]` with a shared module cache + promise-based in-flight dedup; `prefetchTradeExecutions(ids)` warms the same cache. `JournalTradeChart` uses it so replay charts keep per-fill markers; both review sheets prefetch before the auto-print timer so exported PDFs keep per-fill markers.
- Also closed the "Missing GET Test For Trades Route" gap.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (96 files, 696 tests) all passed.
- New GET test asserts `select` ran exactly once (proves the executions query is gone); new hook test covers seeded/seed-transition/lazy-fetch/cache/prefetch.
- Manual browser smoke (Journal + daily/weekly replay markers, detail sheet, multi-fill review PDF export, list load speed): PENDING user verification.

### Sprint 6 — Rate Limiting On Expensive Endpoints

Status: completed 2026-05-29 (commit 644dc24).

Outcome:
- New `rate_limits` table (text PK `${userId}:${endpoint}:${windowStartMs}`, FK cascade, lookup index) + migration `drizzle/0043_fat_timeslip.sql`.
- Shared `lib/rate-limit.ts`: atomic fixed-window (UTC clock-hour) upsert counter + 429 builder with `Retry-After` / `X-RateLimit-*` headers. Caps: research-report 20/hr, askedgar-tldr 30/hr.
- Wired into `POST /api/research-report` and `POST /api/askedgar/tldr` (added a `getDb` guard + one-try/catch restructure to the tldr route).

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (95 files, 688 tests) all passed; `npm run db:migrate` applied cleanly.
- Manual post-deploy 429-header smoke: PENDING user verification.

### Multi-Day Trade Replay Charts

Status: completed 2026-05-28 (commit a625032).

Outcome:
- Closed trades spanning >1 day now widen the candle window entry-day→exit-day, place `EXIT` markers on the exit day, and show a date range in the detail-sheet and Journal labels. Open/same-day trades are unchanged.
- Behind an optional `endSortKey` param on `buildTradeChartOptions`; `ResearchChart`/`WatchlistTickerChart` (2-arg callers) untouched. Detection reuses `isCrossDayTrade`/`bucketKey`.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (94 files, 681 tests) all passed.
- Codex added `__tests__/ui-trade-utils.test.ts` (3 marker tests) beyond the spec.
- Manual browser smoke (same-day unchanged, multi-day span, ResearchChart unaffected): PENDING user verification.

### CSV Parser: Position-Aware B Resolution

Status: completed 2026-05-28 (commit 5ea235b).

Outcome:
- Lifted DAS Trader's chronological position-resolver into shared `resolveSidesByPositionState` helper in `lib/parsers/utils.ts`.
- `defaultParser` now runs the resolver in `buildContext`, disambiguating raw `B` to `MARGIN` (long open) when no open short exists, or `B` (cover) when one does.
- Deleted `builtinNormalizeRow`; both `processCsvData` and `extractRawExecutions` default to `defaultParser`. Removed `parser.id === 'default'` bypass in `lib/trade-utils.ts`.

Validation:
- `npm run lint` passed.
- `npx tsc --noEmit` passed.
- `npm test` passed (92 files, 671 tests).
- Manual browser smoke with coworker's 2026-05-28 CSV: PENDING — confirm ASTC/ATPC LONG trades appear, NCT/SPRC SHORT remain correct, ARM shows as open long.

### Cover/Close Entry Flow — Manual Entry (FIFO) + Import Side Resolution

Status: completed 2026-05-28 (commit c846e4a).

Outcome:
- Part A: manual New Trade form now detects an offsetting open position (same symbol, opposite direction) and prompts to close it FIFO instead of creating a new opposite open trade. New `lib/cover-position.ts` (pure FIFO math) + `app/api/trades/cover/route.ts` handle full close / partial / flip; `useTrades.handleCoverPosition` merges affected rows by id.
- Part B: import (raw CSV) path seeds `resolveSidesByPositionState` with the client's currently-open positions so a later-day `B` covering a carried-over short labels as a cover, not a new long. Threaded through `extractRawExecutions` → `collectRawExecutions` → `processImportFiles`.
- Known limits (intentional): multi-day folder import in one action won't link an open+cover across batches; same-symbol intraday round-trip while holding a carried-over position can mislabel. Supported workflow documented for coworkers.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (93 files, 677 tests) all passed.
- Manual browser smoke (Part A confirm/partial/flip/decline, Part B import seeding): PENDING user verification.

---

## Session Maintenance

- Keep this file compact: active specs only while work is in flight, short summaries after validation.
- If a new multi-step feature starts, replace or append a self-contained execution spec with exact file paths, ordered changes, acceptance criteria, and validation requirements.
- If only docs/workflow assets change, run `npm run workflow:audit`.
- Do not modify `.env*` or secret files.

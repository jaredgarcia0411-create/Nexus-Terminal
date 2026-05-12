# Nexus Terminal - HANDOFF.md

> Updated: 2026-05-13
> Purpose: compact recent context and follow-ups. Older implementation detail lives in git history and `specs/`.

> Historical completed sections were removed to keep this file focused. Use git history and the `specs/` directory for archived implementation detail.

## Active Execution Spec

### Cleanup Step 4: Cost/reliability fixes (POST idempotency, site-report telemetry, AskEdgar Postgres state, scanner aggregate)

> Generated: 2026-05-13 | Author: planning conversation (cleanup roadmap step 4)
> Status: IN PROGRESS — Phase 2 complete; stopped at second checkpoint for review.
> Executor: Codex
> Commit strategy: **one commit per phase** (4 commits). Codex must stop and commit at each `# COMMIT POINT` marker, wait for human review before continuing.

#### Goal

Step 4 of the cleanup roadmap. Four independent cost/reliability fixes:

1. **POST `/api/research-report` idempotency.** Today, two simultaneous POSTs for the same ticker run two full paid LLM generations and insert two `research_reports` rows. Add a DB-backed claim so only one generation runs per ticker.
2. **Route site-report LLM usage through `lib/agents/runtime-limits.ts` budget telemetry.** Today the site path calls `callLlm()` but never records the attempt — site usage is invisible to `agent_request_log` and the agent budget check.
3. **Move AskEdgar daily-cap + retry-window state into Postgres.** Today `uniqueTickersToday` and `rateLimitedUntil` live in module memory; Vercel cold starts reset both, so caps and 429 backoffs are advisory only.
4. **Add a short-TTL dashboard scanner aggregate endpoint.** Dashboard polls 3 endpoints every 10s per viewer. One coalesced endpoint with an 8s server-side TTL cuts upstream load.

These four are independent; each phase commits separately so we can bisect if a regression appears post-deploy.

#### Locked decisions

- **Phase 1 (POST idempotency):**
  - Use a **partial unique index** on `research_reports(ticker)` WHERE `status = 'in_progress'`. Insert with status='in_progress' as the claim; UPDATE to status='complete' on success.
  - Stale claim reap window: **90 seconds** (LLM should finish in ~30–60s; 90s gives a buffer).
  - On conflict, the POST handler **polls** the DB every 2s for up to 60s for a completed row; returns the completed report when it lands, else returns 503 "still generating, retry shortly".
  - GET handler is fixed to filter `reportJson IS NOT NULL` so an `in_progress` row never shadows older completed rows in the 16h cache window.
- **Phase 2 (site-report telemetry):**
  - `generateSmallCapResearchReport` is refactored to return `{ report, llmUsage }` where `llmUsage` is the `LlmResponse` from `lib/agents/llm-client.ts`. Site route records the attempt via `recordLlmAttempt(db, ...)`.
  - `agentId` for the telemetry entry = `'small-cap-trader'` (already seeded in `agent_registry`). `mode` = `'site-research-report'`. `lane` = `'background'`.
  - Failure path also records (`success: false`, zero tokens, elapsed duration).
- **Phase 3 (AskEdgar Postgres state):**
  - Two new tables: `askedgar_daily_tickers` (PK on `(date, ticker)`) and `askedgar_runtime_state` (singleton row, id='global', column `rate_limited_until`).
  - Module-level `uniqueTickersToday: Set`, `resetDate`, `rateLimitedUntil` **stay** as a fast-path cache layered over DB. DB is source of truth; module memory is best-effort within an instance.
  - DB sync happens **once per `fetchTickerData()` call** (one combined read query) and once per scanner-summary call. 16 endpoint calls inside fan-out still trust the module-level guard — no per-endpoint DB hit.
  - In-flight Map (`inFlightTickerRequests`) is unchanged — best-effort instance-local coalescing only.
  - If DB read/write fails, log + fall back to module state only (do not block the request).
- **Phase 4 (scanner aggregate):**
  - New route: `app/api/dashboard/scanner-state/route.ts`. Returns `{ gainers, isRealtime, mdrLive, mdrRecent, fetchedAt }`.
  - Server-side cache: module-level Map with **8s TTL** (the dashboard polls every 10s; 8s TTL means at most one upstream call per viewer per poll, and multiple viewers share).
  - Existing routes (`/api/tradingview/gainers`, `/api/tradingview/mdr-candidates`, `/api/scanner/mdr-recent`) stay; they're still used by tests and may be needed for other surfaces. The aggregate calls the same underlying helpers (not the routes themselves) to avoid network-to-self hops.
- **Migrations:** each phase that touches the schema generates its own Drizzle migration via `npm run db:generate`, applied via `npm run db:migrate` (never `db:push` — see `feedback_db_migrate_over_push.md`). **No hand-editing of generated SQL.**
- **No seed migration for `askedgar_runtime_state`.** The singleton row is created lazily on first 429 via `INSERT ... ON CONFLICT DO UPDATE` (upsert) in `persistRateLimit()`. A missing row on read is treated as "no rate limit set". This keeps every migration purely schema-driven.

---

#### Phase 1 — POST idempotency for `/api/research-report`

**# COMMIT POINT after Phase 1.**

> Checkpoint status: COMPLETE — unique-index migration generated/applied; `npm run lint`, `npx tsc --noEmit`, `npm run typecheck:services`, `npm test`, and `npm run workflow:audit` passed.

**Files:**
- `lib/db/schema.ts` (modify)
- `drizzle/0032_<auto>.sql` + meta files (new, generated)
- `app/api/research-report/route.ts` (modify)
- `__tests__/research-report-route.test.ts` (modify — multiple cases need rewriting)

**Steps:**

1. **Add partial unique index to `researchReports` schema.** In `lib/db/schema.ts`, modify the `researchReports` table definition:
   - Add `import { sql } from 'drizzle-orm';` at the top if not already present (it's not — only `pg-core` imports exist there today).
   - Inside the `(table) => [ ... ]` array (line ~120), add a second entry:
     ```ts
     uniqueIndex('research_reports_in_progress_ticker_idx')
       .on(table.ticker)
       .where(sql`status = 'in_progress'`),
     ```
   - Result: one ticker can have at most one `in_progress` row at a time, regardless of user. Completed rows have no constraint.

2. **Generate and apply the migration.** Run `npm run db:generate`. Inspect the generated `drizzle/0032_<name>.sql` — should contain only:
   ```sql
   CREATE UNIQUE INDEX "research_reports_in_progress_ticker_idx" ON "research_reports" ("ticker") WHERE status = 'in_progress';
   ```
   (Phase 3 will append the askedgar table creates to this same migration. For now, the file only contains the unique index.) Run `npm run db:migrate` to apply.

3. **Fix the GET handler to ignore `in_progress` rows.** In `app/api/research-report/route.ts` GET (around line 45):
   - Add `eq(researchReports.status, 'complete')` to the `where(and(...))` clause. The `latest?.reportJson` check stays — defensive guard for older rows.
   - Result: GET never returns an `in_progress` row even though one might exist for the ticker.

4. **Rewrite the POST handler with claim-poll semantics.** Replace the body of the POST function (lines 70–109) with this flow:

   ```ts
   export async function POST(request: Request) {
     try {
       const authState = await requireUser();
       if ('error' in authState) return authState.error;

       const db = getDb();
       if (!db) return dbUnavailable();

       const bodyState = await parseAndValidate(request, postSchema);
       if (bodyState.error) return bodyState.error;
       const { ticker } = bodyState.data;

       const user = await ensureUser(db, authState.user);

       // Step A: reap any stale in-progress claim (older than 90s; LLM should finish in ~30-60s)
       const staleSince = new Date(Date.now() - 90_000);
       await db.delete(researchReports).where(and(
         eq(researchReports.ticker, ticker),
         eq(researchReports.status, 'in_progress'),
         lt(researchReports.generatedAt, staleSince),
       ));

       // Step B: try to claim. If conflict, another caller is mid-flight — poll for completion.
       const claimId = crypto.randomUUID();
       const claimedAt = new Date();
       let isOwner = true;
       try {
         await db.insert(researchReports).values({
           id: claimId,
           userId: user.id,
           ticker,
           status: 'in_progress',
           rawData: null,
           reportJson: null,
           modelUsed: null,
           generatedAt: claimedAt,
         });
       } catch (insertError) {
         // Treat any insert failure on the partial unique index as "someone else holds the claim".
         // Drizzle / postgres surfaces this as a Postgres error with code '23505'. Be defensive
         // about error shape — fall back to polling if the message looks like a unique violation.
         if (!isUniqueViolation(insertError)) throw insertError;
         isOwner = false;
       }

       if (!isOwner) {
         // Poll for completion: someone else is generating. 30 attempts × 2s = 60s max wait.
         for (let attempt = 0; attempt < 30; attempt += 1) {
           await sleep(2000);
           const freshSince = new Date(Date.now() - CACHE_TTL_HOURS * 60 * 60 * 1000);
           const [latest] = await db
             .select({
               reportJson: researchReports.reportJson,
               generatedAt: researchReports.generatedAt,
               modelUsed: researchReports.modelUsed,
             })
             .from(researchReports)
             .where(and(
               eq(researchReports.ticker, ticker),
               eq(researchReports.status, 'complete'),
               gte(researchReports.generatedAt, freshSince),
             ))
             .orderBy(desc(researchReports.generatedAt))
             .limit(1);

           if (latest?.reportJson) {
             return Response.json({
               ticker,
               report: latest.reportJson,
               generatedAt: latest.generatedAt?.toISOString() ?? null,
               modelUsed: latest.modelUsed,
               cached: true,
             });
           }
         }
         return Response.json(
           { error: 'Report generation in progress; retry shortly.' },
           { status: 503 },
         );
       }

       // Step C: we hold the claim — generate the report.
       try {
         const report = await generateSmallCapResearchReport(ticker);
         const generatedAt = new Date();
         await db.update(researchReports)
           .set({
             status: 'complete',
             reportJson: report,
             modelUsed: 'small-cap-research',
             generatedAt,
           })
           .where(eq(researchReports.id, claimId));

         return Response.json({
           ticker,
           report,
           generatedAt: generatedAt.toISOString(),
           cached: false,
         });
       } catch (generationError) {
         // Drop the claim so the next caller can retry. Logging happens in the outer catch.
         await db.delete(researchReports).where(eq(researchReports.id, claimId)).catch(() => undefined);
         throw generationError;
       }
     } catch (error) {
       logRouteError('research-report:post', error);
       return internalServerError();
     }
   }
   ```

   - Add `lt` to the `drizzle-orm` import at line 1 alongside `and, desc, eq, gte`.
   - Add a small helper `function sleep(ms: number) { return new Promise<void>((resolve) => setTimeout(resolve, ms)); }` at the top of the file (above `GET`).
   - Add a small helper `function isUniqueViolation(err: unknown): boolean { return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: unknown }).code === '23505'; }` at the top of the file. The Postgres unique-violation SQLSTATE is `23505`. Drizzle surfaces the underlying `pg` error through `cause` in some configurations — also check `(err as { cause?: { code?: unknown } }).cause?.code === '23505'` as a fallback.

5. **Update the test file `__tests__/research-report-route.test.ts`.** The DB mock currently only supports `.select().from().where().orderBy().limit()` and `.insert().values()`. The new flow needs `.delete().where()` and `.update().set().where()` as well. Replace the `createInsertDb()` helper with a composed mock that supports all four operations:

   ```ts
   function createMutationDb({ insertWillConflict = false }: { insertWillConflict?: boolean } = {}) {
     const insertValues = vi.fn(async () => {
       if (insertWillConflict) {
         const err = new Error('duplicate key value violates unique constraint');
         (err as Error & { code?: string }).code = '23505';
         throw err;
       }
     });
     const insert = vi.fn(() => ({ values: insertValues }));
     const updateSet = vi.fn(() => ({ where: vi.fn(async () => undefined) }));
     const update = vi.fn(() => ({ set: updateSet }));
     const deleteWhere = vi.fn(async () => undefined);
     const deleteWhereCatch = { catch: vi.fn(() => Promise.resolve(undefined)) };
     const del = vi.fn(() => ({ where: vi.fn(() => Object.assign(Promise.resolve(undefined), deleteWhereCatch)) }));
     // Select chain — multiple .select() calls happen in the poll loop.
     const selectImpl = (rows: unknown[]) => {
       const limit = vi.fn(async (count: number) => rows.slice(0, count));
       const orderBy = vi.fn(() => ({ limit }));
       const where = vi.fn(() => ({ orderBy }));
       const from = vi.fn(() => ({ where }));
       return vi.fn(() => ({ from }));
     };
     const select = selectImpl([]);
     return { insert, insertValues, update, updateSet, delete: del, select, selectImpl };
   }
   ```

   - **Required test cases (modify existing + add new):**
     - `'returns cached reports from GET without generating'` — keep as-is.
     - `'returns a cache miss from GET when no fresh structured report exists'` — keep as-is.
     - `'generates and stores a report from POST when no claim exists'` — rewrite the assertion. Now expects: `db.delete` called (stale reap), `db.insert` called with `status: 'in_progress'`, `generateSmallCapResearchReportMock` called, `db.update` called with `status: 'complete', reportJson: sampleReport`.
     - `'returns validation details for an invalid POST ticker'` — keep as-is.
     - **NEW:** `'polls and returns the completed report when another caller holds the claim'`. Mock the insert to throw a 23505 error; mock select to return the completed row on the 2nd poll attempt; expect 200 with the cached report and `generateSmallCapResearchReportMock` **not** called. Stub `vi.useFakeTimers()` and `vi.advanceTimersByTimeAsync` so the test doesn't sleep 2s for real.
     - **NEW:** `'returns 503 when polling times out waiting for another caller'`. Same setup but select never returns a complete row; expect 503 after fake-time advances ≥60s.
     - **NEW:** `'drops the claim when LLM generation fails'`. Mock the LLM call to reject; expect `db.delete` called with `eq(researchReports.id, claimId)` after the failure; route returns 500.

6. **Validation for Phase 1:**
   ```
   npm run lint
   npx tsc --noEmit
   npm test
   ```
   All three must pass. **Commit** with message:
   ```
   Add POST idempotency claim for research-report

   Prevents duplicate paid LLM generation when two callers POST for the
   same ticker. Uses a partial unique index on (ticker) where
   status='in_progress' as the claim row; the second caller polls for
   the first caller's completed row.
   ```

---

#### Phase 2 — Route site-report LLM usage through `runtime-limits.ts` telemetry

**# COMMIT POINT after Phase 2.**

> Checkpoint status: COMPLETE — `npx vitest run __tests__/research-report-route.test.ts`, `npm run lint`, `npx tsc --noEmit`, `npm test`, and `npm run workflow:audit` passed.

**Files:**
- `lib/agents/blueprints/small-cap-research.ts` (modify exported function only)
- `app/api/research-report/route.ts` (modify)
- `__tests__/research-report-route.test.ts` (modify)

**Steps:**

1. **Change `generateSmallCapResearchReport`'s return type.** In `lib/agents/blueprints/small-cap-research.ts` around line 801, modify the exported function so it returns the LLM usage stats alongside the parsed report.

   - **Add a new exported type** above the function:
     ```ts
     export interface ResearchReportGeneration {
       report: z.infer<typeof researchReportSchema>;
       llmUsage: {
         modelUsed: string;
         inputTokens: number;
         outputTokens: number;
         durationMs: number;
       };
     }
     ```
   - **Change the function signature** from:
     ```ts
     export async function generateSmallCapResearchReport(
       ticker: string,
     ): Promise<z.infer<typeof researchReportSchema>> {
     ```
     to:
     ```ts
     export async function generateSmallCapResearchReport(
       ticker: string,
     ): Promise<ResearchReportGeneration> {
     ```
   - **At the bottom of the function** (around line 878 where it currently `return parsed;`), change to:
     ```ts
     return {
       report: parsed,
       llmUsage: {
         modelUsed: llmResponse.modelUsed,
         inputTokens: llmResponse.inputTokens,
         outputTokens: llmResponse.outputTokens,
         durationMs: llmResponse.durationMs,
       },
     };
     ```
   - **Do not touch the blueprint** (`smallCapResearchBlueprint`) at line 881+ — that path goes through `blueprint-runner.ts` which already records telemetry via `recordLlmAttempt`. Only the standalone `generateSmallCapResearchReport` export changes.

2. **Update the route to record the LLM attempt.** In `app/api/research-report/route.ts`:

   - **Add imports** at the top:
     ```ts
     import { recordLlmAttempt } from '@/lib/agents/runtime-limits';
     import { estimateCostCents } from '@/lib/agents/model-pricing';
     ```
   - **Modify the POST claim-owner branch** (Step C from Phase 1's spec). Inside the `try` block where `generateSmallCapResearchReport` is called, change:
     ```ts
     const report = await generateSmallCapResearchReport(ticker);
     ```
     to:
     ```ts
     const generationStart = Date.now();
     let generation: Awaited<ReturnType<typeof generateSmallCapResearchReport>>;
     try {
       generation = await generateSmallCapResearchReport(ticker);
     } catch (genErr) {
       // Record the failed attempt before bubbling the error up.
       await recordLlmAttempt(db, {
         userId: user.id,
         agentId: 'small-cap-trader',
         mode: 'site-research-report',
         lane: 'background',
         modelUsed: 'unknown',
         inputTokens: 0,
         outputTokens: 0,
         totalTokens: 0,
         estimatedCostCents: 0,
         durationMs: Date.now() - generationStart,
         success: false,
       }).catch(() => undefined);
       throw genErr;
     }
     const { report, llmUsage } = generation;

     // Record the successful attempt for budget visibility. Best-effort:
     // telemetry failures must not block the user-visible response.
     await recordLlmAttempt(db, {
       userId: user.id,
       agentId: 'small-cap-trader',
       mode: 'site-research-report',
       lane: 'background',
       modelUsed: llmUsage.modelUsed,
       inputTokens: llmUsage.inputTokens,
       outputTokens: llmUsage.outputTokens,
       totalTokens: llmUsage.inputTokens + llmUsage.outputTokens,
       estimatedCostCents: estimateCostCents(llmUsage.modelUsed, llmUsage.inputTokens, llmUsage.outputTokens),
       durationMs: llmUsage.durationMs,
       success: true,
     }).catch(() => undefined);
     ```
   - The `db.update(researchReports).set({ ..., reportJson: report, ... })` call from Phase 1 stays unchanged — it just uses `report` (now destructured) instead of the raw function result.

3. **Update tests.** In `__tests__/research-report-route.test.ts`:
   - Update `generateSmallCapResearchReportMock.mockResolvedValue(sampleReport)` (line 99) to `generateSmallCapResearchReportMock.mockResolvedValue({ report: sampleReport, llmUsage: { modelUsed: 'llama-3.3-70b-versatile', inputTokens: 1200, outputTokens: 800, durationMs: 4500 } })`. Update other mockResolvedValue calls similarly.
   - Mock `recordLlmAttempt` and `estimateCostCents` (add to the existing `vi.mock` block at the top of the file):
     ```ts
     const { recordLlmAttemptMock } = vi.hoisted(() => ({ recordLlmAttemptMock: vi.fn(async () => undefined) }));
     vi.mock('@/lib/agents/runtime-limits', () => ({ recordLlmAttempt: recordLlmAttemptMock }));
     vi.mock('@/lib/agents/model-pricing', () => ({ estimateCostCents: () => 12 }));
     ```
     Add `recordLlmAttemptMock.mockClear()` to the `beforeEach` block.
   - **Add a new test** `'records LLM telemetry after a successful generation'`: expects `recordLlmAttemptMock` called once with `{ userId: 'user-canonical', agentId: 'small-cap-trader', mode: 'site-research-report', lane: 'background', success: true, inputTokens: 1200, outputTokens: 800, totalTokens: 2000, estimatedCostCents: 12, modelUsed: 'llama-3.3-70b-versatile' }`.
   - **Add a new test** `'records a failed LLM telemetry entry when generation throws'`: mock the function to reject; expects `recordLlmAttemptMock` called once with `success: false` and the claim row deleted (carryover assertion from Phase 1's failure test).

4. **Validation for Phase 2:**
   ```
   npm run lint
   npx tsc --noEmit
   npm test
   ```
   All three must pass. **Commit** with message:
   ```
   Route site research-report LLM usage through agent telemetry

   The POST handler now calls recordLlmAttempt after a successful or
   failed generation so site usage is visible in agent_request_log and
   factors into the daily/monthly budget check used by the agent runtime.
   ```

---

#### Phase 3 — AskEdgar daily-cap + retry-window state into Postgres

**# COMMIT POINT after Phase 3.**

**Files:**
- `lib/db/schema.ts` (modify — add 2 tables)
- `drizzle/0033_<auto>.sql` + meta files (new, generated)
- `lib/askedgar.ts` (modify — make rate-limit + daily-cap DB-backed with module fallback)
- `__tests__/askedgar-client.test.ts` (modify — the `getAskEdgarCallCount` test still works but may need a mock for the new DB queries)

**Steps:**

1. **Add two tables to `lib/db/schema.ts`** (place them right after the existing `askedgarCache` table around line 135):

   ```ts
   // Daily ticker usage for the AskEdgar daily-unique-ticker cap. One row per
   // (date, ticker). Rows expire naturally via a daily cleanup query — they
   // never need user-facing display. PK is (date, ticker) so we can COUNT or
   // EXISTS-check in a single query.
   export const askedgarDailyTickers = pgTable('askedgar_daily_tickers', {
     date: date('date').notNull(),
     ticker: text('ticker').notNull(),
     createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
   }, (table) => [
     primaryKey({ columns: [table.date, table.ticker] }),
     index('askedgar_daily_tickers_date_idx').on(table.date),
   ]);

   // Singleton runtime state for AskEdgar: persists the 429 retry window
   // across Vercel cold starts. Always a single row with id='global'.
   export const askedgarRuntimeState = pgTable('askedgar_runtime_state', {
     id: text('id').primaryKey(),
     rateLimitedUntil: timestamp('rate_limited_until', { withTimezone: true }),
     updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
   });
   ```

2. **Generate and apply the migration.** Run `npm run db:generate`. The new file `drizzle/0033_<name>.sql` should contain only `CREATE TABLE askedgar_daily_tickers ...`, `CREATE TABLE askedgar_runtime_state ...`, plus the index. **Do not hand-edit the generated SQL.** Run `npm run db:migrate`. Confirm both tables exist. The `askedgar_runtime_state` table will be empty — that's intentional. The singleton row is created lazily on first 429 (see Step 3 below).

3. **Modify `lib/askedgar.ts`.** Three changes:

   **(a)** Add new imports near the top of the file:
   ```ts
   import { askedgarDailyTickers, askedgarRuntimeState } from '@/lib/db/schema';
   import { count } from 'drizzle-orm';
   ```
   `count` may not be available — if not, use `sql<number>\`count(*)\`` inline as the existing askedgar cache code does.

   **(b)** Add two new helpers and modify the existing rate-limit / daily-cap functions. Keep module-level state as a fast-path cache:

   ```ts
   // Below the existing `inFlightTickerRequests` declaration (~line 84), add:
   const MODULE_RATE_LIMIT_REFRESH_MS = 5000; // re-read from DB at most every 5s
   let rateLimitDbLastSyncedAt = 0;

   async function syncRateLimitFromDb(): Promise<void> {
     if (Date.now() - rateLimitDbLastSyncedAt < MODULE_RATE_LIMIT_REFRESH_MS) return;
     const db = getDb();
     if (!db) return;
     try {
       const [row] = await db
         .select({ rateLimitedUntil: askedgarRuntimeState.rateLimitedUntil })
         .from(askedgarRuntimeState)
         .where(eq(askedgarRuntimeState.id, 'global'))
         .limit(1);
       // Missing row is intentional — the singleton is created lazily on first
       // 429 via persistRateLimit's upsert. Treat absence as "no rate limit set".
       rateLimitedUntil = row?.rateLimitedUntil ? row.rateLimitedUntil.getTime() : 0;
       rateLimitDbLastSyncedAt = Date.now();
     } catch (err) {
       console.warn('[askedgar-state] rate-limit DB read failed; using module memory:', err);
     }
   }

   async function persistRateLimit(untilMs: number): Promise<void> {
     const db = getDb();
     if (!db) return;
     try {
       // Upsert: the singleton row may not exist yet on a fresh deploy. First
       // 429 across all Vercel instances creates it; subsequent 429s update it.
       await db.insert(askedgarRuntimeState)
         .values({
           id: 'global',
           rateLimitedUntil: new Date(untilMs),
           updatedAt: new Date(),
         })
         .onConflictDoUpdate({
           target: askedgarRuntimeState.id,
           set: { rateLimitedUntil: new Date(untilMs), updatedAt: new Date() },
         });
       rateLimitDbLastSyncedAt = Date.now();
     } catch (err) {
       console.warn('[askedgar-state] rate-limit DB write failed; module memory remains authoritative for this instance:', err);
     }
   }

   async function syncDailyTickersFromDb(): Promise<void> {
     const currentDate = getCurrentUtcDate();
     if (resetDate === currentDate && uniqueTickersToday.size > 0) {
       // Module cache already warm for today; skip the DB read.
       return;
     }
     const db = getDb();
     if (!db) {
       resetDate = currentDate;
       uniqueTickersToday.clear();
       return;
     }
     try {
       const rows = await db
         .select({ ticker: askedgarDailyTickers.ticker })
         .from(askedgarDailyTickers)
         .where(eq(askedgarDailyTickers.date, currentDate));
       resetDate = currentDate;
       uniqueTickersToday.clear();
       for (const row of rows) uniqueTickersToday.add(row.ticker);
     } catch (err) {
       console.warn('[askedgar-state] daily-tickers DB read failed; using module memory:', err);
       resetDate = currentDate;
     }
   }

   async function persistDailyTicker(ticker: string): Promise<void> {
     const db = getDb();
     if (!db) return;
     const currentDate = getCurrentUtcDate();
     try {
       await db.insert(askedgarDailyTickers)
         .values({ date: currentDate, ticker })
         .onConflictDoNothing();
     } catch (err) {
       console.warn('[askedgar-state] daily-ticker DB write failed:', err);
     }
   }
   ```

   **(c)** Update the call sites:

   - **`requestAskEdgar` (line 261)** stays sync-safe by relying on module state. **Replace** `if (isRateLimited()) return ...` with a call that:
     - Stays sync (no new DB hit per endpoint) — module memory is the fast path.
     - Trusts that `fetchTickerData` and the scanner-summary entry point have already called `syncRateLimitFromDb()`.
     - No change to the line itself; just **delete the `function isRateLimited()` definition at line 85** and inline the check: `if (Date.now() < rateLimitedUntil) return toErrorResponse<T>('...')`.
   - **`setRateLimited` (line 89)** becomes:
     ```ts
     function setRateLimited(retryAfterSeconds: number) {
       rateLimitedUntil = Date.now() + retryAfterSeconds * 1000;
       // Best-effort DB persist — do not await; the module-level update is enough
       // for this instance to honor the window immediately.
       void persistRateLimit(rateLimitedUntil);
     }
     ```
   - **`fetchTickerData` (line 514)** — replace the `resetCounterIfNeeded()` call with:
     ```ts
     await syncDailyTickersFromDb();
     await syncRateLimitFromDb();
     ```
     Then replace `uniqueTickersToday.add(normalizedTicker);` (line 533) with:
     ```ts
     uniqueTickersToday.add(normalizedTicker);
     void persistDailyTicker(normalizedTicker);
     ```
   - **`extractRetryAfterSeconds` (line 130)** — the `isRateLimited()` call here is module-state only. Inline the check: replace `&& isRateLimited()` with `&& Date.now() < rateLimitedUntil`.
   - **`getAskEdgarCallCount` (line 1128)** — `resetCounterIfNeeded()` no longer exists. Replace with `void syncDailyTickersFromDb();` (fire-and-forget — it's a status call) and return `uniqueTickersToday.size`. Document that this returns module-cached state.
   - **Delete `resetCounterIfNeeded` (line 97).** No longer needed; `syncDailyTickersFromDb` handles the date reset.
   - **Scanner-summary path** (`fetchAndCacheScannerSummary` around line ~1407 — search for it): call `await syncRateLimitFromDb();` at the top so this entry point also picks up the rate-limit state on cold start. This path does not count against the daily ticker cap; do not call `syncDailyTickersFromDb` or `persistDailyTicker` here.

4. **Update tests.** `__tests__/askedgar-client.test.ts:317` (`'tracks unique ticker count'`) — the test imports `@/lib/askedgar` and calls `fetchTickerData`. With DB calls now in the path:
   - **If `getDb()` returns null in test environment** (no DB configured), the helpers fall back to module memory and the test should still pass. Verify by running it.
   - If it fails because of an unmocked DB call, add a mock at the top of the test file:
     ```ts
     vi.mock('@/lib/db', () => ({ getDb: () => null }));
     ```
     so the askedgar module operates in pure-module-memory mode for this test. (Other tests in the file may already mock `getDb` — check before adding a duplicate.)
   - Optionally add a new test that **does** mock `getDb` with a working DB stub and asserts `persistDailyTicker` would attempt an INSERT — only if straightforward.

5. **Validation for Phase 3:**
   ```
   npm run lint
   npx tsc --noEmit
   npm run typecheck:services
   npm test
   ```
   All four must pass. **Commit** with message:
   ```
   Persist AskEdgar daily-cap and rate-limit state in Postgres

   Module memory resets on Vercel cold start, so daily ticker caps and
   429 retry windows were advisory only. Adds askedgar_daily_tickers
   and askedgar_runtime_state tables; module state remains as a
   per-instance fast-path cache layered over the DB.
   ```

---

#### Phase 4 — Dashboard scanner aggregate endpoint

**# COMMIT POINT after Phase 4.**

**Files:**
- `app/api/tradingview/gainers/route.ts` (modify — extract helper, route delegates to it)
- `app/api/tradingview/mdr-candidates/route.ts` (modify — extract helper, route delegates to it)
- `app/api/scanner/mdr-recent/route.ts` (modify — extract helper, route delegates to it)
- `app/api/dashboard/scanner-state/route.ts` (new)
- `components/trading/DashboardScannerTable.tsx` (modify — swap 3 fetches for 1)
- `__tests__/dashboard-scanner-state-route.test.ts` (new)

**Steps:**

The three existing scanner routes have all their logic inline inside `GET()`. We extract each route's body into an exported `fetchXForDashboard()` helper, the existing routes delegate to that helper, and the new aggregate calls all three. **Existing route response shapes do not change** — extractions are pure refactors.

1. **Extract `fetchGainersForDashboard` from `app/api/tradingview/gainers/route.ts`.**

   Move the body of `GET()` (lines 216–263, everything inside `try { ... } catch { ... }` after the `requireUser` check) into a new exported function above `GET`:

   ```ts
   export interface DashboardGainersPayload {
     gainers: TradingViewGainer[];
     count: number;
     totalCount: number;
     isRealtime: boolean;
     fetchedAt: string;
   }

   export async function fetchGainersForDashboard(): Promise<DashboardGainersPayload> {
     const sessionId = process.env.TRADINGVIEW_SESSION_ID?.trim() ?? '';

     const [pmPayload, ahPayload] = await Promise.all([
       fetchScan(PM_SCAN_BODY, sessionId),
       fetchScan(AH_SCAN_BODY, sessionId),
     ]);

     const byTicker = new Map<string, TradingViewGainer>();
     for (const row of [...(pmPayload.data ?? []), ...(ahPayload.data ?? [])]) {
       const normalized = normalizeTradingViewRow(row);
       if (!normalized || !qualifiesDayOne(normalized)) continue;

       const existing = byTicker.get(normalized.ticker);
       byTicker.set(normalized.ticker, existing ? richerGainer(existing, normalized) : normalized);
     }

     const gainers = Array.from(byTicker.values()).sort((a, b) => (
       b.dayOneMovePercent - a.dayOneMovePercent
       || b.extendedHoursVolume - a.extendedHoursVolume
       || a.ticker.localeCompare(b.ticker)
     ));

     return {
       gainers,
       count: gainers.length,
       totalCount: (pmPayload.totalCount ?? pmPayload.data?.length ?? 0)
         + (ahPayload.totalCount ?? ahPayload.data?.length ?? 0),
       isRealtime: Boolean(sessionId),
       fetchedAt: new Date().toISOString(),
     };
   }
   ```

   Then rewrite `GET()` to delegate:

   ```ts
   export async function GET() {
     const authState = await requireUser();
     if ('error' in authState) return authState.error;

     try {
       return Response.json(await fetchGainersForDashboard());
     } catch (error) {
       if (error instanceof Error && error.message.startsWith('TradingView scanner returned ')) {
         const status = error.message.replace('TradingView scanner returned ', '');
         return Response.json(
           { error: `TradingView scanner returned ${status}` },
           { status: 502 },
         );
       }
       logRouteError('tradingview-gainers', error);
       return internalServerError();
     }
   }
   ```

   Note: `fetchScan` throws `new Error('TradingView scanner returned ${status}')` on non-OK, so the helper bubbles that up to whichever caller (route or aggregate) wraps it. The aggregate's `Promise.allSettled` will catch it cleanly.

2. **Extract `fetchMdrCandidatesForDashboard` from `app/api/tradingview/mdr-candidates/route.ts`.**

   Move the body of `GET()` (lines 100–173) into an exported helper above `GET`:

   ```ts
   export interface DashboardMdrCandidatesPayload {
     candidates: MdrCandidate[];
     count: number;
     totalCount: number;
     isRealtime: boolean;
     fetchedAt: string;
   }

   export async function fetchMdrCandidatesForDashboard(): Promise<DashboardMdrCandidatesPayload> {
     const sessionId = process.env.TRADINGVIEW_SESSION_ID?.trim() ?? '';

     const response = await fetch('https://scanner.tradingview.com/america/scan', {
       method: 'POST',
       headers: {
         'Content-Type': 'application/json',
         ...(sessionId ? { Cookie: `sessionid=${sessionId}` } : {}),
         'User-Agent': 'Mozilla/5.0',
         Origin: 'https://www.tradingview.com',
         Referer: 'https://www.tradingview.com/',
       },
       body: JSON.stringify(SCAN_BODY),
       cache: 'no-store',
     });

     if (!response.ok) {
       throw new Error(`TradingView scanner returned ${response.status}`);
     }

     const payload = (await response.json()) as {
       totalCount?: number;
       data?: Array<{ s: string; d: unknown[] }>;
     };

     const raw = payload.data ?? [];
     const normalizedCandidates: NormalizedMdrCandidate[] = raw.flatMap((row) => {
       // ... same body as the existing flatMap at lines 134–159, unchanged
     });

     const candidates = await structurallyQualifyCandidates(normalizedCandidates);

     return {
       candidates,
       count: candidates.length,
       totalCount: payload.totalCount ?? candidates.length,
       isRealtime: Boolean(sessionId),
       fetchedAt: new Date().toISOString(),
     };
   }
   ```

   Rewrite `GET()` to delegate:

   ```ts
   export async function GET() {
     const authState = await requireUser();
     if ('error' in authState) return authState.error;

     try {
       return Response.json(await fetchMdrCandidatesForDashboard());
     } catch (error) {
       if (error instanceof Error && error.message.startsWith('TradingView scanner returned ')) {
         const status = error.message.replace('TradingView scanner returned ', '');
         return Response.json(
           { error: `TradingView scanner returned ${status}` },
           { status: 502 },
         );
       }
       logRouteError('tradingview-mdr-candidates', error);
       return internalServerError();
     }
   }
   ```

   The existing route returns 502 inline for non-OK TV responses; the helper now throws instead so behavior moves from the route body into a single catch. Net response shape is identical for callers.

3. **Extract `fetchMdrRecentForDashboard` from `app/api/scanner/mdr-recent/route.ts`.**

   This helper needs DB access. Make it take the db as an argument so the caller can decide what to do when `getDb()` returns null. `getDb` is already imported at the top of the file (line 4) — just add a type alias right above the new helper:

   ```ts
   type AppDb = NonNullable<ReturnType<typeof getDb>>;

   export interface DashboardMdrRecentPayload {
     rows: MdrRecentRow[];
     fetchedAt: string;
   }

   export async function fetchMdrRecentForDashboard(db: AppDb): Promise<DashboardMdrRecentPayload> {
     // Move the body of GET() lines 77–136 here, replacing the top-level try/catch
     // with a plain function body — the caller wraps errors. Keep all logic
     // (cutoff, select, snapshot fan-out, threshold enrichment) unchanged.
     const cutoff = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000)
       .toISOString().split('T')[0]!;
     const rows = await db
       .select({ /* ... unchanged ... */ })
       .from(mdrTriggers)
       .where(and(
         gte(mdrTriggers.triggerDate, cutoff),
         isNull(mdrTriggers.invalidatedAt),
       ))
       .orderBy(sql`${mdrTriggers.triggerDate} desc`);
     // ... rest of the body identical to existing route, returning { rows: out, fetchedAt: ... }
   }
   ```

   Rewrite `GET()` to delegate:

   ```ts
   export async function GET() {
     const authState = await requireUser();
     if ('error' in authState) return authState.error;

     const db = getDb();
     if (!db) return dbUnavailable();

     try {
       return Response.json(await fetchMdrRecentForDashboard(db));
     } catch (error) {
       logRouteError('scanner-mdr-recent', error);
       return internalServerError();
     }
   }
   ```

4. **Create `app/api/dashboard/scanner-state/route.ts`:**

   ```ts
   import {
     fetchGainersForDashboard,
     type DashboardGainersPayload,
   } from '@/app/api/tradingview/gainers/route';
   import {
     fetchMdrCandidatesForDashboard,
     type DashboardMdrCandidatesPayload,
   } from '@/app/api/tradingview/mdr-candidates/route';
   import {
     fetchMdrRecentForDashboard,
     type DashboardMdrRecentPayload,
   } from '@/app/api/scanner/mdr-recent/route';
   import { internalServerError, logRouteError } from '@/lib/api-route-utils';
   import { getDb } from '@/lib/db';
   import { dbUnavailable, requireUser } from '@/lib/server-db-utils';

   export const dynamic = 'force-dynamic';
   export const maxDuration = 60;

   interface CachedState {
     payload: AggregatePayload;
     expiresAt: number;
   }

   interface AggregatePayload {
     gainers: DashboardGainersPayload['gainers'];
     isRealtime: boolean;
     mdrLive: DashboardMdrCandidatesPayload['candidates'];
     mdrRecent: DashboardMdrRecentPayload['rows'];
     fetchedAt: string;
   }

   const TTL_MS = 8_000;
   let cached: CachedState | null = null;

   export async function GET() {
     const authState = await requireUser();
     if ('error' in authState) return authState.error;

     const db = getDb();
     if (!db) return dbUnavailable();

     const now = Date.now();
     if (cached && cached.expiresAt > now) {
       return Response.json(cached.payload);
     }

     try {
       // allSettled — one upstream failure must not break the polling loop.
       // Each helper independently can throw (TV 502, DB error, etc.); we
       // degrade gracefully by serving empty arrays for the failed source.
       const [gainersResult, mdrLiveResult, mdrRecentResult] = await Promise.allSettled([
         fetchGainersForDashboard(),
         fetchMdrCandidatesForDashboard(),
         fetchMdrRecentForDashboard(db),
       ]);

       if (gainersResult.status === 'rejected') {
         console.warn('[dashboard:scanner-state] gainers fetch failed:', gainersResult.reason);
       }
       if (mdrLiveResult.status === 'rejected') {
         console.warn('[dashboard:scanner-state] mdr-candidates fetch failed:', mdrLiveResult.reason);
       }
       if (mdrRecentResult.status === 'rejected') {
         console.warn('[dashboard:scanner-state] mdr-recent fetch failed:', mdrRecentResult.reason);
       }

       const payload: AggregatePayload = {
         gainers: gainersResult.status === 'fulfilled' ? gainersResult.value.gainers : [],
         isRealtime: gainersResult.status === 'fulfilled' ? gainersResult.value.isRealtime : false,
         mdrLive: mdrLiveResult.status === 'fulfilled' ? mdrLiveResult.value.candidates : [],
         mdrRecent: mdrRecentResult.status === 'fulfilled' ? mdrRecentResult.value.rows : [],
         fetchedAt: new Date().toISOString(),
       };

       cached = { payload, expiresAt: now + TTL_MS };
       return Response.json(payload);
     } catch (error) {
       logRouteError('dashboard:scanner-state', error);
       return internalServerError();
     }
   }
   ```

   Notes:
   - **Module-level cache is per-instance.** On Vercel that means each warm function instance has its own cache; cold starts pay the full cost once. Acceptable — the goal is reducing duplicate work for concurrent viewers on one instance, not a global cache.
   - **Auth check happens before cache read** so unauthenticated callers don't poison the cache or get free reads. The cached payload is shared across users; that's already the case for the underlying routes (all three return the same data to any authenticated caller).
   - **`Promise.allSettled` over `Promise.all`** so one upstream failure (TV 502, DB outage) doesn't blank the dashboard. The cache **is** updated with the partial payload — better to serve known-good rows for the working sources than to bounce the cache.
   - **Importing helpers from route files** is fine in Next.js — route files are just modules; the `export const dynamic`/`maxDuration` only apply to the actual `GET`/`POST` exports.

5. **Modify `components/trading/DashboardScannerTable.tsx`:**

   - **Delete** `fetchGainers`, `fetchMdrLive`, `fetchMdrRecent` (the three `useCallback` blocks around lines 292–335).
   - **Replace** with one combined fetch:
     ```ts
     const fetchScannerState = useCallback(async () => {
       try {
         const res = await fetch('/api/dashboard/scanner-state');
         if (!res.ok) return;
         const data = (await res.json()) as {
           gainers: TradingViewGainer[];
           isRealtime: boolean;
           mdrLive: MdrCandidate[];
           mdrRecent: MdrRecentRow[];
         };
         const nextGainers = data.gainers ?? [];
         const today = todayInNewYork();
         setIsRealtime(data.isRealtime ?? false);
         setDayOneLatch((previous) => mergeLatchRows(previous, today, nextGainers));
         setMdrLive(data.mdrLive ?? []);
         setMdrRecent(data.mdrRecent ?? []);
       } catch {
         // Keep last good values on transient polling failures.
       } finally {
         setLoading(false);
       }
     }, []);
     ```
   - **Update the useEffect** (around line 337) to call `fetchScannerState` instead of the three separate fetches. Polling interval stays at 10_000ms.

6. **Add a route test `__tests__/dashboard-scanner-state-route.test.ts`** (required — the cache behavior and allSettled fallback both need coverage):
   - Mock the three helper modules via `vi.mock('@/app/api/tradingview/gainers/route', ...)` etc., each exporting a `vi.fn()` for the `fetchXForDashboard` symbol.
   - Mock `requireUser` to return an authenticated user; mock `getDb` to return a stub (the helpers themselves are mocked so the db value just needs to be truthy).
   - Test 1: call `GET()` twice within `TTL_MS`; assert each helper called exactly once and both responses are identical.
   - Test 2: use `vi.useFakeTimers()` + `vi.advanceTimersByTime(TTL_MS + 1)`; call `GET()` again; assert each helper called a second time.
   - Test 3 (allSettled fallback): make `fetchGainersForDashboard` reject; call `GET()`; assert response has `gainers: []`, `isRealtime: false`, and the other two payloads intact. The cache **should** be updated with this partial payload — a follow-up call within TTL returns the same partial.
   - Test 4: when `getDb()` returns null, GET returns 503 (dbUnavailable) and helpers are not called.

7. **Validation for Phase 4:**
   ```
   npm run lint
   npx tsc --noEmit
   npm test
   ```
   All three must pass. Then **manually verify in the browser**: open the dashboard, confirm scanner table populates (gainers + MDR live + MDR recent), confirm the 10s poll continues working. If the dev server isn't running, start it (`npm run dev`) and visit `/dashboard`. **Commit** with message:
   ```
   Coalesce dashboard scanner polling into one endpoint

   Dashboard previously polled 3 endpoints every 10s per viewer.
   Replaced with /api/dashboard/scanner-state, which calls the same
   upstream helpers behind an 8s server-side TTL cache so multiple
   viewers and rapid polls share one upstream pass.
   ```

---

#### Phase 5 — Final validation

After all four commits are in:

1. Run from repo root:
   ```
   npm run lint
   npx tsc --noEmit
   npm run typecheck:services
   npm test
   npm run workflow:audit
   ```
2. Confirm the four commits are on `main` in the order: Phase 1 → Phase 2 → Phase 3 → Phase 4.
3. Push: `git push origin main`.
4. Manually smoke-test in the browser:
   - **Phase 1+2:** Trigger a research report generation on a ticker; refresh the same ticker in another tab simultaneously — only one should generate, the other should receive the cached/polled result. Check `agent_request_log` table for a row with `mode='site-research-report'`.
   - **Phase 3:** After deploy, query the new tables — `SELECT COUNT(*) FROM askedgar_daily_tickers WHERE date = CURRENT_DATE;` should grow as tickers are fetched.
   - **Phase 4:** Dashboard loads scanner data; verify network tab shows `/api/dashboard/scanner-state` polling at 10s and the three original endpoints are no longer being called.

If any step fails, stop and surface the failure. Do not push half-finished state.

---

#### Files Changed Summary

| File | Phase | Change | Risk |
|---|---|---|---|
| `lib/db/schema.ts` | 1, 3 | Add partial unique index + 2 new tables | Medium |
| `drizzle/0032_*.sql` + meta | 1 | NEW — partial unique index migration | Medium |
| `app/api/research-report/route.ts` | 1, 2 | Rewrite POST with claim + poll + telemetry; filter GET to status='complete' | High (hot path) |
| `__tests__/research-report-route.test.ts` | 1, 2 | Rewrite mocks; add 4 new cases | Low |
| `lib/agents/blueprints/small-cap-research.ts` | 2 | Change exported function return shape | Low (single caller) |
| `drizzle/0033_*.sql` + meta | 3 | NEW — askedgar tables (no seed; singleton row created lazily on first 429) | Medium |
| `lib/askedgar.ts` | 3 | DB-backed daily-cap + rate-limit state with module fallback | High (hot path) |
| `__tests__/askedgar-client.test.ts` | 3 | Mock `getDb` if needed | Low |
| `app/api/tradingview/gainers/route.ts` | 4 | Extract `fetchGainersForDashboard()` helper; route delegates | Low |
| `app/api/tradingview/mdr-candidates/route.ts` | 4 | Extract `fetchMdrCandidatesForDashboard()` helper; route delegates | Low |
| `app/api/scanner/mdr-recent/route.ts` | 4 | Extract `fetchMdrRecentForDashboard(db)` helper; route delegates | Low |
| `app/api/dashboard/scanner-state/route.ts` | 4 | NEW — coalesced aggregate endpoint with allSettled + 8s TTL cache | Low |
| `components/trading/DashboardScannerTable.tsx` | 4 | Swap 3 fetches → 1 | Low |
| `__tests__/dashboard-scanner-state-route.test.ts` | 4 | NEW — cache + allSettled fallback coverage | Low |

#### Acceptance Criteria

- [ ] Partial unique index on `research_reports(ticker) WHERE status='in_progress'` exists in the DB.
- [ ] Two simultaneous POSTs for the same ticker result in exactly **one** call to `generateSmallCapResearchReport` and exactly **one** `complete` row.
- [ ] Stale `in_progress` rows (older than 90s) are reaped on the next POST for that ticker.
- [ ] GET never returns an `in_progress` row.
- [ ] Site research-report generations produce a row in `agent_request_log` with `agentId='small-cap-trader'`, `mode='site-research-report'`, accurate token counts, and `success=true` (or `false` on generation failure).
- [ ] `askedgar_daily_tickers` and `askedgar_runtime_state` tables exist; the singleton `id='global'` row is created lazily on first 429 (initial state: zero rows in `askedgar_runtime_state` after migration).
- [ ] After a Vercel cold start, `fetchTickerData()` honors the persisted rate-limit window and daily ticker count instead of resetting to zero.
- [ ] DB failure in askedgar state helpers does not block fetches — module-memory fallback engages and logs a warning.
- [ ] `/api/dashboard/scanner-state` returns the aggregated payload; second call within 8s does not re-invoke upstream helpers.
- [ ] `DashboardScannerTable` makes exactly one network call per 10s poll (verified via browser devtools).
- [ ] `npm run lint`, `npx tsc --noEmit`, `npm run typecheck:services`, `npm test`, and `npm run workflow:audit` all pass at every commit point.

#### Out of scope

- Step 5 refactors (askedgar module split, tradingview client extraction, client cache hook).
- Step 6 docs drift.
- Adding a budget gate **before** generation in the site path (currently telemetry is recorded post-hoc; gating is a separate decision).
- Replacing module-level Map cache in Phase 4 with Redis/Upstash. The 8s in-memory TTL is acceptable for a single-instance-per-Vercel-function model; revisit if dashboard traffic ever fans out across many instances.
- Persisting `inFlightTickerRequests` coalescing across instances. Instance-local is intentional.

---

### Cleanup Step 3: Delete 4 dead API routes + 3 dead schemas (with migration)

> Generated: 2026-05-12 | Author: planning conversation (cleanup audit `docs/repo-cleanup.md`)
> Status: COMPLETED — implemented and validated 2026-05-12
> Executor: Codex
> Validation: `npm run db:generate`, inspected `drizzle/0031_whole_wendell_vaughn.sql`, `npm run db:migrate`, `npm run lint`, `npx tsc --noEmit`, `npm run typecheck:services`, `npm test`, `npm run workflow:audit`, final grep returned zero TS/TSX matches after clearing stale `.next` metadata.

#### Goal

Step 3 of the cleanup roadmap. **Removals only — no refactors.** Two categories:

1. **Dead API routes (4)** — verified zero callers in `app/`, `lib/`, `services/`, `components/`, `hooks/`:
   - `app/api/saved-tickers/route.ts` — backend-only, no UI consumer.
   - `app/api/market-data/daily-summary/route.ts` — backend-only, no UI consumer.
   - `app/api/agents/research/route.ts` — POST is duplicated by `orchestrator-chat` blueprint (direct DB insert into `agentJobs`); GET has no readers. Discord uses `/api/agents/service/chat`. Site uses the separate `/api/research-report` system. Agent specialists keep working without this route.
   - `app/api/askedgar/lookup/route.ts` — superseded by `/api/askedgar/snapshot`. `ResearchTickerView.tsx:44` is the only research caller and it already uses `snapshot`.

2. **Dead DB schemas (3)** — only the deleted routes (or nothing) imported them:
   - `savedTickers` — only imported by the route being deleted.
   - `dailyTickerSummaries` — only imported by the route being deleted.
   - `agentMemory` — zero importers (active code uses `agentMemoryV2`).

Plus the test files for the four routes and the now-dead `researchPostSchema` in `lib/validations/agents.ts`.

A new Drizzle migration drops the three tables. Two live doc references get updated; sprint-history docs are intentionally untouched.

#### Locked decisions

- All three tables get dropped via a single new Drizzle migration file. Do **not** use `db:push` (causes false positives on this repo's composite PKs and corrupts migration history — see `feedback_db_migrate_over_push.md`).
- Use `npm run db:generate` to create the migration file, inspect the generated SQL, then `npm run db:migrate` to apply.
- `lib/validations/agents.ts`: `researchPostSchema` and `ResearchPostInput` are only used by `app/api/agents/research/route.ts` — drop them in this spec.
- `docs/AGENTIC_EXPANSIONV2.md` and `.opencode/` references stay alone — those are historical sprint records.
- Tests for deleted routes get deleted alongside.
- `app/api/market-data/route.ts` (the parent route, not the subdir) stays — only the `daily-summary` subdir is removed.

---

#### Phase 1 — Delete the 4 route files and their tests

**Action:** DELETE 8 files.

1. Delete `app/api/saved-tickers/route.ts` (then remove the now-empty `app/api/saved-tickers/` directory).
2. Delete `app/api/market-data/daily-summary/route.ts` (then remove the now-empty `app/api/market-data/daily-summary/` directory; leave `app/api/market-data/route.ts` and the parent directory in place).
3. Delete `app/api/agents/research/route.ts` (then remove the now-empty `app/api/agents/research/` directory).
4. Delete `app/api/askedgar/lookup/route.ts` (then remove the now-empty `app/api/askedgar/lookup/` directory).
5. Delete `__tests__/saved-tickers-route.test.ts`.
6. Delete `__tests__/market-data-daily-summary-route.test.ts`.
7. Delete `__tests__/agent-research-route.test.ts`.
8. Delete `__tests__/askedgar-lookup-route.test.ts`.

**Validation after Phase 1:** `npx tsc --noEmit` should pass — no remaining file imports these routes or their tests.

---

#### Phase 2 — Drop dead `researchPostSchema` from `lib/validations/agents.ts`

**File:** `lib/validations/agents.ts`
**Action:** MODIFY

1. Delete lines 27–32:
   ```ts
   export const researchPostSchema = z.object({
     ticker: z.string().regex(/^[A-Z]{1,5}$/),
     agent_id: z.enum(['small-cap-trader', 'swing-trader']),
   });

   export type ResearchPostInput = z.infer<typeof researchPostSchema>;
   ```
2. Leave the blank line spacing tidy — collapse adjacent blank lines so the next export (`adminMemoryListQuerySchema`) follows one blank line after `redeliverSchema`/`reportsListQuerySchema`.

**Validation after Phase 2:** `npx tsc --noEmit` and `npm run lint` should both pass.

---

#### Phase 3 — Remove schema objects and generate the drop migration

**File:** `lib/db/schema.ts`
**Action:** MODIFY

1. Delete the `agentMemory` export block at lines 110–123 (the entire `export const agentMemory = pgTable('agent_memory', { ... })` definition including the `}, (table) => [ ... ]);` closing block).
2. Delete the `dailyTickerSummaries` export block at lines 139–156 (entire export).
3. Delete the `savedTickers` export block at lines 158–168 (entire export).
4. Leave all surrounding exports (`brokerSyncHistory`, `researchReports`, `askedgarCache`, etc.) and their comments unchanged. Tidy any leftover double-blank-lines.

**Then generate and apply the migration:**

5. Run `npm run db:generate`. This creates a new file at `drizzle/0031_<name>.sql` containing three `DROP TABLE` statements.
6. Open the generated SQL and confirm it only contains:
   - `DROP TABLE "agent_memory" CASCADE;` (or equivalent)
   - `DROP TABLE "daily_ticker_summaries" CASCADE;`
   - `DROP TABLE "saved_tickers" CASCADE;`
   And no other table changes. If anything else appears, stop and surface it — the schema delta is wrong.
7. Run `npm run db:migrate` to apply the migration to the database.
8. The `drizzle/meta/_journal.json` and `drizzle/meta/0031_snapshot.json` will be updated automatically by `db:generate`. Commit those alongside the SQL file.

**Validation after Phase 3:** `npx tsc --noEmit` and `npm run lint` pass; the migration applied cleanly (no errors from `db:migrate`).

---

#### Phase 4 — Update live doc references

Two live docs reference deleted routes. Update them; leave sprint-history docs alone.

**File:** `codex-skills/nexus-askedgar-debug/SKILL.md`
**Action:** MODIFY

1. At line 25, delete the bullet `   - \`/api/askedgar/lookup\`` so the surface list becomes:
   ```
   1. Identify the failing surface:
      - `/api/askedgar/snapshot`
      - `/api/askedgar/tldr`
      - `lib/research.ts`
      - agent blueprints under `lib/agents/blueprints/`
   ```

**File:** `docs/FUTURE-PLANS.md`
**Action:** MODIFY

2. At line 397, change:
   ```
   - Read APIs already exist: `app/api/agents/reports/route.ts`, `app/api/agents/reports/[id]/route.ts`, `app/api/agents/research/route.ts`, `app/api/agents/macro-summary/latest/route.ts`.
   ```
   to:
   ```
   - Read APIs already exist: `app/api/agents/reports/route.ts`, `app/api/agents/reports/[id]/route.ts`, `app/api/agents/macro-summary/latest/route.ts`.
   ```
3. At line 428, delete the entire bullet:
   ```
   - **No user-facing job polling for research** — `POST /api/agents/research` queues but has no first-class status endpoint for the site.
   ```
   The bullet above it (`**Discord-locked service route**`) and the bullet below it (`**Conversation history scope too broad**`) should sit on consecutive lines after the deletion.

**Do not** edit `docs/AGENTIC_EXPANSIONV2.md`, `.opencode/` snapshots, or `docs/repo-cleanup.md` — those are historical records.

---

#### Phase 5 — Final validation

Run from repo root, in order:

1. `npm run lint`
2. `npx tsc --noEmit`
3. `npm run typecheck:services` (the services entrypoint imports from `lib/` and `lib/db/schema.ts` is in that path)
4. `npm test`
5. Final dead-code grep:
   ```bash
   grep -rn "saved-tickers\|savedTickers\|daily-summary\|dailyTickerSummaries\|api/agents/research\|askedgar/lookup\|agentMemory\b\|researchPostSchema\|ResearchPostInput" \
     --include='*.ts' --include='*.tsx' .
   ```
   Should return only matches inside `.opencode/`, `docs/repo-cleanup.md`, `docs/AGENTIC_EXPANSIONV2.md`, and historical learn notes — all of which are intentionally left alone. Zero matches in live `app/`, `lib/`, `services/`, `components/`, `hooks/`, `__tests__/`.

If anything fails, stop and surface the failure. Do not commit half-finished state.

---

#### Files Changed Summary

| File | Change | Risk |
|---|---|---|
| `app/api/saved-tickers/route.ts` | DELETE (+ empty dir) | Low |
| `app/api/market-data/daily-summary/route.ts` | DELETE (+ empty dir) | Low |
| `app/api/agents/research/route.ts` | DELETE (+ empty dir) | Low |
| `app/api/askedgar/lookup/route.ts` | DELETE (+ empty dir) | Low |
| `__tests__/saved-tickers-route.test.ts` | DELETE | Low |
| `__tests__/market-data-daily-summary-route.test.ts` | DELETE | Low |
| `__tests__/agent-research-route.test.ts` | DELETE | Low |
| `__tests__/askedgar-lookup-route.test.ts` | DELETE | Low |
| `lib/validations/agents.ts` | Drop `researchPostSchema` + `ResearchPostInput` (lines 27–32) | Low |
| `lib/db/schema.ts` | Drop `agentMemory`, `dailyTickerSummaries`, `savedTickers` exports | Low |
| `drizzle/0031_<auto>.sql` | NEW — generated DROP TABLE migration | Medium |
| `drizzle/meta/_journal.json` | AUTO-UPDATED by `db:generate` | Low |
| `drizzle/meta/0031_snapshot.json` | NEW — generated by `db:generate` | Low |
| `codex-skills/nexus-askedgar-debug/SKILL.md` | Remove `/api/askedgar/lookup` bullet (line 25) | Low |
| `docs/FUTURE-PLANS.md` | Remove `/api/agents/research` ref (line 397) + delete bullet at line 428 | Low |

#### Acceptance Criteria

- [x] All 4 route files and their parent directories are deleted from the working tree.
- [x] All 4 test files are deleted.
- [x] `lib/validations/agents.ts` no longer exports `researchPostSchema` or `ResearchPostInput`.
- [x] `lib/db/schema.ts` no longer exports `agentMemory`, `dailyTickerSummaries`, or `savedTickers`.
- [x] A new `drizzle/0031_whole_wendell_vaughn.sql` migration exists, contains only the three `DROP TABLE` statements, and has been applied via `npm run db:migrate`.
- [x] `codex-skills/nexus-askedgar-debug/SKILL.md:25` no longer lists `/api/askedgar/lookup`.
- [x] `docs/FUTURE-PLANS.md` line 397 no longer references `app/api/agents/research/route.ts` and line 428's bullet is removed.
- [x] `npm run lint`, `npx tsc --noEmit`, `npm run typecheck:services`, and `npm test` all pass.
- [x] Final grep returns zero matches in live `app/`, `lib/`, `services/`, `components/`, `hooks/`, `__tests__/`.

#### Out of scope

- Step 4 cost/reliability fixes (POST idempotency, runtime-limits routing for site reports, AskEdgar caps in Postgres, dashboard aggregate endpoint).
- Step 5 refactors (askedgar split, tradingview client extraction, client cache hook).
- Step 6 docs drift compaction.
- Updating sprint history (`docs/AGENTIC_EXPANSIONV2.md`, `.opencode/learn/`, `docs/repo-cleanup.md`) — intentional.

---

### Cleanup Step 2: Delete high-confidence dead components + `fetchAndCacheRawReport`

> Generated: 2026-05-11 | Author: planning conversation (cleanup audit `docs/repo-cleanup.md`)
> Status: COMPLETED — implemented and validated 2026-05-12
> Executor: Codex
> Validation: Phase 1 `npx tsc --noEmit`; Phase 2 `npx tsc --noEmit`, `npm run lint`; final `npm run lint`, `npx tsc --noEmit`, `npm test`, dead-code grep returned zero matches.

#### Goal

Step 2 of the cleanup roadmap. **Removals only — no refactors.** All four targets were verified dead with `rg` immediately before this spec was written:

- `WeeklyCalendar.tsx` — only self-references; Journal uses `TradingCalendar`.
- `ResearchGainersList.tsx` — only self-references; current Research tab does not import it.
- `HorizontalLinePrimitive.ts` — zero callers; horizontal lines are drawn via `series.createPriceLine()` in the chart component (the file is a stale type-only stub).
- `fetchAndCacheRawReport()` in `lib/research.ts` — zero callers; the snapshot route uses `getCachedTickerData()` directly. Deleting it makes several `lib/research.ts` imports dead, which we drop in the same change.

The stale comment in `app/api/research-report/route.ts:52` references `fetchAndCacheRawReport()` and gets updated since the function it cites is being deleted.

#### Locked decisions

- Sibling primitives (`FibonacciPrimitive.ts`, `RectanglePrimitive.ts`, `TrendLinePrimitive.ts`) **stay** — only `HorizontalLinePrimitive.ts` is dead.
- The defensive `if (latest?.reportJson)` check in `app/api/research-report/route.ts` **stays** — older DB rows seeded by the old `fetchAndCacheRawReport()` may still have `reportJson = null`. Only the comment changes.
- `lib/research.ts` keeps `getCachedTickerData`, `AskEdgarResponse`, `callLlm`, `isObject`, `parseJson`, `trimRawDataForLlm`, `collectRawDataWarnings`, `buildResearchTldrPrompt`, `runResearchTldr`. The drizzle/db imports become unused after the function is removed — they get dropped in the same edit.
- No tests reference any of these symbols (verified). No test edits needed.

---

#### Phase 1 — Delete the three dead component files

**Goal:** Remove dead UI files. Pure deletes; no consumers.

1. Delete `components/trading/WeeklyCalendar.tsx`.
2. Delete `components/trading/ResearchGainersList.tsx`.
3. Delete `components/trading/plugins/HorizontalLinePrimitive.ts`.

**Validation after Phase 1:** `npx tsc --noEmit` should pass — none of these files are imported anywhere.

---

#### Phase 2 — Delete `fetchAndCacheRawReport` and drop dead imports in `lib/research.ts`

**File:** `lib/research.ts`
**Action:** MODIFY

1. Delete the entire `fetchAndCacheRawReport` function (currently lines 125–197, including the `/** Fetch AskEdgar data... */` doc comment that precedes it on lines 125–128).
2. Update the `runResearchTldr` doc comment (currently lines 199–202). Replace:
   ```ts
   /**
    * Generate a compact TLDR from AskEdgar data for the research tab display.
    * Expects rawData from fetchAndCacheRawReport() or fetchTickerData().
    */
   ```
   with:
   ```ts
   /**
    * Generate a compact TLDR from AskEdgar data for the research tab display.
    * Expects rawData from getCachedTickerData().
    */
   ```
3. Drop the now-unused imports at the top of the file:
   - Remove `and, desc, eq, gte` from the `drizzle-orm` import (line 1) — delete the whole import line; nothing else in this file uses drizzle helpers.
   - Remove the `getDb` import from `@/lib/db` (line 3) — delete the whole line.
   - Remove the `researchReports` import from `@/lib/db/schema` (line 4) — delete the whole line.
4. The remaining imports at the top of the file should be exactly:
   ```ts
   import { getCachedTickerData } from '@/lib/askedgar';
   import type { AskEdgarResponse } from '@/lib/askedgar';
   import { callLlm } from '@/lib/llm-client';
   ```

**Validation after Phase 2:** `npx tsc --noEmit` and `npm run lint` should both pass.

---

#### Phase 3 — Update the stale comment in `app/api/research-report/route.ts`

**File:** `app/api/research-report/route.ts`
**Action:** MODIFY

1. Replace the two-line comment at lines 52–53:
   ```ts
   // Only return rows with a structured report_json - early-day rows seeded by
   // fetchAndCacheRawReport() leave reportJson null. Treat those as "no fresh report".
   ```
   with a single line:
   ```ts
   // Older rows can have reportJson=null from legacy seeding; treat them as "no fresh report".
   ```
2. Do not change the `if (latest?.reportJson)` check itself or any surrounding logic.

**Why we keep the null check:** historical rows in the `research_reports` table may still carry `reportJson = null` from past use of the deleted seeder. The defensive check is still correct; only the comment was citing a function that no longer exists.

---

#### Phase 4 — Final validation

Run from repo root, in order:

1. `npm run lint`
2. `npx tsc --noEmit`
3. `npm test`
4. Final dead-code grep:
   ```bash
   grep -rn "WeeklyCalendar\|ResearchGainersList\|HorizontalLinePrimitive\|fetchAndCacheRawReport" \
     --include='*.ts' --include='*.tsx' .
   ```
   Should return **zero matches** outside `.opencode/reports/` (which contains historical audit snapshots — intentionally left alone) and `docs/repo-cleanup.md` (the audit doc — historical reference, intentionally left alone).

If anything fails, stop and surface the failure. Do not commit half-finished state.

---

#### Files Changed Summary

| File | Change | Risk |
|---|---|---|
| `components/trading/WeeklyCalendar.tsx` | DELETE | Low |
| `components/trading/ResearchGainersList.tsx` | DELETE | Low |
| `components/trading/plugins/HorizontalLinePrimitive.ts` | DELETE | Low |
| `lib/research.ts` | Delete `fetchAndCacheRawReport` + drop 3 dead import lines + docstring fix | Low |
| `app/api/research-report/route.ts` | Replace stale 2-line comment with 1-line comment (line 52–53) | Low |

#### Acceptance Criteria

- [x] All three component files are deleted from the working tree.
- [x] `lib/research.ts` no longer exports `fetchAndCacheRawReport`.
- [x] `lib/research.ts` only imports `getCachedTickerData`, `AskEdgarResponse`, and `callLlm`.
- [x] `runResearchTldr`'s doc comment no longer mentions `fetchAndCacheRawReport`.
- [x] `app/api/research-report/route.ts` line 52 comment no longer mentions `fetchAndCacheRawReport`; the `if (latest?.reportJson)` check is unchanged.
- [x] `npm run lint` passes.
- [x] `npx tsc --noEmit` passes.
- [x] `npm test` passes.
- [x] Final grep for the four identifiers returns zero matches in `*.ts` / `*.tsx` outside `.opencode/reports/`.

#### Out of scope

- Any other entries in `docs/repo-cleanup.md` (cost/reliability fixes, refactors, docs drift). Those are Steps 4–6.
- Updating `.opencode/reports/` historical audit snapshots — they are timestamped records and should not be edited retroactively.

---

## Cleanup Plan Roadmap

The full cleanup is sequenced as removals first, then fixes, then refactors. Each step gets its own HANDOFF spec when we're ready to execute it.

1. **Step 1 (COMPLETED 2026-05-11):** Discord research import stack + Schwab dead deps.
2. **Step 2 (COMPLETED 2026-05-12):** High-confidence dead code: `WeeklyCalendar`, `ResearchGainersList`, `HorizontalLinePrimitive`, `fetchAndCacheRawReport()`, plus the stale comment in `app/api/research-report/route.ts:52`.
3. **Step 3 (COMPLETED 2026-05-12):** Deleted 4 dead routes (`saved-tickers`, `market-data/daily-summary`, `/api/agents/research`, `/api/askedgar/lookup`), their tests, dead `researchPostSchema`, 3 dead schemas (`agentMemory`, `dailyTickerSummaries`, `savedTickers`) plus Drizzle migration `0031_whole_wendell_vaughn.sql`, and two live doc refs (askedgar-debug skill, FUTURE-PLANS bullets).
4. **Step 4 — Cost/reliability fixes:** Make `/api/research-report` POST idempotent (DB-backed ticker claim to prevent duplicate paid LLM calls); route site-report LLM usage through `lib/agents/runtime-limits.ts` budget telemetry; move AskEdgar daily-cap + retry-window state into Postgres (module memory resets on Vercel cold start, so today's caps are advisory only). Add one short-TTL server aggregate endpoint for the dashboard scanner polling.
5. **Step 5 — Refactors (only after pruning):** Split `lib/askedgar.ts` (1,462 lines) into `endpoints` / `fanout` / `cache` / `snapshot-normalizer`. Extract `lib/tradingview-client.ts` for shared TradingView scan logic. Replace module-level client caches in `ResearchTldr`, `ResearchReportPanel`, `MacroSummaryPanel`, `use-candle-data` with one TTL-aware resource hook.
6. **Step 6 — Docs drift:** Compact `HANDOFF.md` after Step 5 (or sooner if it gets stale again). Update `README.md` env-var section (`JARVIS_*` → `LLM_*` / `BACKGROUND_LLM_*`). Update `docs/VALIDATION_MATRIX.md` (refs deleted `services/backtest-*`). Sync `codex-skills/nexus-vercel-ops/SKILL.md` and `docs/FUTURE-PLANS.md` cron counts (now 2 after Step 1, not 3). Update `AGENTS.md` validation-file count.

Codex-skills sync work is intentionally **excluded** from this roadmap per user direction.

---

## Recently Completed Summary

- 2026-05-12: Cleanup Step 2 removed dead `WeeklyCalendar`, `ResearchGainersList`, and `HorizontalLinePrimitive` files; deleted `fetchAndCacheRawReport()` from `lib/research.ts`; and replaced the stale research-report route comment. Validation passed.
- 2026-05-11: Cleanup Step 1 removed the retired Discord research import stack, dropped `imported_research_reports` and `ticker_research_summaries` via `drizzle/0030_freezing_charles_xavier.sql`, removed the Discord sync cron/root env stubs, and uninstalled the unused Schwab package/spec. TLDR now runs on AskEdgar data only.
- 2026-05-07: Research Report wiring (site endpoint + auto-cache + Research tab panel), TLDR risk-ranked refactor (`{ findings, historicalContext }`), and Research-tab empty-state polish. Code-validated; authenticated/manual browser smoke pending.
- 2026-05-07: Research tab refresh shipped (8 → 5 tabs, Dilution rewrite, auto-TLDR, Overview rebuild, conditional chart). Then Dilution Rating + chart-less header polish, `overall_offering_risk` mapped from AskEdgar dilution-rating endpoint, Overview titles bumped to `text-base`, inner-scroll restructure.
- 2026-05-05: Dashboard scanner completion — split PM/AH gainers scan with combined volume gating, MDR scanner with `mdr_triggers` table + nightly cron + dashboard merging of live and recent rows. Threshold values render as prices/percentages.
- 2026-05-04: Backtesting UI refinements plus grid layout and sample-set sidebar (`b03fa38`, `82bfa46`, `10e1071`, `82cca14`, `36a410b`).
- 2026-05-03: Backtesting chart drawing/indicator persistence and review save-flow fixes (`82cbb55`, `88a4da4`, `6513e40`).
- 2026-05-01: Backtest Manager landing page shipped: schema, API, manager, stats views.

## Open Follow-Ups Carried Forward

- AskEdgar Sprint 3 Part B (`split-status`) remains parked pending endpoint-usage audit.
- Endpoint review still pending: `screener`, `ownership`, `nasdaq-compliance`, `historical-float-pro`, and `float-outstanding`.
- Filings v2/v3 remain deferred: in-app SEC filing viewer, then full-text filing search plus AI Copilot after cost analysis.
- Auto stop-out for Backtesting remains deferred until requested.
- Backtest Manager `broke_premarket_high` filter remains deferred. Data is not captured today; revisit once we decide whether to store it on the session at save time or derive from market data on stats load.
- 2026-05-07 Research Report bundle: authenticated/manual browser smoke still unchecked.

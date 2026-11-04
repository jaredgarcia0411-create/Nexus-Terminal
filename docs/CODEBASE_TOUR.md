# Nexus Terminal — Codebase Tour

A beginner's walkthrough of the repository. It answers four questions:

1. What does each major folder do?
2. How does a request flow from the browser to the database?
3. How do the Discord scan cards get produced?
4. Which 10 files should I read first, and why?

This file is a guided tour. `docs/ARCHITECTURE.md` is the reference map (every folder, every "if you change X also touch Y" rule), and `AGENTS.md` is the process guide (commands to run, auth helpers, conventions). Read this file first, then keep those two open while you work.

---

## 1. The big picture

Nexus Terminal is two deployables that share one codebase and one PostgreSQL database:

| Deployable | Where it runs | What it is |
|------------|---------------|------------|
| **Web app** | Vercel | Next.js 15 app: the trading journal UI plus every `/api/**` HTTP handler. |
| **Agent services** | Docker Compose on a home server | Three long-running Node processes (`orchestrator`, `small-cap-trader`, `swing-trader`) plus a Discord bot. They run scans and research in the background and post results to Discord. |

Both sides import from the same `lib/` folder. The web app imports it directly; the agent images copy `lib/` into the container at build time (see `services/agent.Dockerfile`). That is why `lib/` is the heart of the repo: it is the only code that both halves run.

The database is Neon PostgreSQL, accessed through Drizzle ORM. The schema is one file, `lib/db/schema.ts`, and `drizzle/` holds the generated migration SQL.

```
                        ┌──────────────────────────┐
   Browser ──HTTP──▶    │  Vercel: Next.js         │ ──▶ Neon PostgreSQL ◀──┐
                        │  app/ + lib/             │                        │
                        └──────────────────────────┘                        │
                                                                            │
   Discord ◀──webhook──┐                                                    │
                       │  ┌──────────────────────────┐                      │
   Discord ──bot──▶    └──│  Home server: Docker     │ ─────────────────────┘
                          │  services/ + lib/agents/ │
                          └──────────────────────────┘
```

---

## 2. What each major folder does

### `app/` — pages and HTTP handlers (Next.js App Router)

- `app/page.tsx` is the entire single-page UI. It owns the active tab, the selected trade, the command palette, and the global keyboard shortcuts, then renders one tab component at a time. Page-level orchestration is supposed to live here and nowhere else.
- `app/layout.tsx` is the root HTML shell (theme provider, session provider, toaster).
- `app/login/page.tsx` is the Google sign-in screen.
- `app/api/**/route.ts` is every HTTP endpoint. Each folder is a feature: `trades/`, `sheets/`, `askedgar/`, `backtests/`, `agents/`, `cron/`, and so on. There are about 64 route files. Every one follows the same shape, described in section 3.

### `lib/` — shared business logic

Everything that is not React and not an HTTP handler. The important sub-areas:

| Path | Owns |
|------|------|
| `lib/db.ts`, `lib/db/schema.ts` | Drizzle client and the single schema file. Every table in the system is declared in `schema.ts`. |
| `lib/server-db-utils.ts` | `requireUser()`, `ensureUser()`, `dbUnavailable()`, `requireCronSecret()`, and row-to-API mappers like `toTrade()`. |
| `lib/api-route-utils.ts` | `parseAndValidate()` for Zod body validation, plus the generic error helpers. |
| `lib/validations/` | Zod schemas for request bodies, one file per feature. |
| `lib/auth-config.ts` | NextAuth config: Google OAuth, an email allowlist, JWT sessions. |
| `lib/agents/` | The agent runtime: job queue, worker loop, blueprints, LLM client, Discord delivery. See section 4. |
| `lib/parabolic/`, `lib/triple-beat/` | The two scanners. Pure scoring in `scan.ts`, market-data loaders in `data.ts`. No React, no DB. |
| `lib/massive-market.ts` | Client for the Massive market-data API (daily bars, premarket stats, ticker reference). |
| `lib/askedgar.ts`, `lib/askedgar/` | Cached client for the usage-billed AskEdgar research API. Always use `getCachedTickerData`. |
| `lib/sec/` | SEC EDGAR client with the required User-Agent, rate limit, and retries. |
| `lib/trade-utils.ts` | Pure trade math and the browser-side `apiRequest()` helper. |
| `lib/sheets/`, `lib/backtest-*.ts`, `lib/market-pulse/` | Feature logic for the Sheets tab, the backtesting workspace, and the market-pulse panel. |
| `lib/types.ts` | Shared domain types such as `Trade` and `ApiTrade`. |

### `components/` — React components

- `components/trading/` holds the feature components: one file per tab (`DashboardTab`, `TradesTab`, `SheetsTab`, `ResearchTab`, `BacktestingTab`), plus dialogs, sheets, charts, and tables.
- `components/ui/` holds shadcn/Radix primitives (button, dialog, popover). Add new primitives here; do not reinvent them inside feature components.
- `components/theme/` holds the theme provider.

### `hooks/` — custom React hooks

Deliberately small. The hook you will meet first is `hooks/use-trades.ts`, which the page calls once and which bundles trade state, filters, and persistence. It is being decomposed into `use-trade-sync.ts` (fetching and saving), `use-trade-filters.ts` (search and filter state), and `lib/trade-utils.ts` (pure logic). Do not add new logic to `use-trades.ts`; create a new hook instead.

### `services/` — the Docker side

- `services/agent-entrypoint.ts` is the `main()` for every agent container. It reads `AGENT_ID`, starts the worker loop, and if the agent is the orchestrator, starts the cron schedulers.
- `services/agent.Dockerfile` builds one image used by all three agents. It copies `lib/` and the entrypoint, so **any change to `lib/` needs a rebuild**.
- `services/docker-compose.yml` defines the four containers and lists the env vars each one receives.
- `services/discord-bot/` is a separate small project. It listens in Discord, POSTs chat messages to `/api/agents/service/chat` on the web app, and polls for the answer.

`services/` has its own `tsconfig.json`, so the root type-check does not cover it. Run `npm run typecheck:services` when you touch it.

### `drizzle/` — generated migrations

Numbered SQL files produced by `npm run db:generate` from `lib/db/schema.ts`. Never hand-edit them.

### `__tests__/` — Vitest tests

Flat folder, one file per module or route (`trades-route.test.ts`, `parabolic-scan.test.ts`, `agent-discord.test.ts`). Tests mock the auth, DB, and network boundaries with `vi.mock`. Run one with `npx vitest run __tests__/<name>.test.ts`.

### `scripts/` — one-off ops scripts

Safe migration runner (`db-migrate-safe.mjs`), the workflow drift audit, and the scanner replay scripts (`parabolic-replay.ts`, `triple-beat-replay.ts`) that backtest the scanners over historical dates.

### `docs/`, `specs/`, `codex-skills/`, `.claude/`

Documentation and agent-workflow assets. `docs/ARCHITECTURE.md` is the structural map, `docs/repo-cleanup.md` is the tech-debt list, `docs/ops/` covers deploying and recovering the home server. `specs/` holds in-flight feature specs. `codex-skills/` and `.claude/` configure the coding agents that work in this repo; `AGENTS.md` is their canonical guide.

### Root files worth knowing

- `middleware.ts` runs NextAuth's `auth` on every non-API, non-login page and redirects logged-out users to `/login`.
- `vercel.json` schedules two Vercel crons that hit `/api/cron/*` routes.
- `vitest.config.ts`, `eslint.config.mjs`, `tsconfig.json` are the usual tool configs.

---

## 3. How a request flows from the browser to the database

Follow one concrete example: the Trades tab loading the user's trade list.

**Step 1: the page mounts and a hook fires.**
`app/page.tsx` calls `useTrades()`. Inside, `hooks/use-trade-sync.ts` reads the NextAuth session with `useSession()`, and once the user is authenticated it calls `refreshTrades()`.

**Step 2: the browser calls the API.**
`refreshTrades()` uses `apiRequest()` from `lib/trade-utils.ts`, a thin wrapper over `fetch` that sets JSON headers and turns non-2xx responses into thrown errors. It requests `/api/trades` and `/api/tags` in parallel. The session cookie goes along automatically.

**Step 3: Next.js routes to the handler.**
`app/api/trades/route.ts` exports a `GET` function. API routes are excluded from `middleware.ts`, so the route must check auth itself.

**Step 4: the handler authenticates.**
The first line is `const authState = await requireUser()` from `lib/server-db-utils.ts`. It calls NextAuth's `auth()`, reads the JWT session, and returns either `{ user }` or `{ error: Response }` with a 401. The handler returns early on error.

**Step 5: the handler gets a DB client.**
`const db = getDb()` from `lib/db.ts` returns a Drizzle client over Neon's HTTP driver, or `null` if `DATABASE_URL` is missing, in which case the handler returns `dbUnavailable()` (503). For bulk transactional writes routes use `getPoolDb()` instead.

**Step 6: the handler reconciles the user row.**
`await ensureUser(db, authState.user)` makes sure a `users` row exists and that the session's user id matches the canonical id in the database. It may rewrite `authState.user.id` in place if the account was first created under a different id.

**Step 7: the handler queries.**
```ts
const tradeRows = await db.select().from(trades)
  .where(eq(trades.userId, authState.user.id))
  .orderBy(desc(trades.date));
```
Every user-scoped query filters by `userId`. The `trades` table object comes from `lib/db/schema.ts`.

**Step 8: rows become API shapes.**
`toTrade()` from `lib/server-db-utils.ts` maps a database row to the `ApiTrade` type in `lib/types.ts`, filling in derived fields like gross P&L. The handler returns `Response.json({ trades })`.

**Step 9: back in the browser.**
`use-trade-sync.ts` converts each `ApiTrade` into the client `Trade` type with `fromApiTrade()`, sorts, and stores the list in React state. The Trades tab re-renders.

**Writes follow the same shape plus validation.** A `POST` handler adds one step between auth and the query:

```ts
const bodyState = await parseAndValidate(request, createTradeSchema);
if (bodyState.error) return bodyState.error;
```

`parseAndValidate()` in `lib/api-route-utils.ts` parses JSON and runs a Zod schema from `lib/validations/`. On failure it returns a 400 with `{ error: 'Validation failed', details }`. On the client, every data-writing hook function is wrapped in `withErrorToast` so a failed save shows a toast rather than failing silently.

**Other route families change only the auth step.**

| Route family | Auth helper | Who calls it |
|--------------|-------------|--------------|
| `/api/trades`, `/api/sheets`, most routes | `requireUser()` | The browser, with a session cookie |
| `/api/cron/*` | `requireCronSecret()` | Vercel cron, with a bearer token |
| `/api/agents/admin/*` | `requireAgentAdmin()` | Admin UI |
| `/api/agents/service/*` | `requireServiceAuth()` / `requireServiceKey()` | The Discord bot, with a service key header |

Streaming routes use `createSSEResponse()` from `lib/sse.ts` and declare `export const dynamic = 'force-dynamic'` and `export const maxDuration = 60`.

One rule to internalize now: **module-level variables are not durable on Vercel.** A `Map` at the top of a route file resets on every cold start. Anything that must survive a request goes in the database.

---

## 4. How the Discord scan cards get produced

The scan cards are the embeds posted every trading morning to the parabolic and triple-beat Discord channels. They are produced entirely on the Docker side, with no browser involved. The parabolic scanner is the simplest example; the triple-beat scanner follows the same path with one extra LLM step.

### 4.1 The scheduler enqueues a job

`services/agent-entrypoint.ts` starts the orchestrator container. Because the agent id is `orchestrator`, it calls `startParabolicCron(db)` and `startTripleBeatCron(db)` from `lib/agents/macro-cron.ts`.

Each cron checks the clock once a minute. When the Eastern-time hour matches `PARABOLIC_CRON_HOUR_ET` (default 9) on a weekday, `runTick()` opens a transaction, inserts a row into `agent_scheduled_runs` keyed on `(agent_id, trigger_type, trading_date)`, and inserts a row into `agent_jobs` with `jobType: 'parabolic-scan'` and `input: { tradingDate }`. The unique key on `agent_scheduled_runs` is what prevents a second container, or a restart, from enqueuing the same scan twice.

Nothing is computed yet. The cron only writes a job row.

### 4.2 The worker claims the job

The same orchestrator process is also running `startWorker()` from `lib/agents/worker.ts`. The worker polls `agent_jobs` every few seconds through `claimNextQueuedJob()` in `lib/agents/queue.ts`. That function is a single SQL `UPDATE ... WHERE status = 'queued'` that atomically flips the row to `processing`, stamps a lease and a lease version, and returns it. The lease is renewed by a heartbeat while the job runs, and the finalizers (`completeJob`, `failJob`, `scheduleJobRetry`) all check the lease version, so a worker that lost its lease cannot overwrite a job another worker picked up.

### 4.3 The job type resolves to a blueprint

`processClaim()` asks the agent config for a blueprint: `config.agentConfig.blueprintResolver(job)`. `lib/agents/config.ts` maps `'parabolic-scan'` to `orchestratorParabolicScanBlueprint`, defined in `lib/agents/blueprints/orchestrator-parabolic-scan.ts`.

A blueprint is a list of steps. Each step has a `name`, a `type` (`'code'` or `'llm'`), `metadata` about retries and side effects, and a `run()` function that receives the job input and the previous step's output. `lib/agents/blueprint-runner.ts` executes the steps in order, saves a checkpoint after each, and records an idempotency key for side-effecting steps so a retried job does not post to Discord twice.

### 4.4 Step one: scan

The parabolic blueprint has two steps. The first, `scan-parabolic-setups`, does all the work:

1. Checks `isNyTradingDay(tradingDate)` from `lib/time-utils.ts` and returns `{ skipped: true }` on holidays.
2. Builds a list of the last 21 trading sessions and fetches grouped daily bars for every ticker on each of them via `fetchGroupedDailyAggregates()` in `lib/massive-market.ts`.
3. Runs `passesLivePrefilter()` from `lib/parabolic/scan.ts` over each ticker's window to cut the universe to a few hundred candidates.
4. For each candidate, in batches of 20, fetches 120 days of history with `fetchDailyBars()` and today's premarket last and high with `fetchPremarketStats()`, both from `lib/parabolic/data.ts`.
5. Calls `evaluateParabolicSetup(history, { referencePrice, highSoFar })`. This is the pure scoring function. It applies the `RULES` thresholds at the top of `lib/parabolic/scan.ts`, produces a score out of 17, a grade (A, B, C, or Pass), a checklist of `scoreItems`, the `metrics` it measured, and a `plan` with entry, stop, risk per share, and two targets.
6. Keeps only qualified, non-Pass setups, attaches the company name and fund type from `fetchTickerReference()`, sorts by score, and returns a `ParabolicScanReport` object.

All the trading logic is in `lib/parabolic/scan.ts`, which has no I/O. That is why `scripts/parabolic-replay.ts` can replay it over years of history, and why `__tests__/parabolic-scan.test.ts` can test it with fixture bars.

### 4.5 Step two: deliver

The second step, `deliver-parabolic-scan`, is marked `sideEffect: true` and `canRetry: false`. It builds a one-line summary (`"5 qualified setups (A 1 • B 2 • C 2)"`) and calls `writeAndDeliverReport()` in `lib/agents/discord.ts` with the report JSON.

`writeAndDeliverReport()` does two things in order:

1. **Persist.** `ensureStoredReport()` writes a row to `agent_reports` with id `<jobId>:parabolic-scan`, the title, summary, and the full `reportJson`. The report exists in the database before anything is sent, so a delivery failure can be retried later from the admin redeliver route without rerunning the scan.
2. **Deliver.** `deliverStoredReport()` calls `resolveWebhookUrl('orchestrator', 'parabolic-scan')`, which maps that pair to the `DISCORD_WEBHOOK_PARABOLIC` env var. It then builds the embeds and POSTs them to the webhook. On success it marks the report `published` and records a `discord-delivery` step effect. On failure it marks the report `delivery_failed` with the error.

### 4.6 Building the cards

`buildParabolicScanEmbeds()` in `lib/agents/discord.ts` turns the `ParabolicScanReport` into Discord embed objects. Discord allows ten embeds per message, so the function emits:

- **One header card** with the date, counts per grade, how many tickers were scanned, the premarket "as of" time, and the standing trade instructions.
- **Up to nine setup cards**, one per setup, colored by grade. Each has the ticker and name, the grade and score, and fields for Entry, Stop, Risk per share, Gap fill target, 9EMA target, Gap and 10SMA extension, and a checklist line built from `scoreItems` with ✅ ❌ ❔ icons. The `PARABOLIC_SHORT_LABELS` map shortens the score item labels so the checklist fits on one line.

The card text is derived entirely from `reportJson`, so the embed builder can be unit tested with a fixture report (`__tests__/agent-discord.test.ts`) and a stored report can be re-rendered later.

### 4.7 The triple-beat variant

`lib/agents/blueprints/orchestrator-triple-beat-scan.ts` has the same two-step shape. The differences:

- The candidate universe is tickers that filed an earnings 8-K (or a 6-K with an earnings headline) in the window, found through `lib/sec/`.
- Scoring lives in `lib/triple-beat/scan.ts` with its own `RULES` and a 45-point scale.
- There is exactly one LLM call, `classifyEarnings()` in `lib/triple-beat/classify.ts`. It runs on the background lane at temperature 0, returns strict JSON, and every claim must quote the press release verbatim or it is downgraded to unknown. The LLM never scores or sizes the trade.
- Delivery goes to `DISCORD_WEBHOOK_TRIPLE_BEAT` and the cards come from `buildTripleBeatScanEmbeds()`.

### 4.8 The whole path in one line

```
macro-cron.ts (hour matches) → agent_jobs row → worker.ts claims it
  → config.ts picks the blueprint → blueprint-runner.ts runs the steps
  → scan.ts scores → discord.ts stores agent_reports row → webhook POST → cards
```

If a card ever looks wrong, the question is which of those stages produced the wrong value. Check the `agent_reports.report_json` column first: if the JSON is wrong the bug is in `scan.ts` or the blueprint; if the JSON is right the bug is in the embed builder.

---

## 5. The 10 files to read first

In order. Each one teaches a pattern that the rest of the repo repeats.

1. **`AGENTS.md`**
   The rules every change must follow: which auth helper to use, how to validate, what to run before handing off. Nothing else in the repo will make sense without the conventions here.

2. **`docs/ARCHITECTURE.md`**
   The folder-by-folder map and the "if you change X also touch Y" list. This is where you look up where something lives instead of searching.

3. **`lib/db/schema.ts`**
   Every table in one file. Reading the table names alone tells you what the product stores: trades, executions, tags, research reports, the AskEdgar cache, SEC caches, the agent queue and reports, reviews, backtests, sheets. Each `userId` column is a tenant boundary.

4. **`lib/server-db-utils.ts`**
   `requireUser()`, `ensureUser()`, `dbUnavailable()`, `requireCronSecret()`, and `toTrade()`. These four helpers are the first lines of almost every route handler.

5. **`app/api/trades/route.ts`**
   The canonical route handler. Auth, DB guard, `ensureUser`, Zod validation on POST, a Drizzle query, a mapped response, and a `try/catch` that logs and returns a generic 500. Once you have read this, you can read any of the other 60-odd route files.

6. **`lib/api-route-utils.ts`**
   Short, but it is where `parseAndValidate()` lives. Note the Zod v4 `z.flattenError()` call and the `{ data } | { error: Response }` return shape, which every POST handler branches on.

7. **`app/page.tsx`**
   The UI entry point. Shows how tabs are chosen, how the URL stays in sync with the active tab, where global shortcuts are registered, and how `useTrades()` feeds the tab components. Page-level orchestration belongs here and nowhere else.

8. **`hooks/use-trade-sync.ts`**
   The browser half of the request flow: session check, `apiRequest()` calls, and converting API shapes to client shapes. Read it alongside file 5 to see both ends of one request.

9. **`lib/agents/blueprints/orchestrator-parabolic-scan.ts`**
   The clearest example of an agent job: two steps, one pure scan and one side-effecting delivery. It imports from `lib/parabolic/`, `lib/massive-market.ts`, `lib/time-utils.ts`, and `lib/agents/discord.ts`, so it is also a map of the scanner's dependencies.

10. **`lib/agents/discord.ts`**
    Report persistence, webhook resolution, and every embed builder. Read `resolveWebhookUrl()` to learn which env var feeds which channel, `writeAndDeliverReport()` to see the store-then-send order, and `buildParabolicScanEmbeds()` to see how a report becomes cards.

If you have time for an eleventh, read `services/agent-entrypoint.ts`. It is short and it is the only place where the worker loop and the cron schedulers are wired together.

---

## 6. Where to go next

- To run the app locally: `npm install`, copy `.env.example` to `.env.local` and fill it in, then `npm run dev`. `.env.example` lists every env var the web app reads; `services/.env.example` does the same for the agents.
- To validate a change: `npm run lint`, `npx tsc --noEmit`, `npm test`, plus `npm run typecheck:services` if you touched `services/`.
- To deploy the agents: on the home server, `git pull && cd services && docker compose up --build -d`. The `--build` is required because the images copy `lib/`.
- To tune a scanner: change the `RULES` constant in `lib/parabolic/scan.ts` or `lib/triple-beat/scan.ts`, then replay with `npx tsx scripts/parabolic-replay.ts --from … --to …` before touching the live cron.
- To see what is in flight right now: `HANDOFF.md`.

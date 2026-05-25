# Nexus Terminal — Architecture Map

A topographical view of the codebase: where things live, what they own, and which files pair together. Update this when the structure changes meaningfully (new top-level concern, folder reorg, new agent surface) — not on every commit.

For the workflow rules (commands to run, auth helpers, route conventions), see `AGENTS.md`. This file is structure; that file is process.

---

## Top-level layout

| Path | Owns |
|------|------|
| `app/` | Next.js App Router — pages, API routes, layouts. All user-facing surface and HTTP handlers. |
| `lib/` | Shared business logic, DB access, parsers, integrations. Importable from `app/`, `services/`, and tests. |
| `components/` | React components. `trading/` is feature-rich; `ui/` is shadcn/Radix primitives. |
| `hooks/` | Custom React hooks. Small directory by design — composition over expansion. |
| `services/` | Long-running worker processes (agents, Discord bot) run via Docker Compose, not Vercel. |
| `drizzle/` | Generated migration SQL. Do not hand-edit. Source of truth is `lib/db/schema.ts`. |
| `__tests__/` | Vitest tests. Mirrors source layout. |
| `specs/` | Spec documents for in-flight work. |
| `codex-skills/` | Codex executor skill definitions. |
| `docs/` | Long-form documentation: this file, `FUTURE-PLANS.md`, `VALIDATION_MATRIX.md`. |
| `public/` | Static assets served by Next.js. |
| `scripts/` | One-off ops scripts (e.g. `db-migrate-safe.mjs`). |
| `middleware.ts` | Next.js edge middleware. Currently a thin file — see it before adding logic. |

Workflow root files: `AGENTS.md` (canonical agent guide), `HANDOFF.md` (active sprint spec or recent context), `PRD.md` (product requirements), `CLAUDE.md` files (Claude-specific adapters in `.claude/`).

---

## `app/` — UI + API

```
app/
├── page.tsx          ← main landing/dashboard orchestrator (keep page-level orchestration here, per CLAUDE.md)
├── layout.tsx        ← root layout
├── login/            ← auth screens
├── discord/          ← Discord OAuth/integration UI
└── api/              ← all HTTP handlers (route.ts files)
    ├── auth/         ← NextAuth handlers
    ├── trades/       ← trade CRUD (note: /api/trades/import accepts a batchKey for idempotency)
    ├── agents/       ← agent admin + service endpoints
    ├── askedgar/     ← SEC AskEdgar research routes
    ├── cron/         ← Vercel cron handlers (use requireCronSecret())
    ├── backtest/, backtests/  ← backtesting endpoints
    ├── scanner/, market-data/ ← real-time scanning + price data
    ├── dashboard/, career-pnl/, daily-reviews/, weekly-reviews/  ← dashboard surfaces
    ├── sample-sets/, tags/, watchlist-theses/, system-tickers/, system-sheet/  ← journal data
    ├── report-templates/, research-report/, tradingview/  ← reporting + chart integration
    └── health/       ← liveness checks
```

**Route auth rules** (from CLAUDE.md): default → `requireUser()`, cron → `requireCronSecret()`, agent admin → `requireAgentAdmin()`, agent service → `requireServiceAuth()`/`requireServiceKey()`. JSON body validation → `parseAndValidate()` with Zod v4 `z.flattenError(...)`. SSE routes use `lib/sse.ts`, `export const dynamic = 'force-dynamic'`, `export const maxDuration = 60`.

---

## `lib/` — shared logic

```
lib/
├── db.ts                   ← Drizzle client + pooled connection
├── db/schema.ts            ← single source of truth for schema (drizzle-kit generates SQL from this)
├── api-route-utils.ts      ← parseAndValidate, logRouteError, internalServerError, ticker helpers
├── auth-config.ts          ← NextAuth options
├── sse.ts                  ← Server-Sent Events helper for streaming routes
├── llm-client.ts           ← shared LLM call wrapper (used by askedgar + agents)
├── askedgar.ts             ← cached AskEdgar helpers (use these, don't call SEC directly)
├── askedgar/, askedgar-utils.ts   ← AskEdgar internals
├── agents/                 ← agent runtime — see "agent layer" below
├── backtesting/, backtest-math.ts, backtest-filters.ts, backtest-stats.ts  ← backtest engine
├── parsers/, csv-parser.ts ← CSV + structured-text parsers
├── sec/, filings-bucket.ts ← SEC filings infrastructure
├── market-pulse/, massive-market.ts  ← market-wide data
├── tradingview-client.ts   ← TradingView chart session bridge
├── validations/            ← Zod schemas
├── sample-set-rows.ts, sample-set-csv.ts, watchlist.ts  ← journaling data shapes
├── system-sheet-parser.ts, journal-aggregates.ts, journal-template-defaults.ts  ← journal logic
├── trade-utils.ts, ui-trade-utils.ts ← trade business logic + UI trade formatting
├── chart-time.ts, chart-timeframes.ts, chart-session-shading.ts, indicators.ts  ← chart helpers
├── server-db-utils.ts      ← requireUser, requireCronSecret, ensureUser, dbUnavailable
└── time-utils.ts, types.ts, utils.ts, research.ts  ← misc shared
```

### Agent layer — `lib/agents/`

Powers the workers in `services/`. Imported by both Next.js routes (for admin UI) and the agent processes (for execution).

| File | Role |
|------|------|
| `worker.ts` | Main agent loop. Polls queue, runs blueprint steps, writes back state. |
| `queue.ts` | Job queue interface (DB-backed). |
| `db.ts` | Agent-scoped DB helpers (`getAgentDb()`, agent_registry, agent_runs). |
| `config.ts` | `AGENT_CONFIGS` — per-agent defaults (orchestrator, small-cap-trader, swing-trader). |
| `blueprint-runner.ts`, `blueprints/` | Step-by-step execution graph definitions. |
| `prompts/`, `prompts-loader.ts` | Versioned LLM prompts. |
| `llm-client.ts` | LLM wrapper with budget enforcement. |
| `memory.ts`, `checkpoints.ts` | Long-term agent memory + step resumption. |
| `context.ts` | Builds context windows for LLM calls. |
| `runtime-limits.ts` | Token/cost guardrails (uses AGENT_*_BUDGET_* env vars). |
| `model-pricing.ts` | Per-model $/token table. |
| `macro-cron.ts` | Macro daily / intraday cron schedulers (orchestrator only). |
| `heartbeat.ts` | Writes `/tmp/healthy` for Docker healthchecks. |
| `discord.ts`, `news-formatter.ts` | Discord webhook formatting. |
| `fred-client.ts`, `sentiment-client.ts`, `rss-lite.ts`, `scrape-lite.ts` | Outbound data sources. |
| `trust-boundary.ts` | Validates input/output across the agent ↔ user boundary. |
| `admin.ts`, `types.ts` | Admin helpers + shared types. |

---

## `services/` — worker processes (Docker)

Runs on a self-hosted box (OptiPlex), **not Vercel**.

| Service | Built from | Purpose |
|---------|------------|---------|
| `orchestrator` | `agent.Dockerfile` + `agent-entrypoint.ts` | Coordinates other agents, runs macro cron. |
| `small-cap-trader` | same | Small-cap scanning + research. |
| `swing-trader` | same | Swing setup detection + alerts. |
| `discord-bot` | `discord-bot/` (separate context) | Discord slash commands → calls back into `/api/agents/*`. |

Compose file: `services/docker-compose.yml`. Env: `services/.env`. Restart on update:
```bash
cd services && docker compose down && docker compose up -d
docker compose logs -f --tail=20   # watch for entrypoint.started events
```

---

## `components/` — React

- `components/trading/` — feature components (~80+ files). Sheets, dialogs, tabs, charts, tables for the trading journal.
- `components/ui/` — shadcn/Radix primitives. Add new primitives here; don't reinvent.
- `components.json` — shadcn config (CLI uses this when generating new primitives).

---

## `hooks/`

Small on purpose. Each hook has a clear domain:

| Hook | Domain |
|------|--------|
| `use-trades.ts` | Trade list + sync. **Do not add new logic here** (per CLAUDE.md). |
| `use-trade-sync.ts`, `use-trade-filters.ts` | Trade subscription + filtering. |
| `use-backtest-manager.ts`, `use-backtest-session.ts`, `use-backtest-stats.ts` | Backtesting UI state. |
| `use-candle-data.ts`, `use-chart-drawings.ts` | Chart data + annotations. |
| `use-global-shortcuts.ts` | Keyboard shortcuts. |
| `use-mobile.ts` | Responsive breakpoint detection. |

---

## "If you change X, also touch Y"

- **`lib/db/schema.ts`** → run `npm run db:generate` to create a numbered SQL file in `drizzle/`, inspect the SQL, then `npm run db:migrate` to apply it. Never `db:push` — see `MEMORY.md`.
- **New API route** → confirm auth helper (requireUser / requireCronSecret / requireAgentAdmin / requireServiceAuth). Add Zod validation via `parseAndValidate()`.
- **New SSE route** → add `export const dynamic = 'force-dynamic'` and `export const maxDuration = 60`; use `lib/sse.ts`.
- **Agent config change** (`lib/agents/config.ts`) → restart services (`docker compose down && up -d`); env vars in `services/.env` must match.
- **New env var** → add to: `.env.example` (local template), `services/.env.example` (services template), `services/docker-compose.yml` (explicit `environment:` line for each agent that needs it), Vercel project env settings.
- **New shadcn primitive** → keep it in `components/ui/`, don't co-locate with feature components.

---

## Conventions worth knowing before changing things

- **Page-level orchestration lives in `app/page.tsx`.** Don't split orchestration into per-component effects.
- **Module-level memory is not durable on Vercel.** For cross-request state use the DB or external store.
- **Drizzle is the schema source of truth.** Migrations are generated, not hand-written.
- **Vitest, not Jest.** Test file colocation: `__tests__/` at repo root mirrors source paths.
- **Workflow assets that affect Codex/Claude execution** (`.claude/`, `.opencode/`, `codex-skills/`, `AGENTS.md`, `HANDOFF.md`) → run `npm run workflow:audit` after editing.
- **Validation gauntlet** after any change: `npm run lint && npx tsc --noEmit && npm test`, plus `npm run typecheck:services` if `services/` touched.

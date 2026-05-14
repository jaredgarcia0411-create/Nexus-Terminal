# Custom Scanner Build — Source of Truth

This is the project brief and source of truth for replacing Nexus Terminal's current scanners (Day 1, MDR) with a custom, polling-based scanner powered by Polygon (Massive) and a JSONLogic rule engine. Individual sprint specs live in `HANDOFF.md`.

## Goal

Build a scanner engine that:

- Catches the trades you actually take (current scanners miss a meaningful slice, e.g., OTC names, sub-$0.75 penny runners, AH-only gappers, IPOs younger than 20 sessions).
- Is **auditable** — every scan run is logged, every match is persisted, every rule lives in the DB as data, not in code.
- Supports **backtest replay** — re-run new rule definitions against stored market snapshots and compare against your actual journaled trades.
- Is **operationally independent of Vercel function limits** — the scanner runs as a long-lived worker on the home Optiplex, not as a serverless function.

## Why the current scanners miss trades

Traced from the audit of `app/api/tradingview/*` and `app/api/dashboard/scanner-state/route.ts`:

- `gainers/route.ts:44` — `PRIOR_CLOSE_FLOOR = $0.75` hardcoded. Any sub-$0.75 penny runner is invisible.
- `gainers/route.ts:50-51` — TradingView prefilter scans PM gap and AH gap as separate queries. A name with 0 PM volume but 2M AH volume falls out of the 250-result window.
- TradingView is implicit NASDAQ/NYSE; `mdr-candidates/route.ts:30` is explicit NYSE/NASDAQ. **OTC names cannot appear in scan results.**
- `mdr-candidates/route.ts:744` — MDR requires 20 prior trading days. IPOs younger than 20 sessions are rejected even when they're textbook D2 setups.
- TradingView field semantics drift at the session boundary (`postmarket_change` returns yesterday's AH until today's AH starts at 4 PM). A scan run at 9:32 AM can compare against the wrong session.
- `/api/dashboard/scanner-state` uses an 8-second module-level cache. On Vercel that cache is ephemeral; every cold start re-fetches everything, and 10 concurrent 80-day Massive history calls saturate the 60s function budget.
- Day 1 results are not persisted. There is no answer to "what fired at 7:14 AM yesterday."

This isn't a tuning problem. The scanners aren't really scanners — they're hardcoded TradingView wrappers. We are replacing the engine, not adjusting thresholds.

## Architecture

```
                  ┌──────────────────────────────┐
                  │   Optiplex 7060 (home)        │
                  │   Docker: nexus-scanner       │
                  │                              │
                  │   loop every 15s/30s:        │
                  │   1. fetch Polygon snapshot  │
                  │   2. read rules from DB      │
                  │   3. evaluate JSONLogic      │
                  │   4. write runs + results    │
                  │   5. every 5m write snapshot │
                  │   6. update health row       │
                  └────────────┬─────────────────┘
                               │ pg driver (long-lived pool)
                               ▼
                       ┌───────────────┐
                       │  Neon Postgres │
                       └───────┬───────┘
                               │
                ┌──────────────┴───────────────┐
                ▼                              ▼
       Dashboard (Vercel)              /scanner-debug
       reads latest scanner_results    side-by-side old vs new
```

**Data flow:**

1. Worker on Optiplex polls Polygon's snapshot-all-tickers endpoint on a session-aware cadence.
2. Worker reads active rules from `scanner_definitions`, evaluates them against the snapshot using JSONLogic, writes a `scanner_runs` row plus N `scanner_results` rows per matched ticker.
3. Once per 5 minutes, the worker also writes a full-market snapshot (narrowed universe) to `market_snapshots` for backtest replay.
4. Worker updates a single `scanner_health` row with `last_tick_at`, `last_error`, `tickers_scanned`, `match_count`.
5. Dashboard endpoint reads latest run from Neon. No live provider calls.

## Decisions locked

| # | Decision | Choice | Why |
|---|---|---|---|
| 1 | Market data provider | Polygon Stocks Advanced ($199/mo) | Full SIP from 4 AM ET, OTC included, shares-outstanding from EDGAR, single-call full-market snapshot. We already integrate with it. |
| 2 | Filter language | JSONLogic (`json-logic-js`) | Tiny pure-data AST, round-trips between UI/DB/evaluator, perfect for backtest replay (rule and snapshot are both data). |
| 3 | Scheduler | Long-lived Node worker, not Vercel | Vercel's 60s function ceiling and cold-start ephemerality kill in-route scanning. Worker runs continuously. |
| 4 | Worker host | Optiplex 7060 Micro, Docker container | Already runs 24/7. Docker keeps it consistent with other services on that machine. |
| 5 | Database | Single Neon Launch instance | $14/mo or less even at 90-day snapshot retention. Splitting to a local DB is premature complexity. |
| 6 | Polling cadence | 30s pre/post, 15s RTH | Sufficient resolution for Day 1 and MDR setups (these develop over minutes, not seconds). |
| 7 | Snapshot cadence (backtest) | 5 min, narrowed universe | ~200 MB/day after compression, fits Neon Launch's included tier. |
| 8 | Snapshot universe filter | price >= $0.10 AND day_volume >= 1000, common-stock type only | Drops 5–10× volume; matches our actual trading universe. |
| 9 | Halt feed (Polygon LULD WebSocket) | Deferred to v2 | Pure addition; doesn't restructure anything when added. |
| 10 | Float source | Polygon `weighted_shares_outstanding` (shares outstanding, not free float) | Polygon only. Close enough for v1; layer in EDGAR-derived true float later. |
| 11 | UI rule editor | Deferred to v2 | Rules seeded via migration in v1. Day 1 + MDR are the only two presets. |
| 12 | Rollout strategy | 30-day parallel run | Old scanners keep powering the Dashboard UI; new scanners write to new tables silently. Compare via `/scanner-debug`. |
| 13 | Cutover | Swap `/api/dashboard/scanner-state` to read new tables, same response shape | Zero UI churn. |
| 14 | Backtest | In v1. Snapshot re-evaluation against stored `market_snapshots`. | Whole reason to rebuild — tune rules with data, not guesswork. |

## Database schema

All tables live in Drizzle. Migrations via `npm run db:migrate` (never `db:push` — known false-positive on composite PKs in this repo).

### `scanner_definitions`
Active rule presets. Day 1 and MDR are seeded here in v1.

| column | type | notes |
|---|---|---|
| `id` | text PK | slug, e.g., `"day-1"`, `"mdr"` |
| `name` | text | display name |
| `description` | text | optional |
| `rules` | jsonb | JSONLogic AST |
| `enabled` | boolean | default true |
| `version` | integer | bumped on every rule change |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

### `scanner_runs`
One row per scanner tick per definition. Audit trail.

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `definition_id` | text FK → scanner_definitions | |
| `definition_version` | integer | snapshot at run time, for backtest replay |
| `started_at` | timestamptz | |
| `finished_at` | timestamptz | |
| `tickers_scanned` | integer | |
| `match_count` | integer | |
| `status` | text enum | `ok` / `partial` / `error` |
| `error` | text | nullable |
| `freshness` | text enum | `fresh` / `stale` / `partial` — based on provider response age |

Index on `(definition_id, started_at DESC)` for "latest run per definition" lookups.

### `scanner_results`
One row per matched ticker per run.

| column | type | notes |
|---|---|---|
| `run_id` | uuid FK → scanner_runs | |
| `ticker` | text | |
| `score` | numeric | optional; for rules that compute a strength score |
| `snapshot` | jsonb | full snapshot row for this ticker at this tick (price, gap%, volume, float, etc.) |
| `matched_at` | timestamptz | denormalized = `scanner_runs.started_at` for fast filtering |

Composite PK `(run_id, ticker)`. Index on `(ticker, matched_at DESC)`.

### `scanner_health`
Single-row table (or `id = 'scanner'` keyed) for the heartbeat. Worker upserts on every tick.

| column | type | notes |
|---|---|---|
| `id` | text PK | `"scanner"` |
| `last_tick_at` | timestamptz | |
| `last_error` | text | nullable |
| `last_error_at` | timestamptz | nullable |
| `tickers_scanned` | integer | last tick |
| `match_count` | integer | last tick across all definitions |
| `worker_version` | text | git SHA of worker code |

Dashboard reads this for a green/yellow/red freshness badge: green <30s, yellow 30s–5min, red >5min.

### `market_snapshots`
Full-market snapshot every 5 minutes during market hours (4 AM – 8 PM ET). Backtest source.

| column | type | notes |
|---|---|---|
| `taken_at` | timestamptz | tick boundary (5-minute aligned) |
| `ticker` | text | |
| `snapshot` | jsonb | full Polygon snapshot row |

Composite PK `(taken_at, ticker)`. Index on `(ticker, taken_at DESC)`. Partitioned by month if/when row count requires it.

Retention: 30 days hot in v1. Extend later as needed.

### `scanner_tickers`
Reference data for the scanner universe: shares outstanding, ticker type, exchange, active flag. Refreshed nightly from Polygon ticker-details.

| column | type | notes |
|---|---|---|
| `ticker` | text PK | |
| `ticker_type` | text | `CS`, `ETF`, etc. |
| `exchange` | text | |
| `shares_outstanding` | bigint | nullable |
| `market_cap` | bigint | nullable |
| `active` | boolean | |
| `last_refreshed_at` | timestamptz | |

The worker joins this in at scan time to enable filters like `shares_outstanding < 50_000_000`.

### Existing tables — preserved

- `market_pulse_daily_bars` — keep as-is. Used for EOD/historical context and Market Pulse ingestion.
- `mdr_triggers` — keep as-is. Verified EOD MDR triggers; different time scale from intraday scans.

## Build phases (epics)

Each epic is one HANDOFF.md sprint. They're sequential — don't start the next until the previous is merged.

### Epic 1 — Schema + JSONLogic engine + seeded rules
- Drizzle schema for 5 new tables (`scanner_definitions`, `scanner_runs`, `scanner_results`, `scanner_health`, `market_snapshots`, `scanner_tickers`).
- Migration script.
- `services/scanner/src/engine/jsonlogic.ts` — wrapper around `json-logic-js` with our typed snapshot schema.
- Seed migration: Day 1 and MDR as JSONLogic rules, encoded from existing logic in `gainers/route.ts` and `mdr-candidates/route.ts` (faithfully reproduced, including known limitations — we'll tune in parallel-run).
- Unit tests for the engine: known snapshots in, expected matches out.
- **No UI changes. No worker. No deploy.** This epic just lands the foundation.

### Epic 2 — Scanner worker (Docker on Optiplex)
- `services/scanner/` directory: TypeScript Node worker, Dockerfile, docker-compose service.
- Long-lived `pg` connection pool (1–2 connections, keepalive on).
- Session-aware tick loop: 30s pre/post, 15s RTH, idle outside hours.
- Polygon snapshot-all-tickers fetcher with retry/backoff.
- Nightly job: refresh `scanner_tickers` from Polygon ticker-details.
- Health-row upsert on every tick (including ticks that match nothing).
- Per-rule evaluation, per-match `scanner_results` insert.
- Every 5 minutes: write narrowed-universe rows to `market_snapshots`.
- Deploy doc in this sprint: how to `docker compose up --build -d` after `git pull`, where logs live.
- Holiday calendar: skip ticks on US market holidays (use Polygon's `marketStatus` endpoint or a static list — sprint decides).

### Epic 3 — Debug page + heartbeat badge
- `/scanner-debug` page, gated to your email only. Side-by-side: current TradingView-based Dashboard scanner output vs new Polygon-based output. Highlight tickers in one but not the other.
- Heartbeat badge on the Dashboard (small, unobtrusive) reading `scanner_health`.
- No changes to the main Dashboard data path yet — old scanners still power the UI.
- **This is when parallel run starts.** Day 0 of the 30-day comparison.

### Epic 4 — Backtest endpoint + UI
- `/api/scanner/backtest` POST endpoint: takes a JSONLogic rule + date range, replays it against stored `market_snapshots`, returns matched (ticker, taken_at) pairs.
- Backtest UI: form to paste/edit a JSONLogic rule, date range picker, results table, "overlap with my journaled trades" view (joins against the trades table).
- Save backtest results temporarily in-memory or in a `backtest_runs` table if you want history (decide in the sprint).

### Epic 5 — Cutover
- After 30 days of parallel run and your validation, swap `/api/dashboard/scanner-state` to read latest run from `scanner_results`, returning the same JSON shape the UI expects.
- Delete `app/api/tradingview/gainers/route.ts` and `app/api/tradingview/mdr-candidates/route.ts` (or repurpose if anything else uses them — Codex audits before deleting).
- Remove the in-route 8s module cache.
- Add a basic UI surface for "enabled scanners" so you can toggle Day 1 / MDR without code changes.

## Validation: 30-day parallel run

**Phase 1 (build, ~1–2 weeks):** Epics 1–3 in a worktree backed by a Neon branch. `git worktree add ../nexus-scanner scanner-v1`, create Neon branch in dashboard, point `.env.local` at it, `npm run dev` works identically.

**Phase 2 (merge + deploy, 1 day):** PR → main → Vercel deploys. Migrations apply. Start worker on Optiplex (`docker compose up -d nexus-scanner`). Both old and new systems now write to production Neon in parallel.

**Phase 3 (compare, 30 days):**
- After each session, check `/scanner-debug`: did the new scanner catch what the old one caught? Did it catch *more* of what you actually traded?
- Run backtest replays on candidate rule tweaks (e.g., drop PM gap threshold from 40% to 30%) and check overlap with your journal.
- Track scanner_health: any extended outages, freshness drops, missed ticks?

**Phase 4 (cutover):** Epic 5. Swap the data source behind `/api/dashboard/scanner-state`. UI unchanged. Old code deleted.

## Out of scope for v1

These are deliberate omissions. Each is purely additive and can land in a future sprint without restructuring v1.

- **LULD halt feed via Polygon WebSocket** — adds a second always-on stream. Useful for halt-resume plays; not foundational.
- **True free-float from EDGAR** — Polygon's shares-outstanding is the v1 proxy. EDGAR cross-check is a nightly batch job we can add later.
- **In-app rule editor UI** — rules are code-seeded in v1. UI editor is its own sprint.
- **Auto-deploy to Optiplex (CI)** — manual `git pull && docker compose up --build -d` is fine for one user.
- **Off-site backup of `market_snapshots`** — Neon handles its own backups for v1 retention. If we extend retention to >90 days we revisit.
- **Tick-level snapshot storage** — 5-min snapshots are sufficient for the rule-tuning we actually need. Tick-level can come later if a setup demands it.
- **More scanners beyond Day 1 + MDR** — confirm these are correct first. New presets added after cutover.

## Prerequisites (blockers)

- **Polygon Stocks Advanced subscription must be active.** The full-market real-time snapshot endpoint requires it. Verify before starting Epic 2.
- **Optiplex must have Docker daemon + outbound network access** to Polygon (api.polygon.io) and Neon (your Neon project's host). Both are standard HTTPS, no inbound exposure needed.
- **Neon `DATABASE_URL` accessible from the Optiplex.** Already confirmed.

## Known limitations and trade-offs

- **No proper free float in v1.** `weighted_shares_outstanding` from Polygon is shares outstanding, not the publicly tradeable float. Insider holdings, locked-up shares, and institutional positions aren't subtracted. For small-cap setups this typically overstates float by 20–60%. Workable for v1 filters (`shares_outstanding < 50M` will still catch most low-float runners) but not precise.
- **Polling, not streaming.** A trade printing 200ms after a tick won't be reflected until the next tick (15s RTH). For Day 1 and MDR this is irrelevant; for tick-level setups (parabolic shorts entering on a single print) it would matter and would need WebSocket integration.
- **Home server reliability is on you.** If the Optiplex loses power or internet, the scanner stops and the heartbeat goes red. No Vercel fallback in v1 (by your decision — you have other tools to use if it's down).
- **Snapshot universe filter (price >= $0.10, vol >= 1000) excludes truly dormant tickers from backtest data.** If you later want to backtest setups on near-zero-volume names, we'd need to widen the filter or accept the gap.

## Open items to decide during execution (sprint-time, not now)

These are detail-level decisions Codex can resolve in the sprint without coming back to you:

- Exact JSONLogic encoding of MDR's "prior big day in 20-day window" check (it's the most complex existing rule).
- Holiday calendar source: Polygon `marketStatus` polling vs static array.
- Whether `scanner_definitions.rules` should be a single JSONLogic blob or split into `prefilter` + `match` for performance.
- Whether to add `score` computation in v1 or always return `1.0`.

## References

- Codex's original research (now replaced by this doc): kept in git history.
- JSONLogic spec: https://jsonlogic.com/
- Polygon snapshot-all-tickers: https://polygon.io/docs/rest/stocks/snapshots/full-market-snapshot
- Polygon ticker details: https://polygon.io/docs/rest/stocks/tickers/ticker-overview
- json-logic-js: https://github.com/jwadhams/json-logic-js

---

When kicking off the first sprint, reference this doc by section and write the executable spec into `HANDOFF.md`. Start with **Epic 1**.

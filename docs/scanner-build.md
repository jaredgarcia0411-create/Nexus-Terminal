# Custom Scanner Build — Source of Truth

This is the project brief and source of truth for replacing Nexus Terminal's active Dashboard scanner surface with a custom, polling-based scanner powered by Polygon (Massive) and a JSONLogic rule engine. Sprint 13 retired the Dashboard MDR runtime/UI/candidate logic; any older MDR replacement notes in this document are historical context only unless a future sprint explicitly re-scopes MDR.

> **Build discipline:** the entire scanner is built in a **git worktree on a throwaway Neon branch**, validated across **weeks of real sessions** (the 30-day parallel run below), and **not merged to `main` or pushed to prod until proven**. The existing TradingView scanner keeps powering the live Dashboard the whole time — nothing here touches the production data path until Epic 5 (cutover). See "Validation: 30-day parallel run."

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
- TradingView field semantics drift at the session boundary (`postmarket_change` returns yesterday's AH until today's AH starts at 4 PM). A scan run at 9:32 AM can compare against the wrong session.
- Day 1 results are not persisted. There is no answer to "what fired at 7:14 AM yesterday."

This isn't a tuning problem. The scanners aren't really scanners — they're hardcoded TradingView wrappers. We are replacing the engine, not adjusting thresholds.

## Architecture

```
                  ┌──────────────────────────────┐
                  │   Dell OptiPlex (home)        │
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
| 4 | Worker host | Dell OptiPlex Micro (32GB/1TB), Ubuntu Server 24.04 LTS, Docker | Runs 24/7 headless, managed over Tailscale SSH. Consolidates all workers (4 existing agents + scanner) onto this one box; the older OptiPlex becomes a powered-down hot spare. See "Host & database topology." |
| 5 | Database | Neon for v1 (all app + scanner control/live tables); `market_snapshots` moves to a local Postgres on the OptiPlex as a committed fast-follow | App/live data must stay on Neon — Vercel can't reach a home DB. `market_snapshots` is the one bulky, cold, Vercel-independent table, so it's worth hosting on the 1TB local drive once the worker is stable. Planned, not premature. See "Host & database topology." |
| 6 | Polling cadence | 30s pre/post, 15s RTH | Sufficient resolution for Day 1 setups, which develop over minutes rather than seconds. |
| 7 | Snapshot cadence (backtest) | 5 min, narrowed universe | ~200 MB/day after compression, fits Neon Launch's included tier. |
| 8 | Snapshot universe filter | price >= $0.10 AND day_volume >= 1000, common-stock type only | Drops 5–10× volume; matches our actual trading universe. |
| 9 | Halt feed (Polygon LULD WebSocket) | Deferred to v2 | Pure addition; doesn't restructure anything when added. |
| 10 | Float source | Polygon `weighted_shares_outstanding` (shares outstanding, not free float) | Polygon only. Close enough for v1; layer in EDGAR-derived true float later. |
| 11 | UI rule editor | Deferred to v2 | Rules seeded via migration in v1. Day 1 is the active Dashboard preset. |
| 12 | Rollout strategy | 30-day parallel run | The current scanner keeps powering the Dashboard UI; the new scanner writes to new tables silently. Compare via `/scanner-debug`. |
| 13 | Cutover | Swap `/api/dashboard/scanner-state` to read new tables, same Day 1 response shape | Zero UI churn. |
| 14 | Backtest | In v1. Snapshot re-evaluation against stored `market_snapshots`. | Whole reason to rebuild — tune rules with data, not guesswork. |

## Host & database topology

### Worker host
All workers (the 4 existing agents + the scanner) run on a **Dell OptiPlex Micro** (32GB RAM, 1TB SSD) at home.

- **OS:** Ubuntu Server 24.04 LTS, headless. Boring + best-documented Docker host, 5-year support. (Not Desktop — no GUI overhead; not Windows — bare-Linux Docker is more reliable for 24/7.)
- **Runtime:** Docker Engine from Docker's official repo (not the apt `docker.io` package) + Compose plugin. All services use `restart: unless-stopped`.
- **Remote management:** Tailscale (free mesh VPN) on the box + laptop/phone → SSH from anywhere, **no port-forwarding, no inbound exposure**. The box only makes outbound HTTPS to Polygon + Neon.
- **24/7 resilience knobs:**
  - BIOS: *Restore on AC Power Loss → On* (auto-boot after an outage).
  - `systemctl enable docker` + `restart: unless-stopped` → containers auto-start on boot.
  - `systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target` → never suspends.
  - `unattended-upgrades` for security patches.
  - A small UPS is recommended to ride out power flickers.
- **Old OptiPlex:** powered-down **hot spare** — clone the repo + `services/.env`; `git pull && docker compose up -d` brings it live in minutes if the primary dies. Optional later: staging box, or host for the local snapshot Postgres.
- **Monitoring:** the `scanner_health` heartbeat + Dashboard badge (Epic 3) is the app-level "is the worker alive" check.

### Database topology
The split is dictated by **who reads each table**:

- **Neon (cloud) — everything Vercel reads.** All current app data plus the scanner *control + live* tables: `scanner_definitions`, `scanner_health`, `scanner_runs`, and the latest `scanner_results` the Dashboard renders. Vercel cannot reach a home database, so anything the web app renders stays on Neon. Non-negotiable.
- **Local Postgres on the OptiPlex — `market_snapshots` (committed fast-follow).** The one table that is bulky (~200MB/day), cold (read only by backtest), unbounded, and Vercel-independent. At 30-day retention it fits Neon's base plan; at the multi-year retention that makes backtests valuable, Neon storage gets expensive (~70GB/yr) while the 1TB local drive is free.

**Phasing:** v1 keeps `market_snapshots` on Neon so the parallel-run validation isn't blocked on standing up a local DB. Moving it local is a deliberate, separable sub-project — run Postgres in Docker on the OptiPlex, repoint the worker's snapshot **writes** and the backtest's **reads** at it — done as a fast-follow once the worker is proven stable. This move is committed, not hypothetical. When it happens, the Epic 4 backtest job moves onto the OptiPlex too (it can't stay a Vercel route once the data it reads lives at home).

## Database schema

All tables live in Drizzle. Migrations via `npm run db:migrate` (never `db:push` — known false-positive on composite PKs in this repo).

### `scanner_definitions`
Active rule presets. Day 1 is seeded here in v1.

| column | type | notes |
|---|---|---|
| `id` | text PK | slug, e.g., `"day-1"` |
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
- `mdr_triggers` — keep as-is until the later explicit migration drops it. Historical MDR data remains in place, but the Dashboard MDR runtime is retired.

## Build phases (epics)

Each epic is one HANDOFF.md sprint. They're sequential — don't start the next until the previous is merged.

### Epic 1 — Schema + JSONLogic engine + seeded rules
- Drizzle schema for 5 new tables (`scanner_definitions`, `scanner_runs`, `scanner_results`, `scanner_health`, `market_snapshots`, `scanner_tickers`).
- Migration script.
- `services/scanner/src/engine/jsonlogic.ts` — wrapper around `json-logic-js` with our typed snapshot schema.
- Seed migration: Day 1 as a JSONLogic rule, encoded from existing logic in `gainers/route.ts` (faithfully reproduced, including known limitations — we'll tune in parallel-run).
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
- **Swappable snapshot seam (required):** `market_snapshots` reads/writes go through a dedicated module with its own connection getter (e.g. `services/scanner/src/snapshot-store.ts`), **not** the worker's general Neon client. In v1 that getter points at `DATABASE_URL` (Neon); the local-Postgres move is then an env var + connection swap (`SNAPSHOT_DATABASE_URL`), not a refactor. Keep all other tables (`scanner_definitions`/`runs`/`results`/`health`) on the general Neon client. Rationale: snapshots are a bulky, disposable, append-only archive that is committed to move local (see "Host & database topology") — isolating its access path now makes that move trivial and keeps it from contaminating the control-table code.
- Deploy doc in this sprint: how to `docker compose up --build -d` after `git pull`, where logs live.
- Holiday calendar: skip ticks on US market holidays (use Polygon's `marketStatus` endpoint or a static list — sprint decides).

### Epic 3 — Debug page + heartbeat badge
- `/scanner-debug` page, gated to your email only. Side-by-side: current TradingView-based Day 1 Dashboard output vs new Polygon-based output. Highlight tickers in one but not the other.
- Heartbeat badge on the Dashboard (small, unobtrusive) reading `scanner_health`.
- No changes to the main Dashboard data path yet — old scanners still power the UI.
- **This is when parallel run starts.** Day 0 of the 30-day comparison.

### Epic 4 — Backtest endpoint + UI
- `/api/scanner/backtest` POST endpoint: takes a JSONLogic rule + date range, replays it against stored `market_snapshots`, returns matched (ticker, taken_at) pairs.
  - **Topology note:** this is a Vercel route only while `market_snapshots` lives on Neon. Once snapshots move to the local Postgres (see "Host & database topology"), the replay job moves onto the OptiPlex and the UI calls it there — Vercel can't query a home DB.
- Backtest UI: form to paste/edit a JSONLogic rule, date range picker, results table, "overlap with my journaled trades" view (joins against the trades table).
- Save backtest results temporarily in-memory or in a `backtest_runs` table if you want history (decide in the sprint).

### Epic 5 — Cutover
- After 30 days of parallel run and your validation, swap `/api/dashboard/scanner-state` to read latest run from `scanner_results`, returning the same JSON shape the UI expects.
- Delete or repurpose `app/api/tradingview/gainers/route.ts` after auditing any remaining consumers.
- Remove the in-route 8s module cache.
- Add a basic UI surface for enabled scanner rules if multiple active rules exist by cutover.

## Validation: 30-day parallel run

**This whole build stays off `main` and out of prod until proven.** It is developed in a git worktree on a throwaway Neon branch, runs in parallel with the live TradingView scanner for ~30 days of real sessions, and only merges at Epic 5 cutover after the comparison data says the new scanner is at least as good. No production data path changes until then.

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
- **More scanners beyond Day 1** — confirm the first custom scanner is correct before adding new presets after cutover.

## Prerequisites (blockers)

- **Polygon Stocks Advanced subscription must be active.** The full-market real-time snapshot endpoint requires it. Verify before starting Epic 2.
- **Optiplex must have Docker daemon + outbound network access** to Polygon (api.polygon.io) and Neon (your Neon project's host). Both are standard HTTPS, no inbound exposure needed.
- **Neon `DATABASE_URL` accessible from the Optiplex.** Already confirmed.

## Known limitations and trade-offs

- **No proper free float in v1.** `weighted_shares_outstanding` from Polygon is shares outstanding, not the publicly tradeable float. Insider holdings, locked-up shares, and institutional positions aren't subtracted. For small-cap setups this typically overstates float by 20–60%. Workable for v1 filters (`shares_outstanding < 50M` will still catch most low-float runners) but not precise.
- **Polling, not streaming.** A trade printing 200ms after a tick won't be reflected until the next tick (15s RTH). For Day 1 this is acceptable; for tick-level setups (parabolic shorts entering on a single print) it would matter and would need WebSocket integration.
- **Home server reliability is on you.** If the Optiplex loses power or internet, the scanner stops and the heartbeat goes red. No Vercel fallback in v1 (by your decision — you have other tools to use if it's down).
- **Snapshot universe filter (price >= $0.10, vol >= 1000) excludes truly dormant tickers from backtest data.** If you later want to backtest setups on near-zero-volume names, we'd need to widen the filter or accept the gap.

## Open items to decide during execution (sprint-time, not now)

These are detail-level decisions Codex can resolve in the sprint without coming back to you:

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

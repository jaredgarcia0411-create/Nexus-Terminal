# Nexus Terminal - HANDOFF.md

> Updated: 2026-05-11
> Purpose: compact recent context and follow-ups. Older implementation detail lives in git history and `specs/`.

> Historical completed sections were removed to keep this file focused. Use git history and the `specs/` directory for archived implementation detail.

## Active Execution Spec

### Cleanup Step 1: Remove Discord research import stack + Schwab dead deps

> Generated: 2026-05-11 | Author: planning conversation (cleanup audit `docs/repo-cleanup.md`)
> Status: COMPLETED — implemented and validated 2026-05-11
> Executor: Codex
> Validation: `npm run lint`, `npx tsc --noEmit`, `npm run typecheck:services`, `npm test`, `npm run db:migrate`, DB table check returned `[]`

#### Goal

This is the first step in a multi-step tech-debt cleanup. **Removals only — no refactors.** Two independent removals bundled into one PR because both are pure deletes with zero runtime risk:

1. **Discord research import stack.** The historical Discord-channel import feature is being retired. Its only consumer was the AskEdgar TLDR route, which passed imported reports and a historical summary as extra LLM context. Nothing else writes to those tables. After this step, the TLDR runs on AskEdgar data alone (which is what the user expected it was already doing).
2. **Schwab dependency + spec.** The `schwab_links` DB table was already dropped in migration `0018_nasty_warbird.sql`. Only the unused `@sudowealth/schwab-api` package and the never-shipped `specs/schwab-realtime-hybrid.md` spec remain. Both are pure deletes.

**What is NOT being removed here:**
- `lib/agents/discord.ts` and `writeAndDeliverReport()` — this is the agent fan-out to Discord webhooks (small-cap-research, swing-trader-research, orchestrator-macro-summary, orchestrator-macro-intraday blueprints all call it). Different concern; stays.
- `services/discord-bot/` — the standalone Discord bot service. Different concern; stays.
- `__tests__/agent-discord.test.ts` — covers `lib/agents/discord.ts`, not the import stack.

#### Locked decisions

- TLDR's `runResearchTldr` loses both `discordReport` and `historicalSummary` context params. The function signature, prompt builder, and route all drop those branches.
- Both DB tables get dropped via a new Drizzle migration generated from the schema edit. Always use `npm run db:migrate` (never `db:push`).
- The Vercel cron entry for `/api/discord/cron/sync` gets removed from `vercel.json`. `CRON_SECRET` stays in `.env.example` (still used by `mdr-sweep` and `agent-retention` crons), but its comment is updated.
- Root `.env.example` loses `DISCORD_BOT_TOKEN` and `DISCORD_CHANNEL_ID`. The `services/.env.example` keeps its own (separate set of) Discord vars for the bot service.

---

#### Phase 1 — Delete the Discord import routes and library

**Goal:** Remove the import surface area before touching consumers, so the next phases just delete dead-end imports.

1. Delete the following files:
   - `app/api/discord/import/route.ts`
   - `app/api/discord/sync/route.ts`
   - `app/api/discord/cron/sync/route.ts`
   - `lib/discord/parser.ts`
   - `lib/discord/client.ts`
   - `__tests__/discord-parser.test.ts`
2. Delete the now-empty `app/api/discord/` tree (the `alerts/evaluate/` and `link/code/` directories under it are empty placeholders).
3. Delete the now-empty `lib/discord/` directory.

**Validation after Phase 1:**
- `npx tsc --noEmit` will fail because `app/api/askedgar/tldr/route.ts` still imports the deleted tables. That's expected; Phase 2 fixes it.

---

#### Phase 2 — Remove Discord context from the TLDR route and `lib/research.ts`

**Goal:** TLDR now only consumes AskEdgar data.

**File:** `app/api/askedgar/tldr/route.ts`
**Action:** MODIFY

1. Remove these imports:
   - `and, desc, eq` from `drizzle-orm` (the only remaining drizzle helper after this change is none — drop the import entirely)
   - `importedResearchReports, tickerResearchSummaries` from `@/lib/db/schema`
2. In the `POST` handler:
   - Replace the `Promise.all([...])` block with a single `await getCachedTickerData(ticker)` call.
   - Remove the `summaryRows`, `discordRows`, `historicalSummary`, `latestDiscord`, and `discordReport` locals.
   - Remove `db.select(...)` calls entirely (the route no longer touches the DB).
   - Call `runResearchTldr(askEdgarData.rawData, ticker)` without the third options arg.
   - Drop `hasHistoricalData` from the response JSON.
3. Also remove unused imports: `getDb`, `dbUnavailable`, the `db` local, and the `db == null` guard. The route only needs `requireUser`, `parseAndValidate`, `getCachedTickerData`, `runResearchTldr`, and the error helpers.

**File:** `lib/research.ts`
**Action:** MODIFY

1. Update `buildResearchTldrPrompt` signature — drop `historicalSummary` and `discordReport` from the options type. The new signature is:
   ```ts
   function buildResearchTldrPrompt(
     reportData: Record<string, unknown[]>,
     options?: { ticker?: string },
   ): string
   ```
2. Inside `buildResearchTldrPrompt`, delete the two trailing template parts that append `<historical_summary>` and `<latest_discord_report>` blocks.
3. Update `runResearchTldr` signature — drop the `context` parameter entirely. The new signature is:
   ```ts
   export async function runResearchTldr(
     rawData: Record<string, AskEdgarResponse<unknown>>,
     ticker: string,
   ): Promise<ResearchTldr>
   ```
4. Inside `runResearchTldr`, drop the `historicalSummary` and `discordReport` keys from the `buildResearchTldrPrompt` call.

**File:** `__tests__/askedgar-tldr-route.test.ts`
**Action:** MODIFY

1. Remove `summaryRows` and `discordRows` from the test mock helper signature.
2. Remove the `selectCallIndex`-based mock that returns different rows depending on which query fires (the route no longer makes those queries).
3. Drop assertions on `hasHistoricalData`, `historicalSummary`, and `discordReport` in `runResearchTldr` call args.
4. Update the `it('returns 200 with ticker, TLDR findings payload, generatedAt, and hasHistoricalData', ...)` test name and assertions to reflect the new response shape (no `hasHistoricalData` field).

**Validation after Phase 2:** `npm run lint && npx tsc --noEmit` should pass.

---

#### Phase 3 — Drop the DB tables via migration

**Goal:** Remove the now-unreferenced tables.

**File:** `lib/db/schema.ts`
**Action:** MODIFY

1. Delete the `importedResearchReports` table export (currently at lines 139-153).
2. Delete the `tickerResearchSummaries` table export (currently at lines 155-166).

**Generate migration:**
1. Run `npm run db:generate`. Drizzle Kit will create `drizzle/0030_<auto-name>.sql` containing `DROP TABLE` statements for both tables.
2. Open the generated SQL file and confirm it contains:
   - `DROP TABLE "imported_research_reports" CASCADE;`
   - `DROP TABLE "ticker_research_summaries" CASCADE;`
   - (and matching index/constraint drops if drizzle emits them)
3. Run `npm run db:migrate` to apply. **Never use `db:push` on this repo** — it has a false-positive on composite PKs and corrupts the migration history.

**Validation after Phase 3:** Local DB no longer has either table. `npx tsc --noEmit` still passes.

---

#### Phase 4 — Remove Vercel cron entry and env-var stubs

**File:** `vercel.json`
**Action:** MODIFY

Remove the first `crons` entry (`/api/discord/cron/sync`). The two remaining entries (`agent-retention`, `mdr-sweep`) stay. Final file:

```json
{
  "crons": [
    {
      "path": "/api/cron/agent-retention",
      "schedule": "0 8 * * *"
    },
    {
      "path": "/api/cron/mdr-sweep",
      "schedule": "0 22 * * 1-5"
    }
  ]
}
```

**File:** `.env.example`
**Action:** MODIFY

1. Delete the two-line block at the bottom for `DISCORD_BOT_TOKEN` and `DISCORD_CHANNEL_ID` (plus their comment headers).
2. Update the `CRON_SECRET` comment from `# Cron (required for Discord sync on Vercel)` to `# Cron (required for Vercel cron auth — mdr-sweep, agent-retention)`.
3. `services/.env.example` is **not modified** — those Discord vars are for the standalone bot service.

**Vercel dashboard cleanup (manual, do not script):** flag to the user that they should remove `DISCORD_BOT_TOKEN` and `DISCORD_CHANNEL_ID` from the Vercel project's environment variables panel after this ships. Not a code change; goes in the commit message or PR body as a note.

---

#### Phase 5 — Schwab cleanup

**File:** `package.json`
**Action:** MODIFY

Run `npm uninstall @sudowealth/schwab-api`. This removes the entry from `dependencies` and regenerates `package-lock.json`.

**File:** `specs/schwab-realtime-hybrid.md`
**Action:** DELETE

The spec was never shipped (the `schwab_links` table it described was already dropped in migration 0018). Delete the file.

---

#### Phase 6 — Final validation

Run from repo root:

1. `npm run lint`
2. `npx tsc --noEmit`
3. `npm run typecheck:services` (we didn't touch `services/`, but the migration ran so this confirms the services TS still resolves the schema)
4. `npm test`
5. `grep -rn "lib/discord\|importedResearchReports\|tickerResearchSummaries\|schwab" --include='*.ts' --include='*.tsx' .` should return only matches inside `drizzle/` migration history (which is correct — old migrations stay as history) and `lib/agents/discord.ts` (which is the agent fan-out, intentionally kept).

If anything fails, stop and surface the failure. Do not commit half-finished state.

---

#### Files Changed Summary

| File | Change | Risk |
|---|---|---|
| `app/api/discord/import/route.ts` | DELETE | Low |
| `app/api/discord/sync/route.ts` | DELETE | Low |
| `app/api/discord/cron/sync/route.ts` | DELETE | Low |
| `lib/discord/parser.ts` | DELETE | Low |
| `lib/discord/client.ts` | DELETE | Low |
| `__tests__/discord-parser.test.ts` | DELETE | Low |
| `app/api/askedgar/tldr/route.ts` | Drop DB queries + Discord/historical context | Med |
| `lib/research.ts` | Drop context params from `buildResearchTldrPrompt` + `runResearchTldr` | Med |
| `__tests__/askedgar-tldr-route.test.ts` | Drop discord/summary mock paths + assertions | Low |
| `lib/db/schema.ts` | Delete `importedResearchReports` + `tickerResearchSummaries` exports | Med |
| `drizzle/0030_*.sql` | NEW — drop both tables (auto-generated) | Med |
| `vercel.json` | Remove `/api/discord/cron/sync` cron entry | Low |
| `.env.example` | Remove Discord vars + update CRON_SECRET comment | Low |
| `package.json` + `package-lock.json` | `npm uninstall @sudowealth/schwab-api` | Low |
| `specs/schwab-realtime-hybrid.md` | DELETE | Low |

#### Out of scope

- `lib/agents/discord.ts` and `writeAndDeliverReport` (agent fan-out to Discord webhooks — used by all blueprints; stays).
- `services/discord-bot/` (standalone bot service; stays).
- `__tests__/agent-discord.test.ts` (covers the agent fan-out, not the import stack; stays).
- Cleaning up `HANDOFF.md` stale `fetchAndCacheRawReport()` comment in `app/api/research-report/route.ts:52` — happens in Step 2 when that function is deleted.
- All medium-confidence removal candidates from `docs/repo-cleanup.md` (saved-tickers, daily-summary, agents/research direct route, askedgar/lookup, legacy `agentMemory` schema). Parked for a later decision.
- Any refactor work (AskEdgar module split, TradingView client extraction, client cache hook, hooks/use-trades.ts decomposition).

---

## Cleanup Plan Roadmap

The full cleanup is sequenced as removals first, then fixes, then refactors. Each step gets its own HANDOFF spec when we're ready to execute it.

1. **Step 1 (COMPLETED 2026-05-11):** Discord research import stack + Schwab dead deps.
2. **Step 2 — High-confidence dead code:** Delete `components/trading/WeeklyCalendar.tsx`, `components/trading/ResearchGainersList.tsx`, `components/trading/plugins/HorizontalLinePrimitive.ts`, and `fetchAndCacheRawReport()` in `lib/research.ts`. Fix the now-stale comment in `app/api/research-report/route.ts:52` that references it. Final `rg` verification before each delete.
3. **Step 3 — Medium-confidence removals (decision pass):** Walk through saved-tickers, market-data/daily-summary, `/api/agents/research` direct route, `/api/askedgar/lookup`, and legacy `agentMemory` schema. Each needs a product-side decision before deletion. Backend-only routes may have manual cURL consumers you forgot about.
4. **Step 4 — Cost/reliability fixes:** Make `/api/research-report` POST idempotent (DB-backed ticker claim to prevent duplicate paid LLM calls); route site-report LLM usage through `lib/agents/runtime-limits.ts` budget telemetry; move AskEdgar daily-cap + retry-window state into Postgres (module memory resets on Vercel cold start, so today's caps are advisory only). Add one short-TTL server aggregate endpoint for the dashboard scanner polling.
5. **Step 5 — Refactors (only after pruning):** Split `lib/askedgar.ts` (1,462 lines) into `endpoints` / `fanout` / `cache` / `snapshot-normalizer`. Extract `lib/tradingview-client.ts` for shared TradingView scan logic. Replace module-level client caches in `ResearchTldr`, `ResearchReportPanel`, `MacroSummaryPanel`, `use-candle-data` with one TTL-aware resource hook.
6. **Step 6 — Docs drift:** Compact `HANDOFF.md` after Step 5 (or sooner if it gets stale again). Update `README.md` env-var section (`JARVIS_*` → `LLM_*` / `BACKGROUND_LLM_*`). Update `docs/VALIDATION_MATRIX.md` (refs deleted `services/backtest-*`). Sync `codex-skills/nexus-vercel-ops/SKILL.md` and `docs/FUTURE-PLANS.md` cron counts (will be 2 after Step 1, not 3). Update `AGENTS.md` validation-file count.

Codex-skills sync work is intentionally **excluded** from this roadmap per user direction.

---

## Recently Completed Summary

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

# Nexus Terminal - HANDOFF.md

> Updated: 2026-05-12
> Purpose: shipped-work summary and remaining follow-ups. Older implementation detail lives in git history and `specs/`.

## Cleanup Roadmap Status

Source artifact: `docs/repo-cleanup.md`.

1. **Step 1 complete:** retired Discord research import stack and unused Schwab dependency/spec removed. Agent Discord delivery remains intentionally live.
2. **Step 2 complete:** cost/reliability fixes shipped for research-report idempotency, site-report telemetry, AskEdgar Postgres runtime state, and dashboard scanner aggregate polling.
3. **Step 3 complete:** high-confidence dead code removed.
4. **Step 4 complete:** backend-only/dead API and schema surfaces removed.
5. **Step 5 complete:** repo docs and workflow audit drift cleaned; commit `bbf909f`.
6. **Step 6 complete:** Codex harness skill alignment reviewed repo skills, synced repo-maintained installed copies, and patched stale installed-only legacy skill guidance where needed.
7. **Step 7 parked:** broad refactors (`lib/askedgar.ts`, TradingView client extraction, client cache hook) should wait until feature work touches those areas.
8. **Step 8 pending:** consider `npm run typecheck` / `npm run validate` convenience scripts after skill sync is settled.

## Shipped Work Summary

### Market Pulse v1 and v1.1

> Generated: 2026-05-12
> Status: COMPLETE — local validation and owner-run production validation are complete. Market Strength is populated from stored Market Pulse data and visible through the site report flow.
> Commits: `bc7edc9` added Market Pulse v1, `383b525` enabled safe backfills and the production cron, `fa4a899` allowed enqueue from existing stats after production backfill, and `47a911f` normalized loose Market Pulse LLM drafts before report validation.

Market Pulse now stores normalized whole-market EOD bars and daily stats, generates a structured `market-pulse` report through the orchestrator worker, and reads the latest site report from `agent_reports` for Dashboard Market Strength.

Key shipped behavior:

- `GET /api/agents/market-pulse/latest` selects the newest `reportJson.tradingDate`, with `agent_reports.created_at` as the tie-breaker.
- `GET /api/cron/market-pulse-eod` supports `enqueue=0|1`; operator backfills can populate bars/stats without creating historical LLM jobs.
- `days=N` backfills target trading days, skipping weekends/holidays without consuming the requested quota.
- `vercel.json` schedules `/api/cron/market-pulse-eod` at `30 22 * * 1-5`.
- Explicit latest-date enqueue can create/reuse one `orchestrator/market-pulse` job for the selected trading date.
- If explicit date recapture fails but `market_pulse_daily_stats` already has that date, the cron route can enqueue from the existing stats row.
- The Market Pulse blueprint normalizes loose LLM draft fields into the strict report contract before saving.

Validation completed:

- Original v1 validation passed before `bc7edc9`: `npm run db:generate`, `npm run db:migrate`, targeted Market Pulse/scanner tests, `npm run lint`, `npx tsc --noEmit`, `npm test`, and `npm run workflow:audit`.
- v1.1 code validation passed before `383b525`: `npx vitest run __tests__/market-pulse-eod-route.test.ts`, `npx vitest run __tests__/agent-market-pulse-route.test.ts`, `npx vitest run __tests__/market-pulse-panel.test.tsx`, scanner regression tests, `npm run lint`, `npx tsc --noEmit`, `npm test`, and `npm run workflow:audit`.
- Production backfill populated `market_pulse_daily_bars` and `market_pulse_daily_stats` for the recent 30-trading-day window, including `2026-05-11`.
- Production latest-date enqueue produced `jobsEnqueuedDates: ["2026-05-11"]`; follow-up patches covered the production enqueue and LLM draft validation failures.
- Final owner-run production validation is complete: worker processing/report generation and Dashboard Market Strength readback are confirmed good to go.
- Follow-up validation for `fa4a899`: `npm test` passed.
- Follow-up validation for `47a911f`: `npx vitest run __tests__/agent-blueprints.test.ts`, `npm run lint`, `npx tsc --noEmit`, and `npm test` passed.

Operational notes:

- Use `enqueue=0` for historical stats-only backfills to avoid generating one LLM report per old trading day.
- Use `date=YYYY-MM-DD&enqueue=1` only for the latest completed trading day that should become visible on the site.
- `agent_reports` remains the site source of truth; bars/stats alone do not render Dashboard Market Strength.
- Missing Discord delivery can mark delivery as failed, but site readback should still work when the report row exists.

There is no active execution spec at this time.

### AskEdgar Dilution and Scanner Recovery

> Generated: 2026-05-13
> Status: CODE COMPLETE — pending owner review/commit.

Recovered and completed the in-flight dilution/scanner edits:

- Dilution page preserves AskEdgar-provided registration statuses for ATM and equity-line rows instead of reducing them to only Active/Inactive.
- Dilution page preserves AskEdgar-provided warrant status labels when present, while keeping the existing local price/date-derived fallback when no status is returned.
- Dilution page now renders a dedicated Convertible Notes table from normalized `dilution-data` rows.
- Registration normalization accepts broader amount/remaining-capacity field names so ATM and equity-line values display when AskEdgar uses alternate keys.
- Scanner summary flags no longer drop registration rows because they are expired/restricted or not directly effective; ATM, S-1, and equity-line flags reflect surfaced registration data.

Validation completed:

- `npx vitest run __tests__/research-snapshot-mapper.test.ts __tests__/askedgar-client.test.ts __tests__/scanner-summary-route.test.ts` passed.
- `npm run lint` passed.
- `npx tsc --noEmit` passed.
- `npm test` passed.
- `npm run workflow:audit` passed.

### Day 1 Scanner Threshold Fix

> Generated: 2026-05-13
> Status: CODE COMPLETE — pending owner review/commit.

Investigation found the Day 1 TradingView scanner had several blockers that could drop names that should qualify from previous-session AH/PM action:

- Server prefilters still required `close >= $0.90`, market cap `< $300M`, and exchange in NASDAQ/NYSE, none of which are part of the current scan contract.
- Server qualification required combined AH+PM volume `>= 2M`; the current contract is AH+PM volume `> 1M`.
- Normalization rejected rows with missing regular-session `change` or `volume`, even when AH/PM change and volume were valid.
- The UI displayed `close` as PDC, but TradingView's `close` is session-dependent. The route now derives prior day close from the chosen AH/PM mark and change percent when possible.

Current Day 1 qualification:

- Prior day close `> $0.75`.
- AH+PM volume `> 1,000,000`.
- Best AH or PM change `>= +40%`.
- Client-side Day 1 latch continues keeping qualifying rows visible for the ET day.

Validation completed:

- `npx vitest run __tests__/tradingview-gainers-route.test.ts __tests__/dashboard-scanner-table.test.tsx` passed.

### Final Research and Scanner UI Polish

> Generated: 2026-05-13
> Status: CODE COMPLETE — pending owner review/commit.

Final narrow UI pass completed:

- Day 1 Setup scanner column label changed from `AH+PM Vol` to `Volume`, while the value remains route-derived extended-hours volume.
- Research chart now renders the same extended-hours shading used by the other intraday chart surfaces.
- Research News rows now display normalized source labels (`News`, `JMT415`, `Groq`) without the old purple Groq treatment, and expanded article summaries use the standard `border-white/10` border on a black background.
- Dilution Convertible Notes conversion price now uses bold mono styling to match the emphasis of warrant strike prices.

Validation completed:

- `npx vitest run __tests__/dashboard-scanner-table.test.tsx` passed.
- `npm run lint` passed.
- `npx tsc --noEmit` passed.
- `npm test` passed.

## Open Follow-Ups

- AskEdgar Sprint 3 Part B (`split-status`) remains parked pending endpoint-usage audit.
- Endpoint review still pending: `screener`, `ownership`, `nasdaq-compliance`, `historical-float-pro`, and `float-outstanding`.
- Filings v2/v3 remain deferred: in-app SEC filing viewer, then full-text filing search plus AI Copilot after cost analysis.
- Auto stop-out for Backtesting remains deferred until requested.
- Backtest Manager `broke_premarket_high` filter remains deferred.

# Nexus Terminal - HANDOFF.md

> Updated: 2026-05-12
> Purpose: compact current cleanup context and the next executable spec. Older implementation detail lives in git history and `specs/`.

## Cleanup Roadmap Status

Source artifact: `docs/repo-cleanup.md`.

Recommended review order from the cleanup audit:

1. Decide product removals first, especially Discord-imported research history.
2. Fix cost and idempotency risks around AskEdgar, scanners, and paid Research Report generation.
3. Remove high-confidence dead code and unused dependencies.
4. Decide whether backend-only feature surfaces are parked, planned, or removable.
5. Clean workflow/docs drift.
6. Sync and align Codex harness skills.
7. Decompose oversized modules only when touching those areas.
8. Improve personal workflow gates with scripts and shorter post-validation handoffs.

Current live-repo confirmation:

1. **Step 1 complete.** Discord research import stack and Schwab dependency/spec are removed. Agent Discord delivery remains intentionally live through `lib/agents/discord.ts`.
2. **Step 2 complete.** Research Report POST has an `in_progress` DB claim, site report LLM usage records through `recordLlmAttempt`, AskEdgar daily ticker/rate-limit state has Postgres tables, and Dashboard scanner polling uses `/api/dashboard/scanner-state`.
3. **Step 3 complete.** High-confidence dead code names from the audit no longer resolve in live TS/TSX/package surfaces: `fetchAndCacheRawReport`, `ResearchGainersList`, `WeeklyCalendar`, `HorizontalLinePrimitive`, and `@sudowealth/schwab-api`.
4. **Step 4 complete.** Medium-confidence/backend-only surfaces from the audit are gone from live API/schema surfaces: `/api/askedgar/lookup`, `/api/saved-tickers`, `/api/market-data/daily-summary`, direct `/api/agents/research`, `agentMemory`, `dailyTickerSummaries`, and `savedTickers`.
5. **Step 5 complete.** Workflow/docs drift cleanup updated README, validation docs, Vercel cron docs, AGENTS validation-schema guidance, and the default workflow audit scope.
6. **Step 6 pending.** Harness skill sync remains separate because syncing installed skills writes outside the repo and may require approval.
7. **Step 7 parked.** `lib/askedgar.ts`, TradingView client extraction, and client cache hook refactors should wait until a feature/bug touches those areas.
8. **Step 8 pending.** Workflow gates can be handled after Step 5 docs drift, likely by adding `typecheck`/`validate` scripts and updating docs to reference them.

## Active Execution Spec

### Cleanup Step 5: Workflow/docs drift cleanup

> Generated: 2026-05-12 | Author: Codex planning pass from `docs/repo-cleanup.md`
> Status: COMPLETED — implemented and validated 2026-05-12
> Executor: Codex
> Commit strategy: one docs/workflow commit after validation. Do not push unless explicitly requested.
> Validation: `npm run workflow:audit`, `npm run workflow:audit -- --include-cross-tool`, targeted stale-reference grep, `npm run lint`, `npx tsc --noEmit`, and `npm test` all passed. `npm run typecheck:services` skipped because no `services/` files changed.

#### Objective

Bring repo-facing docs and workflow guidance back in line with the live cleanup state after Steps 1-4. Keep this pass narrow: update stale docs and workflow checks only; do not start large refactors or installed-skill sync work.

#### Current State Verified

- `docs/VALIDATION_MATRIX.md` still references deleted `services/backtest-gateway` and `services/backtest-worker` validation commands, while `package.json` exposes the current service gate as `npm run typecheck:services`.
- `README.md` still advertises Discord report import, still says Research TLDR combines Discord historical summary context, and still documents `JARVIS_*` env vars. Live TLDR uses AskEdgar data directly in `app/api/askedgar/tldr/route.ts`, and `.env.example` uses `LLM_*` / `BACKGROUND_LLM_*` naming.
- `codex-skills/nexus-vercel-ops/SKILL.md` says `vercel.json` defines one cron at `/api/discord/cron/sync`; live `vercel.json` defines two crons: `/api/cron/agent-retention` and `/api/cron/mdr-sweep`.
- `docs/FUTURE-PLANS.md` says "two existing Vercel crons" but names `/api/discord/cron/sync`, which no longer exists.
- `AGENTS.md` says validation schemas live in only `lib/validations/trades.ts` and `lib/validations/system.ts`; live `lib/validations/` has multiple feature-specific files.
- `scripts/workflow-audit.mjs` still audits `.claude` and `.opencode` surfaces by default, while current AGENTS guidance says to ignore those unless explicitly asked for cross-tool alignment.
- `HANDOFF.md` has been compacted to the current roadmap and this active spec.

#### Files To Modify

- `README.md`
- `docs/VALIDATION_MATRIX.md`
- `docs/FUTURE-PLANS.md`
- `AGENTS.md`
- `codex-skills/nexus-vercel-ops/SKILL.md`
- `scripts/workflow-audit.mjs`
- `HANDOFF.md`

#### Ordered Work

1. **README refresh.**
   - Remove Discord report import from the product description.
   - Add current product areas that are missing or under-described: Backtesting and Archive.
   - Update Research TLDR wording so it says TLDR uses AskEdgar snapshot/raw data, not Discord historical summaries.
   - Replace `JARVIS_*` env-var docs with current `LLM_*` / `BACKGROUND_LLM_*` names from `.env.example`.
   - Keep README concise; do not turn it into a full product manual.

2. **Validation matrix refresh.**
   - Replace deleted service package commands with `npm run typecheck:services`.
   - Add the default validation order used by AGENTS: `npm run lint`, `npx tsc --noEmit`, conditional `npm run typecheck:services`, `npm test`.
   - Keep database validation guidance, but make clear `npm run db:migrate` is the migration-apply path and `db:push` is not the cleanup/default path.

3. **Cron/docs alignment.**
   - Update `codex-skills/nexus-vercel-ops/SKILL.md` to read `vercel.json` at runtime and state the currently known crons accurately: `/api/cron/agent-retention` and `/api/cron/mdr-sweep`.
   - Update `docs/FUTURE-PLANS.md` staging cron notes to remove `/api/discord/cron/sync` and include the live cron list.

4. **AGENTS validation-schema wording.**
   - Change the Zod schema sentence to point to `lib/validations/` generally, with examples instead of saying schemas live only in two files.
   - Preserve the Zod v4 `z.flattenError(result.error)` warning.

5. **Workflow audit scope correction.**
   - Update `scripts/workflow-audit.mjs` so the default audit matches current Codex harness guidance:
     - keep checks for `AGENTS.md` mentioning `typecheck:services` and `workflow:audit`;
     - keep checks for repo Codex skill sources that should stay aligned with live repo facts;
     - stop checking `.claude/**` and `.opencode/**` by default.
   - If optional cross-tool checks are worth keeping, gate them behind an explicit CLI flag such as `--include-cross-tool`. Do not make them default.
   - Update any script messages so failures point to the exact stale file.

6. **Handoff closeout.**
   - After edits and validation, update this spec status to completed.
   - Record validation results directly under this active spec.
   - Leave Step 6 skill sync and Step 8 workflow scripts as next pending roadmap items, not part of this commit.

#### Acceptance Criteria

- README no longer mentions live Discord import routes or `JARVIS_*` env vars.
- `docs/VALIDATION_MATRIX.md` no longer references deleted `services/backtest-gateway` or `services/backtest-worker`.
- Vercel cron docs match live `vercel.json`.
- AGENTS validation guidance no longer claims only two validation schema files exist.
- `npm run workflow:audit` no longer checks `.claude` or `.opencode` by default.
- `HANDOFF.md` remains compact and points to the next pending cleanup items.

#### Validation

Run from repo root:

1. `npm run workflow:audit`
2. `npm run lint`
3. `npx tsc --noEmit`
4. `npm test`

`npm run typecheck:services` is not required unless the execution changes files under `services/`.

#### Out Of Scope

- Installed skill sync under `~/.codex/skills`.
- Refactoring `lib/askedgar.ts`, TradingView scan clients, or client cache hooks.
- Changing `.claude/` or `.opencode/` content unless the user explicitly asks for cross-tool alignment.
- Schema/migration changes.
- Commits or pushes unless explicitly requested.

#### Complexity Estimate

Low-to-medium. Mostly docs and one Node script update. The main risk is making `workflow:audit` too weak; preserve checks that protect current Codex workflow facts.

## Next Pending Items

1. **Cleanup Step 6:** Decide whether to sync repo-maintained Codex skills into `~/.codex/skills`, then align installed copies if approved.
2. **Cleanup Step 8:** Add `npm run typecheck` and `npm run validate` scripts if we want shorter validation references in future specs.
3. **Cleanup Step 7:** Keep broad refactors parked until feature work touches the relevant modules.

## Recently Completed Summary

- 2026-05-12: Cleanup Step 4 shipped cost/reliability fixes: research-report idempotency, site-report telemetry, AskEdgar Postgres runtime state, and dashboard scanner aggregate endpoint. Browser smoke remained user-owned on the dev server.
- 2026-05-12: Cleanup Step 3 deleted dead backend-only routes/schemas and related tests/docs.
- 2026-05-12: Cleanup Step 2 removed high-confidence dead code and stale comments.
- 2026-05-11: Cleanup Step 1 removed retired Discord research import stack and unused Schwab dependency/spec.
- 2026-05-07: Research Report wiring, TLDR contract refresh, and Research-tab UI polish shipped; authenticated/manual browser smoke remained pending.

## Open Follow-Ups Carried Forward

- AskEdgar Sprint 3 Part B (`split-status`) remains parked pending endpoint-usage audit.
- Endpoint review still pending: `screener`, `ownership`, `nasdaq-compliance`, `historical-float-pro`, and `float-outstanding`.
- Filings v2/v3 remain deferred: in-app SEC filing viewer, then full-text filing search plus AI Copilot after cost analysis.
- Auto stop-out for Backtesting remains deferred until requested.
- Backtest Manager `broke_premarket_high` filter remains deferred. Data is not captured today; revisit once we decide whether to store it on the session at save time or derive from market data on stats load.

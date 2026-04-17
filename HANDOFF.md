# Nexus Terminal — HANDOFF.md

> Updated: 2026-04-17
> Purpose: brief summary of recently completed work plus any active execution spec. Older implementation detail lives in git history and `specs/`.
> Historical completed sections were archived to keep this file focused. Agent Hardening #1 shipped in commit `7118598`; Agent Hardening #2 (trust boundary in prompt assembly) shipped in commit `2a856f1`; Agent Hardening #3 (memory / retention TTL-on-read) shipped in commit `bf13567`. See git history and `specs/` for the full implementation records.

## Current State

**Active spec:** None.

The next planned item is approval gates plus spend enforcement from `FUTURE-PLANS.md`.

## Validation Snapshot

Most recent validation (`2026-04-17`, post research agent refinements + follow-up tests):

- `npm run lint` — passed
- `npx tsc --noEmit` — passed
- `npm test` — passed (`48` files, `383` tests)

## Recently Completed

### Research Agent Report Refinements — `2026-04-17` (commit `9a69655`)

- Added a structured `gapStatsTable` field (`date`, `gapPct`, `open`, `close`, last 5 rows most recent first) and a rated `financialCommentary` section to both `SmallCapResearchReport` and `SwingResearchReport`. Shared `GapStatsRow` type lives in `lib/agents/types.ts`.
- Per-day gap rows and the AskEdgar `managementCommentary` are now deterministically extracted in `computeDeterministicAnalysis()` (small-cap) and `computeSwingTechnicals()` (swing-trader), fed into the LLM prompt, and the LLM's `gapStatsTable` value is overwritten with the deterministic value after Zod parse so numbers can't drift.
- `extractGapStatsTable()` resolves AskEdgar's normalized field names first (`gapPercentage`, `marketOpen`, `marketClose`) with legacy aliases as fallbacks.
- Discord embeds (`buildResearchEmbed`, `buildSwingSetupEmbed`) render the gap table as a fixed-width code block and add a `Financial Commentary` traffic-light line; empty gap data renders "No historical gap data available." cleanly instead of a JSON blob.
- `lib/agents/prompts/small-cap.md` traffic-light semantics normalized to match `jmt-report-format.md` (RED = high dilution / offering ability / liquidity concerns; GREEN = legit catalysts / low offering risk / well-funded). `swing-trader.md` semantics unchanged — only additive usage instructions for the new fields.
- Follow-up tests added: unit coverage for `extractGapStatsTable()` alias resolution (both blueprints) and the empty-gap Discord fallback in both embeds.

## Follow-Up Notes

- Production check: after deploy, verify `GET /api/cron/agent-retention` returns `200` when called with the existing project `CRON_SECRET`.
- After first production run of the refined research agents, confirm a Discord embed renders the gap table for a ticker with gap history and the "No historical gap data available." fallback for a ticker without — this was the bug the refactor targeted.

# Nexus Terminal — HANDOFF.md

> Updated: 2026-04-16
> Purpose: brief summary of recently completed work. Older implementation detail lives in git history and `specs/`.

## Current State

No active execution spec is parked here right now. The repo has been in cleanup and shipment mode, so this file now records the latest completed work at a summary level until a new active handoff is needed.

## Recently Completed

### Agent Hardening Plan Refreshed

- The agent hardening backlog in `FUTURE-PLANS.md` was refreshed on `2026-04-16` after a repo-grounded deep research pass.
- The order of operations now emphasizes auth scoping first, then prompt/context trust separation and retention cleanup, then approval gates and spend enforcement, then dependency tracking, and only then a sandbox/sidecar boundary.

### Workflow Surfaces Rationalized

- On `2026-04-16`, the repo workflow surfaces were cleaned up to reduce drift and token bloat across Codex, Claude, and OpenCode docs.
- `AGENTS.md` is now the canonical workflow source; `HANDOFF.md` remains a summary file unless a new active execution spec is explicitly parked here.
- Claude hook guards were fixed to stop depending on `jq`, `MultiEdit` writes are now covered, service-local type-check requirements are explicit, OpenCode research and test-audit workflows were slimmed down, and the unrelated `Remi` persona was removed.
- A repo-local workflow drift check was also added as `npm run workflow:audit`.

Primary files touched:

- `AGENTS.md`
- `.claude/CLAUDE.md`
- `.claude/settings.json`
- `.claude/hooks/protect-env.sh`
- `.claude/hooks/migration-guard.sh`
- `.claude/hooks/typecheck.sh`
- `.claude/commands/create-agent.md`
- `.claude/commands/security-scan.md`
- `.opencode/agents/executor.md`
- `.opencode/commands/research.md`
- `.opencode/commands/test-auditor.md`
- `.opencode/skills/research/SKILL.md`
- `.opencode/skills/test-auditor/SKILL.md`
- `codex-skills/nexus-deep-research/SKILL.md`
- `scripts/workflow-audit.mjs`
- `package.json`

### Macro Daily Pipeline Shipped

- Phase 1 established the macro daily flow and follow-on planning (`2026-04-13`).
- Commit `fada1b0` added sentiment signals to the daily briefing, including prompt/context updates, a new `lib/agents/sentiment-client.ts`, and expanded agent/Discord coverage.
- Commit `0b33d6e` added daily deltas plus intraday macro updates through new orchestrator blueprints, config/context wiring, cron updates, and stronger regression coverage across the agent stack.

Primary files touched:

- `lib/agents/blueprints/orchestrator-macro-summary.ts`
- `lib/agents/blueprints/orchestrator-macro-intraday.ts`
- `lib/agents/discord.ts`
- `lib/agents/macro-cron.ts`
- `__tests__/agent-blueprints.test.ts`
- `__tests__/agent-discord.test.ts`

### Specialist News Pipeline Unified

- Commit `fbf04e4` centralized specialist news formatting through `lib/agents/news-formatter.ts`.
- Small-cap and swing-trader research blueprints were updated to use the shared path, with prompt adjustments and dedicated formatter tests added.
- Claude workflow docs were updated in the same pass and later re-rationalized during the workflow cleanup above.

Primary files touched:

- `lib/agents/news-formatter.ts`
- `lib/agents/blueprints/small-cap-research.ts`
- `lib/agents/blueprints/swing-trader-research.ts`
- `__tests__/news-formatter.test.ts`

### Discord Orchestrator Bot Cleanup

- Commit `e91d5a9` simplified the Discord bot response contract in `services/discord-bot/index.ts`.
- Routed requests now get a single plain reply: `Routed to specialist.`
- Direct orchestrator replies still render as embeds, but the visible session footer was removed.
- Failure and timeout handling stayed intact; the change was about reducing duplicate noise in `#orchestrator`.

Primary files touched:

- `services/discord-bot/index.ts`

### Repo-Managed Codex Skills Added

- Commit `2ca9a3d` added repo-maintained skills for status, debugging, review, security audit, and AskEdgar debugging workflows.
- `AGENTS.md` and this handoff were updated to point future agents at those repo-local skill sources.

Primary files touched:

- `codex-skills/nexus-status/`
- `codex-skills/nexus-debug/`
- `codex-skills/nexus-review/`
- `codex-skills/nexus-security-audit/`
- `codex-skills/nexus-askedgar-debug/`
- `AGENTS.md`

### Site-Native Agent Surface Planning Captured

- On `2026-04-16`, a repo-grounded architecture review captured the current agent messaging/report findings in `FUTURE-PLANS.md`.
- The planning note records that `agent_reports` is already the canonical persisted artifact, Discord is a transport/delivery layer rather than the source of truth, macro belongs on `Dashboard`, and agent-driven report work belongs in `Research`.
- The same note also records the recommended sequencing for a future execution spec: site-native macro/report surfaces first, then site-triggered job/status work, then in-site chat only after thread/session handling is tightened.

### Follow-Up Planning Captured Elsewhere

- Commit `b1be1d6` moved forward-looking work on agent hardening and the Hermes sidecar into `FUTURE-PLANS.md`.
- That planning remains intentionally separate from this handoff so `HANDOFF.md` stays focused on shipped work and the next active implementation spec when one is needed.

## Validation Snapshot

Current repo validation for workflow cleanup (`2026-04-16`):

- `npm run workflow:audit` — passed
- `npm run lint` — passed
- `npx tsc --noEmit` — passed
- `npm run typecheck:services` — passed
- `npm test` — passed (`46` files, `340` tests)

Most recent implementation-specific validation from the shipped Discord cleanup also included:

- `npx tsc --noEmit -p services/discord-bot/tsconfig.json` — passed

# Nexus Terminal - HANDOFF.md

> Updated: 2026-05-12
> Purpose: compact current cleanup context and the next review point. Older implementation detail lives in git history and `specs/`.

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

## Active Review Point

### Cleanup Step 6: Codex Harness Skill Alignment

> Status: COMPLETED — reviewed, validated, synced to installed skills, and approved for commit/push 2026-05-12.
> Validation: `npm run workflow:audit`, `npm run workflow:audit -- --include-cross-tool`, `npm run lint`, and `git diff --check` passed.
> Commit strategy: local commit, then push `main` to `origin`.

#### Objective

Align the Codex-facing skills, command aliases, and workflow checks used in this harness so they do not contradict `AGENTS.md`, the live repo, or each other.

#### Findings Confirmed

- Repo-maintained skills exist under `codex-skills/`, but live installed skills are loaded from `~/.codex/skills`.
- Installed harness is missing repo skills that `AGENTS.md` recommends: `nexus-status`, `nexus-debug`, `nexus-review`, `nexus-security-audit`, and `nexus-askedgar-debug`.
- Installed copies differ from repo sources for `nexus-commit`, `nexus-deep-research`, `nexus-frontend-design`, `nexus-vercel-ops`, `nexus-workflow-audit`, and `test-auditor`.
- `nexus-deep-research` had an internal contradiction: main skill allowed local-only research, while its reference/UI metadata still implied mandatory parallel subagents.
- Installed-only legacy skills still contain stale Nexus guidance (`migrations-agent`, `task-orchestrator`, `test-and-debug-agent`, `doc-writer-agent`, `security-review-agent`). They are outside the repo and cannot be committed here; align or replace them separately if they remain in the live skill registry.

#### Repo Edits Made For Review

- `codex-skills/nexus-deep-research/references/subagent-patterns.md` and `agents/openai.yaml`: align with optional, value-based delegation.
- `codex-skills/nexus-commit/SKILL.md`: make validation scope-aware and avoid rerunning already-passed validation just for commit.
- `codex-skills/nexus-review/SKILL.md`: make validation scope-aware and report skipped checks with reasons.
- `codex-skills/nexus-handoff/SKILL.md`: include `workflow:audit` and `typecheck:services` conditional validation in spec guidance.
- `codex-skills/test-auditor/SKILL.md`: make saved reports opt-in unless the workflow explicitly requires a durable artifact.
- `codex-skills/nexus-workflow-audit/SKILL.md`: include installed-skill parity when live harness alignment is requested.
- `scripts/workflow-audit.mjs`: add checks for the deep-research delegation-policy contradiction.

#### Installed Sync Completed

Repo-maintained skills were copied from `codex-skills/` into `~/.codex/skills/`. Parity check now only reports installed-only system/legacy skill folders outside this repo. Installed-only legacy skills with stale Nexus guidance were patched in place, but those files are not part of this repo commit.

## Open Follow-Ups

- AskEdgar Sprint 3 Part B (`split-status`) remains parked pending endpoint-usage audit.
- Endpoint review still pending: `screener`, `ownership`, `nasdaq-compliance`, `historical-float-pro`, and `float-outstanding`.
- Filings v2/v3 remain deferred: in-app SEC filing viewer, then full-text filing search plus AI Copilot after cost analysis.
- Auto stop-out for Backtesting remains deferred until requested.
- Backtest Manager `broke_premarket_high` filter remains deferred.

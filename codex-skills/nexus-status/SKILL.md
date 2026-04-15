---
name: nexus-status
description: >
  Show Nexus Terminal repo status at a glance. Use when the user asks where work stands, what is
  active in HANDOFF.md, what changed locally, or what the next step should be.
---

# Nexus Status

Use this skill for a fast read on the current worktree and active spec. Keep it concise.

## Workflow

1. Read `AGENTS.md` and `HANDOFF.md` first.
2. Inspect repo state:
   - `git status --short`
   - `git diff --stat`
   - `git log --oneline -10`
3. Summarize four things:
   - active spec titles and status from `HANDOFF.md`
   - uncommitted files and whether the tree is clean
   - the last 3 to 5 relevant commits
   - the next required implementation or validation step
4. If the current diff touches `services/`, call out that the root `tsconfig.json` excludes `services/` and a service-local typecheck may also be required.
5. If `HANDOFF.md` and the worktree disagree, flag the mismatch explicitly.

## Output Format

- **Active Specs**
- **Uncommitted Changes**
- **Recent Commits**
- **Next Steps**
- **Blockers / Mismatches** (only when applicable)

## Do Not

- Do not turn a status check into a deep audit unless the user asks.
- Do not run lint, type-check, or tests unless the user asks for validation too.
- Do not edit `HANDOFF.md`, `AGENTS.md`, or source files during a status-only request.

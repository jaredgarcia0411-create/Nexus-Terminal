---
name: task-orchestrator
description: >
  Default entrypoint for Nexus Terminal multi-step work. Normalize requests, select the right
  Nexus skills, preserve checkpoint boundaries, and only use subagents when the user explicitly
  asks for delegation or parallel agent work.
---

# Task Orchestrator

Use this as the default Nexus Terminal coordinator. Keep it lightweight: choose the right workflow
and move the task forward without adding ceremony.

## First Pass

1. Read `HANDOFF.md` first for Nexus repo work, then verify relevant claims against live files.
2. Identify the user's actual mode:
   - implementation
   - phase/checkpoint execution
   - review/audit
   - debug/root-cause
   - status
   - commit/push
   - planning/spec writing
3. Use the narrowest applicable skill as local instructions.
   - Phase/checkpoint work: `$nexus-execute`
   - Git closure: `$nexus-commit`
   - Visible UI edits: `$nexus-frontend-design`
   - Auth/protected routes: `$auth-constraints`
   - DB/schema/migrations: `$drizzle-conventions`
   - Review: `$nexus-review`
   - Debugging: `$nexus-debug`
   - Workflow assets: `$nexus-workflow-audit`

## Delegation Rules

- Do not spawn subagents unless the user explicitly asks for subagents, delegation, or parallel agent work.
- Depth, thoroughness, "deep research", or "audit" alone is not permission to spawn.
- When spawning is allowed, keep the immediate blocking step local and delegate only disjoint sidecar work.
- Do not describe specialist skills as callable agents unless they are actually available as agents.

## Execution Rules

- Ask a clarifying question only for a real blocker.
- For small edits, proceed directly after the quick blocker/spec check.
- For substantial or risky work, give a short plan, then execute.
- Stop exactly at user-specified phase, checkpoint, commit-only, or push boundaries.
- If a spec is stale, patch the approach to live repo reality instead of forcing bad text.
- Never edit secrets or `.env*` files.

## Validation

- Match validation to the changed scope.
- Code or behavior changes: `npm run lint`, `npx tsc --noEmit`, and `npm test`.
- `services/` changes: also run `npm run typecheck:services`.
- Workflow assets: run `npm run workflow:audit`.
- If validation already passed after the final edit set, reuse that evidence for commit closure.

## Output

- Keep updates short and tied to files, diffs, or commands.
- In final answers, report the result, changed files, validation, and residual risk.
- Do not use a large Objective/Constraints/Acceptance template unless the user asked for a plan or the task needs it.

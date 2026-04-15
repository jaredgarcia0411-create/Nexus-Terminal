---
name: nexus-review
description: >
  Review Nexus Terminal implementation work against the active handoff or a requested scope. Use
  when the user wants a compliance review, a ship/no-ship recommendation, or a check for missed
  acceptance criteria, validation gaps, or risky drift.
---

# Nexus Review

Use this skill for a focused implementation audit before handoff or merge.

## Workflow

1. Read `AGENTS.md` and `HANDOFF.md` first.
2. Resolve the review target:
   - a named section in `HANDOFF.md`
   - the most recent active handoff section
   - the current diff / working tree
   - a user-specified file or feature scope
3. Read the spec, current implementation, and any touched tests.
4. Compare implementation against:
   - ordered steps in the handoff/spec
   - acceptance criteria
   - repo invariants in `AGENTS.md`
5. Run required validation in repo order:
   - `npm run lint`
   - `npx tsc --noEmit`
   - `npm test`
   - if the scope touches `services/`, also run the relevant service-local typecheck or test command
6. Report findings in a strict structure:
   - **Spec Compliance** — pass / miss per step when a spec exists
   - **Acceptance Criteria** — pass / miss per criterion
   - **Issues Found** — severity, file path, concern, suggested fix
   - **Validation** — pass / fail for each command
   - **Verdict** — `READY TO SHIP` or `NEEDS FIXES`

## What To Check Carefully

- protected routes use `requireUser()` where required
- JSON input uses `parseAndValidate(...)` with Zod v4-compatible error handling
- SSE routes use `lib/sse.ts`, `dynamic = 'force-dynamic'`, and `maxDuration = 60`
- Ask Edgar integrations use cached helpers unless bypass is explicitly justified
- no new logic was stuffed into `hooks/use-trades.ts`
- no persistence-critical state relies on module-level memory

## Do Not

- Do not rewrite code during a review-only request.
- Do not mark criteria as passed unless the code or validation actually proves it.
- Do not ignore service-local validation when the changed files live under `services/`.

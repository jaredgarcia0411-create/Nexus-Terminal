---
name: nexus-review
description: >
  Review Nexus Terminal implementation work against the active handoff or a requested scope. Use
  when the user wants a compliance review, a ship-readiness recommendation, or a check for missed
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
5. Run validation that matches the review scope:
   - Code or behavior changes: `npm run lint`, `npx tsc --noEmit`, and `npm test`.
   - Workflow docs or repo-maintained skills: `npm run workflow:audit`.
   - `services/` changes: `npm run typecheck:services` in addition to relevant root checks.
   - Docs-only planning changes can skip lint/typecheck/tests when no executable code changed, but still run `npm run workflow:audit` if workflow docs or skills changed.
6. Report findings in a strict structure:
   - **Spec Compliance** — pass / miss per step when a spec exists
   - **Acceptance Criteria** — pass / miss per criterion
   - **Issues Found** — severity, file path, concern, suggested fix
   - **Validation** — pass / fail / skipped with reason for each relevant command
   - **Verdict** — `READY TO SHIP` or `NEEDS FIXES` as a chat recommendation only
7. Do not write the verdict into `HANDOFF.md` or mark a spec final-reviewed unless Jared explicitly asks for that handoff status change.

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
- Do not treat a clean review or passing validation as permission to update handoff ship status.
- Do not ignore `npm run typecheck:services` when the changed files live under `services/`.

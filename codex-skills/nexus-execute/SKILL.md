---
name: nexus-execute
description: >
  Execute Nexus Terminal HANDOFF.md specs, named phases, or checkpointed implementation work.
  Use when the user asks to run an active handoff, begin or resume a phase, execute ordered
  implementation steps, or stop at a review/commit checkpoint.
---

# Nexus Execute

Use this skill for phase-gated implementation in Nexus Terminal. It is for doing the work,
not just planning it.

## Workflow

1. Read `AGENTS.md` and `HANDOFF.md` first.
2. Decide whether `HANDOFF.md` is active, parked, or unrelated to the user's request.
   - If unrelated, say so briefly and use live repo context.
   - If active and relevant, follow the specified order.
3. Confirm the requested boundary.
   - Execute only the named phase, step range, or checkpoint the user opened.
   - If the user says to stop at a checkpoint, treat that as a hard stop.
   - If earlier phases are already marked complete, do not reopen them unless the user asks.
4. Verify the spec against the live repo before editing.
   - Check file paths, function names, routes, migrations, tests, and commands.
   - If a handoff step is stale but harmless, treat it as a no-op and note why.
   - If a stale step changes behavior or creates risk, stop and ask before deviating.
5. Implement narrowly.
   - Preserve existing architecture and local patterns.
   - Keep unrelated cleanup out of scope.
   - Update `HANDOFF.md` only when the spec requires checkpoint evidence or the user asks for a status/handoff edit.
   - Do not mark a spec `READY TO SHIP`, `reviewed against spec`, or otherwise final-reviewed unless Jared explicitly instructs that status; successful validation is implementation evidence, not review approval.
6. Validate for the changed scope.
   - Code or behavior changes: `npm run lint`, `npx tsc --noEmit`, and `npm test`.
   - `services/` changes: also run `npm run typecheck:services`.
   - Workflow assets or `HANDOFF.md`: run `npm run workflow:audit`.
   - If browser/dev-server smoke is blocked by sandbox limits, say so and leave the gap explicit.
7. Stop at the requested boundary.
   - Do not continue into the next phase without explicit user approval.
   - Do not commit or push unless the user explicitly asks, usually via `$nexus-commit`.

## Output

Keep progress updates tied to concrete files, commands, or validation. Final responses should include:

- what phase or checkpoint was completed
- files changed
- validation results
- any skipped checks with reasons
- whether the next phase remains unopened
- whether `HANDOFF.md` was left for Jared/Claude review instead of being marked ready to ship

## Do Not

- Do not trust `HANDOFF.md` blindly when live files disagree.
- Do not broaden a phase into adjacent parked work.
- Do not claim browser verification unless it actually ran.
- Do not update setup docs or durable workflow rules unless the task changes them.

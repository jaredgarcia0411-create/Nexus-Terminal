---
name: nexus-handoff
description: >
  Prepare or refresh Nexus Terminal HANDOFF.md implementation specs. Use when planning a feature,
  turning an approved plan into an executable spec, cleaning stale handoff sections, or syncing
  AGENTS.md and HANDOFF.md to live repo reality.
---

# Nexus Terminal Handoff

This skill exists to produce self-contained implementation plans that another execution agent can follow without guessing.

## Before Writing

1. Read `AGENTS.md` and `HANDOFF.md`.
2. Read the actual source files relevant to the requested change.
3. Verify every file path, function name, export, route, and dependency you mention against the live codebase.
4. Separate observed current state from proposed changes.

## What Good Output Looks Like

Write or update a section in `HANDOFF.md` with:

- A clear section title
- Generated date and current implementation status
- Objective
- Current state with exact file paths
- Required changes grouped into ordered steps
- Per-file actions: create, modify, or delete
- Acceptance criteria that are concrete and testable
- Testing requirements: `npm run lint`, `npx tsc --noEmit`, `npm test`, plus `npm run workflow:audit` for workflow docs/skills and `npm run typecheck:services` for `services/` changes
- Security notes when auth, secrets, or external integrations are involved
- Order of operations
- Complexity estimate

## After Writing

Re-verify the finished spec against the live codebase before handing it off — treat the draft as a hypothesis, not a finished spec. For every change confirm: anchors (paths + line numbers) still match; every symbol it references exists and is in scope (distinguish local functions from imports — never instruct removing an "import" that is a local function or still used elsewhere); field names in snippets match the real data shape (external API keys, DB rows); downstream readers of anything changed won't silently break (grep for them, or document the degradation); removals leave no unused symbols. Fix any drift in the spec and note what changed.

## Maintenance Rules

- Keep `HANDOFF.md` focused on active or recently completed work that still matters.
- When asked to clean it up, compress or remove stale completed sections and keep a brief note that older detail lives in git history.
- Update `AGENTS.md` only for durable workflow or architecture guidance, not one-off task trivia.
- Do not mark completed implementation as `READY TO SHIP`, `reviewed against spec`, or final-reviewed unless Jared explicitly asks for that status. Use neutral implementation/validation status until Jared/Claude review is complete.

## Spec Rules

- Assume the next execution agent has no project memory.
- Name the exact files to touch.
- State why the order matters when there are dependencies.
- Call out risks, especially around auth, SSE routes, database access, or expensive third-party APIs.
- Do not invent missing files or abstractions to make a plan look cleaner.

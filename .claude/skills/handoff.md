---
name: handoff
description: "Prepare a handoff for opencode to execute: $ARGUMENTS"
user_invocable: true
---

# Handoff Skill

Generate a Build Spec for opencode to execute. Read the codebase to understand current state, then produce a self-contained spec.

## Steps

1. Read `.claude/CLAUDE.md` for architecture context
2. Read all files relevant to the requested change
3. Verify that every file path, function name, and import you reference actually exists (use Glob/Grep)
4. Produce the spec in the format below
5. Write the spec to `HANDOFF.md` in the project root

## Build Spec Format

```markdown
# Build Spec — [Feature or Change Name]
> Generated: [date] | Skill: handoff
> Status: PENDING REVIEW — do not execute until approved

## Objective
[1-2 sentences: what this accomplishes and why]

## Current State
[Relevant files and code as they exist now, with exact paths]

## Required Changes

### Change 1: [Short title]
- **File:** path/to/file.ts
- **Action:** CREATE | MODIFY | DELETE
- **What to do:** [Specific instructions — what to add/change/remove and why]
- **Acceptance Criteria:**
  - [ ] [Testable condition]
  - [ ] [Testable condition]
- **Depends on:** [Other changes this needs completed first, or "none"]

### Change 2: [Short title]
...

## Files Affected
| File | Action | Risk |
|------|--------|------|

## Testing
- [ ] `npm run lint` passes
- [ ] `npx tsc --noEmit` passes
- [ ] [Feature-specific checks]

## Security
[Auth, injection, data exposure concerns — or "No new security surface"]

## Order of Operations
1. [Step opencode should do first]
2. [Step opencode should do second]
...

## Complexity
[LOW / MEDIUM / HIGH — with one-line rationale]
```

## Rules

- Every file path must be verified against the live codebase before including it
- Every import must reference an export that actually exists
- Specs must be self-contained — assume opencode has zero project context
- Include exact function signatures and type definitions when modifying existing code
- If the change touches auth, token handling, or env vars, add a Security section with specific risks

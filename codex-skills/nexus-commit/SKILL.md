---
name: nexus-commit
description: >
  Safe Nexus Terminal commit and push workflow. Use only when the user explicitly asks to create
  a commit or publish the current branch.
---

# Nexus Terminal Commit

Use this skill only when the user explicitly asks for a commit or push. The repo default still applies: do not create commits unless asked.

Treat this skill as the canonical commit workflow for Nexus Terminal. Any user-facing `commit` alias should defer to this process rather than maintain a second copy of the rules.

## Workflow

1. Review scope before touching git state.
   - Run `git status --short`, `git diff --stat`, `git diff`, and `git log --oneline -5`.
   - If the worktree mixes unrelated changes, commit only the requested scope. Ask before bundling unrelated work into one commit.
2. Enforce validation before commit.
   - Match validation to the changed scope:
     - Code or behavior changes: `npm run lint`, `npx tsc --noEmit`, and `npm test`.
     - Workflow docs or repo-maintained skills: `npm run workflow:audit`.
     - `services/` changes: `npm run typecheck:services` in addition to the relevant root checks.
   - If those validations were already run after the current edits and passed, do not rerun them just for the commit. Confirm the tree still matches the reviewed scope, then stage and commit.
   - If a command fails, fix the issue before committing.
3. Stage intentionally.
   - Prefer explicit `git add <paths>` when the worktree is mixed.
   - Never stage `.env*`, credentials, `.next/`, or other obvious local-only artifacts.
   - Treat ad hoc scratch notes, one-off reports, and tool-specific historical artifacts as opt-in commit material, not default commit material.
4. Write the message to match repo style.
   - Use `$ARGUMENTS` as a hint if provided; otherwise derive the message from the diff.
   - Keep the subject concise, imperative, and focused on why the change exists.
5. Commit safely.
   - Create a normal commit.
   - If a hook fails, fix the issue and retry. Do not bypass hooks.
6. Push safely.
   - If the user asked only for a local commit, stop after the commit.
   - Otherwise push the current branch to its remote.
   - If no upstream exists, push with upstream tracking.
   - Never force-push unless explicitly instructed.
7. Confirm the result.
   - Run `git status --short` after the commit or push.
   - Report the commit SHA, message, branch, whether upstream was set, and whether the working tree is clean.

## Repo-Specific Guardrails

- Do not rewrite or squash existing commits unless explicitly asked.
- If the change touched workflow docs or repo-maintained skills, make sure `HANDOFF.md` and any relevant `AGENTS.md` guidance are updated before committing.
- Never include secrets or local-only env files.

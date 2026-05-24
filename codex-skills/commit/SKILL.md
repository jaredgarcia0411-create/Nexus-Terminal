---
name: commit
description: >
  Commit and optionally push Nexus Terminal changes. Use when the user types /commit or otherwise
  explicitly asks to stage, commit, or says to push origin main. This is the user-facing alias for
  the canonical nexus-commit workflow.
---

# Commit

Use this skill only when the user explicitly asks for a commit or push. Default to a local commit; publish only when the user explicitly says to push origin main.

## Workflow

1. Read `../nexus-commit/SKILL.md` before touching git state.
2. Follow the `nexus-commit` workflow exactly:
   - review repo state and commit scope first
   - run required validation before committing
   - stage intentionally
   - write a concise message focused on why the change exists
   - commit safely without bypassing hooks
   - push only when the user explicitly says to push origin main
   - confirm the resulting git state
3. Use any supplied arguments only as a commit message hint. If no hint is provided, derive the message from the diff.
4. If the worktree includes unrelated changes, keep the commit scoped to the requested work and ask before bundling unrelated changes together.

## Guardrails

- Treat `nexus-commit` as the source of truth for validation and safety rules.
- Do not bypass hooks.
- Do not push unless the user explicitly says to push origin main.
- Do not force-push unless explicitly instructed.
- Never stage `.env*`, credentials, `.next/`, or other local-only artifacts.

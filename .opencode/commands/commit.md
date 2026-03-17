---
description: Stage, commit, and push current changes
agent: executor
---

Stage, commit, and push the current changes.

Use `$ARGUMENTS` as a commit message hint if it is provided. If no message hint is provided, draft one from the diff.

1. Run `git status`, `git diff`, and `git log --oneline -5` to review the repo state and match commit style.
2. Stage all intended project changes for this branch, but never stage `.env*`, credentials, or obvious secret files.
3. Write a concise commit message focused on why the change exists.
4. Create the commit.
5. If a hook fails, fix the issue and create a new commit attempt. Do not bypass hooks.
6. Push the current branch to its remote. If no upstream exists yet, push with upstream tracking.
7. Never force-push unless explicitly instructed.
8. Run `git status` after the push and report the commit message, branch pushed, and whether the working tree is clean.

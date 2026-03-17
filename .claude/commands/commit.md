Stage, commit, and push the current changes.

Use `$ARGUMENTS` as a commit message hint if it is provided. If no message hint is provided, draft one from the diff.

## Process

### Step 1: Review the repo state

Before changing git state:

1. Run `git status` to see tracked and untracked changes.
2. Run `git diff` to inspect both staged and unstaged work.
3. Run `git log --oneline -5` to match the repo's commit message style.

### Step 2: Stage and commit safely

1. Stage all intended project changes for this branch, but never stage `.env*`, credentials, or obvious secret files.
2. Write a concise commit message focused on **why** the change exists, not just **what** changed.
3. Create the commit.
4. If a hook fails, fix the issue and create a new commit attempt. Do not bypass hooks.

### Step 3: Push the branch

1. Push the current branch to its remote.
2. If the branch has no upstream yet, push with upstream tracking.
3. Never force-push unless explicitly instructed.

### Step 4: Confirm the result

1. Run `git status` after the push.
2. Report:
   - the commit message used
   - the branch that was pushed
   - whether the working tree is clean afterward

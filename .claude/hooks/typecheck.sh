#!/bin/bash
# Type-check once at end of turn (Stop event) instead of after every edit.
# Only runs if .ts / .tsx files were modified since the last commit.

cd "$CLAUDE_PROJECT_DIR" || exit 0

# Skip if no TS files changed (staged, unstaged, or untracked).
CHANGED=$(git status --porcelain 2>/dev/null | grep -E '\.(ts|tsx)$')
[ -z "$CHANGED" ] && exit 0

OUTPUT=$(npx tsc --noEmit 2>&1)
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
  echo "$OUTPUT" | head -30 >&2
  echo "TypeScript errors found — fix before continuing." >&2
fi

exit 0

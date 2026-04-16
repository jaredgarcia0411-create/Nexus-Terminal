#!/bin/bash
# Type-check once at end of turn (Stop event) instead of after every edit.
# Only runs if .ts / .tsx files were modified since the last commit.

set -euo pipefail

cd "$CLAUDE_PROJECT_DIR" || exit 0

# Skip if no TS files changed (staged, unstaged, or untracked).
CHANGED=$(git status --porcelain 2>/dev/null | grep -E '\.(ts|tsx)$' || true)
[ -z "$CHANGED" ] && exit 0

if ! OUTPUT=$(npx tsc --noEmit 2>&1); then
  echo "$OUTPUT" | head -30 >&2
  echo "TypeScript errors found — fix before continuing." >&2
fi

if echo "$CHANGED" | awk '{print $NF}' | grep -q '^services/'; then
  if ! SERVICES_OUTPUT=$(npm run typecheck:services 2>&1); then
    echo "$SERVICES_OUTPUT" | head -30 >&2
    echo "Service TypeScript errors found — fix before continuing." >&2
  fi
fi

exit 0

#!/bin/bash
# Warn before running database migrations.
# Forces Claude to ask for permission before destructive schema commands.

set -euo pipefail

if ! command -v node >/dev/null 2>&1; then
  echo "Warning: node is unavailable, skipping migration guard." >&2
  exit 0
fi

INPUT=$(cat)
COMMAND=$(
  printf '%s' "$INPUT" | node -e '
    let input = "";
    process.stdin.on("data", (chunk) => {
      input += chunk;
    });
    process.stdin.on("end", () => {
      try {
        const parsed = JSON.parse(input);
        const value = parsed?.tool_input?.command;
        if (typeof value === "string") {
          process.stdout.write(value);
        }
      } catch {}
    });
  '
)

if echo "$COMMAND" | grep -qE '(db:migrate(:raw)?|db:push|drizzle-kit (push|migrate))'; then
  REASON="Database migration detected: '$COMMAND'. Confirm this is intentional before continuing."
  echo "$REASON" >&2
  node -e '
    const reason = process.argv[1];
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: reason,
      },
    }, null, 2));
  ' "$REASON"
  exit 0
fi

exit 0

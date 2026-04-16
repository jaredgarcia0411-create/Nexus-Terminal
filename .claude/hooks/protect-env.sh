#!/bin/bash
# Block Claude from writing to .env files.
# These must always be edited manually for security.

set -euo pipefail

if ! command -v node >/dev/null 2>&1; then
  echo "Warning: node is unavailable, skipping env guard." >&2
  exit 0
fi

INPUT=$(cat)
FILE_PATH=$(
  printf '%s' "$INPUT" | node -e '
    let input = "";
    process.stdin.on("data", (chunk) => {
      input += chunk;
    });
    process.stdin.on("end", () => {
      try {
        const parsed = JSON.parse(input);
        const value = parsed?.tool_input?.file_path;
        if (typeof value === "string") {
          process.stdout.write(value);
        }
      } catch {}
    });
  '
)

if [[ "$FILE_PATH" =~ (^|/)\.env(\.local|\.production|\.development)?$ ]]; then
  REASON="Blocked: Cannot edit $FILE_PATH - environment files must be edited manually for security."
  echo "$REASON" >&2
  node -e '
    const reason = process.argv[1];
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }, null, 2));
  ' "$REASON"
  exit 0
fi

exit 0

#!/bin/bash
# Block deleting package-lock.json - it pins exact dependency versions.
# Deleting it lets `npm install` drift deps to newer matching versions,
# which once broke lint during a Node upgrade. Use `npm ci` to reinstall.

set -euo pipefail

if ! command -v node >/dev/null 2>&1; then
  echo "Warning: node is unavailable, skipping lockfile guard." >&2
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

# Match an `rm` command that targets package-lock.json (any path prefix).
if [[ "$COMMAND" =~ rm[[:space:]].*package-lock\.json ]]; then
  REASON="Blocked: never delete package-lock.json - it pins exact dependency versions and deleting it drifts deps (once broke lint during a Node upgrade). To reinstall reproducibly, run 'npm ci'."
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

#!/bin/bash
# Warn before running database migrations
# Forces Claude to ask for permission before any migration command

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if echo "$COMMAND" | grep -qE '(db:migrate|db:push|drizzle-kit push|drizzle-kit migrate)'; then
  REASON="Database migration detected: '$COMMAND'. Migrations can be destructive — confirm this is intentional."
  echo "$REASON" >&2
  jq -n \
    --arg reason "$REASON" \
    '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: $reason
      }
    }'
  exit 0
fi

exit 0

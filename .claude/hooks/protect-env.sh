#!/bin/bash
# Block Claude from writing to .env files
# These must always be edited manually for security

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [[ "$FILE_PATH" =~ \.env(\.local|\.production|\.development)?$ ]]; then
  REASON="Blocked: Cannot edit $FILE_PATH — environment files must be edited manually for security."
  echo "$REASON" >&2
  jq -n \
    --arg reason "$REASON" \
    '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: $reason
      }
    }'
  exit 0
fi

exit 0

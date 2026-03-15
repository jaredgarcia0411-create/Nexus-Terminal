#!/bin/bash
# Auto type-check after editing TypeScript files
# Runs npx tsc --noEmit and reports errors back to Claude

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Only type-check TypeScript files
if [[ "$FILE_PATH" =~ \.(ts|tsx)$ ]]; then
  cd "$CLAUDE_PROJECT_DIR" || exit 0
  OUTPUT=$(npx tsc --noEmit 2>&1)
  EXIT_CODE=$?

  if [ $EXIT_CODE -ne 0 ]; then
    echo "$OUTPUT" | head -30 >&2
    echo "TypeScript errors found — fix before continuing." >&2
  fi
fi

exit 0

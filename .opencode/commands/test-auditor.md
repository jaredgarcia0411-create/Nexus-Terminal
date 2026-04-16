---
description: Audit the codebase for test coverage gaps, anti-patterns, and testing improvements.
agent: executor
---

Load the `test-auditor` skill and follow its workflow.

When invoked, parse the scope argument:
- No argument → Full codebase audit
- `routes` → API route tests only
- `lib` → Library tests only  
- `hooks` → Hook tests only
- `component` → Component tests only
- Any path → Specific file/directory

Execution rules:
1. Build the file inventory locally before deciding whether delegation helps.
2. Delegate only when the scope is large enough to benefit from parallel review.
3. Save a report in `.opencode/reports/` only when the user explicitly asks for a durable artifact.
4. Present findings first in chat, ordered by severity, then summarize quick wins.

For focused audits, recommend specific scopes:
- "Run `/test-auditor routes` to audit API routes"
- "Run `/test-auditor lib/parsers` to audit parser tests"

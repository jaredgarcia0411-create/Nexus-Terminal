---
description: Audit the codebase for test coverage gaps, anti-patterns, and testing improvements.
agent: build
---

Load the `test-auditor` skill and follow its workflow.

When invoked, parse the scope argument:
- No argument → Full codebase audit
- `routes` → API route tests only
- `lib` → Library tests only  
- `hooks` → Hook tests only
- `component` → Component tests only
- Any path → Specific file/directory

Then follow the skill instructions:
1. Launch 3 subagents in parallel (inventory, pattern analysis, quality review)
2. Create audit report in `.opencode/reports/`
3. Present summary with key findings in chat
4. Show critical issues and quick wins

Always save reports to `.opencode/reports/test-audit-{scope}-{timestamp}.md`.

For focused audits, recommend specific scopes:
- "Run `/test-auditor routes` to audit API routes"
- "Run `/test-auditor lib/parsers` to audit parser tests"

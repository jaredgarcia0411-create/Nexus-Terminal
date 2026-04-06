---
name: nexus-workflow-audit
description: >
  Audit Nexus Terminal workflow assets for drift against the live codebase. Use when reviewing
  AGENTS.md, HANDOFF.md, Claude commands/agents/skills, Codex skill sources, or other repo
  workflow docs and prompts for stale references, broken assumptions, or duplicate guidance.
---

# Nexus Terminal Workflow Audit

This is a read-only audit unless the user explicitly asks for fixes.

## Audit Targets

- `AGENTS.md`
- `HANDOFF.md`
- `.claude/agents/`
- `.claude/commands/`
- `.claude/skills/`
- `.opencode/agents/`
- Repo-maintained Codex skill sources, if present

## Method

1. Verify file paths, commands, counts, env vars, route examples, and architecture claims against the live repo.
2. Flag stale references to deleted systems or superseded patterns.
3. Check for duplicate instructions that now diverge across tool stacks.
4. Distinguish:
   - Critical: wrong guidance that can cause bad work
   - Medium: misleading or stale guidance
   - Low: cosmetic drift or cleanup
   - Clean: areas that still match reality

## Expected Findings Format

For each finding, provide:

- Severity
- File path
- Stale or incorrect claim
- What the live codebase shows instead
- Exact fix to apply

## Typical Drift To Check

- Deleted Jarvis or Schwab references
- Old auth or hook patterns
- Wrong validation helpers or test commands
- Mismatches between `HANDOFF.md`, `AGENTS.md`, and repo structure
- Prompts that assume tools or subagents that do not exist in the current environment


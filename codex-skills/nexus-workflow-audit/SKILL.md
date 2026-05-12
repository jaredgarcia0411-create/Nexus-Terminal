---
name: nexus-workflow-audit
description: >
  Audit Nexus Terminal Codex workflow assets for drift against the live codebase. Use when
  reviewing AGENTS.md, HANDOFF.md, repo-maintained Codex skills, agent metadata, or other
  Codex harness docs for stale references, broken assumptions, or duplicate guidance.
---

# Nexus Terminal Workflow Audit

This is a read-only audit unless the user explicitly asks for fixes.

## Audit Targets

- `AGENTS.md`
- `HANDOFF.md`
- `codex-skills/**/SKILL.md`
- `codex-skills/*/agents/openai.yaml`
- Repo-maintained Codex reference docs under `codex-skills/**/references/`, if present
- Installed copies under `~/.codex/skills/<skill-name>` when the user asks for live harness alignment

Ignore `.claude/` and `.opencode/` unless the user explicitly asks for cross-tool alignment.

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
- Stale `.claude` or `.opencode` references left inside Codex-facing docs
- Repo-vs-installed skill drift for live Codex skills
- Prompts that assume tools or subagents that do not exist in the current environment

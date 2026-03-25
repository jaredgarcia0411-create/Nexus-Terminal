---
description: Execute current HANDOFF spec
agent: executor
---

Read HANDOFF.md in the project root in full. Do not begin implementation yet.

Before you summarize, decide whether subagents are warranted.

Use subagents logically when they improve speed or reduce risk. Default to **no subagents** for small, single-file, low-risk work. Use **1-3 subagents** when the work is multi-file, has distinct concerns, or needs independent verification.

Good reasons to spawn subagents:
- The HANDOFF touches 3+ files or multiple subsystems
- The work mixes UI, state, API, database, or testing concerns
- You need one pass for codebase review and another for validation/risk review
- There are ambiguous dependencies or likely regressions to audit before editing

Recommended subagent split when useful:
1. **Codebase review subagent** — read the relevant files, confirm current behavior, and flag hidden dependencies
2. **Validation/risk subagent** — identify edge cases, regression risks, and tests/manual checks needed
3. **Optional focused subagent** — only for isolated research on a separate concern

Subagent rules:
- Keep subagent tasks read-only unless the task is explicitly partitioned and non-overlapping
- Do not delegate the same files to multiple writing agents
- Merge subagent findings into one implementation plan before asking for approval
- If the work is straightforward, skip subagents and proceed directly

Summarize back to me:
1. The objective of this spec
2. The ordered list of changes you will make
3. Every file you will create, modify, or delete
4. Any risks or ambiguities you see before starting
5. Whether you used subagents, and if so, what each one found

Wait for my approval. After I approve, implement in the exact order listed.

After all changes are complete, run these three commands and report the result of each:
- npm run lint
- npx tsc --noEmit
- npm test

Do not mark the task complete until all three pass.

If the implementation is medium/high risk or spans multiple files, do one final subagent review after coding and before reporting completion. That review should check for missed edge cases, obvious regressions, and whether the implementation matches the HANDOFF spec.

After validation passes, update HANDOFF.md to check off completed tasks (including visual-check validation items when performed).

If a section is fully complete, compress it to save space:
- remove step-by-step implementation instructions,
- remove the original Execution Checklist block,
- keep a concise section-level summary of what was delivered,
- set section status to complete.

If a section is not complete, keep the detailed instructions and checklist intact.

Update README.md if needed to reflect any significant changes to the project.

Prepare a handoff for Codex to execute: $ARGUMENTS

## Process

### Step 1: Clean up completed work

Read `HANDOFF.md`. Remove any sections where all acceptance criteria are checked off and the status is IMPLEMENTED or COMPLETED. Keep only:
- Active specs (status: PLANNED, IN PROGRESS, or OPEN)
- Blockers that haven't been resolved
- The "Session Maintenance Checklist" section header (update its items)

If removing completed sections, add a one-liner at the top noting they were archived:
> Historical completed sections were removed to keep this file focused. Use git history and the `specs/` directory for archived implementation detail.

### Step 2: Investigate the codebase and write the spec yourself

Investigate the task in $ARGUMENTS directly: read all relevant source files, trace the data flow, and confirm the current state before drafting. Then write the spec inline.

Do NOT spawn nexus-architect to reformat findings you already have — that wastes a cold sub-agent on context you're holding. Only consider invoking nexus-architect when the task genuinely needs broad fan-out exploration across an unfamiliar area you haven't already covered, and say so before doing it. Default is inline.

The spec MUST follow this format for every change:
- **File:** exact path (e.g., `lib/research.ts`)
- **Action:** CREATE, MODIFY, or DELETE
- **Step-by-step instructions** numbered, with:
  - Exact line numbers or anchor points ("after the `import` block", "replace lines 45-52")
  - What to import and from where
  - Code snippets for non-trivial additions
  - What the expected behavior should be after the change
- **Acceptance criteria** as a checklist (`- [ ]`) that Codex can verify

Leave ZERO ambiguity. Codex should be able to implement without asking questions.

### Step 3: Write the spec to HANDOFF.md

Append the new spec to `HANDOFF.md` with:
- A `## Section Title` header
- `> Generated: {date} | Author: Claude (plan)`
- `> Status: PLANNED`
- The full spec from Step 2
- A "Files Changed Summary" table (file, lines added/removed, risk level)
- A "Verification Steps" section (lint, type-check, test commands + manual checks)
- An "Implementation Style" section, included verbatim in every spec:

  ```markdown
  ## Implementation Style

  Write the simplest correct code that satisfies this spec. Specifically:

  - Match the existing conventions in the file you're editing. Do not introduce new patterns, helpers, abstractions, or file layouts unless this spec explicitly calls for them.
  - No future-proofing. No feature flags, no "in case we need it later" parameters, no extracted helpers that have a single caller. If a value is only used once, inline it.
  - No defensive code at internal boundaries. Trust your own code and framework guarantees; validate only at system boundaries (user input, external APIs, DB reads of untrusted JSON).
  - No comments unless the *why* is non-obvious (a hidden constraint, a workaround, a surprising invariant). Don't restate what the code says.
  - If a step in this spec looks more complex than it needs to be, flag it and propose the simpler version before implementing — don't silently "improve" the spec, but don't write code that's more elaborate than the problem requires either.
  - If you spot an existing simpler pattern in the codebase that fits, use it instead of writing new code.

  This is a personal trading platform built solo. Readability > cleverness; debuggable > elegant; small diff > sweeping refactor. Three similar lines beats a premature abstraction.
  ```

### Step 4: Sanity-check the spec against the live codebase

ALWAYS do this before declaring the spec ready. Treat the first draft as a hypothesis, not a finished spec — this step routinely finds real bugs, so budget for it. Re-open the actual files and, for every change in the spec, verify against the live repo:

- **Anchors:** file paths and line numbers still match (line numbers drift — prefer stable anchors, but confirm them).
- **Symbols exist and are in scope:** every helper, import, or type the spec's code calls is actually defined and reachable at that location. Distinguish local functions from imports — never tell Codex to "remove the import" for something that is a local function or still used elsewhere.
- **Field names match the real shape:** keys in code snippets match the actual data (e.g. an external API's response fields, a DB row), not assumed names.
- **Downstream consumers won't silently break:** grep for everything that reads the field/function/endpoint you're changing and confirm it still works — or document the degradation explicitly.
- **No orphans:** removing code leaves no unused imports/symbols (the build errors on these).

Fix any drift directly in the spec and note what changed. If the spec was authored by nexus-architect, this verification is still yours to run.

### Step 5: Update AGENTS.md if needed

If the plan introduces new files, API routes, conventions, or patterns, update `AGENTS.md` so future agents know about them. Don't update for minor changes.

### Step 6: Confirm

Show me a summary of:
- What was cleaned up from HANDOFF.md
- What the new spec covers (1-2 sentences)
- What the sanity-check (Step 4) found and fixed
- Number of files to change and estimated risk
- Any open questions or decisions I need to make before Codex starts

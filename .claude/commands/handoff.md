Prepare a handoff for Codex to execute: $ARGUMENTS

## Process

### Step 1: Clean up completed work

Read `HANDOFF.md`. Remove any sections where all acceptance criteria are checked off and the status is IMPLEMENTED or COMPLETED. Keep only:
- Active specs (status: PLANNED, IN PROGRESS, or OPEN)
- Blockers that haven't been resolved
- The "Session Maintenance Checklist" section header (update its items)

If removing completed sections, add a one-liner at the top noting they were archived:
> Historical completed sections were removed to keep this file focused. Use git history and the `specs/` directory for archived implementation detail.

### Step 2: Invoke nexus-architect to plan

Use the Agent tool with `subagent_type: "nexus-architect"` to:
1. Understand the current state of the task described in $ARGUMENTS
2. Read all relevant source files
3. Produce a step-by-step implementation spec

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
- `> Generated: {date} | Agent: nexus-architect`
- `> Status: PLANNED`
- The full spec from Step 2
- A "Files Changed Summary" table (file, lines added/removed, risk level)
- A "Verification Steps" section (lint, type-check, test commands + manual checks)

### Step 4: Update AGENTS.md if needed

If the plan introduces new files, API routes, conventions, or patterns, update `AGENTS.md` so future agents know about them. Don't update for minor changes.

### Step 5: Confirm

Show me a summary of:
- What was cleaned up from HANDOFF.md
- What the new spec covers (1-2 sentences)
- Number of files to change and estimated risk
- Any open questions or decisions I need to make before Codex starts

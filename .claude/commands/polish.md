Perform a final polish pass on the current changes: $ARGUMENTS

If no specific focus is given, polish the full working tree.

## Goal

Tighten the current work before commit without drifting into a refactor.

## Process

### Step 1: Review the changes

1. Inspect the current diff and identify small, high-value fixes.
2. Focus on bugs, edge cases, naming clarity, consistency, dead code, and awkward UX copy.
3. Do not change architecture or refactor broadly unless a clear defect requires it.

### Step 2: Run the right checks

1. Run `npm run lint`.
2. Run `npx tsc --noEmit`.
3. Run `npm test` when code changed or when the touched area has meaningful risk.
4. If the changes touch auth, API routes, secrets, user input, or external requests, also do a lightweight security pass.

### Step 3: Fix only what matters

1. Resolve issues found by the checks.
2. Make only small, high-confidence improvements.
3. Keep behavior aligned with the current spec and existing conventions.

### Step 4: Report succinctly

Report:
- what you polished
- what checks you ran and whether they passed
- any concerns left for follow-up

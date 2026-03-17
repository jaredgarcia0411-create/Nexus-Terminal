Review the implementation against the spec: $ARGUMENTS

## Process

### Step 1: Load the spec

Read `HANDOFF.md` and find the section matching $ARGUMENTS. If no arguments given, review the most recent PLANNED or IN PROGRESS section.

### Step 2: Audit the implementation

Use the Agent tool with `subagent_type: "nexus-architect"` to:

1. Read every file listed in the spec's "Files Changed Summary"
2. Compare what was built against every numbered step in the spec
3. Verify each acceptance criterion — does the code actually satisfy it?
4. Check for:
   - **Missed items** — steps that weren't implemented
   - **Drift** — implementation that diverged from the spec (intentional or not)
   - **Side effects** — changes that touch files not in the spec
   - **Type safety** — any `any` types, missing error handling, or loose typing
   - **Security** — secrets exposed, missing auth checks, unvalidated input

### Step 3: Run validation

Run in order:
1. `npm run lint`
2. `npx tsc --noEmit`
3. `npm test`

If the spec involves `services/schwab-relay`, also run:
4. `cd services/schwab-relay && npx tsc --noEmit`
5. `cd services/schwab-relay && npm run build`

### Step 4: Report

Present findings as:

**Spec Compliance:**
- [x] Step 1 — description (PASS)
- [ ] Step 3 — description (MISS — what's wrong)

**Acceptance Criteria:**
- [x] Criterion 1
- [ ] Criterion 2 — what failed

**Issues Found:**
- severity (HIGH/MED/LOW) — description, file:line

**Validation:**
- Lint: PASS/FAIL
- Types: PASS/FAIL
- Tests: PASS/FAIL

**Verdict:** READY TO SHIP / NEEDS FIXES (list what)

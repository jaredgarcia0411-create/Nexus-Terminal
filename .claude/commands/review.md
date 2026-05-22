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

If the spec touches anything under `services/`, also run the service-local build/test scripts (check the service's `package.json` or `Dockerfile`).

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

### Step 5: Condense HANDOFF.md (only if verdict is READY TO SHIP)

If the verdict is **NEEDS FIXES**, skip this step — leave the active spec in place so the next pass has the full instructions.

If the verdict is **READY TO SHIP**, replace the active spec section in `HANDOFF.md` with a short summary entry under "Recently Completed", matching the existing entries' shape:

```markdown
### {Spec Title}

Status: completed {YYYY-MM-DD}.

Outcome:
- {1–3 bullets: what shipped, in one line each}

Validation:
- {one line per validation gate that passed, e.g., `npm run lint`, `npx tsc --noEmit`, `npm test`}
- {manual smoke results in one line, if any}
```

Rules:
- Preserve the "Open Follow-Ups" section verbatim — only the just-completed active spec is condensed.
- Preserve the "Session Maintenance" section verbatim.
- If there's a "Notes for Codex" subsection inside the active spec, drop it — it's no longer relevant once shipped.
- Keep the condensed entry under ~12 lines. Detail lives in git history; this file is for active context.
- After editing, run `npm run workflow:audit` since `HANDOFF.md` is a workflow asset.

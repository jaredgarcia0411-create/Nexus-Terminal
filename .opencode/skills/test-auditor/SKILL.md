---
name: test-auditor
description: Audit the codebase test coverage and identify testing gaps, anti-patterns, and areas needing attention. Returns actionable recommendations.
---

## Command: `/test-auditor [scope]`

**Purpose**: Scan the codebase and identify test gaps, anti-patterns, and areas needing attention.

**Scope Options**:
- (none) — Full audit of all test files
- `routes` — API route tests only
- `lib` — Library/utility tests only
- `hooks` — Hook tests only
- `component` — Component tests only
- `<file-path>` — Specific file or directory

**Output**: Markdown report saved to `.opencode/reports/test-audit-{timestamp}.md`

---

## Usage Workflow

### Step 1: Parse Scope
When invoked, determine the audit scope:
- No argument → Full codebase audit
- `routes` → `app/api/**/route.ts` + `__tests__/*route*.test.ts`
- `lib` → `lib/**/*.ts` + `__tests__/*.test.ts`
- `hooks` → `hooks/**/*.ts` + `__tests__/*hook*.test.ts`
- File path → Specific file/directory

### Step 2: Delegate to Subagents (Parallel)

Launch 3 subagents simultaneously:

**Subagent 1 - Test Inventory**
```
Audit scope: "[SCOPE]"
Tasks:
1. Find all test files matching the scope
2. Identify corresponding source files
3. Calculate coverage ratio (test files / source files)
4. List untested source files

Return structured findings with file paths.
```

**Subagent 2 - Pattern Analyzer**
```
Audit scope: "[SCOPE]"
Tasks:
1. Check test files for anti-patterns:
   - Missing `vi.clearAllMocks()` in beforeEach
   - Testing implementation details instead of behavior
   - Over-mocking (mocking everything)
   - Tests with no assertions
   - Tests that don't clean up (spies not restored)
   - Duplicate test logic (can be consolidated)
2. Check for proper patterns:
   - Using vi.hoisted() + vi.mock()
   - Proper DB mocking with makeDb()
   - Auth mocking with requireUserMock
3. Note file paths and specific issues

Return findings with severity (warning/critical).
```

**Subagent 3 - Test Quality Review**
```
Audit scope: "[SCOPE]"
Tasks:
1. Review test file structure:
   - Descriptive test names (not `it('test1')`)
   - Proper describe/it nesting
   - Edge case coverage (empty inputs, error cases)
2. Check for async/await patterns
3. Identify slow tests (>1s)
4. Note good examples to reference

Return quality scores and recommendations.
```

### Step 3: Create Audit Report

**File naming**: `test-audit-{scope}-{timestamp}.md`
```
test-audit-2025-03-17.md
```

**File structure**:
```markdown
# Test Audit Report

**Scope**: [Full | Routes | Lib | Hooks | Component | Path]
**Date**: [Date]
**Test Files Found**: [N]
**Source Files**: [N]
**Coverage Ratio**: [N%]

---

## Summary

[1-2 paragraph overview of findings]

---

## Coverage Gaps

### Untested Files ([N])
| File | Reason | Priority |
|------|--------|----------|
| `lib/example.ts` | No test file found | High |

### Low Coverage Areas
- [Area]: [Details]

---

## Anti-Patterns Found

### Critical ([N])
1. **[Pattern]**: [File path] — [Description]
   - **Fix**: [Specific guidance]

### Warnings ([N])
1. **[Pattern]**: [File path] — [Description]
   - **Fix**: [Specific guidance]

---

## Good Examples (Reference These)

1. **[Pattern]**: `__tests__/example.test.ts`
   - Why it's good: [Explanation]

---

## Recommended Actions

**High Priority**:
1. [Action item]

**Medium Priority**:
1. [Action item]

**Low Priority**:
1. [Action item]

---

*To run again: `/test-auditor` or `/test-auditor [scope]`*
```

### Step 4: Present Summary

Show in chat:
```
✅ Test audit complete!

**Report saved to**: `.opencode/reports/test-audit-{scope}-{timestamp}.md`

**Key Findings**:
- [N] test files analyzed
- [N] coverage gaps identified
- [N] anti-patterns found ([N] critical)

**Top Priority**:
1. [Most critical issue]

**Quick Wins**:
1. [Easy fix with high impact]
```

---

## Audit Rules

### Coverage Detection
- Look for `.test.ts` files in `__tests__/`
- Match test files to source files by name
- Count total source files in scope

### Anti-Pattern Detection

**Critical** (will cause test failures or flakes):
- Missing `vi.clearAllMocks()` in beforeEach
- Spies not restored after tests
- Tests with no assertions

**Warning** (code smell, may cause issues):
- Testing implementation details
- Over-mocking (integration test mocked like unit)
- Duplicate test setup not extracted to helper

**Info** (style/quality):
- Non-descriptive test names
- Missing edge case coverage
- Slow tests

### Good Patterns to Highlight
- Proper use of `vi.hoisted()` + `vi.mock()`
- `makeDb()` factory pattern for DB mocking
- `requireUserMock` pattern for auth
- Edge case testing (empty arrays, nulls)

---

## File Storage

**Location**: `.opencode/reports/`
**Naming**: `test-audit-{scope}-{timestamp}.md`
**Max size**: ~1000 words (soft limit)

---

## Do Not

- Do not modify any test files
- Do not suggest deleting tests without confirmation
- Do not report on test coverage percentages (just ratios)
- Do not audit node_modules or generated files

---

## Example Invocation

**User**: `/test-auditor routes`

**You**:
```
Auditing API route tests...

Launching subagents to analyze:
- Test inventory (find all route tests)
- Pattern analysis (anti-patterns)
- Quality review (naming, structure)

[Launch 3 subagents]
```

**After subagents complete**:
```
✅ Test audit complete!

**Report saved to**: `.opencode/reports/test-audit-routes-2025-03-17.md`

**Key Findings**:
- 18 route test files analyzed
- 3 coverage gaps identified
- 7 anti-patterns found (2 critical)

**Top Priority**:
- `__tests__/market-data-route.test.ts` missing `vi.clearAllMocks()` — causes test pollution

**Quick Wins**:
- Extract duplicate DB mock setup to `makeDb()` helper
- Add edge case tests for empty symbol arrays

See full report for details.
```

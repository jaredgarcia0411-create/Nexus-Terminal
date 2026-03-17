# Subagent: Pattern Analyzer

## Task
Audit scope: "{{SCOPE}}"

## Tasks
Check test files for anti-patterns and proper patterns:

### Critical Anti-Patterns (cause test failures/flakes)
1. **Missing vi.clearAllMocks()** in beforeEach
2. **Spies not restored** after tests (console, fetch, etc.)
3. **Tests with no assertions** (no expect())
4. **Async tests missing await** on promises

### Warning Anti-Patterns (code smell)
1. **Testing implementation details**:
   - Checking mock call counts instead of outcomes
   - Testing internal function calls
   
2. **Over-mocking in integration tests**:
   - Mocking internal business logic
   - Should mock boundaries (DB, HTTP) only

3. **Duplicate test setup**:
   - Same mock setup copied across tests
   - Should extract to helper function

4. **Inconsistent mock patterns**:
   - Not using vi.hoisted() with vi.mock()
   - Mock variables not properly scoped

### Good Patterns to Note
1. **Proper vi.hoisted() + vi.mock()** usage
2. **makeDb() factory** for DB mocking
3. **requireUserMock pattern** for auth
4. **Edge case testing** (empty, null, errors)
5. **Descriptive test names** (not `it('test1')`)

## Output Format

```
## Critical Issues ([N])
1. **Missing clearAllMocks()**: `__tests__/example.test.ts:15`
   - Problem: Test pollution, flaky tests
   - Fix: Add `beforeEach(() => { vi.clearAllMocks(); })`

2. **Spy not restored**: `__tests__/example.test.ts:42`
   - Problem: Spy leaks to other tests
   - Fix: Add `spy.mockRestore()` after assertions

## Warnings ([N])
1. **Testing implementation**: `__tests__/example.test.ts:30`
   - Problem: Testing mock call count instead of outcome
   - Current: `expect(mock).toHaveBeenCalledTimes(3)`
   - Better: Test the actual response/result

2. **Over-mocking**: `__tests__/route.test.ts`
   - Problem: Mocking internal helpers, not just boundaries
   - Fix: Only mock `@/lib/db`, `@/lib/server-db-utils`

## Good Examples Found ([N])
1. **Proper DB mocking**: `__tests__/trades-route.test.ts`
   - Uses makeDb() helper
   - Proper vi.hoisted() + vi.mock() pattern
```

Be specific with file paths and line numbers where possible.

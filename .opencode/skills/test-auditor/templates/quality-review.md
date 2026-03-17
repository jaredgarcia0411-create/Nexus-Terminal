# Subagent: Quality Review

## Task
Audit scope: "{{SCOPE}}"

## Tasks
Review test quality:

### Test Structure
1. **Descriptive names** (not `it('test1')`)
2. **Proper nesting** (describe blocks group related tests)
3. **Consistent setup** (beforeEach for common setup)

### Coverage Quality
1. **Edge cases** tested:
   - Empty inputs: `[]`, `{}`, `null`, `undefined`
   - Error cases: Invalid inputs, network failures
   - Boundary values: Max/min values

2. **Happy path** covered (basic expected usage)
3. **Negative cases** covered (what should fail)

### Async Patterns
1. **Proper async/await** usage
2. **No floating promises** (all async calls awaited)
3. **Proper rejection testing**: `await expect(fn()).rejects.toThrow()`

### Test Speed
1. Identify slow tests (>1s)
2. Note tests that may need optimization

### Documentation
1. **Comments explaining "why"** not "what"
2. **JSDoc** for complex test utilities

## Output Format

```
## Test Structure Quality

### Naming (Good Examples)
1. ✓ `__tests__/csv-parser.test.ts` — "parses MM-DD-YY format"
2. ✓ `__tests__/trades-route.test.ts` — "returns 401 when unauthenticated"

### Naming (Needs Improvement)
1. ✗ `__tests__/example.test.ts:23` — "test1", "test2"
   - Fix: Use descriptive names like "filters empty rows"

## Edge Case Coverage

### Good Coverage
1. **Empty inputs**: `__tests__/indicators.test.ts`
   - Tests `sma([], 3)` returns empty array
   
2. **Null handling**: `__tests__/csv-parser.test.ts`
   - Tests null date parsing

### Missing Coverage
1. **Error cases**: `__tests__/market-data-route.test.ts`
   - Missing test for malformed JSON response

## Async Patterns

### Well Handled
1. **Proper await**: `__tests__/trades-route.test.ts:85`
   - All async operations properly awaited

### Issues Found
1. **Floating promise**: `__tests__/example.test.ts:45`
   - Promise not awaited, may cause race conditions

## Performance Notes

### Slow Tests (>1s)
1. `__tests__/jarvis-client.test.ts` — [N]ms
   - May benefit from shorter timeouts or faster mocks

### Optimization Opportunities
1. `__tests__/market-data-snapshot.test.ts` — Multiple heavy mocks
   - Consider lighter mock data
```

Note specific files and line numbers for actionable feedback.

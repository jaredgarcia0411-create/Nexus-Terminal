# Test Driven Development (TDD) Crash Course

**Researched**: March 17, 2025  
**Sources**: Wikipedia, Vitest docs, Martin Fowler's blog, Kent Beck's TDD methodology  
**Context**: General concept + how it's used in Nexus Terminal codebase  

---

## Concept Overview

Test-Driven Development (TDD) is a software development methodology where you write automated tests **before** writing the actual implementation code. It was developed by Kent Beck in the late 1990s as part of Extreme Programming.

**Why it matters**: TDD forces you to think about how your code will be used (its interface) before thinking about how it works (its implementation). This leads to better-designed, more testable code.

---

## How It Works: The Red-Green-Refactor Cycle

TDD follows a simple, repeatable 3-step cycle:

### 1. **Red** - Write a failing test
- Write a test for the next bit of functionality you want to add
- The test should fail (red) because the feature doesn't exist yet
- This proves the test is actually testing something

### 2. **Green** - Make it pass
- Write the simplest code that makes the test pass
- Hard-coding values is acceptable here - you'll clean it up later
- Goal: get to green as fast as possible

### 3. **Refactor** - Clean up
- Improve the code structure while keeping all tests passing
- Remove duplication, rename variables, extract functions
- This step is often skipped by beginners but is crucial

**Repeat** this cycle for each small piece of functionality.

---

## Code Examples

### Basic TDD Example (Vitest)

```typescript
// Step 1: Write the test (RED)
// sum.test.ts
import { expect, test } from 'vitest'
import { sum } from './sum.js'

test('adds 1 + 2 to equal 3', () => {
  expect(sum(1, 2)).toBe(3)
})

// Step 2: Write simplest code to pass (GREEN)
// sum.ts
export function sum(a: number, b: number) {
  return 3  // Hardcoded - will refactor next
}

// Step 3: Refactor
export function sum(a: number, b: number) {
  return a + b  // Now it's actually correct
}
```

### In Your Codebase

From: `__tests__/csv-parser.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { processCsvData } from '@/lib/csv-parser';

describe('processCsvData — basic FIFO pairing', () => {
  it('pairs a single long round-trip into one trade', () => {
    const rows = [
      { Symbol: 'AAPL', Side: 'MARGIN', Qty: '100', Price: '150.00', ... },
      { Symbol: 'AAPL', Side: 'S', Qty: '100', Price: '155.00', ... },
    ];

    const result = processCsvData(rows as Record<string, string>[], dateInfo);

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].symbol).toBe('AAPL');
    expect(result.trades[0].pnl).toBeCloseTo(500.0 - 2.0 - 0.2);
  });
});
```

From: `__tests__/indicators.test.ts` - Edge case testing

```typescript
describe('sma', () => {
  it('returns null warmup slots and rolling means', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it('handles edge periods and empty input', () => {
    expect(sma([], 3)).toEqual([]);
    expect(sma([1, 2, 3], 0)).toEqual([null, null, null]);
  });
});
```

---

## Best Practices

### 1. **Write the test first, always**
- If you write code first, you may unconsciously write tests that pass rather than tests that verify behavior
- Tests written first act as executable specifications

### 2. **Keep tests small and focused**
- Each test should verify one specific behavior
- Name tests descriptively: `it('returns null for empty arrays')` not `it('test1')`

### 3. **Follow the Arrange-Act-Assert pattern**
```typescript
it('calculates profit correctly', () => {
  // Arrange
  const entry = 100;
  const exit = 110;
  const quantity = 10;

  // Act
  const profit = calculateProfit(entry, exit, quantity);

  // Assert
  expect(profit).toBe(100);
});
```

### 4. **Test edge cases, not just happy paths**
- Empty inputs, null values, maximum values
- Your `indicators.test.ts` does this well with empty arrays and invalid periods

### 5. **Use test doubles for external dependencies**
- Mock databases, APIs, and external services
- Your tests use `vi.mock()` to isolate units from their dependencies

### 6. **Keep the feedback loop fast**
- Unit tests should run in milliseconds
- Slow tests discourage running them frequently

---

## Common Pitfalls

### **Pitfall 1: Skipping the Refactor step**
**Problem**: You get to green and move on. Code becomes messy over time.
**Solution**: Always refactor after green. The safety net of passing tests lets you clean up fearlessly.

### **Pitfall 2: Writing too big tests**
**Problem**: Tests that verify 10 things at once. When they fail, you don't know what broke.
**Solution**: Write small, focused tests. Test one behavior at a time.

### **Pitfall 3: Testing implementation details**
**Problem**: Tests that break when you refactor, even though behavior is the same.
**Solution**: Test behavior (outputs for given inputs), not implementation (how it works internally).

### **Pitfall 4: False confidence from passing tests**
**Problem**: "All tests pass" doesn't mean "no bugs exist."
**Solution**: Tests only verify what you thought to test. Manual testing and code review still matter.

---

## When to Use TDD vs. When Not To

### **Use TDD for:**
- **Algorithmic logic**: Calculations, data transformations, business rules
- **Well-understood requirements**: You know what the code should do
- **Bug fixes**: Write a test that reproduces the bug, then fix it
- **Your codebase's parsers and indicators**: Already well-tested with TDD patterns

### **Don't use TDD for:**
- **Exploratory/spike code**: When you're figuring out what to build
- **UI development**: Visual/layout changes are hard to test drive
- **Unknown problem domains**: When you need to experiment first
- **Trivial code**: Getters/setters, simple data structures

### **The Rule of Thumb:**
If you can write a failing test that clearly describes desired behavior, use TDD. If you can't articulate what "correct" looks like yet, explore first, then add tests.

---

## Resources for Verification

- **Vitest Docs**: https://vitest.dev/guide/
- **Kent Beck's Canon TDD**: https://tidyfirst.substack.com/p/canon-tdd
- **Martin Fowler on TDD**: https://martinfowler.com/bliki/TestDrivenDevelopment.html
- **Wikipedia TDD**: https://en.wikipedia.org/wiki/Test-driven_development
- **Kent Beck's Book**: "Test-Driven Development by Example"

---

## Related Topics

- Unit Testing vs Integration Testing
- Mocking and Test Doubles
- Behavior-Driven Development (BDD)
- Test Coverage and Quality Metrics

---

*To continue learning, use: `/research more about TDD` or ask follow-up questions*

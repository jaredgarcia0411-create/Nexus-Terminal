# Test Driven Development Patterns & Industry Standards

**Researched**: 2025-03-17  
**Sources**: Kent C. Dodds, Next.js Docs, Vitest Docs, Testing Library, Your Codebase

---

## Your Codebase Current State

Your project uses Vitest (not Jest) with 32 test files in `__tests__/` directory. Current patterns observed:
- Tests use `describe/it/expect` from vitest
- File naming: `*.test.ts` pattern
- Location: Centralized in `__tests__/` directory
- Mocking with `vi.mock()` and `vi.fn()` (Vitest's API, compatible with Jest-style)
- API route tests mock DB dependencies with full mock objects

---

## Pattern Recommendations

### The Testing Trophy (Kent C. Dodds)

**Static Testing** → **Unit Tests** → **Integration Tests** → **E2E Tests**

Key principle: "Write tests. Not too many. Mostly integration."

| Level | Tools | When to Use |
|-------|-------|-------------|
| Static | TypeScript, ESLint | Always |
| Unit | Vitest | Pure functions, utilities, calculations |
| Integration | Vitest + React Testing Library | Components, hooks, API routes |
| E2E | Playwright, Cypress | Critical user flows |

**Source**: kentcdodds.com/blog/write-tests

---

## File Naming Conventions

### Industry Standards (2024-2025)

| Pattern | Use Case | Example |
|---------|----------|---------|
| `*.test.ts` | Unit/integration tests | `csv-parser.test.ts` |
| `*.spec.ts` | Alternative convention | `trades.spec.ts` |
| `*.e2e.ts` | End-to-end tests | `checkout-flow.e2e.ts` |
| `*.test-d.ts` | Type-level tests (Vitest) | `api-types.test-d.ts` |

### Your Project's Pattern

```typescript
// Current: Centralized in __tests__/
__tests__/csv-parser.test.ts
__tests__/trades-route.test.ts

// Alternative: Co-located (Next.js App Router style)
app/page.tsx
app/page.test.tsx
lib/utils.ts
lib/utils.test.ts
```

**Recommendation**: Keep `__tests__/` for API routes. Consider co-location for components/utilities.

---

## Test Structure Patterns

### AAA Pattern (Arrange-Act-Assert)

```typescript
// Your current codebase (csv-parser.test.ts:45-65)
describe('processCsvData — basic FIFO pairing', () => {
  it('pairs a single long round-trip into one trade', () => {
    // ARRANGE
    const rows = [
      { Symbol: 'AAPL', Side: 'MARGIN', Qty: '100', ... },
      { Symbol: 'AAPL', Side: 'S', Qty: '100', ... },
    ];
    const dateInfo = { date: new Date('2025-01-15'), sortKey: '2025-01-15' };
    
    // ACT
    const result = processCsvData(rows as Record<string, string>[], dateInfo);
    
    // ASSERT
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].symbol).toBe('AAPL');
    expect(result.trades[0].pnl).toBeCloseTo(500.0 - 2.0 - 0.2);
  });
});
```

### When Testing React Components

```typescript
// Use React Testing Library pattern
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

test('can open accordion items to see the contents', async () => {
  const hats = { title: 'Favorite Hats', contents: 'Fedoras are classy' };
  render(<Accordion items={[hats]} />);
  
  expect(screen.getByText(hats.contents)).toBeInTheDocument();
  await userEvent.click(screen.getByText(hats.title));
  expect(screen.queryByText(hats.contents)).not.toBeInTheDocument();
});
```

**Key principle**: Test behavior, not implementation. Don't test state names or internal methods.

**Source**: kentcdodds.com/blog/testing-implementation-details

---

## Assertion Patterns

### Vitest Built-in Matchers

```typescript
// Your current patterns (from indicators.test.ts)
expect(result).toEqual([null, null, 2, 3, 4]);        // Exact match
expect(result).toBeCloseTo(11.6666667, 6);            // Float comparison
expect(result).toHaveLength(16);                       // Array length
expect(result.macd).toHaveLength(40);
expect(result.trades).toHaveLength(1);

// For objects
expect(trade).toMatchObject({                          // Partial match
  symbol: 'AAPL',
  direction: 'LONG',
});

// Boolean checks
expect(result.trades.every(t => t.totalQuantity > 0)).toBe(true);
```

### Custom Matchers (Consider Adding)

```typescript
// In vitest.config.ts or setup file
expect.extend({
  toBeWithinRange(received, floor, ceiling) {
    const pass = received >= floor && received <= ceiling;
    return {
      message: () => `expected ${received} to be within range ${floor}-${ceiling}`,
      pass,
    };
  },
});
```

---

## Mocking Strategies

### Your Current Pattern (trades-route.test.ts)

```typescript
import { vi } from 'vitest';

// Hoisted mocks (Vitest specific)
const { getDbMock, requireUserMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  requireUserMock: vi.fn(),
}));

// Module-level mock
vi.mock('@/lib/db', () => ({
  getDb: getDbMock,
}));

// Usage in test
beforeEach(() => {
  vi.clearAllMocks();
  requireUserMock.mockResolvedValue({ user: { id: 'user-1', ... } });
});
```

### Best Practice Patterns

```typescript
// Mocking modules with partial preservation
vi.mock(import('./some-path.js'), async (importOriginal) => {
  const mod = await importOriginal();
  return {
    ...mod,
    mockedFunction: vi.fn(),  // Only mock what you need
  };
});

// Mocking dates
test('mocking dates', () => {
  const mockDate = new Date(2022, 0, 1);
  vi.setSystemTime(mockDate);
  // ... test code
  vi.useRealTimers();
});

// Spy without replacing implementation
import * as module from './module.js';
vi.spyOn(module, 'method').mockImplementation(() => {});
```

**Source**: vitest.dev/guide/mocking

---

## When to Test vs When Not To

### ✅ Test These

| Component | Example from your codebase |
|-----------|---------------------------|
| Business logic | `indicators.ts` - SMA, EMA, RSI calculations |
| Data transformations | `csv-parser.ts` - CSV to trade objects |
| API route handlers | `trades-route.test.ts` - POST /api/trades |
| Utilities with edge cases | Time calculations, currency formatting |
| Complex UI state | Forms, multi-step wizards |

### ❌ Don't Test These

| Category | Why |
|----------|-----|
| Simple prop passing | `const Card = ({ title }) => <h1>{title}</h1>` |
| Third-party libraries | Trust the library, test your integration |
| Styles/CSS | Use visual regression instead |
| Generated code | E.g., from Drizzle or OpenAPI generators |
| Static types | TypeScript catches these |

---

## Unit vs Integration vs E2E Testing

### Unit Tests (Your indicators.test.ts is perfect)
- Pure functions with clear inputs/outputs
- Mathematical calculations
- Data transformations
- **Speed**: Fast (<100ms)
- **Confidence**: Low-moderate

### Integration Tests (Your trades-route.test.ts is good)
- API routes with mocked dependencies
- Components with user interactions
- Multiple units working together
- **Speed**: Moderate (100-500ms)
- **Confidence**: High

### E2E Tests (You don't have these yet)
- User flows: login → import → view trades
- Critical business paths
- **Speed**: Slow (seconds)
- **Confidence**: Very high
- **Tools**: Playwright (recommended for Next.js)

**Source**: Next.js docs /guides/testing

---

## 2024-2025 Best Practice Shifts

### 1. Vitest over Jest
- Native ESM support
- Faster execution
- Built-in TypeScript
- Better IDE integration

### 2. React Testing Library > Enzyme
- Don't test implementation details
- Query by role/text, not CSS selectors
- User-centric approach

### 3. Async Server Components
- Vitest doesn't support async Server Components yet
- Use E2E tests for async components
- Test synchronous parts with unit tests

### 4. Type-Level Testing (Vitest 2.1+)
```typescript
// *.test-d.ts files
import { expectTypeOf } from 'vitest';

test('types work properly', () => {
  expectTypeOf(mount).toBeFunction();
  expectTypeOf(mount).parameter(0).toExtend<{ name: string }>();
});
```

### 5. Browser Mode (Vitest 3.0+)
- Run tests in real browser instead of jsdom
- Better for component testing
- Optional, traditional mode still supported

---

## Actionable Recommendations for Your Project

### Immediate (no new dependencies)
1. Add `beforeEach(() => vi.clearAllMocks())` to all test files
2. Use `toBeCloseTo()` for floating-point comparisons (already doing this well)
3. Group related tests with `describe` blocks

### Short-term (small additions)
1. Add React Testing Library for component tests:
   ```bash
   npm install -D @testing-library/react @testing-library/jest-dom
   ```

2. Create a test utilities file:
   ```typescript
   // __tests__/utils/test-utils.ts
   export function createMockUser(overrides = {}) {
     return {
       id: 'user-1',
       email: 'test@example.com',
       ...overrides,
     };
   }
   ```

3. Add type-level tests for critical API types

### Long-term (if needed)
1. Add Playwright for E2E testing critical flows
2. Consider co-locating component tests next to components
3. Add visual regression testing for UI components

---

## Follow-up Questions

### Q: How do I test React hooks effectively?
**Answer**: Use `@testing-library/react`'s `renderHook`:
```typescript
import { renderHook, act } from '@testing-library/react';

const { result } = renderHook(() => useCounter());
act(() => result.current.increment());
expect(result.current.count).toBe(1);
```

### Q: When should I use `vi.fn()` vs `vi.spyOn()`?
**Answer**: 
- `vi.fn()` - Create a completely new mock function
- `vi.spyOn()` - Wrap existing function, can restore original
- Use spy when you want to verify calls but keep original behavior

### Q: Should I test error handling in API routes?
**Answer**: Yes, especially for:
- Validation errors (400 responses)
- Authentication failures (401 responses)
- Database unavailable (503 responses)
- Your `dbUnavailable()` helper usage

---

## Related Topics

- [React Testing Library Query Priority](https://testing-library.com/docs/queries/about#priority)
- [Vitest Mocking Guide](https://vitest.dev/guide/mocking.html)
- [Next.js Testing Docs](https://nextjs.org/docs/app/guides/testing)
- [Kent C. Dodds - Testing JavaScript Course](https://testingjavascript.com)

---

*To ask follow-up questions, reference this file and ask for specific clarifications.*

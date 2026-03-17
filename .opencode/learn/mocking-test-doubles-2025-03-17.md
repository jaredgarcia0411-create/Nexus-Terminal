# Mocking & Test Doubles Crash Course

**Researched**: 2025-03-17  
**Sources**: Vitest docs, Nexus Terminal codebase analysis  
**Context**: Codebase-specific (Vitest testing patterns)

---

## The 5 Types of Test Doubles

Test doubles replace real dependencies in tests. Each type has a specific purpose:

| Type | Purpose | Example | Use When |
|------|---------|---------|----------|
| **Dummy** | Fill required parameters | `null`, empty objects | Parameter is required but unused |
| **Stub** | Return canned responses | `vi.fn().mockReturnValue(data)` | Need predictable return values |
| **Spy** | Record what happened | `vi.spyOn(obj, 'method')` | Need to verify calls were made |
| **Mock** | Pre-programmed expectations | `vi.mock()` modules | Controlling external dependencies |
| **Fake** | Working implementation | In-memory DB, test server | Need actual behavior without real service |

**In practice**: You'll mostly use **stubs** (`vi.fn()`), **spies** (`vi.spyOn()`), and **module mocks** (`vi.mock()`).

---

## Vitest Cheat Sheet

### `vi.fn()` - Create a Stub/Mock Function

```typescript
// Basic stub with return value
const getUserMock = vi.fn();
getUserMock.mockReturnValue({ id: '1', name: 'Alice' });

// Async stub (returns Promise)
const fetchDataMock = vi.fn();
fetchDataMock.mockResolvedValue({ data: [] });

// From your codebase: auth stub
const requireUserMock = vi.fn();
requireUserMock.mockResolvedValue({ 
  user: { id: 'user-1', email: 'test@example.com' } 
});

// Verify it was called
expect(requireUserMock).toHaveBeenCalledWith(expectedArg);
```

### `vi.spyOn()` - Wrap & Track Real Functions

```typescript
// Spy on global fetch
const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
  new Response(JSON.stringify({ ok: true }))
);

// Run your code
await myFunction();

// Verify fetch was called correctly
expect(fetchSpy).toHaveBeenCalledWith(
  'https://api.example.com/data',
  expect.objectContaining({ method: 'POST' })
);

// Spy on console to suppress output
const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
// ... run test ...
expect(errorSpy).toHaveBeenCalled(); // verify error logged
```

### `vi.mock()` - Replace Entire Modules

**The pattern you use in every test file:**

```typescript
// 1. Hoist mock factories (runs before imports)
const { getDbMock, requireUserMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  requireUserMock: vi.fn(),
}));

// 2. Mock the modules
vi.mock('@/lib/db', () => ({ getDb: getDbMock }));
vi.mock('@/lib/server-db-utils', () => ({ 
  requireUser: requireUserMock 
}));

// 3. Import the code under test (uses mocks)
import { POST } from '@/app/api/trades/route';

describe('POST /api/trades', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({ user: { id: '1' } });
  });
  
  it('creates trade', async () => {
    getDbMock.mockReturnValue(makeFakeDb());
    // ... test ...
  });
});
```

---

## Your Codebase: Common Patterns

### Pattern 1: Mock Database with Chained Methods

```typescript
// __tests__/trades-route.test.ts
function makeDb() {
  const tradeInsertMock = vi.fn().mockReturnValue({
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
  });

  return {
    insert: vi.fn((table) => {
      if (table === tradesTable) return { values: tradeInsertMock };
      throw new Error('Unexpected table');
    }),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([{ id: '1' }]),
        })),
      })),
    })),
    // Expose mocks for assertions
    _mocks: { tradeInsertMock },
  };
}

// Usage
const db = makeDb();
getDbMock.mockReturnValue(db);
await POST(request);
expect(db._mocks.tradeInsertMock).toHaveBeenCalled();
```

### Pattern 2: Mock External API (AskEdgar, Groq)

```typescript
// __tests__/jarvis-client.test.ts
const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
  new Response(JSON.stringify({
    choices: [{ message: { content: 'AI response' } }]
  }))
);

const result = await callJarvis('system', 'user prompt');
expect(result.content).toBe('AI response');
```

### Pattern 3: Mock Environment Variables

```typescript
// schwab-crypto.test.ts
beforeEach(() => {
  vi.stubEnv('SCHWAB_TOKEN_ENCRYPTION_KEY', 'test-key-32-chars-long!!!');
});
```

---

## Best Practices

1. **Always use `vi.hoisted()` with `vi.mock()`** — Variables must exist when Vitest hoists the mock declarations.

2. **Call `vi.clearAllMocks()` in `beforeEach`** — Prevents test pollution and flaky tests.

3. **Mock boundaries, not logic** — Mock DB, HTTP, auth. Don't mock internal business functions.

4. **Name mocks with `Mock` suffix** — `getDbMock` not `getDb` — makes debugging easier.

5. **Expose inner mocks via `_mocks`** — For complex fakes, expose nested mocks for assertions.

---

## Common Pitfalls

**❌ Mocking without hoisting**
```typescript
// WRONG: myMock undefined when mock is hoisted
const myMock = vi.fn();
vi.mock('@/lib/db', () => ({ getDb: myMock }));

// RIGHT: hoisted runs before imports
const { myMock } = vi.hoisted(() => ({ myMock: vi.fn() }));
vi.mock('@/lib/db', () => ({ getDb: myMock }));
```

**❌ Forgetting to clear mocks**
```typescript
// Causes flaky tests - mock state leaks between tests
beforeEach(() => {
  vi.clearAllMocks(); // Always do this
});
```

**❌ Testing implementation instead of behavior**
```typescript
// WRONG: breaks when implementation changes
expect(dbInsertMock).toHaveBeenCalledTimes(3);

// RIGHT: test what matters
expect(response.status).toBe(200);
expect(result.trades).toHaveLength(1);
```

**❌ Over-mocking in integration tests**
```typescript
// If you mock everything, it's a unit test
// Integration tests should verify real module interactions
```

---

## Quick Decision Tree

**Need to mock a function's return value?** → `vi.fn()`  
**Need to verify a function was called?** → `vi.spyOn()`  
**Need to replace an entire module?** → `vi.mock()` + `vi.hoisted()`  
**Need a working test implementation?** → Create a fake (like `makeDb()`)  

---

## Related Topics

- [Unit vs Integration Testing](unit-vs-integration-testing-2025-03-17.md) — When to use which
- [TDD Crash Course](test-driven-development-2025-03-17.md) — Testing methodology
- Async testing patterns
- Database testing strategies
- Dependency injection patterns

---

*To continue learning, use: `/research more about async testing` or ask about specific scenarios in your codebase.*

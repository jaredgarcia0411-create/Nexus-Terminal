# Test Doubles Crash Course
**Researched**: March 17, 2025
**Sources**: Gerard Meszaros' xUnit Test Patterns, Martin Fowler's articles, Vitest documentation, Nexus Terminal codebase

---

## Concept Overview

Test doubles are replacements for production objects used during testing to isolate code under test from its dependencies. Think of them like stunt doubles in movies — they stand in for the real thing when you need to simulate specific scenarios safely.

The term "Test Double" was coined by Gerard Meszaros in his book *xUnit Test Patterns* (2007) to provide clear vocabulary for different types of fake objects used in testing.

---

## The Five Types of Test Doubles

### 1. Dummy Objects
Objects passed around but never actually used. They exist only to satisfy parameter lists.

```typescript
// You don't care about the logger, but the function requires it
function processOrder(order: Order, logger: Logger) { ... }

const dummyLogger = {} as Logger; // Never actually called
processOrder(order, dummyLogger);
```

**When to use**: Required parameters that the test doesn't care about.

---

### 2. Stubs
Provide canned answers to calls made during the test. They respond with pre-programmed values but don't record or verify how they were called.

```typescript
// Stub: returns hardcoded values
const dbStub = {
  getUser: () => ({ id: 'user-1', name: 'Test User' }),
  getOrders: () => []
};

const service = new OrderService(dbStub);
const user = service.getUser('user-1'); // Returns the canned user
```

**Key characteristic**: Stubs provide **indirect inputs** to the system under test (SUT).

---

### 3. Spies
Stubs that also record information about how they were called. They capture call arguments, count, and order for later verification.

```typescript
// Spy: records calls while providing canned responses
const mailerSpy = {
  sentMessages: [] as Message[],
  send: (msg: Message) => {
    mailerSpy.sentMessages.push(msg);
    return Promise.resolve();
  }
};

// After test runs:
expect(mailerSpy.sentMessages.length).toBe(1);
expect(mailerSpy.sentMessages[0].to).toBe('user@example.com');
```

**Key characteristic**: Spies are **observation points** for indirect outputs.

---

### 4. Mocks
Pre-programmed with expectations that form a specification of expected calls. They throw if unexpected calls occur and verify all expected calls were made.

```typescript
// Mock: expects specific calls, fails if expectations not met
const warehouseMock = {
  hasInventory: vi.fn().mockReturnValue(true),
  remove: vi.fn().mockReturnValue(undefined)
};

// Set expectations before acting
warehouseMock.hasInventory('AAPL', 100);
warehouseMock.remove('AAPL', 100);

order.fill(warehouseMock);

// Verify the contract was followed
expect(warehouseMock.hasInventory).toHaveBeenCalledWith('AAPL', 100);
expect(warehouseMock.remove).toHaveBeenCalledWith('AAPL', 100);
```

**Key characteristic**: Mocks enforce **behavior verification** via expectations.

---

### 5. Fakes
Working implementations with shortcuts not suitable for production. They have real logic but are simpler/faster.

```typescript
// Fake: in-memory database that behaves like the real thing
class InMemoryDatabase implements Database {
  private data = new Map<string, any>();
  
  async get(id: string) {
    return this.data.get(id);
  }
  
  async set(id: string, value: any) {
    this.data.set(id, value);
  }
}

// Tests use the fake (fast, no network)
const db = new InMemoryDatabase();
```

**Key characteristic**: Fakes have **real working implementations** but with trade-offs.

---

## Mocks vs Stubs: The Critical Difference

This is the most commonly confused distinction:

| Aspect | Stub | Mock |
|--------|------|------|
| **Purpose** | Provide test data | Verify interactions |
| **Verification** | State-based (check results) | Behavior-based (check calls) |
| **Test Focus** | "Did the right thing happen?" | "Did the right calls happen?" |
| **Failure Mode** | Assertion on output | Unexpected call or missing expected call |

**The confusion**: Many developers call everything "mocks" when they mean "stubs" or "test doubles" in general.

**Martin Fowler's test**: 
- If you're checking *state* after the test → you're using stubs (or state verification)
- If you're checking *interactions* (which methods were called with what args) → you're using mocks (behavior verification)

---

## When to Use Each Type

| Scenario | Use | Example |
|----------|-----|---------|
| Required but unused parameter | **Dummy** | Logger in a test that doesn't care about logging |
| Need specific return values | **Stub** | Database that returns pre-defined user data |
| Need to capture what was sent | **Spy** | Email service to verify message content |
| Need to enforce calling contract | **Mock** | Verifying a cache is checked before database |
| Need fast, realistic behavior | **Fake** | In-memory database for integration tests |

---

## Vitest Implementation Patterns

### vi.fn() — Creates a Stub/Spy/Mock

```typescript
import { vi } from 'vitest';

// Basic stub that returns undefined
const myFn = vi.fn();

// Stub with canned return value
const getUser = vi.fn(() => ({ id: '1', name: 'Test' }));

// Mock with multiple return values
const fetchData = vi.fn()
  .mockResolvedValueOnce({ data: [] })  // First call
  .mockResolvedValueOnce({ data: ['item'] });  // Second call

// Spy with implementation
const spy = vi.fn((a, b) => a + b);
spy(1, 2); // Returns 3, records the call
expect(spy).toHaveBeenCalledWith(1, 2);
```

---

### vi.spyOn() — Spies on existing objects

```typescript
import { vi } from 'vitest';

const cart = {
  getApples: () => 42,
  getOranges: () => 10
};

// Spy on existing method
const spy = vi.spyOn(cart, 'getApples').mockReturnValue(100);

expect(cart.getApples()).toBe(100);  // Uses mock
expect(spy).toHaveBeenCalled();

// Restore original
spy.mockRestore();
expect(cart.getApples()).toBe(42);  // Back to original
```

**Key feature**: `spyOn` wraps the original — you can still call the real implementation or mock it.

---

### vi.mock() — Mocks entire modules

```typescript
// Hoisted to top — runs before imports
vi.mock('@/lib/db', () => ({
  getDb: vi.fn(() => ({
    select: vi.fn(() => ({ from: vi.fn(() => []) })),
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) }))
  }))
}));

// Now imports return the mock
import { getDb } from '@/lib/db';
```

**Critical**: `vi.mock` is **hoisted** — it runs before imports, so you can't use variables defined outside the factory. Use `vi.hoisted()` for shared mocks.

---

### From Nexus Terminal Codebase

**Pattern: vi.hoisted() for shared mocks**

```typescript
// From __tests__/trades-route.test.ts
const { getDbMock, requireUserMock, ensureUserMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  requireUserMock: vi.fn(),
  ensureUserMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  getDb: getDbMock,
}));

vi.mock('@/lib/server-db-utils', () => ({
  requireUser: requireUserMock,
  ensureUser: ensureUserMock,
}));
```

**Pattern: Building chainable stubs for database**

```typescript
// From __tests__/trades-route.test.ts
function makeDb() {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([{ id: 'trade-1' }])
        }))
      }))
    })),
    insert: vi.fn(() => ({
      values: vi.fn().mockResolvedValue(undefined)
    }))
  };
}
```

**Pattern: Spying on global fetch**

```typescript
// From __tests__/jarvis-client.test.ts
const fetchSpy = vi.spyOn(globalThis, 'fetch')
  .mockResolvedValue(new Response(JSON.stringify({ choices: [] })));

// Test makes assertions on the spy
expect(fetchSpy).toHaveBeenCalledWith(
  'https://api.groq.com/openai/v1/chat/completions',
  expect.objectContaining({ method: 'POST' })
);
```

---

## Best Practices

### 1. Prefer Fakes Over Mocks When Possible
Fakes give you real behavior without external dependencies. They're less brittle and test actual logic, not just call sequences.

### 2. Use Stubs for Inputs, Mocks for Outputs
- **Stubs**: Replace dependencies that provide data TO your code
- **Mocks**: Verify what your code does TO dependencies

### 3. One Mock/Stub Per Concept
Don't create a single mega-mock that handles everything. Create focused ones:

```typescript
// Good: separate concerns
const dbStub = { getUser: vi.fn(), saveUser: vi.fn() };
const emailMock = { send: vi.fn() };

// Bad: everything in one mock
const megaMock = {
  getUser: vi.fn(),
  saveUser: vi.fn(),
  sendEmail: vi.fn(),
  logEvent: vi.fn(),
  // ...etc
};
```

### 4. Reset Mocks Between Tests

```typescript
beforeEach(() => {
  vi.clearAllMocks();  // Clears call history
  // OR
  vi.resetAllMocks(); // Clears history + resets implementation
});

afterEach(() => {
  vi.restoreAllMocks(); // Restores original implementations
});
```

### 5. Keep Mock Logic Simple
If your mock needs complex logic, you probably need a fake instead.

---

## Common Anti-Patterns

### Anti-Pattern 1: Mocking Everything
Testing that mocks call mocks tells you nothing about real behavior. Have at least some integration tests with real implementations.

### Anti-Pattern 2: Over-Specified Mocks
Don't assert on every method call if the test doesn't care about it. This creates brittle tests that break on refactoring.

```typescript
// Too specific — breaks if implementation changes order
expect(mock.step1).toHaveBeenCalledBefore(mock.step2);
expect(mock.step2).toHaveBeenCalledWith(exactArgs);

// Better: only verify what matters
expect(mock.finalResult).toHaveBeenCalledWith(expectedData);
```

### Anti-Pattern 3: Mocking What You Don't Own
Avoid mocking external libraries. If the library changes, your mocks lie. Wrap external dependencies instead:

```typescript
// Bad: mocking axios directly
vi.mock('axios', () => ({ get: vi.fn() }));

// Better: wrap and mock your wrapper
class HttpClient {
  async get(url: string) {
    return axios.get(url);
  }
}

vi.mock('@/lib/http-client');
```

### Anti-Pattern 4: Stateful Mocks
Avoid mocks that track state across calls — they become hard to understand and debug:

```typescript
// Confusing stateful mock
let callCount = 0;
const mock = vi.fn(() => {
  callCount++;
  if (callCount === 1) return 'first';
  if (callCount === 2) return 'second';
  return 'default';
});

// Better: use mockReturnValueOnce
const mock = vi.fn()
  .mockReturnValueOnce('first')
  .mockReturnValueOnce('second')
  .mockReturnValue('default');
```

---

## Verification Sources

- **Gerard Meszaros**: http://xunitpatterns.com/Test%20Double.html
- **Martin Fowler - Test Double**: https://martinfowler.com/bliki/TestDouble.html
- **Martin Fowler - Mocks Aren't Stubs**: https://martinfowler.com/articles/mocksArentStubs.html
- **Vitest Mocking Guide**: https://vitest.dev/guide/mocking.html
- **Vitest API Reference**: https://vitest.dev/api/vi.html

---

## Related Topics

- Dependency Injection (makes test doubles easier to use)
- Integration Testing (when to use real implementations)
- Contract Testing (verified fakes)

---

## Follow-up Questions

[To be populated with user follow-ups]

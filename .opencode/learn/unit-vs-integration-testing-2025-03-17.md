# Unit Testing vs Integration Testing

**Researched**: 2025-03-17  
**Sources**: Vitest docs, Nexus Terminal codebase analysis  
**Context**: Codebase-specific

---

## Concept Overview

**Unit tests** verify individual functions or modules in isolation, while **integration tests** verify that multiple modules work together correctly. Both matter because unit tests catch logic bugs fast, but only integration tests catch the wiring issues between components that unit tests can't see.

## How It Works

| Aspect | Unit Tests | Integration Tests |
|--------|------------|-------------------|
| **Scope** | Single function/module | Multiple modules working together |
| **Dependencies** | Mocked or none | Real (or partially mocked) |
| **Speed** | Fast (milliseconds) | Slower (may hit DB/API) |
| **Failure signal** | "This function is broken" | "These components don't connect" |

**Unit tests** prove a function works given correct inputs. **Integration tests** prove the functions are actually called correctly in context.

## Code Examples

### Unit Test: Pure Function (Isolated)

Tests a single function with no external dependencies:

```typescript
// lib/csv-parser.ts - pure function
export function parseDateFromFilename(filename: string) {
  // logic to extract date from filename
}

// __tests__/csv-parser.test.ts
import { describe, it, expect } from 'vitest';
import { parseDateFromFilename } from '@/lib/csv-parser';

describe('parseDateFromFilename', () => {
  it('parses MM-DD-YY format', () => {
    const result = parseDateFromFilename('01-15-25.csv');
    expect(result).not.toBeNull();
    expect(result!.sortKey).toBe('2025-01-15');
  });

  it('returns null for unparseable filenames', () => {
    expect(parseDateFromFilename('readme.txt')).toBeNull();
  });
});
```

**Why this is a unit test**: No mocks needed, just calling a pure function with inputs and asserting outputs.

### Integration Test: API Route (Multiple Modules)

Tests a route that uses database, auth, and helper functions:

```typescript
// __tests__/trades-route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies
const { getDbMock, requireUserMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  requireUserMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ getDb: getDbMock }));
vi.mock('@/lib/server-db-utils', () => ({ 
  requireUser: requireUserMock,
  dbUnavailable: () => Response.json({ error: 'Database not configured' }, { status: 503 }),
}));

import { POST } from '@/app/api/trades/route';

describe('POST /api/trades', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({ user: { id: 'user-1', email: 'u@example.com' } });
  });

  it('stores explicit timezone timestamps as canonical ISO', async () => {
    const db = makeDb(); // Create mock DB
    getDbMock.mockReturnValue(db);

    const response = await POST(new Request('http://localhost/api/trades', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'trade-1',
        symbol: 'AAPL',
        rawExecutions: [{ timestamp: '2026-03-06T09:35:00-05:00' }],
      }),
    }));

    expect(response.status).toBe(200);
    expect(db._mocks.executionInsertValuesMock).toHaveBeenCalledWith([
      expect.objectContaining({ timestamp: '2026-03-06T14:35:00.000Z' }),
    ]);
  });
});
```

**Why this is an integration test**: Tests the route handler + database + auth together. Uses `vi.mock()` to stub external dependencies while testing the integration logic.

### From Your Codebase: Indicator Calculations

**Unit test** from `__tests__/indicators.test.ts`:

```typescript
describe('sma', () => {
  it('returns null warmup slots and rolling means', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });
});
```

**Integration test** from `__tests__/jarvis-client.test.ts` (mocks HTTP + circuit breaker):

```typescript
describe('jarvis client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JARVIS_API_KEY = 'k';
    isCircuitOpenMock.mockReturnValue(false);
  });

  it('returns content from llm response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }))
    );
    const result = await callJarvis('sys', 'user');
    expect(result.content).toBe('ok');
    expect(recordLlmSuccessMock).toHaveBeenCalled();
  });
});
```

## Best Practices

1. **Start with unit tests for pure logic** — Functions like `sma()`, `ema()`, `parseDateFromFilename()` are perfect candidates. They're deterministic, have no side effects, and test fast.

2. **Use integration tests for API routes** — Routes touch databases, auth, and external services. Mock the boundaries (DB, HTTP) but test the orchestration logic.

3. **Mock at the right level** — In your codebase, `vi.mock()` is used to stub entire modules (DB, auth), not individual functions. This keeps tests clean and avoids brittle mocks.

4. **Test what matters** — Don't test that the database works; test that your code constructs the right queries. Don't test that fetch works; test that you call it with the right URL.

5. **Follow the 70/20/10 rule** — 70% unit tests (fast, isolated), 20% integration tests (module interaction), 10% end-to-end tests (user flows).

## Common Pitfalls

**Pitfall: Testing implementation instead of behavior**  
Bad: `expect(mockInsert).toHaveBeenCalledTimes(3)`  
Good: `expect(response.status).toBe(200)` and verify side effects  

**Pitfall: Mocking too much in integration tests**  
If you mock everything, you're writing a unit test. Integration tests should verify real interactions. Mock only external boundaries (DB, HTTP, file system).

**Pitfall: Not using `vi.hoisted()` for mocks**  
In Vitest, mock declarations using `vi.mock()` are hoisted. If you need to reference variables in mocks, use `vi.hoisted()` as shown in your trades-route test.

## Related Topics

- **Mocking patterns** — `vi.mock()`, `vi.spyOn()`, `vi.fn()`
- **Testing async code** — `async/await`, `resolves/rejects` matchers
- **Database testing** — Test containers vs in-memory SQLite
- **End-to-end testing** — Playwright/Cypress vs integration tests

---

*To continue learning, use: `/research more about mocking patterns` or ask about a specific test file in your codebase.*

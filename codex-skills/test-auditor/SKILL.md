---
name: test-auditor
description: >
  Audit Nexus Terminal test coverage and test quality. Use when the user wants testing gaps,
  flaky patterns, or behavior-vs-implementation-detail issues identified before writing fixes.
---

# Test Auditor

This is a read-first audit skill. Do not modify tests unless the user explicitly asks for fixes.

## Workflow

1. Resolve scope from the request.
   - No scope: audit the full test suite.
   - `routes`: compare `app/api/**/route.ts` against route tests in `__tests__/`.
   - `lib`, `hooks`, `component`, or a file path: narrow the audit accordingly.
2. Inventory source files and matching tests with `rg` and `find`.
   - Identify missing tests, thin coverage areas, and stale tests for deleted code.
3. Audit for repo-specific test patterns.
   - Route tests usually use `vi.hoisted()` plus `vi.mock()`.
   - Shared mocks commonly include `requireUserMock`, `getDbMock`, `getPoolDbMock`, and `ensureUserMock`.
   - DB-backed route tests often use local `makeDb()` factories.
   - `vi.clearAllMocks()` belongs in `beforeEach()` for isolated suites.
   - Validation assertions should match `parseAndValidate(...)` and Zod v4 error shapes.
4. Prefer behavior over implementation detail.
   - Component tests should use `@testing-library/react` and visible user behavior.
   - Route tests should assert response status and payloads, not internal helper calls unless the helper boundary is the behavior.
5. Report findings in severity order.
   - Start with flakes, broken isolation, and missing high-risk coverage.
   - Include exact file paths and concrete fixes.
6. Save a report when the audit is substantial or the user asks for one.
   - Use `docs/test-audit-<scope>-<date>.md` unless the user asked for a different repo-local path.
   - Show the report contents in chat as well, not just the file path.

## Output Format

- Findings
- Coverage gaps
- Good examples worth copying
- Recommended actions

## Current Repo Reference Points

- `__tests__/tradingview-gainers-route.test.ts` is a good route-test example for `vi.hoisted()` plus auth mocking.
- `__tests__/trades-route.test.ts` and `__tests__/trades-import-route.test.ts` show local `makeDb()` factory patterns.
- `__tests__/research-tab.test.tsx` is the current reference for behavior-first component testing.

## Do Not

- Do not claim line coverage percentages unless a real coverage tool was run.
- Do not delete or rewrite tests during an audit-only request.
- Do not treat generated files, `.next`, or `node_modules` as audit targets.
- Do not recommend Jest patterns in this repo; Vitest is the standard.

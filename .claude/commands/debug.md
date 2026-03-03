Debug the following issue: $ARGUMENTS

## Debugging Process

1. **Reproduce**: Identify the exact steps or conditions that trigger the issue based on the description.

2. **Trace the Data Flow**:
   - For UI bugs: trace from the component rendering back through props, hooks (`useTrades`), and state
   - For API bugs: trace from the route handler through database queries (`getDb()`, `requireUser()`) to the response
   - For auth bugs: trace through `lib/auth-config.ts` callbacks, middleware, and session handling

3. **Check Common Pitfalls in This Codebase**:
   - `useTrades` hook manages all trade state — check if the issue is in the hook vs the consuming component
   - Dual persistence: is the bug localStorage-specific or Turso-specific? Check `/api/health` response
   - CSV import: `processCsvData()` silently drops unmatched executions — could data be missing?
   - Schwab OAuth: tokens stored server-side only — check expiration and refresh logic
   - NextAuth v5: session available via `auth()` server-side or `useSession()` client-side

4. **Identify Root Cause**: Pin down the exact file, function, and line where the bug originates.

5. **Propose Fix**: Provide the minimal code change that resolves the issue without side effects. Verify the fix doesn't break:
   - Type safety (`npm run build` should pass)
   - Existing functionality (no behavioral changes beyond the fix)
   - Both storage modes (localStorage and Turso)

6. **Verify**: Suggest how to confirm the fix works (manual test steps or checks).

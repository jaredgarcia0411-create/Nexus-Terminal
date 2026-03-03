Analyze the component or module for testability and potential bugs: $ARGUMENTS

## Analysis Steps

### 1. State & Props Audit
- List all props the component accepts and verify types are correct
- Identify all `useState`, `useMemo`, `useCallback`, `useEffect` hooks
- Check for stale closures (effects missing dependencies)
- Check for unnecessary re-renders (objects/arrays created in render, missing memoization)

### 2. Edge Case Analysis
- **Empty state**: What happens with zero trades, no session, no tags?
- **Boundary values**: Max trades count, very long tag names, special characters in search
- **Null/undefined**: Are optional values handled? Check `?.` chains and fallbacks
- **Concurrent updates**: Can rapid clicks cause race conditions (double submit, stale state)?
- **Network failures**: What happens if API calls fail? Are errors caught and displayed?

### 3. Integration Points
- Verify props passed from parent match what the component expects
- Check that callback props (`onAddTag`, `onDeleteSelected`, etc.) handle errors
- Verify `AnimatePresence` keys are unique and stable

### 4. Type Safety Check
- Look for type assertions (`as`) that could mask runtime errors
- Check for `any` types that bypass type checking
- Verify discriminated unions are exhaustively handled

### 5. Suggested Test Scenarios
For each issue found, describe:
- The scenario that triggers it
- Expected behavior vs actual behavior
- The specific fix needed

Focus on bugs that could actually occur in production, not theoretical issues.

# Subagent: Test Inventory

## Task
Audit scope: "{{SCOPE}}"

## Tasks
1. Find all test files matching the scope:
   - Look in `__tests__/**/*.test.ts`
   - Filter by scope if specified (e.g., *route* for routes)
   
2. Identify corresponding source files:
   - Map test files to source files they test
   - Look in `app/`, `lib/`, `hooks/`, `components/`
   
3. Calculate coverage ratio:
   - Test files / Source files
   - Report as percentage

4. List untested source files:
   - Source files with no corresponding test
   - Note priority (high/medium/low)

## Output Format

```
## Test Files Found ([N])
1. `__tests__/file1.test.ts` → tests `lib/file1.ts`
2. ...

## Source Files in Scope ([N])
1. `lib/file1.ts` ✓ has test
2. `lib/file2.ts` ✗ no test
...

## Coverage Ratio
- Test files: [N]
- Source files: [N]
- Ratio: [N%]

## Untested Files
### High Priority (core/business logic)
- `lib/important.ts` — core business logic

### Medium Priority (utilities)
- `lib/utils.ts` — helper functions

### Low Priority (types/config)
- `lib/types.ts` — type definitions only
```

Focus on accuracy — correctly match test files to source files.

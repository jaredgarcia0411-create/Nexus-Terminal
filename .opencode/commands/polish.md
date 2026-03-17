---
description: Polish current changes before commit
agent: executor
---

Perform a final polish pass on the current changes: $ARGUMENTS

If no specific focus is given, polish the full working tree.

1. Inspect the current diff and identify only small, high-value fixes.
2. Focus on obvious bugs, edge cases, naming clarity, consistency, dead code, and awkward UX copy.
3. Do not do broad refactors or architecture changes unless a clear defect requires it.
4. Run `npm run lint` and `npx tsc --noEmit`.
5. Run `npm test` when code changed or the touched area carries meaningful risk.
6. If the changes touch auth, API routes, secrets, user input, or external requests, also do a lightweight security review.
7. Fix only the issues that are clearly valuable and high confidence.
8. Report what you polished, what checks you ran, and any follow-up concerns.

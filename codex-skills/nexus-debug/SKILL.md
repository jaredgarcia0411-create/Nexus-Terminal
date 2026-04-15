---
name: nexus-debug
description: >
  Systematic Nexus Terminal debugging workflow. Use when the user asks to root-cause a bug,
  reproduce a regression, trace a failing route or component, or fix a concrete issue without
  drifting into a refactor.
---

# Nexus Debug

Use this skill to move from symptom to root cause with the smallest reliable scope.

## Workflow

1. Read `AGENTS.md` and `HANDOFF.md`, then read only the files directly tied to the bug.
2. Clarify the failure surface and expected behavior:
   - route or server issue
   - frontend or interaction issue
   - auth/session issue
   - SSE/streaming issue
   - service issue under `services/`
   - Ask Edgar or external-data issue
3. Reproduce the problem with the smallest useful check.
   - Prefer a focused test, route invocation, or deterministic command over broad manual guessing.
   - If the bug touches `services/`, remember the root TypeScript config excludes that directory.
4. Trace the data flow end to end.
   - **Routes:** `app/api/**/route.ts` → auth/db helpers → validations → lib helpers → schema/tests
   - **Frontend:** `app/page.tsx` orchestration → component → hook/lib helper → API route
   - **Auth:** `middleware.ts` → `lib/auth-config.ts` → `requireUser()` / `ensureUser()`
   - **SSE:** route exports (`dynamic`, `maxDuration`) → `lib/sse.ts` → auth and event payload flow
   - **Ask Edgar:** route or blueprint → `lib/askedgar.ts` cached helpers → DB cache behavior
5. Identify the exact root cause before proposing a fix. Name the file, function, and condition that fails.
6. If the user asked for a fix, make the smallest clear change and validate in repo order:
   - `npm run lint`
   - `npx tsc --noEmit`
   - `npm test`
   - plus service-local typecheck/tests when the touched area lives under `services/`
7. Report:
   - reproduction
   - root cause
   - fix applied or recommended
   - validation result
   - remaining risk

## Repo-Specific Guardrails

- Do not add new logic to `hooks/use-trades.ts`; use a smaller helper or separate hook instead.
- Keep auth fixes aligned with `requireUser()` and `parseAndValidate(...)` patterns.
- Use `getCachedTickerData` and `getCachedGainers` unless there is an explicit reason to bypass Ask Edgar caching.
- Treat in-memory state as unreliable for anything that must persist on Vercel.

## Do Not

- Do not refactor unrelated code while debugging.
- Do not claim a root cause without reproducing or tracing it.
- Do not silence lint or type errors to get a quick green check.

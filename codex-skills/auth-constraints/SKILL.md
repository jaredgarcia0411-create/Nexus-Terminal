---
name: auth-constraints
description: >
  Nexus Terminal authentication and protected-route patterns. Use when a change touches
  NextAuth, sessions, OAuth, cookies, middleware, or protected API route behavior.
---

# Auth Constraints

Use this skill when auth correctness matters. Keep it aligned with the live auth stack, not older prompt text.

## Read First

- `lib/auth-config.ts`
- `lib/server-db-utils.ts`
- `lib/api-route-utils.ts`
- `middleware.ts`
- the route or page you are changing

## Workflow

1. Confirm whether the surface is public or protected.
   - Public routes currently include `/api/health` and `/api/auth/[...nextauth]`.
   - App pages are protected by middleware except `/login` and excluded static assets.
2. Use the current auth entrypoints.
   - NextAuth config lives in `lib/auth-config.ts`.
   - `requireUser()` in `lib/server-db-utils.ts` is the protected API route gate.
   - Middleware re-exports `auth` from `lib/auth-config.ts`.
3. Follow the protected route pattern.
   - `const authState = await requireUser()`
   - `if ('error' in authState) return authState.error`
   - `const db = getDb()` or `getPoolDb()`
   - `if (!db) return dbUnavailable()`
   - `await ensureUser(db, authState.user)` when the route depends on a DB-backed user row
   - `parseAndValidate(request, schema)` for JSON body routes
   - wrap the route in `try/catch`, use `logRouteError(...)`, and return `internalServerError()` on unexpected failures
4. Keep tenant boundaries explicit.
   - Every owned record query must scope by `userId`.
   - Use `and(eq(table.userId, authState.user.id), ...)` for entity ownership checks.
5. Match current session behavior.
   - This repo uses NextAuth with JWT sessions, Google OAuth, and `/login` as the sign-in page.
   - `authorized()` in `lib/auth-config.ts` controls middleware access.
   - Avoid adding parallel auth state systems unless the user explicitly requests them.
6. Match current validation and error shapes.
   - `parseAndValidate(...)` returns `Validation failed` with `z.flattenError(...)` details on schema errors.
   - Protected routes should return structured JSON errors, never plain strings.
7. Re-test auth-sensitive work carefully.
   - Run `npm run lint`, `npx tsc --noEmit`, and `npm test`.
   - If the change affects login, middleware, or cookies, add or update focused tests where practical.

## Current Repo Reference Points

- `requireUser()` and `ensureUser()` in `lib/server-db-utils.ts`
- `parseAndValidate()`, `logRouteError()`, and `internalServerError()` in `lib/api-route-utils.ts`
- `handlers`, `auth`, `signIn`, and `signOut` in `lib/auth-config.ts`
- middleware matcher rules in `middleware.ts`

## Do Not

- Do not bypass `requireUser()` on protected routes.
- Do not omit `userId` scoping on DB-backed user data.
- Do not invent a second session/auth mechanism alongside NextAuth.
- Do not log tokens, session payloads, or sensitive request bodies.
- Do not use old Zod v3 error helpers; this repo is on Zod v4.

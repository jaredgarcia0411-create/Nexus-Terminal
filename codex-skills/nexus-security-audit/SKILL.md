---
name: nexus-security-audit
description: >
  Audit Nexus Terminal for auth, validation, secret-handling, and data-exposure risks. Use when
  the user asks for a security review of a route, feature, service, or the broader codebase.
---

# Nexus Security Audit

This is a read-first audit. Do not modify code unless the user explicitly asks for fixes.

## Workflow

1. Read `AGENTS.md`, `HANDOFF.md`, and the files in scope.
2. Scan by category:
   - **Auth / authorization** — protected routes use `requireUser()`, ownership queries scope by `userId`, middleware boundaries still make sense.
   - **Input validation** — request bodies and params use `parseAndValidate(...)` or equivalent safe parsing; Zod v4 error handling is correct.
   - **Secrets / env exposure** — API keys, tokens, OAuth secrets, and env values stay server-side and out of logs.
   - **SSE / long-running routes** — use `lib/sse.ts`, `dynamic = 'force-dynamic'`, `maxDuration = 60`, and cookie-based auth via `requireUser()`.
   - **External integrations** — Ask Edgar calls use cached helpers by default; Discord/Vercel/service tokens never leak to client code.
   - **Persistence assumptions** — no important state relies on module-level memory that will reset on Vercel cold starts.
3. Verify the most likely hot spots directly:
   - `app/api/**/route.ts`
   - `lib/server-db-utils.ts`
   - `lib/api-route-utils.ts`
   - `lib/askedgar.ts`
   - relevant client components or hooks if data crosses the server/client boundary
   - `services/**` when the scope includes Dockerized agents or bots
4. When useful, support findings with targeted searches for:
   - `process.env.`
   - `dangerouslySetInnerHTML`
   - raw SQL or shell execution
   - missing `requireUser()` or `parseAndValidate(...)`
5. Report each finding with:
   - severity
   - category
   - location
   - issue
   - proof / impact
   - specific fix

## Severity Guide

- **Critical** — credential exposure, auth bypass, cross-tenant data leak, obvious remote code or injection risk
- **High** — missing auth/ownership checks, unvalidated input on privileged routes, persistent sensitive logging
- **Medium** — weak error handling, missing rate/abuse controls, stale but risky patterns
- **Low / Info** — cleanup, hardening, or documentation gaps

## Do Not

- Do not claim a vulnerability without pointing to concrete code.
- Do not dump secret values into the report.
- Do not suggest client-side access to server-only credentials.

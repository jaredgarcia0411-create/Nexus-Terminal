---
name: nexus-askedgar-debug
description: >
  Debug Nexus Terminal's Ask Edgar research and cache pipeline. Use when the user asks about
  ticker lookups, snapshots, TLDR generation, cache behavior, quota issues, or route/blueprint
  bugs tied to Ask Edgar data.
---

# Nexus Ask Edgar Debug

Use this skill when the issue is specific to the Ask Edgar integration or the research pipeline built on top of it.

## Read First

- `AGENTS.md`
- `HANDOFF.md`
- `lib/askedgar.ts`
- the route, blueprint, or UI surface in scope

For AskEdgar endpoint schemas, query the AskEdgar MCP server instead of a local docs file.

## Workflow

1. Identify the failing surface:
   - `/api/askedgar/snapshot`
   - `/api/askedgar/tldr`
   - `lib/research.ts`
   - agent blueprints under `lib/agents/blueprints/`
2. Trace the request path end to end.
   - request validation and auth
   - cache lookup / DB availability
   - external Ask Edgar fetch path
   - normalization / summarization
   - response payload or downstream consumer
3. Check the repo-specific invariants first.
   - Use `getCachedTickerData` by default.
   - Only tolerate raw `fetchTickerData` usage when there is an explicit bypass reason.
   - Confirm `askedgar_cache` behavior matches the intended TTL expectations (16hr for ticker rows; 5min sub-TTL for the `news` endpoint inside that row; 3hr for `scanner-summary` rows).
4. Audit the likely failure classes:
   - missing or server-side-only API key handling
   - DB unavailable path not handled
   - cache miss / stale-cache logic
   - response parsing or normalization mismatch
   - quota / rate-limit / upstream timeout behavior
   - downstream prompt or report assembly issues in `lib/research.ts`
5. Check for supporting tests in `__tests__/` and identify missing coverage around the failing path.
6. If the user asked for a fix, apply the smallest safe change and validate with:
   - `npm run lint`
   - `npx tsc --noEmit`
   - `npm test`

## Output Format

- **Working**
- **Broken**
- **Missing Coverage**
- **Recommended Fix / Fix Applied**
- **Validation**

## Do Not

- Do not bypass the shared Ask Edgar cache casually; this API is usage-billed.
- Do not expose `ASKEDGAR_API_KEY` to client code or logs.
- Do not treat a route symptom as the root cause until you trace through `lib/askedgar.ts` and the consuming code.

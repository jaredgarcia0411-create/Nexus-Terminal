# Nexus Terminal - HANDOFF.md

> Updated: 2026-05-22
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and durable docs such as `docs/repo-cleanup.md`.

---

## Recently Completed

### Persist Chart Drawings + Indicators to DB

Status: completed 2026-05-22 (commit `73dcc32`).

Outcome:
- New `chart_drawings` table (PK `(user_id, ticker, bucket)`, `bucket ∈ {intraday, higher}`) with `app/api/chart-drawings` GET/PUT under `requireUser()`.
- `BacktestChartGrid` runs two bucket-keyed controllers; drawings + per-slot indicators persist per `(user, ticker, bucket)` and `BacktestChart.tsx:424` no longer gates draw on `frame.intraday` — daily/weekly/monthly slots can draw too.
- Saved reviews remain read-only and render from `chartState`; `chartStateSchema` accepts both legacy flat and new bucketed shapes (back-compat covered by `normalizeChartState`).

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` — all green (98 files, 712 tests).
- `npm run db:migrate` applied `drizzle/0042_happy_felicia_hardy.sql`.
- Manual smoke (Step 8 paths) still pending user-run dev-server validation.

---

## Session Maintenance

- Keep this file compact: active specs only while work is in flight, short summaries after validation.
- If a new multi-step feature starts, replace or append a self-contained execution spec with exact file paths, ordered changes, acceptance criteria, and validation requirements.
- If only docs/workflow assets change, run `npm run workflow:audit`.
- Do not modify `.env*` or secret files.

---

## Open Follow-Ups

- **Offerings extractors fresh-ticker smoke check**: the 2026-05-19 offerings broadening shipped, but the WNW manual smoke was inconclusive because the Research snapshot was cached. Next time Research is opened on a fresh ADS / FPI ticker whose `askedgar_cache` row has expired or does not exist, confirm Shares / Price / Amount populate for at least one priced row in Past Offerings. If every value is `--`, capture the filing URL from the row's SEC link and open a follow-up spec for the missing phrasing variant.

---

## Tier 1 Mechanical Cleanup Pass (repo-cleanup.md)

> Generated: 2026-05-22 | Agent: claude (inline)
> Status: REPO VALIDATED 2026-05-22 (manual smoke pending user-run)

Six self-contained mechanical changes drawn from `docs/repo-cleanup.md`. No design decisions — every change has an exact anchor below. Apply in order; each step is independently verifiable. Validation runs at the end.

### Step 1 — Auth-gate `/api/agents/macro-summary/latest`

**File:** `app/api/agents/macro-summary/latest/route.ts`
**Action:** MODIFY

1. Replace the import on line 5 to add `requireUser`:

   Old:
   ```ts
   import { dbUnavailable } from '@/lib/server-db-utils';
   ```
   New:
   ```ts
   import { dbUnavailable, requireUser } from '@/lib/server-db-utils';
   ```

2. Inside the `try` block, insert the auth guard as the first two lines (immediately after the `try {` opening and before `const db = getAgentDb();`):

   Old:
   ```ts
   try {
       const db = getAgentDb();
       if (!db) return dbUnavailable();
   ```
   New:
   ```ts
   try {
       const authState = await requireUser();
       if ('error' in authState) return authState.error;

       const db = getAgentDb();
       if (!db) return dbUnavailable();
   ```

Why: middleware excludes `/api`, so without `requireUser()` this route returns the global Macro Summary `reportJson` to unauthenticated callers. The row is keyed to `system-agent-user`, not the caller, so no `ensureUser` is needed — we only need the auth gate.

**Acceptance:**
- [x] `requireUser` imported from `@/lib/server-db-utils`
- [x] `authState` guard precedes the `getAgentDb()` call
- [x] No other behavior change (query, response shape, log message all unchanged)

---

### Step 2 — Auth-gate `/api/agents/market-pulse/latest`

**File:** `app/api/agents/market-pulse/latest/route.ts`
**Action:** MODIFY

1. Replace the import on line 6 to add `requireUser`:

   Old:
   ```ts
   import { dbUnavailable } from '@/lib/server-db-utils';
   ```
   New:
   ```ts
   import { dbUnavailable, requireUser } from '@/lib/server-db-utils';
   ```

2. Insert the same auth guard immediately after `try {`:

   Old:
   ```ts
   try {
       const db = getAgentDb();
       if (!db) return dbUnavailable();
   ```
   New:
   ```ts
   try {
       const authState = await requireUser();
       if ('error' in authState) return authState.error;

       const db = getAgentDb();
       if (!db) return dbUnavailable();
   ```

**Acceptance:**
- [x] `requireUser` imported
- [x] `authState` guard added before `getAgentDb()`

---

### Step 3 — Remove `@tailwindcss/typography` and broken `clean` script

**File:** `package.json`
**Action:** MODIFY

Pre-verified: `grep -r "@tailwindcss/typography\|tailwindcss/typography"` returns only the `package.json` line itself — zero imports. The `next clean` command does not exist in Next 15's CLI.

1. Delete the `clean` script. Replace:
   ```json
       "workflow:audit": "node scripts/workflow-audit.mjs",
       "clean": "next clean",
       "test": "vitest run",
   ```
   With:
   ```json
       "workflow:audit": "node scripts/workflow-audit.mjs",
       "test": "vitest run",
   ```

2. Delete the typography dep. Replace:
   ```json
       "@tailwindcss/postcss": "4.1.11",
       "@tailwindcss/typography": "^0.5.19",
       "@testing-library/react": "^16.3.0",
   ```
   With:
   ```json
       "@tailwindcss/postcss": "4.1.11",
       "@testing-library/react": "^16.3.0",
   ```

3. Run `npm install` to refresh `package-lock.json` (this removes the typography entry from the lockfile; commit both files together).

**Acceptance:**
- [x] `npm run clean` no longer exists (running it should print npm's "missing script" error)
- [x] `@tailwindcss/typography` removed from `devDependencies`
- [x] `package-lock.json` updated by `npm install`
- [x] `npm run lint && npx tsc --noEmit && npm test` all still pass

---

### Step 4 — Fix helper + migration drift in `docs/ARCHITECTURE.md`

**File:** `docs/ARCHITECTURE.md`
**Action:** MODIFY

Pre-verified ownership:
- `lib/server-db-utils.ts` exports `requireUser`, `requireCronSecret`, `dbUnavailable`, `ensureUser`.
- `lib/agents/admin.ts` exports `requireAgentAdmin`, `requireServiceAuth`, `requireServiceKey`.
- `lib/api-route-utils.ts` exports `parseAndValidate`, `logRouteError`, `internalServerError`, `TICKER_REGEX`, `normalizeTicker`, `toNumberOrUndefined`.

1. Fix the `api-route-utils.ts` row in the `lib/` map. Replace:
   ```
   ├── api-route-utils.ts      ← requireUser, requireAgentAdmin, requireServiceAuth helpers
   ```
   With:
   ```
   ├── api-route-utils.ts      ← parseAndValidate, logRouteError, internalServerError, ticker helpers
   ```

2. Add an explicit row for `server-db-utils.ts` (which is currently buried in the misc grouping on line 80). Replace:
   ```
   └── time-utils.ts, types.ts, utils.ts, research.ts, server-db-utils.ts  ← misc shared
   ```
   With:
   ```
   ├── server-db-utils.ts      ← requireUser, requireCronSecret, ensureUser, dbUnavailable
   └── time-utils.ts, types.ts, utils.ts, research.ts  ← misc shared
   ```
   (Note the box-drawing character flip from `└──` to `├──` on the new line, and `└──` on the trailing misc line.)

3. Fix the migration flow note. Replace:
   ```markdown
   - **`lib/db/schema.ts`** → run `npm run db:migrate` (never `db:push` — see `MEMORY.md`). Generates a new file in `drizzle/`.
   ```
   With:
   ```markdown
   - **`lib/db/schema.ts`** → run `npm run db:generate` to create a numbered SQL file in `drizzle/`, inspect the SQL, then `npm run db:migrate` to apply it. Never `db:push` — see `MEMORY.md`.
   ```

**Acceptance:**
- [x] `api-route-utils.ts` row lists validation/error helpers, not auth helpers
- [x] `server-db-utils.ts` has its own row listing the auth/db helpers
- [x] Migration note describes the two-step generate → migrate flow
- [x] No other lines in `ARCHITECTURE.md` touched

---

### Step 5 — Refresh Ask Edgar drift in `AGENTS.md` and `docs/ae-buildout.md`

**File A:** `AGENTS.md`
**Action:** MODIFY

Replace the Ask Edgar bullet (line 63). Replace:
```markdown
- **Ask Edgar API is usage-billed** — always use `getCachedTickerData` from `lib/askedgar.ts` instead of the raw `fetchTickerData`. The cached version uses a DB-backed TTL of 16hr per-ticker row, with a 15min sub-TTL on the `news` endpoint inside that row, via the shared `askedgar_cache` table. Only call the raw function if you have an explicit reason to bypass the cache. The `filing-titles` endpoint is sourced from SEC EDGAR (not AskEdgar) via `lib/sec/submissions.ts`; the swap is invisible to callers because the result lands in the same `rawData['filing-titles']` slot.
```
With:
```markdown
- **Ask Edgar API is usage-billed** — always use `getCachedTickerData` from `lib/askedgar.ts` instead of the raw `fetchTickerData`. The cached version uses a DB-backed TTL of 16hr per-ticker row, with a 15min sub-TTL on the `news` endpoint inside that row, via the shared `askedgar_cache` table. Only call the raw function if you have an explicit reason to bypass the cache. The `sec-filings` endpoint is sourced from SEC EDGAR (not AskEdgar) via `lib/sec/submissions.ts`; the result lands in `rawData['sec-filings']`. Current `ENDPOINT_SCOPES` in `lib/askedgar/endpoints.ts`: `snapshot`, `scanner-summary`, `small-cap-research`, `swing-trader-research`.
```

**File B:** `docs/ae-buildout.md`
**Action:** MODIFY

1. Remove the dead `askedgar_daily_tickers` reference (pre-verified: no code reads `dailyTickers`, `askedgar_daily_tickers`, or `ASKEDGAR_DAILY_LIMIT`). Replace:
   ```markdown
   Runtime state:

   - Daily unique ticker usage lives in `askedgar_daily_tickers`.
   - Global rate-limit retry window lives in `askedgar_runtime_state`.
   - Module memory is still used as a fast path, but the DB is the durable state across cold starts.
   - `ASKEDGAR_DAILY_LIMIT` defaults to 50 when not configured.
   ```
   With:
   ```markdown
   Runtime state:

   - Global rate-limit retry window lives in `askedgar_runtime_state`.
   - Module memory is still used as a fast path, but the DB is the durable state across cold starts.
   ```

2. Update the Scope Inventory bullet list to match the live registry (`tldr` and `lookup` are gone; `scanner-summary` is now a real scope). Replace:
   ```markdown
   Current scopes in `ENDPOINT_SCOPES`:

   - `snapshot`: all 16 registry keys.
   - `tldr`: all 16 registry keys.
   - `lookup`: all 16 registry keys, but no live `/api/askedgar/lookup` route exists.
   - `small-cap-research`: all 16 registry keys.
   - `swing-trader-research`: `dilution-data`, `dilution-rating`, `offerings`, `registrations`, `news`, `historical-float-pro`, `gap-stats`, `ownership`.
   ```
   With:
   ```markdown
   Current scopes in `ENDPOINT_SCOPES`:

   - `snapshot`: all 15 registry keys.
   - `scanner-summary`: `registrations`, `dilution-rating`, `dilution-data`, `equity-lines`.
   - `small-cap-research`: all 15 registry keys.
   - `swing-trader-research`: `dilution-data`, `dilution-rating`, `offerings`, `registrations`, `news`, `historical-float-pro`, `gap-stats`, `ownership`.
   ```

**Acceptance:**
- [x] `AGENTS.md` line 63 references `sec-filings` (not `filing-titles`) and names the four current scopes
- [x] `docs/ae-buildout.md` Runtime state section drops both `askedgar_daily_tickers` and `ASKEDGAR_DAILY_LIMIT`
- [x] `docs/ae-buildout.md` Scope Inventory lists exactly four scopes (`snapshot`, `scanner-summary`, `small-cap-research`, `swing-trader-research`) and uses `15` not `16` for the `all-keys` rows

---

### Step 6 — Remove the stale "Compact HANDOFF.md" finding from `docs/repo-cleanup.md`

**File:** `docs/repo-cleanup.md`
**Action:** MODIFY

The Playbook spec was already compacted out of `HANDOFF.md` in commits `ac6f3b4` and `f7f6291`; this finding now describes work that's already done.

Replace:
```markdown
## Docs And Workflow Drift

### Compact Completed Specs Out Of `HANDOFF.md`

Evidence:
- `HANDOFF.md` still contains a completed Playbook execution spec: [HANDOFF.md](/home/jared/Nexus-Terminal/HANDOFF.md:16), [HANDOFF.md](/home/jared/Nexus-Terminal/HANDOFF.md:19).
- Agents are required to read `HANDOFF.md` first and follow active execution specs in order: [AGENTS.md](/home/jared/Nexus-Terminal/AGENTS.md:16), [AGENTS.md](/home/jared/Nexus-Terminal/AGENTS.md:19).

Recommendation:
Move completed Playbook detail to summary mode and keep only active follow-ups. This is not a product behavior change; it prevents future agents from treating completed work as current execution scope.

### `workflow:audit` Is A Narrow Smoke Check, Not The Full Skill Audit
```
With:
```markdown
## Docs And Workflow Drift

### `workflow:audit` Is A Narrow Smoke Check, Not The Full Skill Audit
```

**Acceptance:**
- [x] The "Compact Completed Specs Out Of `HANDOFF.md`" subsection is gone
- [x] Completed Tier 1 findings were cleared from `docs/repo-cleanup.md`; the remaining Docs And Workflow Drift finding stays open

---

### Files Changed Summary

| File | Lines +/− | Risk |
|------|-----------|------|
| `app/api/agents/macro-summary/latest/route.ts` | +3 −1 | Low — auth-gate only, no behavior change for logged-in callers |
| `app/api/agents/market-pulse/latest/route.ts` | +3 −1 | Low — same pattern |
| `package.json` | +0 −2 | Low — script + dep deletion |
| `package-lock.json` | regenerated | Low |
| `docs/ARCHITECTURE.md` | +2 −2 | Doc-only |
| `AGENTS.md` | +1 −1 | Doc-only |
| `docs/ae-buildout.md` | +3 −8 | Doc-only |
| `docs/repo-cleanup.md` | +0 −9 | Doc-only |

---

### Verification Steps

Run from repo root, all must pass:

1. `npm install` (refreshes lockfile after dep removal)
2. `npm run lint`
3. `npx tsc --noEmit`
4. `npm test`
5. `npm run workflow:audit` (required because `AGENTS.md` changed)
6. `! npm run clean 2>&1 | grep -q "missing script"` (confirms script was actually deleted)
7. `! grep -q "@tailwindcss/typography" package.json` (confirms dep gone)
8. Manual smoke: hit `/api/agents/macro-summary/latest` and `/api/agents/market-pulse/latest` in an incognito browser tab — both should return `401 Unauthorized`. Then hit them while logged in — both should return their normal JSON payload.

---

## Implementation Style

Write the simplest correct code that satisfies this spec. Specifically:

- Match the existing conventions in the file you're editing. Do not introduce new patterns, helpers, abstractions, or file layouts unless this spec explicitly calls for them.
- No future-proofing. No feature flags, no "in case we need it later" parameters, no extracted helpers that have a single caller. If a value is only used once, inline it.
- No defensive code at internal boundaries. Trust your own code and framework guarantees; validate only at system boundaries (user input, external APIs, DB reads of untrusted JSON).
- No comments unless the *why* is non-obvious (a hidden constraint, a workaround, a surprising invariant). Don't restate what the code says.
- If a step in this spec looks more complex than it needs to be, flag it and propose the simpler version before implementing — don't silently "improve" the spec, but don't write code that's more elaborate than the problem requires either.
- If you spot an existing simpler pattern in the codebase that fits, use it instead of writing new code.

This is a personal trading platform built solo. Readability > cleverness; debuggable > elegant; small diff > sweeping refactor. Three similar lines beats a premature abstraction.

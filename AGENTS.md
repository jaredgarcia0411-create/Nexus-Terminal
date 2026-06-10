# Nexus Terminal - Agent Guide

This file is for coding agents working in this repository.
Follow these rules to match existing architecture and coding style.

## Project Snapshot
- Framework: Next.js 15 + React 19 + TypeScript 5.9.
- Package manager: npm.
- Deployment target: Vercel.
- DB: PostgreSQL (Neon) via Drizzle ORM.
- Auth: NextAuth (Google OAuth) + app session logic.
- Styling: Tailwind CSS v4 + shadcn/Radix UI primitives.
- Tests: Vitest (not Jest).

## Required Workflow (Always)
1. Read `HANDOFF.md` first to check for an active execution spec and recent repo context.
2. For codebase structure (where things live, which files pair together), consult `docs/ARCHITECTURE.md` — do not re-derive it by traversing the tree.
3. Preserve architecture; do not refactor unrelated areas.
4. If `HANDOFF.md` contains an active execution spec, implement changes in the exact order described there. If it does not, use live repo context plus this file.
5. Never modify `.env`, `.env.local`, or secret files.
6. After code changes, run lint, type-check, and tests.
7. If a command fails, fix the issue before finishing.

## Core Commands
- Install deps: `npm install`
- Dev server: `npm run dev`
- Production build: `npm run build`
- Start production server: `npm run start`
- Lint: `npm run lint`
- Type-check: `npx tsc --noEmit`
- Services type-check: `npm run typecheck:services`
- Workflow drift audit: `npm run workflow:audit`
- Full test suite: `npm test`
- Watch mode tests: `npm run test:watch`

## Single-Test Commands (Important)
- Run one file: `npx vitest run __tests__/csv-parser.test.ts`
- Run one file (alternative): `npm test -- __tests__/csv-parser.test.ts`
- Run tests matching a name: `npx vitest run -t "stores explicit timezone timestamps"`
- Run one file in watch mode: `npx vitest __tests__/trades-route.test.ts`

## Required Validation Before Handoff
Run in this order from repo root:
1. `npm run lint`
2. `npx tsc --noEmit`
3. If touched files include `services/`, `npm run typecheck:services`
4. `npm test`

Report pass/fail for each command.

## Monorepo/Subproject Notes
- Main app TypeScript excludes `services/` from root `tsconfig.json`.
- Any session touching `services/` must run `npm run typecheck:services` because the root type-check does not cover that tree.

## Architecture Guardrails
- Keep page-level orchestration in `app/page.tsx`; move business logic to hooks/lib.
- API handlers live in `app/api/**/route.ts`.
- DB schema is centralized in `lib/db/schema.ts`.
- Server auth/db helpers are in `lib/server-db-utils.ts`.
- Avoid introducing new global patterns when existing modules already cover the need.
- **SSE endpoints** use `lib/sse.ts` (`createSSEResponse` helper). Set `export const dynamic = 'force-dynamic'` and `export const maxDuration = 60` on all SSE routes. Auth via `requireUser()` — EventSource sends cookies automatically.
- **Keyboard shortcuts** use `react-hotkeys-hook`. Global shortcuts are registered in `hooks/use-global-shortcuts.ts` and called once from `app/page.tsx`. The command palette component lives at `components/trading/CommandPalette.tsx`.
- **Sheets** live as their own top-level tab between Charts and Research. Routes are in `app/api/sheets/**`, validation is in `lib/validations/sheets.ts`, role checks use `getSheetRole()` from `lib/sheets/access.ts`, and grid helpers live in `lib/sheets/`. Saved sheets use a compact top-bar lineage picker grouped by `rootId`; duplicate sheets inherit `source.rootId ?? source.id`. The locked default cells are active: `research_report` opens the saved report, `chart` derives from the row `ticker` + `date`, `action` opens the sample-set save picker, and `watchlist` adds the row ticker plus Tag to today's Daily Review watchlist. Research page imports use `POST /api/sheets/[id]/append-research-row`, append `{ ticker, date, research_report? }`, and dedupe by `(ticker, date)`. Editors/owners can drag-reorder rows via @dnd-kit row handles; owners can reorder columns and delete user-added columns.
- **Ask Edgar API is usage-billed** — always use `getCachedTickerData` from `lib/askedgar.ts` instead of the raw `fetchTickerData`. The cached version uses a DB-backed TTL of 16hr per-ticker row, with a 15min sub-TTL on the `news` endpoint inside that row, via the shared `askedgar_cache` table. Only call the raw function if you have an explicit reason to bypass the cache. The `sec-filings` endpoint is sourced from SEC EDGAR (not AskEdgar) via `lib/sec/submissions.ts`; the result lands in `rawData['sec-filings']`. The `news` endpoint is sourced from **EODHD** (not AskEdgar) via `fetchEodhdNews` in `lib/eodhd.ts` (requires the `EODHD_API_KEY` env var); it returns the same `AskEdgarResponse` shape and lands in `rawData['news']`, so it keeps the 15min sub-TTL. Current `ENDPOINT_SCOPES` in `lib/askedgar/endpoints.ts`: `snapshot`, `scanner-summary`, `small-cap-research`, `swing-trader-research`.
- **SEC EDGAR fetches go through `lib/sec/`** — use `getRecentFilings(ticker, opts)` from `lib/sec/submissions.ts` for filings, `getCikForTicker(ticker)` from `lib/sec/cik-map.ts` for ticker→CIK lookups, and `secFetchJson(url)` from `lib/sec/client.ts` for any other SEC endpoint. The shared client enforces SEC's User-Agent requirement (`Nexus Terminal jared.garcia0411@gmail.com`), the 10 req/sec rate limit, and 429/503 retries. Do not call SEC URLs with `fetch()` directly.
- **Do not add logic to `hooks/use-trades.ts`** — it is a god hook being decomposed into `lib/trade-utils.ts` (pure business logic), `hooks/use-trade-filters.ts` (filter/search state), and `hooks/use-trade-sync.ts` (persistence). If you need new trade-related state, create a separate hook in `hooks/`. Note: `lib/ui-trade-utils.ts` is a separate file containing **UI formatting helpers** (formatCurrency, formatR, getPnLColor) — do not confuse it with `lib/trade-utils.ts`.
- **In-memory state is unreliable on Vercel** — module-level `Map`s, objects, or variables reset on every cold start. Use the database or an external store (e.g., Upstash Redis) for any state that must persist across requests.

## API Route Conventions
- Use the auth helper that matches the route surface. Default to `requireUser()` for user-scoped routes; cron, service, and agent-admin routes use their dedicated helpers.
- For DB-backed routes:
  - `const db = getDb()`
  - guard with `if (!db) return dbUnavailable()`
  - call `ensureUser(db, authState.user)` when needed.
- **Validate input with Zod** — Use `parseAndValidate(request, schema)` from `lib/api-route-utils.ts` with Zod schemas from `lib/validations/` (for example `trades.ts`, `system.ts`, `agents.ts`, and feature-specific files). Returns `{ data }` or `{ error: Response }`. This project uses **Zod v4** — use `z.flattenError(result.error)` (standalone function), NOT `result.error.flatten()` (v3 method). Always add `.max()` bounds on user-controlled string fields (e.g., `.max(20)` for symbols, `.max(10000)` for notes) — PostgreSQL `text` has no inherent limit.
- Return structured errors via `Response.json({ error: '...' }, { status })`.
- In `catch`, log safely and return generic server errors (no secret leakage).

## Security Rules
- Never expose API keys, OAuth tokens, JWT secrets, or env values.
- Never log sensitive payloads or credentials.
- Keep `ASKEDGAR_API_KEY` and similar values server-side only.
- Do not commit `.env*` or credentials files.

## TypeScript Rules
- `strict` mode is enabled: keep types explicit and correct.
- Avoid `any`; use `unknown` in catch blocks and narrow safely.
- Prefer shared domain types from `lib/types.ts` and nearby modules.
- Use `import type` for type-only imports where appropriate.
- Keep API input/output shapes typed (request body, response payloads).
- Favor small helper functions for reusable normalization/parsing logic.

## Import Conventions
- Use path alias `@/*` for internal imports.
- Typical order:
  1) third-party packages
  2) internal `@/` modules
  3) type imports (or inline `type` specifiers)
- Keep imports grouped and stable; avoid deep relative paths when alias works.
- Match existing file style (some generated shadcn files use double quotes/no semicolons).

## Naming Conventions
- Components: PascalCase (`TradesTab.tsx`).
- Hooks: `useX` camelCase (`useTrades`).
- Utilities/functions/vars: camelCase.
- Constants: UPPER_SNAKE_CASE for true constants.
- Route files: `route.ts` within feature folders.
- Test files: `*.test.ts` under `__tests__/`.

## Formatting and Style
- Follow existing style in each file; do not reformat unrelated code.
- Prefer simple, readable logic over clever abstractions.
- Keep functions focused; extract helpers when a block becomes hard to read.
- Use early returns for validation/guard clauses.
- Add comments only when logic is non-obvious.

## Error Handling Patterns
- Fail fast on invalid input with 4xx responses.
- Use defaults with `??` for optional numeric fields when appropriate.
- Preserve useful user-facing error messages without exposing internals.
- In UI hooks/components, surface actionable errors (toast/state) and avoid crashes. Wrap **all** data-writing async functions in `withErrorToast` from `use-trades.ts` — silent failures on saves/deletes are the worst UX. If a hook function calls an API that persists data, it must have error feedback.
- In server routes, prefer consistent generic 500 responses for unexpected errors.

## Testing Conventions
- Test runner: Vitest with config in `vitest.config.ts`.
- Test include pattern: `__tests__/**/*.test.ts`.
- Mocking style uses `vi.mock`, often with `vi.hoisted` for shared mocks.
- Keep tests deterministic; mock DB/auth/network boundaries.
- Co-locate route behavior coverage in `__tests__/` by endpoint/feature.
- **When changing validation approach** (e.g., manual checks → Zod), grep tests for old error format assertions. `parseAndValidate` returns `{ error: 'Validation failed', details: { fieldErrors, formErrors } }`, not the old `{ error: 'field is required' }` shape.

## Database and Migrations
- Drizzle commands:
  - `npm run db:generate`
  - `npm run db:migrate`
  - `npm run db:push` (dev only)
  - `npm run db:studio`
- Do not change schema/migrations unless explicitly requested by the spec.

## Docs and Handoff Updates
- After completing session work, update `HANDOFF.md` only when the spec requires checkpoint evidence or the user asks for a status/handoff edit. Do not mark a spec `READY TO SHIP`, `reviewed against spec`, or otherwise final-reviewed unless Jared explicitly instructs that status; report implementation and validation results in chat for Jared/Claude review.
- For cleanup or tech-debt work, check `docs/repo-cleanup.md` first — it is the canonical prioritized list of cleanup items maintained across audit sessions.
- Repo-maintained Codex skill sources live in `codex-skills/`; some also expose user-facing agent metadata in `codex-skills/*/agents/openai.yaml` when that file exists.
- Repo-local skill files do not automatically make a skill callable in the current Codex session. To surface a repo-maintained skill in the skill list, install or sync it into `~/.codex/skills/<skill-name>` and restart Codex.
- High-value repo-maintained Codex skills include `nexus-execute`, `nexus-status`, `nexus-debug`, `nexus-review`, `nexus-security-audit`, and `nexus-askedgar-debug`; prefer them when the user explicitly asks for those workflows.
- Keep Codex skill text, agent metadata, `AGENTS.md`, and `HANDOFF.md` aligned when durable workflow behavior changes.
- Ignore `.claude/` and `.opencode/` unless the user explicitly asks for cross-tool alignment work.
- When aligning `.claude/` or `.opencode/`, treat `AGENTS.md` as the canonical source and keep tool-specific files thin.
- When changing workflow assets under `AGENTS.md`, `HANDOFF.md`, `.claude/`, `.opencode/`, or `codex-skills/`, run `npm run workflow:audit`.
- A project `README.md` already exists. Update it only when explicitly requested or when the task changes durable repo-facing setup or usage guidance.

## Cursor and Copilot Rules
- Checked for Cursor rules: no `.cursor/rules/` or `.cursorrules` found.
- Checked for Copilot rules: no `.github/copilot-instructions.md` found.
- If these files are added later, treat them as required repository instructions.

## Agent Behavior Expectations
- Be concise and practical.
- Explain why when introducing non-obvious patterns.
- Do not add dependencies unless required.
- Do not run destructive git commands.
- Do not create commits unless explicitly requested.
- For command workflows that generate docs/reports, default to concise findings in chat. Save an artifact only when the user asks for one or the workflow explicitly requires a durable file.
- When the user explicitly asks to load a skill, load it first and follow that skill workflow verbatim.
- If a workflow requires a specific output format (for example, full report vs summary), match it exactly and do not substitute a condensed version.

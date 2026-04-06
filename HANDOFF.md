# Nexus Terminal — HANDOFF.md

## Active Handoff Only

Historical completed sections removed — use git history and `specs/` for archived detail.

---

## Test Quality Quick Wins

> Generated: 2026-04-06 | Agent: Remi
> Status: COMPLETE

### Objective

Implement the critical test-isolation fix and all audit quick wins: add DOM test support with `@testing-library/react` + `jsdom`, replace brittle component smoke tests with behavior tests, add direct coverage for the untested AskEdgar/TradingView routes, and reduce implementation-detail assertions in the existing server/route tests.

### Delivered

- Added `@testing-library/react` and `jsdom`, updated `package-lock.json`, and enabled conditional Testing Library cleanup in `vitest.setup.ts` without switching the global Vitest environment to jsdom.
- Fixed the AskEdgar client mock-isolation issue by clearing mocks before module restore/reset in `__tests__/askedgar-client.test.ts`.
- Added direct route coverage for:
  - `GET /api/askedgar/lookup`
  - `POST /api/askedgar/tldr`
  - `GET /api/tradingview/gainers`
- Replaced the static markup smoke tests for `ResearchTab` and `ChartsTab` with jsdom behavior tests focused on visible user interactions.
- Reduced implementation-detail coupling in `__tests__/server-db-utils.test.ts` and simplified the success-path assertions in `__tests__/market-data-route.test.ts`.
- Ran focused Vitest coverage for every touched test file while building.

### Validation

- Focused test runs completed for:
  - `__tests__/askedgar-client.test.ts`
  - `__tests__/askedgar-lookup-route.test.ts`
  - `__tests__/askedgar-tldr-route.test.ts`
  - `__tests__/tradingview-gainers-route.test.ts`
  - `__tests__/research-tab.test.tsx`
  - `__tests__/charts-tab.test.ts`
  - `__tests__/server-db-utils.test.ts`
  - `__tests__/market-data-route.test.ts`
- Final validation passed:
  - `npm run lint` ✅
  - `npx tsc --noEmit` ✅
  - `npm test` ✅
- Manual visual-check items: none performed; this was a test-only spec.

---

## Low-Priority Spec Cleanup (AGENTIC_EXPANSIONV2.md)

Minor follow-ups from the 2026-03-29 review; none block sprint import.
- **R8:** Deduplicate repeated `step_log` guidance; replace the duplicate with a cross-reference to Section 3.2.
- **R9:** Keep "multi-agent fanout deferred to V2" only in the Executive Summary and Section 13 closing note; trim the other repeats to cross-references.
- **R10:** Make Section 20 Discord Adapter reference Section 13 for the 120s/60-attempt polling timeout instead of restating it.
- **M2:** Clarify in Section 19 that the budget is enforced per-agent, so `$5/day` across 3 agents means `$15/day` total.
- **M3:** Add `idempotencyKey: 'swing-research-{ticker}-{date}'` to `swing:research` step 6 metadata.
- **M4:** State that Vercel routes use `getDb()` from `lib/server-db-utils.ts` and Docker workers use `getAgentDb()` from `lib/agents/db.ts`; never mix them.
- **B11:** Add `chat-helpers.ts` and `historical-summary.ts` to the Phase 7 delete list in Section 18.
- **B15/B18:** Audit existing `services/discord-bot/` contents before Phase 5 Step 44, and define `services/.env.example` from Docker Compose `environment:` blocks.

---

## Build Spec — Three-Phase Simplification

> Generated: 2026-04-03 | Agent: nexus-architect
> Status: COMPLETE

### Objective

Replace the AskEdgar gainers list in Research tab with TradingView screener data, remove the Jarvis tab and all its infrastructure, remove the Markets tab and its Schwab/relay infrastructure. The result is a 6-tab app with a leaner `lib/` directory and no dead Schwab/relay code.

## Phase 1: TradingView Screener as Top Gainers Source

**Status:** COMPLETE

### Delivered

- Added authenticated TradingView screener route at `app/api/tradingview/gainers/route.ts`.
- Replaced Research tab gainers source with TradingView data in `components/trading/ResearchGainersList.tsx`.
- Added near-real-time polling every 60 seconds plus LIVE / 15-MIN DELAY badge based on `TRADINGVIEW_SESSION_ID`.
- Removed the legacy AskEdgar gainers route and deleted the empty `app/api/askedgar/gainers/` directory.
- Manual validation completed: Research sidebar selection still updates the ticker view, and the LIVE / 15-MIN DELAY badge behavior was confirmed.

---

## Phase 2: Remove Jarvis Tab

**Status:** COMPLETE

### Delivered

- Relocated `lib/jarvis/askedgar.ts` → `lib/askedgar.ts`, `lib/jarvis/client.ts` → `lib/llm-client.ts`, and `lib/jarvis/research.ts` → `lib/research.ts`.
- Inlined `DilutionDataSourceCheck` into `lib/askedgar.ts` and `buildResearchTldrPrompt` into `lib/research.ts`, eliminating `lib/jarvis/types.ts` and `lib/jarvis/prompts.ts` dependencies.
- Updated all AskEdgar routes to use the new shared library paths.
- Reduced the shell to a 6-tab app by removing Jarvis and Markets from `app/page.tsx`, `components/trading/Sidebar.tsx`, `components/trading/CommandPalette.tsx`, and `hooks/use-global-shortcuts.ts`.
- Deleted Jarvis UI files, Jarvis API routes, `lib/validations/jarvis.ts`, the full `lib/jarvis/` directory, 11 Jarvis tests, and `.claude/commands/jarvis-prompt-tuner.md`.
- Preserved Discord historical summary refresh behavior by inlining the former `updateTickerSummary` logic into `lib/discord/client.ts` before deleting `lib/jarvis/historical-summary.ts`.
- Removed `macro_summaries`, `jarvis_conversations`, and `jarvis_request_log` from `lib/db/schema.ts`, then generated and applied `drizzle/0017_magical_nocturne.sql`.
- Validation passed: `npm run lint`, `npx tsc --noEmit`, `npm test`, and grep for `@/lib/jarvis/` returned zero TypeScript/TSX matches.

---

## Phase 3: Remove Markets Tab

**Status:** COMPLETE

### Delivered

- Deleted the remaining Markets UI and scanner infrastructure: `components/trading/MarketsTab.tsx`, `components/trading/ScannerSection.tsx`, `hooks/use-market-stream.ts`, `hooks/use-relay-socket.ts`, `hooks/use-schwab-status.ts`, and `hooks/use-scanner.ts`.
- Removed Markets / Schwab / relay API routes and cleaned the empty route directories while preserving `app/api/market-data/route.ts` and `app/api/market-data/daily-summary/route.ts`.
- Deleted Markets-specific libraries plus `lib/schwab/`, removed `services/schwab-relay/`, and deleted obsolete route/component tests tied to the removed infrastructure.
- Dropped `market_snapshots`, `schwab_links`, `realtime_quotes`, and `scanner_presets` from `lib/db/schema.ts`, then generated and applied `drizzle/0018_nasty_warbird.sql`.
- Updated `.claude/CLAUDE.md` and `AGENTS.md` to reflect the 6-tab app, 17 API routes, 7 hooks, `lib/askedgar.ts`, and the removal of Schwab relay guidance.

### Validation

- `npm run lint` ✅
- `npx tsc --noEmit` ✅
- `npm test` ✅
- Grep checks for `@/lib/jarvis/`, `@/lib/schwab`, `MarketsTab`, `JarvisTab`, `use-market-stream`, `use-relay-socket`, `use-schwab-status`, and `use-scanner` returned zero TypeScript/TSX matches.
- Verified kept files still exist: `app/api/market-data/route.ts`, `app/api/market-data/daily-summary/route.ts`, `lib/massive-market.ts`, `lib/askedgar.ts`, `lib/llm-client.ts`, `lib/research.ts`, `app/api/tradingview/gainers/route.ts`.

---

## Security Note

- `TRADINGVIEW_SESSION_ID` is read only server-side — never sent to the client
- Removed Schwab OAuth routes eliminate that attack surface entirely
- All remaining routes still use `requireUser()` auth

## Manual Steps (outside this spec)

- [ ] Add `TRADINGVIEW_SESSION_ID=<value>` to `.env.local` (get from TradingView DevTools → Cookies)
- [ ] Add `TRADINGVIEW_SESSION_ID` to Vercel environment variables
- [ ] Destroy Fly.io relay: `fly apps destroy nexus-schwab-relay`
- [ ] Remove Schwab OAuth app credentials (revoke at developer.schwab.com)
- [ ] Remove Jarvis/LLM env vars from Vercel (`JARVIS_API_KEY`, `JARVIS_API_BASE_URL`, `JARVIS_MODEL`, `JARVIS_ADMIN_KEY`)

---

## Condense intradayNotes

These entries in `scripts/trade-examples-template.json` have intradayNotes that are too long (~500-630 chars). Target ~350-400 chars max. Keep the key entries, adds, stops, and covers but cut the play-by-play detail.

Work through these one at a time, reviewing the screenshot alongside each entry.

### Must condense (~550-630 chars)

1. **PAVM 1-21-26** (~630 chars) — 3 separate entry attempts, lots of price detail
2. **KLTO 6-10-25** (~600 chars) — 3 entry attempts with many adds, very granular price tracking
3. **BNAI 1-26-26** (~600 chars) — long entry sequence + re-entry attempt at the end
4. **USO 3-9-26** (~570 chars) — multiple entry/re-entry cycles with detailed price levels
5. **NAMM 1-28-26** (~560 chars) — many small adds across PM, open, and AH
6. **EVTV 1-13-26** (~530 chars) — detailed stop/re-entry sequence
7. **AMCI 12-15-25** (~530 chars) — includes SPAC context explanation that could be moved to dailyNotes

### Borderline (~500-520 chars, condense if possible)

8. **GITS 1-27-26** (~520 chars)
9. **ROLR 1-14-26** (~510 chars)

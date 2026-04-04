# Nexus Terminal — HANDOFF.md

## Active Handoff Only

Historical completed sections removed — use git history and `specs/` for archived detail.

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

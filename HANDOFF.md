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
> Status: IN PROGRESS — Phases 1-2 complete, awaiting manual validation before Phase 3

### Objective

Replace the AskEdgar gainers list in Research tab with TradingView screener data, remove the Jarvis tab and all its infrastructure, remove the Markets tab and its Schwab/relay infrastructure. The result is a 6-tab app with a leaner `lib/` directory and no dead Schwab/relay code.

### IMPORTANT: Order of Operations

Execute phases in strict order: Phase 1, then Phase 2, then Phase 3. Run `npm run lint && npx tsc --noEmit` after every phase before starting the next.

### Pre-Execution Findings

Before opencode touches a single line, it must understand these structural constraints (confirmed by reading the actual files):

1. `lib/jarvis/research.ts` imports `buildResearchTldrPrompt` from `lib/jarvis/prompts`. When `research.ts` moves, that function must move with it (inline it into `lib/research.ts`).
2. `lib/jarvis/askedgar.ts` imports `DilutionDataSourceCheck` from `lib/jarvis/types`. This type must be inlined into `lib/askedgar.ts` since `lib/jarvis/types.ts` is being deleted.
3. `components/trading/MarketsTab.tsx` imports `JarvisMacroSummaryOutput` from `lib/jarvis/types`. Since MarketsTab is being deleted entirely in Phase 3, this is not a migration concern.
4. `app/api/market-data/route.ts` (candle aggregation for Charts tab) is NOT in the delete list. Keep it.
5. `lib/massive-market.ts` is NOT in the delete list — used by `daily-summary` and `askedgar/snapshot` routes.
6. The `Sidebar.tsx` TabKey type (line 10) and `navItems` array (lines 44-53) both need `'markets'` and `'jarvis'` removed. The `CommandPalette.tsx` NAV_ITEMS array (lines 16-30) and the "Jarvis" CommandGroup (lines 94-119) must be removed.
7. `hooks/use-global-shortcuts.ts` TAB_KEYS array (line 6) must drop `'markets'` and `'jarvis'`. The `ctrl+j` hotkey (lines 33-39) must be removed. Numbered hotkeys remap by index position after two tabs are removed.

---

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

### Step 3.1: Delete MarketsTab component

**File:** `components/trading/MarketsTab.tsx`
**Action:** DELETE

Already removed from `app/page.tsx` in Step 2.5.

**Acceptance criteria:**
- [ ] File deleted
- [ ] Grep for `MarketsTab` returns zero results

---

### Step 3.2: Delete Markets-specific hooks

**Action:** DELETE (grep to confirm nothing else imports these before deleting):
- `hooks/use-market-stream.ts`
- `hooks/use-relay-socket.ts`
- `hooks/use-schwab-status.ts`
- `hooks/use-scanner.ts`

**Acceptance criteria:**
- [ ] All 4 hook files deleted
- [ ] `npx tsc --noEmit` passes

---

### Step 3.3: Delete Markets-specific API routes

**Action:** DELETE the following files and clean up empty directories:
- `app/api/market-data/snapshot/route.ts` (remove `snapshot/` dir)
- `app/api/market-data/stream/route.ts` (remove `stream/` dir)
- `app/api/market-data/movers/route.ts` (remove `movers/` dir)
- `app/api/relay-token/route.ts` (remove `relay-token/` dir)
- `app/api/schwab/auth/route.ts`
- `app/api/schwab/callback/route.ts`
- `app/api/schwab/status/route.ts` (remove `schwab/` dir)
- `app/api/scanner/presets/route.ts` (remove `presets/` dir)
- `app/api/scanner/route.ts` (remove `scanner/` dir)

**DO NOT DELETE:**
- `app/api/market-data/route.ts` — used by ChartsTab for candle data
- `app/api/market-data/daily-summary/route.ts` — used by ChartsTab for OHLCV data

**Acceptance criteria:**
- [ ] `app/api/schwab/` does not exist
- [ ] `app/api/relay-token/` does not exist
- [ ] `app/api/scanner/` does not exist
- [ ] `app/api/market-data/snapshot/`, `stream/`, `movers/` do not exist
- [ ] `app/api/market-data/route.ts` and `daily-summary/route.ts` still exist

---

### Step 3.4: Delete Markets-specific lib files

**Action:** DELETE (grep to confirm each is only imported by files being deleted):
- `lib/market-symbols.ts`
- `lib/quote-mappers.ts`
- `lib/realtime-snapshot.ts`
- `lib/relay-types.ts`
- `lib/schwab/auth.ts`
- `lib/schwab/crypto.ts` (then remove `lib/schwab/` dir)
- `lib/massive-snapshot.ts`

**DO NOT DELETE:**
- `lib/massive-market.ts` — used by `daily-summary` and `askedgar/snapshot` routes

**Acceptance criteria:**
- [ ] All 7 files and `lib/schwab/` directory deleted
- [ ] `lib/massive-market.ts` still exists
- [ ] `npx tsc --noEmit` passes

---

### Step 3.5: Delete Schwab relay service

**Action:** DELETE the entire `services/schwab-relay/` directory

Note: The deployed instance on Fly.io continues running until manually destroyed via `fly apps destroy nexus-schwab-relay`. That is a separate manual step.

**Acceptance criteria:**
- [ ] `services/schwab-relay/` does not exist

---

### Step 3.6: Drop Markets DB tables via schema migration

**File:** `lib/db/schema.ts`
**Action:** MODIFY

Remove these 4 table definitions:
1. `marketSnapshots` (search for `pgTable('market_snapshots'`)
2. `schwabLinks` (search for `pgTable('schwab_links'`)
3. `realtimeQuotes` (search for `pgTable('realtime_quotes'`)
4. `scannerPresets` (search for `pgTable('scanner_presets'`)

After removing, run:
```bash
npm run db:generate
npm run db:migrate
```

**Acceptance criteria:**
- [ ] All 4 tables removed from `schema.ts`
- [ ] Migration generated and applied

---

### Step 3.7: Update CLAUDE.md

**File:** `.claude/CLAUDE.md`
**Action:** MODIFY

1. Update Tab Mapping table to 6 rows (remove `markets` and `jarvis`)
2. Update API route count: `32` → recount (32 - 15 deleted + 1 added = 18). Run `find app/api -name route.ts | wc -l` to confirm exact count.
3. Update hooks count: `11 files` → `7 files`. Remove `use-market-stream.ts`, `use-relay-socket.ts`, `use-schwab-status.ts`, `use-scanner.ts` from the list.
4. Remove the entire "Jarvis AI Pipeline" section
5. Update AskEdgar section: change `lib/jarvis/askedgar.ts` → `lib/askedgar.ts`
6. Add to Core section: `lib/llm-client.ts`, `lib/research.ts`, `lib/askedgar.ts`
7. Remove the entire "Schwab" section
8. Add TradingView section:
   ```
   ## TradingView Screener
   - Route: `/api/tradingview/gainers` — top gainers with preset filters
   - Env var: `TRADINGVIEW_SESSION_ID` — enables real-time data (optional, falls back to 15-min delayed)
   ```
9. Update Environment Variables table:
   - Remove `Jarvis/LLM` row
   - Remove `Schwab` row
   - Remove `Schwab Relay` row
   - Update `Market Data` to: `MASSIVE_API_KEY`, `TRADINGVIEW_SESSION_ID`
   - Remove Jarvis vars from `Tuning` row
10. Remove `services/schwab-relay/` from Services section
11. Remove "Realtime Data Debugging" section entirely
12. Remove Known Issue #3 (Vercel cron/macro)
13. Update DB table count: `22 tables` → `15 tables` (22 - 7 dropped)

**Acceptance criteria:**
- [ ] Tab Mapping has 6 rows
- [ ] No references to Jarvis, Schwab relay, or Markets tab
- [ ] AskEdgar points to `lib/askedgar.ts`

---

### Step 3.8: Update AGENTS.md

**File:** `AGENTS.md`
**Action:** MODIFY

1. Remove the Schwab relay paragraph from "Architecture Guardrails" (the one starting with `**Relay WebSocket**`)
2. Update the Ask Edgar cache guidance: change `lib/jarvis/askedgar.ts` → `lib/askedgar.ts`
3. Remove `lib/validations/jarvis.ts` from the API Route Conventions validation list
4. Remove the `services/schwab-relay` subproject notes from "Monorepo/Subproject Notes"

**Acceptance criteria:**
- [ ] No references to `lib/jarvis/`, Schwab relay, or `lib/validations/jarvis`

---

### Step 3.9: Run Phase 3 final verification

```bash
npm run lint && npx tsc --noEmit && npm run test

# Verify no references to deleted modules
grep -r "from '@/lib/jarvis/" --include="*.ts" --include="*.tsx" .
grep -r "MarketsTab\|JarvisTab\|use-market-stream\|use-relay-socket\|use-schwab-status\|use-scanner" --include="*.ts" --include="*.tsx" .
grep -r "from '@/lib/schwab" --include="*.ts" --include="*.tsx" .

# Verify kept files still exist
ls app/api/market-data/route.ts
ls app/api/market-data/daily-summary/route.ts
ls lib/massive-market.ts
ls lib/askedgar.ts
ls lib/llm-client.ts
ls lib/research.ts
ls app/api/tradingview/gainers/route.ts
```

**Acceptance criteria:**
- [ ] Zero lint errors
- [ ] Zero type errors
- [ ] All tests pass
- [ ] All three greps return zero results
- [ ] All kept/new files exist

---

## Files Changed Summary

| File | Action | Risk |
|------|--------|------|
| `app/api/tradingview/gainers/route.ts` | CREATE | LOW |
| `components/trading/ResearchGainersList.tsx` | MODIFY | LOW |
| `lib/askedgar.ts` | CREATE (relocate) | LOW |
| `lib/llm-client.ts` | CREATE (relocate) | LOW |
| `lib/research.ts` | CREATE (relocate) | MEDIUM |
| `app/api/askedgar/snapshot/route.ts` | MODIFY | LOW |
| `app/api/askedgar/lookup/route.ts` | MODIFY | LOW |
| `app/api/askedgar/tldr/route.ts` | MODIFY | LOW |
| `app/page.tsx` | MODIFY | MEDIUM |
| `components/trading/Sidebar.tsx` | MODIFY | MEDIUM |
| `components/trading/CommandPalette.tsx` | MODIFY | LOW |
| `hooks/use-global-shortcuts.ts` | MODIFY | LOW |
| `lib/db/schema.ts` | MODIFY (2x) | **HIGH** |
| `.claude/CLAUDE.md` | MODIFY | LOW |
| `AGENTS.md` | MODIFY | LOW |
| 5 Jarvis components | DELETE | LOW |
| `components/trading/MarketsTab.tsx` | DELETE | LOW |
| 6 Jarvis API routes | DELETE | LOW |
| 10 Markets/Schwab API routes | DELETE | LOW |
| 14 lib/jarvis/ files | DELETE | LOW |
| 7 Markets lib files + `lib/schwab/` | DELETE | LOW |
| 4 hooks | DELETE | LOW |
| `lib/validations/jarvis.ts` | DELETE | LOW |
| 11 Jarvis test files | DELETE | LOW |
| `.claude/commands/jarvis-prompt-tuner.md` | DELETE | LOW |
| `services/schwab-relay/` (entire dir) | DELETE | LOW |

**Total: ~70 files touched. ~60 deleted, ~5 created, ~10 modified.**

---

## Verification Steps (Final)

Run after all three phases:

```bash
# 1. Core checks
npm run lint && npx tsc --noEmit && npm run test

# 2. No references to deleted modules
grep -r "from '@/lib/jarvis/" --include="*.ts" --include="*.tsx" .
grep -r "from '@/lib/schwab" --include="*.ts" --include="*.tsx" .
grep -r "MarketsTab\|JarvisTab" --include="*.ts" --include="*.tsx" .

# 3. Verify 6-tab structure
grep -n "VALID_TABS" app/page.tsx

# 4. Confirm new files exist
ls lib/askedgar.ts lib/llm-client.ts lib/research.ts app/api/tradingview/gainers/route.ts

# 5. Confirm kept routes exist
ls app/api/market-data/route.ts app/api/market-data/daily-summary/route.ts lib/massive-market.ts
```

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

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
> Status: IN PROGRESS — Phase 1 complete, awaiting manual validation before Phase 2

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

### Completion Checklist

- [x] Route exists at `app/api/tradingview/gainers/route.ts`
- [x] Route returns `{ gainers, count, totalCount, isRealtime, fetchedAt }`
- [x] Each gainer has `{ ticker, price, change, volume, avgVolume90d, marketCap, sector }`
- [x] Route calls `requireUser()` and returns 401 if unauthenticated
- [x] Cookie header is omitted when `TRADINGVIEW_SESSION_ID` is unset
- [x] Research gainers list fetches from `/api/tradingview/gainers`
- [x] Research gainers list polls every 60 seconds
- [x] Research gainers list shows LIVE / 15-MIN DELAY badge
- [x] Research gainers list shows filter summary line and row metrics
- [x] Legacy `app/api/askedgar/gainers/route.ts` file deleted
- [x] Empty `app/api/askedgar/gainers/` directory removed
- [x] `npm run lint`
- [x] `npx tsc --noEmit`
- [x] `npm test`

### Manual Validation Still Needed Before Phase 2

- [ ] Confirm the Research tab renders TradingView gainers in the sidebar and selecting a row still updates the ticker view.
- [ ] Confirm LIVE appears when `TRADINGVIEW_SESSION_ID` is configured, otherwise 15-MIN DELAY appears.

---

## Phase 2: Remove Jarvis Tab

**IMPORTANT: Execute steps in this exact order. Relocation steps must come before deletion steps.**

### Step 2.1: Relocate lib/jarvis/askedgar.ts → lib/askedgar.ts

**File:** `lib/askedgar.ts`
**Action:** CREATE (copy + patch)

1. Copy the full content of `lib/jarvis/askedgar.ts` to `lib/askedgar.ts`.
2. On line 6, remove the import `import type { DilutionDataSourceCheck } from '@/lib/jarvis/types';`
3. Add an inline interface definition before the `AskEdgarResponse` interface:
   ```typescript
   interface DilutionDataSourceCheck {
     endpoint: string;
     label: string;
     hasData: boolean;
     error?: string;
   }
   ```
4. All other imports and content remain unchanged.

**Acceptance criteria:**
- [ ] `lib/askedgar.ts` exists with all exports from the original
- [ ] No import from `@/lib/jarvis/types`
- [ ] `DilutionDataSourceCheck` is declared as a local interface
- [ ] `npm run lint && npx tsc --noEmit` passes

---

### Step 2.2: Relocate lib/jarvis/client.ts → lib/llm-client.ts

**File:** `lib/llm-client.ts`
**Action:** CREATE (copy exactly)

1. Copy the full content of `lib/jarvis/client.ts` to `lib/llm-client.ts`.
2. No changes needed — it has no imports from `lib/jarvis/`.

**Acceptance criteria:**
- [ ] `lib/llm-client.ts` exists with exports: `callJarvis`, `callJarvisStreaming`, `JarvisClientResult`
- [ ] No imports from `@/lib/jarvis/`

---

### Step 2.3: Relocate lib/jarvis/research.ts → lib/research.ts

**File:** `lib/research.ts`
**Action:** CREATE (copy + patch)

1. Copy the full content of `lib/jarvis/research.ts` to `lib/research.ts`.
2. Replace the import block at the top with:
   ```typescript
   import { and, desc, eq, gte } from 'drizzle-orm';
   import { getDb } from '@/lib/db';
   import { researchReports } from '@/lib/db/schema';
   import { getCachedTickerData } from '@/lib/askedgar';
   import type { AskEdgarResponse } from '@/lib/askedgar';
   import { callJarvis } from '@/lib/llm-client';
   ```
3. Remove the `import { buildResearchTldrPrompt } from '@/lib/jarvis/prompts';` line.
4. Add `buildResearchTldrPrompt` as a private function inside this file. Read lines 95-131 of `lib/jarvis/prompts.ts` for the exact body:

```typescript
function buildResearchTldrPrompt(
  reportData: Record<string, unknown[]>,
  options?: { ticker?: string; historicalSummary?: unknown; discordReport?: { date: string; text: string } },
): string {
  const parts = [
    `Analyze this AskEdgar data and return a compact JSON research summary.`,
    options?.ticker ? `\nTicker: ${options.ticker}` : '',
    `
OUTPUT FORMAT (strict JSON, no markdown):
{
  "tldr": "2-3 sentence executive summary of the ticker's dilution risk and outlook",
  "findings": ["key fact 1", "key fact 2", ...],
  "actionSteps": ["what to watch or do 1", "what to watch or do 2", ...],
  "risks": ["risk flag 1", "risk flag 2", ...],
  "historicalContext": "1-2 sentences on how the risk profile has evolved, or null if no history"
}

RULES:
- findings: 5-8 bullets, focus on dilution, offerings, cash position, compliance
- actionSteps: 3-5 bullets, actionable next steps for a trader
- risks: 3-5 bullets, biggest risk flags
- Be specific with numbers (prices, dates, percentages) when available
- Never fabricate data. Use null for missing values.
- JSON only, no explanation

<report_data>
${JSON.stringify(reportData)}
</report_data>`,
    options?.historicalSummary
      ? `\n<historical_summary>\n${JSON.stringify(options.historicalSummary, null, 1)}\n</historical_summary>`
      : '',
    options?.discordReport
      ? `\n<latest_discord_report date="${options.discordReport.date}">\n${options.discordReport.text.slice(0, 2000)}\n</latest_discord_report>`
      : '',
  ];
  return parts.filter(Boolean).join('\n');
}
```

**Acceptance criteria:**
- [ ] `lib/research.ts` exists and exports `fetchAndCacheRawReport`, `runResearchTldr`
- [ ] No imports from `@/lib/jarvis/`
- [ ] `buildResearchTldrPrompt` is a private function inside the file
- [ ] `npm run lint && npx tsc --noEmit` passes

---

### Step 2.4: Update /api/askedgar route imports

**Files to MODIFY (change `@/lib/jarvis/askedgar` → `@/lib/askedgar` and `@/lib/jarvis/research` → `@/lib/research`):**

1. `app/api/askedgar/snapshot/route.ts` — change import from `@/lib/jarvis/askedgar` to `@/lib/askedgar`
2. `app/api/askedgar/lookup/route.ts` — change import from `@/lib/jarvis/askedgar` to `@/lib/askedgar`
3. `app/api/askedgar/tldr/route.ts` — change both imports:
   - `@/lib/jarvis/askedgar` → `@/lib/askedgar`
   - `@/lib/jarvis/research` → `@/lib/research`

**Acceptance criteria:**
- [ ] No file under `app/api/askedgar/` imports from `@/lib/jarvis/`
- [ ] `npm run lint && npx tsc --noEmit` passes

---

### Step 2.5: Remove Jarvis and Markets from app/page.tsx

**File:** `app/page.tsx`
**Action:** MODIFY

1. Delete line 17: `import MarketsTab from '@/components/trading/MarketsTab';`
2. Delete line 19: `import JarvisTab from '@/components/trading/JarvisTab';`
3. Change `VALID_TABS` (line 26) to:
   ```typescript
   const VALID_TABS: TabKey[] = ['dashboard', 'performance', 'journal', 'filter', 'charts', 'research'];
   ```
4. Change `TAB_TITLES` (lines 28-37) to:
   ```typescript
   const TAB_TITLES: Record<TabKey, string> = {
     dashboard: 'Dashboard',
     performance: 'Performance Analytics',
     journal: 'Trading Journal',
     filter: 'Trades Management',
     charts: 'Charts',
     research: 'Research',
   };
   ```
5. Remove the Markets tab render block (lines 300-304):
   ```typescript
   {activeTab === 'markets' ? (
     <TabErrorBoundary name="Markets">
       <MarketsTab />
     </TabErrorBoundary>
   ) : null}
   ```
6. Remove the Jarvis tab render block (lines 312-316):
   ```typescript
   {activeTab === 'jarvis' ? (
     <TabErrorBoundary name="Jarvis">
       <JarvisTab />
     </TabErrorBoundary>
   ) : null}
   ```

**Acceptance criteria:**
- [ ] No import of `MarketsTab` or `JarvisTab`
- [ ] `VALID_TABS` has exactly 6 entries
- [ ] No render blocks for `markets` or `jarvis`

---

### Step 2.6: Update Sidebar.tsx

**File:** `components/trading/Sidebar.tsx`
**Action:** MODIFY

1. Remove `MessageSquare` and `Newspaper` from the lucide-react import (line 3) — they are only used by the Jarvis and Markets nav items.
2. Change `TabKey` type (line 10) to:
   ```typescript
   export type TabKey = 'dashboard' | 'journal' | 'performance' | 'filter' | 'charts' | 'research';
   ```
3. Change `navItems` array (lines 44-53) to 6 items, removing the `markets` and `jarvis` entries:
   ```typescript
   const navItems: Array<{ tab: TabKey; title: string; icon: typeof LayoutGrid }> = [
     { tab: 'dashboard', title: 'Dashboard', icon: LayoutGrid },
     { tab: 'performance', title: 'Performance', icon: BarChart3 },
     { tab: 'journal', title: 'Journal', icon: List },
     { tab: 'filter', title: 'Trades', icon: Filter },
     { tab: 'charts', title: 'Charts', icon: ChartCandlestick },
     { tab: 'research', title: 'Research', icon: Search },
   ];
   ```

**Acceptance criteria:**
- [ ] `TabKey` has exactly 6 values
- [ ] `navItems` has exactly 6 entries
- [ ] `MessageSquare` and `Newspaper` removed from lucide import

---

### Step 2.7: Update CommandPalette.tsx

**File:** `components/trading/CommandPalette.tsx`
**Action:** MODIFY

1. Remove `MessageSquare` and `Newspaper` from the lucide-react import (line 4).
2. Remove `markets` and `jarvis` entries from the `NAV_ITEMS` array (lines 16-30). Renumber shortcuts so `research` becomes `6`.
3. Remove the entire "Jarvis" CommandGroup block (lines 94-119) that contains jarvis-specific commands.

**Acceptance criteria:**
- [ ] NAV_ITEMS has 6 entries with shortcuts 1-6
- [ ] No Jarvis CommandGroup
- [ ] `MessageSquare` and `Newspaper` removed from import

---

### Step 2.8: Update use-global-shortcuts.ts

**File:** `hooks/use-global-shortcuts.ts`
**Action:** MODIFY

1. Change TAB_KEYS (line 6) to:
   ```typescript
   const TAB_KEYS: TabKey[] = ['dashboard', 'performance', 'journal', 'filter', 'charts', 'research'];
   ```
2. Remove hotkey registrations for keys `'7'` and `'8'` (lines 20-21).
3. Remove the `ctrl+j` shortcut block (lines 33-39).

**Acceptance criteria:**
- [ ] `TAB_KEYS` has 6 entries
- [ ] Hotkeys 1-6 registered; 7 and 8 removed
- [ ] `ctrl+j` shortcut removed

---

### Step 2.9: Delete Jarvis component files

**Action:** DELETE the following 5 files:
- `components/trading/JarvisTab.tsx`
- `components/trading/JarvisChat.tsx`
- `components/trading/JarvisStructuredResponse.tsx`
- `components/trading/JarvisMacroSummary.tsx`
- `components/trading/JarvisDilutionReport.tsx`

**Acceptance criteria:**
- [ ] None of the above files exist
- [ ] `npx tsc --noEmit` passes

---

### Step 2.10: Delete Jarvis API routes

**Action:** DELETE the following route files and clean up empty directories:
- `app/api/jarvis/chat/route.ts`
- `app/api/jarvis/research/route.ts`
- `app/api/jarvis/trade-analysis/route.ts`
- `app/api/jarvis/macro-summary/latest/route.ts`
- `app/api/jarvis/cron/macro-summary/route.ts`
- `app/api/jarvis/admin/memory/route.ts`
- Remove `app/api/jarvis/upload/` (empty directory)
- Remove entire `app/api/jarvis/` directory tree

**Acceptance criteria:**
- [ ] `app/api/jarvis/` directory does not exist

---

### Step 2.11: Delete lib/validations/jarvis.ts

**File:** `lib/validations/jarvis.ts`
**Action:** DELETE

Verify nothing imports from `@/lib/validations/jarvis` before deleting.

**Acceptance criteria:**
- [ ] File does not exist
- [ ] No remaining imports

---

### Step 2.12: Delete all lib/jarvis/ files

**Action:** DELETE the following 14 files then the empty directory:

1. `lib/jarvis/askedgar.ts` (relocated to `lib/askedgar.ts`)
2. `lib/jarvis/client.ts` (relocated to `lib/llm-client.ts`)
3. `lib/jarvis/research.ts` (relocated to `lib/research.ts`)
4. `lib/jarvis/prompts.ts` (function inlined into `lib/research.ts`)
5. `lib/jarvis/types.ts`
6. `lib/jarvis/memory.ts`
7. `lib/jarvis/context.ts`
8. `lib/jarvis/chat-helpers.ts`
9. `lib/jarvis/trade-analysis.ts`
10. `lib/jarvis/rate-limit.ts`
11. `lib/jarvis/token-tracking.ts`
12. `lib/jarvis/admin.ts`
13. `lib/jarvis/historical-summary.ts`
14. `lib/jarvis/scrape-lite.ts`
15. Remove the empty `lib/jarvis/` directory

**Acceptance criteria:**
- [ ] `lib/jarvis/` directory does not exist
- [ ] `npx tsc --noEmit` passes

---

### Step 2.13: Delete Jarvis test files

**Action:** DELETE all 11 test files from `__tests__/`:
- `jarvis-memory.test.ts`
- `jarvis-prompts.test.ts`
- `jarvis-macro-summary-component.test.ts`
- `jarvis-context.test.ts`
- `jarvis-trade-analysis-route.test.ts`
- `jarvis-research-route.test.ts`
- `jarvis-macro-summary-route.test.ts`
- `jarvis-client.test.ts`
- `jarvis-admin-route.test.ts`
- `jarvis-chat-route.test.ts`
- `jarvis-chat-stream-route.test.ts`

**Acceptance criteria:**
- [ ] All 11 test files deleted
- [ ] `npm run test` passes

---

### Step 2.14: Delete jarvis-prompt-tuner command

**File:** `.claude/commands/jarvis-prompt-tuner.md`
**Action:** DELETE

---

### Step 2.15: Drop Jarvis DB tables via schema migration

**File:** `lib/db/schema.ts`
**Action:** MODIFY

Remove the following 3 table definitions:
1. `macroSummaries` table (search for `pgTable('macro_summaries'`)
2. `jarvisConversations` table (search for `pgTable('jarvis_conversations'`)
3. `jarvisRequestLog` table (search for `pgTable('jarvis_request_log'`)

After removing, run:
```bash
npm run db:generate
npm run db:migrate
```

**Acceptance criteria:**
- [ ] `macroSummaries`, `jarvisConversations`, `jarvisRequestLog` no longer in `schema.ts`
- [ ] Migration generated and applied
- [ ] `npx tsc --noEmit` passes

---

### Step 2.16: Run Phase 2 verification

```bash
npm run lint && npx tsc --noEmit && npm run test
grep -r "from '@/lib/jarvis/" --include="*.ts" --include="*.tsx" .
```

**Acceptance criteria:**
- [ ] Zero lint errors
- [ ] Zero type errors
- [ ] All remaining tests pass
- [ ] Grep returns zero results

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

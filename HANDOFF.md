# Nexus Terminal — HANDOFF.md

> Generated: 2026-03-10 | Agent: nexus-architect
> Status: EXECUTED (session complete)

## Post-Deploy Hotfix (2026-03-10)

- [x] Moved `runResearchPipeline` out of `app/api/jarvis/research/route.ts` into `lib/jarvis/research.ts`
- [x] Moved `runTradeAnalysisPipeline` out of `app/api/jarvis/trade-analysis/route.ts` into `lib/jarvis/trade-analysis.ts`
- [x] Updated `app/api/jarvis/chat/route.ts` to import pipeline helpers from `lib/jarvis/*` (removed route-to-route imports)
- [x] Verified route files only export valid Next.js route handlers
- [x] Verification complete: `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build`
- [x] Hotfix status: COMPLETE

---

## Sprint 9: Jarvis RAG-to-Pipeline Rewrite

### Objective

Replace the entire Jarvis RAG pipeline (vector embeddings, knowledge chunks, multi-step orchestration, web scraping) with 3 deterministic pipelines + 1 chat interface + shared DB context layer. The JARVIS.md system prompt lives as a TS const in `lib/jarvis/prompts.ts`.

### Architecture Summary

```
3 pipelines + 1 chat interface + 1 shared DB context layer

Pipeline 1: Research Report (on demand)
  User inputs ticker → fetch AskEdgar API → LLM call with template → store report → render

Pipeline 2: Macro Summary (daily cron)
  Cron fires → fetch 3-5 static URLs → LLM call with macro prompt → store summary → inject into chat

Pipeline 3: Trade Analysis (on demand or post-import)
  Query trades table → LLM call with analysis template → extract insights to memory → surface in UI

Chat Interface:
  Load context (trades + memory + macro) → build prompt → call LLM → save conversation → return
  Prefix dispatch: /research TICKER → Pipeline 1, /analyze → Pipeline 3, else → chat
```

---

## Phase 1: Schema Migration

**Objective:** Add 4 new tables. Do NOT drop old tables yet — they coexist until Phase 5.

**File:** `lib/db/schema.ts`

### New Tables

```typescript
// lib/db/schema.ts additions

export const agentMemory = pgTable('agent_memory', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  category: text('category').notNull(),
  // categories: 'trade_insight' | 'user_preference' | 'strategy_note' | 'macro_fact'
  key: text('key').notNull(),
  value: text('value').notNull(),
  valueJson: jsonb('value_json'),      // optional structured data
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  expiresAt: timestamp('expires_at'),  // null = never expires
}, (table) => ({
  uniqueUserCategoryKey: unique().on(table.userId, table.category, table.key),
  userCategoryIdx: index('agent_memory_user_category_idx').on(table.userId, table.category),
}));

export const researchReports = pgTable('research_reports', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  ticker: text('ticker').notNull(),
  status: text('status').notNull().default('pending'), // pending, complete, failed
  rawData: jsonb('raw_data'),          // AskEdgar API responses
  reportJson: jsonb('report_json'),    // structured LLM output
  modelUsed: text('model_used'),
  errorMessage: text('error_message'),
  generatedAt: timestamp('generated_at').defaultNow(),
}, (table) => ({
  userTickerIdx: index('research_reports_user_ticker_idx').on(table.userId, table.ticker, table.generatedAt),
}));

export const macroSummaries = pgTable('macro_summaries', {
  id: uuid('id').defaultRandom().primaryKey(),
  summaryJson: jsonb('summary_json').notNull(), // JarvisMacroSummaryOutput structure
  sourcesJson: jsonb('sources_json'),           // array of URLs fetched
  modelUsed: text('model_used'),
  generatedAt: timestamp('generated_at').defaultNow(),
}, (table) => ({
  generatedAtIdx: index('macro_summaries_generated_at_idx').on(table.generatedAt),
}));

export const jarvisConversations = pgTable('jarvis_conversations', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  sessionId: text('session_id').notNull(), // group messages into sessions
  role: text('role').notNull(),            // 'user' | 'assistant' | 'system'
  content: text('content').notNull(),
  mode: text('mode'),                      // 'chat' | 'research' | 'trade-analysis' | 'macro'
  contextSnapshot: jsonb('context_snapshot'), // only on first message per session, or null
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  userSessionIdx: index('jarvis_conversations_user_session_idx').on(table.userId, table.sessionId, table.createdAt),
}));
```

### Steps

| Step | Action | Detail |
|------|--------|--------|
| 1.1 | MODIFY `lib/db/schema.ts` | Add the 4 table definitions above |
| 1.2 | RUN `npm run db:generate` | Generate migration SQL |
| 1.3 | RUN `npm run db:migrate` | Apply migration to Neon |
| 1.4 | VERIFY | Confirm 4 new tables exist alongside old tables |

---

## Phase 2: Core Library Layer

**Objective:** Build the new `lib/jarvis/` module directory with all service files.

### File Structure

```
lib/jarvis/
  types.ts              # JarvisMode, request/response types, memory categories, dilution types
  client.ts             # Single LLM call wrapper (circuit breaker, retry, token tracking)
  prompts.ts            # JARVIS.md system prompt as const + all per-pipeline prompt templates
  memory.ts             # agent_memory CRUD (read, write, expire, extract insights)
  context.ts            # Build context object from DB (trades, memory, macro) for each request
  trade-analysis.ts     # Trade summarization logic (moved from current route.ts)
  askedgar.ts           # AskEdgar API client + aggregator (merged from 2 existing files)
  scrape-lite.ts        # Simple URL fetch + text extraction (no chunking, no embeddings)
  rate-limit.ts         # Per-user rate limiting (moved from lib/jarvis-rate-limit.ts)
  circuit-breaker.ts    # LLM circuit breaker (moved from lib/jarvis-circuit-breaker.ts)
  token-tracking.ts     # Request logging (moved from lib/jarvis-token-tracking.ts)
  admin.ts              # Admin key auth (moved from lib/jarvis-admin.ts)
```

### Steps

| Step | Action | File | Detail |
|------|--------|------|--------|
| 2.1 | CREATE | `lib/jarvis/types.ts` | Define JarvisMode (`'chat' \| 'research' \| 'trade-analysis' \| 'macro'`), request/response interfaces, memory categories. Carry forward dilution report types from current `lib/jarvis-types.ts` |
| 2.2 | CREATE | `lib/jarvis/client.ts` | Single `callJarvis(systemPrompt, userMessage, temperature?)` function using OpenAI SDK pointed at NVIDIA/DeepSeek. Integrate circuit breaker. This is the ONLY file that touches the LLM — swap models by changing one file |
| 2.3 | CREATE | `lib/jarvis/prompts.ts` | Export `JARVIS_SYSTEM_PROMPT` const string (the full JARVIS.md identity/scope/constraints). Export per-pipeline template functions: `buildTradeAnalysisPrompt(context)`, `buildMacroPrompt(context)`, `buildResearchPrompt(context)`, `buildChatPrompt(context)`. Each template injects a `<context>` JSON block containing: `user_trades` (last 30 days), `macro_summary` (today's), `memory` (relevant rows), `report_data` (if applicable) |
| 2.4 | CREATE | `lib/jarvis/memory.ts` | CRUD: `readMemory(userId, category?)`, `writeMemory(userId, category, key, value)`, `upsertMemory(userId, category, key, value)`, `deleteExpired()`, `extractTradeInsights(analysisResult)` → writes behavioral patterns to agent_memory with category='trade_insight' |
| 2.5 | CREATE | `lib/jarvis/context.ts` | `buildContext(userId, mode)`: queries trades (last 30 days), today's macro summary from `macro_summaries`, relevant `agent_memory` rows. Returns typed JSON context block |
| 2.6 | CREATE | `lib/jarvis/trade-analysis.ts` | Move `summarizeTrades()` and `toModePrompt()` from current `app/api/jarvis/route.ts`. Add insight extraction logic for memory writes |
| 2.7 | CREATE | `lib/jarvis/askedgar.ts` | Merge `lib/askedgar-client.ts` + `lib/askedgar-aggregator.ts` into single file. Keep `fetchTickerData(ticker)` with `Promise.allSettled` pattern for all 12 endpoints |
| 2.8 | CREATE | `lib/jarvis/scrape-lite.ts` | Simple `fetchPageText(url): Promise<string>` — fetch HTML, strip tags, return plain text. No chunking, no embeddings, no robots.txt checking. Used only by macro cron |
| 2.9 | MOVE | `lib/jarvis/rate-limit.ts` | Copy from `lib/jarvis-rate-limit.ts`, update imports |
| 2.10 | MOVE | `lib/jarvis/circuit-breaker.ts` | Copy from `lib/jarvis-circuit-breaker.ts` |
| 2.11 | MOVE | `lib/jarvis/token-tracking.ts` | Copy from `lib/jarvis-token-tracking.ts`, update JarvisMode import to new types |
| 2.12 | MOVE | `lib/jarvis/admin.ts` | Copy from `lib/jarvis-admin.ts` |

### JARVIS.md System Prompt (embedded in prompts.ts)

```typescript
export const JARVIS_SYSTEM_PROMPT = `
# JARVIS — Nexus Terminal AI Layer

## Identity
You are Jarvis, the trading intelligence layer for Nexus Terminal.
You are not a general assistant. You only reason about:
- Equities, dilution, float, market structure
- The user's trade history and performance patterns
- Macro conditions relevant to the user's traded symbols

## Scope Constraints
- Never give financial advice or price targets
- Never fabricate data. If a field is missing, say "No data"
- Always cite which data source a claim comes from
- Flag when you are reasoning without live data

## Context Injected Per Request
You will receive a JSON block called <context> containing:
- user_trades: last 30 days of trades (symbol, direction, pnl, r_multiple)
- macro_summary: today's macro summary if available
- memory: relevant agent_memory rows for this user
- report_data: raw API data for research reports (if applicable)

## Output Formats

### Research Report
Return structured JSON matching ResearchReportSchema.
Never add fields not in the schema. Mark missing data as null, not "N/A" string.

### Trade Analysis
Return: strengths[], weaknesses[], patterns[], action_items[]
Ground every claim in the provided trade data.

### Macro Summary
Return: headline, key_themes[], risk_flags[], watchlist_notes[]
Max 300 words. Cite source URLs inline.

### Chat Response
Conversational. Reference context when relevant.
If asked about a ticker not in context, say you need to run a research report first.

## Data Sources
- AskEdgar API: dilution, float, cash need, warrants
- Macro URLs: [configured in macro cron]
- Trades DB: injected via context
- Research reports: stored in DB, injected when relevant

## Memory Rules
After every trade analysis, extract:
- New behavioral patterns observed
- Symbols the user trades frequently
Write these to agent_memory with category='trade_insight'
`;
```

---

## Phase 3: API Routes

**Objective:** Build 4 new API routes replacing the monolithic `/api/jarvis` endpoint.

### Route Structure

```
app/api/jarvis/
  chat/route.ts              # POST - conversational endpoint
  research/route.ts          # POST - generate research report for ticker
  trade-analysis/route.ts    # POST - analyze user's trades
  cron/
    macro-summary/route.ts   # GET - daily macro cron (replaces cron/headlines)
  admin/
    stats/route.ts           # GET - admin stats (modify existing)
    memory/
      route.ts               # GET/DELETE - agent_memory admin (replace existing)
```

### Steps

| Step | Action | File | Detail |
|------|--------|------|--------|
| 3.1 | CREATE | `app/api/jarvis/chat/route.ts` | POST: `requireUser()`, rate limit check, build context via `buildContext(userId, 'chat')`, check for prefix dispatch (`/research TICKER` → redirect to research endpoint, `/analyze` → redirect to trade-analysis), build prompt via `buildChatPrompt(context)`, call LLM via `callJarvis()`, save user+assistant messages to `jarvis_conversations`, return response. Supports `session_id` in request body for conversation continuity |
| 3.2 | CREATE | `app/api/jarvis/research/route.ts` | POST: `requireUser()`, validate `ticker` param, check for existing today's report (return cached if found), call `fetchTickerData(ticker)` from askedgar.ts via `Promise.allSettled`, build prompt via `buildResearchPrompt(context)` with raw API data injected, call LLM, save to `research_reports` table (status: complete), return structured report. On LLM failure: save with status: failed + error_message |
| 3.3 | CREATE | `app/api/jarvis/trade-analysis/route.ts` | POST: `requireUser()`, query trades from DB (last N days, configurable), build analysis prompt via `buildTradeAnalysisPrompt(context)`, call LLM, extract behavioral patterns via `extractTradeInsights()`, write insights to `agent_memory`, return structured response (strengths, weaknesses, patterns, action_items) |
| 3.4 | CREATE | `app/api/jarvis/cron/macro-summary/route.ts` | GET: validate `CRON_SECRET` bearer token, fetch 3-5 static macro URLs via `fetchPageText()`, build macro prompt via `buildMacroPrompt(context)`, call LLM, save to `macro_summaries` table, return success. Configure URL list as const array in this file or in prompts.ts |
| 3.5 | MODIFY | `app/api/jarvis/admin/stats/route.ts` | Update to query new tables: agent_memory row counts by category, research_reports count, macro_summaries last generated_at, jarvis_conversations count. Keep existing token tracking stats |
| 3.6 | CREATE | `app/api/jarvis/admin/memory/route.ts` | GET: list agent_memory rows (filter by userId, category). DELETE: purge by userId or purge all. Requires admin key auth |

---

## Phase 4: UI Components

**Objective:** Replace JarvisTab (full tab) with JarvisPanel (slide-out side panel accessible from any tab).

### UI Architecture

```
Any tab → click Jarvis icon in sidebar → slide-out panel from right

Panel has 3 sections (internal tabs):
1. Chat (with injected context) — conversational interface
2. Research Reports (history + trigger new report)
3. Daily Macro (latest summary)
```

### Steps

| Step | Action | File | Detail |
|------|--------|------|--------|
| 4.1 | CREATE | `components/trading/JarvisPanel.tsx` | Sheet-based slide-out panel using existing `components/ui/sheet.tsx`. Props: `open: boolean`, `onOpenChange: (open: boolean) => void`, `trades: Trade[]`. Internal tab navigation for Chat / Research / Macro sections. Research section shows saved reports from `research_reports` table + "New Report" button with ticker input. Macro section shows today's summary from `macro_summaries` |
| 4.2 | CREATE | `components/trading/JarvisChat.tsx` | Chat UI within the panel: scrollable message list, text input with send button. On send → POST to `/api/jarvis/chat` with `{ message, session_id }`. Renders assistant responses using `JarvisStructuredResponse` for structured data, plain text for conversational. Maintains `session_id` in state for conversation continuity. Prefix hints: show subtle autocomplete for `/research` and `/analyze` |
| 4.3 | MODIFY | `components/trading/JarvisStructuredResponse.tsx` | Remove source type badges for `'web_source'`, `'cached_headline'`, `'user_document'` (these source types no longer exist). Simplify source display. Keep TL;DR / Findings / Actions / Risks structure |
| 4.4 | MODIFY | `components/trading/Sidebar.tsx` | Remove `'jarvis'` from `TabKey` union type. Remove the jarvis nav item from `navItems` array. Add a persistent Jarvis toggle button (Bot icon from lucide-react) positioned above the Account button. New props: `onJarvisToggle: () => void`, `isJarvisOpen: boolean` |
| 4.5 | MODIFY | `app/page.tsx` | Remove `JarvisTab` import and conditional render. Add state: `const [isJarvisOpen, setIsJarvisOpen] = useState(false)`. Render `<JarvisPanel open={isJarvisOpen} onOpenChange={setIsJarvisOpen} trades={trades} />`. Wire Sidebar: `onJarvisToggle={() => setIsJarvisOpen(!isJarvisOpen)}` |

### Components Kept As-Is

- `JarvisMacroSummary.tsx` — macro region summary renderer (used inside JarvisPanel macro section)
- `JarvisDilutionReport.tsx` — dilution report renderer (used inside JarvisPanel research section)

---

## Phase 5: Cleanup & Deletion

**Objective:** Remove all old RAG files, drop old tables, clean up dependencies. **Do this as a separate commit for clean rollback.**

**IMPORTANT: Take a Neon DB snapshot before running the DROP TABLE migration.**

### Files to DELETE

**Old lib files (17):**
- `lib/jarvis-types.ts`
- `lib/jarvis-orchestrator.ts`
- `lib/jarvis-knowledge.ts`
- `lib/jarvis-embedding.ts`
- `lib/jarvis-scrape.ts`
- `lib/jarvis-response.ts`
- `lib/jarvis-allowlist.ts`
- `lib/jarvis-source-packs.ts`
- `lib/jarvis-rate-limit.ts`
- `lib/jarvis-token-tracking.ts`
- `lib/jarvis-circuit-breaker.ts`
- `lib/jarvis-robots.ts`
- `lib/jarvis-scrape-cache.ts`
- `lib/jarvis-documents.ts`
- `lib/jarvis-admin.ts`
- `lib/askedgar-client.ts`
- `lib/askedgar-aggregator.ts`

**Old route files (5):**
- `app/api/jarvis/route.ts` (the 798-line monolith)
- `app/api/jarvis/upload/route.ts`
- `app/api/jarvis/cron/headlines/route.ts`
- `app/api/jarvis/admin/memory/stats/route.ts`
- `app/api/jarvis/admin/memory/purge/route.ts`

**Old components (2):**
- `components/trading/JarvisTab.tsx`
- `components/trading/JarvisDocuments.tsx`

**Old test files (23):**
- All `__tests__/jarvis-*.test.ts` files

### Schema Changes

| Step | Action | Detail |
|------|--------|--------|
| 5.1 | MODIFY `lib/db/schema.ts` | Remove `jarvisKnowledgeChunks`, `jarvisSourceUrls`, `jarvisUserDocuments` table definitions. Remove `vector1024` and `tsvector` custom types if no longer referenced elsewhere |
| 5.2 | RUN `npm run db:generate` | Generate DROP TABLE migration |
| 5.3 | RUN `npm run db:migrate` | Apply destructive migration |

### Dependency Cleanup

| Step | Action | Detail |
|------|--------|--------|
| 5.4 | MODIFY `package.json` | Remove `pdf-parse` and `@types/pdf-parse` |
| 5.5 | RUN `npm install` | Clean lockfile |

### Environment Variable Cleanup

**Remove from `.env.example`:**
- `JARVIS_EMBEDDING_ENABLED`
- `JARVIS_EMBEDDING_MODEL`
- `JARVIS_EMBEDDING_API_BASE_URL`
- `JARVIS_SCRAPE_CACHE_TTL_WEB_MS`
- `JARVIS_SCRAPE_CACHE_TTL_HEADLINE_MS`
- `JARVIS_SCRAPE_CACHE_TTL_API_MS`
- `JARVIS_MAX_CONTEXT_TOKENS`
- `JARVIS_USER_STORAGE_LIMIT_BYTES`
- `JARVIS_ORCHESTRATION_CRITIQUE`

**Keep:**
- `JARVIS_API_KEY` / `NVIDIA_API_KEY`, `JARVIS_MODEL`, `JARVIS_API_BASE_URL`
- `JARVIS_RATE_LIMIT_PER_HOUR`, `JARVIS_CIRCUIT_BREAKER_THRESHOLD`, `JARVIS_CIRCUIT_BREAKER_RESET_MS`
- `JARVIS_ADMIN_KEY`, `CRON_SECRET`, `ASKEDGAR_API_KEY`

### Config Updates

| Step | Action | Detail |
|------|--------|--------|
| 5.6 | MODIFY Vercel cron config | Update cron path from `/api/jarvis/cron/headlines` to `/api/jarvis/cron/macro-summary` |
| 5.7 | MODIFY `.claude/CLAUDE.md` | Update architecture docs to reflect new pipeline architecture |

---

## Phase 6: Testing

| Step | Action | File | Detail |
|------|--------|------|--------|
| 6.1 | CREATE | `__tests__/jarvis-client.test.ts` | Test LLM client wrapper (mock OpenAI SDK) |
| 6.2 | CREATE | `__tests__/jarvis-memory.test.ts` | Test agent_memory CRUD |
| 6.3 | CREATE | `__tests__/jarvis-context.test.ts` | Test context builder |
| 6.4 | CREATE | `__tests__/jarvis-prompts.test.ts` | Test prompt template rendering |
| 6.5 | CREATE | `__tests__/jarvis-chat-route.test.ts` | Test chat endpoint |
| 6.6 | CREATE | `__tests__/jarvis-research-route.test.ts` | Test research endpoint |
| 6.7 | CREATE | `__tests__/jarvis-trade-analysis-route.test.ts` | Test trade analysis endpoint |
| 6.8 | RUN | `npm run lint && npx tsc --noEmit && npm test` | Full verification |

---

## Files Affected Summary

### Files to CREATE (18)

| File | Complexity | Risk |
|------|-----------|------|
| `lib/jarvis/types.ts` | LOW | LOW |
| `lib/jarvis/client.ts` | MEDIUM | MEDIUM |
| `lib/jarvis/prompts.ts` | MEDIUM | LOW |
| `lib/jarvis/memory.ts` | MEDIUM | MEDIUM |
| `lib/jarvis/context.ts` | MEDIUM | MEDIUM |
| `lib/jarvis/trade-analysis.ts` | LOW | LOW |
| `lib/jarvis/askedgar.ts` | LOW | LOW (merge) |
| `lib/jarvis/scrape-lite.ts` | LOW | LOW |
| `lib/jarvis/rate-limit.ts` | LOW | LOW (move) |
| `lib/jarvis/circuit-breaker.ts` | LOW | LOW (move) |
| `lib/jarvis/token-tracking.ts` | LOW | LOW (move) |
| `lib/jarvis/admin.ts` | LOW | LOW (move) |
| `app/api/jarvis/chat/route.ts` | HIGH | MEDIUM |
| `app/api/jarvis/research/route.ts` | HIGH | MEDIUM |
| `app/api/jarvis/trade-analysis/route.ts` | MEDIUM | MEDIUM |
| `app/api/jarvis/cron/macro-summary/route.ts` | MEDIUM | MEDIUM |
| `components/trading/JarvisPanel.tsx` | HIGH | HIGH |
| `components/trading/JarvisChat.tsx` | MEDIUM | MEDIUM |

### Files to MODIFY (6)

| File | Risk |
|------|------|
| `lib/db/schema.ts` | HIGH (migration) |
| `app/api/jarvis/admin/stats/route.ts` | LOW |
| `components/trading/JarvisStructuredResponse.tsx` | LOW |
| `components/trading/Sidebar.tsx` | MEDIUM |
| `app/page.tsx` | MEDIUM |
| `.claude/CLAUDE.md` | LOW |

### Files to DELETE (47)

| Category | Count |
|----------|-------|
| Old lib files | 17 |
| Old route files | 5 |
| Old components | 2 |
| Old test files | 23 |

---

## DB Tables Dropped (Phase 5)

| Table | Current Purpose | Data Lost |
|-------|----------------|-----------|
| `jarvis_knowledge_chunks` | RAG knowledge base with pgvector embeddings | All chunks, embeddings, tsvector indexes |
| `jarvis_source_urls` | Remembered scrape URLs per user | All remembered URLs |
| `jarvis_user_documents` | Uploaded document metadata | All document records |

**Note:** `jarvis_request_log` is KEPT — token/latency tracking is pipeline-agnostic.

---

## Security Checklist

- [x] All new API routes call `requireUser()` and return 401 on failure
- [x] `ASKEDGAR_API_KEY` only read in `lib/jarvis/askedgar.ts` — never exposed to client
- [x] Conversation history scoped by `user_id` — no cross-user data leakage
- [x] Agent memory writes validate `user_id` ownership
- [x] Cron endpoint uses `CRON_SECRET` bearer auth
- [x] Admin endpoints use `x-jarvis-admin-key` header auth

---

## Rollback Plan

1. Phases 1-4 are additive — old files coexist with new
2. Phase 5 (deletion) is a separate commit for clean revert
3. Take Neon DB snapshot before Phase 5 DROP TABLE migration
4. If new system fails, revert to commit before Phase 5

---

## Verification

After all phases complete:

```bash
npm run lint && npx tsc --noEmit && npm test
```

- [x] `npm run lint`
- [x] `npx tsc --noEmit`
- [x] `npm test`

Visual verification:
- [ ] Jarvis icon in sidebar opens slide-out panel from any tab
- [ ] Chat section sends messages and receives structured responses
- [ ] `/research AAPL` in chat triggers research report generation
- [ ] `/analyze` in chat triggers trade analysis
- [ ] Research section shows saved reports + "New Report" trigger
- [ ] Macro section shows today's summary
- [ ] No references to old RAG files remain (embeddings, knowledge chunks, orchestrator)
- [ ] `jarvis_request_log` still records token usage for new pipelines

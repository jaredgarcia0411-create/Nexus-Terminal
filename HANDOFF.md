# Nexus Terminal — HANDOFF.md

## Active Handoff Only

Historical completed sections removed — use git history and `specs/` for archived detail.

### Session Maintenance Checklist

- [ ] Update `AGENTS.md` after Discord import feature ships — document new tables, API routes, parser module, env vars
- [x] Review `AGENTIC_EXPANSIONV2.md` and replace `AEV2_REVISIONS.md` with a literal pre-sprint edit script for the next spec pass
- [x] Apply `AEV2_REVISIONS.md` to `AGENTIC_EXPANSIONV2.md` and rename the spec file from `AGENTIC_EXPANSION_V2.md`
- [x] Run the post-patch cleanup sweep on `AGENTIC_EXPANSIONV2.md`
- [x] Refresh `AEV2_REVISIONS.md` with sprint-board blockers, launch blockers, and locked routing/service-route decisions from the latest review
- [x] Convert `AEV2_REVISIONS.md` from redline checklist into a literal section-by-section patch plan for the next spec pass
- [x] **Execute R6 consolidation pass on AGENTIC_EXPANSIONV2.md** (this handoff)
- [x] Draft a tight pre-sprint blocker patch checklist in `HANDOFF.md` from the latest AGENTIC_EXPANSIONV2 review
- [x] Expand the blocker checklist into an exact section-by-section patch plan with replacement targets
- [x] Execute the pre-sprint blocker patch plan on `AGENTIC_EXPANSIONV2.md`
- [x] Draft `AEV2_DRAFT.md` with initiative/epic/story/sprint breakdown for `AGENTIC_EXPANSIONV2.md`

---

## Codebase Simplification — Deferred Items

> Generated: 2026-04-02 | Status: PENDING
> Context: Simplification pass removed circuit breaker, token tracking overhead, admin stats, empty scaffolding, and extracted shared quote mappers. These items remain as follow-up work.

### 1. Normalize AskEdgar research data on the server (Medium risk)

**Problem:** `ResearchReportSections.tsx` is 950 lines with 148 instances of `getField()` doing multi-key fallback resolution. The `/api/askedgar/lookup` endpoint returns raw AskEdgar data untouched — all field normalization, filtering (equity line dedup, warrant status calc, baby shelf classification) happens client-side.

**Target:**
- Create `/api/askedgar/snapshot` endpoint that returns a normalized `ResearchSnapshot` shape
- Move field fallback logic (`getField(row, ['snake_case', 'camelCase'])`) into server-side normalizer
- Move filtering (equity line dedup, warrant classification) to server
- Reduce `ResearchReportSections.tsx` from ~950 to ~600 lines (render-only)

**Files:**
- `lib/jarvis/askedgar.ts` — add `normalizeAskEdgarResponse()` function
- `app/api/askedgar/snapshot/route.ts` — new endpoint (or extend `/lookup`)
- `components/trading/ResearchReportSections.tsx` — strip transformation logic, keep rendering

### 2. Break up snapshot route (Medium risk)

**Problem:** `app/api/market-data/snapshot/route.ts` is 701 lines — the largest API route. Contains 3 data source fallbacks (realtime DB, cached snapshot, Massive API), extended session logic, and inline instrument mapping.

**Target:**
- Extract `fetchFreshSnapshot()` + `toInstrument()` (Massive API path) into `lib/massive-snapshot.ts`
- Extract `fetchRealtimeSnapshot()` into `lib/realtime-snapshot.ts`
- Leave route as thin orchestrator (~150 lines) that picks the right data source

**Files:**
- `app/api/market-data/snapshot/route.ts` — shrink to orchestrator
- `lib/massive-snapshot.ts` — new, Massive API snapshot builder
- `lib/realtime-snapshot.ts` — new, realtime DB snapshot builder

### 3. Merge Jarvis chat + stream routes (Low risk)

**Problem:** `app/api/jarvis/chat/route.ts` (non-streaming) and `app/api/jarvis/chat/stream/route.ts` (streaming) duplicate ~60 lines of auth, rate limiting, context building, and conversation saving logic.

**Target:**
- Merge into single route with `?stream=1` param
- Commands (`/research`, `/analyze`) always return JSON
- Normal chat streams by default
- Requires frontend update to call unified endpoint

**Files:**
- `app/api/jarvis/chat/route.ts` — merge stream logic in
- `app/api/jarvis/chat/stream/route.ts` — delete after merge
- Frontend Jarvis component — update endpoint URL

---

## Codebase Simplification — Phase 4

> Generated: 2026-03-24 | Phases 1-3 complete (948f120), Phase 4 remains
> Phase 1: dead code deletion (~700+ lines). Phase 2: bug-risk duplication. Phase 3: shared API route patterns. All done.

### Phase 4: Component Dedup (touch as needed)

**4.1** Extract `AskEdgarEndpointResponse` interface (copy-pasted in 3 components) + shared helpers (`formatNumber`, `formatMoney`, `getField`, `riskClass`) → `lib/askedgar-utils.ts`
**4.2** Extract `buildTradeMarkers()` (duplicated in `JournalTradeChart.tsx` + `TradeDetailSheet.tsx`) → `lib/trading-utils.ts`
**4.3** Move chart color constants + `FRAME_CONFIG` to `lib/chart-timeframes.ts` (duplicated across 3 chart components)
**4.4** Wrap PerformanceTab symbol distribution in `useMemo` (non-memoized reduce at lines 71-88)
**4.5** Lower priority: `ResearchChart` reimplements chart lifecycle, duplicate stat calcs, duplicate pagination, double `fetchResults` on mount in `use-scanner.ts`, `sortTrades` alias

### Deferred

- `lib/trade-migration.ts` — keep until all users confirmed migrated from localStorage
- `lib/storage.ts` — tied to trade-migration
- Discord import/sync routes — headless but functional
- Jarvis research/trade-analysis routes — redundant with chat but functional
- `hooks/trade-utils.ts` → `lib/trade-utils.ts` rename — low priority
- `buildResearchPrompt` in prompts.ts — now dead but harmless

---

## Low-Priority Spec Cleanup (AGENTIC_EXPANSIONV2.md)

These are minor issues found during the 2026-03-29 spec review. None block sprint import, but should be cleaned up when convenient.

- **R8 — `step_log` guidance stated twice.** Line ~822 repeats the same `step_log` content rules from Section 3.2. Replace with a cross-reference: "See Section 3.2 for `step_log` content rules."
- **R9 — "Multi-agent fanout deferred to V2" stated 4 times.** Keep in Executive Summary + Section 13 closing note. Trim the other two instances (Section 6.1 ~line 557 and Section 13 ~line 1649) to short cross-references.
- **R10 — Polling timeout (120s/60 attempts) stated twice.** Section 20 Discord Adapter should reference Section 13 for timeout details instead of restating them.
- **M2 — Budget is per-agent but env var name doesn't clarify.** Add note to Section 19: "Each agent enforces its own budget independently — $5/day default means $15/day total across 3 agents."
- **M3 — `swing:research` step 6 missing `idempotencyKey`.** Add `idempotencyKey: 'swing-research-{ticker}-{date}'` to the metadata.
- **M4 — `getDb()` vs `getAgentDb()` distinction never stated.** Add note: "Vercel routes use `getDb()` from `lib/server-db-utils.ts` (HTTP client). Docker agent workers use `getAgentDb()` from `lib/agents/db.ts` (WebSocket pool). Never mix them."
- **B11 — Two `lib/jarvis/` files missing from Phase 7 delete list.** Add `chat-helpers.ts` and `historical-summary.ts` to the Phase 7 delete list in Section 18.
- **B15 — `services/discord-bot/` already exists with a `dist/` directory.** Audit existing contents before Phase 5 Step 44 — the spec treats it as a fresh creation but files may already be there.
- **B18 — `services/.env.example` contents never specified.** Generate from Docker Compose `environment:` blocks or include a template in Section 15.

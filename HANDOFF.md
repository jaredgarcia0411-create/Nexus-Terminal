# Nexus Terminal — HANDOFF.md

## Active Handoff Only

Historical completed sections (Scanner Realtime Data Pipeline, Tech Debt PRs 1-5, SSE Phases 0-2, Keyboard Shortcuts, Discord Research Report Extraction Phases 1-4, SSE Jarvis Streaming, Discord Research Schwab Validation, Research Tab Full Redesign, Direct Relay WebSocket, Macro Summary Upgrade) were removed to keep this file focused.
Use git history and the `specs/` directory for archived implementation detail.

### Session Maintenance Checklist

- [x] Refreshed `AGENTS.md` with current build/lint/test commands, single-test workflows, and coding conventions for agentic coding tools.
- [x] Verified command set and conventions against the current repository configuration (`package.json`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.mjs`).
- [x] Updated Charts tab drawing UX: left-aligned toolbar, double-click selection, per-drawing delete, and persisted Fibonacci levels.
- [x] Updated Charts tab interactions: square sidebar controls, 1D previous+current pre/post session window, active-tool chart lock, and draggable drawing endpoints.
- [x] Fixed Charts tab drawing tool usability — trendline, rectangle, and fibonacci render reliably and chart lock only applies during active draw/drag interactions
- [x] Validation passed for Charts tab drawing tools fix — `npm run lint`, `npx tsc --noEmit`, and `npm test` all passed on 2026-03-25
- [ ] Update `AGENTS.md` after Discord import feature ships — document new tables, API routes, parser module, env vars

---

## Schwab Relay Auth — Parallel Blocker

> Generated: 2026-03-16 | Status: OPEN

- Relay logs show repeated `Failed to load Schwab user preference (401)`.
- This keeps `realtime_quotes` stale or empty, which directly degrades Scanner results.
- Schwab refresh tokens expire every **7 days** — you need to re-login via the Schwab OAuth flow weekly.

### Next steps

1. Re-link Schwab account in the app (Markets tab → Schwab status)
2. After relinking, check Fly logs for `LOGIN successful, subscribing...` and quote-write activity
3. If 401 persists after fresh relink, investigate whether the relay is loading the correct tokens from the DB

---

## Codebase Simplification — Phases 2-4

> Generated: 2026-03-24 | Phases 1-2 complete, Phases 3-4 remain
> 5 parallel nexus-architect subagents audited every file in `lib/`, `lib/jarvis/`, `hooks/`, `app/api/`, and `components/trading/`.
> Phase 1 (dead code deletion) is done — ~700+ lines removed.
> Phase 2 (bug-risk duplication) is done — 0 lint/type errors, 207/207 tests passing.

### Phase 2: Fix Bug-Risk Duplication ✅

- **2.1** All component reads aligned to `trade.netPnl`; `pnl`/`executions` aliases retained for DB compat only
- **2.2** `askedgar/tldr` route now calls `runResearchTldr()` with optional `historicalSummary`/`discordReport` context
- **2.3** `parseResearchCommand` + `saveConversation` extracted to `lib/jarvis/chat-helpers.ts`
- **2.4** `SIDE_ALIASES`, `COLUMN_ALIASES`, `parseCost`, `parseTimeToSeconds`, `normalizeColumnNames` consolidated into `lib/parsers/utils.ts`

### Phase 3: Consolidate Shared API Route Patterns

**3.1** Wire `dbUnavailable()` into 17 routes that inline it (helper exists in `server-db-utils.ts`)
**3.2** Extract `requireCronSecret()` — copy-pasted in 2 cron routes → move to `lib/server-db-utils.ts`
**3.3** Extract `rateLimitExceededResponse()` — same 429 block in 4 jarvis routes → add to `lib/jarvis/rate-limit.ts`
**3.4** Extract `buildTradeInsertValues()` — 20+ field insert duplicated in 2 trade routes (note: import omits `notes` from conflict update intentionally)
**3.5** Extract `saveDiscordReports()` — same insert loop in 3 discord routes → `lib/discord/`
**3.6** Move `INDEX_SYMBOLS`/`COMMODITY_SYMBOLS`/`EQUITY_SYMBOLS` to `lib/massive-market.ts` (duplicated in 2 market routes)
**3.7** Move `ScannerSortKey`/`ScannerSortDir` types to `lib/types.ts` (can't import from `'use client'` hook into server route)
**3.8** Export `buildQueryString` from `use-scanner.ts` (duplicated in `use-market-stream.ts`)
**3.9** Smaller cleanups:
- `normalizeTimestamp()` duplicated in 2 trade routes → `lib/time-utils.ts`
- `toNumberOrUndefined()` duplicated in 2 routes → `lib/api-route-utils.ts`
- `requireDiscordConfig()` env check in 3 discord routes (+ status code inconsistency 400 vs 503)
- AskEdgar routes skip `logRouteError`/`internalServerError` → use standard helpers
- `askedgar/tldr` skips `parseAndValidate` → add Zod schema
- `market-data/stream` missing top-level try/catch
- Ticker normalize + regex repeated → use `TICKER_REGEX` from askedgar, create `normalizeTicker()`

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

## Charts Tab Drawing Tools Fix Spec

> Generated: 2026-03-25 | Status: COMPLETE
> Goal: make trendline, rectangle, and fibonacci tools usable. Drawings must appear while drawing and after placement. The chart must only lock while the user is actively drawing or dragging, not merely because a tool is selected.

### Scope

- In scope: `components/trading/ChartsTab.tsx`, `components/trading/ChartDrawings.tsx`, `hooks/use-chart-drawings.ts`
- Out of scope: redesigning the toolbar UI, changing stored drawing format beyond safe normalization, adding new drawing tools, changing unrelated chart indicators/layout

### Problems confirmed

1. Chart lock is driven by `activeDrawingTool`, so the chart stays locked whenever a tool is armed.
2. Draw lifecycle is inconsistent: drawing starts from chart click, updates from crosshair move, and finishes from global mouseup.
3. Escape only deselects selected drawings; it does not cancel an active tool or temp drawing.
4. Endpoint dragging finishes on a later click instead of pointer up.
5. `useChartDrawings()` loads symbol drawings only once and can leak drawings across symbol switches.
6. Non-horizontal drawings fail on non-candles/non-bars because `seriesInstance` is set to `null`.

### Required implementation order

#### 1. Fix `use-chart-drawings.ts` state model first

File: `hooks/use-chart-drawings.ts`

1. Add a small helper inside the file to load drawings for a specific symbol from localStorage.
2. Add a helper to normalize loaded drawings safely:
   - Keep valid `horizontal`, `trendline`, `rectangle`, and `fibonacci` drawings only.
   - For fibonacci drawings missing `levels`, fill with `lastFibLevels` or `DEFAULT_FIB_LEVELS`.
   - Drop malformed objects instead of trusting them.
3. Replace the current one-time lazy symbol load with symbol-aware synchronization:
   - When `symbol` changes, load that symbol’s drawings from storage.
   - Clear `tempDrawing` and set `isDrawing` to `false` on symbol change.
4. Ensure deselecting or changing the external tool cancels any in-progress temp drawing:
   - Add an effect that watches `externalActiveTool`.
   - If the tool becomes `null`, call the same logic as `cancelDrawing()`.
5. Make fibonacci temp drawings include `levels` immediately so preview and saved drawings use the same shape.
6. Do not change the public return API from the hook except as needed to expose existing state already used by the chart layer.

Expected result after step 1:
- Symbol changes load the correct saved drawings.
- Temporary drawings cannot leak across symbols or stale tool changes.
- Fibonacci previews use the same levels as saved fibonacci drawings.

#### 2. Rework drawing interaction flow in `ChartDrawings.tsx`

File: `components/trading/ChartDrawings.tsx`

1. Keep the existing canvas overlay, renderers, selection UI, and delete/settings buttons.
2. Replace the current mixed click/mouseup lifecycle with a consistent interaction model.
3. Use this behavior exactly:
   - First click with an active tool starts a new drawing at that point.
   - Crosshair move updates the temp drawing preview while `isDrawing` is true.
   - Second click finishes the drawing at that point.
   - Escape cancels the in-progress drawing, clears drag state, and calls `onToolChange(null)`.
4. Endpoint dragging behavior must be:
   - Click near an endpoint selects the drawing and starts drag mode.
   - Crosshair move updates the dragged endpoint.
   - Global `mouseup` ends drag mode.
   - Escape cancels drag mode.
5. Remove the current behavior where a new drawing finishes on global `mouseup`.
6. Keep selection behavior when no tool is active:
   - Clicking a drawing selects it.
   - Clicking empty space deselects it.
   - Double-click selection support should remain unless it becomes redundant after the new click flow.
7. Add a single derived interaction flag in this component:
   - `isInteracting = isDrawing || dragState !== null`
8. Expose that interaction state to the parent through a new optional prop:
   - `onInteractionChange?: (isInteracting: boolean) => void`
   - Call it from an effect whenever `isInteracting` changes.
9. Expand Escape handling so it does all of the following in priority order:
   - cancel active temp drawing if present
   - cancel endpoint drag if present
   - deselect selected drawing if present
   - unarm the current tool via `onToolChange(null)` if a tool is active

Expected result after step 2:
- Trendline / rectangle / fibonacci placement follows a clean two-click flow.
- Dragging endpoints stops on mouseup.
- Escape is a reliable exit path from drawing mode.

#### 3. Fix chart locking in `ChartsTab.tsx`

File: `components/trading/ChartsTab.tsx`

1. Add local state for active chart interaction, for example `isDrawingInteractionActive`.
2. Pass `onInteractionChange={setIsDrawingInteractionActive}` into `ChartDrawings`.
3. Change chart lock behavior so it is based on interaction state, not tool selection:
   - `handleScroll: !isDrawingInteractionActive`
   - `handleScale: !isDrawingInteractionActive`
4. Remove `activeDrawingTool` from the chart-creation effect dependency list if it is only there for lock behavior.
5. After chart creation, add a separate effect that updates chart interaction options with `chart.applyOptions(...)` whenever `isDrawingInteractionActive` changes.
6. Do not recreate the entire chart just because a drawing tool is selected or deselected.

Expected result after step 3:
- User can arm a drawing tool without freezing chart navigation.
- Chart only locks during the actual draw/drag interaction.

#### 4. Fix series access for drawing coordinate conversion

File: `components/trading/ChartsTab.tsx`

1. Stop setting `seriesInstance` to `null` for `line`, `area`, and `baseline` charts.
2. Store the created base series in state for all chart types so `ChartDrawings` always has a series object for price-coordinate conversion.
3. Keep the prop type acceptable for `ChartDrawings` with the smallest necessary change:
   - update the `series` prop type in `ChartDrawings.tsx` if needed so it can accept the supported base series types used here.
4. Do not change the actual chart series rendering behavior; this step is only for drawing coordinate conversion.

Expected result after step 4:
- Trendline / rectangle / fibonacci drawings can render on line, area, and baseline charts too.

#### 5. Keep rendering behavior stable after the interaction/state fixes

Files: `components/trading/ChartDrawings.tsx`, `hooks/use-chart-drawings.ts`

1. Ensure completed drawings and temp drawings still render through the existing `renderDrawings()` path.
2. Keep horizontal line rendering via `createPriceLine` unchanged unless required by the new interaction flow.
3. Do not remove localStorage persistence.
4. Keep existing delete and fibonacci settings flows working for selected drawings.

#### 6. Validation and regression checks

Run from repo root in this exact order:

1. `npm run lint`
2. `npx tsc --noEmit`

Manual verification checklist:

1. Candles mode:
   - arm trendline
   - first click starts preview
   - move crosshair updates preview
   - second click commits drawing
   - chart is only locked between first and second click
2. Repeat the same flow for rectangle and fibonacci.
3. Press Escape while a tool is armed but before first click:
   - tool clears
   - chart remains usable
4. Press Escape after first click but before second click:
   - temp drawing disappears
   - tool clears
   - chart unlocks
5. Select an existing drawing and drag one endpoint:
   - endpoint follows crosshair
   - mouseup ends drag
   - chart unlocks after mouseup
6. Switch symbols:
   - old symbol drawings do not leak into the new symbol
   - returning to the original symbol shows its saved drawings
7. Switch chart series type between candles, bars, line, area, and baseline:
   - existing non-horizontal drawings remain visible
   - new non-horizontal drawings can be placed

### Implementation guardrails

- Keep code simple. Do not introduce a new abstraction layer or a generic drawing engine.
- Preserve current file structure.
- Prefer small helper functions and focused effects over a large refactor.
- Do not touch unrelated chart features.
- After finishing, update the checklist at the top of this file with completion status and validation results.

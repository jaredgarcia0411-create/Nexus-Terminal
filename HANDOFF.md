# Nexus Terminal — HANDOFF.md

> Older completed execution specs were removed to keep this file focused. Use git history for archived implementation detail.

### Workflow Tooling Note

- 2026-04-06: Added a repo-maintained Codex `commit` alias skill in [`codex-skills/commit/`](/home/jared/Nexus-Terminal/codex-skills/commit) and UI metadata for [`codex-skills/nexus-commit/`](/home/jared/Nexus-Terminal/codex-skills/nexus-commit) so Codex can surface a user-facing commit entry point while keeping `nexus-commit` as the canonical workflow.
- 2026-04-07: Audited the Codex harness docs and refreshed [`AGENTS.md`](/home/jared/Nexus-Terminal/AGENTS.md) plus repo-maintained skill sources in [`codex-skills/`](/home/jared/Nexus-Terminal/codex-skills) to remove stale `.claude`/`.opencode` assumptions, fix the `lib/trade-utils.ts` path, and document repo-local skill agent metadata.
- 2026-04-12: Added a repo-maintained Codex deep-research skill in [`codex-skills/nexus-deep-research/`](/home/jared/Nexus-Terminal/codex-skills/nexus-deep-research). It coordinates parallel subagent research passes for repo-specific investigations and only saves markdown briefs under `docs/research/` when the user explicitly asks for an artifact.
- 2026-04-12: Clarified skill discovery in [`AGENTS.md`](/home/jared/Nexus-Terminal/AGENTS.md): repo-local `codex-skills/` content is source-of-truth for the repo, but Codex only surfaces a skill after it is synced into `~/.codex/skills/<skill-name>` and the session is restarted.
- 2026-04-12: Archived the completed AEV2 execution plan; `HANDOFF.md` is again the active execution-spec surface and git history is the archive for completed rollout sequencing.

---

## Agent Response Improvement — Reports + Macro Summary (P2+)

> Generated: 2026-04-12
> Revised: 2026-04-12
> Status: READY FOR EXECUTION

### Objective

Finish the remaining response-quality work after the completed P0/P1 pass: persist assistant turns, route routed specialist results back into Discord, enrich the specialist report objects so they are deterministic and source-backed, rebuild the report renderers around stable contracts, and redesign the macro summary so the stored JSON, Discord embed, context assembly, and API route all agree.

### Locked Decisions

- Discord remains the primary delivery surface, but `agent_reports.report_json` becomes the canonical typed research object.
- Source-backed JSON comes first; routes should expose the stored contract rather than invent UI-only fields.
- `market-strength` and `ai-chart-analysis` are optional enrichments. Use them only if their endpoint contracts are verified during implementation.
- `fetchJmt415()` is out of scope for this sprint unless its endpoint contract is confirmed before coding begins.
- No entry, stop, or target levels return to the swing report. Keep it traffic-light plus pattern context only.
- Attribution / provenance redesign (replacing `evidenceIds` with section-level provenance objects) is deferred to a follow-up sprint. Keep `evidenceIds: string[]` as-is for now.

### Current State

- [`app/api/agents/service/chat/route.ts`](/home/jared/Nexus-Terminal/app/api/agents/service/chat/route.ts) persists the user turn into `agent_conversations`, but [`lib/agents/blueprints/orchestrator-chat.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprints/orchestrator-chat.ts) does not persist the assistant reply after synthesis.
- [`services/discord-bot/index.ts`](/home/jared/Nexus-Terminal/services/discord-bot/index.ts) stops at "Your request was routed..." when the orchestrator hands work to a specialist. It never posts the final specialist result back into `#orchestrator`.
- [`lib/agents/blueprints/small-cap-research.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprints/small-cap-research.ts) and [`lib/agents/blueprints/swing-trader-research.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprints/swing-trader-research.ts) now emit traffic-light JSON, but they still underuse the AskEdgar snapshot and only send thin deterministic inputs into the LLM.
- [`lib/agents/discord.ts`](/home/jared/Nexus-Terminal/lib/agents/discord.ts) renders small-cap and swing research from semi-structured payloads, but `buildMacroSummaryEmbed()` still expects a shape (`marketBias`, `rates`, `breadth`, `topTheme`, `watchlist`) that [`lib/agents/blueprints/orchestrator-macro-summary.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprints/orchestrator-macro-summary.ts) does not store.
- [`lib/agents/blueprints/orchestrator-macro-summary.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprints/orchestrator-macro-summary.ts) stores `{ summary, keyEvents, sectorNotes, confidence }` as `reportJson` (with `tradingDate` used as the report title, not stored inside the JSON). The Discord embed, context assembly, and API route all treat this as an untyped blob.
- [`app/api/agents/reports/route.ts`](/home/jared/Nexus-Terminal/app/api/agents/reports/route.ts) and [`app/api/agents/reports/[id]/route.ts`](/home/jared/Nexus-Terminal/app/api/agents/reports/[id]/route.ts) currently expose only the minimum fields. They do not surface summary and delivery metadata consistently enough for future report consumers.
- [`lib/agents/config.ts`](/home/jared/Nexus-Terminal/lib/agents/config.ts) still leaves `pre-market-scan`, `momentum-scan`, and `pattern-check` as stubs. This spec does not implement those blueprints.

### Scope Boundaries

- Do not add new tables or migrations.
- Do not change auth, queue semantics, or webhook idempotency beyond what is required for routed specialist replies.
- Do not add unverified premium AskEdgar endpoints as hard dependencies.
- Keep all data-fetching server-side. Do not expose API keys or raw provider payloads to the client.

---

### Typed Report Contracts (Reference)

All interfaces below go in [`lib/agents/types.ts`](/home/jared/Nexus-Terminal/lib/agents/types.ts). The blueprint Zod schemas must match these interfaces. When a step produces data matching one of these shapes, Codex can cross-reference this section to verify field accuracy.

#### Shared Primitives

```ts
type TrafficLight = 'green' | 'yellow' | 'red';
type Confidence = 'high' | 'medium' | 'low';

interface TrafficLightSection {
  rating: TrafficLight;
  explanation: string;
}

interface RatedCatalyst {
  catalyst: string;
  rating: TrafficLight;
}
```

#### SmallCapResearchReport

Mirrors the existing `researchReportSchema` Zod schema in `small-cap-research.ts`. No new fields — the enrichment changes the *input* to the LLM, not the *output*.

```ts
interface SmallCapResearchReport {
  ticker: string;
  newsWhyRunning: TrafficLightSection;
  themeMatch: TrafficLightSection;
  otherCatalysts: RatedCatalyst[];
  chartHistory: TrafficLightSection;
  dilution: TrafficLightSection;
  offeringFrequency: TrafficLightSection;
  offeringAbility: TrafficLightSection;
  cashNeed: TrafficLightSection;
  overallOfferingRisk: TrafficLightSection;
  jmt415Commentary: string | null;
  historicalStats: string;
  confidence: Confidence;
  evidenceIds: string[];
}
```

#### SwingResearchReport

Mirrors the existing `swingResearchSchema` Zod schema in `swing-trader-research.ts`.

```ts
interface SwingResearchReport {
  ticker: string;
  mdrPatternMatch: TrafficLightSection & { mdrSimilarity: number };
  momentum: TrafficLightSection;
  catalyst: TrafficLightSection;
  patternClassification: 'BREAKOUT' | 'EXHAUSTION' | 'CONTINUATION' | 'STOPPED';
  recommendation: {
    action: 'HOLD' | 'ADD' | 'TRIM' | 'EXIT' | 'WATCH';
    reasoning: string;
  };
  volumeProfile: TrafficLightSection;
  confidence: Confidence;
  evidenceIds: string[];
}
```

#### MacroSummaryReport

Replaces the current `{ summary, keyEvents, sectorNotes, confidence }` shape. This is the new target schema for storage, Discord rendering, context formatting, and the API route.

```ts
interface MacroSource {
  id: string;          // e.g., 'headline:marketwatch.com', 'snapshot:SPY'
  title: string;       // e.g., 'MarketWatch Latest News', 'SPY Session Snapshot'
  url: string | null;  // headline source URL; null for ticker snapshots
  fetchedAt: string;   // ISO timestamp
}

interface MacroDriver {
  driver: string;           // e.g., 'CPI print comes in hotter than expected'
  impact: 'positive' | 'negative' | 'mixed';
  sourceRefs: string[];     // ids from sourceIndex
}

interface CrossAssetEntry {
  ticker: string;
  price: number | null;
  changePercent: number | null;
}

interface ScheduledCatalyst {
  event: string;            // e.g., 'FOMC rate decision'
  date: string | null;      // ISO date or null if unknown
  expectedImpact: string;   // brief description
}

interface MacroSummaryReport {
  tradingDate: string;
  marketBias: 'bullish' | 'bearish' | 'neutral';
  summary: string;
  drivers: MacroDriver[];
  crossAssetSnapshot: CrossAssetEntry[];
  scheduledCatalysts: ScheduledCatalyst[];
  sectorRotation: string[];
  deskImplications: string[];
  sourceIndex: MacroSource[];
  confidence: Confidence;
}
```

**Design rationale:**
- `crossAssetSnapshot` is built deterministically from the Massive API `fetchUnifiedSnapshot()` response *before* the LLM step. Each entry maps from `MassiveSnapshotResult.session` fields.
- `sourceIndex` is built deterministically from the scraped headline URLs + the Massive ticker list *before* the LLM step. Each headline URL becomes a `MacroSource` entry; each ticker snapshot becomes a `MacroSource` entry.
- `drivers`, `scheduledCatalysts`, `sectorRotation`, `deskImplications`, and `marketBias` are LLM-synthesized. The LLM prompt must require each driver's `sourceRefs` to reference entries from `sourceIndex`.
- `summary` is LLM-synthesized — 2-3 sentence overview.
- Data sources do not change: still 2 headline URLs (MarketWatch, Yahoo Finance) + 10 ticker snapshots from Massive.

#### Report API Envelope

When routes return a report, use this stable shape:

```ts
interface ReportApiResponse {
  id: string;
  agent_id: AgentId;
  report_type: string;
  title: string;
  summary: string | null;
  status: ReportStatus;
  delivery_error: string | null;
  created_at: string | null;
  report_json: SmallCapResearchReport | SwingResearchReport | MacroSummaryReport | unknown;
}
```

---

### Required Changes

#### Step 1 — Lock Typed Report Contracts And Route Metadata

- **Files:** [`lib/agents/types.ts`](/home/jared/Nexus-Terminal/lib/agents/types.ts), [`app/api/agents/reports/route.ts`](/home/jared/Nexus-Terminal/app/api/agents/reports/route.ts), [`app/api/agents/reports/[id]/route.ts`](/home/jared/Nexus-Terminal/app/api/agents/reports/[id]/route.ts), [`app/api/agents/macro-summary/latest/route.ts`](/home/jared/Nexus-Terminal/app/api/agents/macro-summary/latest/route.ts)
- **Actions:**
  1. Add the shared primitives (`TrafficLight`, `Confidence`, `TrafficLightSection`, `RatedCatalyst`) and the three report interfaces (`SmallCapResearchReport`, `SwingResearchReport`, `MacroSummaryReport`) plus `MacroSource`, `MacroDriver`, `CrossAssetEntry`, `ScheduledCatalyst` to `lib/agents/types.ts`. Export all of them.
  2. Replace `AgentContext.macroSummary: unknown | null` with `macroSummary: MacroSummaryReport | null`.
  3. Update the reports list route (`reports/route.ts`) to include `summary`, `delivery_error`, and `title` in the returned fields (they are already in the schema, just not selected).
  4. Update the single-report route (`reports/[id]/route.ts`) to return the full `ReportApiResponse` envelope: add `title`, `summary`, `delivery_error`, and `created_at` alongside the existing `report_json`.
  5. Update the macro latest route to:
     - Remove the `eq(agentReports.status, 'published')` filter so delivery failures are visible.
     - Add `status` and `deliveryError` to the returned shape.
  6. Keep `evidenceIds: string[]` in the report schemas. Do not add provenance objects yet.
- **Why order matters:** every downstream blueprint, embed builder, and test needs a single contract to target.
- **Acceptance criteria:**
  - Explicit interfaces exist in `types.ts` for all three report families.
  - Routes return the `ReportApiResponse` envelope fields.
  - The macro latest route exposes delivery status.
  - `npm run lint && npx tsc --noEmit` passes.

#### Step 2 — Persist Assistant Turns And Routed Specialist Replies

- **Files:** [`lib/agents/blueprints/orchestrator-chat.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprints/orchestrator-chat.ts), [`app/api/agents/service/chat/route.ts`](/home/jared/Nexus-Terminal/app/api/agents/service/chat/route.ts), [`services/discord-bot/index.ts`](/home/jared/Nexus-Terminal/services/discord-bot/index.ts)
- **Tests:** [`__tests__/agent-blueprints.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-blueprints.test.ts), [`__tests__/agent-service-chat-route.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-service-chat-route.test.ts)

##### 2a — Persist assistant turns

- **Where:** `orchestrator-chat.ts`, `synthesize-response` step.
- **Action:** After the LLM response is extracted, insert an `agent_conversations` row with `role: 'assistant'`, using the same `session_id` and `channel` from `jobInput`. Use the existing `agentConversations` table — `session_id` and `channel` columns already exist. Import `agentConversations` from `@/lib/db/schema` and access `db` from `StepInput`.
- **Exact insert shape:**
  ```ts
  await db.insert(agentConversations).values({
    id: randomUUID(),
    userId: job.userId,
    agentId: 'orchestrator',
    sessionId: chatInput.session_id ?? job.id,
    role: 'assistant',
    content: content, // the extracted LLM response text
    channel: chatInput.channel,
  });
  ```

##### 2b — Route origin context for specialist jobs

- **Where:** `orchestrator-chat.ts`, `classify-and-route` step, line ~201 where the specialist job is inserted.
- **Action:** Add `origin_channel_id` to the specialist job `input` object alongside the existing `originator_job_id` and `ticker`:
  ```ts
  input: {
    ticker: extractTicker(trimmedMessage),
    originator_job_id: job.id,
    origin_channel_id: chatInput.channel,  // NEW — 'web' | 'discord'
  },
  ```
  This tells the Discord bot which channel originated the request. The `originator_job_id` already exists and links back to the chat job.

##### 2c — Service chat GET: surface specialist job results

- **Where:** `app/api/agents/service/chat/route.ts`, GET handler, the `status === 'completed'` block.
- **Action:** After the `result.routed === true` branch, add handling for specialist job results. When the result contains `reportId` (set by the specialist's `save-research` step), surface it:
  ```ts
  // Inside status === 'completed' block, after the routed check:
  const reportId = typeof result.reportId === 'string' ? result.reportId : null;
  const ticker = typeof result.ticker === 'string' ? result.ticker : null;
  if (reportId || ticker) {
    return Response.json({
      status: 'completed',
      job_id: job.id,
      agent_id: job.agentId,
      result: {
        routed: false,
        message: ticker
          ? `Research complete for ${ticker}.`
          : 'Research complete.',
        reportId,
        ticker,
      },
    });
  }
  ```

##### 2d — Discord bot: poll specialist and post result

- **Where:** `services/discord-bot/index.ts`, `handleMessage` function, the `state.result.routed` block (~line 415-422).
- **Action:** Replace the current "Your request was routed..." plain reply with specialist polling:
  1. Send an immediate status reply: `"Routed to specialist — waiting for results..."`.
  2. If `state.result.specialistJobId` is non-null, call `waitForTerminalState(config, message.author.id, state.result.specialistJobId)` — this reuses the existing polling function which already uses `POLL_INTERVAL_MS = 2000` and `MAX_POLL_ATTEMPTS = 60` (2-minute timeout).
  3. When the specialist reaches terminal state:
     - **completed with message:** edit the original status reply or send a new reply via `replyCompleted()` with the specialist's message.
     - **completed but empty message:** reply with `"Research complete. Report delivered to the research channel."`.
     - **failed:** reply with the error message.
     - **timeout:** reply with `"Specialist did not finish within 2 minutes."`.
- **Dedup:** The bot is a long-running process that only starts polling when it receives a new Discord message. Each message triggers at most one specialist poll. On bot restart, no in-flight polls exist and old messages are not replayed. No additional dedup mechanism is needed beyond the natural message-to-poll lifecycle. The specialist report's Discord webhook delivery (to the research channel) is already deduplicated by `agentStepEffects` in `writeAndDeliverReport()`.
- **Acceptance criteria:**
  - Assistant turns are stored for orchestrator chat sessions.
  - Routed specialist requests produce a final Discord reply in `#orchestrator` with the result.
  - Bot does not create duplicate replies for the same message.

#### Step 3a — Expand TradingView Scanner Columns (Small-Cap)

- **File:** [`lib/agents/blueprints/small-cap-research.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprints/small-cap-research.ts)
- **Action:** Add these columns to the `TRADINGVIEW_COLUMNS` array:
  ```ts
  const TRADINGVIEW_COLUMNS = [
    'name', 'close', 'change', 'volume', 'average_volume_90d_calc',
    'market_cap_basic', 'sector',
    // NEW:
    'High.1W', 'Low.1W', 'RSI', 'MACD.macd', 'EMA9', 'EMA21',
  ];
  ```
- Update `fetchTradingViewPriceContext()` to extract and return the new columns. Extend the return object and `priceContextSchema`:
  ```ts
  priceContext: {
    price, change, volume, avgVolume90d, marketCap, sector,  // existing
    high1w: number | null,
    low1w: number | null,
    rsi: number | null,
    macdSignal: number | null,
    ema9: number | null,
    ema21: number | null,
  }
  ```
  Map them by index from `row.d` using `toNullableNumber()`. The new columns start at index 7 (`High.1W`) through index 12 (`EMA21`).
- **Acceptance criteria:** `priceContextSchema` includes the six new nullable number fields. Lint + type-check pass.

#### Step 3b — Promote AskEdgar Sections Into Explicit Inputs (Small-Cap)

- **File:** [`lib/agents/blueprints/small-cap-research.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprints/small-cap-research.ts)
- **Action:** In the `fetch-filings` step, the current code calls `getCachedTickerData(ticker)` and collapses everything into a flat `filings` array and a `cashPosition` blob. Replace this with explicit section extraction from `result.rawData`:
  ```ts
  const rawData = result.rawData as Record<string, { results?: unknown[] }>;
  const section = (key: string) => rawData[key]?.results ?? [];
  ```
  Build an `edgarSections` object passed forward through the pipeline instead of `filings`:
  ```ts
  {
    ticker,
    gapStats: section('gap-stats'),
    offerings: section('offerings'),
    registrations: section('registrations'),
    equityLines: section('equity-lines'),
    dilutionRating: section('dilution-rating'),
    dilutionData: section('dilution-data'),
    ownership: section('ownership'),
    historicalFloat: section('historical-float-pro'),
    reverseSplits: section('reverse-splits'),
    splitStatus: section('split-status'),
    agreements: section('agreements'),
    nasdaqCompliance: section('nasdaq-compliance'),
    pumpAndDumpTracker: section('pump-and-dump-tracker'),
    news: section('news'),
    cashPosition,
  }
  ```
  Update the intermediate Zod schemas to reflect this structure (each section is `z.array(z.unknown())` except `dilutionRating`, `dilutionData`, `ownership`, `splitStatus`, `nasdaqCompliance`, `pumpAndDumpTracker`, and `cashPosition` which are `z.unknown().nullable()`).
- Update `buildResearchPrompt()` to pass each section as a labeled block instead of one `Filings:\n${JSON.stringify(input.filings)}` blob.
- **Acceptance criteria:** The LLM prompt contains labeled sections per AskEdgar endpoint instead of a single `filings` dump.

#### Step 3c — Compute Deterministic Small-Cap Fields

- **File:** [`lib/agents/blueprints/small-cap-research.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprints/small-cap-research.ts)
- **Action:** Add a new `compute-deterministic` step between `fetch-price-context` and `synthesize-report`. This step takes the enriched edgar sections + price context and computes the following fields. The LLM receives these as pre-computed numbers — it does not recalculate them.

| Field | Formula | Source |
|-------|---------|--------|
| `gapCount` | `gapStats.length` | gap-stats |
| `sameDayFadeRate` | `count(entries where close < open) / gapCount`. Null if `gapCount === 0`. | gap-stats |
| `avgCloseVsOpen` | `mean((close - open) / open * 100)` across gap-stats entries. Null if `gapCount === 0`. | gap-stats |
| `avgHighExtension` | `mean((high - open) / open * 100)` across gap-stats entries. Null if `gapCount === 0`. | gap-stats |
| `recentOfferingCount` | Count of offerings where the offering date is within the last 365 days. Parse date strings loosely — use `new Date(entry.date || entry.offering_date)`, skip entries with unparseable dates. | offerings |
| `hasActiveShelf` | `registrations.some(r => r.status?.toLowerCase().includes('effective'))` | registrations |
| `hasActiveAtm` | `offerings.some(o => o.offering_type?.toLowerCase().includes('atm') && o.status?.toLowerCase().includes('active'))` | offerings |
| `amountRemainingAtm` | Sum of `remaining_amount` (or `amount_remaining`) from active ATM offerings. Null if no active ATMs. Parse as number, skip NaN. | offerings |
| `splitApproved` | `splitStatus.some(s => s.status?.toLowerCase().includes('approved'))` | split-status |
| `splitEffectivePending` | `splitStatus.some(s => s.status?.toLowerCase().includes('pending'))` | split-status |
| `daysToComplianceDeadline` | Parse `deadline` (or `compliance_deadline`) from first nasdaq-compliance result. Compute `Math.ceil((deadlineDate - today) / 86400000)`. Null if no deadline or unparseable. | nasdaq-compliance |
| `floatTrend` | Compare first and last entries in `historicalFloat` (sorted by date). If last `float > first float * 1.05`: `'increasing'`. If `< 0.95`: `'decreasing'`. Else `'stable'`. Null if fewer than 2 entries. | historical-float-pro |
| `knownHolderOverhang` | Sum of `percentage` (or `percent_held`) from ownership entries. Null if no ownership data. Cap at 100. | ownership |

- Add a Zod schema for the computed fields object. All numeric fields are `z.number().nullable()`, booleans are `z.boolean()`, `floatTrend` is `z.enum(['increasing', 'decreasing', 'stable']).nullable()`.
- Pass the computed fields into `buildResearchPrompt()` as a separate `Deterministic analysis:` section in the prompt text.
- **Note:** Each formula reads from `unknown[]` arrays — cast each entry to `Record<string, unknown>` and use defensive access. Skip entries that don't have the expected fields rather than throwing.
- **Acceptance criteria:**
  - New pipeline step exists between price-context and synthesize-report.
  - Computed fields appear in the LLM prompt.
  - Lint + type-check pass.

#### Step 4 — Enrich Swing Inputs And Persist Thesis Memory

- **Files:** [`lib/agents/blueprints/swing-trader-research.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprints/swing-trader-research.ts), [`lib/agents/prompts/swing-trader.md`](/home/jared/Nexus-Terminal/lib/agents/prompts/swing-trader.md), [`lib/agents/memory.ts`](/home/jared/Nexus-Terminal/lib/agents/memory.ts)

##### 4a — Expand TradingView columns (same as Step 3a)

- Add the same 6 new TradingView columns (`High.1W`, `Low.1W`, `RSI`, `MACD.macd`, `EMA9`, `EMA21`) to the swing blueprint's `TRADINGVIEW_COLUMNS` array and `fetchTradingViewPriceContext()` return shape. (The swing blueprint has its own copy of these.)

##### 4b — Add deterministic technicals from OHLC

- In the existing `fetch-ohlc-history` step output or in a new `compute-swing-technicals` step, compute:
  - `rsi` — already available from TradingView (4a), pass through.
  - `ema9`, `ema21` — already available from TradingView (4a), pass through.
  - `relativeVolume` — `priceContext.volume / priceContext.avgVolume90d`. Null if either is null.
  - `extension5d` — if OHLC has ≥5 bars: `(latest close - close 5 bars ago) / close 5 bars ago * 100`. Null otherwise.
  - `extension10d` — same formula, 10 bars ago. Null if fewer than 10 bars.
- Pass these as a `Deterministic technicals:` section in `buildResearchPrompt()`.

##### 4c — Add AskEdgar runner-quality inputs

- In the `fetch-filings` step, extract from `rawData` the same way as Step 3b but limited to swing-relevant sections:
  - `gapStats`, `ownership`, `historicalFloat`, `dilutionRating`, `registrations`, `offerings`
  - Compute `floatTrend` (same formula as Step 3c) and `knownHolderOverhang` (same formula as Step 3c).
- Pass as a `Runner quality:` section in the prompt.

##### 4d — Persist thesis memory

- In the `save-research` step, after `writeAndDeliverReport()`, call:
  ```ts
  await upsertMemory(db, {
    userId: job.userId,
    agentId: 'swing-trader',
    category: 'thesis',
    key: report.ticker,
    value: `${report.recommendation.action} — ${report.patternClassification}`,
    valueJson: {
      action: report.recommendation.action,
      pattern: report.patternClassification,
      mdrSimilarity: report.mdrPatternMatch.mdrSimilarity,
      momentum: report.momentum.rating,
      confidence: report.confidence,
    },
    source: `report:${job.id}`,
    confidence: report.confidence,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7-day TTL
  });
  ```
  Import `upsertMemory` from `../memory`. The `agent_memory_v2` table upserts on `(userId, agentId, category, key)`, so re-researching the same ticker overwrites the old thesis.

- **Acceptance criteria:**
  - Swing prompt inputs include deterministic technicals and runner-quality data.
  - Successful research writes a `thesis` memory row keyed by ticker.
  - The report JSON remains traffic-light plus pattern context only — no new output fields.
  - The swing report still contains no entry, stop, or target levels.

#### Step 5 — Rebuild Discord Renderers Around Stable Report Contracts

- **Files:** [`lib/agents/discord.ts`](/home/jared/Nexus-Terminal/lib/agents/discord.ts)
- **Tests:** [`__tests__/agent-discord.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-discord.test.ts)
- **Actions:**
  1. Import `SmallCapResearchReport`, `SwingResearchReport`, `MacroSummaryReport` from `../types`.
  2. **Small-cap embed (`buildResearchEmbed`):** Cast `report.reportJson` to `SmallCapResearchReport`. Read fields directly (e.g., `payload.overallOfferingRisk.rating`) instead of via `readJsonValue()` guessing. Keep the traffic-light emoji rendering for each section. Render `historicalStats` as a non-inline field in a code block: `` `\`\`\`\n${payload.historicalStats}\n\`\`\`` `` — this remains a pre-formatted string from the LLM (not a structured object).
  3. **Swing embed (`buildSwingSetupEmbed`):** Cast to `SwingResearchReport`. Read `mdrPatternMatch.mdrSimilarity` directly. Read `recommendation.action` and `recommendation.reasoning` directly.
  4. **Macro embed (`buildMacroSummaryEmbed`):** Cast to `MacroSummaryReport`. Render:
     - Description: `summary` text.
     - Fields: `Market Bias` (from `marketBias`), `Confidence` (from `confidence`), `Top Drivers` (join first 3 `drivers` with their impact emoji: positive=🟢, negative=🔴, mixed=🟡), `Catalysts` (join `scheduledCatalysts` event+date), `Desk Implications` (join `deskImplications` as bullet list), `Sector Rotation` (join `sectorRotation`).
     - Do NOT render `crossAssetSnapshot` in the embed — it would be too noisy. That data lives in the stored JSON for API consumers.
  5. Keep `writeAndDeliverReport()` idempotency behavior unchanged.
  6. Keep `readJsonValue()` as a private fallback for unknown report types — do not delete it.
- **Acceptance criteria:**
  - Small-cap, swing, and macro embeds use typed access, not `readJsonValue()` key guessing.
  - Embeds stop surfacing `n/a` for fields the schema defines.
  - `npm run lint && npx tsc --noEmit` passes.

#### Step 6 — Redesign The Macro Summary Blueprint

- **Files:** [`lib/agents/blueprints/orchestrator-macro-summary.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprints/orchestrator-macro-summary.ts), [`lib/agents/prompts/orchestrator.md`](/home/jared/Nexus-Terminal/lib/agents/prompts/orchestrator.md), [`lib/agents/context.ts`](/home/jared/Nexus-Terminal/lib/agents/context.ts), [`lib/agents/blueprints/orchestrator-chat.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprints/orchestrator-chat.ts)
- **Tests:** [`__tests__/agent-blueprints.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-blueprints.test.ts), [`__tests__/agent-context.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-context.test.ts), [`__tests__/agent-macro-summary-route.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-macro-summary-route.test.ts)

##### 6a — Build deterministic fields before the LLM

- In the `fetch-market-snapshot` step (or a new step after it), build the deterministic parts of `MacroSummaryReport`:
  - `crossAssetSnapshot`: Map `MassiveSnapshotResult[]` to `CrossAssetEntry[]`:
    ```ts
    results.map(r => ({
      ticker: r.ticker ?? 'UNKNOWN',
      price: r.session?.close ?? null,
      changePercent: r.session?.change_percent ?? null,
    }))
    ```
  - `sourceIndex`: Build from headline URLs + ticker list:
    ```ts
    [
      ...headlineUrls.map(url => ({
        id: `headline:${new URL(url).hostname}`,
        title: `${new URL(url).hostname} headlines`,
        url,
        fetchedAt: new Date().toISOString(),
      })),
      ...MACRO_TICKERS.map(t => ({
        id: `snapshot:${t}`,
        title: `${t} Session Snapshot`,
        url: null,
        fetchedAt: new Date().toISOString(),
      })),
    ]
    ```
  - Pass both into the LLM step as structured context.

##### 6b — Update the LLM prompt for the new schema

- Replace `buildBriefingPrompt()` to request the new schema shape. The LLM must return:
  ```json
  {
    "marketBias": "bullish | bearish | neutral",
    "summary": "2-3 sentence overview",
    "drivers": [{ "driver": "string", "impact": "positive | negative | mixed", "sourceRefs": ["headline:marketwatch.com"] }],
    "scheduledCatalysts": [{ "event": "string", "date": "YYYY-MM-DD or null", "expectedImpact": "string" }],
    "sectorRotation": ["string"],
    "deskImplications": ["string"],
    "confidence": "high | medium | low"
  }
  ```
  The `sourceIndex`, `crossAssetSnapshot`, and `tradingDate` are NOT returned by the LLM — they are assembled deterministically and merged with the LLM output in the save step.
- Update `macroBriefingSchema` Zod to match the new LLM output shape.

##### 6c — Assemble and store the complete report

- In the `save-summary` step, merge the deterministic fields with the LLM output:
  ```ts
  const reportJson: MacroSummaryReport = {
    tradingDate,
    ...llmOutput,               // marketBias, summary, drivers, scheduledCatalysts, etc.
    crossAssetSnapshot,          // from step 6a
    sourceIndex,                 // from step 6a
  };
  ```
  Store via `writeAndDeliverReport()` with `reportJson`.

##### 6d — Update context formatting for orchestrator chat

- In `orchestrator-chat.ts`, `buildSynthesisPrompt()`, replace `JSON.stringify(context.macroSummary)` with a compact formatter:
  ```ts
  function formatMacroContext(macro: MacroSummaryReport): string {
    const lines = [
      `Bias: ${macro.marketBias} (${macro.confidence} confidence)`,
      `Summary: ${macro.summary}`,
      macro.drivers.length > 0
        ? `Drivers: ${macro.drivers.map(d => `${d.driver} (${d.impact})`).join('; ')}`
        : null,
      macro.deskImplications.length > 0
        ? `Desk: ${macro.deskImplications.join('; ')}`
        : null,
    ];
    return lines.filter(Boolean).join('\n');
  }
  ```

##### 6e — Update context.ts

- In `buildContext()`, the macro query already fetches `reportJson` from the latest published macro-summary report. After Step 1 types it as `MacroSummaryReport | null`, no query changes are needed. But add a runtime guard: if the fetched JSON doesn't have `marketBias` (meaning it's an old-format report), return `null` instead of an untyped blob.

- **Acceptance criteria:**
  - One macro schema is shared across storage, context, Discord, and API output.
  - `crossAssetSnapshot` and `sourceIndex` are built before the LLM step.
  - Every driver references at least one `sourceIndex` entry.
  - The orchestrator chat prompt receives a compact formatted macro context, not raw JSON.

---

### Per-File Actions

| File | Action |
|------|--------|
| [`HANDOFF.md`](/home/jared/Nexus-Terminal/HANDOFF.md) | MODIFY |
| [`lib/agents/types.ts`](/home/jared/Nexus-Terminal/lib/agents/types.ts) | MODIFY — add all report interfaces and shared primitives |
| [`lib/agents/blueprints/orchestrator-chat.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprints/orchestrator-chat.ts) | MODIFY — persist assistant turn, compact macro context |
| [`lib/agents/blueprints/orchestrator-macro-summary.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprints/orchestrator-macro-summary.ts) | MODIFY — new schema, deterministic fields, new prompt |
| [`lib/agents/blueprints/small-cap-research.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprints/small-cap-research.ts) | MODIFY — TradingView columns, edgar sections, deterministic step |
| [`lib/agents/blueprints/swing-trader-research.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprints/swing-trader-research.ts) | MODIFY — TradingView columns, technicals, edgar inputs, thesis memory |
| [`lib/agents/prompts/orchestrator.md`](/home/jared/Nexus-Terminal/lib/agents/prompts/orchestrator.md) | MODIFY — update macro prompt shape reference |
| [`lib/agents/prompts/small-cap.md`](/home/jared/Nexus-Terminal/lib/agents/prompts/small-cap.md) | MODIFY — reference new deterministic inputs |
| [`lib/agents/prompts/swing-trader.md`](/home/jared/Nexus-Terminal/lib/agents/prompts/swing-trader.md) | MODIFY — reference new deterministic inputs |
| [`lib/agents/discord.ts`](/home/jared/Nexus-Terminal/lib/agents/discord.ts) | MODIFY — typed renderers for all three families |
| [`lib/agents/context.ts`](/home/jared/Nexus-Terminal/lib/agents/context.ts) | MODIFY — runtime guard for old-format macro |
| [`app/api/agents/service/chat/route.ts`](/home/jared/Nexus-Terminal/app/api/agents/service/chat/route.ts) | MODIFY — surface specialist job results |
| [`app/api/agents/reports/route.ts`](/home/jared/Nexus-Terminal/app/api/agents/reports/route.ts) | MODIFY — add summary, delivery_error to list |
| [`app/api/agents/reports/[id]/route.ts`](/home/jared/Nexus-Terminal/app/api/agents/reports/[id]/route.ts) | MODIFY — full ReportApiResponse envelope |
| [`app/api/agents/macro-summary/latest/route.ts`](/home/jared/Nexus-Terminal/app/api/agents/macro-summary/latest/route.ts) | MODIFY — expose delivery status, remove published-only filter |
| [`services/discord-bot/index.ts`](/home/jared/Nexus-Terminal/services/discord-bot/index.ts) | MODIFY — poll specialist, post result |
| [`__tests__/agent-blueprints.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-blueprints.test.ts) | MODIFY — add coverage per step |
| [`__tests__/agent-discord.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-discord.test.ts) | MODIFY — add coverage per step |
| [`__tests__/agent-service-chat-route.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-service-chat-route.test.ts) | MODIFY — add coverage per step |
| [`__tests__/agent-context.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-context.test.ts) | MODIFY — add coverage per step |
| [`__tests__/agent-macro-summary-route.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-macro-summary-route.test.ts) | MODIFY — add coverage per step |
| [`__tests__/agent-reports-route.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-reports-route.test.ts) | MODIFY — add coverage per step |

### Order Of Operations

1. Define the typed report and macro contracts in `types.ts` (Step 1).
2. Update routes to return the new envelope (Step 1 routes).
3. Persist assistant turns and routed reply metadata (Step 2).
4. Expand TradingView columns for both blueprints (Steps 3a, 4a — can be done in parallel).
5. Promote AskEdgar sections and compute deterministic fields for small-cap (Steps 3b, 3c).
6. Enrich swing inputs, compute technicals, persist thesis memory (Step 4).
7. Rebuild Discord renderers (Step 5).
8. Redesign macro summary (Step 6).
9. Run `npm run lint && npx tsc --noEmit && npm test` after each step.

### Security Notes

- Keep `TRADINGVIEW_SESSION_ID`, `MASSIVE_API_KEY`, and AskEdgar credentials server-side only.
- Do not expose raw provider payloads or unredacted source blobs to client routes unless they are already safe, compact, and intentional.
- Preserve service-auth separation between the Discord bot and user-authenticated report routes.
- Keep webhook delivery idempotent. Routed specialist replies must not create duplicate Discord posts on retries or restarts.

### Acceptance Criteria

- `agent_conversations` stores both user and assistant turns for orchestrator chat sessions.
- Routed specialist requests post the final specialist result back into `#orchestrator`.
- Small-cap and swing reports ingest explicit deterministic technical and AskEdgar inputs before the LLM step.
- Successful swing research writes a `thesis` memory row keyed by ticker.
- [`lib/agents/discord.ts`](/home/jared/Nexus-Terminal/lib/agents/discord.ts) renders small-cap, swing, and macro reports from typed contracts, not fallback key guessing.
- The macro summary has one source-backed schema across storage, context, Discord, and API output.
- Routes return the `ReportApiResponse` envelope and no longer rely on anonymous `unknown` blobs.
- Tests cover the new route contracts, embed layouts, assistant conversation persistence, memory writes, and macro-summary shape.

### Testing Requirements

Run after every step:
```bash
npm run lint && npx tsc --noEmit && npm test
```

#### Test Fixtures Per File

**`agent-blueprints.test.ts`:**
- Small-cap: mock `getCachedTickerData` returning realistic `rawData` with at least `gap-stats` (3 entries with `open`, `high`, `low`, `close`), `offerings` (2 entries), and `registrations` (1 entry). Assert the `compute-deterministic` step output includes `gapCount: 3`, `sameDayFadeRate` is a number, `hasActiveShelf` is a boolean.
- Swing: mock same plus OHLC data. Assert `save-research` step calls `upsertMemory` with `category: 'thesis'` and `key: ticker`.
- Macro: mock `fetchPageText` and `fetchUnifiedSnapshot`. Assert saved `reportJson` matches `MacroSummaryReport` shape — has `marketBias`, `crossAssetSnapshot` array, `sourceIndex` array.

**`agent-discord.test.ts`:**
- Small-cap: pass a `SmallCapResearchReport` fixture with `overallOfferingRisk: { rating: 'red', explanation: 'Active ATM' }`. Assert embed description contains the 🔴 emoji and "Offering Risk".
- Swing: pass a `SwingResearchReport` fixture with `recommendation: { action: 'HOLD', reasoning: 'test' }`. Assert embed fields include `Action: HOLD`.
- Macro: pass a `MacroSummaryReport` fixture with `marketBias: 'bearish'`, `drivers: [{ driver: 'Fed hike', impact: 'negative', sourceRefs: ['headline:marketwatch.com'] }]`. Assert embed fields include `Market Bias: bearish` and `Top Drivers` contains `Fed hike`.

**`agent-service-chat-route.test.ts`:**
- Mock a completed specialist job with `result: { reportId: 'test-report', ticker: 'AAPL' }`. Assert GET returns `{ status: 'completed', result: { message: 'Research complete for AAPL.', reportId: 'test-report' } }`.

**`agent-context.test.ts`:**
- Mock a stored macro report with the new `MacroSummaryReport` shape. Assert `buildContext()` returns it as `macroSummary`.
- Mock a stored macro report with the OLD shape (`{ summary, keyEvents, sectorNotes, confidence }`). Assert `buildContext()` returns `macroSummary: null` (runtime guard).

**`agent-macro-summary-route.test.ts`:**
- Mock a stored macro report with `status: 'delivery_failed'`. Assert the latest route returns it with `status: 'delivery_failed'` (not filtered out).

**`agent-reports-route.test.ts`:**
- Assert the single-report GET returns `title`, `summary`, `delivery_error`, `created_at` alongside `report_json`.

### Complexity Estimate

- HIGH — this is a cross-cutting contract change touching blueprints, report storage, Discord delivery, routes, context assembly, and tests.

### Follow-Up Sprint: Attribution And Provenance

Deferred from this sprint. When ready:
- Replace `evidenceIds: string[]` with section-level provenance objects or a report-level `sourceIndex` plus section references.
- Add source URL, title, and date metadata to specialist report JSON for catalyst-heavy sections.
- Keep social or X inputs as attention signals only — they cannot become primary catalyst evidence without corroboration.
- This work is easier to do after the report shapes from this sprint are stable and tested.

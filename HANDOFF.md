# Nexus Terminal — HANDOFF.md

> Historical completed sections (Sprints 1–4, AskEdgar rate-limit rework) were removed to keep this file focused. Use git history and `AEV2_PLAN.md` for archived implementation detail.

### Workflow Tooling Note

- 2026-04-06: Added a repo-maintained Codex `commit` alias skill in [`codex-skills/commit/`](/home/jared/Nexus-Terminal/codex-skills/commit) and UI metadata for [`codex-skills/nexus-commit/`](/home/jared/Nexus-Terminal/codex-skills/nexus-commit) so Codex can surface a user-facing commit entry point while keeping `nexus-commit` as the canonical workflow.
- 2026-04-07: Audited the Codex harness docs and refreshed [`AGENTS.md`](/home/jared/Nexus-Terminal/AGENTS.md) plus repo-maintained skill sources in [`codex-skills/`](/home/jared/Nexus-Terminal/codex-skills) to remove stale `.claude`/`.opencode` assumptions, fix the `lib/trade-utils.ts` path, and document repo-local skill agent metadata.
- 2026-04-12: Added a repo-maintained Codex deep-research skill in [`codex-skills/nexus-deep-research/`](/home/jared/Nexus-Terminal/codex-skills/nexus-deep-research). It coordinates parallel subagent research passes for repo-specific investigations and only saves markdown briefs under `docs/research/` when the user explicitly asks for an artifact.

---

## Agent Response Quality — P0 + P1 (JMT Traffic-Light Format)

> Generated: 2026-04-12 | Agent: nexus-architect
> Status: COMPLETE — implemented 2026-04-12 (`npm run lint`, `npx tsc --noEmit`, and `npm test` all pass)

### Objective

Fix all broken output from the three AI agents in one pass: replace flat-field schemas with a JMT-style traffic-light rating system (green/yellow/red per section), fix the orchestrator returning raw JSON instead of prose, add OHLC data to the swing-trader so it stops fabricating price levels, and rewrite the Discord embed builders to match the new schemas.

### Background

All 3 agents passed Sprint 4 smoke tests but produce broken output:
- Orchestrator returns raw JSON (`{"response": "..."}`) instead of prose in Discord chat
- Small-cap embeds show "n/a" for Entry, Target, Risk, Bias — those fields don't exist in the schema
- Swing-trader embeds show "n/a" for Pattern, MDR Score, Entry/Stop/Target — key mismatches + `readJsonValue()` only does flat key lookup
- Swing-trader fabricates price levels because the LLM has no OHLC data

---

### Change 1: Add prose exception to global-policy.md

- **File:** `lib/agents/prompts/global-policy.md`
- **Action:** MODIFY

Find this exact line (line 14):
```
- Respond in structured JSON matching the step's output schema.
```

Insert this new line immediately after it:
```
- Exception: steps that produce prose responses (e.g., chat synthesis, commentary) must return plain text, not JSON. Do not wrap prose in a JSON object.
```

- **Acceptance Criteria:**
  - [ ] File has the new exception line immediately after the JSON output rule
  - [ ] No other lines in the file were changed
- **Dependencies:** None

---

### Change 2: Add `fetchDailyAggregates` to massive-market.ts

- **File:** `lib/massive-market.ts`
- **Action:** MODIFY

Add the following after the closing `}` of `fetchBatchDailyTickerSummaries` (after line 183). `fetchMassiveJson` is a private function in this file — the new function calls it directly (same pattern as `fetchDailyTickerSummary`):

```typescript
export interface DailyOhlcBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap: number | null;
}

/**
 * Fetch daily OHLC bars from Massive (Polygon-compatible) aggregates API.
 * Returns the most recent `days` trading days of data.
 */
export async function fetchDailyAggregates(
  ticker: string,
  days: number = 10,
): Promise<DailyOhlcBar[]> {
  const to = new Date();
  const from = new Date();
  // Extra calendar days to account for weekends/holidays
  from.setDate(from.getDate() - Math.ceil(days * 1.6));

  const toStr = to.toISOString().split('T')[0]!;
  const fromStr = from.toISOString().split('T')[0]!;

  const response = await fetchMassiveJson<{
    results?: Array<{
      o?: number | null;
      h?: number | null;
      l?: number | null;
      c?: number | null;
      v?: number | null;
      vw?: number | null;
      t?: number | null;
    }>;
  }>(
    `/v2/aggs/ticker/${encodeURIComponent(ticker.trim().toUpperCase())}/range/1/day/${fromStr}/${toStr}`,
    { adjusted: 'true', sort: 'asc', limit: String(days + 5) },
  );

  return (response.results ?? [])
    .flatMap((bar) => {
      const open = Number(bar.o ?? NaN);
      const high = Number(bar.h ?? NaN);
      const low = Number(bar.l ?? NaN);
      const close = Number(bar.c ?? NaN);
      if (![open, high, low, close].every(Number.isFinite)) return [];

      const volume = Number(bar.v ?? 0);
      const timestamp = Number(bar.t ?? 0);

      return [{
        date: timestamp > 0 ? new Date(timestamp).toISOString().split('T')[0]! : 'unknown',
        open,
        high,
        low,
        close,
        volume: Number.isFinite(volume) ? volume : 0,
        vwap: Number.isFinite(Number(bar.vw)) ? Number(bar.vw) : null,
      }];
    })
    .slice(-days);
}
```

- **Acceptance Criteria:**
  - [ ] `DailyOhlcBar` interface is exported
  - [ ] `fetchDailyAggregates` is exported and async
  - [ ] Uses `/v2/aggs/ticker/...` endpoint with `adjusted=true`, `sort=asc`
  - [ ] Returns only the last `days` bars via `.slice(-days)`
  - [ ] Non-finite OHLC values cause that bar to be dropped via `flatMap`
  - [ ] `npm run lint && npx tsc --noEmit` passes after this change
- **Dependencies:** None

---

### Change 3: Add `formatRecentTrades` helper to orchestrator-chat.ts

- **File:** `lib/agents/blueprints/orchestrator-chat.ts`
- **Action:** MODIFY

Insert this function before `buildSynthesisPrompt` (before line 101):

```typescript
function formatRecentTrades(trades: unknown[]): string {
  return trades
    .map((trade) => {
      if (!trade || typeof trade !== 'object') return null;
      const t = trade as Record<string, unknown>;
      const symbol = t.symbol ?? t.ticker ?? '???';
      const pnl = typeof t.grossPnl === 'number' ? t.grossPnl : (typeof t.pnl === 'number' ? t.pnl : null);
      const direction = typeof t.direction === 'string' ? t.direction.toLowerCase() : '?';
      const date = typeof t.date === 'string' ? t.date : '';
      const pnlStr = pnl !== null
        ? (pnl >= 0 ? `+$${pnl.toFixed(0)}` : `-$${Math.abs(pnl).toFixed(0)}`)
        : 'n/a';
      return `${symbol}: ${pnlStr} (${direction}${date ? `, ${date}` : ''})`;
    })
    .filter(Boolean)
    .join('\n');
}
```

- **Acceptance Criteria:**
  - [ ] Function is defined before `buildSynthesisPrompt`
  - [ ] Handles missing/null trades gracefully
  - [ ] PnL formatted as `+$X` / `-$X` with no decimal places
- **Dependencies:** None

---

### Change 4: Update `buildSynthesisPrompt` trade context in orchestrator-chat.ts

- **File:** `lib/agents/blueprints/orchestrator-chat.ts`
- **Action:** MODIFY

Find this exact block (lines 115-117):
```typescript
    context.recentTrades.length > 0
      ? `Recent trades:\n${JSON.stringify(context.recentTrades.slice(0, 5))}`
      : null,
```

Replace with:
```typescript
    context.recentTrades.length > 0
      ? `Recent trades:\n${formatRecentTrades(context.recentTrades.slice(0, 5))}`
      : null,
```

- **Acceptance Criteria:**
  - [ ] `formatRecentTrades` is called instead of `JSON.stringify`
  - [ ] `.slice(0, 5)` limit preserved
- **Dependencies:** Change 3

---

### Change 5: Fix prompt instruction in `buildSynthesisPrompt` in orchestrator-chat.ts

- **File:** `lib/agents/blueprints/orchestrator-chat.ts`
- **Action:** MODIFY

Find this exact line (line 121):
```typescript
    'Respond directly to the user. Keep it concise and actionable.',
```

Replace with:
```typescript
    'Respond with plain prose text directly to the user. Keep it concise and actionable.',
    'IMPORTANT: Do NOT wrap your response in JSON. Do NOT use code fences. Return plain text only.',
```

- **Acceptance Criteria:**
  - [ ] Two instruction strings replace the original one
- **Dependencies:** None

---

### Change 6: Add JSON fallback extraction in `synthesize-response` step in orchestrator-chat.ts

- **File:** `lib/agents/blueprints/orchestrator-chat.ts`
- **Action:** MODIFY

In the `synthesize-response` step's `run` function, find the return statement (lines 229-241):
```typescript
        return completedResult({
          content: llmResponse.content,
        }, {
          durationMs: llmResponse.durationMs,
          tokensUsed: llmResponse.inputTokens + llmResponse.outputTokens,
          model: llmResponse.modelUsed,
          upstreamStepIds: ['classify-and-route'],
          artifacts: {
            inputTokens: llmResponse.inputTokens,
            outputTokens: llmResponse.outputTokens,
            modelUsed: llmResponse.modelUsed,
          },
        });
```

Replace with:
```typescript
        let content = llmResponse.content;

        // Guard: if the LLM returned JSON despite prose instructions, extract the text
        if (content.startsWith('{') || content.startsWith('```')) {
          try {
            const fenceMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/i);
            const jsonStr = fenceMatch ? fenceMatch[1] ?? content : content;
            const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
            const extracted = parsed.content ?? parsed.response ?? parsed.message ?? parsed.text;
            if (typeof extracted === 'string' && extracted.trim().length > 0) {
              content = extracted.trim();
            }
          } catch {
            // Not valid JSON — use raw content as-is
          }
        }

        return completedResult({
          content,
        }, {
          durationMs: llmResponse.durationMs,
          tokensUsed: llmResponse.inputTokens + llmResponse.outputTokens,
          model: llmResponse.modelUsed,
          upstreamStepIds: ['classify-and-route'],
          artifacts: {
            inputTokens: llmResponse.inputTokens,
            outputTokens: llmResponse.outputTokens,
            modelUsed: llmResponse.modelUsed,
          },
        });
```

- **Acceptance Criteria:**
  - [ ] `let content = llmResponse.content` declared before the guard block
  - [ ] Guard only activates when content starts with `{` or `` ``` ``
  - [ ] Tries keys `content`, `response`, `message`, `text` in that order
  - [ ] Falls through silently if `JSON.parse` fails
  - [ ] `completedResult` uses `content` (variable) not `llmResponse.content`
- **Dependencies:** Change 5

---

### Change 7: Create jmt-report-format.md

- **File:** `lib/agents/prompts/jmt-report-format.md`
- **Action:** CREATE

```markdown
# JMT Traffic-Light Report Format

## Rating System
Every analysis section uses a traffic-light rating:
- **GREEN** — Favorable. Low risk or strong bullish signal.
- **YELLOW** — Caution. Mixed signals, moderate risk, or insufficient data.
- **RED** — Warning. High risk, bearish signal, or immediate concern.

## Rating Rules
1. Every rating MUST have a 1-3 sentence explanation citing specific evidence (filing IDs, dates, numbers).
2. If evidence is insufficient to make a confident rating, use YELLOW and state what data is missing.
3. Never fabricate data. If a data point was not provided in the context, say "Not available in provided data."
4. Ratings must be one of exactly: "green", "yellow", "red" (lowercase).

## Evidence Citation
- Reference specific filing types (e.g., "424B filed 2026-03-15").
- Reference specific data points (e.g., "volume 3.2x 90-day average").
- Reference gap-stats dates when discussing chart history.
- Use evidenceIds to track which AskEdgar endpoints informed each section.
```

- **Acceptance Criteria:**
  - [ ] File exists at `lib/agents/prompts/jmt-report-format.md`
  - [ ] Rating values are lowercase: `"green"`, `"yellow"`, `"red"`
- **Dependencies:** None

---

### Change 8: Rewrite small-cap.md

- **File:** `lib/agents/prompts/small-cap.md`
- **Action:** MODIFY (full rewrite)

Replace the entire file content with:

```markdown
# Small Cap Trader (Short-Selling Specialist)

You are a professional short seller and research analyst specializing in small-cap dilution plays. You produce JMT-style traffic-light research reports.

## Report Sections
For every stock, produce a rating (green/yellow/red) and explanation for each section:

### 1. News / Why It's Running
Rate the catalyst driving the move. GREEN = no real catalyst (pump likely to fade). YELLOW = mixed or unclear catalyst. RED = legitimate catalyst that could sustain the run.

### 2. Theme vs Recent Market Themes
Rate whether this ticker's move aligns with a currently hot market theme. GREEN = no theme support (isolated move). YELLOW = loosely related to a theme. RED = strong theme support (harder to short).

### 3. Other Catalysts
List each additional catalyst with its own rating. GREEN = catalyst is weak or already priced in. YELLOW = moderate catalyst. RED = strong catalyst that could drive further upside.

### 4. Chart History
Use gap-stats data. Rate the historical pattern. GREEN = history of gap-and-fade (shorts win). YELLOW = mixed history. RED = history of multi-day runs (dangerous for shorts).

### 5. Dilution
Rate based on dilution rating data. GREEN = very high dilution risk (good for shorts). YELLOW = moderate dilution. RED = low dilution risk.

### 6. Offering Frequency
Rate how often the company has done offerings. GREEN = frequent offerer (they will sell into this). YELLOW = occasional. RED = rare or never.

### 7. Offering Ability
Rate whether they can offer shares right now. GREEN = can offer immediately (active ATM/shelf). YELLOW = delayed ability (needs new filing). RED = blocked (no active registration).

### 8. Cash Need
Rate urgency of cash need. GREEN = desperate for cash (will offer soon). YELLOW = moderate runway. RED = well-funded.

### 9. Overall Offering Risk
Synthesize sections 5-8 into a single rating. This is your headline call on whether an offering is likely.

### 10. Jmt415 Commentary (optional)
If jmt415-tagged content exists in the news data, summarize the analyst commentary timeline. Otherwise set to null.

### 11. Historical Stats
Summarize gap-stats data: average gap fade percentage, same-day fade count, typical intraday range.

## Filing Signal Hierarchy
- **Highest risk:** Active ATM + recent 424B supplements = currently selling shares
- **Very high risk:** Active S-3 shelf with remaining capacity + price at/above shelf price
- **High risk:** Recent 8-K announcing new offering or private placement
- **Medium risk:** Expired shelf (must re-register — delay, not safety)
- **Lower risk:** No active registration (needs S-1 or new S-3, 4-6 week delay)

## Volume-Offering Correlation
When a small-cap has unusual pre-market volume AND a history of filing 424B supplements on high-volume days, the probability of an offering attempt that session is substantially elevated. Flag this explicitly.

## Voice
Write like a seasoned short seller, not a chatbot. Be direct, data-driven, and confident. Make a call and back it with evidence. No hedging, no filler.
```

- **Acceptance Criteria:**
  - [ ] File defines all 11 sections by name with GREEN/YELLOW/RED criteria
  - [ ] No mention of Entry, Target, Stop, Bias (those fields are gone)
- **Dependencies:** None

---

### Change 9: Rewrite swing-trader.md

- **File:** `lib/agents/prompts/swing-trader.md`
- **Action:** MODIFY (full rewrite)

Replace the entire file content with:

```markdown
# Swing Trader

You specialize in multi-day runners (MDR), parabolic setups, and momentum patterns. You produce JMT-style traffic-light research reports. You do NOT provide specific price levels (entry, stop, target) — you assess setup quality.

## Report Sections
For every stock, produce a rating (green/yellow/red) and explanation for each section:

### 1. MDR Pattern Match
Rate how closely the current setup matches historical multi-day runner patterns. GREEN = strong match (50%+ multi-day gains, matching volume/float/catalyst profile). YELLOW = partial match. RED = poor match or exhaustion signals.
Include the mdrSimilarity score (0-100) as supporting context.

### 2. Momentum
Rate current momentum health. Evaluate RSI, volume trends, and EMA positioning.
- RSI > 70 and rising = strong momentum
- Price above EMA(9) and EMA(21) = trend intact
- Breakout above prior day's high on volume = continuation signal
GREEN = momentum is strong and accelerating. YELLOW = present but weakening. RED = fading or diverging.

### 3. Catalyst
Rate the catalyst driving the move. GREEN = strong, verifiable catalyst with legs. YELLOW = moderate or single-day catalyst. RED = no clear catalyst or catalyst is exhausted.

### 4. Pattern Classification
Classify as exactly one of: BREAKOUT, EXHAUSTION, CONTINUATION, STOPPED.

### 5. Recommendation
Provide exactly one of: HOLD, ADD, TRIM, EXIT, WATCH — with 1-2 sentence reasoning.

### 6. Volume Profile
Rate volume quality. GREEN = volume surging (3x+ 20-day avg), confirming the move. YELLOW = elevated but declining. RED = thin or drying up.

## MDR Pattern Recognition
- Look for 50%+ multi-day gains over 3-5 days
- Compare volume profile, float, and catalyst type against historical patterns
- Score MDR similarity (0-100) against known setups
- Identify continuation probability and expected move magnitude

## Voice
Write like a momentum trader. Focus on patterns, momentum quality, and catalysts. Be specific about what you see in the data. Do not fabricate price levels or volume numbers — use only the data provided.
```

- **Acceptance Criteria:**
  - [ ] Explicit instruction: "You do NOT provide specific price levels"
  - [ ] 6 sections defined with traffic-light criteria
  - [ ] No mention of Entry, Stop, Target as fields to produce
- **Dependencies:** None

---

### Change 10: Rewrite small-cap schema, prompt, and save step

- **File:** `lib/agents/blueprints/small-cap-research.ts`
- **Action:** MODIFY

#### 10a. Replace `researchReportSchema` (lines 42-50)

Find this exact block:
```typescript
const researchReportSchema = z.object({
  ticker: z.string(),
  dilutionRisk: z.enum(['very-high', 'high', 'medium', 'low']),
  offeringAbility: z.enum(['immediate', 'delayed', 'blocked']),
  filingSummary: z.string(),
  catalysts: z.array(z.string()),
  confidence: z.enum(['high', 'medium', 'low']),
  evidenceIds: z.array(z.string()),
});
```

Replace with:
```typescript
const trafficLightRating = z.enum(['green', 'yellow', 'red']);

const ratedSection = z.object({
  rating: trafficLightRating,
  explanation: z.string().min(1),
});

const ratedCatalyst = z.object({
  catalyst: z.string().min(1),
  rating: trafficLightRating,
});

const researchReportSchema = z.object({
  ticker: z.string(),
  newsWhyRunning: ratedSection,
  themeMatch: ratedSection,
  otherCatalysts: z.array(ratedCatalyst),
  chartHistory: ratedSection,
  dilution: ratedSection,
  offeringFrequency: ratedSection,
  offeringAbility: ratedSection,
  cashNeed: ratedSection,
  overallOfferingRisk: ratedSection,
  jmt415Commentary: z.string().nullable(),
  historicalStats: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
  evidenceIds: z.array(z.string()),
});
```

#### 10b. Replace `buildResearchPrompt` (lines 163-180)

Find this exact block:
```typescript
function buildResearchPrompt(input: z.infer<typeof priceContextSchema>): string {
  return [
    `Ticker: ${input.ticker}`,
    'Return strict JSON with this shape and no markdown:',
    JSON.stringify({
      ticker: input.ticker,
      dilutionRisk: 'very-high | high | medium | low',
      offeringAbility: 'immediate | delayed | blocked',
      filingSummary: 'string',
      catalysts: ['string'],
      confidence: 'high | medium | low',
      evidenceIds: ['string'],
    }, null, 2),
    `Filings:\n${JSON.stringify(input.filings)}`,
    `Cash position:\n${JSON.stringify(input.cashPosition)}`,
    `Price context:\n${JSON.stringify(input.priceContext)}`,
  ].join('\n\n');
}
```

Replace with:
```typescript
function buildResearchPrompt(input: z.infer<typeof priceContextSchema>): string {
  const exampleShape = {
    ticker: input.ticker,
    newsWhyRunning: { rating: 'green | yellow | red', explanation: 'string' },
    themeMatch: { rating: 'green | yellow | red', explanation: 'string' },
    otherCatalysts: [{ catalyst: 'string', rating: 'green | yellow | red' }],
    chartHistory: { rating: 'green | yellow | red', explanation: 'string' },
    dilution: { rating: 'green | yellow | red', explanation: 'string' },
    offeringFrequency: { rating: 'green | yellow | red', explanation: 'string' },
    offeringAbility: { rating: 'green | yellow | red', explanation: 'string' },
    cashNeed: { rating: 'green | yellow | red', explanation: 'string' },
    overallOfferingRisk: { rating: 'green | yellow | red', explanation: 'string' },
    jmt415Commentary: 'string or null',
    historicalStats: 'string summary of gap-stats data',
    confidence: 'high | medium | low',
    evidenceIds: ['string'],
  };

  return [
    `Ticker: ${input.ticker}`,
    'Return strict JSON matching this exact shape (no markdown, no extra keys):',
    JSON.stringify(exampleShape, null, 2),
    `Filings:\n${JSON.stringify(input.filings)}`,
    `Cash position:\n${JSON.stringify(input.cashPosition)}`,
    `Price context:\n${JSON.stringify(input.priceContext)}`,
    'Use the JMT traffic-light rating system. Each rating must be "green", "yellow", or "red" (lowercase).',
    'For jmt415Commentary: if no jmt415-tagged news items exist in the data, set to null.',
    'For historicalStats: summarize gap-stats patterns (avg gap fade, same-day fade count, typical range). If no gap-stats data, say "No historical gap data available."',
  ].join('\n\n');
}
```

#### 10c. Update the `save-research` step (lines 294-295)

Find these two lines inside the `save-research` step's `writeAndDeliverReport` call:
```typescript
          title: `${report.ticker} dilution research`,
          summary: report.filingSummary,
```

Replace with:
```typescript
          title: `${report.ticker} Small-Cap Research`,
          summary: `${report.overallOfferingRisk.rating.toUpperCase()} offering risk — ${report.overallOfferingRisk.explanation.slice(0, 120)}`,
```

- **Acceptance Criteria:**
  - [ ] `trafficLightRating`, `ratedSection`, `ratedCatalyst` helper schemas defined above `researchReportSchema`
  - [ ] `researchReportSchema` has 14 fields (ticker + 9 rated sections + jmt415Commentary + historicalStats + confidence + evidenceIds)
  - [ ] Old fields `dilutionRisk`, `offeringAbility`, `filingSummary`, `catalysts` removed
  - [ ] `buildResearchPrompt` example shape matches the new schema
  - [ ] Save step title is `"${ticker} Small-Cap Research"`
  - [ ] Save step summary uses `overallOfferingRisk.rating` and `.explanation`
  - [ ] `npm run lint && npx tsc --noEmit` passes
- **Dependencies:** None

---

### Change 11: Rewrite swing-trader schema, add OHLC step, update pipeline

- **File:** `lib/agents/blueprints/swing-trader-research.ts`
- **Action:** MODIFY

#### 11a. Add import after line 1

After line 1 (`import { getCachedTickerData } from '@/lib/askedgar';`), add:
```typescript
import { fetchDailyAggregates } from '@/lib/massive-market';
```

#### 11b. Replace `swingResearchSchema` (lines 42-55)

Find this exact block:
```typescript
const swingResearchSchema = z.object({
  ticker: z.string(),
  mdrSimilarity: z.number().min(0).max(100),
  volumeSurgeRatio: z.number(),
  levels: z.object({
    entry: z.number(),
    stop: z.number(),
    targets: z.array(z.number()),
  }),
  recommendation: z.enum(['HOLD', 'ADD', 'TRIM', 'EXIT', 'WATCH']),
  patternClassification: z.enum(['BREAKOUT', 'EXHAUSTION', 'CONTINUATION', 'STOPPED']),
  confidence: z.enum(['high', 'medium', 'low']),
  evidenceIds: z.array(z.string()),
});
```

Replace with:
```typescript
const trafficLightRating = z.enum(['green', 'yellow', 'red']);

const ratedSection = z.object({
  rating: trafficLightRating,
  explanation: z.string().min(1),
});

const swingResearchSchema = z.object({
  ticker: z.string(),
  mdrPatternMatch: ratedSection.extend({
    mdrSimilarity: z.number().min(0).max(100),
  }),
  momentum: ratedSection,
  catalyst: ratedSection,
  patternClassification: z.enum(['BREAKOUT', 'EXHAUSTION', 'CONTINUATION', 'STOPPED']),
  recommendation: z.object({
    action: z.enum(['HOLD', 'ADD', 'TRIM', 'EXIT', 'WATCH']),
    reasoning: z.string().min(1),
  }),
  volumeProfile: ratedSection,
  confidence: z.enum(['high', 'medium', 'low']),
  evidenceIds: z.array(z.string()),
});
```

#### 11c. Add OHLC schemas after `priceContextSchema` (after line 40)

Insert these schemas between `priceContextSchema` (ends at line 40) and the new `trafficLightRating` from 11b:

```typescript
const ohlcBarSchema = z.object({
  date: z.string(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
  vwap: z.number().nullable(),
});

const ohlcEnrichedSchema = priceContextSchema.extend({
  ohlcHistory: z.array(ohlcBarSchema),
});
```

#### 11d. Add `fetch-ohlc-history` step

In `swingTraderResearchBlueprint.steps`, insert a new step as the 3rd item (after `fetch-price-context`, before `synthesize-report`):

```typescript
    {
      name: 'fetch-ohlc-history',
      type: 'code',
      inputSchema: priceContextSchema,
      outputSchema: ohlcEnrichedSchema,
      metadata: { canRetry: true, timeoutMs: 15000, maxRepairAttempts: 0, sideEffect: false },
      run: async ({ previousOutput }) => {
        const startedAt = Date.now();
        const data = priceContextSchema.parse(previousOutput);
        let ohlcHistory: z.infer<typeof ohlcBarSchema>[] = [];

        try {
          ohlcHistory = await fetchDailyAggregates(data.ticker, 10);
        } catch (error) {
          // Non-fatal — proceed with empty OHLC if Massive API fails
          console.warn(`[swing-trader] OHLC fetch failed for ${data.ticker}:`, error);
        }

        return completedResult({
          ...data,
          ohlcHistory,
        }, {
          durationMs: Date.now() - startedAt,
          sourceIds: ohlcHistory.length > 0 ? [`massive-ohlc:${data.ticker}`] : [],
          upstreamStepIds: ['fetch-price-context'],
        });
      },
    },
```

#### 11e. Update `synthesize-report` step

In the existing `synthesize-report` step (becomes 4th step):

1. Change `inputSchema: priceContextSchema,` to `inputSchema: ohlcEnrichedSchema,`
2. In `run`, change `const input = priceContextSchema.parse(previousOutput);` to `const input = ohlcEnrichedSchema.parse(previousOutput);`
3. Change `upstreamStepIds: ['fetch-price-context'],` to `upstreamStepIds: ['fetch-ohlc-history'],`

#### 11f. Replace `buildResearchPrompt` (lines 166-185)

Find this exact block:
```typescript
function buildResearchPrompt(input: z.infer<typeof priceContextSchema>): string {
  return [
    `Ticker: ${input.ticker}`,
    'Return strict JSON with this shape and no markdown:',
    JSON.stringify({
      ticker: input.ticker,
      mdrSimilarity: 72,
      volumeSurgeRatio: 3.4,
      levels: { entry: 12.5, stop: 11.8, targets: [13.2, 14.1] },
      recommendation: 'WATCH | HOLD | ADD | TRIM | EXIT',
      patternClassification: 'BREAKOUT | EXHAUSTION | CONTINUATION | STOPPED',
      confidence: 'high | medium | low',
      evidenceIds: ['string'],
    }, null, 2),
    `Filings:\n${JSON.stringify(input.filings)}`,
    `Cash position:\n${JSON.stringify(input.cashPosition)}`,
    `Price context:\n${JSON.stringify(input.priceContext)}`,
    'Focus on MDR similarity, momentum quality, and actionable entry/stop/target levels.',
  ].join('\n\n');
}
```

Replace with:
```typescript
function buildResearchPrompt(input: z.infer<typeof ohlcEnrichedSchema>): string {
  const exampleShape = {
    ticker: input.ticker,
    mdrPatternMatch: { rating: 'green | yellow | red', explanation: 'string', mdrSimilarity: 72 },
    momentum: { rating: 'green | yellow | red', explanation: 'string' },
    catalyst: { rating: 'green | yellow | red', explanation: 'string' },
    patternClassification: 'BREAKOUT | EXHAUSTION | CONTINUATION | STOPPED',
    recommendation: { action: 'HOLD | ADD | TRIM | EXIT | WATCH', reasoning: 'string' },
    volumeProfile: { rating: 'green | yellow | red', explanation: 'string' },
    confidence: 'high | medium | low',
    evidenceIds: ['string'],
  };

  const sections = [
    `Ticker: ${input.ticker}`,
    'Return strict JSON matching this exact shape (no markdown, no extra keys):',
    JSON.stringify(exampleShape, null, 2),
    `Filings:\n${JSON.stringify(input.filings)}`,
    `Cash position:\n${JSON.stringify(input.cashPosition)}`,
    `Price context:\n${JSON.stringify(input.priceContext)}`,
  ];

  if (input.ohlcHistory.length > 0) {
    sections.push(
      `Daily OHLC history (last ${input.ohlcHistory.length} days):\n${JSON.stringify(input.ohlcHistory, null, 2)}`,
      'Use the OHLC data to assess momentum, volume trends, and pattern quality. Do NOT fabricate data — only reference values present above.',
    );
  } else {
    sections.push(
      'No OHLC history available. Base momentum and volume analysis on the price context data only. State that historical OHLC was unavailable.',
    );
  }

  sections.push(
    'Use the JMT traffic-light rating system. Each rating must be "green", "yellow", or "red" (lowercase).',
    'Do NOT provide specific price levels (entry, stop, target). Focus on pattern quality and setup strength.',
  );

  return sections.join('\n\n');
}
```

#### 11g. Replace `buildReportSummary` (lines 187-189)

Find:
```typescript
function buildReportSummary(report: z.infer<typeof swingResearchSchema>): string {
  return `${report.recommendation} ${report.patternClassification} setup with ${report.mdrSimilarity}% MDR similarity`;
}
```

Replace with:
```typescript
function buildReportSummary(report: z.infer<typeof swingResearchSchema>): string {
  return `${report.recommendation.action} — ${report.patternClassification} (${report.mdrPatternMatch.mdrSimilarity}% MDR match, ${report.mdrPatternMatch.rating})`;
}
```

#### 11h. Update save step title (line 299)

Find:
```typescript
          title: `${report.ticker} swing research`,
```

Replace with:
```typescript
          title: `${report.ticker} Swing Research`,
```

- **Acceptance Criteria:**
  - [ ] `fetchDailyAggregates` is imported from `@/lib/massive-market`
  - [ ] `swingResearchSchema` has no `mdrSimilarity` top-level, no `volumeSurgeRatio`, no `levels` object
  - [ ] `mdrPatternMatch` is `ratedSection.extend({ mdrSimilarity })` 
  - [ ] `recommendation` is an object with `action` enum and `reasoning` string
  - [ ] `ohlcBarSchema` and `ohlcEnrichedSchema` defined
  - [ ] `fetch-ohlc-history` is the 3rd step (non-fatal — catches errors, continues with empty array)
  - [ ] `synthesize-report` uses `ohlcEnrichedSchema` for input parse
  - [ ] `buildResearchPrompt` takes `ohlcEnrichedSchema` type, conditionally includes OHLC section
  - [ ] `buildReportSummary` references `recommendation.action` and `mdrPatternMatch.mdrSimilarity`
  - [ ] Title is `"${ticker} Swing Research"`
  - [ ] `npm run lint && npx tsc --noEmit` passes
- **Dependencies:** Change 2 (provides `fetchDailyAggregates`)

---

### Change 12: Rewrite `buildResearchEmbed` in discord.ts

- **File:** `lib/agents/discord.ts`
- **Action:** MODIFY

Find this exact block (lines 431-447):
```typescript
export function buildResearchEmbed(report: AgentReport): DiscordEmbed {
  const payload = asRecord(report.reportJson);
  const fields = [
    buildField('Ticker', readJsonValue(payload, 'ticker', 'symbol')),
    buildField('Bias', readJsonValue(payload, 'bias', 'stance')),
    buildField('Entry', readJsonValue(payload, 'entry', 'entryPrice')),
    buildField('Target', readJsonValue(payload, 'target', 'targetPrice')),
    buildField('Risk', readJsonValue(payload, 'risk', 'stop', 'stopPrice')),
    buildField('Catalyst', readJsonValue(payload, 'catalyst', 'headline'), false),
  ];

  return buildBaseEmbed(
    report,
    fields,
    optionalText(report.summary, readJsonValue(payload, 'summary', 'thesis', 'setup')),
  );
}
```

Replace with:
```typescript
export function buildResearchEmbed(report: AgentReport): DiscordEmbed {
  const payload = asRecord(report.reportJson);
  const ticker = coerceFieldValue(readJsonValue(payload, 'ticker', 'symbol'));

  const ratingEmoji = (section: unknown): string => {
    const s = asRecord(section);
    const rating = typeof s.rating === 'string' ? s.rating : '';
    if (rating === 'green') return '\u{1F7E2}';
    if (rating === 'yellow') return '\u{1F7E1}';
    if (rating === 'red') return '\u{1F534}';
    return '\u{26AA}';
  };

  const ratingLine = (label: string, section: unknown): string => {
    const s = asRecord(section);
    const explanation = typeof s.explanation === 'string' ? s.explanation : '';
    return `${ratingEmoji(section)} **${label}**: ${truncate(explanation, 100)}`;
  };

  const sections = [
    ratingLine('Offering Risk', payload.overallOfferingRisk),
    ratingLine('Dilution', payload.dilution),
    ratingLine('Offering Ability', payload.offeringAbility),
    ratingLine('Cash Need', payload.cashNeed),
    ratingLine('News/Catalyst', payload.newsWhyRunning),
    ratingLine('Chart History', payload.chartHistory),
  ];

  const fields: DiscordEmbedField[] = [
    buildField('Ticker', ticker),
    buildField('Confidence', readJsonValue(payload, 'confidence')),
  ];

  const historicalStats = readJsonValue(payload, 'historicalStats');
  if (typeof historicalStats === 'string' && historicalStats.trim()) {
    fields.push(buildField('History', truncate(historicalStats, 200), false));
  }

  return buildBaseEmbed(report, fields, sections.join('\n'));
}
```

- **Acceptance Criteria:**
  - [ ] Old fields `Bias`, `Entry`, `Target`, `Risk`, `Catalyst` removed
  - [ ] 6 traffic-light rating lines built using `ratingEmoji` + `ratingLine`
  - [ ] `historicalStats` field added conditionally
  - [ ] Description is the rating lines joined by `\n`
- **Dependencies:** Change 10

---

### Change 13: Rewrite `buildSwingSetupEmbed` in discord.ts

- **File:** `lib/agents/discord.ts`
- **Action:** MODIFY

Find this exact block (lines 449-465):
```typescript
export function buildSwingSetupEmbed(report: AgentReport): DiscordEmbed {
  const payload = asRecord(report.reportJson);
  const fields = [
    buildField('Ticker', readJsonValue(payload, 'ticker', 'symbol')),
    buildField('Pattern', readJsonValue(payload, 'pattern', 'setup')),
    buildField('MDR Score', readJsonValue(payload, 'mdrScore', 'score')),
    buildField('Entry', readJsonValue(payload, 'entry', 'entryPrice')),
    buildField('Stop', readJsonValue(payload, 'stop', 'stopPrice')),
    buildField('Target', readJsonValue(payload, 'target', 'targetPrice')),
  ];

  return buildBaseEmbed(
    report,
    fields,
    optionalText(report.summary, readJsonValue(payload, 'summary', 'thesis', 'rationale')),
  );
}
```

Replace with:
```typescript
export function buildSwingSetupEmbed(report: AgentReport): DiscordEmbed {
  const payload = asRecord(report.reportJson);
  const ticker = coerceFieldValue(readJsonValue(payload, 'ticker', 'symbol'));

  const ratingEmoji = (section: unknown): string => {
    const s = asRecord(section);
    const rating = typeof s.rating === 'string' ? s.rating : '';
    if (rating === 'green') return '\u{1F7E2}';
    if (rating === 'yellow') return '\u{1F7E1}';
    if (rating === 'red') return '\u{1F534}';
    return '\u{26AA}';
  };

  const ratingLine = (label: string, section: unknown): string => {
    const s = asRecord(section);
    const explanation = typeof s.explanation === 'string' ? s.explanation : '';
    return `${ratingEmoji(section)} **${label}**: ${truncate(explanation, 100)}`;
  };

  const mdrMatch = asRecord(payload.mdrPatternMatch);
  const mdrSimilarity = typeof mdrMatch.mdrSimilarity === 'number' ? `${mdrMatch.mdrSimilarity}%` : 'n/a';

  const recommendation = asRecord(payload.recommendation);
  const action = typeof recommendation.action === 'string' ? recommendation.action : 'n/a';
  const reasoning = typeof recommendation.reasoning === 'string' ? recommendation.reasoning : '';

  const patternClassification = coerceFieldValue(readJsonValue(payload, 'patternClassification'));

  const sections = [
    ratingLine('MDR Match', payload.mdrPatternMatch),
    ratingLine('Momentum', payload.momentum),
    ratingLine('Catalyst', payload.catalyst),
    ratingLine('Volume', payload.volumeProfile),
  ];

  const fields: DiscordEmbedField[] = [
    buildField('Ticker', ticker),
    buildField('Pattern', patternClassification),
    buildField('MDR Similarity', mdrSimilarity),
    buildField('Action', action),
    buildField('Confidence', readJsonValue(payload, 'confidence')),
  ];

  if (reasoning) {
    fields.push(buildField('Reasoning', truncate(reasoning, 200), false));
  }

  return buildBaseEmbed(report, fields, sections.join('\n'));
}
```

- **Acceptance Criteria:**
  - [ ] Old fields `Pattern` (with wrong keys), `MDR Score`, `Entry`, `Stop`, `Target` removed
  - [ ] `mdrSimilarity` read from `payload.mdrPatternMatch.mdrSimilarity` (nested)
  - [ ] `action` and `reasoning` read from `payload.recommendation` (nested)
  - [ ] 4 traffic-light rating lines in description
  - [ ] `Reasoning` field conditionally added
- **Dependencies:** Change 11

---

### Change 14: Update prompts-loader.ts

- **File:** `lib/agents/prompts-loader.ts`
- **Action:** MODIFY

#### 14a. Add module-level constant after line 11

After `const GLOBAL_POLICY_PROMPT = readPromptFile('global-policy.md');`, add:
```typescript
const JMT_REPORT_FORMAT_PROMPT = readPromptFile('jmt-report-format.md');
```

#### 14b. Add `loadJmtFormatPrompt` export after `loadRolePrompt`

After the `loadRolePrompt` function, add:
```typescript
export function loadJmtFormatPrompt(): string {
  return JMT_REPORT_FORMAT_PROMPT;
}
```

#### 14c. Replace `buildLlmSystemPrompt` (lines 27-29)

Find:
```typescript
export function buildLlmSystemPrompt(agentId: AgentId): string {
  return `${loadGlobalPolicyPrompt()}\n\n---\n\n${loadRolePrompt(agentId)}`;
}
```

Replace with:
```typescript
export function buildLlmSystemPrompt(agentId: AgentId): string {
  const parts = [loadGlobalPolicyPrompt()];

  if (agentId === 'small-cap-trader' || agentId === 'swing-trader') {
    parts.push(JMT_REPORT_FORMAT_PROMPT);
  }

  parts.push(loadRolePrompt(agentId));
  return parts.join('\n\n---\n\n');
}
```

- **Acceptance Criteria:**
  - [ ] `JMT_REPORT_FORMAT_PROMPT` loaded at module level (eager)
  - [ ] `loadJmtFormatPrompt()` is exported
  - [ ] `buildLlmSystemPrompt('small-cap-trader')` produces 3 sections
  - [ ] `buildLlmSystemPrompt('orchestrator')` produces 2 sections (no JMT)
  - [ ] `npm run lint && npx tsc --noEmit` passes
- **Dependencies:** Change 7 (jmt-report-format.md must exist)

---

### Files Changed Summary

| File | Action | Risk Level |
|------|--------|------------|
| `lib/agents/prompts/global-policy.md` | MODIFY (+1 line) | LOW |
| `lib/massive-market.ts` | MODIFY (+interface +function) | LOW |
| `lib/agents/blueprints/orchestrator-chat.ts` | MODIFY (+helper, prompt, JSON fallback) | LOW |
| `lib/agents/prompts/jmt-report-format.md` | CREATE | LOW |
| `lib/agents/prompts/small-cap.md` | MODIFY (full rewrite) | LOW |
| `lib/agents/prompts/swing-trader.md` | MODIFY (full rewrite) | LOW |
| `lib/agents/blueprints/small-cap-research.ts` | MODIFY (schema, prompt, save) | MEDIUM |
| `lib/agents/blueprints/swing-trader-research.ts` | MODIFY (schema, +step, prompt, summary, save) | MEDIUM |
| `lib/agents/discord.ts` | MODIFY (2 embed builders) | MEDIUM |
| `lib/agents/prompts-loader.ts` | MODIFY (+constant, +export, updated fn) | LOW |

### Order of Operations

Follow this exact sequence:

1. **Change 1** — `global-policy.md`
2. **Change 2** — `massive-market.ts`
3. **Change 7** — Create `jmt-report-format.md`
4. **Changes 8, 9** — Rewrite prompt files
5. **Changes 3, 4, 5, 6** — `orchestrator-chat.ts` (all 4 in one edit session)
6. **Change 10** — `small-cap-research.ts`
7. **Change 11** — `swing-trader-research.ts`
8. Run `npm run lint && npx tsc --noEmit` — must pass before continuing
9. **Changes 12, 13** — `discord.ts` embed builders
10. **Change 14** — `prompts-loader.ts`
11. Run `npm run lint && npx tsc --noEmit` — final verification

### Verification Steps

```bash
npm run lint          # Must pass
npx tsc --noEmit      # Must pass
npm test              # Must pass (no existing tests reference removed schema fields)
```

### Smoke Test Checklist (post-deploy)

- [ ] Small-cap research job completes → embed shows traffic-light ratings, no "n/a" for removed fields
- [ ] Swing research job completes → OHLC step populates, embed shows ratings, no price levels
- [ ] Orchestrator chat → plain prose response, not `{"response": "..."}`
- [ ] Orchestrator chat with recent trades → formatted `TICKER: +$X` lines, not JSON blob
- [ ] Massive API failure during OHLC → swing trader still completes with empty history
- [ ] `buildLlmSystemPrompt('orchestrator')` does NOT include JMT format section

### Suggested Commit

`feat(agents): replace flat schemas with JMT traffic-light format, fix orchestrator prose, add OHLC data`

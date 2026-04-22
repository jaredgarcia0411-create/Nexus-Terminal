# Nexus Terminal — HANDOFF.md

> Updated: 2026-04-22
> Purpose: brief summary of recently completed work plus any active execution spec. Older implementation detail lives in git history and `specs/`.
> Historical completed sections were archived to keep this file focused. Agent Hardening #1 shipped in `7118598`; Agent Hardening #2 in `2a856f1`; Agent Hardening #3 in `bf13567`; Research agent report refinements in `9a69655` (2026-04-17); Trade Journal Enhancement (DRC + Weekly Review + Archive tab) shipped across `4757fa3`, `0e41b5a`, `8dd6b12`, `fe97e8c`, `c300153` (2026-04-19 → 2026-04-20); Tighten Trading Journal UI shipped in `f1fde41` (2026-04-20); Spend Enforcement Fix shipped across `7aad160`, `abdefe9`, `1bd5e1e`, `8ad674e`, `9f0a123` (2026-04-20). See git history for full records.

## Current State

**Active spec:** `Research Gap-Stats Parser + Redundancy Fix` (completed below). After this: approval gates from `FUTURE-PLANS.md` item 1.

## Validation Snapshot

Most recent validation (`2026-04-22`, Research Gap-Stats Parser + Redundancy Fix):

- `npm run lint` — passed
- `npx tsc --noEmit` — passed
- `npm test` — passed (`53` files, `413` tests)

## Follow-Up Notes

- ~~Production check: verify `GET /api/cron/agent-retention` returns `200`~~ — validated 2026-04-22.
- After Research Gap-Stats Parser fix ships, re-verify Discord embed: a ticker with gaps (e.g. SPRC / JDZG / PBM — cached with 9/6/7 gap rows on 2026-04-22) must render the gap table; a ticker genuinely without gaps (e.g. AGPU) must still render "No historical gap data available." in the Gap History block.

---

## Research Gap-Stats Parser + Redundancy Fix

> Generated: 2026-04-22 | Agent: nexus-architect
> Status: COMPLETE

### Goal

`extractGapStatsTable` in both research blueprints (`small-cap-research.ts` and `swing-trader-research.ts`) reads gap-stats rows using field-name aliases that do not match the snake_case keys the AskEdgar API actually returns (`gap_percentage`, `market_open`, `market_close`, `previous_day_close`). The canonical mapper in `lib/askedgar.ts:831-847` documents the correct field names, but the blueprint extractors lead with camelCase aliases that never match, so every row is silently discarded and the LLM receives an empty gap table for every ticker. Separately, `historicalStats` is a free-text field that is semantically redundant with `gapStatsTable` — when the table is empty the LLM writes the literal string "No historical gap data available." into it, and the lack of a clear `chartHistory` definition causes the LLM to echo the same phrase there too. Both fixes ship in one spec because they touch the same four files and the test cleanup is interleaved.

### Approved decisions (locked)

1. Fix the `extractGapStatsTable` field-name fallback lists in both blueprints to lead with the canonical snake_case keys (`gap_percentage`, `market_open`, `market_close`, `prior_close`) before the camelCase aliases. Do not remove the camelCase aliases — they are harmless defensive fallbacks.
2. Remove `historicalStats` entirely from the Zod output schema, the `SmallCapResearchReport` TypeScript interface, the `exampleShape` object in `buildResearchPrompt`, the `historicalStats` prompt instruction string, and the Discord embed render path.
3. Redefine `chartHistory` via a new explicit prompt instruction so the LLM is told what data sources to use (RSI, EMA9, EMA21, 1-month high/low from `priceContext`; `gapCount`, `sameDayFadeRate`, `avgHighExtension`, `avgCloseVsOpen` from `deterministicAnalysis`) and is prohibited from writing "no historical gap data available" in that field regardless of `gapCount`.
4. Leave `lib/askedgar.ts`, `lib/discord/parser.ts`, and all DB schema / migration files untouched.
5. Swing-trader blueprint does not have `historicalStats` in its output schema or embed — only the field-name fix (Phase 2) applies there.

---

### Phase 1 — Fix gap-stats field-name fallbacks in small-cap blueprint
**File:** `lib/agents/blueprints/small-cap-research.ts`
**Action:** MODIFY

**Step 1.1 — Fix `open` fallback list in `extractGapStatsTable` (lines 351–357)**

At lines 351–357 the current code is:
```typescript
    const open = Number(
      row.marketOpen
      ?? row.open
      ?? row.openPrice
      ?? row.open_price
      ?? Number.NaN,
    );
```

Replace with:
```typescript
    const open = Number(
      row.market_open
      ?? row.marketOpen
      ?? row.open
      ?? row.openPrice
      ?? row.open_price
      ?? Number.NaN,
    );
```

**Step 1.2 — Fix `close` fallback list in `extractGapStatsTable` (lines 358–364)**

At lines 358–364 the current code is:
```typescript
    const close = Number(
      row.marketClose
      ?? row.close
      ?? row.closePrice
      ?? row.close_price
      ?? Number.NaN,
    );
```

Replace with:
```typescript
    const close = Number(
      row.market_close
      ?? row.marketClose
      ?? row.close
      ?? row.closePrice
      ?? row.close_price
      ?? Number.NaN,
    );
```

**Step 1.3 — Fix `directGap` fallback list in `extractGapStatsTable` (lines 370–376)**

At lines 370–376 the current code is:
```typescript
    const directGap = row.gapPercentage
      ?? row.gapPercent
      ?? row.gap_pct
      ?? row.gapPct
      ?? row.pctChange
      ?? row.gap
      ?? row.percent_change;
```

Replace with:
```typescript
    const directGap = row.gap_percentage
      ?? row.gapPercentage
      ?? row.gapPercent
      ?? row.gap_pct
      ?? row.gapPct
      ?? row.pctChange
      ?? row.gap
      ?? row.percent_change;
```

**Step 1.4 — Fix `priorClose` fallback list in `extractGapStatsTable` (lines 381–385)**

At lines 381–385 the current code is:
```typescript
      const priorClose = Number(
        row.priorClose
        ?? row.prior_close
        ?? row.previousClose
        ?? Number.NaN,
      );
```

Replace with:
```typescript
      const priorClose = Number(
        row.previous_day_close
        ?? row.prior_close
        ?? row.priorClose
        ?? row.previousClose
        ?? Number.NaN,
      );
```

**Step 1.5 — Fix `high` lookup in `normalizeGapRow` (line 323)**

At line 323 the current code is:
```typescript
  const high = getNumberField(value, ['high', 'intradayHigh', 'intraday_high']);
```

Replace with:
```typescript
  const high = getNumberField(value, ['high_price', 'high', 'intradayHigh', 'intraday_high']);
```

**Why this matters:** `normalizeGapRow` feeds `computeDeterministicAnalysis` (line 540 onward), which produces `gapCount`, `sameDayFadeRate`, `avgCloseVsOpen`, and `avgHighExtension`. Without `high_price` in the fallback list, every AskEdgar row returns `null` from `normalizeGapRow` (line 325 rejects when any of open/close/high is null), so the deterministic block is zeroed out for every ticker. This must be fixed alongside Step 1.1–1.4 or `chartHistory` (Phase 4) will still have nothing to rate from.

**Acceptance:**
- [ ] A fixture with a SPRC-shaped row (`{ date: '2026-04-01', gap_percentage: 45.2, market_open: 1.50, market_close: 1.20 }`) passed to `extractGapStatsTable` returns one row with `gapPct: 45.2`, `open: 1.50`, `close: 1.20`.
- [ ] A fixture with only camelCase keys (`{ date: '2026-04-01', gapPercentage: 10, marketOpen: 1.00, marketClose: 0.90 }`) still produces a valid row (regression check).
- [ ] A fixture with `market_open`, `market_close`, and `previous_day_close` but no direct gap field computes `gapPct` from the `previous_day_close` fallback.
- [ ] A fixture with `high_price`, `market_open`, `market_close` passed into the pipeline produces a non-zero `gapCount` from `computeDeterministicAnalysis`.

---

### Phase 2 — Apply identical extractor fix to swing-trader blueprint
**File:** `lib/agents/blueprints/swing-trader-research.ts`
**Action:** MODIFY

The `extractGapStatsTable` and `normalizeGapRow` functions in swing-trader are direct copies of the ones in small-cap-research. Apply the same five field-list changes at the swing-trader line anchors.

**Step 2.1 — Fix `open` fallback list (lines 360–366)**

At lines 360–366 the current code is:
```typescript
    const open = Number(
      row.marketOpen
      ?? row.open
      ?? row.openPrice
      ?? row.open_price
      ?? Number.NaN,
    );
```

Replace with:
```typescript
    const open = Number(
      row.market_open
      ?? row.marketOpen
      ?? row.open
      ?? row.openPrice
      ?? row.open_price
      ?? Number.NaN,
    );
```

**Step 2.2 — Fix `close` fallback list (lines 367–373)**

At lines 367–373 the current code is:
```typescript
    const close = Number(
      row.marketClose
      ?? row.close
      ?? row.closePrice
      ?? row.close_price
      ?? Number.NaN,
    );
```

Replace with:
```typescript
    const close = Number(
      row.market_close
      ?? row.marketClose
      ?? row.close
      ?? row.closePrice
      ?? row.close_price
      ?? Number.NaN,
    );
```

**Step 2.3 — Fix `directGap` fallback list (lines 379–385)**

At lines 379–385 the current code is:
```typescript
    const directGap = row.gapPercentage
      ?? row.gapPercent
      ?? row.gap_pct
      ?? row.gapPct
      ?? row.pctChange
      ?? row.gap
      ?? row.percent_change;
```

Replace with:
```typescript
    const directGap = row.gap_percentage
      ?? row.gapPercentage
      ?? row.gapPercent
      ?? row.gap_pct
      ?? row.gapPct
      ?? row.pctChange
      ?? row.gap
      ?? row.percent_change;
```

**Step 2.4 — Fix `priorClose` fallback list (lines 389–394)**

At lines 389–394 the current code is:
```typescript
      const priorClose = Number(
        row.priorClose
        ?? row.prior_close
        ?? row.previousClose
        ?? Number.NaN,
      );
```

Replace with:
```typescript
      const priorClose = Number(
        row.previous_day_close
        ?? row.prior_close
        ?? row.priorClose
        ?? row.previousClose
        ?? Number.NaN,
      );
```

**Step 2.5 — Fix `high` lookup in swing-trader `normalizeGapRow`**

Use `grep -n "const high = getNumberField" lib/agents/blueprints/swing-trader-research.ts` to locate the single line. The current code is:
```typescript
  const high = getNumberField(value, ['high', 'intradayHigh', 'intraday_high']);
```

Replace with:
```typescript
  const high = getNumberField(value, ['high_price', 'high', 'intradayHigh', 'intraday_high']);
```

**Acceptance:**
- [ ] The SPRC-shaped fixture passed through the swing-trader `extractGapStatsTable` export produces the identical result to Phase 1 (see Phase 5).
- [ ] Swing-trader `computeSwingTechnicals` produces a non-empty `gapStatsTable` when a SPRC-shaped `gapStats` array is present in the pipeline input.

---

### Phase 3 — Drop `historicalStats` from schema, type, prompt, and embed

#### 3a — `lib/agents/blueprints/small-cap-research.ts`
**Action:** MODIFY

**Step 3a.1 — Remove `historicalStats` from `researchReportSchema` (line 129)**

At line 129 the current code is:
```typescript
  historicalStats: z.string(),
```

Delete this line entirely. The surrounding schema block at lines 117–142 remains intact; only this one field is removed.

**Step 3a.2 — Remove `historicalStats` from `exampleShape` in `buildResearchPrompt` (line 743)**

At line 743 the current code is:
```typescript
    historicalStats: 'string summary of gap-stats data',
```

Delete this line entirely. The `exampleShape` object at lines 731–748 remains intact; only this one property is removed.

**Step 3a.3 — Remove the `historicalStats` prompt instruction (line 777)**

At line 777 the current code is:
```typescript
    'For historicalStats: summarize gap-stats patterns (avg gap fade, same-day fade count, typical range). If no gap-stats data, say "No historical gap data available."',
```

Delete this line entirely.

**Acceptance:**
- [ ] `researchReportSchema` no longer declares a `historicalStats` field.
- [ ] `buildResearchPrompt` output does not contain the string `historicalStats`.
- [ ] `buildResearchPrompt` output does not contain the string `summarize gap-stats patterns`.

#### 3b — `lib/agents/types.ts`
**Action:** MODIFY

**Step 3b.1 — Remove `historicalStats` from `SmallCapResearchReport` (line 50)**

At line 50 the current code is:
```typescript
  historicalStats: string;
```

Delete this line entirely. The interface at lines 38–55 remains intact.

**Acceptance:**
- [ ] `npx tsc --noEmit` passes with no reference to `historicalStats` in error output.

#### 3c — `lib/agents/discord.ts`
**Action:** MODIFY

**Step 3c.1 — Remove the `historicalStats` read at line 458**

At line 458 the current code is:
```typescript
  const historicalStats = payload.historicalStats.trim();
```

Delete this line entirely.

**Step 3c.2 — Remove the `historicalStats` conditional field push at lines 488–494**

At lines 488–494 the current code is:
```typescript
  if (historicalStats) {
    fields.push({
      name: 'Historical Stats',
      value: `\`\`\`\n${truncate(historicalStats, 1000)}\n\`\`\``,
      inline: false,
    });
  }
```

Delete these seven lines entirely.

**Acceptance:**
- [ ] `buildResearchEmbed` no longer reads `.historicalStats` from the payload.
- [ ] The Discord embed produced by `buildResearchEmbed` does not contain a `Historical Stats` field under any input.
- [ ] `buildResearchEmbed` still renders the `Gap History` block (the `gapBlock` variable and its usage at line 480 are untouched).

---

### Phase 4 — Redefine `chartHistory` semantics in the prompt
**File:** `lib/agents/blueprints/small-cap-research.ts`
**Action:** MODIFY (prompt-only)

**Step 4.1 — Add an explicit `chartHistory` instruction to `buildResearchPrompt`**

The current prompt array (lines 775–783) lists instruction strings that get joined into the prompt. There is no dedicated `chartHistory` instruction today — the LLM is left to infer meaning from the field name alone, and the now-deleted `historicalStats` instruction was the closest proxy (which is exactly why the LLM was conflating the two).

In `buildResearchPrompt`, within the array passed to `.join('\n\n')` that begins at line 750, immediately after the current line:
```typescript
    'Use the Deterministic analysis section as precomputed inputs. Do not recalculate those values in the response.',
```

Add a new array element (same indentation, trailing comma):
```typescript
    'For chartHistory: rate the ticker\'s technical posture and gap follow-through history. Base the explanation on (1) rsi, ema9, ema21, high1m, low1m, sector from priceContext and (2) gapCount, sameDayFadeRate, avgHighExtension, avgCloseVsOpen from deterministicAnalysis. Do NOT write "no historical gap data available" in chartHistory — that phrase belongs only to the gapStatsTable section. If gapCount is 0, still rate the chart setup using price-context technicals and acknowledge thin gap priors in one clause.',
```

**Acceptance:**
- [ ] `buildResearchPrompt` output contains the string `For chartHistory:`.
- [ ] `buildResearchPrompt` output contains the string `Do NOT write "no historical gap data available" in chartHistory`.
- [ ] `buildResearchPrompt` output does not contain the string `historicalStats` (covered by Phase 3a).

---

### Phase 5 — Tests

#### 5a — `__tests__/agent-blueprints.test.ts`
**Action:** MODIFY

**Step 5a.1 — Add `extractGapStatsTable` imports**

At the top of the file, add these two imports alongside the existing blueprint imports:
```typescript
import { extractGapStatsTable as extractGapStatsTableSmallCap } from '@/lib/agents/blueprints/small-cap-research';
import { extractGapStatsTable as extractGapStatsTableSwing } from '@/lib/agents/blueprints/swing-trader-research';
```

Both functions are already exported — no source change needed. Verify with `grep -n "export function extractGapStatsTable" lib/agents/blueprints/*.ts` before adding.

**Step 5a.2 — Add a new `describe('extractGapStatsTable', …)` block**

Add this block at the top level of the test file (outside any existing blueprint describe), placed immediately before the first existing `describe(...)` call:

```typescript
describe('extractGapStatsTable (gap-stats parser regression guard)', () => {
  // Canonical AskEdgar /v1/gap-stats row shape (confirmed from the live cache on 2026-04-22).
  // If this test fails, the extractor has drifted from the real API shape again.
  const sprcRow = {
    date: '2026-04-01',
    gap_percentage: 45.2,
    market_open: 1.50,
    market_close: 1.20,
  };

  it('parses canonical snake_case row in small-cap blueprint', () => {
    const result = extractGapStatsTableSmallCap([sprcRow]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ date: '2026-04-01', gapPct: 45.2, open: 1.50, close: 1.20 });
  });

  it('parses canonical snake_case row in swing-trader blueprint', () => {
    const result = extractGapStatsTableSwing([sprcRow]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ date: '2026-04-01', gapPct: 45.2, open: 1.50, close: 1.20 });
  });

  it('still parses camelCase rows (defensive fallback regression)', () => {
    const camelRow = {
      date: '2026-04-01',
      gapPercentage: 10,
      marketOpen: 1.00,
      marketClose: 0.90,
    };
    const result = extractGapStatsTableSmallCap([camelRow]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ gapPct: 10, open: 1.00, close: 0.90 });
  });

  it('derives gapPct from previous_day_close when no direct gap field is present', () => {
    const derivedRow = {
      date: '2026-04-01',
      market_open: 1.50,
      market_close: 1.20,
      previous_day_close: 1.00,
    };
    const result = extractGapStatsTableSmallCap([derivedRow]);
    expect(result).toHaveLength(1);
    expect(result[0]!.gapPct).toBeCloseTo(50, 1);
  });
});
```

**Step 5a.3 — Remove `historicalStats` from the synthesize-report mock payload (line 1285)**

At line 1285 the current code is:
```typescript
        historicalStats: 'Average gap fade 18%.',
```

Delete this line from the mock JSON object.

**Step 5a.4 — Remove `historicalStats` from the save-step mock payload (line 1434)**

At line 1434 the current code is:
```typescript
        historicalStats: 'Average gap fade 18%.',
```

Delete this line from the `previousOutput` object.

**Step 5a.5 — Remove `historicalStats` from the third mock payload (line 2205)**

At line 2205 the current code is:
```typescript
        historicalStats: 'Avg fade 18%.',
```

Delete this line. (This is a third mock payload, in a separate test case from Steps 5a.3 and 5a.4 — confirm with `grep -n historicalStats __tests__/agent-blueprints.test.ts` after deletion; the command should return no matches.)

**Acceptance:**
- [ ] All four new `extractGapStatsTable` tests pass.
- [ ] `grep -n historicalStats __tests__/agent-blueprints.test.ts` returns zero matches after all deletions.
- [ ] The existing synthesize-report, save-step, and background-model test cases continue to pass after their `historicalStats` mock lines are removed.
- [ ] `npm test` passes with no type errors in the test file.

#### 5b — `__tests__/agent-discord.test.ts`
**Action:** MODIFY

**Step 5b.1 — Remove `historicalStats` from the four fixture locations**

Before editing, confirm the locations with `grep -n historicalStats __tests__/agent-discord.test.ts`. As of 2026-04-22 the matches are at lines 54, 83, 483, 542. Delete each of these lines:

- Line 54 — inside `createStoredReport`'s `reportJson`:
  ```typescript
        historicalStats: 'Average gap fade 18%.',
  ```
- Line 83 — inside `createSmallCapReportJson`:
  ```typescript
      historicalStats: 'Average gap fade 18%.',
  ```
- Line 483 — inside the inline `createStoredReport({...})` override in the "uses the stored row as the source of truth" test:
  ```typescript
          historicalStats: 'Stored historical stats.',
  ```
- Line 542 — inside the inline `createSmallCapReportJson({...})` override in the "builds the small-cap research embed with traffic-light lines and history" test:
  ```typescript
          historicalStats: 'Average gap fade 22%.',
  ```

**Step 5b.2 — Remove the `Historical Stats` embed field assertion**

In the same `'builds the small-cap research embed with traffic-light lines and history'` test, locate the `expect.arrayContaining([...])` assertion block that currently includes a `Historical Stats` field. The relevant assertion looks approximately like:
```typescript
      expect.objectContaining({
        name: 'Historical Stats',
        value: '```\nAverage gap fade 22%.\n```',
        inline: false,
      }),
```

Delete these four lines from the `expect.arrayContaining([...])` array. Keep the `Ticker` and `Confidence` field assertions that precede/follow it.

**Acceptance:**
- [ ] `grep -n historicalStats __tests__/agent-discord.test.ts` returns zero matches.
- [ ] `grep -n "Historical Stats" __tests__/agent-discord.test.ts` returns zero matches.
- [ ] `buildResearchEmbed` tests all pass.

#### 5c — No new test files

Do NOT create a separate `__tests__/agent-gap-stats-extractor.test.ts`. The new tests live in `__tests__/agent-blueprints.test.ts` because that file already imports both blueprint modules and already mocks their dependencies — a standalone file would duplicate the mock scaffolding for no gain.

**Acceptance:**
- [ ] No new test files are created.

---

### Phase 6 — Validation

From repo root `/home/jared/Nexus-Terminal`, run in order:

1. `npm run lint`
2. `npx tsc --noEmit`
3. `npm test`

Skip `npm run typecheck:services` — no files under `services/` are touched. Skip `npm run workflow:audit` — no workflow assets are changed.

**Manual sanity check (after deploy):**
- Trigger a `small-cap-trader:research` run on `SPRC` (cached with 9 gap rows on 2026-04-22) and confirm the Discord embed renders a populated `Gap History` table and that the `chartHistory` explanation references RSI/EMA/1-month range rather than gap data availability.
- Trigger on `AGPU` (cache has 0 gap rows) and confirm `Gap History` shows "No historical gap data available." while `chartHistory` still produces a substantive, non-gap-parroting explanation grounded in price-context technicals.

---

### Files NOT to touch

- `lib/askedgar.ts` — already correct; the canonical mapper at lines 831–847 is the reference, not a target.
- `lib/discord/parser.ts` — legacy standalone parser with its own `historicalStats` field, unrelated to `lib/agents/types.ts`. Leave untouched.
- Any DB schema or migration files — no storage changes in this spec.
- AskEdgar cache table — raw API data is correct; only in-blueprint extraction was wrong.

---

### Files Changed Summary

| File | Action | Approx. lines changed | Risk |
|---|---|---|---|
| `lib/agents/blueprints/small-cap-research.ts` | MODIFY | ~18 (5 extractor fallbacks + schema field + exampleShape property + 1 deleted prompt string + 1 new prompt string) | LOW |
| `lib/agents/blueprints/swing-trader-research.ts` | MODIFY | ~6 (5 extractor fallbacks) | LOW |
| `lib/agents/types.ts` | MODIFY | 1 (remove `historicalStats: string` from interface) | LOW |
| `lib/agents/discord.ts` | MODIFY | ~8 (remove variable read + conditional field push) | LOW |
| `__tests__/agent-blueprints.test.ts` | MODIFY | ~50 (2 new imports + new describe block + 3 mock-line deletions) | LOW |
| `__tests__/agent-discord.test.ts` | MODIFY | ~8 (4 fixture line deletions + 1 assertion block deletion) | LOW |

Risk rationale: every change is a literal string swap against a known anchor. The only semantic change is in the prompt (Phase 4), which affects LLM output quality, not schema correctness — and the schema remains the hard validator.

---

### Verification Steps

1. `npm run lint`
2. `npx tsc --noEmit`
3. `npm test` — prior count was `53` files / `409` tests. Expected new count: `53` files / `413` tests (+4 from the new `extractGapStatsTable` describe block).

(Skip `typecheck:services` and `workflow:audit` — no touched files require them.)

---

### Open Questions for Codex

None — the plan is locked.

# Nexus Terminal — HANDOFF.md

> Updated: 2026-04-22
> Purpose: brief summary of recently completed work plus any active execution spec. Older implementation detail lives in git history and `specs/`.
> Historical completed sections were archived to keep this file focused. Agent Hardening #1 shipped in `7118598`; Agent Hardening #2 in `2a856f1`; Agent Hardening #3 in `bf13567`; Research agent report refinements in `9a69655` (2026-04-17); Trade Journal Enhancement (DRC + Weekly Review + Archive tab) shipped across `4757fa3`, `0e41b5a`, `8dd6b12`, `fe97e8c`, `c300153` (2026-04-19 → 2026-04-20); Tighten Trading Journal UI shipped in `f1fde41` (2026-04-20); Spend Enforcement Fix shipped across `7aad160`, `abdefe9`, `1bd5e1e`, `8ad674e`, `9f0a123` (2026-04-20); Research Gap-Stats Parser + Redundancy Fix shipped in `0e96e16` (2026-04-22). See git history for full records.

## Current State

**Active spec:** None. Next: approval gates from `FUTURE-PLANS.md` item 1.

## Validation Snapshot

Most recent validation (`2026-04-22`, Research Chart History Polish):

- `npm run lint` — passed
- `npx tsc --noEmit` — passed
- `npm test` — passed (`53` files, `413` tests)

## Follow-Up Notes

- ~~Production check: verify `GET /api/cron/agent-retention` returns `200`~~ — validated 2026-04-22.
- ~~After Research Gap-Stats Parser fix ships, re-verify Discord embed~~ — verified 2026-04-22: SPRC renders populated Gap History, AGPU still renders "No historical gap data available."
- Latent bug to investigate separately: `lib/askedgar.ts:840` reads `intraday_high` as the primary key for the gap-stats high field, but the AskEdgar `/v1/gap-stats` endpoint actually returns `high_price`. The research blueprints bypass the canonical mapper (reading `rawData['gap-stats']` directly) so this does not currently break research reports, but any other consumer of the mapped snapshot's `gapStats` array will see `intradayHigh: null` on every row. File a dedicated spec if/when another feature depends on the mapped snapshot.

---

## Research Chart History Polish

> Generated: 2026-04-22 | Agent: plan (inline)
> Status: COMPLETED 2026-04-22

### Goal

Three unrelated-but-co-located polish items observed in the first post-parser-fix research run (SPRC, AGPU, 2026-04-22):

1. **Chart History explanation gets truncated mid-sentence in Discord.** `ratingLine` caps every section at 300 chars (`lib/agents/discord.ts:456`). Chart History synthesizes five-plus metrics and consistently runs longer. Observed SPRC output: `"...Given the gapCount of 5, the sameDayFadeRate of 0.5, and avgHigh"` — cut off mid-word.

2. **Chart History wording parrots field names and miscounts gap rows.** Current prompt at `lib/agents/blueprints/small-cap-research.ts:784` lists the raw identifiers (`gapCount`, `sameDayFadeRate`, `avgHighExtension`, `avgCloseVsOpen`, `low1m`, etc.) and the LLM echoes those identifiers into the prose instead of translating them. Separately, SPRC's chartHistory said "gapCount of 5" when `deterministicAnalysis.gapCount` was actually 10 — the LLM counted rows from the 5-row display table rather than reading the deterministic total. Math check confirms: `sameDayFadeRate: 0.5` with five fades requires a 10-row sample, not 5.

3. **The 5-row display cap on `extractGapStatsTable` hides half the SPRC cache and fuels the miscount.** `small-cap-research.ts:405` and `swing-trader-research.ts:415` both do `rows.slice(0, 5)`. SPRC's cache has 10 rows — all normalize cleanly (verified 2026-04-22 via direct DB query), no drop-off — so capping at 5 is purely a cosmetic choice and the LLM's visible view of the history gets truncated for no benefit.

### Approved decisions (locked)

1. Raise the Chart History truncation cap from 300 → 500 **only for Chart History**, by inlining the rendering call. Leave every other section at 300 (safer against the 4096-char embed-description ceiling).
2. Rewrite the `chartHistory` prompt instruction so the LLM (a) reads numeric inputs from the `deterministicAnalysis` JSON block rather than counting rows from the visible Historical Gap Data table, (b) translates metrics into plain-English phrasing, and (c) is explicitly forbidden from echoing the field identifiers (`gapCount`, `sameDayFadeRate`, `low1m`, etc.) in the output.
3. Raise `extractGapStatsTable`'s slice cap from 5 → 10 in both blueprints. 10 rows × ~48 chars = ~480 chars of gap-block content plus ~110 chars of header — still well inside Discord's 4096-char embed-description limit.
4. Only the small-cap blueprint has a `chartHistory` field — swing-trader has no equivalent, so the prompt rewrite is small-cap-only. The gap-cap bump applies to both.
5. Do NOT touch `lib/askedgar.ts` — the latent `intraday_high` vs. `high_price` issue in the canonical mapper is tracked in Follow-Up Notes and does not affect research reports.

---

### Phase 1 — Raise Chart History truncation cap

**File:** `lib/agents/discord.ts`
**Action:** MODIFY

**Step 1.1 — Inline a longer cap for Chart History (line 477)**

The shared `ratingLine` helper at lines 453–456 hard-codes `truncate(section.explanation, 300)`, and the other sections (`Offering Risk`, `Dilution`, etc.) all fit comfortably inside 300 chars. Only Chart History needs more room.

At line 477 the current code is:
```typescript
    ratingLine('Chart History', payload.chartHistory),
```

Replace with an inline expansion that uses a 500-char cap, keeping the same visual format as `ratingLine`:
```typescript
    `**Chart History** ${ratingEmoji(payload.chartHistory.rating)}\n• ${truncate(payload.chartHistory.explanation, 500)}`,
```

Do NOT change the `ratingLine` helper itself — leave it at 300 so the other six small-cap sections stay uniform. Do NOT change the swing-trader `ratingLine` at line 504 (swing-trader has no `chartHistory`).

**Why 500 specifically:** Worst-case embed size with the six other sections at 300, Chart History at 500, and the Gap History block (10 rows ≈ 600 chars) = ~2700 chars, well under Discord's 4096-char description limit. 500 gives Chart History room for ~3–4 sentences before truncation, which matches the new prompt's expected output length (Phase 2).

**Acceptance:**
- [x] `ratingLine` helper at `discord.ts:453–456` still caps at 300.
- [x] The Chart History rendering call at line 477 uses a 500-char truncate and matches the `**Label** emoji\n• text` format.
- [x] `buildSwingSetupEmbed` is unchanged.
- [x] Existing `agent-discord.test.ts` tests still pass.

---

### Phase 2 — Rewrite the `chartHistory` prompt instruction

**File:** `lib/agents/blueprints/small-cap-research.ts`
**Action:** MODIFY

**Step 2.1 — Replace the chartHistory instruction (line 784)**

At line 784 the current code is:
```typescript
    'For chartHistory: rate the ticker\'s technical posture and gap follow-through history. Base the explanation on (1) rsi, ema9, ema21, high1m, low1m, sector from priceContext and (2) gapCount, sameDayFadeRate, avgHighExtension, avgCloseVsOpen from deterministicAnalysis. Do NOT write "no historical gap data available" in chartHistory — that phrase belongs only to the gapStatsTable section. If gapCount is 0, still rate the chart setup using price-context technicals and acknowledge thin gap priors in one clause.',
```

Replace with:
```typescript
    'For chartHistory: write 2-3 sentences rating the ticker\'s technical posture and historical gap behavior. Read numeric inputs directly from the deterministicAnalysis JSON block (for gapCount, sameDayFadeRate, avgHighExtension, avgCloseVsOpen) and the priceContext JSON block (for rsi, ema9, ema21, high1m, low1m, sector). Translate those numbers into plain-English phrasing — e.g., "fades intraday about half the time", "averages ~25% above the open", "RSI 69 is approaching overbought", "trades between $2.98 and $6.57 over the last month". Do NOT echo the raw field identifiers in your output (no literal "gapCount", "sameDayFadeRate", "avgHighExtension", "avgCloseVsOpen", "high1m", "low1m", "ema9", or "ema21" tokens in the sentence). Do NOT count rows from the Historical Gap Data display table — trust the gapCount value in deterministicAnalysis (the display table may be a truncated view). Do NOT write "no historical gap data available" in chartHistory — that phrase belongs only to the gapStatsTable section. If gapCount is 0, still rate the chart setup using price-context technicals and acknowledge thin gap priors in one clause.',
```

**Acceptance:**
- [x] `buildResearchPrompt` output contains the string `Read numeric inputs directly from the deterministicAnalysis`.
- [x] `buildResearchPrompt` output contains the string `Do NOT echo the raw field identifiers`.
- [x] `buildResearchPrompt` output contains the string `Do NOT count rows from the Historical Gap Data display table`.
- [x] `buildResearchPrompt` output still contains the string `Do NOT write "no historical gap data available" in chartHistory` (preserved from prior spec).

---

### Phase 3 — Raise gap-table display cap from 5 to 10

**File:** `lib/agents/blueprints/small-cap-research.ts`
**Action:** MODIFY

**Step 3.1 — Change slice at line 405**

At line 405 the current code is:
```typescript
  return rows.slice(0, 5);
```

Replace with:
```typescript
  return rows.slice(0, 10);
```

**File:** `lib/agents/blueprints/swing-trader-research.ts`
**Action:** MODIFY

**Step 3.2 — Change slice at line 415**

At line 415 the current code is:
```typescript
  return rows.slice(0, 5);
```

Replace with:
```typescript
  return rows.slice(0, 10);
```

**Acceptance:**
- [x] Both `extractGapStatsTable` exports return up to 10 rows, not 5.
- [x] Feeding `extractGapStatsTable` an array of 12 rows returns exactly 10.
- [x] Feeding fewer than 10 rows returns them all unchanged.

---

### Phase 4 — Tests

#### 4a — Update the existing slice-cap test

**File:** `__tests__/agent-blueprints.test.ts`
**Action:** MODIFY

**Step 4a.1 — Update the test at lines 2434–2447**

At lines 2434–2447 the current code is:
```typescript
  it('caps output at 5 rows and falls back to priorClose-based gap computation when direct gap is missing', async () => {
    const { extractGapStatsTable } = await import('@/lib/agents/blueprints/small-cap-research');

    const raw = Array.from({ length: 8 }, (_, i) => ({
      date: `2026-04-${String(i + 1).padStart(2, '0')}`,
      marketOpen: 11,
      marketClose: 10.5,
      priorClose: 10,
    }));

    const rows = extractGapStatsTable(raw);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toEqual({ date: '2026-04-01', gapPct: 10, open: 11, close: 10.5 });
  });
```

Replace with:
```typescript
  it('caps output at 10 rows and falls back to priorClose-based gap computation when direct gap is missing', async () => {
    const { extractGapStatsTable } = await import('@/lib/agents/blueprints/small-cap-research');

    const raw = Array.from({ length: 12 }, (_, i) => ({
      date: `2026-04-${String(i + 1).padStart(2, '0')}`,
      marketOpen: 11,
      marketClose: 10.5,
      priorClose: 10,
    }));

    const rows = extractGapStatsTable(raw);
    expect(rows).toHaveLength(10);
    expect(rows[0]).toEqual({ date: '2026-04-01', gapPct: 10, open: 11, close: 10.5 });
  });
```

**Rationale:** The previous test used 8 rows so it could assert the 5-cap. The new cap is 10, so the input now needs 12 rows to actually exercise the slice.

**Acceptance:**
- [x] Test description says `caps output at 10 rows`.
- [x] Test input has 12 rows.
- [x] Test asserts `toHaveLength(10)`.

#### 4b — No new test files

Do NOT add dedicated tests for the prompt-string rewrite or the truncation change — both are covered by acceptance criteria greps and by existing embed/prompt test coverage. The existing `agent-discord.test.ts` and `agent-blueprints.test.ts` continue to exercise those paths.

---

### Phase 5 — Validation

From repo root `/home/jared/Nexus-Terminal`, run in order:

1. `npm run lint`
2. `npx tsc --noEmit`
3. `npm test`

Skip `npm run typecheck:services` — no files under `services/` are touched. Skip `npm run workflow:audit` — no workflow assets are changed.

**Manual sanity check (after deploy):**
- Trigger a `small-cap-trader:research` run on `SPRC` and confirm:
  - (a) the Gap History table renders all 10 rows (no truncation to 5).
  - (b) the Chart History explanation is a complete sentence (no mid-word truncation).
  - (c) the explanation uses plain-English phrasing and does NOT contain the literal strings `gapCount`, `sameDayFadeRate`, `avgHighExtension`, `avgCloseVsOpen`, `high1m`, `low1m`, `ema9`, or `ema21`.
  - (d) any gap counts or fade rates referenced in prose match `deterministicAnalysis.gapCount` / `sameDayFadeRate`, not the visible table row count.
- Trigger on `AGPU` (0 gap rows) and confirm chartHistory still produces a substantive explanation grounded in price-context technicals and acknowledges thin gap priors — without writing "no historical gap data available".

---

### Files NOT to touch

- `lib/askedgar.ts` — the canonical mapper's `intraday_high` vs. `high_price` issue is tracked in Follow-Up Notes. Does not affect research reports (blueprints bypass the mapper).
- `lib/agents/blueprints/swing-trader-research.ts` prompt block — swing-trader has no `chartHistory` field.
- `lib/agents/discord.ts:504` (swing-trader `ratingLine` helper) — no `chartHistory` in swing-trader; leave at 300.
- `lib/agents/types.ts` — no schema change in this spec.

---

### Files Changed Summary

| File | Action | Approx. lines changed | Risk |
|---|---|---|---|
| `lib/agents/discord.ts` | MODIFY | 1 (inline Chart History render) | LOW |
| `lib/agents/blueprints/small-cap-research.ts` | MODIFY | 2 (1 slice cap + 1 prompt string) | LOW |
| `lib/agents/blueprints/swing-trader-research.ts` | MODIFY | 1 (slice cap) | LOW |
| `__tests__/agent-blueprints.test.ts` | MODIFY | ~4 (update existing slice-cap test in place) | LOW |

Risk rationale: every change is a literal string/number swap against a known anchor. The prompt rewrite affects LLM output quality only — the schema (unchanged) is still the hard validator.

---

### Verification Steps

1. `npm run lint`
2. `npx tsc --noEmit`
3. `npm test` — prior count was `53` files / `413` tests. Expected new count: `53` files / `413` tests (the existing slice-cap test is modified in place, not added or removed).

Skip `typecheck:services` and `workflow:audit` — no touched files require them.

---

### Open Questions for Codex

None — the plan is locked.

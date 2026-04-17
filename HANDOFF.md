# Nexus Terminal — HANDOFF.md

> Updated: 2026-04-17
> Purpose: brief summary of recently completed work plus any active execution spec. Older implementation detail lives in git history and `specs/`.
> Historical completed sections were archived on `2026-04-16` to keep this file focused. Agent Hardening #1 shipped in commit `7118598`; Agent Hardening #2 (trust boundary in prompt assembly) shipped in commit `2a856f1`; Agent Hardening #3 (memory / retention TTL-on-read) shipped in commit `bf13567`. See git history and `specs/` for the full implementation records.

## Current State

**Active spec:** Research Agent Report Refinements (Gap Stats + Financial Commentary + Traffic-Light Normalization) — see below.

Agent Hardening #1 through #3 are shipped and archived from this file. The next hardening item after this spec is approval gates plus spend enforcement from `FUTURE-PLANS.md`.

---

## Active Spec — Research Agent Report Refinements

> Generated: 2026-04-17 | Agent: nexus-architect
> Status: PLANNED

### Objective

Extend both research agents (small-cap-trader, swing-trader) with a structured `gapStatsTable` field and a rated `financialCommentary` section. Normalize small-cap traffic-light semantics to standard convention. Fix the empty-gap-data display path so it renders clean Discord text instead of a JSON blob.

### Pre-Flight: Read Before Touching

Before writing any code, open and read these files in full to confirm line numbers have not drifted:

- `lib/agents/blueprints/small-cap-research.ts`
- `lib/agents/blueprints/swing-trader-research.ts`
- `lib/agents/types.ts`
- `lib/agents/discord.ts`
- `lib/agents/prompts/small-cap.md`
- `lib/agents/prompts/swing-trader.md`
- `lib/types.ts`
- `components/trading/ResearchReportSections.tsx`

### Step 1 — Verify frontend safety before any schema changes

**File:** `components/trading/ResearchReportSections.tsx`
**Action:** READ ONLY

Check lines 252–257 and surrounding code that renders rated sections from `reportJson`. Determine whether the component:

- (a) Iterates over a known explicit list of rated-section keys, OR
- (b) Dynamically iterates unknown keys from `reportJson`

If (a): add `financialCommentary` to the list wherever defined. If (b): no touch needed — unknown keys are safely ignored. Document which case applies before proceeding.

### Step 2 — Add shared `GapStatsRow` type

**File:** `lib/agents/types.ts`
**Action:** MODIFY

After the existing `TrafficLight` type (line 17), add:

```typescript
export interface GapStatsRow {
  date: string;       // ISO YYYY-MM-DD
  gapPct: number;     // gap percent, e.g. 12.5 means +12.5%
  open: number;
  close: number;
}
```

### Step 3 — Update `SmallCapResearchReport` interface

**File:** `lib/agents/types.ts`
**Action:** MODIFY

Locate the `SmallCapResearchReport` interface (lines 31–46). Add two required fields:

```typescript
gapStatsTable: GapStatsRow[];
financialCommentary: { rating: TrafficLight; explanation: string };
```

Must stay in sync with the Zod schema updated in Step 5.

### Step 4 — Update swing-trader Zod schema

**File:** `lib/agents/blueprints/swing-trader-research.ts`
**Action:** MODIFY

Locate `swingResearchSchema` (lines 117–132). Add `GapStatsRow` to the existing import from `'../types'` if not already present.

Add two fields inside the schema object:

```typescript
gapStatsTable: z.array(
  z.object({
    date: z.string(),
    gapPct: z.number(),
    open: z.number(),
    close: z.number(),
  })
),
financialCommentary: z.object({
  rating: z.enum(['green', 'yellow', 'red']),
  explanation: z.string(),
}),
```

### Step 5 — Update small-cap Zod schema

**File:** `lib/agents/blueprints/small-cap-research.ts`
**Action:** MODIFY

Locate `researchReportSchema` (lines 110–125). Add the same two fields as Step 4 (inline Zod object; `GapStatsRow` interface is TypeScript-only).

### Step 6 — Add `extractGapStatsTable()` helper (both blueprints)

Duplicate the helper in each blueprint file — do NOT create a new shared module.

**6a — Small-cap blueprint** (`lib/agents/blueprints/small-cap-research.ts`, MODIFY)

Find `normalizeGapRow()` at lines 295–313. Add this helper immediately after it:

```typescript
function extractGapStatsTable(rawRows: unknown[]): GapStatsRow[] {
  const rows: GapStatsRow[] = [];
  for (const r of rawRows) {
    if (typeof r !== 'object' || r === null) continue;
    const row = r as Record<string, unknown>;

    const rawDate =
      row['date'] ?? row['gapDate'] ?? row['trading_date'] ??
      row['tradeDate'] ?? row['tradingDate'];
    if (typeof rawDate !== 'string' || !rawDate) continue;
    const date = rawDate.slice(0, 10);

    const open = Number(row['open'] ?? row['openPrice'] ?? row['open_price'] ?? NaN);
    const close = Number(row['close'] ?? row['closePrice'] ?? row['close_price'] ?? NaN);
    if (isNaN(open) || isNaN(close)) continue;

    let gapPct: number | null = null;
    const directGap =
      row['gapPercent'] ?? row['gap_pct'] ?? row['gapPct'] ??
      row['pctChange'] ?? row['gap'] ?? row['percent_change'];
    if (directGap !== undefined && directGap !== null && !isNaN(Number(directGap))) {
      gapPct = Number(directGap);
    } else {
      const priorClose = Number(
        row['priorClose'] ?? row['prior_close'] ?? row['previousClose'] ?? NaN
      );
      if (!isNaN(priorClose) && priorClose !== 0) {
        gapPct = ((open - priorClose) / priorClose) * 100;
      }
    }
    if (gapPct === null) continue;

    rows.push({ date, gapPct: Math.round(gapPct * 100) / 100, open, close });
  }

  return rows.slice(0, 5); // most recent first, cap at 5
}
```

If no rows survive filtering, the function returns `[]`. During local dev, log `rawRows[0]` once to verify AskEdgar's actual field names match one of the aliases above; extend aliases if not.

**6b — Swing-trader blueprint** (`lib/agents/blueprints/swing-trader-research.ts`, MODIFY)

Add the identical `extractGapStatsTable()` function after the swing-specific gap computation block (lines 293–320). Import `GapStatsRow` from `'../types'`.

### Step 7 — Wire `gapStatsTable` into small-cap deterministic compute

**File:** `lib/agents/blueprints/small-cap-research.ts`
**Action:** MODIFY

Locate `computeDeterministicAnalysis()` (lines 440–557). Find where `rawData['gap-stats']` is accessed. Add:

```typescript
const rawGapRows = Array.isArray(rawData['gap-stats']) ? rawData['gap-stats'] : [];
const gapStatsTable = extractGapStatsTable(rawGapRows);
```

Return `gapStatsTable` from the function. Update the return type annotation to include `gapStatsTable: GapStatsRow[]`.

### Step 8 — Wire `gapStatsTable` into swing technicals compute

**File:** `lib/agents/blueprints/swing-trader-research.ts`
**Action:** MODIFY

Locate `computeSwingTechnicals()` (lines 517–549). Apply the same extraction as Step 7. Return `gapStatsTable`; update return type annotation.

### Step 9 — Pass data through small-cap pipeline

**File:** `lib/agents/blueprints/small-cap-research.ts`
**Action:** MODIFY

**9a** — In the `compute-deterministic` step (lines 750–773), ensure `gapStatsTable` from `computeDeterministicAnalysis()` is stored in step output and forwarded.

**9b** — In `buildResearchPrompt()` (lines 623–671), accept `gapStatsTable` and the normalized snapshot. Replace the "No historical gap data available" fallback (line 667) with:

```typescript
const gapTableSection =
  gapStatsTable.length === 0
    ? 'No historical gap data available.'
    : [
        'Historical Gap Data (last 5, most recent first):',
        '| Date | Gap % | Open | Close |',
        '|------|-------|------|-------|',
        ...gapStatsTable.map(
          (r) =>
            `| ${r.date} | ${r.gapPct > 0 ? '+' : ''}${r.gapPct.toFixed(2)}% | ${r.open} | ${r.close} |`
        ),
      ].join('\n');
```

Inject `gapTableSection` into the prompt where gap data currently appears.

**9c** — Add management commentary to the prompt context:

```typescript
const commentaryText =
  snapshot.dilutionDetails?.managementCommentary?.trim() || 'No management commentary available.';
```

Append: `Management Commentary (from SEC filings / earnings):\n${commentaryText}`

**9d** — In `synthesize-report` step (lines 775–807), after parsing the LLM response against `researchReportSchema`:

```typescript
parsed.gapStatsTable = gapStatsTable; // always use deterministic value, never LLM guess
```

`financialCommentary` is LLM-owned — do not overwrite.

### Step 10 — Pass data through swing-trader pipeline

**File:** `lib/agents/blueprints/swing-trader-research.ts`
**Action:** MODIFY

Mirror all sub-steps from Step 9:
- 10a: store `gapStatsTable` from `computeSwingTechnicals()` in step output
- 10b: inject gap markdown table into `buildResearchPrompt()` (lines 620–686)
- 10c: inject `managementCommentary` into the prompt
- 10d: overwrite `parsed.gapStatsTable` with deterministic value after Zod parse

### Step 11 — Update Discord embed (small-cap)

**File:** `lib/agents/discord.ts`
**Action:** MODIFY

Locate `buildResearchEmbed()` (lines 442–483).

**11a** — Gap stats block. After existing "Historical Stats" code block, append:

```typescript
const gapBlock =
  report.gapStatsTable.length === 0
    ? 'No historical gap data available.'
    : [
        '```',
        'Date        | Gap %    | Open    | Close',
        '------------|----------|---------|--------',
        ...report.gapStatsTable.map(
          (r) =>
            `${r.date} | ${(r.gapPct > 0 ? '+' : '') + r.gapPct.toFixed(2).padStart(7)}% | ${String(r.open).padStart(7)} | ${String(r.close).padStart(7)}`
        ),
        '```',
      ].join('\n');
```

Append `'\n**Gap History**\n' + gapBlock` to the description.

**11b** — Financial commentary rating line using the existing `ratingLine` helper:

```typescript
const commentaryLine = ratingLine(
  report.financialCommentary.rating,
  `Financial Commentary: ${report.financialCommentary.explanation}`
);
```

Add `commentaryLine` to the description join array.

### Step 12 — Update Discord embed (swing-trader)

**File:** `lib/agents/discord.ts`
**Action:** MODIFY

Locate `buildSwingSetupEmbed()` (lines 485–521). Apply the same additions as 11a and 11b.

### Step 13 — Normalize small-cap traffic-light semantics in prompt

**File:** `lib/agents/prompts/small-cap.md`
**Action:** MODIFY

Replace the traffic-light definition section (currently short-seller-inverted) with standard semantics:

- RED: high dilution risk, high offering ability, desperate cash need, going concern language, negative signals for the company
- YELLOW: mixed signals, unclear fundamentals, moderate dilution risk
- GREEN: legitimate catalysts, low offering ability, low dilution risk, well-funded company

Do not change any other section. Do not change `swing-trader.md` semantics.

Also add two new usage sections to `small-cap.md`:

- **Gap Stats usage:** Instruct the LLM to use the gap history table to evaluate prior gap reliability. Gaps that fade quickly = bearish context; gaps that hold = caution signals.
- **Financial Commentary usage:** Rate `financialCommentary` RED if commentary mentions raising capital, going concern, or liquidity concerns. GREEN if no such language. YELLOW if unclear.

### Step 14 — Add usage instructions to swing-trader prompt

**File:** `lib/agents/prompts/swing-trader.md`
**Action:** MODIFY

Additive only — do not change existing semantics. Append two sections:

- **Gap Stats usage:** Use the gap history table to assess whether the ticker is a reliable gap-and-go candidate. Consider gap % magnitude and open-to-close behavior.
- **Financial Commentary usage:** RED if commentary mentions raising capital, liquidity concerns, or going concern. GREEN if no such language. YELLOW if unclear.

### Step 15 — Apply Step 1 finding

If Step 1 determined case (a), add `financialCommentary` to the explicit rated-sections list in `ResearchReportSections.tsx`. If case (b), no change.

### Files Changed Summary

| File | Action | Risk | Notes |
|------|--------|------|-------|
| `lib/agents/types.ts` | MODIFY | LOW | New interface + two fields on `SmallCapResearchReport` |
| `lib/agents/blueprints/small-cap-research.ts` | MODIFY | HIGH | Schema, normalizer, compute, prompt, pipeline wiring |
| `lib/agents/blueprints/swing-trader-research.ts` | MODIFY | HIGH | Schema, normalizer, compute, prompt, pipeline wiring |
| `lib/agents/discord.ts` | MODIFY | MEDIUM | Two embed functions extended |
| `lib/agents/prompts/small-cap.md` | MODIFY | MEDIUM | Semantic inversion + two new usage sections |
| `lib/agents/prompts/swing-trader.md` | MODIFY | LOW | Additive — two new usage sections |
| `components/trading/ResearchReportSections.tsx` | MODIFY or NO-OP | LOW | Conditional on Step 1 finding |

### Verification Steps

```
npm run lint
npx tsc --noEmit
npm run typecheck:services
npm test
```

Manual Discord checks:

1. Trigger small-cap-trader on a ticker WITH gap history — confirm embed renders formatted gap table, not a JSON blob.
2. Trigger small-cap-trader on a ticker WITH NO gap history — confirm embed shows "No historical gap data available." cleanly.
3. Trigger swing-trader — confirm gap table + financial commentary line appear.
4. Confirm `financialCommentary` rating line shows correct traffic-light emoji in both embeds.
5. Inspect a completed `reportJson` row in the DB — `gapStatsTable` must be an array of objects; `financialCommentary` must have `rating` + `explanation`.

### Acceptance Criteria

- [ ] `GapStatsRow` interface exists in `lib/agents/types.ts`
- [ ] `SmallCapResearchReport` interface includes `gapStatsTable` and `financialCommentary`
- [ ] `researchReportSchema` (small-cap) includes both new Zod fields
- [ ] `swingResearchSchema` (swing-trader) includes both new Zod fields
- [ ] `extractGapStatsTable()` exists in both blueprints and caps at 5 rows
- [ ] Gap % extracted from direct aliases first, computed from `priorClose` as fallback
- [ ] Date normalized to `YYYY-MM-DD`
- [ ] `gapStatsTable` in parsed report is always overwritten with deterministic value
- [ ] Both prompts receive gap markdown table in LLM context
- [ ] Both prompts receive `managementCommentary` text in LLM context
- [ ] `small-cap.md` uses standard traffic-light semantics (RED = high risk, GREEN = low risk)
- [ ] `swing-trader.md` semantics unchanged; only additive usage instructions added
- [ ] `buildResearchEmbed()` renders gap table block and `financialCommentary` rating line
- [ ] `buildSwingSetupEmbed()` renders gap table block and `financialCommentary` rating line
- [ ] Empty `gapStatsTable` renders "No historical gap data available." in Discord
- [ ] `npm run lint` passes
- [ ] `npx tsc --noEmit` passes
- [ ] `npm test` passes

---

## Validation Snapshot

Most recent validation (`2026-04-16`, post-commit `bf13567`):

- `npm run lint` — passed
- `npx tsc --noEmit` — passed
- `npm test` — passed (`48` files, `378` tests)
- `npm run workflow:audit` — passed

## Recently Completed

### Agent Hardening #3 — Memory / Retention TTL-on-Read

- `lib/agents/memory.ts` now filters expired memory rows on read and applies category-based default TTLs when callers omit `expiresAt`.
- `lib/agents/context.ts` now limits conversation history to the last 30 days and narrows chat context by `sessionId` when present.
- `lib/agents/blueprint-runner.ts` now threads `job.input.session_id` into `buildContext()` for chat jobs without changing non-chat behavior.
- Added `app/api/cron/agent-retention/route.ts` and a daily Vercel cron entry to purge expired `agent_memory_v2` rows and `agent_request_log` rows older than 90 days.
- Added regression coverage for TTL-on-read, default TTL resolution, session-scoped context queries, and the retention cron route.
- Preserved the existing explicit thesis expirations in the small-cap and swing-trader research blueprints.

## Follow-Up Notes

- Production check: after deploy, verify `GET /api/cron/agent-retention` returns `200` when called with the existing project `CRON_SECRET`.
- Future hardening work: the next planned item is approval gates plus real spend enforcement. Retention work is otherwise complete unless product policy changes require different TTLs or wider cleanup coverage.

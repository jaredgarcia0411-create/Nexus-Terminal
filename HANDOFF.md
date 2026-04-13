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
> Status: COMPLETE — archived, see git history for full detail

Steps 1-6 completed. Typed report contracts, assistant-turn persistence, specialist routing to Discord, deterministic TradingView expansion, swing thesis memory writes, typed Discord renderers, macro summary redesign. 45 test files, 316 tests passing at completion.

---

## Agent Response Improvement — Tier 1 (T1.1–T1.3)

> Generated: 2026-04-13
> Status: COMPLETE
> Depends on: P2 completion (done)
> Scope: 2 blueprint files changed, blueprint fixtures updated, 0 new files, 0 schema/migration changes
> Completed: 2026-04-13 — T1.1, T1.2, and T1.3 implemented with repo validation passing at 45 test files / 316 tests.

### Overview

Three targeted improvements to specialist blueprint pipelines. No schema changes. No new API routes. No new dependencies. All changes are in existing blueprint files.

| Step | ID | Description | File |
|------|------|-------------|------|
| 1 | T1.1 | Small-cap thesis memory writes | `lib/agents/blueprints/small-cap-research.ts` |
| 2 | T1.2 | Deterministic news/catalyst extraction + compact digest for small-cap | `lib/agents/blueprints/small-cap-research.ts` |
| 3 | T1.3 | Swing deterministic gap-day comparison | `lib/agents/blueprints/swing-trader-research.ts` |

### Guardrails

- No schema or migration changes.
- No new files — all changes are in existing blueprint files.
- Do not touch the LLM output schemas (`researchReportSchema`, `swingResearchSchema`) — these are report contracts, not pipeline inputs.
- Do not add new API routes or modify existing routes.
- `evidenceIds: string[]` stays flat — provenance redesign is Tier 2 work.
- `pre-market-scan`, `momentum-scan`, `pattern-check` remain stubs.
- Run `npm run lint && npx tsc --noEmit && npm test` after each step.

---

### Step 1 — T1.1: Small-Cap Thesis Memory Writes

**File:** `lib/agents/blueprints/small-cap-research.ts`

**Why:** The swing blueprint already writes a `thesis` memory row per ticker after research (keyed by ticker, 7-day TTL). The small-cap blueprint does not. Without this, the orchestrator has no memory of small-cap research — when someone asks "what did you find on MULN?" there's nothing to recall.

**1a.** Add the `upsertMemory` import. Find this line near the top of the file:

```ts
import type { Blueprint, StepResult } from '../types';
```

Add above it:

```ts
import { upsertMemory } from '../memory';
```

**1b.** In the `save-research` step's `run` function, find the `writeAndDeliverReport` call and the `return completedResult` that follows it. Between those two — after `writeAndDeliverReport` completes and before `return completedResult(...)` — insert:

```ts
await upsertMemory(db, {
  userId: job.userId,
  agentId: 'small-cap-trader',
  category: 'thesis',
  key: report.ticker,
  value: `${report.overallOfferingRisk.rating.toUpperCase()} offering risk — ${report.confidence} confidence`,
  valueJson: {
    overallOfferingRisk: report.overallOfferingRisk.rating,
    dilution: report.dilution.rating,
    cashNeed: report.cashNeed.rating,
    offeringAbility: report.offeringAbility.rating,
    confidence: report.confidence,
  },
  source: `report:${job.id}`,
  confidence: report.confidence,
  expiresAt: new Date(Date.now() + (14 * 24 * 60 * 60 * 1000)),
});
```

**Notes:**
- Uses 14-day TTL (not 7 like swing) because dilution data changes slower than price/momentum signals. Swing thesis expires faster because setups are time-sensitive.
- `upsertMemory` conflict target is `(userId, agentId, category, key)` — re-researching the same ticker overwrites the previous thesis and resets the TTL.
- `valueJson` captures the 4 most important dilution ratings plus confidence. This is what the orchestrator reads when asked about a previously researched ticker.

**Validate:** `npm run lint && npx tsc --noEmit && npm test`

---

### Step 2 — T1.2: Deterministic News Extraction + Compact Digest

**File:** `lib/agents/blueprints/small-cap-research.ts`

**Why:** The `news` array from AskEdgar is currently dumped raw into the LLM prompt — up to 20 items with full article `body` text, costing 1,000–3,000 tokens. We replace this with: (a) 6 precomputed deterministic fields, and (b) a compact headlines digest (just `title`, `filed_at`, `form_type` per item — no `body`/`summary`/`tags` blobs). The LLM still sees what happened (headlines + dates) but at a fraction of the token cost.

**AskEdgar news item fields** (snake_case from API, raw in `readResults(rawData['news'])`):
- `filed_at` — date string `"YYYY-MM-DD"` (may be null)
- `form_type` — `"news"`, `"grok"`, `"jmt415"`, or SEC form (`"8-K"`, `"S-3"`, `"424B5"`, etc.)
- `title` — article title (populated for `form_type = "news"`, empty for filings)
- `summary` — short summary
- `body` — full article text (the big token cost)
- `tags` — array of strings from a fixed taxonomy
- `document_url` — URL to original document

**2a.** Add two constant sets and the `extractNewsMetrics` helper function. Place these before `computeDeterministicAnalysis` (which starts around line 364). The function uses helpers already in the file: `isValidRecord`, `getFieldValue`, `getStringField`, `parseLooseDate`.

```ts
const FILING_CATALYST_FORM_TYPES = new Set([
  '424B5', '424B1', '424B4', '424B3', 'S-1', 'S-3', 'F-3', '8-K',
]);
const FILING_CATALYST_TAGS = new Set([
  'Offerings', 'Dilution', 'Financing Activity', 'Capital Structure', 'Cash Runway',
]);

function extractNewsMetrics(newsItems: unknown[]): {
  newsCount: number;
  mostRecentNewsDate: string | null;
  daysSinceLastNews: number | null;
  hasFilingCatalyst: boolean;
  hasJmt415Content: boolean;
  catalystCategories: string[];
} {
  const newsCount = newsItems.length;
  let latestDate: Date | null = null;
  let hasFilingCatalyst = false;
  let hasJmt415Content = false;
  const categorySet = new Set<string>();

  for (const item of newsItems) {
    if (!isValidRecord(item)) continue;

    const date = parseLooseDate(getFieldValue(item, ['filed_at', 'filedAt']));
    if (date && (latestDate === null || date > latestDate)) {
      latestDate = date;
    }

    const formType = getStringField(item, ['form_type', 'formType']);
    if (formType) {
      categorySet.add(formType);
      if (FILING_CATALYST_FORM_TYPES.has(formType.toUpperCase())) {
        hasFilingCatalyst = true;
      }
      if (formType.toLowerCase() === 'jmt415') {
        hasJmt415Content = true;
      }
    }

    const tags = Array.isArray((item as Record<string, unknown>).tags)
      ? (item as Record<string, unknown>).tags as unknown[]
      : [];
    for (const tag of tags) {
      if (typeof tag === 'string' && FILING_CATALYST_TAGS.has(tag)) {
        hasFilingCatalyst = true;
      }
    }
  }

  const mostRecentNewsDate = latestDate ? latestDate.toISOString().slice(0, 10) : null;
  const daysSinceLastNews = latestDate
    ? Math.floor((Date.now() - latestDate.getTime()) / 86400000)
    : null;

  return {
    newsCount,
    mostRecentNewsDate,
    daysSinceLastNews,
    hasFilingCatalyst,
    hasJmt415Content,
    catalystCategories: [...categorySet].sort(),
  };
}
```

**2b.** Add a `buildNewsDigest` helper function right after `extractNewsMetrics`. This produces the compact headlines array for the prompt — just `title`, `filed_at`, and `form_type` per item, no `body` or `summary`.

```ts
function buildNewsDigest(newsItems: unknown[]): { title: string; date: string; type: string }[] {
  const digest: { title: string; date: string; type: string }[] = [];

  for (const item of newsItems) {
    if (!isValidRecord(item)) continue;

    const title = getStringField(item, ['title', 'summary']) ?? '(untitled)';
    const date = getStringField(item, ['filed_at', 'filedAt']) ?? 'unknown';
    const type = getStringField(item, ['form_type', 'formType']) ?? 'unknown';
    digest.push({ title, date, type });
  }

  return digest;
}
```

**2c.** Extend `deterministicAnalysisSchema`. Find the closing of the schema (after `knownHolderOverhang: z.number().nullable()`). Add 6 new fields:

```ts
  newsCount: z.number(),
  mostRecentNewsDate: z.string().nullable(),
  daysSinceLastNews: z.number().nullable(),
  hasFilingCatalyst: z.boolean(),
  hasJmt415Content: z.boolean(),
  catalystCategories: z.array(z.string()),
```

**2d.** Extend `researchPipelineInputSchema`. Find where it's defined (it extends `priceContextSchema` with `deterministicAnalysis`). Add a new `newsDigest` field:

```ts
const researchPipelineInputSchema = priceContextSchema.extend({
  deterministicAnalysis: deterministicAnalysisSchema,
  newsDigest: z.array(z.object({
    title: z.string(),
    date: z.string(),
    type: z.string(),
  })),
});
```

**2e.** Wire extraction into `computeDeterministicAnalysis`. At the top of the function body, add:

```ts
const newsMetrics = extractNewsMetrics(asArray(input.news));
```

Then in the `return` statement, spread the news metrics after `knownHolderOverhang`:

```ts
    knownHolderOverhang,
    ...newsMetrics,
```

**2f.** Wire digest into the `compute-deterministic` step's `run` function. Currently it returns:

```ts
return completedResult({
  ...input,
  deterministicAnalysis,
}, { ... });
```

Change to:

```ts
return completedResult({
  ...input,
  deterministicAnalysis,
  newsDigest: buildNewsDigest(asArray(input.news)),
}, { ... });
```

**2g.** Update `buildResearchPrompt`. Replace the raw news line in the AskEdgar sections block:

```ts
      formatPromptSection('news', input.news),
```

Replace with:

```ts
      formatPromptSection('newsDigest (title, date, type only)', input.newsDigest),
```

**2h.** Update the jmt415 instruction line in `buildResearchPrompt`. Find:

```ts
    'For jmt415Commentary: if no jmt415-tagged news items exist in the data, set to null.',
```

Replace with:

```ts
    'For jmt415Commentary: if deterministicAnalysis.hasJmt415Content is false, set to null. If true, note the presence of JMT content based on the news digest.',
```

**Notes:**
- `buildNewsDigest` falls back to `summary` if `title` is empty (common for filing-type items where title is blank but summary describes the filing).
- `tags` field may be absent or null on filing items — the extraction guards with `Array.isArray` before iterating.
- `filed_at` is a date string (`YYYY-MM-DD`), not datetime. `parseLooseDate` handles this via `new Date("2025-02-10")`.
- The raw `news` array is still available in `input.news` on the pipeline schema (it flows through from `edgarSectionsSchema`). We're just not passing it to the LLM prompt anymore. If we need to revert, the data is still there.

**Validate:** `npm run lint && npx tsc --noEmit && npm test`

---

### Step 3 — T1.3: Swing Deterministic Gap-Day Comparison

**File:** `lib/agents/blueprints/swing-trader-research.ts`

**Why:** The swing blueprint already passes `gapStats` in `runnerQuality`, but the raw array goes straight to the LLM with no precomputed metrics. The small-cap blueprint already computes `gapCount`, `sameDayFadeRate`, `avgCloseVsOpen`, `avgHighExtension` from the same data. We add equivalent computation to swing so the LLM gets precomputed numbers instead of parsing raw JSON.

**3a.** Add a `normalizeGapRow` helper function. Place it after the existing `isValidRecord` function (around line 250), before `flattenOwnershipRecords`. This uses swing's local `getNumberField` (which already handles string cleanup — commas, percent signs):

```ts
function normalizeGapRow(value: unknown): {
  open: number;
  close: number;
  high: number;
} | null {
  if (!isValidRecord(value)) {
    return null;
  }

  const open = getNumberField(value, ['open', 'marketOpen', 'market_open']);
  const close = getNumberField(value, ['close', 'marketClose', 'market_close']);
  const high = getNumberField(value, ['high', 'intradayHigh', 'intraday_high']);

  if (open === null || close === null || high === null || open === 0) {
    return null;
  }

  return { open, close, high };
}
```

**3b.** Add a `computeGapDayStats` helper function right after `normalizeGapRow`:

```ts
function computeGapDayStats(gapStats: unknown): {
  gapCount: number;
  sameDayFadeRate: number | null;
  avgHighExtension: number | null;
  priorGapDayAvgReturn: number | null;
} {
  const gapRows = asArray(gapStats)
    .map(normalizeGapRow)
    .filter((row): row is { open: number; close: number; high: number } => row !== null);

  const gapCount = gapRows.length;
  const sameDayFadeRate = gapCount === 0
    ? null
    : gapRows.filter((row) => row.close < row.open).length / gapCount;
  const avgHighExtension = gapCount === 0
    ? null
    : gapRows.reduce((sum, row) => sum + (((row.high - row.open) / row.open) * 100), 0) / gapCount;
  const priorGapDayAvgReturn = gapCount === 0
    ? null
    : gapRows.reduce((sum, row) => sum + (((row.close - row.open) / row.open) * 100), 0) / gapCount;

  return { gapCount, sameDayFadeRate, avgHighExtension, priorGapDayAvgReturn };
}
```

**Note on naming:** Small-cap uses `avgCloseVsOpen`. Swing uses `priorGapDayAvgReturn` instead — more descriptive for a swing trader reading the report ("on historical gap days, what did this name return by close?"). The computation is identical.

**3c.** Extend `runnerQualitySchema`. Find the schema definition (starts around line 83). Add 4 new fields after `knownHolderOverhang`:

```ts
  gapCount: z.number(),
  sameDayFadeRate: z.number().nullable(),
  avgHighExtension: z.number().nullable(),
  priorGapDayAvgReturn: z.number().nullable(),
```

**3d.** Wire into `computeSwingTechnicals`. Find the `runnerQuality` object inside the return statement (starts around line 373). After the `knownHolderOverhang` line, spread the computed gap-day stats:

```ts
      knownHolderOverhang: computeKnownHolderOverhang(input.ownership),
      ...computeGapDayStats(input.gapStats),
```

**3e.** Update `buildResearchPrompt`. Find the "Runner quality" block (starts around line 474). After the `knownHolderOverhang` line, add a new section for the precomputed gap metrics:

```ts
      formatPromptSection('gapDayStats (precomputed)', {
        gapCount: input.runnerQuality.gapCount,
        sameDayFadeRate: input.runnerQuality.sameDayFadeRate,
        avgHighExtension: input.runnerQuality.avgHighExtension,
        priorGapDayAvgReturn: input.runnerQuality.priorGapDayAvgReturn,
      }),
```

**3f.** Add a prompt instruction. Find the `sections.push(...)` block that contains the JMT traffic-light instruction (around line 498). Add after the "Do NOT provide specific price levels" line:

```ts
    'Use the precomputed gapDayStats values for historical gap-day analysis. Do not recalculate from the raw gapStats array.',
```

**Notes:**
- `normalizeGapRow` is a copy of the small-cap version. Both blueprints are separate files, and per project conventions we prefer duplication over premature abstraction.
- The raw `gapStats` array is still passed in `runnerQuality` — we're not removing it, just adding precomputed metrics alongside it. The LLM can reference both.

**Validate:** `npm run lint && npx tsc --noEmit && npm test`

---

### Existing Test Coverage

These test files exercise the blueprint and discord modules and may need updates if schemas change:

- [`__tests__/agent-blueprints.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-blueprints.test.ts) — blueprint step contracts
- [`__tests__/agent-discord.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-discord.test.ts) — embed rendering

If any tests fail after step changes, update the test fixtures to match the new schema shapes (added fields in `deterministicAnalysisSchema`, `runnerQualitySchema`, `researchPipelineInputSchema`). Do not delete or skip failing tests — update them.

### Final Validation

After all three steps:

```bash
npm run lint && npx tsc --noEmit && npm test
```

All tests must pass. If the test count changes (new tests added or fixtures updated), note the new count in a checkpoint comment below.

Checkpoint 2026-04-13: complete. Validation passed with 45 test files and 316 tests.

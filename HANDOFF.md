# Nexus Terminal - HANDOFF.md

> Updated: 2026-05-07
> Purpose: compact recent context and follow-ups. Older implementation detail lives in git history and `specs/`.

> Historical completed sections were removed to keep this file focused. Use git history and the `specs/` directory for archived implementation detail.

## Active Execution Spec

### Research Report wiring + TLDR risk-ranked refactor + empty-state polish

> Generated: 2026-05-07 | Author: planning conversation (scope locked by user)
> Status: IN PROGRESS — phases 1-5 implemented and code-validated 2026-05-07; phase 6 pending
> Executor: Codex

#### Goal

Three things in one bundle:

1. **Empty state** — when the Research tab has no ticker selected, render a centered gray message instead of a blank pane.
2. **TLDR refactor (Variation B)** — replace the 3-section TLDR (executive summary box, Key Findings, Watch For & Risks) with a single risk-ranked bullet list rendered under the existing "TLDR" heading. Max 10 bullets, ordered highest-impact first. Drop the action-steps and risks fields from the API response shape entirely.
3. **Research Report endpoint + panel** — wire the existing small-cap-research agent prompt into a site-only API route so users can generate the full structured JMT-style report on-demand from the Research tab. Reuse the agent's prompt files (no duplication). Use the agent's `BACKGROUND_LLM_API_KEY` (paid Groq) so the report endpoint stays separate from the TLDR endpoint, which keeps using the free `LLM_API_KEY`. Cache the latest result in the existing `research_reports` table.

#### Locked decisions

- **TLDR shape**: `{ findings: string[]; historicalContext: string | null }`. No `tldr`, no `actionSteps`, no `risks`. Findings are pre-ranked by the LLM (highest-impact first) and may use bold prefixes like `**High Risk:**` / `**Watch:**` for the top tier.
- **Research Report section heading**: rename "Research Reports" → "Research Report" (singular). Heading uses `text-base font-semibold text-zinc-200` to match the TLDR and Dilution Rating titles.
- **Auto-generate with 16h shared cache, no UI buttons**: report fires automatically on ticker change. Cache is global per ticker (not per user) — the first user of the day generates it, everyone else reuses. TTL = 16 hours from `generatedAt`. After 16h, the next view auto-regenerates. No "Generate" button, no "Regenerate" button.
- **API key strategy**: the new report route imports `callLlm` from `lib/agents/llm-client.ts` with `lane: 'background'` — this resolves `BACKGROUND_LLM_API_KEY` (paid). The TLDR keeps using `lib/llm-client.ts` which reads `LLM_API_KEY` (free). No new env vars; both are already configured for the agent platform.
- **Prompt source of truth**: the agent's prompt files (`lib/agents/prompts/{global-policy,jmt-report-format,small-cap}.md`) and the agent's `buildResearchPrompt` are exported and reused. Site does not own a parallel prompt copy. When you tune the agent prompt, the site report stays in sync.
- **Output schema**: same `researchReportSchema` (Zod) as the agent — same JSON shape, same fields, same ratings semantics.
- **No Discord, no memory write, no agent platform integration**: site endpoint only runs the LLM step and persists to `research_reports`. It does not write to `agent_reports`, does not call `writeAndDeliverReport`, does not call `upsertMemory`.
- **Agent blueprint stays untouched at runtime**: we only export helpers from `lib/agents/blueprints/small-cap-research.ts`. The Discord/orchestrator pipeline is unchanged.

#### Phase order (top-down execution)

Phases 1 → 6 as ordered. Each phase runs `npm run lint && npx tsc --noEmit` before moving on. Phase 5 depends on Phase 3 + 4. Phase 6 is final validation only.

Checkpoint 2026-05-07 after Phase 2: `npm run lint`, `npx tsc --noEmit`, `npx vitest run __tests__/research-tab.test.tsx __tests__/askedgar-tldr-route.test.ts`, and `npm test` passed. Manual dev-server smoke remains unchecked.

Checkpoint 2026-05-07 after Phase 5: `npm run lint`, `npx tsc --noEmit`, `npm run typecheck:services`, `npx vitest run __tests__/research-report-route.test.ts __tests__/agent-blueprints.test.ts`, and `npm test` passed. Phase 6 final/manual smoke remains pending.

Phase 3-5 implementation notes: `generateSmallCapResearchReport` keeps the blueprint's live `dilutionDetails` cash-position fallback and uses the existing top-level `callLlm(..., 'background')`. The site route calls `ensureUser()` before inserting into `research_reports` to satisfy the user foreign key; GET cache reads remain global per ticker.

---

#### Phase 1 — Empty-state placeholder copy

**Goal:** Show a friendly hint when no ticker is selected.

**File:** `components/trading/ResearchTab.tsx`
**Action:** MODIFY

1. Locate the empty-state branch (currently `<div className="flex h-full items-center justify-center" />` around line 76).
2. Replace it with:
   ```tsx
   <div className="flex h-full items-center justify-center text-sm text-zinc-500">
     Search a Ticker or Select One From The Scanner in Dashboard
   </div>
   ```
3. No other changes in this file.

**Validation:**
- [x] `npm run lint && npx tsc --noEmit` pass.
- [ ] Open Research tab with no ticker → centered gray message visible.
- [ ] Type a ticker, press Enter → message disappears, snapshot loads.

---

#### Phase 2 — TLDR Variation B refactor

**Goal:** Replace the 3-section TLDR with a single risk-ranked bullet list under the existing "TLDR" heading. Drop unused fields end-to-end.

##### 2a. Update the LLM prompt + return shape

**File:** `lib/research.ts`
**Action:** MODIFY

1. Update the `ResearchTldr` interface (currently around lines 9-15) to:
   ```ts
   export interface ResearchTldr {
     findings: string[];
     historicalContext: string | null;
   }
   ```
   Remove the `tldr`, `actionSteps`, and `risks` fields.

2. Replace the prompt body inside `buildResearchTldrPrompt` (currently around lines 38-74). Keep the function signature the same. New body:
   ```ts
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
     "findings": ["bullet 1", "bullet 2", ...],
     "historicalContext": "1-2 sentences on how the risk profile has evolved, or null if no history"
   }

   RULES:
   - findings: maximum 10 bullets, ranked from highest dilution-trigger risk first to lowest at the bottom.
   - For the top bullets that represent imminent dilution risk, prefix with "**High Risk:**" (in bold markdown).
   - For the next tier of cautionary items (warrants near strike, recent offering pattern, compliance watch), prefix with "**Watch:**".
   - Below those, write plain factual bullets (cash on hand, share count growth, recent offering price, insider ownership, etc.) without prefixes.
   - Be specific with numbers (prices, dates, percentages, share counts) when available.
   - Never fabricate data. Use null or omit a bullet if the underlying field is missing.
   - JSON only, no explanation, no markdown fences.

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

3. Update `runResearchTldr` (currently around lines 213-246). Remove the `tldr`, `actionSteps`, and `risks` derivation; return the narrowed shape:
   ```ts
   export async function runResearchTldr(
     rawData: Record<string, AskEdgarResponse<unknown>>,
     ticker: string,
     context?: { historicalSummary?: unknown; discordReport?: { date: string; text: string } },
   ): Promise<ResearchTldr> {
     const trimmed = trimRawDataForLlm(rawData);
     const userPrompt = buildResearchTldrPrompt(trimmed, {
       ticker,
       historicalSummary: context?.historicalSummary,
       discordReport: context?.discordReport,
     });
     const reply = await callLlm(
       'You are a financial analyst specializing in small-cap dilution risk assessment. Return JSON only.',
       userPrompt,
     );

     const parsed = parseJson(reply.content);
     const parsedObj = isObject(parsed) ? parsed : {};

     const toStringArray = (val: unknown) =>
       Array.isArray(val) ? val.filter((item): item is string => typeof item === 'string') : [];

     return {
       findings: toStringArray(parsedObj.findings).slice(0, 10),
       historicalContext: typeof parsedObj.historicalContext === 'string' ? parsedObj.historicalContext : null,
     };
   }
   ```

4. The `_ticker` parameter was previously used in the failure message; now unused. Drop nothing — leave `ticker` in the signature since the prompt still uses it.

**Note for Codex:** the change drops the `tldr` fallback string. If the LLM fails entirely, the route's `try/catch` in `app/api/askedgar/tldr/route.ts` already returns a 500. Don't add a fallback string.

##### 2b. Update the API response handling

**File:** `app/api/askedgar/tldr/route.ts`
**Action:** No changes required. The route does `...result` over whatever `runResearchTldr` returns; the shape just narrowed. Confirm by reading the route — no edits.

##### 2c. Update the TLDR component

**File:** `components/trading/ResearchTldr.tsx`
**Action:** MODIFY

1. Update the `TldrResponse` interface to drop `tldr`, `actionSteps`, `risks`:
   ```ts
   interface TldrResponse {
     ticker: string;
     findings: string[];
     historicalContext?: string | null;
     hasHistoricalData?: boolean;
     generatedAt: string;
   }
   ```

2. Replace the rendered output (the `return` block when `data` is non-null, currently around lines 87-118) with:
   ```tsx
   return (
     <div>
       <h4 className="mb-2 text-base font-semibold text-zinc-200">TLDR</h4>
       <ul className="space-y-1">
         {data.findings.map((item, i) => (
           <li key={i} className="text-sm text-zinc-300">• {item}</li>
         ))}
       </ul>
     </div>
   );
   ```
   Remove the green-bordered TLDR box (the `<div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">` wrapper around the old `data.tldr` paragraph), the "Key Findings" sub-heading, the "Watch For & Risks" section, and the `watchAndRisks` constant. The single `<ul>` is the entire body — no border, no green styling, no boxed background anywhere on the TLDR.

3. Bullets that arrive with leading `**High Risk:**` or `**Watch:**` markdown will render with the literal asterisks. For a v1 ship that's acceptable — the bold markers still convey priority visually. Defer styled rendering of the bold prefixes (would need a tiny markdown-to-jsx pass) unless the user calls it out after smoke testing.

4. The loading and error states (currently lines 65-83) keep their existing TLDR header (`<h4 className="mb-2 text-base font-semibold text-zinc-200">TLDR</h4>`). No change.

##### 2d. Update `__tests__/research-tab.test.tsx` if it asserts on the dropped fields

**File:** `__tests__/research-tab.test.tsx`
**Action:** READ + MODIFY only if needed

1. Read the test file. If it asserts on `tldr`, `actionSteps`, or `risks` strings in the rendered TLDR output, update those assertions to look for `findings` content instead. If it does not exercise TLDR rendering, leave alone.

**Validation:**
- [x] `npm run lint && npx tsc --noEmit` pass.
- [x] `npx vitest run __tests__/research-tab.test.tsx` passes.
- [ ] Smoke a ticker in dev server: TLDR renders one bulleted list under the "TLDR" heading. No green box, no "Key Findings" header, no "Watch For & Risks" header.
- [ ] Bullets at the top read like `**High Risk:** Cash runway 6 months + $42M ATM live`. Bullets at the bottom are plain factual.

---

#### Phase 3 — Export reusable helpers from the small-cap-research blueprint

**Goal:** Expose the agent's prompt assembly + analysis pipeline so the site's report endpoint can reuse them without duplicating prompts. Do NOT modify the agent's blueprint runtime — only add `export` keywords and one new exported function.

**File:** `lib/agents/blueprints/small-cap-research.ts`
**Action:** MODIFY

1. Add `export` to these existing declarations (file is ~993 lines; line numbers below are approximate from the 2026-05-07 snapshot — search by name if line numbers drift):

   - `const researchTickerInputSchema = ...` (~line 26) — add `export`
   - `const edgarSectionsSchema = ...` (~line 34) — add `export`
   - `const priceContextSchema = ...` (~line 54) — add `export`
   - `const researchPipelineInputSchema = ...` (~line 93) — add `export`
   - `const researchReportSchema = ...` (~line 116) — add `export`
   - `function parseJson(...)` (~line 174) — add `export`
   - `function readResults(...)` (~line 187) — add `export`
   - `function getStringField(...)` (~line 247) — add `export`
   - `function computeDeterministicAnalysis(...)` (~line 537) — add `export`
   - `async function fetchTradingViewPriceContext(...)` (~line 665) — add `export`
   - `function buildResearchPrompt(...)` (~line 725) — add `export`
   - `async function loadSmallCapSystemPrompt()` (~line 791) — add `export`

   **None of the existing call sites change** — they're internal references that work the same whether the symbol is exported or not.

2. Add a new exported function near the bottom of the file, immediately BEFORE `export const smallCapResearchBlueprint: Blueprint = {`:

   ```ts
   /**
    * Generate a small-cap research report for a single ticker.
    * Reuses the agent's prompt + analysis pipeline but skips Discord delivery and memory persistence —
    * intended for the Research tab's site-only API route. Uses the BACKGROUND_LLM_API_KEY (paid lane).
    */
   export async function generateSmallCapResearchReport(
     ticker: string,
   ): Promise<z.infer<typeof researchReportSchema>> {
     const normalized = ticker.trim().toUpperCase();
     researchTickerInputSchema.parse({ ticker: normalized });

     // 1. Fetch AskEdgar data (cached helper).
     const askEdgarResult = await getCachedTickerData(normalized, { scope: 'small-cap-research' });
     const rawData = askEdgarResult.rawData as Record<string, unknown>;
     const dilutionRatingFirst = readResults(rawData['dilution-rating'])[0] ?? null;
     const cashPosition = readResults(rawData['dilution-data'])[0]
       ?? readResults(rawData['screener'])[0]
       ?? null;
     const managementCommentary =
       getStringField(dilutionRatingFirst, ['mgmt_commentary', 'managementCommentary', 'commentary'])
       ?? getStringField(cashPosition, ['managementCommentary', 'management_commentary']);

     const edgarSections = edgarSectionsSchema.parse({
       ticker: normalized,
       gapStats: readResults(rawData['gap-stats']),
       offerings: readResults(rawData['offerings']),
       registrations: readResults(rawData['registrations']),
       equityLines: readResults(rawData['equity-lines']),
       dilutionRating: dilutionRatingFirst,
       dilutionData: readResults(rawData['dilution-data']),
       ownership: readResults(rawData['ownership']),
       historicalFloat: readResults(rawData['historical-float-pro']),
       reverseSplits: readResults(rawData['reverse-splits']),
       splitStatus: readResults(rawData['split-status']),
       agreements: readResults(rawData['agreements']),
       nasdaqCompliance: readResults(rawData['nasdaq-compliance'])[0] ?? null,
       news: readResults(rawData['news']),
       filingTitles: readResults(rawData['filing-titles']),
       cashPosition,
       managementCommentary,
     });

     // 2. Add price context.
     const priceContext = await fetchTradingViewPriceContext(normalized);
     const withPriceContext = priceContextSchema.parse({ ...edgarSections, priceContext });

     // 3. Compute deterministic analysis + news feed.
     const { gapStatsTable, ...deterministicAnalysis } = computeDeterministicAnalysis(withPriceContext);
     const newsFeed = buildNewsFeedFromArrays(
       Array.isArray(withPriceContext.news) ? withPriceContext.news : [],
       Array.isArray(withPriceContext.filingTitles) ? withPriceContext.filingTitles : [],
       { maxItems: 10, maxAgeDays: 30 },
     );
     const pipelineInput = researchPipelineInputSchema.parse({
       ...withPriceContext,
       deterministicAnalysis,
       gapStatsTable,
       newsFeed,
     });

     // 4. Call LLM via agent's background lane (paid Groq key).
     const { callLlm: callAgentLlm } = await import('../llm-client');
     const llmResponse = await callAgentLlm({
       systemPrompt: await loadSmallCapSystemPrompt(),
       userMessage: buildResearchPrompt(pipelineInput),
       temperature: 0.2,
     }, 'background');

     // 5. Parse + apply the same post-LLM commentary override the blueprint uses.
     const parsed = researchReportSchema.parse(parseJson(llmResponse.content));
     parsed.gapStatsTable = pipelineInput.gapStatsTable;

     const verbatimCommentary = pipelineInput.managementCommentary?.trim();
     if (verbatimCommentary) {
       parsed.financialCommentary = {
         ...parsed.financialCommentary,
         explanation: verbatimCommentary,
         source: 'verbatim',
       };
     } else {
       parsed.financialCommentary.source = 'llm';
     }

     return parsed;
   }
   ```

3. **Do not modify** the existing blueprint steps. The `synthesize-report` step continues to inline its own LLM call. We're not refactoring it to call `generateSmallCapResearchReport` — that's a follow-up if the team wants DRY later.

**Validation:**
- [x] `npm run lint && npx tsc --noEmit` pass.
- [x] `npm run typecheck:services` passes (this file is touched and may be referenced from `services/agent-entrypoint.ts`).
- [x] No runtime change to the agent platform — the synthesize-report step still uses its existing inline call.

---

#### Phase 4 — Research Report API route

**Goal:** Site-only endpoint that generates and caches the structured small-cap research report per (user, ticker).

**File:** `app/api/research-report/route.ts`
**Action:** CREATE

1. Create the route file. Pattern mirrors `app/api/askedgar/tldr/route.ts`. Cache is **global per ticker** (not per user) — `requireUser()` still gates the endpoint for auth, but the freshness lookup ignores `userId` so the first user to generate a report on a given ticker satisfies everyone for the next 16 hours.

   ```ts
   import { and, desc, eq, gte } from 'drizzle-orm';
   import { z } from 'zod';

   import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
   import { getDb } from '@/lib/db';
   import { researchReports } from '@/lib/db/schema';
   import { generateSmallCapResearchReport } from '@/lib/agents/blueprints/small-cap-research';
   import { dbUnavailable, requireUser } from '@/lib/server-db-utils';

   export const dynamic = 'force-dynamic';
   export const maxDuration = 60;

   const tickerPattern = /^[A-Z0-9.\-^]{1,10}$/;
   // Reuse the same row across users for 16 hours — typical small-cap dilution data
   // doesn't shift meaningfully within a single trading session, and we want one LLM
   // call per ticker per ~day across the whole team.
   const CACHE_TTL_HOURS = 16;

   const postSchema = z.object({
     ticker: z.string().trim().toUpperCase().regex(tickerPattern, 'Valid ticker required'),
   });

   export async function GET(request: Request) {
     const authState = await requireUser();
     if ('error' in authState) return authState.error;

     const db = getDb();
     if (!db) return dbUnavailable();

     const url = new URL(request.url);
     const ticker = url.searchParams.get('ticker')?.trim().toUpperCase() ?? '';
     if (!tickerPattern.test(ticker)) {
       return Response.json({ error: 'Valid ticker required' }, { status: 400 });
     }

     try {
       const freshSince = new Date(Date.now() - CACHE_TTL_HOURS * 60 * 60 * 1000);
       const [latest] = await db
         .select({
           reportJson: researchReports.reportJson,
           generatedAt: researchReports.generatedAt,
           modelUsed: researchReports.modelUsed,
         })
         .from(researchReports)
         .where(and(
           eq(researchReports.ticker, ticker),
           gte(researchReports.generatedAt, freshSince),
         ))
         .orderBy(desc(researchReports.generatedAt))
         .limit(1);

       // Only return rows with a structured report_json — early-day rows seeded by
       // fetchAndCacheRawReport() leave reportJson null. Treat those as "no fresh report".
       if (latest?.reportJson) {
         return Response.json({
           ticker,
           report: latest.reportJson,
           generatedAt: latest.generatedAt?.toISOString() ?? null,
           modelUsed: latest.modelUsed,
           cached: true,
         });
       }

       return Response.json({ ticker, report: null, cached: false });
     } catch (error) {
       logRouteError('research-report:get', error);
       return internalServerError();
     }
   }

   export async function POST(request: Request) {
     const authState = await requireUser();
     if ('error' in authState) return authState.error;

     const db = getDb();
     if (!db) return dbUnavailable();

     const bodyState = await parseAndValidate(request, postSchema);
     if (bodyState.error) return bodyState.error;
     const { ticker } = bodyState.data;

     try {
       const report = await generateSmallCapResearchReport(ticker);
       const generatedAt = new Date();

       // Audit trail: store who triggered the generation. The GET above ignores userId
       // for cache reads so the row still satisfies the team-wide 16h cache window.
       await db.insert(researchReports).values({
         id: crypto.randomUUID(),
         userId: authState.user.id,
         ticker,
         status: 'complete',
         rawData: null,
         reportJson: report,
         modelUsed: 'small-cap-research',
         generatedAt,
       });

       return Response.json({
         ticker,
         report,
         generatedAt: generatedAt.toISOString(),
         cached: false,
       });
     } catch (error) {
       logRouteError('research-report:post', error);
       return internalServerError();
     }
   }
   ```

2. **Auth model:** `requireUser()` per the project's user-scoped route convention. The cache itself is global; auth just keeps anonymous callers out.

3. **Body validation:** `parseAndValidate(request, postSchema)` with Zod. `tickerPattern` matches the validation used elsewhere in the codebase.

4. **maxDuration = 60** matches the agent's synthesize-report step timeout.

5. **No new env vars.** `generateSmallCapResearchReport` reaches into `lib/agents/llm-client.ts` which calls `getBackgroundLlmConfig()` and reads `BACKGROUND_LLM_API_KEY`. That env var is already in use by the agent platform.

**Validation:**
- [x] `npm run lint && npx tsc --noEmit` pass.
- [ ] Manual: `curl -X POST http://localhost:3000/api/research-report -H 'Content-Type: application/json' --cookie '<auth>' -d '{"ticker":"<a known small-cap with rich data>"}'` returns a structured JSON with `report.overallOfferingRisk.rating` populated.
- [ ] `curl http://localhost:3000/api/research-report?ticker=<same ticker>` returns `cached: true` and the same report.
- [ ] Manually fast-forward by editing the row's `generated_at` to >16h ago in the DB → next GET returns `report: null` (cache miss).

---

#### Phase 5 — Research Report frontend panel

##### 5a. Rename heading

**File:** `components/trading/ResearchReportSections.tsx`
**Action:** MODIFY

1. Find the Overview-tab block that currently renders the Research Reports placeholder (around lines 601-606 in the 2026-05-07 snapshot — search for `"Research Reports Coming Soon"` if line numbers drift).
2. Change the `<h4>` text from "Research Reports" to "Research Report" (singular, no `s`).
3. The `<h4>` className must be `text-base font-semibold text-zinc-200` to match the TLDR and Dilution Rating titles. Update if the existing className is `text-sm`.

##### 5b. Build the panel component

**File:** `components/trading/ResearchReportPanel.tsx`
**Action:** CREATE

1. Create a new client component. Behavior (matches the auto-TLDR pattern — no buttons):
   - Mounts → GETs `/api/research-report?ticker=<ticker>`.
   - If GET returns `report: null` (no fresh row in the 16h window) → automatically POST `/api/research-report` to generate one. Show a "Generating Research Report…" placeholder while the POST is pending (15-30s expected).
   - If GET returns a `report` (cache hit) → render it instantly. No second call.
   - On any error → render the error message in place of the report.
   - Use an `AbortController` to cancel both the GET and POST when `ticker` changes mid-flight, the same way `ResearchTldr.tsx` does.
   - There is **no Generate button, no Regenerate button**. Cache invalidation is purely time-based (16h server-side TTL).

2. Use the agent's traffic-light vocabulary (`green` / `yellow` / `red`). Map ratings to the same translucent pill style used by `DilutionRatingPanel` (`bg-emerald-500/15 text-emerald-300`, `bg-amber-500/15 text-amber-300`, `bg-rose-500/15 text-rose-300`).

3. Render structure (one section per top-level field of `researchReportSchema`):

   ```tsx
   'use client';

   import { useEffect, useRef, useState } from 'react';

   // The structural shape of the agent's research report. Mirrors researchReportSchema
   // from lib/agents/blueprints/small-cap-research.ts. Kept as a local type instead of
   // importing the Zod-inferred type so this client component doesn't pull the agent
   // module into the browser bundle.
   type Rating = 'green' | 'yellow' | 'red';
   interface RatedSection { rating: Rating; explanation: string }
   interface RatedCatalyst { catalyst: string; rating: Rating }
   interface ResearchReport {
     ticker: string;
     newsWhyRunning: RatedSection;
     themeMatch: RatedSection;
     otherCatalysts: RatedCatalyst[];
     chartHistory: RatedSection;
     dilution: RatedSection;
     offeringFrequency: RatedSection;
     offeringAbility: RatedSection;
     cashNeed: RatedSection;
     overallOfferingRisk: RatedSection;
     jmt415Commentary: string | null;
     gapStatsTable: Array<{ date: string; gapPct: number; open: number; close: number }>;
     financialCommentary: { rating: Rating; explanation: string; source: 'verbatim' | 'llm' };
     confidence: 'high' | 'medium' | 'low';
     evidenceIds: string[];
   }

   interface ApiResponse {
     ticker: string;
     report: ResearchReport | null;
     generatedAt: string | null;
     cached: boolean;
     modelUsed?: string | null;
   }

   function pillClass(rating: Rating): string {
     if (rating === 'red') return 'bg-rose-500/15 text-rose-300';
     if (rating === 'yellow') return 'bg-amber-500/15 text-amber-300';
     return 'bg-emerald-500/15 text-emerald-300';
   }

   function RatedRow({ label, section }: { label: string; section: RatedSection }) {
     return (
       <div className="space-y-1">
         <div className="flex items-center justify-between gap-2">
           <span className="text-sm font-semibold text-zinc-200">{label}</span>
           <span className={`rounded px-2 py-0.5 text-xs font-medium uppercase ${pillClass(section.rating)}`}>
             {section.rating}
           </span>
         </div>
         <p className="text-sm text-zinc-300">{section.explanation}</p>
       </div>
     );
   }

   interface Props { ticker: string }

   // Module-level cache mirrors the auto-TLDR's pattern — keyed by ticker, persists across remounts
   // within a session so flipping between tickers doesn't refetch immediately.
   const reportCache = new Map<string, { report: ResearchReport; generatedAt: string | null }>();

   export default function ResearchReportPanel({ ticker }: Props) {
     const cached = reportCache.get(ticker);
     const [report, setReport] = useState<ResearchReport | null>(cached?.report ?? null);
     const [generatedAt, setGeneratedAt] = useState<string | null>(cached?.generatedAt ?? null);
     const [status, setStatus] = useState<'idle' | 'loading' | 'generating'>(cached ? 'idle' : 'loading');
     const [error, setError] = useState<string | null>(null);
     const abortRef = useRef<AbortController | null>(null);

     useEffect(() => {
       if (!ticker) return;

       // Session cache hit — no network round-trip.
       const hit = reportCache.get(ticker);
       if (hit) {
         setReport(hit.report);
         setGeneratedAt(hit.generatedAt);
         setStatus('idle');
         setError(null);
         return;
       }

       abortRef.current?.abort();
       const controller = new AbortController();
       abortRef.current = controller;
       setStatus('loading');
       setError(null);
       setReport(null);
       setGeneratedAt(null);

       (async () => {
         try {
           // 1. Probe the server cache.
           const getRes = await fetch(
             `/api/research-report?ticker=${encodeURIComponent(ticker)}`,
             { signal: controller.signal },
           );
           if (!getRes.ok) throw new Error(`Lookup failed: ${getRes.status}`);
           const getPayload = (await getRes.json()) as ApiResponse;

           if (getPayload.report) {
             reportCache.set(ticker, { report: getPayload.report, generatedAt: getPayload.generatedAt });
             setReport(getPayload.report);
             setGeneratedAt(getPayload.generatedAt);
             setStatus('idle');
             return;
           }

           // 2. No fresh row in the 16h window — auto-generate.
           setStatus('generating');
           const postRes = await fetch('/api/research-report', {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({ ticker }),
             signal: controller.signal,
           });
           if (!postRes.ok) throw new Error(`Generation failed: ${postRes.status}`);
           const postPayload = (await postRes.json()) as ApiResponse;
           if (postPayload.report) {
             reportCache.set(ticker, { report: postPayload.report, generatedAt: postPayload.generatedAt });
             setReport(postPayload.report);
             setGeneratedAt(postPayload.generatedAt);
           }
           setStatus('idle');
         } catch (err) {
           if (err instanceof Error && err.name === 'AbortError') return;
           setError(err instanceof Error ? err.message : 'Report unavailable');
           setStatus('idle');
         }
       })();

       return () => { controller.abort(); };
     }, [ticker]);

     if (status === 'loading') {
       return <div className="rounded border border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-zinc-500">Loading report…</div>;
     }

     if (status === 'generating') {
       return <div className="rounded border border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-zinc-500">Generating Research Report…</div>;
     }

     if (error) {
       return <div className="rounded border border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-rose-400">{error}</div>;
     }

     if (!report) {
       return null;
     }

     return (
       <div className="space-y-4 rounded border border-white/10 bg-white/5 p-4">
         <div className="flex items-center justify-between gap-2">
           <span className="flex items-center gap-2">
             <span className="text-xs uppercase tracking-wide text-zinc-500">Confidence</span>
             <span className="rounded bg-zinc-700/40 px-2 py-0.5 text-xs font-medium uppercase text-zinc-200">{report.confidence}</span>
           </span>
           {generatedAt ? <span className="text-xs text-zinc-500">{new Date(generatedAt).toLocaleString()}</span> : null}
         </div>

         <RatedRow label="Overall Offering Risk" section={report.overallOfferingRisk} />
         <RatedRow label="News / Why It's Running" section={report.newsWhyRunning} />
         <RatedRow label="Theme Match" section={report.themeMatch} />
         <RatedRow label="Chart History" section={report.chartHistory} />
         <RatedRow label="Dilution" section={report.dilution} />
         <RatedRow label="Offering Frequency" section={report.offeringFrequency} />
         <RatedRow label="Offering Ability" section={report.offeringAbility} />
         <RatedRow label="Cash Need" section={report.cashNeed} />

         {report.otherCatalysts.length > 0 ? (
           <div>
             <h5 className="mb-1 text-sm font-semibold text-zinc-200">Other Catalysts</h5>
             <ul className="space-y-1">
               {report.otherCatalysts.map((c, i) => (
                 <li key={i} className="flex items-center justify-between gap-2">
                   <span className="text-sm text-zinc-300">{c.catalyst}</span>
                   <span className={`rounded px-2 py-0.5 text-xs font-medium uppercase ${pillClass(c.rating)}`}>{c.rating}</span>
                 </li>
               ))}
             </ul>
           </div>
         ) : null}

         <div>
           <div className="flex items-center justify-between gap-2">
             <h5 className="text-sm font-semibold text-zinc-200">Financial Commentary</h5>
             <span className={`rounded px-2 py-0.5 text-xs font-medium uppercase ${pillClass(report.financialCommentary.rating)}`}>{report.financialCommentary.rating}</span>
           </div>
           <p className="mt-1 text-sm text-zinc-300">
             {report.financialCommentary.explanation}
             {report.financialCommentary.source === 'verbatim' ? <span className="ml-1 text-xs text-zinc-500">(verbatim from filings)</span> : null}
           </p>
         </div>

         {report.jmt415Commentary ? (
           <div>
             <h5 className="mb-1 text-sm font-semibold text-zinc-200">JMT415 Commentary</h5>
             <p className="text-sm text-zinc-300">{report.jmt415Commentary}</p>
           </div>
         ) : null}

         {report.evidenceIds.length > 0 ? (
           <p className="text-xs text-zinc-500">Evidence: {report.evidenceIds.join(', ')}</p>
         ) : null}
       </div>
     );
   }
   ```

##### 5c. Mount the panel

**File:** `components/trading/ResearchReportSections.tsx`
**Action:** MODIFY

1. Add the import at the top of the file (alongside `DilutionRatingTile` and `ResearchTldr`):
   ```ts
   import ResearchReportPanel from '@/components/trading/ResearchReportPanel';
   ```

2. Inside the Overview tab block, replace the placeholder card with the panel. Title size matches TLDR + Dilution Rating (`text-base font-semibold`):
   ```tsx
   <div>
     <h4 className="mb-2 text-base font-semibold text-zinc-200">Research Report</h4>
     <ResearchReportPanel ticker={ticker} />
   </div>
   ```
   (The "Research Reports Coming Soon" copy is gone now.)

**Validation:**
- [x] `npm run lint && npx tsc --noEmit` pass.
- [ ] First open of a new ticker on Overview → "Generating Research Report…" placeholder shows for 15-30s → structured report renders with Overall Offering Risk + other rated sections + financial commentary. No buttons visible at any point.
- [ ] Reload page → report renders instantly from cache (no LLM call). Confidence + timestamp visible at top.
- [ ] Open the same ticker as a different team member → renders the cached report instantly (global 16h cache).
- [ ] Edit the row's `generated_at` to >16h ago in the DB → reload → "Generating Research Report…" placeholder shows again, then a new row gets written.

---

#### Phase 6 — Final validation

Run from repo root after all phases:

1. `npm run lint`
2. `npx tsc --noEmit`
3. `npm run typecheck:services` (touched `lib/agents/blueprints/small-cap-research.ts`)
4. `npm test`

**Manual smoke checklist:**

- [ ] Research tab with no ticker → centered gray "Search a Ticker or Select One From The Scanner in Dashboard".
- [ ] Search a ticker → snapshot loads.
- [ ] Overview: TLDR header renders one bullet list, max 10 bullets, top items use bold `**High Risk:**` / `**Watch:**` prefixes (literal asterisks acceptable for v1).
- [ ] Overview: section heading reads "Research Report" (singular). Heading uses `text-base font-semibold` and visually matches the TLDR + Dilution Rating headers on the same page.
- [ ] Overview: when no fresh row exists, "Generating Research Report…" placeholder auto-fires. No button is ever rendered.
- [ ] Once generated, structured report renders with traffic-light pills + confidence badge + timestamp.
- [ ] Reload → cached report renders instantly (no second LLM call).
- [ ] Force a stale row in the DB (set `generated_at` to >16h ago) → next page load auto-regenerates.
- [ ] TLDR header has no green border or green background. The rendered TLDR is just a heading + plain bullet list.
- [ ] No JS console errors. No TypeScript errors. No lint warnings.
- [ ] Agent platform smoke (defensive): `npx vitest run __tests__/agent-blueprints.test.ts` still passes — confirms exporting helpers didn't break the existing pipeline.

---

#### Files Changed Summary

| File | Change | Risk |
|---|---|---|
| `components/trading/ResearchTab.tsx` | Empty-state placeholder copy | Low |
| `lib/research.ts` | TLDR prompt + return shape narrows to `{ findings, historicalContext }` | Med |
| `components/trading/ResearchTldr.tsx` | Render single bullet list under TLDR header; drop tldr box + Watch/Risks section | Med |
| `__tests__/research-tab.test.tsx` | Update assertions only if they reference dropped fields | Low |
| `lib/agents/blueprints/small-cap-research.ts` | Add `export` to ~12 existing declarations + add `generateSmallCapResearchReport` helper | Med |
| `app/api/research-report/route.ts` | CREATE — GET (cached) + POST (generate) | Med |
| `components/trading/ResearchReportPanel.tsx` | CREATE — fetches/generates and renders the structured report | Med |
| `components/trading/ResearchReportSections.tsx` | Rename "Research Reports" → "Research Report"; mount `ResearchReportPanel` | Low |
| `__tests__/research-report-route.test.ts` | CREATE — route coverage for cache hit, cache miss, POST insert, and validation | Low |

#### Out of scope

- Refactoring the agent's `synthesize-report` step to call `generateSmallCapResearchReport` (DRY follow-up; keep blueprint runtime untouched for safety).
- Storing the report in `agent_reports` table or pushing to Discord.
- Markdown rendering for the `**High Risk:**` / `**Watch:**` prefixes in TLDR bullets — literal asterisks are acceptable for v1; revisit if the user calls it out after smoke testing.
- A user-triggered "Regenerate" button on the panel — auto-managed by the 16h TTL.
- A purge job for stale `research_reports` rows — DB grows slowly enough that we don't need cleanup yet.
- Agent prompt tuning — using existing prompt verbatim.
- Cleaning up `__tests__/research-snapshot-mapper.test.ts` — unaffected by this scope.

---

## Recently Completed Summary

- 2026-05-07: Research tab refresh shipped (8 → 5 tabs, Dilution rewrite, auto-TLDR, Overview rebuild, conditional chart). Then Dilution Rating + chart-less header polish (large 6-tile panel above Offering Risks, compact header on chart-less tabs, swap of TLDR/Dilution Rating positions on Overview, TLDR h4 added). Then `overall_offering_risk` mapped from AskEdgar dilution-rating endpoint (was hardcoded null), Overview titles bumped to `text-base`, Research tab restructured so only the inner sections scroll (sub-nav + chart row pinned, outer scrollbar removed). Validated each step with `npm run lint`, `npx tsc --noEmit`, vitest research suites.
- 2026-05-05: Dashboard scanner completion — split PM/AH gainers scan with combined volume gating, MDR scanner with `mdr_triggers` table + nightly cron + dashboard merging of live and recent rows. Threshold values render as prices/percentages.
- 2026-05-04: Backtesting UI refinements plus grid layout and sample-set sidebar (`b03fa38`, `82bfa46`, `10e1071`, `82cca14`, `36a410b`).
- 2026-05-03: Backtesting chart drawing/indicator persistence and review save-flow fixes (`82cbb55`, `88a4da4`, `6513e40`).
- 2026-05-01: Backtest Manager landing page shipped: schema, API, manager, stats views.

## Open Follow-Ups Carried Forward

- AskEdgar Sprint 3 Part B (`split-status`) remains parked pending endpoint-usage audit.
- Endpoint review still pending: `screener`, `ownership`, `nasdaq-compliance`, `historical-float-pro`, and `float-outstanding`.
- Filings v2/v3 remain deferred: in-app SEC filing viewer, then full-text filing search plus AI Copilot after cost analysis.
- Auto stop-out for Backtesting remains deferred until requested.
- Backtest Manager `broke_premarket_high` filter remains deferred. Data is not captured today; revisit once we decide whether to store it on the session at save time or derive from market data on stats load.
- Research tab company description: deferred to a v2 pass. Pick a source (Polygon `/v3/reference/tickers` returns a usable description) before wiring.

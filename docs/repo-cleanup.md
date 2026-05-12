# Repo Cleanup Audit

Date: 2026-05-11

Read-only audit summary for codebase cleanup, feature pruning, workflow drift, and harness skill alignment. No files were changed during the audit.

## Recommended Review Order

1. Decide product removals first, especially whether Discord-imported research history still belongs in the Research/TLDR path.
2. Fix cost and idempotency risks around AskEdgar, scanners, and paid Research Report generation.
3. Remove high-confidence dead code and unused dependencies.
4. Decide whether backend-only feature surfaces are parked, planned, or removable.
5. Clean workflow/docs drift.
6. Sync and align Codex harness skills.
7. Decompose oversized modules only when touching those areas for feature or bug work.
8. Improve personal workflow gates with scripts and shorter post-validation handoffs.

## Product Decisions

### Discord Research Import Stack

Status: Product decision required.

Evidence:
- `HANDOFF.md` locks the site Research Report endpoint to no Discord, no memory write, and no agent-platform integration: [HANDOFF.md](/home/jared/Nexus-Terminal/HANDOFF.md:32).
- TLDR still reads imported Discord context and historical summaries: [app/api/askedgar/tldr/route.ts](/home/jared/Nexus-Terminal/app/api/askedgar/tldr/route.ts:30).
- Discord import/sync routes remain live: [app/api/discord/import/route.ts](/home/jared/Nexus-Terminal/app/api/discord/import/route.ts:13), [app/api/discord/sync/route.ts](/home/jared/Nexus-Terminal/app/api/discord/sync/route.ts:13), [app/api/discord/cron/sync/route.ts](/home/jared/Nexus-Terminal/app/api/discord/cron/sync/route.ts:12).
- The cron is scheduled in [vercel.json](/home/jared/Nexus-Terminal/vercel.json:2).
- Parser/client helpers live at [lib/discord/parser.ts](/home/jared/Nexus-Terminal/lib/discord/parser.ts:1) and [lib/discord/client.ts](/home/jared/Nexus-Terminal/lib/discord/client.ts:1).
- Tables are defined at [lib/db/schema.ts](/home/jared/Nexus-Terminal/lib/db/schema.ts:139) and [lib/db/schema.ts](/home/jared/Nexus-Terminal/lib/db/schema.ts:155).

Recommendation:
Decide whether TLDR still benefits from Discord historical context. If not, remove the import stack as one planned cleanup: routes, parser/client import helpers, cron entry, tests, TLDR context queries, and eventually the two DB tables via migration.

Do not remove [lib/agents/discord.ts](/home/jared/Nexus-Terminal/lib/agents/discord.ts:807) or `agent_reports` wholesale. Agent blueprints still use `writeAndDeliverReport()` as downstream Discord fan-out: [lib/agents/blueprints/small-cap-research.ts](/home/jared/Nexus-Terminal/lib/agents/blueprints/small-cap-research.ts:1038), [lib/agents/blueprints/swing-trader-research.ts](/home/jared/Nexus-Terminal/lib/agents/blueprints/swing-trader-research.ts:1038), [lib/agents/blueprints/orchestrator-macro-summary.ts](/home/jared/Nexus-Terminal/lib/agents/blueprints/orchestrator-macro-summary.ts:773).

## Cost And Reliability Risks

### AskEdgar Runtime Controls

Evidence:
- Daily unique ticker tracking, rate-limit retry state, and in-flight dedupe use module-level state: [lib/askedgar.ts](/home/jared/Nexus-Terminal/lib/askedgar.ts:76).
- Enforcement happens in `fetchTickerData`: [lib/askedgar.ts](/home/jared/Nexus-Terminal/lib/askedgar.ts:520).

Risk:
On Vercel, module memory resets on cold start and does not coordinate across instances. The daily cap and retry-window protection are advisory, not durable.

Recommendation:
Move durable daily usage, retry windows, and expensive request claims into Postgres or Redis/Upstash. Keep module-level in-flight dedupe only as a best-effort local optimization.

### Dashboard Scanner Polling

Evidence:
- Dashboard polls three endpoints every 10 seconds: [DashboardScannerTable.tsx](/home/jared/Nexus-Terminal/components/trading/DashboardScannerTable.tsx:337).
- MDR candidates call Massive-backed evaluation: [app/api/tradingview/mdr-candidates/route.ts](/home/jared/Nexus-Terminal/app/api/tradingview/mdr-candidates/route.ts:61), [lib/massive-market.ts](/home/jared/Nexus-Terminal/lib/massive-market.ts:739).
- Recent MDR rows recompute thresholds per row: [app/api/scanner/mdr-recent/route.ts](/home/jared/Nexus-Terminal/app/api/scanner/mdr-recent/route.ts:41).

Recommendation:
Create one short-TTL server aggregate endpoint for dashboard scanner data. Persist/cache MDR threshold enrichment per ticker/date so multiple viewers do not repeat the same work.

### Research Report Generation Race

Evidence:
- Client probes GET then POSTs if empty: [ResearchReportPanel.tsx](/home/jared/Nexus-Terminal/components/trading/ResearchReportPanel.tsx:116).
- POST generates and inserts without a ticker-level claim: [app/api/research-report/route.ts](/home/jared/Nexus-Terminal/app/api/research-report/route.ts:83).
- The site report LLM path does not flow through agent budget telemetry in [lib/agents/runtime-limits.ts](/home/jared/Nexus-Terminal/lib/agents/runtime-limits.ts:94).

Risk:
Two users can trigger duplicate paid report generation for the same ticker. Site-generated reports may also bypass the spend visibility used by the agent runtime.

Recommendation:
Make POST idempotent with a DB-backed fresh-row or `in_progress` claim and record site report LLM usage through the agent telemetry path.

## Dead Code And Cleanup Candidates

### High Confidence

- `fetchAndCacheRawReport()` appears unused: [lib/research.ts](/home/jared/Nexus-Terminal/lib/research.ts:135). The snapshot route uses `getCachedTickerData()` directly: [app/api/askedgar/snapshot/route.ts](/home/jared/Nexus-Terminal/app/api/askedgar/snapshot/route.ts:25).
- `ResearchGainersList` appears unused by the current Research tab: [components/trading/ResearchGainersList.tsx](/home/jared/Nexus-Terminal/components/trading/ResearchGainersList.tsx:29).
- `WeeklyCalendar` appears unused; Journal uses `TradingCalendar`: [components/trading/WeeklyCalendar.tsx](/home/jared/Nexus-Terminal/components/trading/WeeklyCalendar.tsx:18), [JournalTab.tsx](/home/jared/Nexus-Terminal/components/trading/JournalTab.tsx:185).
- `HorizontalLinePrimitive` appears unused: [components/trading/plugins/HorizontalLinePrimitive.ts](/home/jared/Nexus-Terminal/components/trading/plugins/HorizontalLinePrimitive.ts:1).
- `@sudowealth/schwab-api` is installed but not used in live code; it appears tied to the Schwab spec only: [package.json](/home/jared/Nexus-Terminal/package.json:24), [specs/schwab-realtime-hybrid.md](/home/jared/Nexus-Terminal/specs/schwab-realtime-hybrid.md:7).

Recommendation:
Remove these in a focused dead-code PR after one final `rg` verification. If the Schwab sprint is not imminent, remove the dependency and lockfile entry.

### Medium Confidence

- `/api/askedgar/lookup` appears superseded by `/api/askedgar/snapshot`: [app/api/askedgar/lookup/route.ts](/home/jared/Nexus-Terminal/app/api/askedgar/lookup/route.ts:9), [ResearchTickerView.tsx](/home/jared/Nexus-Terminal/components/trading/ResearchTickerView.tsx:44).
- Saved tickers are backend-only: [app/api/saved-tickers/route.ts](/home/jared/Nexus-Terminal/app/api/saved-tickers/route.ts:8), [lib/db/schema.ts](/home/jared/Nexus-Terminal/lib/db/schema.ts:187).
- Daily ticker summaries are backend-only: [app/api/market-data/daily-summary/route.ts](/home/jared/Nexus-Terminal/app/api/market-data/daily-summary/route.ts:80), [lib/db/schema.ts](/home/jared/Nexus-Terminal/lib/db/schema.ts:168).
- Direct `/api/agents/research` may be redundant if the site uses `/api/research-report` and Discord uses service chat: [app/api/agents/research/route.ts](/home/jared/Nexus-Terminal/app/api/agents/research/route.ts:18), [services/discord-bot/index.ts](/home/jared/Nexus-Terminal/services/discord-bot/index.ts:12), [app/api/research-report/route.ts](/home/jared/Nexus-Terminal/app/api/research-report/route.ts:1).
- Legacy `agentMemory` schema object appears unused now that active memory code uses `agentMemoryV2`: [lib/db/schema.ts](/home/jared/Nexus-Terminal/lib/db/schema.ts:110), [lib/agents/memory.ts](/home/jared/Nexus-Terminal/lib/agents/memory.ts:3).

Recommendation:
Check production data and any external/manual consumers before deletion. Schema removals should be handled as explicit migrations.

## Simplification Targets

### AskEdgar Module Split

Evidence:
- [lib/askedgar.ts](/home/jared/Nexus-Terminal/lib/askedgar.ts:1) is 1,462 lines and owns request transport, endpoint registry, scoped fan-out, cache merge semantics, snapshot normalization, scanner-summary cache, and rate-limit behavior.
- There is local comment/constant drift around scanner-summary TTL: [lib/askedgar.ts](/home/jared/Nexus-Terminal/lib/askedgar.ts:1326), [lib/askedgar.ts](/home/jared/Nexus-Terminal/lib/askedgar.ts:1407).

Recommendation:
Split into `askedgar/endpoints`, `askedgar/fanout`, `askedgar/cache`, and `askedgar/snapshot-normalizer`. Do this only after product pruning decisions so the split does not preserve dead surfaces.

### TradingView Client Extraction

Evidence:
- Similar scan/header/body/error handling appears in [app/api/tradingview/gainers/route.ts](/home/jared/Nexus-Terminal/app/api/tradingview/gainers/route.ts:193), [app/api/tradingview/mdr-candidates/route.ts](/home/jared/Nexus-Terminal/app/api/tradingview/mdr-candidates/route.ts:107), [lib/agents/blueprints/small-cap-research.ts](/home/jared/Nexus-Terminal/lib/agents/blueprints/small-cap-research.ts:665), and [lib/agents/blueprints/swing-trader-research.ts](/home/jared/Nexus-Terminal/lib/agents/blueprints/swing-trader-research.ts:658).

Recommendation:
Extract a server-only `lib/tradingview-client.ts` for scan requests, headers, column mapping, and shared price-context helpers.

### Client Cache Hook

Evidence:
- Module-level client caches appear in [ResearchTldr.tsx](/home/jared/Nexus-Terminal/components/trading/ResearchTldr.tsx:13), [ResearchReportPanel.tsx](/home/jared/Nexus-Terminal/components/trading/ResearchReportPanel.tsx:51), [MacroSummaryPanel.tsx](/home/jared/Nexus-Terminal/components/trading/MacroSummaryPanel.tsx:93), and [use-candle-data.ts](/home/jared/Nexus-Terminal/hooks/use-candle-data.ts:28).

Recommendation:
Replace repeated module-level caches with a small TTL-aware resource hook that supports aborting, stale-while-revalidate, and optional LRU caps.

### Oversized Local Surfaces

Evidence:
- [use-trades.ts](/home/jared/Nexus-Terminal/hooks/use-trades.ts:21) still handles sync, filtering, mutations, imports, default risk, tags, details, and returns a large object at [use-trades.ts](/home/jared/Nexus-Terminal/hooks/use-trades.ts:302).
- [BacktestChart.tsx](/home/jared/Nexus-Terminal/components/trading/BacktestChart.tsx:366) owns chart creation, series type, indicators, prior close, drawings, session shading, order-click handling, markers, and resize lifecycle.

Recommendation:
Do not refactor these speculatively. When touching them, split toward `useTradeMutations`, `useTradeImport`, `useDefaultRisk`, and focused chart lifecycle/indicator/marker hooks.

## Docs And Workflow Drift

- [HANDOFF.md](/home/jared/Nexus-Terminal/HANDOFF.md:8) still presents a full active execution spec for code-validated May 7 Research work. Compact to summary mode: outcome, validation snapshot, authenticated/manual smoke pending.
- [HANDOFF.md](/home/jared/Nexus-Terminal/HANDOFF.md:813) still carries a deferred company-description note, but the live snapshot/header now pass and render description: [app/api/askedgar/snapshot/route.ts](/home/jared/Nexus-Terminal/app/api/askedgar/snapshot/route.ts:28), [ResearchCompanyHeader.tsx](/home/jared/Nexus-Terminal/components/trading/ResearchCompanyHeader.tsx:69).
- [docs/VALIDATION_MATRIX.md](/home/jared/Nexus-Terminal/docs/VALIDATION_MATRIX.md:21) references deleted `services/backtest-gateway` and `services/backtest-worker`; live service validation is `npm run typecheck:services`.
- [README.md](/home/jared/Nexus-Terminal/README.md:20) lists stale product areas and omits Backtesting/Archive. [README.md](/home/jared/Nexus-Terminal/README.md:37) still documents `JARVIS_*` env vars, while `.env.example` uses `LLM_*` and `BACKGROUND_LLM_*`: [.env.example](/home/jared/Nexus-Terminal/.env.example:11).
- [codex-skills/nexus-vercel-ops/SKILL.md](/home/jared/Nexus-Terminal/codex-skills/nexus-vercel-ops/SKILL.md:34) says `vercel.json` defines one cron, but [vercel.json](/home/jared/Nexus-Terminal/vercel.json:2) defines three.
- [docs/FUTURE-PLANS.md](/home/jared/Nexus-Terminal/docs/FUTURE-PLANS.md:512) says there are two existing Vercel crons, but there are three.
- [AGENTS.md](/home/jared/Nexus-Terminal/AGENTS.md:73) says schemas live in two validation files, but `lib/validations/` now has multiple feature-specific files.
- Root [FUTURE-PLANS.md](/home/jared/Nexus-Terminal/FUTURE-PLANS.md:3) is parked ideas; [docs/FUTURE-PLANS.md](/home/jared/Nexus-Terminal/docs/FUTURE-PLANS.md:3) is the broader backlog. Add an index or rename one to make the distinction explicit.

## Harness Skills

Findings:
- AGENTS recommends `nexus-status`, `nexus-debug`, `nexus-review`, `nexus-security-audit`, and `nexus-askedgar-debug`: [AGENTS.md](/home/jared/Nexus-Terminal/AGENTS.md:142).
- Those five exist under `codex-skills/`, but are not installed under `~/.codex/skills` in the current harness.
- Installed copies differ from repo copies for `nexus-commit`, `nexus-deep-research`, `nexus-workflow-audit`, `test-auditor`, and frontend design reference docs.
- `nexus-deep-research` policy differs between repo copy and installed/reference guidance: [codex-skills/nexus-deep-research/SKILL.md](/home/jared/Nexus-Terminal/codex-skills/nexus-deep-research/SKILL.md:29).
- [scripts/workflow-audit.mjs](/home/jared/Nexus-Terminal/scripts/workflow-audit.mjs:28) still checks `.claude` and `.opencode` by default, while AGENTS says to ignore those unless explicitly requested: [AGENTS.md](/home/jared/Nexus-Terminal/AGENTS.md:144).

Recommendations:
1. Decide whether `nexus-deep-research` is parallel-by-default or optional. Given current preference, parallel-by-default is likely right.
2. Update repo skill sources and `workflow:audit` to match that decision.
3. Sync installed copies into `~/.codex/skills`.
4. Install/sync `nexus-status`, `nexus-debug`, `nexus-review`, `nexus-security-audit`, and `nexus-askedgar-debug` so the harness can actually call what AGENTS recommends.
5. Split `workflow:audit` into Codex-default checks and optional cross-tool checks if `.claude` / `.opencode` should stay out of normal Codex audits.

Skills to use more once synced:
- `nexus-status` for quick repo/HANDOFF state.
- `nexus-review` before ship/commit decisions.
- `nexus-debug` for concrete regressions.
- `nexus-askedgar-debug` for research pipeline/cache/quota issues.
- `nexus-security-audit` before protected route, service auth, or external integration changes.
- `test-auditor` before large refactors or when deciding whether cleanup is safe.

## Personal Workflow Improvements

- Add `npm run typecheck` and `npm run validate` so specs can reference one command instead of repeating lint/typecheck/test chains.
- Keep `HANDOFF.md` contract-level while work is active, then compact it after validation. Avoid leaving long implementation transcripts active.
- Make stale follow-up cleanup part of closeout: grep deferred items against live code before commit.
- Prefer route/unit tests over manual DB timestamp mutation for cache TTL behavior.
- Keep broad refactors parked until product pruning is decided, especially around AskEdgar and Discord import history.

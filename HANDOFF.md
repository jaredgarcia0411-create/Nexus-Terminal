# Nexus Terminal - HANDOFF.md

> Updated: 2026-11-13
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and durable docs such as `docs/repo-cleanup.md`.

Historical completed sections were removed to keep this file focused. Use git history and the `specs/` directory for archived implementation detail.

> **Parked:** the Scanner Epic 1 execution spec was moved to `specs/scanner-epic1-handoff.md` (not started — still waiting on the worktree + Neon-branch setup). Move it back here when you're ready to run it. The Parabolic Short Scanner is deliberately **independent** of that epic.

---

## Recently Completed

### Triple Beat: Max Stop of 1.35 ATR on the Cards

Status: completed 2026-11-13.

Outcome:
- `MAX_STOP_ATR` = 1.35 (`lib/triple-beat/scan.ts`): cards show `Max stop` in dollars next to `Min stop` ("Under min stop, skip" when 1.35 ATR < 2% of price), and the header says to skip stops over 1.35 ATR.
- Replay `Card rule` lines apply both the 2% floor and the 1.35 ATR cap. Sizing stays flat 0.5R.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (1,138), `npm run workflow:audit`, `npm run build`: PASS.
- One-day replay smoke (2026-11-05→06): card rule 18/30 trades kept, +7.1R. Still to do: server deploy with `--build`, then check the next post shows `Max stop`.

### Triple Beat Replay: Measure Premarket-Range-Filtered Setups and Opening Volume

Status: completed 2026-11-12.

Outcome:
- Setups failing only `Stop < 0.5 ATR` now get an earnings read and ORB columns, flagged `pmRangeFiltered`; existing summary lines exclude them, with one new `Card rule, premarket range < 0.5 ATR (not posted)` line.
- New columns `openDollarVolume2m` and `openRvol2m` (09:30 + 09:31 bars) for the liquidity filter.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (1,137), `npm run workflow:audit`: PASS.
- One-day smoke (2026-11-05→06): 105 rows, 11 `pmRangeFiltered`, 13 new reads, opening-volume columns filled.

### Triple Beat: EODHD Consensus Estimates in the Earnings Read

Status: completed 2026-11-12.

Outcome:
- `fetchEodhdEarningsEstimates` (`lib/eodhd.ts`) loads EODHD's EPS actual/estimate and the frozen `0q` revenue consensus; 8-K filers only (6-Ks skipped for currency/ADR basis).
- The live scan and replay override the EPS beat with EODHD's numbers (`applyConsensusEps`, quote starts `EODHD:`) and give the LLM a `[CONSENSUS · EODHD]` revenue section; the replay re-reads only unknown beats under `ticker:date:consensus`.
- 2026 replay re-read 486 setups: revenue resolved for 294 (262 beats, 32 misses). The 2024-25 cache has not been re-read yet.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (1,137), `npm run workflow:audit`, `npm run build`: PASS.
- One-day replay smoke (2026-11-05→06): 0 new reads on rerun; APP 2026-11-05 now EPS/revenue yes.
- Deployed 2026-11-12 (351da77); the 2026-11-13 live post quoted an EODHD revenue consensus (LFTO). `epsQuote` count not checked.

### Triple Beat: ORB Exit and Flat Half Size on the Cards

Status: completed 2026-11-12.

Outcome:
- Cards state the 2-minute ORB rule (buy 1¢ over the 9:30–9:32 high, stop 1¢ under the LOD, skip stops under `MIN_STOP_PCT` = 2%, 3R or close) and show each ticker's `Min stop` in dollars.
- Every posted grade sizes at 0.5R (`RULES.maxStopAtr` removed); qualification and scoring unchanged.
- The replay prints `Card rule` lines (all posted + per grade); the stale "sized" lines are gone.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (1,137), `npm run workflow:audit`, `npm run build`: PASS.
- Deployed 2026-11-12 (351da77); Jared confirmed the 2026-11-13 post shows the new header, `Half size (0.5R)` and `Min stop`.

---

## Open Follow-Ups

Playbook rich text:
- Roll `RichTextEditor` into the daily/weekly journal review sections (same `type: 'text'` pattern).
- Optional: Notion-style slash (`/`) command menu; checklists / code blocks / highlight.

Sheets:
- Manual smoke for the AH/PM + numeric filter columns (known past runner, `>0.33` + `>10m` filter) not yet run.
- Deferred roadmap (not started): manual authenticated sharing smoke (invite logged-in coworker, flip role, remove; unknown-email error; viewer read-only / editor sees no manage buttons); self-leave, ownership transfer, invite notifications; templates / per-day "start today's sheet"; archive/unarchive UI, undo/redo, polling/SSE invalidation.

Small-cap research (carried from the 2026-11-04 sections, not re-verified):
- The TLDR (`app/api/askedgar/tldr/route.ts`) has none of the report-accuracy fixes: it still says "remaining capacity", gave OMH's warrants a "$0.00 strike", and called FTCI's September 2026 repayment near-term. Its longer limits (60s per attempt, 130s route) aren't verified live.
- Test a report on a ticker with no report that day, ideally one running hard.

Ops (Jared):
- Rename Neon's "Backup Branch" (live data, database `nexus`) to `live` and never delete or reset it. Make the repo private later, after confirming the server can still `git pull`.

Scans (context from the 2026-10-29/30 work, details in git history):
- Parabolic: short the open with the card's stop, hold to the close. 2024-11→2025-12 +252.6R / 712 posted; 2026 YTD +28.3R / 555. With stops of 0.5 ATR or wider: +124.8R / 402 and +3.6R / 257, since a few tight-stop trades supply most of the rest and their fills may not be achievable. Intraday triggers (OR/VWAP) gave up most of the move out of sample.
- Triple Beat: 45-pt score (EPS, revenue, guidance, base, breakout, $10+), built in-sample on Apr/Jul/Oct 2026. Posted with the 3x RVOL rule and no hindsight: 2024-11→2025-12 +23.3R / 378; 2026 YTD +25.7R / 319. Without the rule: +27.2R / 406 and +49.3R / 345. The replay can't enter during the 09:30 minute, so the with-rule row is on the cautious side. Judge on live posts.
- Triple Beat grading (2026-11-13, replay only, `~/replay-compare/grading/`, both periods with consensus re-reads, 0.1%/side slippage, 2% floor): posted +128.8R / 1,155; per trade A+ +0.17, A +0.16, B +0.06 (the earlier "A+ loses" came from pre-consensus 2024-25 reads). Stop ≤ 1.35 ATR was the only factor that held on setups not used to choose it (posted +0.21R/trade vs 0R / 537 wider) → now on the cards. Guidance raised, mixed catalyst, mcap and early trigger were mixed out of sample; opening-minute volume gave no clean liquidity filter; setups dropped by the premarket-range filter trade like posted ones (+0.10, n=99, low priority to drop). Lead to watch live: A+/A with ≥4 of 5 factor points made +0.51R / 182 (mostly in-sample), so sizing stays flat 0.5R until live posts confirm.
- Earnings read is not fully repeatable: on 2026-11-03 FISV posted B 28, then an identical rerun at 9:12 graded A 36 (revenue/guidance read differently). Watch for grade flips.

---

## Session Maintenance

- Keep this file compact: active specs only while work is in flight, short summaries after validation.
- If a new multi-step feature starts, replace or append a self-contained execution spec with exact file paths, ordered changes, acceptance criteria, and validation requirements.
- If only docs/workflow assets change, run `npm run workflow:audit`.
- Do not modify `.env*` or secret files.

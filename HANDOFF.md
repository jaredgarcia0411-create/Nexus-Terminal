# Nexus Terminal - HANDOFF.md

> Updated: 2026-11-12
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and durable docs such as `docs/repo-cleanup.md`.

Historical completed sections were removed to keep this file focused. Use git history and the `specs/` directory for archived implementation detail.

> **Parked:** the Scanner Epic 1 execution spec was moved to `specs/scanner-epic1-handoff.md` (not started — still waiting on the worktree + Neon-branch setup). Move it back here when you're ready to run it. The Parabolic Short Scanner is deliberately **independent** of that epic.

---

## Recently Completed

### Triple Beat: EODHD Consensus Estimates in the Earnings Read

Status: completed 2026-11-12.

Outcome:
- `fetchEodhdEarningsEstimates` (`lib/eodhd.ts`) loads EODHD's EPS actual/estimate and the frozen `0q` revenue consensus; 8-K filers only (6-Ks skipped for currency/ADR basis).
- The live scan and replay override the EPS beat with EODHD's numbers (`applyConsensusEps`, quote starts `EODHD:`) and give the LLM a `[CONSENSUS · EODHD]` revenue section; the replay re-reads only unknown beats under `ticker:date:consensus`.
- 2026 replay re-read 486 setups: revenue resolved for 294 (262 beats, 32 misses). The 2024-25 cache has not been re-read yet.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (1,137), `npm run workflow:audit`, `npm run build`: PASS.
- One-day replay smoke (2026-11-05→06): 0 new reads on rerun; APP 2026-11-05 now EPS/revenue yes.
- Still to do: server deploy with `--build`, then check how many live `epsQuote` values start with `EODHD:` after the 9:00 ET scan.

### Triple Beat: ORB Exit and Flat Half Size on the Cards

Status: completed 2026-11-12.

Outcome:
- Cards state the 2-minute ORB rule (buy 1¢ over the 9:30–9:32 high, stop 1¢ under the LOD, skip stops under `MIN_STOP_PCT` = 2%, 3R or close) and show each ticker's `Min stop` in dollars.
- Every posted grade sizes at 0.5R (`RULES.maxStopAtr` removed); qualification and scoring unchanged.
- The replay prints `Card rule` lines (all posted + per grade); the stale "sized" lines are gone.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (1,137), `npm run workflow:audit`, `npm run build`: PASS.
- Still to do: server deploy with `--build`, then check the next 9:00 ET post shows the new header, `Half size (0.5R)` and `Min stop`.

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
- Triple Beat ORB exits (2026-11-12, replay only, `~/replay-compare/orb-derisk/`): on all posted (non-Pass) setups across both periods, 2-min ORB + LOD stop made +119R to +154R before costs for every exit (2R, 3R, 1.5R, breakeven at +1R, half off at +1R); 0.1%/side slippage erases all of them unless stops under 2% of price are skipped. With that floor: 3R target +106R / 1,015 (DD 20R), hold to close +115R (DD 23R), 2R +85R. Jared chose for the cards: 2-min ORB, LOD stop, skip if stop < 2% of price, 3R target or close, no breakeven move. A+ grades lose with every exit while B with the floor makes +43R to +64R, so grading/sizing needs a rework; also open: re-read 2024-25 with consensus, liquidity filter (opening-minute volume).
- Earnings read is not fully repeatable: on 2026-11-03 FISV posted B 28, then an identical rerun at 9:12 graded A 36 (revenue/guidance read differently). Watch for grade flips.

---

## Session Maintenance

- Keep this file compact: active specs only while work is in flight, short summaries after validation.
- If a new multi-step feature starts, replace or append a self-contained execution spec with exact file paths, ordered changes, acceptance criteria, and validation requirements.
- If only docs/workflow assets change, run `npm run workflow:audit`.
- Do not modify `.env*` or secret files.

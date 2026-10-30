# Nexus Terminal - HANDOFF.md

> Updated: 2026-10-30
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and durable docs such as `docs/repo-cleanup.md`.

Historical completed sections were removed to keep this file focused. Use git history and the `specs/` directory for archived implementation detail.

> **Parked:** the Scanner Epic 1 execution spec was moved to `specs/scanner-epic1-handoff.md` (not started — still waiting on the worktree + Neon-branch setup). Move it back here when you're ready to run it. The Parabolic Short Scanner (completed below) is deliberately **independent** of that epic.

---

## Open Follow-Ups

Playbook rich text:
- Roll `RichTextEditor` into the daily/weekly journal review sections (same `type: 'text'` pattern).
- Optional: Notion-style slash (`/`) command menu; checklists / code blocks / highlight.

Sheets:
- Manual smoke for the AH/PM + numeric filter columns (known past runner, `>0.33` + `>10m` filter) not yet run.
- Deferred roadmap (not started): manual authenticated sharing smoke (invite logged-in coworker, flip role, remove; unknown-email error; viewer read-only / editor sees no manage buttons); self-leave, ownership transfer, invite notifications; templates / per-day "start today's sheet"; archive/unarchive UI, undo/redo, polling/SSE invalidation.

---

## Session Maintenance

- Keep this file compact: active specs only while work is in flight, short summaries after validation.
- If a new multi-step feature starts, replace or append a self-contained execution spec with exact file paths, ordered changes, acceptance criteria, and validation requirements.
- If only docs/workflow assets change, run `npm run workflow:audit`.
- Do not modify `.env*` or secret files.

---

## Recently Completed

### Parabolic Replay: Intraday Entry Triggers (OR5 / OR15 / VWAP Loss / Below VWAP) × Two Stops

Status: completed 2026-10-30.

Outcome:
- `measureIntradayTriggers` (`lib/parabolic/scan.ts`) replays four short triggers before 10:30 ET — 5/15-min opening-range low break, VWAP loss, first close below VWAP (VWAP from 04:00) — each with a high-of-day + 0.1 ATR stop and the card's premarket-high stop, covering at the close. A stop under 0.5 ATR from the entry counts as no trade.
- `scripts/parabolic-replay.ts` adds 20 CSV columns, matches the live ext10Pct tiebreak, and prints a posted-set summary (grade A–C, top 9/day) comparing the eight scenarios with short-at-the-open.
- First Codex run executed in the background via `codex exec` + `$nexus-execute`, then reviewed here.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (964/964), `npm run workflow:audit`
- Replay smoke 2026-10-14→15: 11 posted, new columns + summary printed.
- Full 2026-01-02→10-29 (555 posted; open baseline matched +28.3R): VWAP loss + HOD stop best at +44.4R / 236 trades, positive every quarter and without its top 5 trades (+18.5R), drawdown −17R vs −36R at the open. OR5/HOD +30.3R. Every PM-stop variant is weak (+10R or worse), so a trigger needs the HOD stop. Chosen in-sample from 8 options.
- Out-of-sample 2024-11-01→2025-12-31 (712 posted): short at open +252.6R (positive every quarter, +51.9R without its top 20 trades) vs VWAP loss/HOD +86.6R; every trigger gave up most of the move. Triggers only help when the setup itself is failing (2026 Q2–Q4 open ≈ −19R). Card footer now says to short the open with the card's stop.

### Scanner Rules: Align Triple Beat + Parabolic With the Coworker's thinkorswim Scans

Status: completed 2026-10-29.

Outcome:
- Triple Beat candidates now come from SEC's latest-filings Atom feed (8-K Item 2.02 + 6-K, `fetchEarningsFilerTickers`) instead of the Massive gapper snapshot; rules match the coworker's scan: overnight high ≥ +5%, current ≥ prior close, price ≥ $3, market cap ≥ $250M (skipped when shares unknown). Card shows `gap (high maxGap)`.
- Replay checks every liquid ticker-day for an earnings filing first, so premarket faders are now included (`maxGapPct`/`marketCapM` CSV columns).
- Parabolic: 2 of last 3 days green; ≥25% above a 10SMA that includes the current price OR ≥35% in 5 days; 3% trade-day gap kept.
- Follow-up: replay walks day-0 minute bars (stop vs 2R order, pre-entry dips ignored); Jul 15–Aug 15 replay went −0.12R → +0.04R avg. Added Triple Beat filter `Stop < 0.5 ATR` (those 40 trades lost 16R). (Parabolic replay needs no such fix: entry is the open and there's no day-0 target, so any stop touch is a real stop-out.)
- Score rebuilt from Apr/Jul/Oct replays (575 matured trades): kept EPS, revenue, guidance, 3-month base, clears 3-month high, price $10+ (45 pts; B 26+, A 34+, A+ 40+). Score 26+ averaged +0.29R vs −0.06R below, positive in all three seasons; items are in-sample, so watch live posts. Unknown earnings (LLM failure) now grade Pass and don't post.
- Parabolic replay 2024-11-01→2026-10-15 (2,040 trades, short at open, cover at close): +0.32R year 1, +0.08R year 2 (2026 Q3 −0.15R); top 5% of trades carry all the profit. Grades don't rank out of sample; wider stops (ATR or % of price) and covering at the gap fill both did worse. Card now drops grade sizing and says hold past the gap fill; scan/score unchanged. Replay CSV adds `day0Close`/`highBeforeFill` (minute bars) for stop tests. Next: spec an intraday entry-trigger test (opening-range/VWAP break vs short at the open).
- 2026-10-30: Triple Beat earnings read gets 12k tokens / 180s (same MiniMax truncation risk as the macro summary). 2026 YTD replays (Jan 2–Oct 29, posted setups, top 9/day): Parabolic +28.3R over 555 trades (Jul–Oct −18R; grade A −6R). Triple Beat +38.8R at 1R / +15.2R card-sized, but +52R came from the Apr/Jul/Oct score-building windows and the other months were −13.6R; sized A/A+ (stop ≤1.5 ATR) averaged +0.31R, A+ did no better than A. Treat both as unproven out of sample; judge on live posts.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm run typecheck:services`, `npm test` (957/957), `npm run build`
- Pending manual: compare the next 9:00 ET post with the coworker's thinkorswim list; rerun replay 2026-10-28→29 (expect >44 rows incl. `<4` faders).

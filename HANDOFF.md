# Nexus Terminal - HANDOFF.md

> Updated: 2026-11-03
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and durable docs such as `docs/repo-cleanup.md`.

Historical completed sections were removed to keep this file focused. Use git history and the `specs/` directory for archived implementation detail.

> **Parked:** the Scanner Epic 1 execution spec was moved to `specs/scanner-epic1-handoff.md` (not started — still waiting on the worktree + Neon-branch setup). Move it back here when you're ready to run it. The Parabolic Short Scanner is deliberately **independent** of that epic.

---

## Open Follow-Ups

Playbook rich text:
- Roll `RichTextEditor` into the daily/weekly journal review sections (same `type: 'text'` pattern).
- Optional: Notion-style slash (`/`) command menu; checklists / code blocks / highlight.

Sheets:
- Manual smoke for the AH/PM + numeric filter columns (known past runner, `>0.33` + `>10m` filter) not yet run.
- Deferred roadmap (not started): manual authenticated sharing smoke (invite logged-in coworker, flip role, remove; unknown-email error; viewer read-only / editor sees no manage buttons); self-leave, ownership transfer, invite notifications; templates / per-day "start today's sheet"; archive/unarchive UI, undo/redo, polling/SSE invalidation.

Scans (context from the 2026-10-29/30 work, details in git history):
- Parabolic: short the open with the card's stop, hold to the close. 2024-11→2025-12 +252.6R / 712 posted; 2026 YTD +28.3R / 555. Intraday triggers (OR/VWAP) gave up most of the move out of sample.
- Triple Beat: 45-pt score (EPS, revenue, guidance, base, breakout, $10+), built in-sample on Apr/Jul/Oct 2026; 2026 YTD +38.8R at 1R, but non-window months −13.6R. Judge on live posts.
- Earnings read is not fully repeatable: on 2026-11-03 FISV posted B 28, then an identical rerun at 9:12 graded A 36 (revenue/guidance read differently). Watch for grade flips.

---

## Session Maintenance

- Keep this file compact: active specs only while work is in flight, short summaries after validation.
- If a new multi-step feature starts, replace or append a self-contained execution spec with exact file paths, ordered changes, acceptance criteria, and validation requirements.
- If only docs/workflow assets change, run `npm run workflow:audit`.
- Do not modify `.env*` or secret files.

---

## Recently Completed

### Scan Check Follow-Ups: Parabolic ETF Label + Triple Beat Premarket-Volume Replay

Status: completed 2026-11-03.

Outcome:
- Both scan cards open with two same-size bold lines, `TICKER · Company/fund name` then the grade line (`C · 10/17 · ETF`, `A · 37/45 · Half size (0.5R)`). They're in the description with no embed title, because Discord renders titles larger. Names come from the Massive reference `name` via `fetchTickerReference`, with the share-class suffix trimmed; a failed lookup shows the ticker alone. Funds stay in the parabolic scan because they carried the replay edge.
- Triple Beat `ExtendedHoursStats.premarketVolume` plus a replay CSV column and 0k/100k/300k floor summary. No live rule change.
- 2026 YTD replay: no floor gives 343 trades +42.7R (80 sized, +25.1R). A 300k floor gives 63 trades +33.8R but only 8 sized, +6.6R. A floor would cut most sized trades, so none was added.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm run typecheck:services`, `npm test` (966), `npm run build`
- Smoke: PLTZ→ETF, NBIX→CS, SQQQ→ETF; unknown ticker 404 → unlabeled. Deploy needs the agent server update with `--build`.

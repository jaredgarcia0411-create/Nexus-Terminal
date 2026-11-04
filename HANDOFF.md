# Nexus Terminal - HANDOFF.md

> Updated: 2026-11-04
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

### Small-Cap Research: Pump-and-Dump Tracker, Intraday Runners, Ticker Changes

Status: code reviewed 2026-11-04. Manual checks below are still pending.

Outcome:
- The small-cap report now gets Ask Edgar's pump-and-dump tracker, flagged intraday runners and gap session detail, shown through the `chartHistory` text. Scam notes sit in their own untrusted block.
- `/v1/historical-tickers` is replaced by `/v1/ticker-changes`. A no-changes reply is stored with `results: []`, so it doesn't count as data.
- `snapshot` is now an explicit 13-key list, so Research page loads never pay for runners (about $0.035 a row).

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (990 tests) passed in review; `npm run build`, `npm run workflow:audit` passed in the Codex run.
- Live `/v1/ticker-changes` smoke passed: XYZ returned `count: 1` with `old_ticker: SQ` and `effective_date: 2025-01-21` ($0.0137). NHBI returned the no-changes shape.
- Pending: CHSN report Chart History wording; new-ticker Research load logs `requested: 13` with no runner fetch.
- Deploy: the agent images copy `lib/` at build time, so the server update needs `--build`.

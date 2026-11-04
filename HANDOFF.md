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

### Small-Cap Research: Report Accuracy

Status: shipped 2026-11-04. OMH ran on production before the last changes (live-price float, all shelf sales counted, today's date), and those haven't had a paid run.

Next:
- Test a ticker with no report that day, ideally one running hard. Reports are reused for 16 hours, so check the timestamp is after the deploy.
- Recheck FTCI, whose cached report expires about 04:52 ET on 2026-11-05: its S-1 equity line shouldn't be described as capped, and its offering risk section should mention the cap.
- The TLDR (`app/api/askedgar/tldr/route.ts`) has none of these fixes. It still says "remaining capacity", gave OMH's warrants a "$0.00 strike" (the 6-K says $1.30 cash, or 9 shares each by alternate cashless exercise), and called FTCI's September 2026 repayment near-term in November.

Outcome:
- Market cap now prices Ask Edgar's share count, and the SEC share trend ignores rows from before the latest reverse split (`772a019`).
- Code calculates each dilution percentage against tradable float and shares outstanding, plus a baby-shelf estimate from `float` and the higher of the 60-day high and live price. Prompt rules cover capacity wording and unsupported buyer or pattern claims, and the prompt now gives today's date.
- Ask Edgar's `baby_shelf_raisable_amount` isn't the SEC limit: on CHSN and FTCI it is offering amount minus total raised. `amount_sold_12_mos` also misses ATM sales (0 on CHSN). The site's "Baby Shelf: $X Left" badge still shows the raisable figure, and Jared chose to leave that for now.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (122 files) passed on the rerun. `sec-client`'s 100ms pacing test failed once in a full run and then passed, so it looks flaky.
- Two paid CHSN runs and one production OMH report fixed most errors, but the model can still ignore a rule on any run: OMH still wrote "classic blow-off behavior".
- Output tokens varied from 3,192 to 10,576 across runs, so the cap is now 16,000.

### Small-Cap Research: Pump-and-Dump Tracker, Intraday Runners, Ticker Changes

Status: code reviewed 2026-11-04. Production checks passed 2026-11-04, except the longer TLDR limits, which aren't verified live yet.

Outcome:
- The small-cap report now gets Ask Edgar's pump-and-dump tracker, flagged intraday runners and gap session detail, shown through the `chartHistory` text. Scam notes sit in their own untrusted block.
- `/v1/historical-tickers` is replaced by `/v1/ticker-changes`. A no-changes reply is stored with `results: []`, so it doesn't count as data.
- `snapshot` is now an explicit 13-key list, and opening a ticker no longer prefetches its report, so runners (about $0.035 a row) are only paid for when the Reports tab opens or a ticker is added to a sheet.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (994 tests) passed; `npm run build`, `npm run workflow:audit` passed in the Codex run.
- Live `/v1/ticker-changes` smoke passed: XYZ returned `count: 1` with `old_ticker: SQ` and `effective_date: 2025-01-21` ($0.0137). NHBI returned the no-changes shape.
- Production: CHSN and FTCI reports generated with the expected Chart History wording and Dilution bullets. FTCI's load sent no report POST before the Reports tab opened, and its TLDR log shows `fetchedFresh=0/13`.
- TLDR: CHSN's first request hit the route's 30s limit (504) and its retry worked; FTCI worked first try. Limits are now 60s per attempt and 130s for the route.
- Deploy: the agent images copy `lib/` at build time, so the server update needs `--build`.

# Nexus Terminal - HANDOFF.md

> Updated: 2026-10-29
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

### Triple Beat Earnings Scanner v1 — Pre-Market Long Scan + Historical Replay

Status: completed 2026-10-29.

Outcome:
- Orchestrator worker scans premarket earnings gap-ups (SEC 8-K Item 2.02 / 6-K gate) at `TRIPLE_BEAT_CRON_HOUR_ET` (default 9 ET) and posts grade-colored cards to `DISCORD_WEBHOOK_TRIPLE_BEAT`; scoring is pure code in `lib/triple-beat/scan.ts`, the LLM only reads EPS/revenue/guidance with quotes verified against the evidence.
- `scripts/triple-beat-replay.ts` replays over a date range (CSV + LLM cache in the home directory). Review fixes: replay cuts off at 09:00 ET to match the live run; SEC press-release failures fall back to news-only; LLM `maxTokens` 600 → 4096 because the MiniMax reasoning model was truncating the JSON (~20% failed reads).
- Known replay limits: candidates are picked by the 9:30 open gap (premarket faders missed); delisted tickers skipped.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm run typecheck:services`, `npm test` (945/945), `npm run workflow:audit`
- Replay smoke 2026-10-28→29: 44 rows, NCLH B/64 strict triple beat (yes/yes/raised); rerun `New LLM reads: 0`. Server deploy (webhook + orchestrator rebuild) still pending.

### Parabolic Short Scanner v1 — Pre-Market Scan + Historical Replay

Status: completed 2026-10-29.

Outcome:
- Orchestrator worker scores premarket parabolic short setups at `PARABOLIC_CRON_HOUR_ET` (default 9 ET) and posts a ranked embed to `DISCORD_WEBHOOK_PARABOLIC`; pure code, no LLM; thresholds live in `RULES` in `lib/parabolic/scan.ts`.
- `scripts/parabolic-replay.ts` replays the scorecard over a date range and writes an outcome CSV to the home directory; review fix rescales split-adjusted bars to as-of-date prices so the $5 / 1M filters are point-in-time.
- Discord post redesigned as cards (option 1 of `~/Downloads/parabolic-discord-options.html`): blue header card + one grade-colored card per setup (top 9), sent as one multi-embed webhook message; "as of" time capped at 9:30 ET.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm run typecheck:services`, `npm test` (907/907), `npm run build`, `npm run workflow:audit`
- Replay smoke 2026-10-14→15: 1 B setup, CSV written. Optiplex orchestrator rebuilt on 597e670 (healthy) and a live test post landed in Discord on 2026-10-29.

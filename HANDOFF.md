# Nexus Terminal - HANDOFF.md

> Updated: 2026-05-16
> Purpose: active execution spec for Codex. Older implementation detail lives in git history, `specs/`, and `docs/repo-cleanup.md`.

## Current Context

- Last shipped: Collaborative Sample-Set Building (commits `b3bd170`, `d512db9`, `dfe35b4`) — anyone can append rows to any sample set (owner-only for rename/delete), shared `SampleSetRowsBuilder` (CSV + Manual + Tags + staging), `POST /api/sample-sets/from-tags`, and Watchlist Save column + bulk picker. Followed by `cc33025` — Daily Review watchlist column icons restyled (FileText for Report, emerald-500 at rest, rounded-md hover, bumped to h-4).
- No active execution spec. Next time you start work, either pick from the follow-up list below or wait for a new spec from the plan agent.
- Open parked items unrelated to any active work: `split-status` endpoint usage audit, broader endpoint review, Filings v2/v3 viewer/search/Copilot work, auto stop-out, and Backtest Manager `broke_premarket_high`.

## Active Execution Spec

_None — most recent spec shipped 2026-05-16._

## Follow-up Specs (not yet planned)

### Auto-sync sample sets from tags

When a trade is tagged with a tag that was used to build an existing sample set, append that trade's `{ticker, date}` to the set automatically.

**Why this is non-trivial** — today a sample set is a frozen `jsonb` row snapshot with no link back to the source tags. We'd need a small schema change plus a hook on the tag-add endpoint.

**Open decisions before drafting a spec:**

- Opt-in at creation, or auto-sync any tag-built set by default? (Prefer opt-in — predictable behavior.)
- Tag *removal* — should it remove the row? (Prefer no — silent shrinkage is confusing.)
- Whose tags trigger sync? (Owner only — tags are user-scoped today; non-owner tag adds shouldn't mutate someone else's set.)
- Should the picker / Backtest Manager show a "synced from #tag" badge with an "unlink → convert to manual" action? (Yes, otherwise the sync is invisible.)

**Rough scope** — schema migration on `sample_sets` (add `source_tags jsonb` nullable), validator extension, POST `/api/sample-sets` persists `source_tags`, hook in the tag-add endpoint that calls a shared "backfill row into linked sets" helper (reusing `mergeDedupedRows` from `lib/sample-set-rows.ts`), Backtest Manager UI badge + unlink action, tests for the tag-add → set-append flow. ~6 files, half a sprint.

**Risks** — extra query on the tag-add hot path (mitigate with a GIN index on `(user_id, source_tags)`); race conditions on simultaneous tag-adds (the existing transactional dedup already protects against this); UX confusion if rows silently appear in a set the user forgot they linked.

## Session Maintenance Checklist

- [ ] Read this file before starting.
- [ ] If the active spec drifts from the live repo, update the spec or stop and ask before editing.
- [ ] After each step, run lint + type-check.
- [ ] Run full `npm test` before reporting a spec complete.
- [ ] Do NOT push to remote without explicit user instruction.
- [ ] Do NOT modify `.env*` or workflow assets under `AGENTS.md` / `codex-skills/` without explicit instruction.

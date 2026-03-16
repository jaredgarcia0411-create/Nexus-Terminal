# Nexus Terminal — HANDOFF.md

## Completed Sections (Summarized)

This file has been compacted to keep only summaries for sections marked complete.
Detailed step-by-step execution specs and checklists were removed to save space.

---

## Codebase Audit — Cleanup & Hardening Sprint

> Generated: 2026-03-13 | Agent: nexus-architect
> Status: COMPLETE (IMPLEMENTED)

**Summary:**
- Implemented ALLOWED_EMAILS sign-in enforcement in auth while preserving allow-all behavior when unset.
- Corrected CLAUDE docs to match current architecture, table inventory, API routes, and Jarvis module layout.
- Renamed package identity to `nexus-terminal` and cleaned stale `next.config.ts` references.
- Removed orphaned Jarvis panel and completed Backtesting-to-Jarvis tab naming migration.
- Replaced straightforward `any` usages with stricter project-native typings.

---

## AskEdgar API: filing-titles endpoint + docs refresh

> Generated: 2026-03-13 | Agent: nexus-architect
> Status: COMPLETE (IMPLEMENTED)

**Summary:**
- Added AskEdgar `filing-titles` endpoint support in the Jarvis client layer.
- Extended dilution report typing with `FilingTitleItem[]` support.
- Replaced `docs/AE_API_DOCS.md` with updated source documentation.
- Validation completed: lint, TypeScript, tests.

---

## Research Reliability + Rendering Improvements

> Generated: 2026-03-13 | Agent: opencode
> Status: COMPLETE (IMPLEMENTED)

**Summary:**
- Hardened research cache reuse rules so invalid/null payloads are not reused as valid reports.
- Added force-refresh support from API/UI paths and propagated cache-source/warning metadata.
- Upgraded Jarvis chat rendering to prefer structured dilution report UI over raw JSON output.
- Added explicit Research UI force-refresh control (`Refresh (Ignore Cache)`).
- Validation completed: lint, TypeScript, tests.

---

## Research Null-Payload UX + Validation Hardening

> Generated: 2026-03-13 | Agent: opencode
> Status: COMPLETE (IMPLEMENTED)

**Summary:**
- Tightened schema-shape validation before cache reuse for dilution report payloads.
- Reworked non-schema chat fallback into compact readable UI with optional raw payload details.
- Ensured warnings are consistently visible across structured and fallback render paths.
- Added chat command force-refresh variants (`/research!` and `--force`) with cache/warning status badges.
- Validation completed: lint, TypeScript, tests.

---

## UI/UX Polish Sprint — Consistency & Refinement

> Generated: 2026-03-15 | Agent: nexus-architect
> Status: COMPLETE (IMPLEMENTED)

**Summary:**
- Standardized headers, spacing, border visibility, corner radius, and background surfaces across tabs.
- Unified non-Charts overlays/inputs/toggles/button styling and aligned emerald hover behavior.
- Added motion transitions for Markets/Research/Jarvis and numeric alignment via `tabular-nums`.
- Removed non-standard Jarvis violet/cyan accents in favor of emerald/zinc palette.
- Preserved intentional Charts tab visual exceptions.
- Validation completed: lint, TypeScript, tests, and visual tab consistency check.

---

---

## Research Tab Redesign — Pipeline Split + UI Overhaul

> Generated: 2026-03-15 | Agent: nexus-architect
> Status: COMPLETE (IMPLEMENTED)

**Summary:**
- Split research into two paths: `fetchAndCacheRawReport()` for Research tab (no LLM) and `runResearchTldr()` for chat TLDR generation.
- Added `buildResearchTldrPrompt()` and switched chat `/research` responses to compact TLDR payloads (`researchTldr`) with cache/warning metadata.
- Updated Research API and Research tab to return/render AskEdgar `rawData` via new `AskEdgarRawReport` component, while preserving `reportJson` fallback for legacy records.
- Removed Saved Tickers and force-refresh UI from Research tab; kept focus on AI Reports and Daily Summaries.
- Added Daily Summary date-range support (GET filters + POST range fetch/upsert loop, max 30 days).
- Validation completed: lint, TypeScript, tests.

---

## Schwab Real-Time Market Data (Option C Hybrid)

> Generated: 2026-03-15 | Agent: nexus-architect
> Status: IN PROGRESS (PHASES 1-3 COMPLETE)

**Full spec:** [`specs/schwab-realtime-hybrid.md`](specs/schwab-realtime-hybrid.md)

**Summary:** Hybrid market data architecture — keep Massive Starter ($29/mo) for historical candle data, add Charles Schwab streaming API for real-time prices. A standalone relay service on Fly.io (~$5/mo) maintains the Schwab WebSocket and writes quotes to the DB. Schwab-linked users get live data; everyone else gets 15-min delayed Massive data.

**Phase 2 Progress (2026-03-15):**
- Created standalone relay service at `services/schwab-relay/` with TypeScript build/dev scripts and isolated dependencies.
- Implemented relay token lifecycle management: encrypted token decrypt/load from DB, 5-minute pre-expiry access-token refresh, and expired-link status updates.
- Implemented Schwab streaming client (userPreference bootstrap, LOGIN/SUBS flow, quote+screener parsing, reconnect loop) and batched DB writer to `realtime_quotes` + screener snapshot upsert.
- Added Fly.io deployment config (`fly.toml`) and production Dockerfile.
- Validation completed for relay service: `cd services/schwab-relay && npm install && npx tsc --noEmit`.

**Phase 3 Progress (2026-03-15):**
- Updated `/api/market-data/snapshot` to use dual-source behavior with per-user Schwab link checks, realtime DB reads, stale-data fallback, and `dataSource` response metadata.
- Polished realtime symbol normalization to align Schwab forex keys (e.g. `EUR/USD`) with Markets snapshot tickers.
- Added `hooks/use-schwab-status.ts` and integrated Markets UI link state, LIVE/15-MIN DELAYED badges, link/re-link flows, and unlink action.
- Added `/?tab=markets` URL parameter support in `app/page.tsx` for Schwab OAuth callback routing.
- Validation completed: lint, TypeScript, tests.

**Phases:**
1. [x] Schwab OAuth integration (7 changes — new tables, encrypted token storage, OAuth routes)
2. [x] Streaming relay service (10 changes — standalone Node.js service in `services/schwab-relay/`)
3. [x] Frontend integration (4 changes — dual-source snapshot route, LIVE/DELAYED badges, link/unlink UI)
4. [ ] Scanner foundation (stub only — `realtimeQuotes` table already covers scanner fields)

---

## Schwab Phases 1-2: Post-Review Fixes

> Generated: 2026-03-15 | Agent: nexus-architect (review), claude (spec)
> Status: COMPLETE (IMPLEMENTED)

**Context:** Architecture review of Phases 1 & 2 found 5 actionable issues. Fix in priority order below.

### Fix 1: Validate LOGIN response before subscribing (BUG — blocks relay operation)

**File:** `services/schwab-relay/src/streamer.ts`

In `handleMessage()`, the code currently checks for a LOGIN response and immediately calls `subscribe()` without verifying success. Schwab LOGIN responses include `content.code` — `0` means success, anything else is failure.

**Steps:**
1. Find the block that checks `service === 'ADMIN' && command === 'LOGIN'` (around line 346-351)
2. Replace the simple existence check with a success validation:
   ```typescript
   const loginResponse = parsed.response?.find(
     (entry: { service: string; command: string }) =>
       entry.service === 'ADMIN' && entry.command === 'LOGIN'
   );
   if (loginResponse) {
     const code = (loginResponse as { content?: { code?: number } }).content?.code;
     if (code === 0) {
       console.log('[Streamer] LOGIN successful, subscribing...');
       this.subscribe();
     } else {
       const msg = (loginResponse as { content?: { msg?: string } }).content?.msg;
       console.error(`[Streamer] LOGIN failed: code=${code} msg=${msg}`);
       this.onError(new Error(`Schwab LOGIN failed: ${msg ?? `code ${code}`}`));
       this.disconnect();
     }
   }
   ```
3. Run: `cd services/schwab-relay && npx tsc --noEmit`

### Fix 2: Remove wrong exchangeId/securityStatus field extraction (BUG — data quality)

**File:** `services/schwab-relay/src/streamer.ts`

In `mapQuoteData()` (around lines 405-409), the code hardcodes `item['4']` as `exchangeId` and `item['5']` as `securityStatus`. These field numbers mean different things per service type (equities vs futures vs forex) and neither exchangeId nor securityStatus is subscribed for any service. Remove these two lines.

**Steps:**
1. Find the `mapQuoteData` function, locate these lines:
   ```typescript
   exchangeId: typeof item['4'] === 'string' ? item['4'] : undefined,
   securityStatus: typeof item['5'] === 'string' ? item['5'] : undefined,
   ```
2. Delete both lines
3. If `exchangeId` and `securityStatus` exist on the `QuoteUpdate` type but are now never assigned, leave them in the type (they may be populated in a future phase) — just remove the incorrect assignment
4. Run: `cd services/schwab-relay && npx tsc --noEmit`

### Fix 3: Clean up futures subscription fields (CLEANUP)

**File:** `services/schwab-relay/src/streamer.ts`

The LEVELONE_FUTURES subscription (around line 301) requests fields `0,1,2,3,4,5,8,12,13,14,18,19,20`. Fields 4 and 5 are not mapped in `FUTURES_FIELDS` and aren't used after Fix 2 removes the hardcoded extraction.

**Steps:**
1. Change the futures subscription field string from `0,1,2,3,4,5,8,12,13,14,18,19,20` to `0,1,2,3,8,12,13,14,18,19,20`
2. Run: `cd services/schwab-relay && npx tsc --noEmit`

### Fix 4: Update CLAUDE.md for Schwab infrastructure (DOCUMENTATION)

**File:** `.claude/CLAUDE.md`

The project docs are stale — they still list `schwab/` as empty/legacy and show 15 tables.

**Steps:**
1. Update the table count from `15` to `17` and add `schwab_links, realtime_quotes` to the table list
2. Remove `schwab/` from the "Empty/legacy directories" line (keep the others)
3. Add a new API Routes subsection:
   ```
   ## Schwab
   - GET `/api/schwab/auth` (OAuth initiation)
   - GET `/api/schwab/callback` (OAuth callback)
   - GET/DELETE `/api/schwab/status` (link status + unlink)
   ```
4. Add under Key Modules:
   ```
   ## Schwab
   - `lib/schwab/crypto.ts` — AES-256-GCM token encrypt/decrypt
   - `lib/schwab/auth.ts` — OAuth URL generation, code exchange, token refresh
   - `services/schwab-relay/` — Standalone streaming relay service (Fly.io)
   ```
5. Update Known Issues item 1 — change "Empty legacy API directories remain from removed Schwab/Discord/backtest features" to "Empty legacy API directories remain from removed Discord/backtest features"

### Fix 5: Remove unused `RELAY_SERVICE_SECRET` from .env.example (CLEANUP)

**File:** `.env.example`

`RELAY_SERVICE_SECRET` is declared but never referenced in any code. Remove it or add a comment `# Reserved for future relay<->app auth (Phase 3+)`.

**Steps:**
1. Find `RELAY_SERVICE_SECRET` in `.env.example` and add a comment: `# Future: relay<->app auth (not yet used)`
2. Done — no code changes needed

### Validation

After all fixes, run from project root:
```bash
cd services/schwab-relay && npx tsc --noEmit && cd ../.. && npm run lint && npx tsc --noEmit
```

---

## Notes

- `.env` and secret files were not modified.
- If a future section is in-progress, keep full implementation steps until completion, then compress to summary.

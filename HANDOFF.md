# Nexus Terminal — HANDOFF.md

## Active Handoff Only

Historical completed sections were removed to keep this file focused.
Use git history and the `specs/` directory for archived implementation detail.

---

## Scanner + Presets Investigation

> Generated: 2026-03-16 | Agent: opencode
> Status: OPEN (investigated, fix list ready)

### What was observed

- Markets can appear healthy while Scanner is empty because `app/api/market-data/snapshot/route.ts` falls back to delayed Massive data, but `app/api/scanner/route.ts` reads only from `realtime_quotes`.
- Scanner presets are likely failing silently because `hooks/use-scanner.ts` ignores non-OK responses for preset fetch/save/delete and never surfaces API errors to the UI.
- Recent `fly logs -a nexus-schwab-relay --no-tail` still show repeated `Failed to load Schwab user preference (401)`, so realtime quote freshness is still suspect even after the UI relink.
- The scanner preset schema and migration exist locally (`lib/db/schema.ts`, `drizzle/0012_dry_bastion.sql`), but if the deployed DB missed that migration, `/api/scanner/presets` would fail while the UI stays silent.
- `components/trading/ScannerSection.tsx` does not reset pagination when filters, sort, clear, or preset load change the result set, so the table can look blank on a stale later page.

### Investigation conclusions

1. There are two separate issues:
   - **Data path issue:** Scanner depends entirely on live `realtime_quotes`, unlike the rest of Markets.
   - **UX/debug issue:** Scanner and presets fail silently, making the real backend problem hard to see.
2. The smallest safe fix is to improve scanner observability and pagination first, then verify whether the remaining issue is missing production migration, stale realtime data, or both.
3. Recommended default: keep Scanner realtime-only for now and show an explicit warning/empty state when realtime quotes are unavailable, instead of expanding scope into delayed-snapshot fallback.

### Concrete fix list

1. **Expose scanner API failures in the client**
   - File: `hooks/use-scanner.ts`
   - Add explicit error state for results and presets.
   - On non-OK responses, parse `{ error }` when possible and store a readable message instead of silently returning.
   - Return those error states to the component.

2. **Show visible scanner/preset errors in the UI**
   - File: `components/trading/ScannerSection.tsx`
   - Render inline status for:
     - scanner fetch failure
     - preset load failure
     - preset save failure
     - preset delete failure
   - Keep the current layout; this is a small UX hardening pass, not a redesign.

3. **Fix stale pagination state**
   - File: `components/trading/ScannerSection.tsx`
   - Reset page to `1` whenever filters, sort direction, sort column, clear filters, or preset load changes the result set.

4. **Make scanner empty state explain the realtime dependency**
   - Files: `hooks/use-scanner.ts`, `components/trading/ScannerSection.tsx`
   - If scanner returns zero rows and Markets is in delayed mode or the scanner fetch fails due to missing realtime data, show a targeted message that Scanner uses realtime quotes only.

5. **Add backend coverage for scanner presets**
   - Files: `app/api/scanner/route.ts`, `app/api/scanner/presets/route.ts`, `__tests__/...`
   - Add route tests for:
     - authenticated scanner GET
     - preset GET/POST/DELETE success path
     - validation errors
     - missing-table / DB failure path if practical

6. **Verify deployment state for `scanner_presets`**
   - Manual/deploy check, no app-code change by default.
   - Confirm the production database actually has the `scanner_presets` table from `drizzle/0012_dry_bastion.sql`.
   - If missing, run the pending migration in the deployed environment before assuming the preset API is wrong.

---

## Schwab Relay Follow-Up

> Generated: 2026-03-16 | Agent: opencode
> Status: OPEN

- Relay logs still show repeated `Failed to load Schwab user preference (401)`.
- This likely keeps `realtime_quotes` stale or empty, which directly degrades Scanner results.
- Scanner fixes should proceed, but relay auth remains a parallel blocker for reliable realtime scanner data.

### Next recommended investigation

1. Inspect the relay's Schwab `userPreference` request construction against Schwab docs and current token state.
2. Confirm whether the post-relink tokens stored by `app/api/schwab/callback/route.ts` are actually the tokens the relay is loading.
3. After fixing relay auth, re-check Fly logs for `LOGIN successful, subscribing...` and quote-write activity.

# Nexus Terminal — HANDOFF.md

## Active Handoff Only

Historical completed sections were removed to keep this file focused.
Use git history and the `specs/` directory for archived implementation detail.

---

## Scanner + Presets Investigation

> Generated: 2026-03-16 | Agent: opencode
> Status: PARTIALLY COMPLETE (client + tests done, deploy check pending)

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

1. [x] **Expose scanner API failures in the client**
   - File: `hooks/use-scanner.ts`
   - Add two new state fields: `error: string | null` (for scanner results fetch) and `presetsError: string | null` (for preset operations). Return both from the hook.
   - In `fetchResults` (line 98): on non-OK response, read `await response.json()` and set `error` to the parsed `.error` string or a fallback like `"Scanner fetch failed (HTTP {status})"`. Clear `error` to `null` on success.
   - In `fetchPresets` (line 114): same pattern — set `presetsError` on non-OK, clear on success.
   - In `savePreset` (line 129): check `response.ok` before calling `fetchPresets()`. If not OK, set `presetsError` to `"Failed to save preset"`.
   - In `deletePreset` (line 142): check `response.ok` before optimistically removing from state. If not OK, set `presetsError` to `"Failed to delete preset"`. If OK, then remove from state as it does now.
   - In all four catch blocks: set the relevant error state (`error` or `presetsError`) to `"Network error"` instead of silently swallowing.

2. [x] **Show visible scanner/preset errors in the UI**
   - File: `components/trading/ScannerSection.tsx`
   - Destructure `error` and `presetsError` from `useScanner`.
   - If `error` is non-null, render a small inline banner above the table: red-tinted text on `bg-rose-500/10` border, showing the error string. Keep it one line, not a modal or toast.
   - If `presetsError` is non-null, render a similar inline message below the presets row inside the filters panel.
   - Keep the current layout; this is a small UX hardening pass, not a redesign.

3. [x] **Fix stale pagination state**
   - File: `components/trading/ScannerSection.tsx`
   - Add a `useEffect` that resets `setPage(1)` with dependencies `[filters, sortBy, sortDir]`. This covers filter changes, sort changes, `clearFilters` (which sets filters to `{}`), and `loadPreset` (which sets filters to the preset's filters). Do NOT list `clearFilters` or `loadPreset` as separate dependencies — they just call `setFilters` under the hood.

4. [x] **Make scanner empty state explain the realtime dependency**
   - File: `components/trading/ScannerSection.tsx`
   - Replace the current empty-state message (`"No results. Adjust filters or wait for quote data."` on line 353) with conditional logic:
     - If `error` is non-null: show the error string (already handled by fix #2 banner, so the table empty row can just say `"Scanner unavailable"`).
     - If `error` is null AND `activeFilterCount > 0`: show `"No results match your filters."`.
     - If `error` is null AND `activeFilterCount === 0`: show `"No realtime quotes available. Scanner requires a live Schwab connection — check Markets tab for status."`.
   - This avoids needing to detect "delayed mode" from the Markets tab, which has no shared state. The zero-results-zero-filters condition is sufficient.

5. [x] **Add backend coverage for scanner presets**
   - Files: `app/api/scanner/route.ts`, `app/api/scanner/presets/route.ts`
   - Create test file: `__tests__/scanner-api.test.ts`
   - Add route tests for:
     - authenticated scanner GET returns `{ results, count, filters, sort }`
     - preset GET returns `{ presets: [] }` for a user with none
     - preset POST creates a preset and returns `{ name, filters }`
     - preset POST with missing name returns 400
     - preset POST with name > 100 chars returns 400
     - preset DELETE with valid id returns `{ success: true }`
     - preset DELETE with missing id returns 400
   - Follow the same mock/test patterns used in existing `__tests__/` files.

6. [ ] **Verify deployment state for `scanner_presets`**
    - Manual/deploy check, no app-code change by default.
    - Confirm the production database actually has the `scanner_presets` table from `drizzle/0012_dry_bastion.sql`.
    - If missing, run the pending migration in the deployed environment before assuming the preset API is wrong.

### Completed in this session

- Added scanner and preset error state handling in `hooks/use-scanner.ts`.
- Added inline scanner/preset error banners, page reset on filter/sort changes, and clearer empty-state messaging in `components/trading/ScannerSection.tsx`.
- Added route coverage in `__tests__/scanner-api.test.ts` for scanner GET and preset GET/POST/DELETE success + validation cases.
- Verification passed locally: `npm run lint`, `npx tsc --noEmit`, `npm test`.

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

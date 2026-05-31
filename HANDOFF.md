# Nexus Terminal - HANDOFF.md

> Updated: 2026-05-31
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and durable docs such as `docs/repo-cleanup.md`.

Historical completed sections (Sprints 1-11, Tier 1 Cleanup, Chart Drawings, Multi-Day Charts, CSV/Cover-Close flows, Workflow Maintenance) were removed to keep this file focused. Use git history and `docs/repo-cleanup.md` (Completed) for archived implementation detail.

---

## Sprint 14 - Daily Review Tag Centralization

> Generated: 2026-05-31 | Agent: Codex (`$nexus-handoff`)
> Status: COMPLETE - implemented 2026-05-31 by Codex (`$nexus-execute`)

### Execution Evidence

- Implemented the shared trade tag editor, watchlist tag conversion, editable Daily Review trade tags, save-time watchlist tag auto-apply, `addTags` bulk trade assignment, tag rename/merge, and the Management -> Trades Manage Tags dialog.
- Post-completion polish: tag text styling now uses the shared `TradeTagEditor` token, Daily Trades uses the same tag rendering, watchlist tag popovers contain wheel scrolling, and Trades/Performance tag filter widths were tightened.
- Added focused coverage in `__tests__/watchlist.test.ts` and `__tests__/weekly-trades-panel.test.tsx`; updated watchlist editor, bulk trades, and tags route tests.
- Validation completed: `npm run lint`, `npx tsc --noEmit`, `npm test`, and `npm run workflow:audit`.
- No schema changes or migrations were generated.

### Objective

Make the Daily Review the primary place for same-day tag work:

- Replace the Watchlist "Thesis" column with the existing trade tag system.
- Let users add/remove tags on the Daily Trades table inside the Daily Review sheet.
- When a watched ticker has tags and that same ticker appears in Daily Trades, automatically apply the watchlist tags to the matching daily trades on save.
- Add a tag-management path for renaming/merging tags and deleting multiple tags so the team can change its tag taxonomy without manually retagging trades one by one.

Do not create a second watchlist-only tag model. The `tags` and `trade_tags` tables remain the source of truth for tag names and trade assignments.

### Current State

- `components/trading/DailyReportSheet.tsx`
  - Stores daily watchlist rows in local `watchlist` state.
  - Saves watchlist rows inside `daily_reviews.report_data.__watchlist` via `WATCHLIST_REPORT_KEY`.
  - Renders `WatchlistEditor` followed by `WeeklyTradesPanel` titled "Daily Trades".
  - Does not receive `globalTags`, `onAddTag`, `onRemoveTag`, or a bulk tag assignment handler.
- `components/trading/WatchlistEditor.tsx`
  - Defines `WatchlistRow` with `thesis: string`.
  - Loads saved thesis options from `/api/watchlist-theses`.
  - Uses `upsertThesis()` and `deleteThesisOption()` to manage a watchlist-only option list.
  - Renders the grid columns as `Ticker`, `Thesis`, `Grade`, `Notes`, `Report`, optional `Chart`, optional `Save`, optional delete.
- `lib/watchlist.ts`
  - `coerceWatchlistRows()` reads untrusted JSON from `reportData.__watchlist` and currently returns rows with `thesis`.
  - `dedupeWatchlistRows()` dedupes weekly watchlist rows by `ticker + thesis`.
- `app/api/daily-reviews/append-watchlist/route.ts`
  - Creates watchlist rows with `thesis: ''` when a Research report is pinned to today's watchlist.
- `components/trading/WeeklyReviewSheet.tsx`
  - Aggregates daily watchlist rows with `coerceWatchlistRows(...)`.
  - Renders `WatchlistEditor` read-only as the weekly watchlist.
- `components/trading/WeeklyTradesPanel.tsx`
  - Renders `Ticker`, `Tags`, and `R`.
  - Is read-only and has no add/remove tag controls.
  - Is reused by Daily Review and Weekly Review.
- `components/trading/TradeTable.tsx`
  - Contains the current tag chip UI, add-tag popover, and optional global-tag delete button.
  - This behavior is duplicated candidate logic and should be extracted before reuse in the Daily Review.
- `hooks/use-trades.ts`
  - `handleAddTag(tradeId, tagName)` PATCHes `/api/trades/[id]` with the full next tag list.
  - `handleRemoveTag(tradeId, tagName)` PATCHes `/api/trades/[id]` with the full next tag list.
  - `handleDeleteGlobalTag(tagName)` DELETEs `/api/tags` and updates local trade/tag state.
  - There is no rename/merge tag handler.
  - There is no async handler that can apply multiple tag assignments and report failure back to `DailyReportSheet`.
- `app/api/tags/route.ts`
  - `GET` returns all tag names for the authenticated user.
  - `POST` creates one tag.
  - `DELETE` deletes one tag from both `tags` and `trade_tags`.
  - There is no rename/merge route.
- `lib/db/schema.ts`
  - `tags` stores global user tag names.
  - `tradeTags` stores per-trade tag assignments.
  - `watchlistTheses` still exists for the old thesis dropdown.
- `lib/validations/trades.ts`
  - `bulkTradeSchema` only supports `delete`, `applyRisk`, and single-tag `addTag`.
- `lib/validations/system.ts`
  - `tagBodySchema` only validates `{ name }`.
- Tests that must move with the behavior include:
  - `__tests__/watchlist-editor.test.tsx`
  - `__tests__/tags-route.test.ts`
  - `__tests__/trades-bulk-route.test.ts`
  - Add or update tests for `WeeklyTradesPanel` if no existing focused coverage is present.

### Required Changes

#### 1. Extract a shared tag editor UI

**File:** `components/trading/TradeTagEditor.tsx` - **CREATE**

Create a client component that owns the tag chip and popover UI currently embedded in `TradeTable`.

Required public props:

```ts
interface TradeTagEditorProps {
  tags: string[];
  globalTags: string[];
  readOnly?: boolean;
  maxWidthClassName?: string;
  emptyLabel?: string;
  onAddTag?: (tagName: string) => void;
  onRemoveTag?: (tagName: string) => void;
  onDeleteGlobalTag?: (tagName: string) => void;
}
```

Behavior:

- Render existing tags as chips in the same visual style currently used by `TradeTable`.
- In read-only mode, render only chips or `emptyLabel ?? '-'`; do not render plus buttons or remove buttons.
- In editable mode:
  - Show an icon-only plus button using `Plus` from `lucide-react`.
  - Open the existing `Popover` + `Command` search/create UI.
  - `availableTags` must be `globalTags.filter((tag) => !tags.includes(tag))`.
  - Pressing Enter with a non-empty query calls `onAddTag(query.trim())`, clears the query, and closes the popover.
  - Selecting an existing available tag calls `onAddTag(tag)`, clears the query, and closes the popover.
  - Each rendered chip has an `X` remove button that calls `onRemoveTag(tag)`.
  - If `onDeleteGlobalTag` is provided, each available tag row has an `X` button that stops propagation and calls `onDeleteGlobalTag(tag)`.
- Keep the component local-state only; do not fetch tags or call APIs inside it.
- Keep command empty copy generic: `Press Enter to create "<query>"`.

**File:** `components/trading/TradeTable.tsx` - **MODIFY**

- Remove inline tag popover/chip state and JSX.
- Import `TradeTagEditor`.
- Keep `tagPopoverTradeId` and `tagQuery` out of `TradeTable`; the new component owns its own popover/query state per rendered cell.
- In the Tags cell, render:
  - `tags={trade.tags ?? []}`
  - `globalTags={globalTags}`
  - `readOnly={readOnly}`
  - `maxWidthClassName="max-w-[220px]"`
  - `onAddTag={(tag) => onAddTag(trade.id, tag)}`
  - `onRemoveTag={(tag) => onRemoveTag(trade.id, tag)}`
  - `onDeleteGlobalTag={onDeleteGlobalTag}`
- Preserve row click behavior by keeping `onClick={(event) => event.stopPropagation()}` on the Tags `<td>`.
- Do not change TradeTable columns, selection behavior, merge behavior, P/L rendering, or notes rendering.

#### 2. Convert watchlist rows from thesis to tags

**File:** `components/trading/WatchlistEditor.tsx` - **MODIFY**

- Change `WatchlistRow`:

```ts
export interface WatchlistRow {
  id: string;
  ticker: string;
  tags: string[];
  grade: string;
  notes: string;
  reportId?: string;
  sourceDate?: string;
}
```

- `emptyRow()` must return `{ id, ticker: '', tags: [], grade: '', notes: '' }`.
- Add required props:

```ts
globalTags: string[];
onDeleteGlobalTag?: (tagName: string) => void;
```

- Remove all thesis-only state and handlers:
  - `theses`
  - `thesisOpenForRow`
  - `thesisQuery`
  - `/api/watchlist-theses` fetch
  - `upsertThesis`
  - `deleteThesisOption`
- Replace the `Thesis` header with `Tags`.
- Replace the thesis cell with `TradeTagEditor`.
  - In read-only mode, pass `readOnly`.
  - In editable mode, `onAddTag` must update only that watchlist row's `tags` with a deduped union.
  - In editable mode, `onRemoveTag` must remove only that watchlist row's matching tag.
  - Pass `onDeleteGlobalTag` through so users can globally delete tags from the watchlist popover too.
- Grid sizing:
  - Keep ticker, grade, notes, report, chart, save, and delete columns.
  - Replace the thesis column width with `minmax(150px, 1fr)` for tags.
  - Keep the notes column at `minmax(160px, 2fr)`.
- Rename helper prop names and comments from thesis to tags where they describe current behavior.
- Do not fetch `/api/tags` inside `WatchlistEditor`; use the `globalTags` prop from `useTrades`.
- Keep existing Report, Chart, Save-to-sample-set, bulk save, weekly `sourceDate`, and read-only behaviors unchanged.

**File:** `lib/watchlist.ts` - **MODIFY**

- Update `coerceWatchlistRows()` to output `tags: string[]`.
- Backward compatibility rules for each raw row:
  - If `row.tags` is an array, keep string values after trimming non-empty strings and dedupe exact strings preserving first-seen order.
  - Else if `row.thesis` is a non-empty string, return `tags: [row.thesis.trim()]`.
  - Else return `tags: []`.
  - Continue coercing `id`, `ticker`, `grade`, `notes`, and optional `reportId`.
- Update `dedupeWatchlistRows()`:
  - Dedupe by ticker only, not ticker plus thesis.
  - For duplicate ticker rows, merge tags with an exact-string deduped union.
  - Newer non-empty `grade` and `notes` still win as they do today.
  - Prefer newer `reportId` when present.
  - Preserve the newest `sourceDate`.
  - Skip only rows that have no ticker, no tags, no grade, and no notes.
- Update comments so they refer to tags, not thesis.

**File:** `app/api/daily-reviews/append-watchlist/route.ts` - **MODIFY**

- Change `newRow` from `thesis: ''` to `tags: []`.
- Do not change auth, validation, dedupe by `(ticker, reportId)`, template seeding, or daily review insertion behavior.

**File:** `components/trading/WeeklyReviewSheet.tsx` - **MODIFY**

- Pass `globalTags={[]}` to the read-only weekly `WatchlistEditor` if no global tags prop is added to `WeeklyReviewSheet`.
- Because the weekly watchlist is read-only, do not add tag mutation handlers there.
- Keep weekly aggregation and `sourceDate` behavior unchanged.

#### 3. Make Daily Trades tags editable inside Daily Review

**File:** `components/trading/WeeklyTradesPanel.tsx` - **MODIFY**

Add optional editing props:

```ts
interface WeeklyTradesPanelProps {
  trades: Trade[];
  title?: string;
  emptyState?: string;
  globalTags?: string[];
  readOnly?: boolean;
  onAddTag?: (tradeId: string, tagName: string) => void;
  onRemoveTag?: (tradeId: string, tagName: string) => void;
  onDeleteGlobalTag?: (tagName: string) => void;
}
```

Behavior:

- Default `readOnly` to `true`.
- If `readOnly` is true, render the current comma-separated tag text exactly as today.
- If `readOnly` is false, render `TradeTagEditor` in the Tags cell.
- Use `globalTags ?? []`.
- Preserve sorting, R calculation, empty state, and grid columns.

**File:** `components/trading/DailyReportSheet.tsx` - **MODIFY**

Add optional props. They are optional because `ArchiveTab` also renders `DailyReportSheet` in read-only/print mode, but the Journal path must pass all of them.

```ts
globalTags?: string[];
onAddTag?: (tradeId: string, tagName: string) => void;
onRemoveTag?: (tradeId: string, tagName: string) => void;
onDeleteGlobalTag?: (tagName: string) => void;
onApplyTradeTags?: (assignments: Array<{ tradeId: string; tags: string[] }>) => Promise<void>;
```

Use the props as follows:

- Pass `globalTags ?? []` and `onDeleteGlobalTag` to `WatchlistEditor`.
- Pass `globalTags ?? []`, `readOnly={effectiveReadOnly || !onAddTag || !onRemoveTag}`, `onAddTag`, `onRemoveTag`, and `onDeleteGlobalTag` to `WeeklyTradesPanel`.
- Daily Trades must only be editable when the Daily Review is in edit mode and both `onAddTag` and `onRemoveTag` are provided. In view mode, archive/print mode, or when handlers are missing, tags are read-only.
- Do not let tag edits require clicking "Save Review"; direct trade tag edits should continue to persist through `onAddTag`/`onRemoveTag`, matching the Trades tab.

#### 4. Auto-apply watchlist tags to matching Daily Trades on save

**File:** `components/trading/DailyReportSheet.tsx` - **MODIFY**

Add a local helper near the other pure helpers:

```ts
function buildWatchlistTradeTagAssignments(
  trades: Trade[],
  watchlistRows: WatchlistRow[],
): Array<{ tradeId: string; tags: string[] }> {
  // implementation described below
}
```

Required behavior:

- Build a `Map<string, string[]>` keyed by uppercase watchlist ticker.
- For every watchlist row:
  - Ignore rows with blank ticker.
  - Trim each tag, drop blanks, dedupe exact strings preserving first-seen order.
  - Append those tags to the ticker's map entry.
- For every trade passed in:
  - Match by `trade.symbol.trim().toUpperCase()`.
  - Use only the `chartTrades`/daily trades set, not all loaded trades.
  - Compute missing tags as watchlist tags not already present in `trade.tags ?? []`.
  - If missing tags is non-empty, add `{ tradeId: trade.id, tags: missingTags }`.
- Return an empty array when no assignments are needed.

Update `handleSave`:

1. Save the daily review through `/api/daily-reviews` exactly as today, including `reportData: { ...reportData, [WATCHLIST_REPORT_KEY]: watchlist }`.
2. After the review save response is OK, call `buildWatchlistTradeTagAssignments(chartTrades, watchlist)`.
3. If assignments are non-empty and `onApplyTradeTags` is provided, `await onApplyTradeTags(assignments)`.
4. If assignments are non-empty and `onApplyTradeTags` is missing, skip auto-apply. This should only happen for read-only/non-Journal consumers; the Journal path must pass the handler.
5. If the review save succeeds but tag application fails:
   - Show `toast.error('Daily review saved, but failed to apply watchlist tags')`.
   - Keep the sheet open.
   - Do not call `onSaved`.
   - Do not call `onOpenChange(false)`.
6. If both review save and tag application succeed, or if there were no assignments to apply:
   - Show the existing success toast.
   - Call `onSaved?.()`.
   - Close the sheet as today.

This makes the save operation the automation boundary. Do not auto-apply tags just from opening the sheet or editing the watchlist locally.

#### 5. Add bulk trade tag assignment support

**File:** `lib/validations/trades.ts` - **MODIFY**

Replace the current `bulkTradeSchema` object with a discriminated union that preserves existing actions and adds `addTags`:

```ts
const bulkIdsSchema = z.array(z.string().min(1).max(256)).max(500).min(1, 'ids are required');
const bulkTagNameSchema = z.string().trim().min(1).max(200);

export const bulkTradeSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('delete'),
    ids: bulkIdsSchema,
  }),
  z.object({
    action: z.literal('applyRisk'),
    ids: bulkIdsSchema,
    value: z.number().finite(),
  }),
  z.object({
    action: z.literal('addTag'),
    ids: bulkIdsSchema,
    value: bulkTagNameSchema,
  }),
  z.object({
    action: z.literal('addTags'),
    assignments: z.array(z.object({
      tradeId: z.string().min(1).max(256),
      tags: z.array(bulkTagNameSchema).max(100),
    })).max(500).min(1, 'assignments are required'),
  }),
]);
```

Remove redundant manual string checks in the route that the schema now guarantees, except keep a defensive empty-owned-rows return.

**File:** `app/api/trades/bulk/route.ts` - **MODIFY**

Add `addTags` behavior:

- For existing actions `delete`, `applyRisk`, and `addTag`, preserve current behavior.
- For `addTags`:
  - Build `uniqueIds` from `assignments.map((item) => item.tradeId)`.
  - Select owned trade ids using the same ownership query as existing actions.
  - Ignore assignments whose `tradeId` is not owned by the user.
  - For each owned assignment:
    - Dedupe and trim assignment tags.
    - Insert each tag into `tagsTable` with `{ userId, name: tag }` and `onConflictDoNothing()`.
    - Insert each trade tag into `tradeTagsTable` with `{ userId, tradeId, tag }` and `onConflictDoNothing()`.
  - Return `Response.json({ success: true, action: 'addTags', ids: ownedIds })`.
- Keep `getPoolDb()` because this route uses transactions.
- Do not delete existing tags before adding; this is additive only.

**File:** `hooks/use-trades.ts` - **MODIFY**

Add a new async handler:

```ts
const handleApplyTradeTags = async (
  assignments: Array<{ tradeId: string; tags: string[] }>,
): Promise<void> => {
  // implementation described below
};
```

Required behavior:

- Normalize assignments client-side before calling the API:
  - Drop blank tags.
  - Drop assignments with no tags.
  - Dedupe tags per assignment preserving first-seen order.
- If no normalized assignments remain, return without making a request.
- Call `/api/trades/bulk` with `{ action: 'addTags', assignments: normalizedAssignments }`.
- On success:
  - Update `trades` state by unioning the assigned tags into each matching trade.
  - Update `globalTags` with all assigned tags, deduped and sorted with `localeCompare`.
- Let errors throw to the caller. Do not wrap this handler in `withErrorToast`; `DailyReportSheet` owns the specific partial-success toast.
- Return this handler from `useTrades()`.

**Files:** `app/page.tsx`, `components/trading/ManagementTab.tsx`, `components/trading/JournalTab.tsx` - **MODIFY**

- Thread `handleApplyTradeTags` from `useTrades()` through `ManagementTab` and `JournalTab` into `DailyReportSheet`.
- Also pass existing `globalTags`, `handleAddTag`, `handleRemoveTag`, and `handleDeleteGlobalTag` into `DailyReportSheet`.
- Do not add trade-tag mutation props to `ArchiveTab`; archived daily reviews remain read-only/print-only.

#### 6. Add tag rename/merge support

**File:** `lib/validations/system.ts` - **MODIFY**

- Tighten `tagBodySchema.name` to `.max(200)` while keeping trim/min behavior.
- Add:

```ts
export const renameTagBodySchema = z.object({
  from: z.string().trim().min(1, 'from is required').max(200),
  to: z.string().trim().min(1, 'to is required').max(200),
});
```

**File:** `app/api/tags/route.ts` - **MODIFY**

- Import `getPoolDb` in addition to `getDb`.
- Import `renameTagBodySchema`.
- Add `PATCH(request: Request)`.
- `PATCH` behavior:
  - Auth with `requireUser()`.
  - Use `getPoolDb()` because the rename must be transactional.
  - Guard DB with `dbUnavailable()`.
  - `ensureUser(db, authState.user)`.
  - Validate `{ from, to }`.
  - If `from === to`, return `{ success: true, from, to, affectedTradeCount: 0 }` without writing.
  - In a transaction:
    1. Select trade ids from `tradeTagsTable` where `userId` and `tag === from`.
    2. Insert `{ userId, name: to }` into `tagsTable` with `onConflictDoNothing()`.
    3. For each selected trade id, insert `{ userId, tradeId, tag: to }` into `tradeTagsTable` with `onConflictDoNothing()`.
    4. Delete old `tradeTagsTable` rows for `from`.
    5. Delete old `tagsTable` row for `from`.
  - Return `{ success: true, from, to, affectedTradeCount }`.
- Do not update watchlist JSON in `daily_reviews.report_data.__watchlist` during rename. Watchlist rows are daily review snapshots; only global tags and trade assignments are canonical.
- Keep existing `GET`, `POST`, and `DELETE` behavior.

**File:** `hooks/use-trades.ts` - **MODIFY**

Add a new handler:

```ts
const handleRenameGlobalTag = async (from: string, to: string): Promise<void> => {
  // implementation described below
};
```

Required behavior:

- Trim `from` and `to`; return if either is blank.
- Call `PATCH /api/tags` with `{ from, to }`.
- On success:
  - Remove `from` from `globalTags`, add `to`, dedupe, sort with `localeCompare`.
  - For every trade, replace tag `from` with `to`, dedupe exact strings.
  - Update `selectedFilterTags`: if it contains `from`, remove `from` and add `to`.
- Let errors throw to the caller or wrap in `withErrorToast('Failed to rename tag', ...)` if invoked directly from a click handler. The final Manage Tags dialog must surface an error toast.
- Return this handler from `useTrades()`.

#### 7. Add a Manage Tags dialog for rename and bulk delete

**File:** `components/trading/ManageTagsDialog.tsx` - **CREATE**

Use existing shadcn primitives from `components/ui/dialog.tsx`, `components/ui/input.tsx`, `components/ui/label.tsx`, and `components/ui/button.tsx`.

Required props:

```ts
interface ManageTagsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  globalTags: string[];
  onRenameTag: (from: string, to: string) => Promise<void>;
  onDeleteTag: (tagName: string) => void;
}
```

Behavior:

- Render all `globalTags` sorted with `localeCompare`.
- Each tag row has:
  - A checkbox for bulk delete selection.
  - The tag name.
  - A small inline rename form or a rename button that opens inline controls.
  - A single delete button.
- Rename:
  - User chooses one existing tag and enters the new name.
  - Submitting calls `await onRenameTag(from, to)`.
  - Disable the submit button while renaming.
  - On success, clear rename inputs and show `toast.success('Tag renamed')`.
  - On failure, show `toast.error('Failed to rename tag')`.
  - If `to` equals an existing tag, treat it as merge copy: button text can still be "Rename"; no extra confirmation required.
- Single delete:
  - Call `onDeleteTag(tagName)`.
  - Remove that tag from local selection state.
- Bulk delete:
  - Show a "Delete selected" button only when one or more tags are selected.
  - On click, call `onDeleteTag(tag)` once per selected tag.
  - Clear selected tags after dispatching deletes.
  - Use existing single DELETE behavior; do not add a new bulk-delete API in this sprint.
- Empty state: `No tags created yet.`
- Keep the dialog compact and utilitarian; do not add marketing/help copy.

**File:** `components/trading/TradesTab.tsx` - **MODIFY**

- Add props:

```ts
onRenameGlobalTag: (from: string, to: string) => Promise<void>;
```

- Add local `manageTagsOpen` state.
- Add a `Manage Tags` button next to the `TagFilterDropdown` in the Tag Filters block.
- Render `ManageTagsDialog` with:
  - `globalTags`
  - `onRenameTag={onRenameGlobalTag}`
  - `onDeleteTag={onDeleteGlobalTag}`

**File:** `components/trading/ManagementTab.tsx` - **MODIFY**

- Add `handleRenameGlobalTag` prop.
- Pass it to `TradesTab`.

**File:** `app/page.tsx` - **MODIFY**

- Pull `handleRenameGlobalTag` from `useTrades()`.
- Pass it into `ManagementTab`.

Do not add the Manage Tags dialog to the Daily Review in this sprint. Daily Review should support creating, applying, and deleting tags through tag popovers; taxonomy management belongs in Management -> Trades.

#### 8. Remove watchlist-thesis UI usage but keep the legacy route/table

**Files intentionally left in place:**

- `app/api/watchlist-theses/route.ts`
- `lib/db/schema.ts` `watchlistTheses`

No migration belongs in this sprint. The legacy table and route become unused compatibility leftovers. A later cleanup sprint can remove them after existing daily review JSON has been migrated or accepted as backward-compatible through `coerceWatchlistRows()`.

### Acceptance Criteria

- [x] Daily Review Watchlist shows a `Tags` column instead of `Thesis`.
- [x] Existing saved watchlist rows with `thesis` still render as one tag after loading.
- [x] New watchlist saves write `tags: string[]` under `reportData.__watchlist`; they do not write `thesis`.
- [x] Watchlist tag options come from `globalTags`; `WatchlistEditor` no longer calls `/api/watchlist-theses`.
- [x] Daily Review Daily Trades tags are editable only after clicking `Edit Review`.
- [x] Daily Review view mode, Archive read-only mode, print mode, and Weekly Review still render trade tags read-only.
- [x] Saving a Daily Review auto-applies watchlist tags to same-day Daily Trades with matching tickers.
- [x] Auto-apply is additive and deduped; it never removes existing trade tags.
- [x] Auto-apply only affects trades in that Daily Review's `chartTrades` set.
- [x] `POST /api/trades/bulk` supports `addTags` and enforces authenticated user ownership.
- [x] `PATCH /api/tags` renames/merges a tag across `tags` and `trade_tags`.
- [x] Manage Tags dialog can rename one tag and delete multiple selected tags.
- [x] Single global tag deletion still removes the tag from all trades.
- [x] No database migration is generated or run.
- [x] `/api/watchlist-theses` may remain in the repo, but no active UI should call it.

### Search Checks

Run these before validation and resolve unexpected hits:

```bash
rg -n "watchlist-theses|thesisOpenForRow|thesisQuery|upsertThesis|deleteThesisOption|Saved Theses|Select thesis|Search or create thesis" components hooks app lib __tests__
rg -n "thesis:" components/trading lib app/api/daily-reviews __tests__
rg -n "action: 'addTags'|addTags|renameTagBodySchema|handleRenameGlobalTag|ManageTagsDialog|TradeTagEditor" app components hooks lib __tests__
```

Expected remaining hits:

- `app/api/watchlist-theses/route.ts` and `lib/db/schema.ts` may still contain watchlist thesis code because removal is out of scope.
- `lib/watchlist.ts` may mention legacy `thesis` only in backward-compatibility comments/code.
- Agent prompt or research text outside this feature may still use the English word "thesis"; do not change unrelated agent/research wording.

### Tests To Update Or Add

- `__tests__/watchlist-editor.test.tsx`
  - Update fixtures to use `tags`.
  - Mock `TradeTagEditor` only if needed; prefer exercising visible Tags header and save/sample-set behavior.
  - Assert `Tags` header exists and `Thesis` header does not.
  - Assert read-only rows render tag text.
  - Preserve tests for save column visibility, single save, bulk save, and read-only checkbox hiding.
- Add or update focused tests for `lib/watchlist.ts` if none exist:
  - legacy `thesis` coerces to `tags`.
  - `tags` array dedupes/trims.
  - weekly dedupe merges same-ticker tags and keeps newer grade/notes/sourceDate behavior.
- `__tests__/trades-bulk-route.test.ts`
  - Add `addTags` coverage for owned trades.
  - Assert unowned ids are ignored.
  - Assert duplicate tag inserts use `onConflictDoNothing`.
  - Keep existing `delete`, `applyRisk`, and `addTag` tests passing.
- `__tests__/tags-route.test.ts`
  - Add `PATCH` rename test.
  - Add merge-into-existing-tag behavior test.
  - Add same-name no-op test.
  - Keep existing `GET`, `POST`, and `DELETE` tests passing.
- Add `__tests__/weekly-trades-panel.test.tsx` if no equivalent focused test exists:
  - Read-only mode renders comma-separated tags.
  - Editable mode calls `onAddTag` / `onRemoveTag` via the shared tag editor behavior or a component mock.
- Add or update a Daily Report Sheet focused test if the existing test surface allows it:
  - Saving with watchlist tags and matching daily trade calls `onApplyTradeTags` with missing tags only.
  - If this is too heavy because of sheet/template mocks, cover `buildWatchlistTradeTagAssignments` by exporting it from `DailyReportSheet.tsx` or moving it to `lib/watchlist.ts` and testing it there. Prefer moving it to `lib/watchlist.ts` if export-from-component becomes awkward.

### Validation

From repo root, run in this order:

```bash
npm run lint
npx tsc --noEmit
npm test
npm run workflow:audit
```

Do not run `npm run db:generate`, `npm run db:migrate`, or `npm run db:push`; this sprint should not change schema.

`npm run typecheck:services` is not required unless the executor unexpectedly edits `services/`.

### Security / Data Notes

- All tag mutation routes must continue using `requireUser()` and `ensureUser()`.
- Tag rename and bulk trade tag assignment must never mutate trades or tags owned by another user.
- Do not log tag payloads beyond existing safe route error logging.
- No `.env*` files, secrets, external integrations, SSE routes, or paid third-party APIs are involved.
- Watchlist JSON is historical daily-review data. Preserve backward compatibility instead of trying to rewrite old `daily_reviews.report_data` rows.

### Order Of Operations

1. Create `TradeTagEditor` and refactor `TradeTable` to use it without behavior changes.
2. Convert `WatchlistRow`, `WatchlistEditor`, `lib/watchlist.ts`, and `append-watchlist` from thesis to tags.
3. Update `WeeklyReviewSheet` read-only watchlist usage for the new `globalTags` prop.
4. Make `WeeklyTradesPanel` optionally editable and wire Daily Review props through `app/page.tsx`, `ManagementTab`, `JournalTab`, and `DailyReportSheet`.
5. Add `addTags` validation, route behavior, and `handleApplyTradeTags`.
6. Implement Daily Review save-time auto-apply.
7. Add `PATCH /api/tags`, `handleRenameGlobalTag`, and `ManageTagsDialog`; wire it into `TradesTab`.
8. Update tests.
9. Run search checks and validation.

This order keeps the UI extraction isolated first, then changes the watchlist data shape, then wires persistence/automation, and only then adds the taxonomy-management surface.

### Complexity Estimate

High. The feature touches shared UI, watchlist JSON compatibility, daily review save behavior, trade tag persistence, tag management, and route tests. The main risks are accidental old-watchlist data loss, applying tags to the wrong day's trades, and cross-user tag mutations; the spec above fixes those boundaries explicitly.

---

## Sprint 13 — Remove Dashboard MDR Scans

> Generated: 2026-05-31 | Agent: Codex (`$nexus-handoff`)
> Status: COMPLETE — validated 2026-05-31

### Objective

Remove the Dashboard MDR scan surface and all live/runtime logic that calculates or serves MDR scan candidates. Keep the existing `mdr_triggers` database table, historical data, and `lib/db/schema.ts` mapping in place for now; a later migration will drop that table.

This is a Dashboard scanner retirement, not a repo-wide ban on the string "MDR". Swing-trader agent research language and tests that describe MDR-style pattern matching are out of scope unless they import or call the Dashboard scan runtime.

### Current State

- `components/trading/DashboardTab.tsx` renders `DashboardScannerTable` under the "Scanners" heading.
- `components/trading/DashboardScannerTable.tsx` renders two tables:
  - Day 1 Setup table from `gainers`.
  - Potential MDR Setup table from `mdrLive` and `mdrRecent`.
- `app/api/dashboard/scanner-state/route.ts` aggregates:
  - `fetchGainersForDashboard()` from `app/api/tradingview/gainers/route.ts`.
  - `fetchMdrCandidatesForDashboard()` from `app/api/tradingview/mdr-candidates/route.ts`.
  - `fetchMdrRecentForDashboard(db)` from `app/api/scanner/mdr-recent/route.ts`.
  - The response shape currently includes `mdrLive` and `mdrRecent`.
- `app/api/tradingview/mdr-candidates/route.ts` owns the live TradingView MDR candidate scan and calls `evaluateLatestD2MdrTrigger()`.
- `app/api/scanner/mdr-recent/route.ts` reads `mdr_triggers`, fetches Massive snapshots, and enriches rows with MDR thresholds.
- `app/api/cron/mdr-sweep/route.ts` populates and invalidates `mdr_triggers`; `vercel.json` schedules it at `/api/cron/mdr-sweep`.
- `lib/massive-market.ts` contains MDR-specific evaluator/threshold helpers:
  - `D2MdrTriggerResult`
  - `MdrThresholds`
  - `D2MdrDailyEvaluation`
  - `evaluateD2MdrTrigger`
  - `calculateMdrThresholds`
  - `evaluateD2MdrDailySeries`
  - `evaluateLatestD2MdrTrigger`
  - `isInvalidationDay`
- `lib/massive-market.ts` also contains non-MDR Massive helpers that must remain:
  - `fetchUnifiedSnapshot`
  - `fetchDailyAggregates`
  - `fetchGroupedDailyAggregates`
  - `GroupedDailyBar`
  - `fetchTickerNews`, market movers, ticker details, etc.
- `lib/db/schema.ts` exports `mdrTriggers`. Keep this export and table mapping until the later DB migration.

### Required Changes

#### 1. Remove MDR from the Dashboard aggregate route

**File:** `app/api/dashboard/scanner-state/route.ts` — **MODIFY**

- Remove imports from:
  - `@/app/api/scanner/mdr-recent/route`
  - `@/app/api/tradingview/mdr-candidates/route`
- Remove `DashboardMdrRecentPayload` and `DashboardMdrCandidatesPayload` from `AggregatePayload`.
- Remove `mdrLive` and `mdrRecent` fields from `AggregatePayload`.
- Change the fan-out from three helpers to only `fetchGainersForDashboard()`.
- Remove warning branches for `mdr-candidates` and `mdr-recent`.
- Keep the existing DB-backed 8s aggregate cache in `askedgar_cache`.
- Keep auth, DB guard, `dynamic`, `maxDuration`, cache read/write behavior, and error handling unchanged.

Expected post-change payload shape:

```ts
interface AggregatePayload {
  gainers: DashboardGainersPayload['gainers'];
  isRealtime: boolean;
  fetchedAt: string;
}
```

#### 2. Remove Dashboard MDR UI and client merge logic

**File:** `components/trading/DashboardScannerTable.tsx` — **MODIFY**

- Remove MDR-only interfaces and types:
  - `MdrCandidate`
  - `MdrRecentRow`
  - `MarketSession` if no longer needed after MDR removal.
- Remove MDR-only helpers:
  - `getMarketSession`
  - `sessionMark`
  - `fmtDollarOrDash`
  - `fmtPercentOrDash`
  - `thresholdClass`
- Remove MDR state:
  - `mdrLive`
  - `mdrRecent`
- Update the `/api/dashboard/scanner-state` response type to only read `gainers`, `isRealtime`, and `fetchedAt`.
- Remove `setMdrLive(...)` and `setMdrRecent(...)`.
- Remove the `mdrRows` `useMemo`.
- Remove the entire "Potential MDR Setup" table/card from the JSX.
- Keep the Day 1 Setup table, Day 1 localStorage latch, scanner-summary enrichment, polling interval, and row navigation behavior unchanged.
- Review copy after removal. If only one scanner remains, keep `DashboardTab.tsx` title as "Scanners" unless the executor sees a clearly better minimal wording change; do not redesign the Dashboard.

#### 3. Delete Dashboard MDR runtime routes

**Files:** **DELETE**

- `app/api/tradingview/mdr-candidates/route.ts`
- `app/api/scanner/mdr-recent/route.ts`
- `app/api/cron/mdr-sweep/route.ts`

These routes should have no remaining imports after steps 1 and 4. Do not leave route files with no HTTP method just to satisfy path stability; the feature is being retired.

#### 4. Remove MDR cron schedule

**File:** `vercel.json` — **MODIFY**

- Remove the cron entry:

```json
{
  "path": "/api/cron/mdr-sweep",
  "schedule": "0 22 * * 1-5"
}
```

- Keep the `agent-retention` and `market-pulse-eod` cron entries unchanged.

#### 5. Remove now-dead MDR evaluator code, but keep shared Massive helpers

**File:** `lib/massive-market.ts` — **MODIFY**

- Remove the MDR-specific exports listed in Current State:
  - `D2MdrTriggerResult`
  - `MdrThresholds`
  - `D2MdrDailyEvaluation`
  - `evaluateD2MdrTrigger`
  - `calculateMdrThresholds`
  - `evaluateD2MdrDailySeries`
  - `evaluateLatestD2MdrTrigger`
  - `isInvalidationDay`
- Remove private helpers only used by those MDR exports:
  - `NULL_MDR_THRESHOLDS`
  - `round2`
  - `lastFinite` if no other code uses it
  - `dailyBarTime` if no other code uses it
  - `toGroupedDailyBar`
  - `toOhlcData`
  - `indicatorContext`
- Remove the `atr`, `ema50`, and `OHLCData` import from `@/lib/indicators` if it becomes unused.
- Keep `DailyOhlcBar`, `GroupedDailyBar`, `fetchDailyAggregates`, and `fetchGroupedDailyAggregates`; `lib/market-pulse/capture.ts` still uses the grouped aggregate helper and type.
- Rename or remove the stale `// MDR cron helpers` section comment so the remaining grouped aggregate helper is not documented as MDR-only.

#### 6. Keep database schema/table until the later migration

**File:** `lib/db/schema.ts` — **NO CHANGE**

- Do not delete `mdrTriggers`.
- Do not generate or run a migration.
- Do not remove historical data.
- The schema export is intentionally retained as a temporary table mapping until the later explicit migration drops `mdr_triggers`.

#### 7. Update or delete tests to match the retired surface

**Files:** **MODIFY / DELETE**

- `__tests__/dashboard-scanner-state-route.test.ts` — **MODIFY**
  - Remove mocks for `fetchMdrCandidatesForDashboard` and `fetchMdrRecentForDashboard`.
  - Update cached payloads and expected responses to exclude `mdrLive` and `mdrRecent`.
  - Update helper-call assertions so only `fetchGainersForDashboard` is expected.
  - Preserve coverage for:
    - fresh cache row returns without fan-out
    - cache miss fans out and upserts
    - TTL expiry refreshes
    - gainer helper failure returns fallback payload and caches it
    - cache upsert failure still returns payload
    - DB unavailable returns 503 without calling helpers
- `__tests__/dashboard-scanner-table.test.tsx` — **MODIFY**
  - Remove MDR fixture types, `MDR_STORAGE_KEY`, `mdrLiveBatches`, and `mdrRecentRows`.
  - Remove the test that renders merged MDR live/recent rows.
  - Update fetch mock payloads so `/api/dashboard/scanner-state` returns only `gainers`, `isRealtime`, and `fetchedAt`.
  - Add or keep an assertion that "Potential MDR Setup" and "No MDR setups detected." are not rendered.
  - Keep Day 1 latch and scanner-summary tests intact.
- `__tests__/tradingview-mdr-candidates-route.test.ts` — **DELETE**
- `__tests__/massive-market.test.ts` — **DELETE** if it contains only MDR evaluator/threshold tests. If non-MDR coverage is added before execution, delete only the MDR cases.

#### 8. Clean stale docs references introduced by this retirement

**Files:** **MODIFY**

- `docs/repo-cleanup.md`
  - Remove or rewrite the old Dashboard MDR threshold/caching cleanup note so it no longer asks future agents to optimize a retired scan.
  - Keep completed-history bullets if they describe past work, but do not leave active TODOs for MDR Dashboard scans.
- `docs/scanner-build.md`
  - Mark MDR replacement content as stale/retired or remove references that describe MDR as an active Dashboard target.
  - Preserve Day 1/custom scanner material that remains relevant.

### Acceptance Criteria

- [x] Dashboard renders only the Day 1 scanner table; no "Potential MDR Setup" UI or empty MDR message remains.
- [x] `/api/dashboard/scanner-state` returns only Day 1 aggregate data (`gainers`, `isRealtime`, `fetchedAt`) and no longer imports or calls MDR helpers.
- [x] `app/api/tradingview/mdr-candidates/route.ts`, `app/api/scanner/mdr-recent/route.ts`, and `app/api/cron/mdr-sweep/route.ts` are deleted.
- [x] `vercel.json` no longer schedules `/api/cron/mdr-sweep`.
- [x] MDR candidate/evaluator/threshold exports are removed from `lib/massive-market.ts`.
- [x] No live import references remain for `mdr-candidates`, `mdr-recent`, `mdr-sweep`, `evaluateD2Mdr*`, `calculateMdrThresholds`, `MdrThresholds`, or `isInvalidationDay`.
- [x] `lib/db/schema.ts` still contains `mdrTriggers`; no migration is generated or run.
- [x] Tests no longer assert MDR Dashboard behavior and still cover Day 1 Dashboard scanner behavior.
- [x] Stale docs no longer tell future agents to optimize or preserve retired Dashboard MDR scans.

### Search Checks

Run these before validation and resolve any unexpected hits:

```bash
rg -n "mdr-candidates|mdr-recent|mdr-sweep|evaluateD2Mdr|evaluateLatestD2MdrTrigger|calculateMdrThresholds|MdrThresholds|isInvalidationDay" app components hooks lib __tests__ docs specs vercel.json
rg -n "Potential MDR Setup|No MDR setups detected|mdrLive|mdrRecent" components __tests__
```

Expected remaining MDR hits after implementation:

- `lib/db/schema.ts` table mapping and comments for `mdrTriggers`.
- Historical or non-Dashboard agent references such as swing-trader research prompts/tests, if they do not import retired Dashboard scan code.
- Any docs explicitly marked as historical/retired.

### Security / Cost Notes

- Removing the MDR Dashboard routes reduces TradingView and Massive API calls.
- Keep `MASSIVE_API_KEY` server-side; do not touch `.env*`.
- No auth model changes.
- No database migration in this sprint.

### Order Of Operations

1. Remove MDR fields/calls from `app/api/dashboard/scanner-state/route.ts`.
2. Remove MDR state/rendering from `components/trading/DashboardScannerTable.tsx`.
3. Delete the retired MDR route files.
4. Remove the Vercel cron entry.
5. Remove unused MDR evaluator/threshold exports from `lib/massive-market.ts`.
6. Update/delete tests.
7. Update stale docs references.
8. Run the search checks, then validation.

This order keeps TypeScript errors easy to interpret: route/UI consumers are disconnected before deleting providers, then shared helper cleanup follows once imports are gone.

### Validation

From repo root:

- [x] `npm run lint`
- [x] `npx tsc --noEmit`
- [x] `npm test`
- [x] `npm run workflow:audit` (HANDOFF.md and docs changed)
- [x] Do **not** run `npm run db:migrate`; no migration belongs in this sprint.

Validation note: the first full `npm test` run hit a timeout in the unrelated `__tests__/sec-companyfacts.test.ts` stale-cache test. The single file passed on rerun, and the required full `npm test` rerun passed.

### Complexity Estimate

Medium. The runtime removal is straightforward, but the blast radius spans UI, API routes, Vercel cron config, shared Massive helpers, route/component tests, and stale docs. The main risk is deleting a shared Massive helper still used by market pulse or agents; use the search checks before removing exports.

---

## Sprint 12 — Scanner Cost & Telemetry (right-sized)

> Generated: 2026-05-31 | Agent: claude (inline spec, per workflow preference)
> Status: COMPLETE — validated 2026-05-31

Goal: make AskEdgar fan-out cost attributable in logs, and make the dashboard scanner cache durable across Vercel instances. Telemetry is **structured logs only** (no table). MDR threshold caching is **dropped** (MDR scans are being retired). No AskEdgar cache-logic change (TTLs tuned later from the log evidence). **No migration. No UI change.**

Scope locked with Jared 2026-05-31:
- Part A — AskEdgar telemetry = structured stdout logs, no `askedgar_request_log` table.
- Part B — dashboard scanner cache = durable DB row, reusing the existing `askedgar_cache` table (no migration).
- Dropped: MDR threshold caching (MDR being removed later) and any per-endpoint AE TTL refactor.

---

### Part A — Structured per-endpoint AskEdgar fan-out logs

**File:** `lib/askedgar/fanout.ts` — **MODIFY**

Today `fetchTickerData` emits one human-readable aggregate `console.log` line per ticker. Replace it with one structured JSON line per endpoint (so per-endpoint cost is queryable in Vercel logs) plus one structured summary line.

1. Add an optional `surface` to the `opts` param of `fetchTickerData`:
   ```ts
   opts?: { endpoints?: readonly string[]; surface?: string }
   ```
   After the existing `const requested = opts?.endpoints ?? ENDPOINT_SCOPES.snapshot;`, add:
   ```ts
   const surface = opts?.surface ?? 'snapshot';
   ```

2. Leave the batch-of-10 loop and the `endpointStates` construction **untouched** (no per-endpoint timing). Replace ONLY the existing aggregate `console.log( ... )` block (the `[askedgar-fanout] ticker=... requested=... succeeded=... costUsd=... durationMs=...` template literal) with the following, built from the already-constructed `endpointStates`:
   ```ts
   for (const state of endpointStates) {
     console.log(JSON.stringify({
       tag: 'askedgar-endpoint',
       surface,
       ticker: normalizedTicker,
       endpoint: state.key,
       status: state.response.status,          // 'success' | 'error'
       hasData: state.hasData,
       costMicrodollars: state.response.usage?.cost_microdollars ?? 0,
       error: state.response.error ?? null,
     }));
   }
   console.log(JSON.stringify({
     tag: 'askedgar-fanout',
     surface,
     ticker: normalizedTicker,
     requested: requested.length,
     succeeded: endpointStates.filter((s) => s.hasData).length,
     costUsd: Number(sumCostUsd(endpointStates).toFixed(4)),
     durationMs: Date.now() - startedAt,
   }));
   ```
   Do **not** reference `state.response.usage?.duplicate` — that field does not exist on the `usage` type (`{ cost_microdollars?: number }` only). Do **not** add per-endpoint duration.

3. Thread `surface` so each fan-out logs the scope that triggered it. The scope name is known at the cache entry points; pass it down the existing chain into the new `surface` option.

   **File:** `lib/askedgar/cache.ts` — **MODIFY**
   - `getCachedTickerData(ticker, opts?: { scope })` already computes `const scope = opts?.scope ?? 'snapshot';`. Add a `scope: string` parameter to `completeTickerDataForScope(...)` and `fetchAndCacheTickerEndpoints(...)`, and pass `scope` from both `getCachedTickerData` call sites of `completeTickerDataForScope` (the partial-cache path and the empty-result path).
   - In `fetchAndCacheTickerEndpoints`, change the fan-out call from `fetchTickerData(normalizedTicker, { endpoints: requested })` to `fetchTickerData(normalizedTicker, { endpoints: requested, surface: scope })`.
   - No separate change is needed for scanner-summary: `getCachedScannerSummary` already routes through `getCachedTickerData(ticker, { scope: 'scanner-summary' })` (via `fetchScannerSummaryRaw`), so threading `scope` through the chain above automatically attributes those fan-outs as `'scanner-summary'`.
   - The only other `fetchTickerData` reference is the `lib/askedgar.ts` re-export; leave its callers' `surface` defaulting to `'snapshot'`.

**Acceptance criteria:**
- [x] `fetchTickerData` accepts `opts.surface`, defaulting to `'snapshot'`.
- [x] Each fan-out logs one `tag:'askedgar-endpoint'` JSON line per requested endpoint (with `endpoint`, `status`, `hasData`, `costMicrodollars`, `error`) plus one `tag:'askedgar-fanout'` summary line.
- [x] No reference to `usage.duplicate`; no per-endpoint timing; the batch loop is unchanged.
- [x] `surface` reflects the originating scope: ticker/research snapshots log their scope; scanner-summary fetches log `'scanner-summary'`.
- [x] `TickerDataResult` shape is unchanged; `npm run lint` and `npx tsc --noEmit` clean.

---

### Part B — Durable dashboard scanner-state cache (DB row, no migration)

**File:** `app/api/dashboard/scanner-state/route.ts` — **MODIFY**

Replace the module-level `Map` (per-instance, lost on cold start) with a single row in the existing `askedgar_cache` table so the 8s warm cache is shared across Vercel instances. The response JSON contract (`AggregatePayload`) is unchanged.

1. Remove the in-memory cache: delete `interface CachedState`, `const cache = new Map<string, CachedState>();`, and `const CACHE_KEY = 'dashboard-scanner-state';`. Keep `const TTL_MS = 8_000;`. Add:
   ```ts
   const SCANNER_CACHE_TYPE = 'dashboard-scanner-state';
   const SCANNER_CACHE_KEY = 'GLOBAL'; // single shared row; ticker column reused as a fixed key
   ```

2. Add imports (match the file's existing import style):
   ```ts
   import { and, eq, gt } from 'drizzle-orm';
   import { askedgarCache } from '@/lib/db/schema';
   ```

3. In `GET`, after the existing `db` guard (`if (!db) return dbUnavailable();`), replace the in-memory read with a DB read:
   ```ts
   const now = new Date();
   const cachedRows = await db
     .select({ dataJson: askedgarCache.dataJson })
     .from(askedgarCache)
     .where(and(
       eq(askedgarCache.cacheType, SCANNER_CACHE_TYPE),
       eq(askedgarCache.ticker, SCANNER_CACHE_KEY),
       gt(askedgarCache.expiresAt, now),
     ))
     .limit(1);
   if (cachedRows.length > 0) {
     return Response.json(cachedRows[0].dataJson as AggregatePayload);
   }
   ```

4. After `payload` is built (the existing `Promise.allSettled` fan-out is unchanged), replace the old `cache.set(...)` write with an upsert that mirrors the existing `askedgar_cache` upsert pattern in `lib/askedgar/cache.ts`, wrapped so a write failure never fails the request:
   ```ts
   // askedgar_cache is a generic jsonb cache; reused here for the (non-AE) scanner aggregate.
   try {
     const cacheNow = new Date();
     const cacheExpiry = new Date(cacheNow.getTime() + TTL_MS);
     await db.insert(askedgarCache).values({
       id: SCANNER_CACHE_TYPE,
       cacheType: SCANNER_CACHE_TYPE,
       ticker: SCANNER_CACHE_KEY,
       dataJson: payload,
       fetchedAt: cacheNow,
       expiresAt: cacheExpiry,
     }).onConflictDoUpdate({
       target: [askedgarCache.cacheType, askedgarCache.ticker],
       set: { dataJson: payload, fetchedAt: cacheNow, expiresAt: cacheExpiry },
     });
   } catch (error) {
     console.warn('[dashboard:scanner-state] cache write failed:', error);
   }
   return Response.json(payload);
   ```
   (Plain-value `set` matches the existing `askedgar_cache` upserts in `lib/askedgar/cache.ts` — `writeTickerCache`, `getCachedScannerSummary`. Concurrent instances may each recompute once when the row expires — acceptable; same behavior as before, just shared once warm. No locking needed.)

**Acceptance criteria:**
- [x] Module-level `Map` / `CachedState` / `CACHE_KEY` are removed.
- [x] A fresh cached row (`expiresAt > now`) is returned without fanning out.
- [x] On miss, the route fans out, upserts the single row with an 8s expiry, and returns the payload.
- [x] A cache-write failure logs and still returns the computed payload (request never 500s on cache write).
- [x] `AggregatePayload` response shape is unchanged.

**Tests** — `__tests__/dashboard-scanner-state-route.test.ts` — **MODIFY**

Extend the existing `db` stub so it supports the new read chain (`.select().from().where().limit()`) and the write chain (`.insert().values().onConflictDoUpdate()`). Add cases:
- [x] Fresh cached row present → returns it, fan-out helpers NOT called.
- [x] Cache miss (read returns `[]`) → fan-out helpers called, upsert called, payload returned.
- [x] Upsert throws → payload still returned (no 500).
Do not assert on `console` output.

(Part A logging needs no dedicated test — it's stdout only. Keep coverage on the data paths above.)

---

### Files Changed Summary

| File | Action | ~Lines | Risk |
|---|---|---|---|
| `lib/askedgar/fanout.ts` | MODIFY | ~18 | LOW (logging + optional param) |
| `lib/askedgar/cache.ts` | MODIFY | ~8 | LOW (thread `scope` through 2 helpers) |
| `app/api/dashboard/scanner-state/route.ts` | MODIFY | ~30 | MEDIUM (in-memory → DB read/write path) |
| `__tests__/dashboard-scanner-state-route.test.ts` | MODIFY | ~35 | LOW |

No new files. No schema change. No migration.

### Verification Steps

From repo root:
- [x] `npm run lint`
- [x] `npx tsc --noEmit`
- [x] `npm test`
- [x] `npm run workflow:audit` (HANDOFF.md changed)
- [x] Do **not** run `npm run db:migrate` — this sprint adds no migration. If you find yourself writing one, stop and re-read the scope.

Manual (post-deploy):
- [ ] Open the Dashboard; confirm the scanner panel renders identically and refreshes.
- [ ] Open a Research ticker; in Vercel logs confirm `tag:"askedgar-endpoint"` lines (one per endpoint, with `costMicrodollars`) and a `tag:"askedgar-fanout"` summary line, with `surface` set to the right scope.

---

## Implementation Style

Write the simplest correct code that satisfies this spec. Specifically:

- Match the existing conventions in the file you're editing. Do not introduce new patterns, helpers, abstractions, or file layouts unless this spec explicitly calls for them.
- No future-proofing. No feature flags, no "in case we need it later" parameters, no extracted helpers that have a single caller. If a value is only used once, inline it.
- No defensive code at internal boundaries. Trust your own code and framework guarantees; validate only at system boundaries (user input, external APIs, DB reads of untrusted JSON).
- No comments unless the *why* is non-obvious (a hidden constraint, a workaround, a surprising invariant). Don't restate what the code says.
- If a step in this spec looks more complex than it needs to be, flag it and propose the simpler version before implementing — don't silently "improve" the spec, but don't write code that's more elaborate than the problem requires either.
- If you spot an existing simpler pattern in the codebase that fits, use it instead of writing new code.

This is a personal trading platform built solo. Readability > cleverness; debuggable > elegant; small diff > sweeping refactor. Three similar lines beats a premature abstraction.

---

## Session Maintenance

- Keep this file compact: active specs only while work is in flight, short summaries after validation.
- If a new multi-step feature starts, replace or append a self-contained execution spec with exact file paths, ordered changes, acceptance criteria, and validation requirements.
- If only docs/workflow assets change, run `npm run workflow:audit`.
- Do not modify `.env*` or secret files.

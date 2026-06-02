# Nexus Terminal - HANDOFF.md

> Updated: 2026-06-02
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and durable docs such as `docs/repo-cleanup.md`.

Historical completed sections (Sprints 1-15, Tier 1 Cleanup, Chart Drawings, Multi-Day Charts, CSV/Cover-Close flows, Workflow Maintenance) were removed to keep this file focused. Use git history and `docs/repo-cleanup.md` for archived implementation detail.

---

## Active Spec — Sheets Sprint 5: Reorder Rows/Columns + Delete Columns

Status: implemented 2026-06-02. Validation passed: `npm run lint`, `npx tsc --noEmit`, `npm test` (756 passed), and `npm run workflow:audit`. Manual authenticated smoke remains a Jared post-merge task per the acceptance criteria.

Goal: let users drag-reorder rows and columns in a sheet, and delete user-added columns. Three capabilities:
1. **Row reorder** — drag a row by a handle; persists to `sheet_rows.position`. (rows are editor+owner)
2. **Column reorder** — drag a column header; persists into the `columns` jsonb. (owner-only)
3. **Column delete** — remove a *user-added* (non-locked) column via an × on header hover. (owner-only)

Locked decisions (from scoping):
- Rows use **@dnd-kit** (new dep) — it's the pattern react-data-grid v7's own row-reorder example uses, and avoids hand-rolling HTML5 drag math. Row drag is via a dedicated **drag-handle column** (not whole-row drag), because our cells are always-visible inputs and whole-row listeners would fight text selection.
- Column reorder is **native** to rdg (`draggable` per column + `onColumnsReorder`); persistence reuses the existing owner-only `PATCH /api/sheets/[id]` via `useSheets.updateColumns`. No new route for columns.
- Column delete drops only the column definition (reuses `updateColumns`). **Orphaned cell values stay** in each row's `values` jsonb — they're ignored by the grid and dropped naturally on the next row save. No bulk row scrub.
- Column reorder/delete are **owner-only** because `PATCH /api/sheets/[id]` is owner-only (`app/api/sheets/[id]/route.ts:63`); this matches today's owner-only "Column" button.
- **No migration** — `sheet_rows.position` already exists (`lib/db/schema.ts:671`).

### Part A — Install dependency

A1. From repo root: `npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/modifiers @dnd-kit/utilities`. (Do NOT touch/delete `package-lock.json` manually — `npm install` updates it.)

### Part B — Row reorder route + validation + hook

B1. Add to `lib/validations/sheets.ts` (next to `appendResearchRowSchema`):
```ts
export const reorderRowsSchema = z.object({
  rowIds: z.array(z.string().min(1).max(64)).min(1).max(2000),
});
```
And export its type alongside the others: `export type ReorderRowsBody = z.infer<typeof reorderRowsSchema>;`

B2. New file `app/api/sheets/[id]/rows/reorder/route.ts` (static `reorder` segment sits beside the existing `[rowId]` dynamic segment — Next.js matches the static route first, no conflict). Mirror the auth/role shape of `app/api/sheets/[id]/rows/[rowId]/route.ts`:
```ts
import { and, eq } from 'drizzle-orm';

import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { sheetRows } from '@/lib/db/schema';
import { getSheetRole } from '@/lib/sheets/access';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { reorderRowsSchema } from '@/lib/validations/sheets';

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const bodyState = await parseAndValidate(request, reorderRowsSchema);
    if (bodyState.error) return bodyState.error;
    const { rowIds } = bodyState.data;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const { id } = await context.params;
    const role = await getSheetRole(db, id, authState.user.id);
    if (!role) return Response.json({ error: 'Sheet not found' }, { status: 404 });
    if (role === 'viewer') return Response.json({ error: 'Forbidden' }, { status: 403 });

    // Set position = index for each id. The sheetId in the WHERE scopes the update so a rowId
    // from another sheet is a no-op. Non-transactional like deleteRows — acceptable for this tool.
    await Promise.all(rowIds.map((rowId, index) =>
      db.update(sheetRows)
        .set({ position: index })
        .where(and(eq(sheetRows.id, rowId), eq(sheetRows.sheetId, id))),
    ));

    return Response.json({ ok: true });
  } catch (error) {
    logRouteError('sheets.id.rows.reorder', error);
    return internalServerError();
  }
}
```

B3. In `hooks/use-sheets.ts`, add a `reorderRows` callback (after `deleteRows`) and return it:
```ts
const reorderRows = useCallback(async (orderedIds: string[]) => {
  if (!activeSheet) return;

  const snapshot = rows;
  // Optimistic: reorder local rows to match orderedIds and renumber positions.
  setRows((current) => {
    const byId = new Map(current.map((row) => [row.id, row]));
    return orderedIds
      .map((id, index) => {
        const row = byId.get(id);
        return row ? { ...row, position: index } : null;
      })
      .filter((row): row is SheetRowRecord => row !== null);
  });

  const res = await sendJson(`/api/sheets/${activeSheet.id}/rows/reorder`, { rowIds: orderedIds }, 'PATCH');
  if (!res.ok) {
    setRows(snapshot);
    toast.error('Failed to reorder rows');
  }
}, [activeSheet, rows]);
```
Add `reorderRows` to the returned object.

### Part C — Row drag UI (`components/trading/SheetsTab.tsx`)

C1. Add imports at top:
```ts
import { createContext, useContext, type CSSProperties, type Key } from 'react';   // merge into the existing 'react' import
import { GripVertical, X } from 'lucide-react';        // add to the existing lucide-react import
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import { Row as GridRowRenderer, type RenderRowProps } from 'react-data-grid';   // add Row + RenderRowProps to the existing react-data-grid import
```

C2. Above `SheetsTab`, add a context + draggable row renderer + drag-handle component. The row-level `useSortable` lives in the renderer; its `listeners`/`attributes` are passed down to the handle cell via context so only the grip is draggable (not the whole row):
```tsx
// Derive the handle type straight from useSortable so attributes/listeners stay correctly typed
// when spread onto the handle button (avoid Record<string, unknown> — it breaks JSX spread typing).
type RowDragHandle = Pick<ReturnType<typeof useSortable>, 'attributes' | 'listeners'>;
const RowDragContext = createContext<RowDragHandle | null>(null);

function DraggableRow(key: Key, props: RenderRowProps<GridRow>) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.row.__id,
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };
  return (
    <RowDragContext.Provider key={key} value={{ attributes, listeners }}>
      <GridRowRenderer {...props} ref={setNodeRef} style={style} />
    </RowDragContext.Provider>
  );
}

function DragHandle() {
  const drag = useContext(RowDragContext);
  return (
    <div className="flex h-full items-center justify-center">
      <button
        type="button"
        className="cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
        aria-label="Drag to reorder row"
        {...(drag?.attributes ?? {})}
        {...(drag?.listeners ?? {})}
      >
        <GripVertical className="h-4 w-4" />
      </button>
    </div>
  );
}
```

C3. In `SheetsTab`, set up sensors (near the top, after the hooks):
```ts
const sensors = useSensors(
  useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
);

const handleDragEnd = (event: DragEndEvent) => {
  const { active, over } = event;
  if (!over || active.id === over.id) return;
  const ids = gridRows.map((row) => row.__id);
  const from = ids.indexOf(String(active.id));
  const to = ids.indexOf(String(over.id));
  if (from === -1 || to === -1) return;
  void sheets.reorderRows(arrayMove(ids, from, to));
};
```

C4. In the `gridColumns` `useMemo`, when `canEditRows`, prepend a drag-handle column **before** `SelectColumn`:
```ts
const dragColumn: Column<GridRow> = {
  key: '__drag',
  name: '',
  width: 36,
  minWidth: 36,
  frozen: true,
  renderCell: () => <DragHandle />,
};
const columns: Column<GridRow>[] = canEditRows ? [dragColumn, SelectColumn] : [];
```
(`'__drag'` won't collide with real column keys — `valuesFromGridRow` only iterates `activeSheet.columns`, so it never touches row data.)

C5. Wrap the `<DataGrid>` so dragging is only active for editors/owners. Add `renderers={{ renderRow: DraggableRow }}` to the grid **only** when `canEditRows`, and wrap in `DndContext`/`SortableContext`:
```tsx
const rowIds = gridRows.map((row) => row.__id);

const grid = (
  <DataGrid<GridRow, unknown, string>
    className="sheets-grid"
    columns={gridColumns}
    rows={gridRows}
    rowKeyGetter={(row) => row.__id}
    onRowsChange={handleRowsChange}
    selectedRows={selectedRows}
    onSelectedRowsChange={setSelectedRows}
    onColumnsReorder={canManage ? handleColumnsReorder : undefined}
    renderers={canEditRows ? { renderRow: DraggableRow } : undefined}
    style={{ blockSize: 480 }}
  />
);

// then in JSX where <DataGrid> currently is:
{canEditRows ? (
  <DndContext
    sensors={sensors}
    collisionDetection={closestCenter}
    modifiers={[restrictToVerticalAxis]}
    onDragEnd={handleDragEnd}
  >
    <SortableContext items={rowIds} strategy={verticalListSortingStrategy}>
      {grid}
    </SortableContext>
  </DndContext>
) : grid}
```

### Part D — Column reorder (owner-only, native rdg)

D1. Add the reorder handler in `SheetsTab`:
```ts
const handleColumnsReorder = (sourceKey: string, targetKey: string) => {
  if (!activeSheet) return;
  const cols = activeSheet.columns;
  const from = cols.findIndex((column) => column.key === sourceKey);
  const to = cols.findIndex((column) => column.key === targetKey);
  if (from === -1 || to === -1) return;
  const next = [...cols];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  void sheets.updateColumns(next);
};
```
(`onColumnsReorder` is already wired in C5, gated to `canManage`.)

D2. In `buildColumn`, mark real columns draggable for owners. Add a `canManage: boolean` parameter to `buildColumn`, and set `draggable: canManage` on the `base` object. Pass `canManage` from the `gridColumns` loop: `buildColumn(column, canEditRows, canManage, toggle, actions)`. The `__drag` and `SelectColumn` columns stay non-draggable (don't set `draggable` on them).

### Part E — Column delete (owner-only, non-locked)

E1. Extend `CellActions` with `deleteColumn: (key: string) => void;` and in the `gridColumns` `useMemo` actions object add:
```ts
deleteColumn: (key) => {
  if (window.confirm('Delete this column? Cell data in it will be hidden.')) {
    void sheets.updateColumns(activeSheet.columns.filter((column) => column.key !== key));
  }
},
```

E2. In `buildColumn`, when `canManage && !column.locked`, override `base.renderHeaderCell` so the name shows with an × that appears on hover:
```tsx
if (canManage && !column.locked) {
  base.renderHeaderCell = () => (
    <div className="group flex h-full items-center justify-between gap-1">
      <span className="truncate">{column.name}</span>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          actions.deleteColumn(column.key);
        }}
        className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition hover:bg-rose-500/10 hover:text-rose-400 group-hover:opacity-100"
        aria-label={`Delete ${column.name} column`}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
```
Apply this to the shared `base` near the top of `buildColumn`, before the type branches return (so every non-locked user column — text/select/date/etc. — gets the deletable header). The `stopPropagation` keeps the × click from triggering rdg's column sort/drag.

### Part F — Tests, validation, docs

F1. Tests in `__tests__/sheets-routes.test.ts` for the reorder route (import `PATCH as reorderRows from '@/app/api/sheets/[id]/rows/reorder/route'`):
- editor reorders → `200` `{ ok: true }`.
- `viewer` → `403`.
- unknown sheet (`getSheetRoleMock` → `null`) → `404`.
Follow the existing row-route test setup (`requireUserMock`, `getSheetRoleMock`, `getDbMock.mockReturnValue(createDbMock({}))`).

F2. Validation-schema tests in `__tests__/sheets-members.test.ts` (where `appendResearchRowSchema` tests live): `reorderRowsSchema` accepts a non-empty string array; rejects an empty array.

F3. Run from repo root: `npm run lint` && `npx tsc --noEmit` && `npm test`. **No migration.**

F4. Update the **Sheets** bullet in `AGENTS.md` to note rows are drag-reorderable (@dnd-kit) and columns can be reordered/deleted by the owner. Then run `npm run workflow:audit` (workflow asset changed).

### Acceptance criteria
- Editors/owners see a grip handle on each row and can drag rows into a new order; the order persists across reload. Viewers see no handle and cannot reorder.
- Owners can drag a column header to reorder columns; the order persists. Editors/viewers cannot.
- Owners see an × on hover over **user-added** column headers (never on the 6 locked defaults) that deletes the column after a confirm; deleted columns disappear and orphaned cell data stays dormant in the DB.
- Keyboard drag works for rows (focus a handle, space to lift, arrows, space to drop).
- `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run workflow:audit` all green. No migration.
- Manual authenticated smoke (Jared, post-merge): reorder rows, reorder columns, delete an added column, confirm viewer/editor gating.

### Notes for Codex
- `@dnd-kit` row-reorder mirrors react-data-grid's official example: a `renderers.renderRow` that wraps the exported `Row` with `useSortable`, plus a `SortableContext` of row ids. Do not make the whole row draggable — only the handle cell carries `listeners` (via `RowDragContext`).
- The grid row type is `GridRow` (has `__id`) — type the renderer as `RenderRowProps<GridRow>` as shown.
- React is v19 here, so `ref` on the exported `Row` is a normal prop and typechecks (`RenderRowProps` extends `ComponentProps<'div'>`); no `forwardRef` shim needed.
- The `gridColumns` `useMemo` currently depends on `[activeSheet, canEditRows, rows, sheets]`. **Add `canManage`** to that array — it's now read inside for `draggable` and the delete header, and `react-hooks/exhaustive-deps` will fail otherwise.
- Define `sensors`, `handleDragEnd`, `handleColumnsReorder`, and the `grid` element in the component body **before** the `return`, with the two handlers above the `grid` const that references them.
- `handleColumnsReorder` guards with `if (from === -1 || to === -1) return;` — that also safely ignores drops over the non-draggable `__drag`/`SelectColumn` columns (their keys aren't in `activeSheet.columns`).
- Don't add the drag-handle column or `renderers` for viewers — keep their grid exactly as today.

---

## Recent Completed Context

- **Sprint 14 - Daily Review Tag Centralization:** trade tags are now the shared Watchlist/Daily Trades tagging model; added tag rename/merge management.
- **Sprint 15 - Cleanup Test Coverage + Backtesting Lazy Loading:** added focused tests and lazy-loaded `BacktestingTab` at the Charts-tab boundary.
- **Repo cleanup (`docs/repo-cleanup.md`):** completed; repo is in good standing as of 2026-06-01.
- **Sprint 16 - Legacy DB Column Drop:** closed as won't-do (commit `9da2d49`). Legacy `trades.pnl` / `trades.executions` stay in place.

---

## Recently Completed

### Sheets - Sprint 4: Research Notebook Core

Status: completed 2026-06-01 (commit `65ecd1e`).

Outcome:
- Locked `report`/`chart`/`action` cells are live (report dialog, ticker+date chart, sample-set save picker); they work for viewers too.
- Date/select/text cells render as always-visible inline inputs (`renderCell`) instead of the spec's `renderEditCell` editors — this was the fix for a crash (Codex had used the canary-only `useEffectEvent`) and the visible-date-selector issue.
- New `POST /api/sheets/[id]/append-research-row` (auth + role gate + `(ticker, date)` dedupe) and an "Add to Sheets" dropdown on the Research page.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (751 passed) all green; reviewed against spec.
- Manual authenticated smoke (open report/chart cells, save to sample set, Add to Sheets incl. duplicate) remains a Jared post-merge task.

### Sheets - Sprint 1: Data Layer

Status: completed 2026-06-01 (commit `176e525`).

Outcome:
- 3-table model shipped (`sheets`, `sheet_rows`, `sheet_members`) with migration `0045`, columns folded into a `columns` jsonb + `columnsVersion` guard.
- Access-checked routes from day one via `getSheetRole`: list/create, get/patch/delete (owner-only edits), duplicate, row append + optimistic-version patch/delete.
- Validation in `lib/validations/sheets.ts` (hard bounds) + 12 vitest cases.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (736 passed) all green.
- Migration generated + applied (`npm run db:migrate`).

### Sheets - Sprint 2: Management UI + Editable Grid

Status: completed 2026-06-01 (commit `da1bba0`).

Outcome:
- First Sheets UI: `Sheets` subtab under Management — list rail, create/rename/duplicate/delete, `react-data-grid` editable grid with text/select/checkbox editors, optimistic save with 409 conflict toasts.
- `hooks/use-sheets.ts` owns all data + mutations; pure grid helpers in `lib/sheets/grid.ts` (unit-tested).
- Grid themed via `.sheets-grid` mapping `--rdg-*` vars onto app semantic tokens (follows light/dark).

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (740 passed) all green.
- Authenticated browser smoke not run (no `agent-browser` in Codex sandbox); deferred surfaces (`report`/`chart`/`action` cells, tag options, sharing) are not built yet, not broken.

Known cosmetic debt (rolled into Sprint 3): `SheetFormDialog` date input + `AddColumnDialog` type select dropped the `[color-scheme:dark]` class the rest of the app uses.

### Sheets - Sprint 3: Sharing / Members

Status: completed 2026-06-01 (commit `93c3646`).

Outcome:
- Owner-only member routes: add-by-email (`POST .../members`), editor/viewer role change + remove (`PATCH`/`DELETE .../members/[userId]`), with the owner's membership immutable (never assigned/changed/removed via these routes).
- `use-sheets` gained `addMember`/`updateMemberRole`/`removeMember` (local `members` updates, surfaces server error text); new owner-only `ShareSheetDialog` wired into `SheetsTab`.
- Cleared Sprint-2 `[color-scheme:dark]` debt on `SheetFormDialog` date input + `AddColumnDialog` type select; added `sheets-members` validation tests.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (744 passed) all green.
- Manual authenticated sharing smoke not run (no `agent-browser` in Codex sandbox) — still pending.

### Roadmap (deferred — Sheets, Sprint 5+)
- **Manual authenticated smoke for sharing** (still pending: invite logged-in coworker, flip role, remove; unknown-email error; viewer read-only / editor sees no manage buttons).
- Self-leave (non-owner removing own membership), ownership transfer, email/invite-link notifications for users who haven't signed in.
- Templates / per-day "start today's sheet" flow beyond plain Duplicate.
- CSV export, archive/unarchive UI, undo/redo, polling/SSE invalidation, drag-reorder rows/columns.

(Research "Add to Sheets" import + interactive `report`/`chart`/`action` cells + the `AGENTS.md` Sheets-surface update shipped in Sprint 4 — see Recently Completed.)

---

## Implementation Style

Write the simplest correct code that satisfies the active spec. Specifically:

- Match the existing conventions in the file you're editing. Do not introduce new patterns, helpers, abstractions, or file layouts unless the spec explicitly calls for them.
- No future-proofing. No feature flags, no "in case we need it later" parameters, no extracted helpers that have a single caller. If a value is only used once, inline it.
- No defensive code at internal boundaries. Trust your own code and framework guarantees; validate only at system boundaries: user input, external APIs, and DB reads of untrusted JSON.
- No comments unless the why is non-obvious (a hidden constraint, a workaround, a surprising invariant). Don't restate what the code says.
- If a step in this spec looks more complex than it needs to be, flag it and propose the simpler version before implementing — don't silently "improve" the spec, but don't write code that's more elaborate than the problem requires either.
- If you spot an existing simpler pattern in the codebase that fits, use it instead of writing new code.

This is a personal trading platform built solo. Readability > cleverness; debuggable > elegant; small diff > sweeping refactor. Three similar lines beats a premature abstraction.

---

## Session Maintenance

- Keep this file compact: active specs only while work is in flight, short summaries after validation.
- If a new multi-step feature starts, replace or append a self-contained execution spec with exact file paths, ordered changes, acceptance criteria, and validation requirements.
- If only docs/workflow assets change, run `npm run workflow:audit`.
- Do not modify `.env*` or secret files.

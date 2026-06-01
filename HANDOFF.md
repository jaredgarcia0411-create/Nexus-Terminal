# Nexus Terminal - HANDOFF.md

> Updated: 2026-06-01
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and durable docs such as `docs/repo-cleanup.md`.

Historical completed sections (Sprints 1-15, Tier 1 Cleanup, Chart Drawings, Multi-Day Charts, CSV/Cover-Close flows, Workflow Maintenance) were removed to keep this file focused. Use git history and `docs/repo-cleanup.md` for archived implementation detail.

---

## Recent Completed Context

- **Sprint 14 - Daily Review Tag Centralization:** trade tags are now the shared Watchlist/Daily Trades tagging model; added tag rename/merge management.
- **Sprint 15 - Cleanup Test Coverage + Backtesting Lazy Loading:** added focused tests and lazy-loaded `BacktestingTab` at the Charts-tab boundary.
- **Repo cleanup (`docs/repo-cleanup.md`):** completed; repo is in good standing as of 2026-06-01.
- **Sprint 16 - Legacy DB Column Drop:** closed as won't-do (commit `9da2d49`). Legacy `trades.pnl` / `trades.executions` stay in place.

---

## Recently Completed

### Sheets - Sprint 1: Data Layer

Status: completed 2026-06-01 (commit `176e525`).

Outcome:
- 3-table model shipped (`sheets`, `sheet_rows`, `sheet_members`) with migration `0045`, columns folded into a `columns` jsonb + `columnsVersion` guard.
- Access-checked routes from day one via `getSheetRole`: list/create, get/patch/delete (owner-only edits), duplicate, row append + optimistic-version patch/delete.
- Validation in `lib/validations/sheets.ts` (hard bounds) + 12 vitest cases.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (736 passed) all green.
- Migration generated + applied (`npm run db:migrate`).

### Deferred from Sprint 1 (candidates for next sprints)
- Any UI (`SheetsTab`, grid, `ManagementTab` subtab).
- Member add/remove-by-email routes + email→user lookup.
- Research "Add to Sheets" import route.
- CSV export, polling/SSE invalidation.
- `AGENTS.md` update — defer until routes + UI land so we document a real surface.

---

## Sheets - Sprint 2: Management UI + Editable Grid

> Generated: 2026-06-01 | Agent: Claude (Plan)
> Status: IMPLEMENTED - automated validation passed 2026-06-01; authenticated browser smoke remains blocked because `agent-browser` is unavailable in this environment.

### Context

Sprint 1 shipped the data layer (tables + routes + validation, commit `176e525`). This sprint builds the **first UI** that consumes it: a `Sheets` subtab under Management with a sheet list, create/rename/duplicate/delete, an editable `react-data-grid`, add-row / add-column, dropdown + checkbox editors, and optimistic save-on-commit with 409 conflict toasts.

**Locked decisions (memory `project_sheets_feature_decisions.md`):** grid library is `react-data-grid` (adazzle, MIT) — NOT AG Grid. Build under `components/trading/SheetsTab.tsx` + a new `sheets` subtab in `ManagementTab.tsx`, `hooks/use-sheets.ts`. Do NOT touch `hooks/use-trades.ts`. Owner-only for sheet rename/columns/delete; owner+editor edit rows; viewer read-only.

**Routes already live (do not change them):**
- `GET /api/sheets` → `{ sheets: SheetListItem[] }`
- `POST /api/sheets {name, sheetDate?}` → 201 `{ sheet }` (defaults columns)
- `GET /api/sheets/[id]` → `{ sheet, rows, members, role }` (404 non-member)
- `PATCH /api/sheets/[id] {name?, sheetDate?, columns?, columnsVersion?, archived?}` → `{ sheet }` (owner-only; 409 on stale `columnsVersion`)
- `DELETE /api/sheets/[id]` → `{ deleted, id }`
- `POST /api/sheets/[id]/duplicate {name?}` → 201 `{ sheet }`
- `POST /api/sheets/[id]/rows {values?}` → 201 `{ row }`
- `PATCH /api/sheets/[id]/rows/[rowId] {values, version}` → `{ row }` or 409 `{ error, row }`
- `DELETE /api/sheets/[id]/rows/[rowId]` → `{ deleted, id }`

**Design conventions to match:** this codebase uses shadcn **semantic tokens** (`bg-card`, `border-border`, `text-foreground`, `text-muted-foreground`, `bg-accent`, `bg-primary/10 text-primary`, `text-rose-400`, `text-emerald-400`) — NOT raw zinc/hex classes. Mirror `components/trading/CareerPnlTab.tsx` and `components/trading/AddSampleSetDialog.tsx` exactly for layout, dialogs, fetch/loading/toast patterns. Tab entry animation uses `motion/react` like every other tab.

---

### Step 1 — Install react-data-grid

Run from repo root:

```
npm install react-data-grid
```

This installs `7.0.0-beta.59` (current `latest`; peer `react@^19.2` — matches this repo). Confirm `package.json` + `package-lock.json` updated. **Do not** delete or regenerate the lockfile.

**Acceptance:** `react-data-grid` appears in `package.json` dependencies; `npm ci` would still install cleanly.

---

### Step 2 — Global CSS: import grid styles + dark theme overrides

**File:** `app/globals.css` — MODIFY

`react-data-grid/lib/styles.css` is **global CSS**. Next.js App Router only allows global CSS imported from the root layout or `globals.css` (never a component), so it must go here, not in `SheetsTab.tsx`.

1. Add the import on a new line **immediately after** the existing `@import "tw-animate-css";` (line 2). All `@import` rules must precede other CSS:
   ```css
   @import "react-data-grid/lib/styles.css";
   ```
2. Append a theme block at the **end of the file** that maps react-data-grid's CSS variables onto the app's **semantic tokens** (the `var(--...)` defined in `:root` for light and `.dark` for dark). Because those tokens already flip with the theme, the grid follows light/dark automatically and reuses the exact same palette as every other surface — no hardcoded hex. Apply via a `.sheets-grid` wrapper class:
   ```css
   /* react-data-grid theming — map the grid's --rdg-* variables onto the app's
      semantic tokens so the grid follows light/dark automatically and reuses the
      same palette as every other surface. */
   .sheets-grid {
     --rdg-color: var(--foreground);
     --rdg-background-color: var(--card);
     --rdg-header-background-color: var(--muted);
     --rdg-row-hover-background-color: var(--accent);
     --rdg-row-selected-background-color: color-mix(in srgb, var(--primary) 12%, transparent);
     --rdg-row-selected-hover-background-color: color-mix(in srgb, var(--primary) 18%, transparent);
     --rdg-border-color: var(--border);
     --rdg-selection-color: var(--ring);
     --rdg-font-size: 13px;
     border: none;
   }

   /* Native controls inside cells (checkbox, scrollbars, date input) follow the
      active theme. The app toggles the `.dark` class, so key off that. */
   .sheets-grid { color-scheme: light; }
   .dark .sheets-grid { color-scheme: dark; }
   ```
   > **Verify, don't assume:** after install, open `node_modules/react-data-grid/lib/styles.css` and confirm the exact `--rdg-*` variable names (they can shift across betas). Map every color-bearing var the file actually defines onto the matching app token — `--card`, `--muted`, `--accent`, `--border`, `--foreground`, `--primary`/`--ring` (with `color-mix` for tints). Do NOT introduce hardcoded hex; if a var has no obvious token, pick the closest existing token rather than inventing a color. Drop or rename any var above that doesn't exist in the installed file.

**Acceptance:** grid background matches `var(--card)` in **both** light and dark mode (toggle the `.dark` class to confirm it flips); no hardcoded hex in the block; colors come only from existing tokens.

---

### Step 3 — Pure grid helpers (testable)

**File:** `lib/sheets/grid.ts` — CREATE

Client-safe, no DB imports. Pure functions kept separate so they're unit-tested without a DOM.

```ts
import type { SheetColumn, SheetColumnType } from '@/lib/sheets/columns';

export type SheetRole = 'owner' | 'editor' | 'viewer';

// Grid rows are FLATTENED: each sheet column key becomes a top-level property so
// react-data-grid's default cell accessor (row[column.key]) works without custom
// getters. __id / __version carry row identity + the optimistic-lock version.
export type GridRow = { __id: string; __version: number } & Record<string, unknown>;

export type SheetRowRecord = {
  id: string;
  position: number;
  values: Record<string, unknown>;
  version: number;
};

export function gridRowsFromSheet(rows: SheetRowRecord[]): GridRow[] {
  return rows.map((r) => ({ __id: r.id, __version: r.version, ...r.values }));
}

// Pull only the sheet's declared column keys back out of a grid row (dropping the
// __id/__version meta keys) to build the `values` jsonb payload for a PATCH.
export function valuesFromGridRow(gridRow: GridRow, columns: SheetColumn[]): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const col of columns) {
    if (gridRow[col.key] !== undefined) values[col.key] = gridRow[col.key];
  }
  return values;
}

// Types a user can add. report/chart/action are reserved for the locked default
// columns and are not user-creatable in v1.
export const USER_COLUMN_TYPES: SheetColumnType[] = ['text', 'number', 'date', 'url', 'checkbox', 'select'];

// Types edited inline via react-data-grid's built-in text editor.
export const TEXT_EDIT_TYPES: SheetColumnType[] = ['text', 'number', 'date', 'url'];

export function slugifyColumnKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

// Ensure a generated key doesn't collide with an existing column key (suffix
// _2, _3, ...). Falls back to `column` if the name slugifies to empty.
export function nextColumnKey(name: string, existing: SheetColumn[]): string {
  const base = slugifyColumnKey(name) || 'column';
  const taken = new Set(existing.map((c) => c.key));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}_${i}`)) i += 1;
  return `${base}_${i}`;
}
```

**Acceptance:** exports `SheetRole`, `GridRow`, `SheetRowRecord`, `gridRowsFromSheet`, `valuesFromGridRow`, `USER_COLUMN_TYPES`, `TEXT_EDIT_TYPES`, `slugifyColumnKey`, `nextColumnKey`.

---

### Step 4 — Data hook

**File:** `hooks/use-sheets.ts` — CREATE

Owns all sheet data + mutations (fetch, optimistic row edit with 409 reconcile, column update with 409 reload). UI state (selection, dialogs) stays in `SheetsTab`.

```ts
'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import type { SheetColumn } from '@/lib/sheets/columns';
import type { SheetRole, SheetRowRecord } from '@/lib/sheets/grid';

export type SheetListItem = {
  id: string;
  name: string;
  sheetDate: string | null;
  isTemplate: boolean;
  archivedAt: string | null;
  ownerUserId: string;
  ownerName: string | null;
  role: SheetRole;
  updatedAt: string;
};

export type Sheet = {
  id: string;
  ownerUserId: string;
  name: string;
  sheetDate: string | null;
  isTemplate: boolean;
  columns: SheetColumn[];
  columnsVersion: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SheetMember = {
  userId: string;
  role: SheetRole;
  name: string | null;
  email: string | null;
};

function sendJson(url: string, body: unknown, method = 'POST') {
  return fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function useSheets() {
  const [list, setList] = useState<SheetListItem[]>([]);
  const [listLoading, setListLoading] = useState(true);

  const [activeSheet, setActiveSheet] = useState<Sheet | null>(null);
  const [rows, setRows] = useState<SheetRowRecord[]>([]);
  const [members, setMembers] = useState<SheetMember[]>([]);
  const [role, setRole] = useState<SheetRole | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const refreshList = useCallback(async () => {
    try {
      const res = await fetch('/api/sheets');
      if (!res.ok) throw new Error(`list failed: ${res.status}`);
      const data = (await res.json()) as { sheets: SheetListItem[] };
      setList(data.sheets ?? []);
    } catch (error) {
      console.error(error);
      toast.error('Failed to load sheets');
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  const openSheet = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/sheets/${id}`);
      if (!res.ok) throw new Error(`open failed: ${res.status}`);
      const data = (await res.json()) as {
        sheet: Sheet; rows: SheetRowRecord[]; members: SheetMember[]; role: SheetRole;
      };
      setActiveSheet(data.sheet);
      setRows(data.rows ?? []);
      setMembers(data.members ?? []);
      setRole(data.role);
    } catch (error) {
      console.error(error);
      toast.error('Failed to open sheet');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const createSheet = useCallback(async (name: string, sheetDate?: string) => {
    const res = await sendJson('/api/sheets', { name, sheetDate });
    if (!res.ok) { toast.error('Failed to create sheet'); return; }
    const data = (await res.json()) as { sheet: Sheet };
    await refreshList();
    await openSheet(data.sheet.id);
    toast.success('Sheet created');
  }, [refreshList, openSheet]);

  const renameSheet = useCallback(async (id: string, name: string, sheetDate?: string) => {
    const res = await sendJson(`/api/sheets/${id}`, { name, sheetDate: sheetDate ?? null }, 'PATCH');
    if (!res.ok) { toast.error('Failed to rename sheet'); return; }
    const data = (await res.json()) as { sheet: Sheet };
    setActiveSheet((cur) => (cur && cur.id === id ? data.sheet : cur));
    await refreshList();
  }, [refreshList]);

  const duplicateSheet = useCallback(async (id: string, name: string) => {
    const res = await sendJson(`/api/sheets/${id}/duplicate`, { name });
    if (!res.ok) { toast.error('Failed to duplicate sheet'); return; }
    const data = (await res.json()) as { sheet: Sheet };
    await refreshList();
    await openSheet(data.sheet.id);
    toast.success('Sheet duplicated');
  }, [refreshList, openSheet]);

  const deleteSheet = useCallback(async (id: string) => {
    const res = await fetch(`/api/sheets/${id}`, { method: 'DELETE' });
    if (!res.ok) { toast.error('Failed to delete sheet'); return; }
    setActiveSheet((cur) => {
      if (cur && cur.id === id) { setRows([]); setMembers([]); setRole(null); return null; }
      return cur;
    });
    await refreshList();
    toast.success('Sheet deleted');
  }, [refreshList]);

  const addRow = useCallback(async () => {
    if (!activeSheet) return;
    const res = await sendJson(`/api/sheets/${activeSheet.id}/rows`, {});
    if (!res.ok) { toast.error('Failed to add row'); return; }
    const data = (await res.json()) as { row: SheetRowRecord };
    setRows((cur) => [...cur, data.row]);
  }, [activeSheet]);

  // Optimistic single-row save. On 409 the server returns the current row; we
  // adopt it and warn (v1 detects conflicts, it does not merge). On other errors
  // we roll back to the snapshot.
  const updateRow = useCallback(async (rowId: string, values: Record<string, unknown>) => {
    if (!activeSheet) return;
    const current = rows.find((r) => r.id === rowId);
    if (!current) return;
    const snapshot = rows;
    setRows((cur) => cur.map((r) => (r.id === rowId ? { ...r, values } : r)));

    const res = await sendJson(
      `/api/sheets/${activeSheet.id}/rows/${rowId}`,
      { values, version: current.version },
      'PATCH',
    );

    if (res.ok) {
      const data = (await res.json()) as { row: SheetRowRecord };
      setRows((cur) => cur.map((r) => (r.id === rowId ? data.row : r)));
      return;
    }
    if (res.status === 409) {
      const data = (await res.json()) as { row: SheetRowRecord };
      setRows((cur) => cur.map((r) => (r.id === rowId ? data.row : r)));
      toast.error('Row was changed by someone else — reloaded latest');
      return;
    }
    setRows(snapshot);
    toast.error('Failed to save cell');
  }, [activeSheet, rows]);

  const deleteRows = useCallback(async (rowIds: string[]) => {
    if (!activeSheet || rowIds.length === 0) return;
    const results = await Promise.all(
      rowIds.map((rowId) => fetch(`/api/sheets/${activeSheet.id}/rows/${rowId}`, { method: 'DELETE' })),
    );
    setRows((cur) => cur.filter((r) => !rowIds.includes(r.id)));
    if (results.some((r) => !r.ok)) toast.error('Some rows could not be deleted');
  }, [activeSheet]);

  const updateColumns = useCallback(async (columns: SheetColumn[]) => {
    if (!activeSheet) return;
    const res = await sendJson(
      `/api/sheets/${activeSheet.id}`,
      { columns, columnsVersion: activeSheet.columnsVersion },
      'PATCH',
    );
    if (res.ok) {
      const data = (await res.json()) as { sheet: Sheet };
      setActiveSheet(data.sheet);
      return;
    }
    if (res.status === 409) {
      toast.error('Columns were changed by someone else — reloading');
      await openSheet(activeSheet.id);
      return;
    }
    toast.error('Failed to update columns');
  }, [activeSheet, openSheet]);

  return {
    list, listLoading,
    activeSheet, rows, members, role, detailLoading,
    refreshList, openSheet,
    createSheet, renameSheet, duplicateSheet, deleteSheet,
    addRow, updateRow, deleteRows, updateColumns,
  };
}
```

**Acceptance:** hook exports `useSheets`, `Sheet`, `SheetListItem`, `SheetMember`. Optimistic row edit reconciles on 409; column update reloads on 409.

---

### Step 5 — Sheet create/rename dialog

**File:** `components/trading/SheetFormDialog.tsx` — CREATE

One dialog reused for create + rename (name + optional date). Mirror `AddSampleSetDialog.tsx`.

```tsx
'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface SheetFormDialogProps {
  open: boolean;
  mode: 'create' | 'rename';
  initialName?: string;
  initialDate?: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: { name: string; sheetDate?: string }) => Promise<void>;
}

export default function SheetFormDialog({
  open, mode, initialName, initialDate, onOpenChange, onSubmit,
}: SheetFormDialogProps) {
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName(initialName ?? '');
      setDate(initialDate ?? '');
      setError(null);
      setSubmitting(false);
    }
  }, [open, initialName, initialDate]);

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) { setError('Name is required'); return; }
    setSubmitting(true);
    try {
      await onSubmit({ name: trimmed, sheetDate: date || undefined });
      onOpenChange(false);
    } catch {
      setError('Could not save sheet');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-card text-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'New Sheet' : 'Rename Sheet'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="sheet-name">Name</Label>
            <Input id="sheet-name" value={name} onChange={(e) => setName(e.target.value)} className="border-border bg-accent text-foreground" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sheet-date">Date (optional)</Label>
            <Input id="sheet-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border-border bg-accent text-foreground [color-scheme:dark]" />
          </div>
          {error ? <p className="text-sm text-rose-400">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} className="bg-accent hover:bg-accent/80">Cancel</Button>
          <Button type="button" disabled={submitting} onClick={() => void handleSubmit()} className="border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40">
            {mode === 'create' ? 'Create' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

---

### Step 6 — Add column dialog

**File:** `components/trading/AddColumnDialog.tsx` — CREATE

```tsx
'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { SheetColumnType } from '@/lib/sheets/columns';
import { USER_COLUMN_TYPES } from '@/lib/sheets/grid';

interface AddColumnDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (column: { name: string; type: SheetColumnType; options?: string[] }) => Promise<void>;
}

export default function AddColumnDialog({ open, onOpenChange, onSubmit }: AddColumnDialogProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<SheetColumnType>('text');
  const [optionsText, setOptionsText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) { setName(''); setType('text'); setOptionsText(''); setError(null); setSubmitting(false); }
  }, [open]);

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) { setError('Name is required'); return; }
    const options = type === 'select'
      ? optionsText.split(/[\n,]/).map((o) => o.trim()).filter(Boolean)
      : undefined;
    setSubmitting(true);
    try {
      await onSubmit({ name: trimmed, type, options });
      onOpenChange(false);
    } catch {
      setError('Could not add column');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-card text-foreground sm:max-w-md">
        <DialogHeader><DialogTitle>Add Column</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="col-name">Name</Label>
            <Input id="col-name" value={name} onChange={(e) => setName(e.target.value)} className="border-border bg-accent text-foreground" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="col-type">Type</Label>
            <select
              id="col-type"
              value={type}
              onChange={(e) => setType(e.target.value as SheetColumnType)}
              className="h-9 w-full rounded-md border border-border bg-accent px-2 text-sm text-foreground [color-scheme:dark]"
            >
              {USER_COLUMN_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          {type === 'select' ? (
            <div className="space-y-2">
              <Label htmlFor="col-options">Options (one per line or comma-separated)</Label>
              <textarea
                id="col-options"
                value={optionsText}
                onChange={(e) => setOptionsText(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-border bg-accent px-2 py-1.5 text-sm text-foreground"
              />
            </div>
          ) : null}
          {error ? <p className="text-sm text-rose-400">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} className="bg-accent hover:bg-accent/80">Cancel</Button>
          <Button type="button" disabled={submitting} onClick={() => void handleSubmit()} className="border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40">Add</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

---

### Step 7 — SheetsTab (list rail + editable grid + toolbar)

**File:** `components/trading/SheetsTab.tsx` — CREATE

Self-contained (no props), like `CareerPnlTab`. Left rail = sheet list; main = active sheet header + toolbar + grid. Role gates the actions.

```tsx
'use client';

import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Columns3, Copy, FileSpreadsheet, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  DataGrid,
  SelectColumn,
  renderTextEditor,
  type Column,
  type RenderEditCellProps,
} from 'react-data-grid';

import AddColumnDialog from '@/components/trading/AddColumnDialog';
import SheetFormDialog from '@/components/trading/SheetFormDialog';
import { Button } from '@/components/ui/button';
import { useSheets } from '@/hooks/use-sheets';
import type { SheetColumn, SheetColumnType } from '@/lib/sheets/columns';
import {
  TEXT_EDIT_TYPES,
  gridRowsFromSheet,
  nextColumnKey,
  valuesFromGridRow,
  type GridRow,
} from '@/lib/sheets/grid';

function SelectCellEditor(
  { row, column, onRowChange, onClose, options }: RenderEditCellProps<GridRow> & { options: string[] },
) {
  return (
    <select
      autoFocus
      className="rdg-text-editor"
      value={(row[column.key] as string) ?? ''}
      onChange={(e) => onRowChange({ ...row, [column.key]: e.target.value }, true)}
      onBlur={() => onClose(true)}
    >
      <option value="" />
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

// Map one SheetColumn to a react-data-grid column. Checkbox commits directly
// (not through RDG edit mode) via onToggle. report/chart/action are read-only
// display in v1 (their interactive behavior lands with the Research import sprint).
function buildColumn(
  col: SheetColumn,
  canEdit: boolean,
  onToggle: (rowId: string, key: string, value: boolean) => void,
): Column<GridRow> {
  const base: Column<GridRow> = { key: col.key, name: col.name, width: col.width, resizable: true };

  if (col.type === 'checkbox') {
    return {
      ...base,
      renderCell: ({ row }) => (
        <input
          type="checkbox"
          checked={Boolean(row[col.key])}
          disabled={!canEdit}
          onChange={(e) => onToggle(row.__id, col.key, e.target.checked)}
          aria-label={col.name}
        />
      ),
    };
  }
  if (!canEdit || col.type === 'report' || col.type === 'chart' || col.type === 'action') {
    return base;
  }
  if (col.type === 'select') {
    return { ...base, renderEditCell: (props) => <SelectCellEditor {...props} options={col.options ?? []} /> };
  }
  if (TEXT_EDIT_TYPES.includes(col.type)) {
    return { ...base, renderEditCell: renderTextEditor };
  }
  return base;
}

export default function SheetsTab() {
  const sheets = useSheets();
  const [selectedRows, setSelectedRows] = useState<ReadonlySet<string>>(() => new Set());
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'rename'>('create');
  const [columnOpen, setColumnOpen] = useState(false);

  const { activeSheet, role, rows } = sheets;
  const canEditRows = role === 'owner' || role === 'editor';
  const canManage = role === 'owner';

  const gridRows = useMemo(() => gridRowsFromSheet(rows), [rows]);

  const gridColumns = useMemo<Column<GridRow>[]>(() => {
    if (!activeSheet) return [];
    const toggle = (rowId: string, key: string, value: boolean) => {
      const target = rows.find((r) => r.id === rowId);
      if (!target) return;
      void sheets.updateRow(rowId, { ...target.values, [key]: value });
    };
    const cols: Column<GridRow>[] = canEditRows ? [SelectColumn] : [];
    for (const col of activeSheet.columns) cols.push(buildColumn(col, canEditRows, toggle));
    return cols;
  }, [activeSheet, canEditRows, rows, sheets]);

  const handleRowsChange = (next: GridRow[], data: { indexes: number[] }) => {
    if (!activeSheet) return;
    for (const i of data.indexes) {
      const gr = next[i];
      void sheets.updateRow(gr.__id, valuesFromGridRow(gr, activeSheet.columns));
    }
  };

  const handleFormSubmit = async ({ name, sheetDate }: { name: string; sheetDate?: string }) => {
    if (formMode === 'create') await sheets.createSheet(name, sheetDate);
    else if (activeSheet) await sheets.renameSheet(activeSheet.id, name, sheetDate);
  };

  const handleAddColumn = async ({ name, type, options }: { name: string; type: SheetColumnType; options?: string[] }) => {
    if (!activeSheet) return;
    const column: SheetColumn = { key: nextColumnKey(name, activeSheet.columns), name, type };
    if (options && options.length > 0) column.options = options;
    await sheets.updateColumns([...activeSheet.columns, column]);
  };

  const visibleList = sheets.list.filter((s) => !s.archivedAt);

  return (
    <motion.div
      key="sheets"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="flex gap-4 px-1"
    >
      {/* Left rail: sheet list */}
      <aside className="w-60 shrink-0 rounded-2xl border border-border bg-card p-3">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Sheets</p>
          <button
            type="button"
            onClick={() => { setFormMode('create'); setFormOpen(true); }}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="New sheet"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-1">
          {sheets.listLoading ? (
            <p className="px-2 py-2 text-sm text-muted-foreground">Loading…</p>
          ) : visibleList.length === 0 ? (
            <p className="px-2 py-2 text-sm text-muted-foreground">No sheets yet.</p>
          ) : (
            visibleList.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => void sheets.openSheet(s.id)}
                className={`flex w-full flex-col rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                  activeSheet?.id === s.id ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                <span className="truncate font-medium">{s.name}</span>
                <span className="text-[11px] text-muted-foreground">
                  {s.sheetDate ?? '—'} · {s.role}
                </span>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* Main: active sheet */}
      <section className="min-w-0 flex-1">
        {!activeSheet ? (
          <div className="flex h-72 flex-col items-center justify-center rounded-2xl border border-border bg-card text-muted-foreground">
            <FileSpreadsheet className="mb-2 h-6 w-6" />
            <p className="text-sm">{sheets.detailLoading ? 'Loading…' : 'Select a sheet or create a new one.'}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
            {/* Header + actions */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold text-foreground">{activeSheet.name}</h2>
                <p className="text-xs text-muted-foreground">{activeSheet.sheetDate ?? 'No date'} · {role}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {canEditRows ? (
                  <Button type="button" onClick={() => void sheets.addRow()} className="h-8 border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20">
                    <Plus className="h-4 w-4" /> Row
                  </Button>
                ) : null}
                {canManage ? (
                  <Button type="button" onClick={() => setColumnOpen(true)} variant="secondary" className="h-8 bg-accent hover:bg-accent/80">
                    <Columns3 className="h-4 w-4" /> Column
                  </Button>
                ) : null}
                <Button
                  type="button"
                  onClick={() => void sheets.duplicateSheet(activeSheet.id, `Copy of ${activeSheet.name}`)}
                  variant="secondary"
                  className="h-8 bg-accent hover:bg-accent/80"
                >
                  <Copy className="h-4 w-4" /> Duplicate
                </Button>
                {canManage ? (
                  <Button type="button" onClick={() => { setFormMode('rename'); setFormOpen(true); }} variant="secondary" className="h-8 bg-accent hover:bg-accent/80">
                    <Pencil className="h-4 w-4" /> Rename
                  </Button>
                ) : null}
                {canEditRows && selectedRows.size > 0 ? (
                  <Button
                    type="button"
                    onClick={() => { void sheets.deleteRows([...selectedRows]); setSelectedRows(new Set()); }}
                    className="h-8 border border-rose-500/40 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20"
                  >
                    <Trash2 className="h-4 w-4" /> Delete ({selectedRows.size})
                  </Button>
                ) : null}
                {canManage ? (
                  <button
                    type="button"
                    onClick={() => { if (window.confirm('Delete this sheet? This cannot be undone.')) void sheets.deleteSheet(activeSheet.id); }}
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-rose-500/40 text-rose-400 transition-colors hover:bg-rose-500/10"
                    aria-label="Delete sheet"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            </div>

            {/* Grid */}
            <DataGrid
              className="sheets-grid"
              columns={gridColumns}
              rows={gridRows}
              rowKeyGetter={(r) => r.__id}
              onRowsChange={handleRowsChange}
              selectedRows={selectedRows}
              onSelectedRowsChange={setSelectedRows}
              style={{ blockSize: 480 }}
            />
            {gridRows.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground">
                No rows yet.{canEditRows ? ' Use “Row” to add one.' : ''}
              </p>
            ) : null}
          </div>
        )}
      </section>

      <SheetFormDialog
        open={formOpen}
        mode={formMode}
        initialName={formMode === 'rename' ? activeSheet?.name : ''}
        initialDate={formMode === 'rename' ? activeSheet?.sheetDate : ''}
        onOpenChange={setFormOpen}
        onSubmit={handleFormSubmit}
      />
      <AddColumnDialog open={columnOpen} onOpenChange={setColumnOpen} onSubmit={handleAddColumn} />
    </motion.div>
  );
}
```

> **Verify against installed types:** confirm `react-data-grid` exports `DataGrid`, `SelectColumn`, `renderTextEditor`, and the `Column` / `RenderEditCellProps` types, and that the edit-cell prop names are `onRowChange(row, commit)` + `onClose(commit)` in beta.59 (open `node_modules/react-data-grid/lib/index.d.ts`). If `renderTextEditor` was renamed, use the exported text editor under its current name. Do not invent an API — match the installed `.d.ts`.

**Acceptance:** viewer sees a read-only grid (no SelectColumn, no editors, no Row/Column/Delete actions); editor can add/edit/delete rows; owner can additionally add columns, rename, delete the sheet. Editing a cell PATCHes that row; a select column edits via dropdown; a checkbox column toggles inline.

---

### Step 8 — Wire the subtab into ManagementTab

**File:** `components/trading/ManagementTab.tsx` — MODIFY

1. Add the import (alphabetical with the others):
   ```ts
   import SheetsTab from '@/components/trading/SheetsTab';
   ```
2. Extend the union and the `SUB_TABS` array with a `sheets` entry (append last):
   ```ts
   type SubTabKey = 'journal' | 'trades' | 'performance' | 'playbook' | 'career-pnl' | 'archive' | 'sheets';
   ```
   ```ts
   { key: 'archive', label: 'Archive' },
   { key: 'sheets', label: 'Sheets' },
   ```
3. Render it at the end of the conditional block (it takes no props):
   ```tsx
   {activeSubTab === 'sheets' ? <SheetsTab /> : null}
   ```

**Acceptance:** a `Sheets` tab appears in Management and renders `SheetsTab`. No other tab's props change.

---

### Step 9 — Unit tests for the pure grid helpers

**File:** `__tests__/sheets-grid.test.ts` — CREATE

Vitest. Pure-function coverage only (no DOM / no RDG) — fast and deterministic.

```ts
import { describe, expect, it } from 'vitest';

import type { SheetColumn } from '@/lib/sheets/columns';
import { gridRowsFromSheet, nextColumnKey, slugifyColumnKey, valuesFromGridRow } from '@/lib/sheets/grid';

const columns: SheetColumn[] = [
  { key: 'ticker', name: 'Ticker', type: 'text' },
  { key: 'note', name: 'Note', type: 'text' },
];

describe('sheets grid helpers', () => {
  it('flattens sheet rows into grid rows with meta keys', () => {
    const grid = gridRowsFromSheet([
      { id: 'r1', position: 0, version: 3, values: { ticker: 'AAPL', note: 'hi' } },
    ]);
    expect(grid[0]).toEqual({ __id: 'r1', __version: 3, ticker: 'AAPL', note: 'hi' });
  });

  it('extracts only declared column keys back out (drops meta keys)', () => {
    const values = valuesFromGridRow(
      { __id: 'r1', __version: 1, ticker: 'AAPL', note: 'hi', stray: 'x' },
      columns,
    );
    expect(values).toEqual({ ticker: 'AAPL', note: 'hi' });
  });

  it('slugifies a name to a safe column key', () => {
    expect(slugifyColumnKey('Sub Bucket!')).toBe('sub_bucket');
    expect(slugifyColumnKey('  Bias  ')).toBe('bias');
  });

  it('avoids key collisions by suffixing', () => {
    expect(nextColumnKey('Note', columns)).toBe('note_2');
    expect(nextColumnKey('Theme', columns)).toBe('theme');
    expect(nextColumnKey('!!!', columns)).toBe('column');
  });
});
```

**Acceptance:** all four tests pass.

---

### Files Changed Summary

| File | Action | ~Lines | Risk |
|---|---|---|---|
| `package.json` / `package-lock.json` | INSTALL react-data-grid | — | Low |
| `app/globals.css` | MODIFY (import + theme block) | +~20 | Medium (theming) |
| `lib/sheets/grid.ts` | CREATE | ~55 | Low |
| `hooks/use-sheets.ts` | CREATE | ~190 | Medium |
| `components/trading/SheetFormDialog.tsx` | CREATE | ~70 | Low |
| `components/trading/AddColumnDialog.tsx` | CREATE | ~80 | Low |
| `components/trading/SheetsTab.tsx` | CREATE | ~230 | High (grid integration) |
| `components/trading/ManagementTab.tsx` | MODIFY | +3 | Low |
| `__tests__/sheets-grid.test.ts` | CREATE | ~45 | Low |

### Verification Steps

Run from repo root after implementation:

- [x] `npm install react-data-grid` (installed `react-data-grid@7.0.0-beta.59`; `package-lock.json` updated)
- [x] `npm run lint`
- [x] `npx tsc --noEmit`
- [x] `npm test` (new `sheets-grid` tests pass; full suite green: 103 files / 740 tests)

No migration this sprint (no schema change). `npm run typecheck:services` not required (no `services/` files).

Runtime smoke evidence:
- Dev server required escalation to bind localhost (`listen EPERM` in sandbox; escalated `npm run dev` succeeded on `http://localhost:3000`).
- HTTP smoke via escalated `curl`: `/` returns expected `307` to `/login?callbackUrl=...`; `/login` returns `200` and renders the Nexus Terminal sign-in shell.
- Authenticated visual/manual Sheets smoke could not be completed because the `agent-browser` CLI is not installed (`command not found`) and no callable replacement browser tool was available.

**Manual smoke (UI now exists — do this before marking complete):**
- [ ] Management → Sheets renders; the grid background matches the surrounding card and follows the theme (toggle light/dark — it flips, no white-on-dark or dark-on-light).
- [ ] Create a sheet → it opens with the six default columns.
- [ ] Add a row; edit a text cell → persists after refresh.
- [ ] Add a `select` column with options → dropdown editor works; add a `checkbox` column → toggle persists.
- [ ] Add a column, rename, duplicate, delete a row, delete the sheet — all work.

### Deferred to later sprints (do NOT build now)
- Member add/remove-by-email routes + the email→user lookup, and any share UI (Sprint 3).
- Templates / per-day "start today's sheet from a layout" flow beyond plain Duplicate (Sprint 3).
- Research "Add to Sheets" import + making `report`/`chart`/`action` cells interactive (Sprint 4).
- CSV export, archive/unarchive UI, undo/redo, polling/SSE invalidation, drag-reorder rows/columns.
- `AGENTS.md` update — defer until sharing + import land so we document the complete surface at once.

### Notes for Codex
- This is a large sprint; build it in the file order above (deps → CSS → helpers → hook → dialogs → tab → wiring → tests) so each layer compiles before the next depends on it.
- The only genuinely uncertain surface is the `react-data-grid` beta API + its CSS variable names. Where this spec says "verify against the installed types/styles," read the actual files in `node_modules/react-data-grid/` and match them — do not guess. If an API differs materially from this spec, stop and flag it rather than improvising a large workaround.

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

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
  type RowsChangeData,
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

function SelectCellEditor({
  row,
  column,
  onRowChange,
  onClose,
  options,
}: RenderEditCellProps<GridRow> & { options: string[] }) {
  return (
    <select
      autoFocus
      className="h-full w-full border-2 border-ring bg-card px-1 text-sm text-foreground outline-none"
      value={(row[column.key] as string) ?? ''}
      onChange={(event) => onRowChange({ ...row, [column.key]: event.target.value }, true)}
      onBlur={() => onClose(true)}
    >
      <option value="" />
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

function buildColumn(
  column: SheetColumn,
  canEdit: boolean,
  onToggle: (rowId: string, key: string, value: boolean) => void,
): Column<GridRow> {
  const base: Column<GridRow> = {
    key: column.key,
    name: column.name,
    width: column.width,
    resizable: true,
  };

  if (column.type === 'checkbox') {
    return {
      ...base,
      renderCell: ({ row }) => (
        <input
          type="checkbox"
          checked={Boolean(row[column.key])}
          disabled={!canEdit}
          onChange={(event) => onToggle(row.__id, column.key, event.target.checked)}
          aria-label={column.name}
        />
      ),
    };
  }

  if (!canEdit || column.type === 'report' || column.type === 'chart' || column.type === 'action') {
    return base;
  }

  if (column.type === 'select') {
    return {
      ...base,
      renderEditCell: (props) => <SelectCellEditor {...props} options={column.options ?? []} />,
    };
  }

  if (TEXT_EDIT_TYPES.includes(column.type)) {
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
      const target = rows.find((row) => row.id === rowId);
      if (!target) return;
      void sheets.updateRow(rowId, { ...target.values, [key]: value });
    };

    const columns: Column<GridRow>[] = canEditRows ? [SelectColumn] : [];
    for (const column of activeSheet.columns) {
      columns.push(buildColumn(column, canEditRows, toggle));
    }
    return columns;
  }, [activeSheet, canEditRows, rows, sheets]);

  const handleRowsChange = (nextRows: GridRow[], data: RowsChangeData<GridRow>) => {
    if (!activeSheet) return;

    for (const index of data.indexes) {
      const gridRow = nextRows[index];
      void sheets.updateRow(gridRow.__id, valuesFromGridRow(gridRow, activeSheet.columns));
    }
  };

  const handleFormSubmit = async ({ name, sheetDate }: { name: string; sheetDate?: string }) => {
    if (formMode === 'create') {
      await sheets.createSheet(name, sheetDate);
      setSelectedRows(new Set());
      return;
    }

    if (activeSheet) {
      await sheets.renameSheet(activeSheet.id, name, sheetDate);
    }
  };

  const handleAddColumn = async ({
    name,
    type,
    options,
  }: {
    name: string;
    type: SheetColumnType;
    options?: string[];
  }) => {
    if (!activeSheet) return;

    const column: SheetColumn = {
      key: nextColumnKey(name, activeSheet.columns),
      name,
      type,
    };
    if (options && options.length > 0) column.options = options;
    await sheets.updateColumns([...activeSheet.columns, column]);
  };

  const visibleList = sheets.list.filter((sheet) => !sheet.archivedAt);

  return (
    <motion.div
      key="sheets"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="flex flex-col gap-4 px-1 lg:flex-row"
    >
      <aside className="shrink-0 rounded-2xl border border-border bg-card p-3 lg:w-60">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Sheets</p>
          <button
            type="button"
            onClick={() => {
              setFormMode('create');
              setFormOpen(true);
            }}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="New sheet"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-1">
          {sheets.listLoading ? (
            <p className="px-2 py-2 text-sm text-muted-foreground">Loading...</p>
          ) : visibleList.length === 0 ? (
            <p className="px-2 py-2 text-sm text-muted-foreground">No sheets yet.</p>
          ) : (
            visibleList.map((sheet) => (
              <button
                key={sheet.id}
                type="button"
                onClick={() => {
                  setSelectedRows(new Set());
                  void sheets.openSheet(sheet.id);
                }}
                className={`flex w-full flex-col rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                  activeSheet?.id === sheet.id
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                <span className="truncate font-medium">{sheet.name}</span>
                <span className="text-[11px] text-muted-foreground">
                  {sheet.sheetDate ?? '-'} · {sheet.role}
                </span>
              </button>
            ))
          )}
        </div>
      </aside>

      <section className="min-w-0 flex-1">
        {!activeSheet ? (
          <div className="flex h-72 flex-col items-center justify-center rounded-2xl border border-border bg-card text-muted-foreground">
            <FileSpreadsheet className="mb-2 h-6 w-6" />
            <p className="text-sm">
              {sheets.detailLoading ? 'Loading...' : 'Select a sheet or create a new one.'}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold text-foreground">{activeSheet.name}</h2>
                <p className="text-xs text-muted-foreground">
                  {activeSheet.sheetDate ?? 'No date'} · {role}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {canEditRows ? (
                  <Button
                    type="button"
                    onClick={() => void sheets.addRow()}
                    className="h-8 border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
                  >
                    <Plus className="h-4 w-4" />
                    Row
                  </Button>
                ) : null}

                {canManage ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setColumnOpen(true)}
                    className="h-8 bg-accent hover:bg-accent/80"
                  >
                    <Columns3 className="h-4 w-4" />
                    Column
                  </Button>
                ) : null}

                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setSelectedRows(new Set());
                    void sheets.duplicateSheet(activeSheet.id, `Copy of ${activeSheet.name}`);
                  }}
                  className="h-8 bg-accent hover:bg-accent/80"
                >
                  <Copy className="h-4 w-4" />
                  Duplicate
                </Button>

                {canManage ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setFormMode('rename');
                      setFormOpen(true);
                    }}
                    className="h-8 bg-accent hover:bg-accent/80"
                  >
                    <Pencil className="h-4 w-4" />
                    Rename
                  </Button>
                ) : null}

                {canEditRows && selectedRows.size > 0 ? (
                  <Button
                    type="button"
                    onClick={() => {
                      void sheets.deleteRows([...selectedRows]);
                      setSelectedRows(new Set());
                    }}
                    className="h-8 border border-rose-500/40 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete ({selectedRows.size})
                  </Button>
                ) : null}

                {canManage ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm('Delete this sheet? This cannot be undone.')) {
                        void sheets.deleteSheet(activeSheet.id);
                      }
                    }}
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-rose-500/40 text-rose-400 transition-colors hover:bg-rose-500/10"
                    aria-label="Delete sheet"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            </div>

            <DataGrid<GridRow, unknown, string>
              className="sheets-grid"
              columns={gridColumns}
              rows={gridRows}
              rowKeyGetter={(row) => row.__id}
              onRowsChange={handleRowsChange}
              selectedRows={selectedRows}
              onSelectedRowsChange={setSelectedRows}
              style={{ blockSize: 480 }}
            />

            {gridRows.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground">
                No rows yet.{canEditRows ? ' Use Row to add one.' : ''}
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

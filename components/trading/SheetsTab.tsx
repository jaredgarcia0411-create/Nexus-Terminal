'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Columns3, Copy, FileSpreadsheet, FileText, LineChart, Pencil, Plus, Trash2, Users } from 'lucide-react';
import {
  DataGrid,
  SelectColumn,
  type Column,
  type RenderCellProps,
  type RowsChangeData,
} from 'react-data-grid';

import AddColumnDialog from '@/components/trading/AddColumnDialog';
import ShareSheetDialog from '@/components/trading/ShareSheetDialog';
import SheetFormDialog from '@/components/trading/SheetFormDialog';
import WatchlistReportInline from '@/components/trading/WatchlistReportInline';
import WatchlistSavePicker from '@/components/trading/WatchlistSavePicker';
import WatchlistTickerChart from '@/components/trading/WatchlistTickerChart';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useSheets } from '@/hooks/use-sheets';
import type { SampleSetRow } from '@/lib/sample-set-csv';
import type { SheetColumn, SheetColumnType } from '@/lib/sheets/columns';
import {
  TEXT_EDIT_TYPES,
  gridRowsFromSheet,
  nextColumnKey,
  valuesFromGridRow,
  type GridRow,
} from '@/lib/sheets/grid';

function SelectCell({
  row,
  column,
  onRowChange,
  options,
}: RenderCellProps<GridRow> & { options: string[] }) {
  return (
    <select
      className="h-full w-full border border-transparent bg-transparent px-1 text-sm text-foreground outline-none hover:border-primary/30 focus:border-primary/40 focus:bg-card"
      value={(row[column.key] as string) ?? ''}
      onChange={(event) => onRowChange({ ...row, [column.key]: event.target.value })}
      onKeyDown={(event) => event.stopPropagation()}
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

function DateCell({ row, column, onRowChange }: RenderCellProps<GridRow>) {
  return (
    <input
      type="date"
      className="h-full w-full border border-transparent bg-transparent px-1 text-sm text-foreground outline-none [color-scheme:dark] hover:border-primary/30 focus:border-primary/40 focus:bg-card"
      value={(row[column.key] as string) ?? ''}
      onChange={(event) => onRowChange({ ...row, [column.key]: event.target.value })}
      onKeyDown={(event) => event.stopPropagation()}
    />
  );
}

function TextCell({ row, column, onRowChange }: RenderCellProps<GridRow>) {
  const rawValue = String(row[column.key] ?? '');
  const [value, setValue] = useState(() => rawValue);

  useEffect(() => {
    setValue(rawValue);
  }, [rawValue]);

  const commit = () => {
    if (value !== rawValue) {
      onRowChange({ ...row, [column.key]: value });
    }
  };

  return (
    <input
      className="h-full w-full border border-transparent bg-transparent px-1 text-sm text-foreground outline-none placeholder:text-muted-foreground hover:border-primary/30 focus:border-primary/40 focus:bg-card"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          commit();
          event.currentTarget.blur();
        }
      }}
    />
  );
}

type CellActions = {
  openReport: (reportId: string) => void;
  openChart: (ticker: string, date: string) => void;
  addToSample: (ticker: string, date: string) => void;
};

function buildColumn(
  column: SheetColumn,
  canEdit: boolean,
  onToggle: (rowId: string, key: string, value: boolean) => void,
  actions: CellActions,
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

  if (column.type === 'report') {
    return {
      ...base,
      renderCell: ({ row }) => {
        const reportId = String(row[column.key] ?? '').trim();
        if (!reportId) {
          return <div className="flex items-center justify-center text-xs text-muted-foreground">—</div>;
        }
        return (
          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={() => actions.openReport(reportId)}
              className="rounded-md p-1 text-primary hover:bg-accent hover:text-primary/80"
              aria-label={`Open ${column.name}`}
              title="Open report"
            >
              <FileText className="h-4 w-4" />
            </button>
          </div>
        );
      },
    };
  }

  if (column.type === 'chart') {
    return {
      ...base,
      renderCell: ({ row }) => {
        const ticker = String(row.ticker ?? '').trim();
        const date = String(row.date ?? '').trim();
        if (!ticker || !date) {
          return <div className="flex items-center justify-center text-xs text-muted-foreground">—</div>;
        }
        return (
          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={() => actions.openChart(ticker, date)}
              className="rounded-md p-1 text-primary hover:bg-accent hover:text-primary/80"
              aria-label={`Open chart for ${ticker}`}
              title="Open chart"
            >
              <LineChart className="h-4 w-4" />
            </button>
          </div>
        );
      },
    };
  }

  if (column.type === 'action') {
    return {
      ...base,
      renderCell: ({ row }) => {
        const ticker = String(row.ticker ?? '').trim();
        const date = String(row.date ?? '').trim();
        if (!ticker) {
          return <div className="flex items-center justify-center text-xs text-muted-foreground">—</div>;
        }
        return (
          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={() => actions.addToSample(ticker, date)}
              className="rounded-md p-1 text-primary hover:bg-accent hover:text-primary/80"
              aria-label={`Add ${ticker} to sample set`}
              title="Save to sample set"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        );
      },
    };
  }

  if (!canEdit) {
    return base;
  }

  if (column.type === 'date') {
    return { ...base, renderCell: (props) => <DateCell {...props} /> };
  }

  if (column.type === 'select') {
    return {
      ...base,
      renderCell: (props) => <SelectCell {...props} options={column.options ?? []} />,
    };
  }

  if (TEXT_EDIT_TYPES.includes(column.type)) {
    return { ...base, renderCell: (props) => <TextCell {...props} /> };
  }

  return base;
}

export default function SheetsTab() {
  const sheets = useSheets();
  const [selectedRows, setSelectedRows] = useState<ReadonlySet<string>>(() => new Set());
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'rename'>('create');
  const [columnOpen, setColumnOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [reportDialog, setReportDialog] = useState<{ reportId: string } | null>(null);
  const [chartDialog, setChartDialog] = useState<{ ticker: string; date: string } | null>(null);
  const [savePickerRows, setSavePickerRows] = useState<SampleSetRow[] | null>(null);

  const { activeSheet, role, rows, members } = sheets;
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

    const actions: CellActions = {
      openReport: (reportId) => setReportDialog({ reportId }),
      openChart: (ticker, date) => setChartDialog({ ticker, date }),
      addToSample: (ticker, date) => setSavePickerRows([{ ticker, date }]),
    };

    const columns: Column<GridRow>[] = canEditRows ? [SelectColumn] : [];
    for (const column of activeSheet.columns) {
      columns.push(buildColumn(column, canEditRows, toggle, actions));
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
      <aside className="shrink-0 rounded-2xl border border-border bg-card p-3 lg:w-36">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-lg font-semibold text-foreground">Sheets</p>
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

                {canManage ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setShareOpen(true)}
                    className="h-8 bg-accent hover:bg-accent/80"
                  >
                    <Users className="h-4 w-4" />
                    Share
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
      {activeSheet ? (
        <ShareSheetDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          members={members}
          ownerUserId={activeSheet.ownerUserId}
          onAdd={sheets.addMember}
          onChangeRole={sheets.updateMemberRole}
          onRemove={sheets.removeMember}
        />
      ) : null}
      <Dialog open={!!reportDialog} onOpenChange={(open) => !open && setReportDialog(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto border-border bg-card text-foreground sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Research Report</DialogTitle>
          </DialogHeader>
          {reportDialog ? <WatchlistReportInline reportId={reportDialog.reportId} /> : null}
        </DialogContent>
      </Dialog>
      <Dialog open={!!chartDialog} onOpenChange={(open) => !open && setChartDialog(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto border-border bg-card text-foreground sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Chart</DialogTitle>
          </DialogHeader>
          {chartDialog ? <WatchlistTickerChart ticker={chartDialog.ticker} date={chartDialog.date} /> : null}
        </DialogContent>
      </Dialog>
      {savePickerRows ? (
        <WatchlistSavePicker
          open
          onOpenChange={(open) => !open && setSavePickerRows(null)}
          seedRows={savePickerRows}
        />
      ) : null}
    </motion.div>
  );
}

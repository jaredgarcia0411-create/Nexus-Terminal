'use client';

import { createContext, useContext, useEffect, useMemo, useState, type CSSProperties, type Key } from 'react';
import { format } from 'date-fns';
import { motion } from 'motion/react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronDown, Columns3, Copy, FileSpreadsheet, FileText, GripVertical, History, LineChart, ListPlus, Pencil, Plus, Trash2, Users, X } from 'lucide-react';
import {
  DataGrid,
  Row as GridRowRenderer,
  SelectColumn,
  type Column,
  type RenderCellProps,
  type RenderRowProps,
  type RowsChangeData,
} from 'react-data-grid';
import { toast } from 'sonner';

import AddColumnDialog from '@/components/trading/AddColumnDialog';
import ShareSheetDialog from '@/components/trading/ShareSheetDialog';
import SheetFormDialog from '@/components/trading/SheetFormDialog';
import WatchlistReportInline from '@/components/trading/WatchlistReportInline';
import WatchlistSavePicker from '@/components/trading/WatchlistSavePicker';
import WatchlistTickerChart from '@/components/trading/WatchlistTickerChart';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSheets } from '@/hooks/use-sheets';
import type { SheetListItem } from '@/hooks/use-sheets';
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
  addToWatchlist: (ticker: string, tag: string) => void;
  deleteColumn: (key: string) => void;
};

type SheetLineageGroup = {
  key: string;
  head: SheetListItem;
  pastVersions: SheetListItem[];
};

function sheetVersionTime(sheet: SheetListItem) {
  return Date.parse(sheet.sheetDate ?? sheet.updatedAt);
}

function groupSheetLineages(list: SheetListItem[]): SheetLineageGroup[] {
  const byLineage = new Map<string, SheetListItem[]>();
  for (const sheet of list) {
    const key = sheet.rootId ?? sheet.id;
    byLineage.set(key, [...(byLineage.get(key) ?? []), sheet]);
  }

  return [...byLineage.entries()]
    .map(([key, members]) => {
      const sorted = [...members].sort((a, b) => sheetVersionTime(b) - sheetVersionTime(a));
      const [head, ...pastVersions] = sorted;
      return { key, head, pastVersions };
    })
    .sort((a, b) => sheetVersionTime(b.head) - sheetVersionTime(a.head));
}

function buildColumn(
  column: SheetColumn,
  canEdit: boolean,
  canManage: boolean,
  onToggle: (rowId: string, key: string, value: boolean) => void,
  actions: CellActions,
): Column<GridRow> {
  const renderHeaderCell = canManage && !column.locked
    ? () => (
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
    )
    : undefined;

  const base: Column<GridRow> = {
    key: column.key,
    name: column.name,
    width: column.width,
    resizable: true,
    draggable: canManage,
    renderHeaderCell,
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

  if (column.type === 'watchlist') {
    return {
      ...base,
      renderCell: ({ row }) => {
        const ticker = String(row.ticker ?? '').trim();
        const tag = String(row.tag ?? '').trim();
        if (!ticker) {
          return <div className="flex items-center justify-center text-xs text-muted-foreground">—</div>;
        }
        return (
          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={() => actions.addToWatchlist(ticker, tag)}
              className="rounded-md p-1 text-primary hover:bg-accent hover:text-primary/80"
              aria-label={`Add ${ticker} to today's watchlist`}
              title="Add to watchlist"
            >
              <ListPlus className="h-4 w-4" />
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

type RowDragHandle = Pick<ReturnType<typeof useSortable>, 'attributes' | 'listeners'>;
const RowDragContext = createContext<RowDragHandle | null>(null);

// react-data-grid calls `renderRow(key, props)` as a plain function during its own render,
// so the `useSortable` hook must live in a real component it renders as JSX (each row gets its
// own hook list). Calling the hook directly in `renderRow` runs N hooks inside DataGrid's single
// render and crashes with "Rendered fewer hooks than expected" when the row count changes.
function DraggableRowRenderer(props: RenderRowProps<GridRow>) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.row.__id,
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  return (
    <RowDragContext.Provider value={{ attributes, listeners }}>
      <GridRowRenderer {...props} ref={setNodeRef} style={style} />
    </RowDragContext.Provider>
  );
}

function renderRow(key: Key, props: RenderRowProps<GridRow>) {
  return <DraggableRowRenderer key={key} {...props} />;
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
  const [tagOptions, setTagOptions] = useState<string[]>([]);

  const { activeSheet, role, rows, members } = sheets;
  const canEditRows = role === 'owner' || role === 'editor';
  const canManage = role === 'owner';

  const gridRows = useMemo(() => gridRowsFromSheet(rows), [rows]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Feed the user's global trade tags into the locked "Tag" select column so
  // sheet tags stay consistent with the tags used on trades.
  useEffect(() => {
    let cancelled = false;
    void fetch('/api/tags')
      .then((res) => (res.ok ? res.json() : { tags: [] }))
      .then((data: { tags?: string[] }) => {
        if (!cancelled) setTagOptions(data.tags ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

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
      addToWatchlist: (ticker, tag) => {
        const date = format(new Date(), 'yyyy-MM-dd');
        void fetch('/api/daily-reviews/append-watchlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date, ticker, tags: tag ? [tag] : [] }),
        })
          .then((res) => {
            if (res.ok) toast.success(`${ticker} added to today's watchlist`);
            else toast.error('Failed to add to watchlist');
          })
          .catch(() => toast.error('Failed to add to watchlist'));
      },
      deleteColumn: (key) => {
        if (window.confirm('Delete this column? Cell data in it will be hidden.')) {
          void sheets.updateColumns(activeSheet.columns.filter((column) => column.key !== key));
        }
      },
    };

    const dragColumn: Column<GridRow> = {
      key: '__drag',
      name: '',
      width: 36,
      minWidth: 36,
      frozen: true,
      renderCell: () => <DragHandle />,
    };
    const columns: Column<GridRow>[] = canEditRows ? [dragColumn, SelectColumn] : [];
    for (const column of activeSheet.columns) {
      const resolved = column.key === 'tag' ? { ...column, options: tagOptions } : column;
      columns.push(buildColumn(resolved, canEditRows, canManage, toggle, actions));
    }
    return columns;
  }, [activeSheet, canEditRows, canManage, rows, sheets, tagOptions]);

  const handleRowsChange = (nextRows: GridRow[], data: RowsChangeData<GridRow>) => {
    if (!activeSheet) return;

    for (const index of data.indexes) {
      const gridRow = nextRows[index];
      void sheets.updateRow(gridRow.__id, valuesFromGridRow(gridRow, activeSheet.columns));
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = gridRows.map((row) => row.__id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    void sheets.reorderRows(arrayMove(ids, from, to));
  };

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
  const lineageGroups = useMemo(() => groupSheetLineages(visibleList), [visibleList]);
  const activeLineageGroup = activeSheet
    ? lineageGroups.find((group) => group.key === (activeSheet.rootId ?? activeSheet.id))
    : null;
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
      renderers={canEditRows ? { renderRow } : undefined}
      style={{ blockSize: 480 }}
    />
  );

  return (
    <motion.div
      key="sheets"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="flex flex-col gap-3 px-1"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-card p-3">
        <div className="flex min-w-0 items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="secondary"
                className="min-w-48 justify-between bg-accent text-left hover:bg-accent/80"
                disabled={sheets.listLoading || lineageGroups.length === 0}
              >
                <span className="truncate">
                  {sheets.listLoading
                    ? 'Loading sheets'
                    : activeLineageGroup?.head.name ?? activeSheet?.name ?? 'Select sheet'}
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72 bg-popover text-popover-foreground">
              {lineageGroups.map((group) => (
                <DropdownMenuItem
                  key={group.key}
                  onSelect={() => {
                    setSelectedRows(new Set());
                    void sheets.openSheet(group.head.id);
                  }}
                  className="flex flex-col items-start gap-0.5"
                >
                  <span className="max-w-full truncate font-medium">{group.head.name}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {group.head.sheetDate ?? 'No date'} · {group.head.role}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {activeLineageGroup && activeLineageGroup.pastVersions.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  title="Past versions"
                  aria-label="Past versions"
                >
                  <History className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64 bg-popover text-popover-foreground">
                {activeLineageGroup.pastVersions.map((sheet) => (
                  <DropdownMenuItem
                    key={sheet.id}
                    onSelect={() => {
                      setSelectedRows(new Set());
                      void sheets.openSheet(sheet.id);
                    }}
                    className="flex flex-col items-start gap-0.5"
                  >
                    <span className="max-w-full truncate font-medium">{sheet.name}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {sheet.sheetDate ?? 'No date'} · {sheet.role}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {visibleList.length === 0 && !sheets.listLoading ? (
            <span className="text-sm text-muted-foreground">No sheets yet.</span>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setFormMode('create');
              setFormOpen(true);
            }}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="New sheet"
            title="New sheet"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

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
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold text-foreground">{activeSheet.name}</h2>
                <p className="text-xs text-muted-foreground">
                  {activeSheet.sheetDate ?? 'No date'} · {role}
                </p>
              </div>

              {canManage ? (
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm('Delete this sheet? This cannot be undone.')) {
                      void sheets.deleteSheet(activeSheet.id);
                    }
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-rose-500/40 text-rose-400 transition-colors hover:bg-rose-500/10"
                  title="Delete sheet"
                  aria-label="Delete sheet"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {canEditRows ? (
                <Button
                  type="button"
                  size="icon-sm"
                  onClick={() => void sheets.addRow()}
                  title="Add row"
                  aria-label="Add row"
                  className="border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              ) : null}

              {canManage ? (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="secondary"
                  onClick={() => setColumnOpen(true)}
                  title="Add column"
                  aria-label="Add column"
                  className="bg-accent hover:bg-accent/80"
                >
                  <Columns3 className="h-4 w-4" />
                </Button>
              ) : null}

              <Button
                type="button"
                size="icon-sm"
                variant="secondary"
                onClick={() => {
                  setSelectedRows(new Set());
                  void sheets.duplicateSheet(activeSheet.id, `Copy of ${activeSheet.name}`);
                }}
                title="Duplicate sheet"
                aria-label="Duplicate sheet"
                className="bg-accent hover:bg-accent/80"
              >
                <Copy className="h-4 w-4" />
              </Button>

              {canManage ? (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="secondary"
                  onClick={() => {
                    setFormMode('rename');
                    setFormOpen(true);
                  }}
                  title="Rename sheet"
                  aria-label="Rename sheet"
                  className="bg-accent hover:bg-accent/80"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              ) : null}

              {canManage ? (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="secondary"
                  onClick={() => setShareOpen(true)}
                  title="Share sheet"
                  aria-label="Share sheet"
                  className="bg-accent hover:bg-accent/80"
                >
                  <Users className="h-4 w-4" />
                </Button>
              ) : null}

              {canEditRows && selectedRows.size > 0 ? (
                <Button
                  type="button"
                  size="icon-sm"
                  onClick={() => {
                    void sheets.deleteRows([...selectedRows]);
                    setSelectedRows(new Set());
                  }}
                  title={`Delete ${selectedRows.size} selected row${selectedRows.size === 1 ? '' : 's'}`}
                  aria-label={`Delete ${selectedRows.size} selected rows`}
                  className="border border-rose-500/40 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              ) : null}
            </div>

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

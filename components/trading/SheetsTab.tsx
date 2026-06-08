'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type Key } from 'react';
import { createPortal } from 'react-dom';
import { useSession } from 'next-auth/react';
import { motion } from 'motion/react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Archive, ChevronDown, Columns3, FileSpreadsheet, FileText, Filter, GripVertical, History, LineChart, ListPlus, Pencil, Plus, RefreshCw, Rows3, Trash2, Upload, Users, X } from 'lucide-react';
import {
  DataGrid,
  Row as GridRowRenderer,
  SelectColumn,
  type Column,
  type ColumnWidths,
  type RenderCellProps,
  type RenderRowProps,
  type RowsChangeData,
} from 'react-data-grid';
import { toast } from 'sonner';

import AddColumnDialog from '@/components/trading/AddColumnDialog';
import BacktestChartWorkspace from '@/components/trading/BacktestChartWorkspace';
import ImportSheetDialog from '@/components/trading/ImportSheetDialog';
import ShareSheetDialog from '@/components/trading/ShareSheetDialog';
import SheetFormDialog from '@/components/trading/SheetFormDialog';
import WatchlistReportInline from '@/components/trading/WatchlistReportInline';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useSheets } from '@/hooks/use-sheets';
import type { SheetListItem } from '@/hooks/use-sheets';
import type { SheetColumn, SheetColumnType } from '@/lib/sheets/columns';
import { formatCompactShares, formatCompactUsd } from '@/lib/sheets/format';
import {
  TEXT_EDIT_TYPES,
  filterGridRows,
  gridRowsFromSheet,
  nextColumnKey,
  valuesFromGridRow,
  type GridRow,
  type SheetFilters,
  type SheetRowRecord,
} from '@/lib/sheets/grid';
import { getMassiveFillKeys, isEmptySheetCell, type MassiveFillKeys } from '@/lib/sheets/massive-fill';
import { epochToNySortKey } from '@/lib/time-utils';

function focusAdjacentEditableInput(input: HTMLInputElement, direction: -1 | 1, columnKey: string, rowIdx: number) {
  const gridCell = input.closest<HTMLElement>('[role="gridcell"]');
  const colIndex = gridCell?.getAttribute('aria-colindex');
  const row = input.closest<HTMLElement>('[role="row"]');
  const nextRow = direction === 1 ? row?.nextElementSibling : row?.previousElementSibling;
  if (nextRow instanceof HTMLElement && colIndex) {
    const target = nextRow.querySelector<HTMLInputElement>(
      `[role="gridcell"][aria-colindex="${colIndex}"] input`,
    );
    if (target) {
      target.focus();
      target.select();
      return;
    }
  }

  const fallback = document.querySelector<HTMLInputElement>(
    `input[data-cell="${columnKey}"][data-rowidx="${rowIdx + direction}"]`,
  );
  if (fallback) {
    fallback.focus();
    fallback.select();
  }
}

function isFilterableColumn(type: SheetColumnType) {
  return type === 'text' || type === 'number' || type === 'url' || type === 'date' || type === 'select' || type === 'checkbox';
}

function hasActiveFilter(type: SheetColumnType, value: string) {
  return type === 'checkbox' ? value === 'checked' || value === 'unchecked' : value.trim() !== '';
}

function FilterControl({
  column,
  value,
  onChange,
}: {
  column: SheetColumn;
  value: string;
  onChange: (value: string) => void;
}) {
  if (column.type === 'checkbox') {
    return (
      <select
        className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none [color-scheme:dark] focus:border-primary/40"
        value={value || 'all'}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => event.stopPropagation()}
        aria-label={`Filter ${column.name}`}
      >
        <option value="all">All</option>
        <option value="checked">Checked</option>
        <option value="unchecked">Unchecked</option>
      </select>
    );
  }

  return (
    <input
      type="text"
      className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/40"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => event.stopPropagation()}
      placeholder={`Filter ${column.name}`}
      aria-label={`Filter ${column.name}`}
    />
  );
}

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

const TOOLTIP_WIDTH = 256; // px — matches the w-64 on the tooltip box

function TextCell({ row, column, rowIdx, onRowChange }: RenderCellProps<GridRow>) {
  const rawValue = String(row[column.key] ?? '');
  const [value, setValue] = useState(() => rawValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const [tip, setTip] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    setValue(rawValue);
  }, [rawValue]);

  const commit = () => {
    if (value !== rawValue) {
      onRowChange({ ...row, [column.key]: value });
    }
  };

  // Only show the tooltip when the text is actually clipped by the cell, and
  // never while the cell is being edited. Clamp to the viewport so the fixed
  // width box never spills off the right edge.
  const showTip = () => {
    const el = inputRef.current;
    if (!el || el === document.activeElement || el.scrollWidth <= el.clientWidth) return;
    const rect = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - TOOLTIP_WIDTH - 8));
    setTip({ left, top: rect.bottom + 4 });
  };

  return (
    <>
      <input
        ref={inputRef}
        className="h-full w-full border border-transparent bg-transparent px-1 text-sm text-foreground outline-none placeholder:text-muted-foreground hover:border-primary/30 focus:border-primary/40 focus:bg-card"
        value={value}
        data-cell={column.key}
        data-rowidx={rowIdx}
        onChange={(event) => setValue(event.target.value)}
        onBlur={commit}
        onFocus={() => setTip(null)}
        onMouseEnter={showTip}
        onMouseLeave={() => setTip(null)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'Enter') {
            const direction = event.key === 'ArrowUp' ? -1 : 1;
            const target = event.currentTarget;
            event.preventDefault();
            commit();
            requestAnimationFrame(() => focusAdjacentEditableInput(target, direction, column.key, rowIdx));
          }
        }}
      />
      {tip
        ? createPortal(
            <div
              className="pointer-events-none fixed z-50 w-64 whitespace-pre-wrap break-words rounded-md border border-border bg-popover px-3 py-2 text-sm leading-relaxed text-popover-foreground shadow-md"
              style={{ left: tip.left, top: tip.top }}
            >
              {value}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

type CellActions = {
  openReport: (reportId: string) => void;
  openChart: (ticker: string, date: string, rowId: string) => void;
  addToWatchlist: (ticker: string, tag: string, reportId: string) => void;
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
      const head = members.find((member) => member.id === key) ?? sorted[0];
      const pastVersions = sorted.filter((member) => member.id !== head.id);
      return { key, head, pastVersions };
    })
    .sort((a, b) => sheetVersionTime(b.head) - sheetVersionTime(a.head));
}

async function fetchSheetRResults(sheetId: string): Promise<Record<string, number | null>> {
  const res = await fetch(`/api/sheets/${sheetId}/r-results`);
  if (!res.ok) return {};
  const data = await res.json() as { results?: Record<string, number | null> };
  return data.results ?? {};
}

function numericCellValue(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function ReadOnlyCompactNumberCell({
  value,
  formatter,
}: {
  value: unknown;
  formatter: (value: number) => string;
}) {
  const numeric = numericCellValue(value);
  if (numeric == null) {
    return <div className="flex items-center justify-center text-xs text-muted-foreground">—</div>;
  }

  return (
    <div
      className="flex h-full items-center justify-end pr-2 font-mono text-sm tabular-nums text-foreground"
      title={String(numeric)}
    >
      {formatter(numeric)}
    </div>
  );
}

function getMassiveCandidateRowIds(rows: SheetRowRecord[], keys: MassiveFillKeys, today: string): string[] {
  const rowIds: string[] = [];
  for (const row of rows) {
    const ticker = String(row.values.ticker ?? '').trim();
    if (!ticker) continue;

    const date = String(row.values.date ?? '').trim();
    const needsVolume = Boolean(
      date
      && (
        (keys.shareKey && isEmptySheetCell(row.values[keys.shareKey]))
        || (keys.dollarKey && isEmptySheetCell(row.values[keys.dollarKey]))
      ),
    );
    const needsFloat = Boolean(
      date === today
      && keys.floatKey
      && isEmptySheetCell(row.values[keys.floatKey]),
    );

    if (needsVolume || needsFloat) rowIds.push(row.id);
  }
  return rowIds;
}

// Every column needs an explicit pixel width. Without one, react-data-grid
// treats the column as flexible (it shares leftover space), so resizing one
// column makes all the other flexible columns recompute their widths — the
// "weird inconsistent resize" behavior. Fixed widths mean a drag only moves
// the neighboring columns, never resizes them.
function defaultColumnWidth(type: SheetColumnType): number {
  switch (type) {
    case 'checkbox':
    case 'report':
    case 'chart':
    case 'action':
    case 'watchlist':
      return 90; // icon / single-control columns stay narrow
    case 'rmultiple':
      return 80;
    case 'share_volume':
    case 'dollar_volume':
    case 'float':
      return 110;
    case 'date':
      return 130;
    case 'select':
      return 140;
    default:
      return 160; // text, number, url
  }
}

// Read saved widths for a sheet from localStorage and shape them into the
// ColumnWidths Map RDG expects. Stored as a plain { columnKey: pixels } object.
function loadColumnWidths(sheetId: string | null): ColumnWidths {
  if (!sheetId || typeof window === 'undefined') return new Map();
  try {
    const raw = window.localStorage.getItem(`sheets:widths:${sheetId}`);
    const saved = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    return new Map(Object.entries(saved).map(([key, width]) => [key, { type: 'resized', width }]));
  } catch {
    return new Map();
  }
}

function buildColumn(
  column: SheetColumn,
  canEdit: boolean,
  canManage: boolean,
  filterMode: boolean,
  filterValue: string,
  setFilter: (key: string, value: string) => void,
  onToggle: (rowId: string, key: string, value: boolean) => void,
  actions: CellActions,
  rResults: Record<string, number | null>,
): Column<GridRow> {
  const renderHeaderCell = filterMode && isFilterableColumn(column.type)
    ? () => (
      <div className="flex h-full items-center justify-between gap-1">
        <span className="truncate">{column.name}</span>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
              className={
                hasActiveFilter(column.type, filterValue)
                  ? 'shrink-0 rounded border border-primary/40 bg-primary/10 p-0.5 text-primary'
                  : 'shrink-0 rounded border border-transparent p-0.5 text-muted-foreground transition hover:bg-accent hover:text-foreground'
              }
              aria-label={`Filter ${column.name}`}
              title={`Filter ${column.name}`}
            >
              <Filter className="h-3.5 w-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-56 border-border bg-popover p-2 text-popover-foreground"
            onKeyDown={(event) => event.stopPropagation()}
          >
            <FilterControl
              column={column}
              value={filterValue}
              onChange={(value) => setFilter(column.key, value)}
            />
          </PopoverContent>
        </Popover>
      </div>
    )
    : canManage && !column.locked
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
    width: column.width ?? defaultColumnWidth(column.type),
    minWidth: 60,
    resizable: !filterMode,
    draggable: canManage && !filterMode,
    // Pin the ticker column so it stays visible when scrolling right. RDG
    // auto-sorts frozen columns to the left next to the drag/checkbox columns,
    // so this one flag is all that's needed.
    frozen: column.key === 'ticker',
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
              onClick={() => actions.openChart(ticker, date, String(row.__id))}
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

  if (column.type === 'rmultiple') {
    return {
      ...base,
      renderCell: ({ row }) => {
        const r = rResults[row.__id];
        if (r == null || !Number.isFinite(r)) {
          return <div className="flex items-center justify-center text-xs text-muted-foreground">—</div>;
        }
        const sign = r > 0 ? '+' : '';
        return (
          <div className={`flex h-full items-center justify-end pr-2 font-mono text-sm tabular-nums ${
            r > 0 ? 'text-emerald-400' : r < 0 ? 'text-rose-400' : 'text-muted-foreground'
          }`}>
            {sign}{r.toFixed(2)}R
          </div>
        );
      },
    };
  }

  if (column.type === 'share_volume') {
    return {
      ...base,
      renderCell: ({ row }) => (
        <ReadOnlyCompactNumberCell value={row[column.key]} formatter={formatCompactShares} />
      ),
    };
  }

  if (column.type === 'dollar_volume') {
    return {
      ...base,
      renderCell: ({ row }) => (
        <ReadOnlyCompactNumberCell value={row[column.key]} formatter={formatCompactUsd} />
      ),
    };
  }

  if (column.type === 'watchlist') {
    return {
      ...base,
      renderCell: ({ row }) => {
        const ticker = String(row.ticker ?? '').trim();
        const tag = String(row.tag ?? '').trim();
        // Carry the row's research report into the watchlist so the report
        // eye-icon resolves there. `research_report` is the locked report
        // column's key (see DEFAULT_SHEET_COLUMNS); empty when the row has none.
        const reportId = String(row.research_report ?? '').trim();
        if (!ticker) {
          return <div className="flex items-center justify-center text-xs text-muted-foreground">—</div>;
        }
        return (
          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={() => actions.addToWatchlist(ticker, tag, reportId)}
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
  const { data: session } = useSession();
  const currentUserId = (session?.user as { id?: string | null } | undefined)?.id ?? null;
  const sheets = useSheets();
  const { activeSheet, role, rows, members } = sheets;
  const sheetId = activeSheet?.id ?? null;
  const [selectedRows, setSelectedRows] = useState<ReadonlySet<string>>(() => new Set());
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'rename'>('create');
  const [importOpen, setImportOpen] = useState(false);
  const [columnOpen, setColumnOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [reportDialog, setReportDialog] = useState<{ reportId: string } | null>(null);
  const [chartDialog, setChartDialog] = useState<{ ticker: string; date: string; rowId: string } | null>(null);
  const [tagOptions, setTagOptions] = useState<string[]>([]);
  const [rResults, setRResults] = useState<Record<string, number | null>>({});
  // Per-user, per-browser column widths. RDG runs in "controlled width" mode:
  // we own this Map, feed it in via `columnWidths`, and update it on resize.
  // Columns not in the Map fall back to their default width.
  const [columnWidths, setColumnWidths] = useState<ColumnWidths>(() => new Map());
  const [filterMode, setFilterMode] = useState(false);
  const [filters, setFilters] = useState<SheetFilters>({});
  const [loadedRResultsSheetId, setLoadedRResultsSheetId] = useState<string | null>(sheetId);
  const [fillingMassive, setFillingMassive] = useState(false);

  const canEditRows = role === 'owner' || role === 'editor';
  const canManage = role === 'owner';
  const today = epochToNySortKey(Date.now());
  const sheetDisplayDate = (sheet: { rootId: string | null; sheetDate: string | null }) =>
    sheet.rootId === null ? today : sheet.sheetDate ?? 'No date';
  const massiveFillKeys = useMemo<MassiveFillKeys>(
    () => (activeSheet ? getMassiveFillKeys(activeSheet.columns) : {}),
    [activeSheet],
  );
  const hasMassiveFillColumns = Boolean(
    massiveFillKeys.shareKey || massiveFillKeys.dollarKey || massiveFillKeys.floatKey,
  );

  const gridRows = useMemo(() => gridRowsFromSheet(rows), [rows]);
  const visibleRows = useMemo(
    () => (filterMode && activeSheet ? filterGridRows(gridRows, activeSheet.columns, filters) : gridRows),
    [activeSheet, filterMode, filters, gridRows],
  );
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

  const loadRResults = useCallback(() => {
    if (!sheetId) {
      setRResults({});
      return;
    }

    void fetchSheetRResults(sheetId)
      .then(setRResults)
      .catch(() => setRResults({}));
  }, [sheetId]);

  if (sheetId !== loadedRResultsSheetId) {
    setLoadedRResultsSheetId(sheetId);
    if (Object.keys(rResults).length > 0) setRResults({});
  }

  useEffect(() => {
    let cancelled = false;
    if (!sheetId) return undefined;
    void fetchSheetRResults(sheetId)
      .then((results) => {
        if (!cancelled) setRResults(results);
      })
      .catch(() => {
        if (!cancelled) setRResults({});
      });
    return () => {
      cancelled = true;
    };
  }, [sheetId]);

  // Reload saved widths whenever the open sheet changes. Adjusting state during
  // render (tracking the last loaded sheet id) is React's recommended pattern
  // for "reset state when a prop changes" — it avoids an effect + cascading render.
  const [loadedWidthsSheetId, setLoadedWidthsSheetId] = useState<string | null>(sheetId);
  if (sheetId !== loadedWidthsSheetId) {
    setLoadedWidthsSheetId(sheetId);
    setColumnWidths(loadColumnWidths(sheetId));
  }

  // RDG hands us the full next Map on every resize. Keep it in state (controlled
  // mode) and persist only user-resized columns so we never pin auto-sized ones.
  const handleColumnWidthsChange = (widths: ColumnWidths) => {
    setColumnWidths(widths);
    if (!sheetId) return;
    const resized: Record<string, number> = {};
    for (const [key, value] of widths) {
      if (value.type === 'resized') resized[key] = value.width;
    }
    try {
      localStorage.setItem(`sheets:widths:${sheetId}`, JSON.stringify(resized));
    } catch {
      // localStorage can throw (private mode / quota); widths just won't persist.
    }
  };

  const toggleFilterMode = () => {
    // Clear selection whenever the filtered view changes, so a stale selection
    // from a previous filter can't be deleted by accident.
    setSelectedRows(new Set());
    if (filterMode) {
      setFilterMode(false);
      setFilters({});
      return;
    }

    setFilterMode(true);
  };

  const gridColumns = useMemo<Column<GridRow>[]>(() => {
    if (!activeSheet) return [];

    const toggle = (rowId: string, key: string, value: boolean) => {
      const target = rows.find((row) => row.id === rowId);
      if (!target) return;
      void sheets.updateRow(rowId, { ...target.values, [key]: value });
    };

    const actions: CellActions = {
      openReport: (reportId) => setReportDialog({ reportId }),
      openChart: (ticker, date, rowId) => setChartDialog({ ticker, date, rowId }),
      addToWatchlist: (ticker, tag, reportId) => {
        void fetch('/api/daily-reviews/append-watchlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date: today,
            ticker,
            tags: tag ? [tag] : [],
            ...(reportId ? { reportId } : {}),
          }),
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
    const setColumnFilter = (key: string, value: string) => {
      setSelectedRows(new Set());
      setFilters((current) => ({ ...current, [key]: value }));
    };

    const dragColumn: Column<GridRow> = {
      key: '__drag',
      name: '',
      width: 36,
      minWidth: 36,
      frozen: true,
      renderCell: () => <DragHandle />,
    };
    // Keep the selection checkbox available while filtering so rows can be
    // selected + deleted from a filtered subset. Only the drag handle drops in
    // filter mode (reordering a filtered view is meaningless).
    const columns: Column<GridRow>[] = canEditRows
      ? filterMode
        ? [SelectColumn]
        : [dragColumn, SelectColumn]
      : [];
    for (const column of activeSheet.columns) {
      const resolved = column.key === 'tag' ? { ...column, options: tagOptions } : column;
      columns.push(
        buildColumn(
          resolved,
          canEditRows,
          canManage,
          filterMode,
          filters[resolved.key] ?? '',
          setColumnFilter,
          toggle,
          actions,
          rResults,
        ),
      );
    }
    return columns;
  }, [activeSheet, canEditRows, canManage, filterMode, filters, rResults, rows, sheets, tagOptions, today]);

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

  const handleFillMassive = async () => {
    if (!activeSheet || fillingMassive) return;

    const candidates = getMassiveCandidateRowIds(rows, massiveFillKeys, today);
    if (candidates.length === 0) {
      toast.info('Nothing to fill');
      return;
    }

    setFillingMassive(true);
    const toastId = toast.loading(`Filled 0 · ${candidates.length} left...`);
    let filled = 0;
    let missed = 0;

    try {
      for (let index = 0; index < candidates.length; index += 40) {
        const batch = candidates.slice(index, index + 40);
        const result = await sheets.fillMassive(batch);
        filled += result.filled;
        missed += result.missed;
        const left = Math.max(0, candidates.length - index - batch.length);
        if (left > 0) {
          toast.loading(`Filled ${filled} · ${left} left...`, { id: toastId });
        }
      }

      toast.success(`Filled ${filled} · ${missed} unavailable`, { id: toastId });
    } catch {
      toast.dismiss(toastId);
    } finally {
      setFillingMassive(false);
    }
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
      rows={visibleRows}
      rowKeyGetter={(row) => row.__id}
      onRowsChange={handleRowsChange}
      columnWidths={columnWidths}
      onColumnWidthsChange={handleColumnWidthsChange}
      selectedRows={selectedRows}
      onSelectedRowsChange={setSelectedRows}
      onColumnsReorder={canManage && !filterMode ? handleColumnsReorder : undefined}
      renderers={canEditRows && !filterMode ? { renderRow } : undefined}
      style={{ blockSize: 480 }}
    />
  );

  return (
    <motion.div
      key="sheets"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="-mx-5 flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
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
                    {sheetDisplayDate(group.head)} · {group.head.role}
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
                      {sheetDisplayDate(sheet)} · {sheet.role}
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
          {canManage && activeSheet ? (
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Delete this sheet? This cannot be undone.')) {
                  void sheets.deleteSheet(activeSheet.id);
                }
              }}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-rose-500/40 text-rose-400 transition-colors hover:bg-rose-500/10"
              aria-label="Delete sheet"
              title="Delete sheet"
            >
              <Trash2 className="h-4 w-4" />
            </button>
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
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            disabled={!currentUserId}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Import CSV"
            title="Import CSV"
          >
            <Upload className="h-4 w-4" />
          </button>
        </div>
      </div>

      <section className="min-w-0 flex-1">
        {!activeSheet ? (
          <div className="flex h-72 flex-col items-center justify-center text-muted-foreground">
            <FileSpreadsheet className="mb-2 h-6 w-6" />
            <p className="text-sm">
              {sheets.detailLoading ? 'Loading...' : 'Select a sheet or create a new one.'}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 border border-border bg-card px-2 py-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex items-baseline gap-2">
                <h2 className="text-lg font-semibold text-foreground">{activeSheet.name}</h2>
                <span className="text-lg font-semibold text-foreground">
                  {sheetDisplayDate(activeSheet)}
                </span>
                <span className="text-xs font-medium capitalize text-muted-foreground">{role}</span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
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

                {canEditRows ? (
                  <Button
                    type="button"
                    size="icon-sm"
                    onClick={() => void sheets.addRow()}
                    title="Add row"
                    aria-label="Add row"
                    className="border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
                  >
                    <Rows3 className="h-4 w-4" />
                  </Button>
                ) : null}

                {canManage ? (
                  <Button
                    type="button"
                    size="icon-sm"
                    onClick={() => setColumnOpen(true)}
                    title="Add column"
                    aria-label="Add column"
                    className="border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
                  >
                    <Columns3 className="h-4 w-4" />
                  </Button>
                ) : null}

                <Button
                  type="button"
                  size="icon-sm"
                  onClick={() => void handleFillMassive()}
                  disabled={!canEditRows || !hasMassiveFillColumns || fillingMassive}
                  title="Fill data"
                  aria-label="Fill data"
                  className="border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40"
                >
                  <RefreshCw className={`h-4 w-4 ${fillingMassive ? 'animate-spin' : ''}`} />
                </Button>

                <Button
                  type="button"
                  size="icon-sm"
                  variant="secondary"
                  onClick={toggleFilterMode}
                  title="Filter"
                  aria-label="Filter"
                  aria-pressed={filterMode}
                  className={
                    filterMode
                      ? 'border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20'
                      : 'bg-accent hover:bg-accent/80'
                  }
                >
                  <Filter className="h-4 w-4" />
                </Button>

                {canManage && !activeSheet.rootId ? (
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="secondary"
                    onClick={() => {
                      if (window.confirm('Save a dated snapshot and clear this sheet for today?')) {
                        setSelectedRows(new Set());
                        void sheets.snapshotSheet(activeSheet.id, today);
                      }
                    }}
                    title="Snapshot & reset"
                    aria-label="Snapshot and reset"
                    className="bg-accent hover:bg-accent/80"
                  >
                    <Archive className="h-4 w-4" />
                  </Button>
                ) : null}

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
              </div>
            </div>

            {canEditRows && !filterMode ? (
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
      <ImportSheetDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImport={async (payload) => {
          const sheet = await sheets.importSheet(payload);
          setSelectedRows(new Set());
          return sheet;
        }}
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
      <Dialog
        open={!!chartDialog}
        onOpenChange={(open) => {
          if (!open) {
            setChartDialog(null);
            void loadRResults();
          }
        }}
      >
        <DialogContent className="h-[100dvh] w-screen max-w-none gap-0 rounded-none border-0 bg-background p-0 text-foreground sm:max-w-none">
          <DialogHeader className="sr-only">
            <DialogTitle>Chart</DialogTitle>
          </DialogHeader>
          {chartDialog ? (
            <div className="flex h-full min-h-0 flex-col overflow-hidden p-3 pt-9">
              <BacktestChartWorkspace
                key={`${chartDialog.rowId}:${chartDialog.ticker}:${chartDialog.date}`}
                ticker={chartDialog.ticker}
                date={chartDialog.date}
                sheetRowId={chartDialog.rowId}
                currentUserId={currentUserId}
                onAnchorChange={(date) => setChartDialog((current) => (current ? { ...current, date } : current))}
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}

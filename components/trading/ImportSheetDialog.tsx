'use client';

import { useMemo, useState } from 'react';
import Papa from 'papaparse';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { SheetColumnType } from '@/lib/sheets/columns';
import {
  buildImportPayload,
  detectImportColumns,
  type ImportColumnDraft,
} from '@/lib/sheets/import';
import { USER_COLUMN_TYPES } from '@/lib/sheets/grid';
import type { SheetImportBody } from '@/lib/validations/sheets';

type ImportSheetDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (payload: SheetImportBody) => Promise<unknown>;
};

function filenameToSheetName(filename: string): string {
  return filename.replace(/\.[^.]+$/, '').trim() || 'Imported Sheet';
}

function splitOptions(text: string): string[] {
  return text.split(/[\n,]/).map((option) => option.trim()).filter(Boolean);
}

export default function ImportSheetDialog({ open, onOpenChange, onImport }: ImportSheetDialogProps) {
  const [sheetName, setSheetName] = useState('');
  const [drafts, setDrafts] = useState<ImportColumnDraft[]>([]);
  const [dataRows, setDataRows] = useState<string[][]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setSheetName('');
    setDrafts([]);
    setDataRows([]);
    setError(null);
    setSubmitting(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  };

  const preview = useMemo(() => buildImportPayload(drafts, dataRows), [dataRows, drafts]);
  const keptColumns = preview.columns.length;
  const guardError = keptColumns > 40
    ? 'Import keeps more than 40 columns. Drop columns before importing.'
    : dataRows.length > 2000
      ? 'CSV has more than 2000 data rows.'
      : null;
  const canImport = Boolean(sheetName.trim()) && drafts.length > 0 && !guardError && !submitting;

  const updateDraft = (index: number, patch: Partial<ImportColumnDraft>) => {
    setDrafts((current) => current.map((draft, draftIndex) => (
      draftIndex === index ? { ...draft, ...patch } : draft
    )));
  };

  const handleFileChange = async (file: File | null) => {
    if (!file) return;
    setError(null);
    setSheetName(filenameToSheetName(file.name));

    try {
      const text = await file.text();
      const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true });
      if (parsed.errors.length > 0) {
        setError(parsed.errors[0]?.message ?? 'Could not parse CSV');
      }

      const rows = parsed.data;
      const headers = [...(rows[0] ?? [])];
      if (headers[0]) headers[0] = headers[0].replace(/^\uFEFF/, '');
      const bodyRows = rows.slice(1);

      setDrafts(detectImportColumns(headers, bodyRows));
      setDataRows(bodyRows);
    } catch {
      setDrafts([]);
      setDataRows([]);
      setError('Could not read CSV file');
    }
  };

  const handleImport = async () => {
    const trimmedName = sheetName.trim();
    if (!trimmedName) {
      setError('Sheet name is required');
      return;
    }
    if (guardError) {
      setError(guardError);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const { columns, rows, skipped } = buildImportPayload(drafts, dataRows);
      await onImport({ name: trimmedName, columns, rows });
      handleOpenChange(false);
      toast.success(`Imported ${rows.length} rows${skipped ? ` · ${skipped} skipped` : ''}`);
    } catch {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className={`max-h-[85vh] overflow-y-auto border-border bg-card text-foreground ${drafts.length > 0 ? 'sm:max-w-5xl' : 'sm:max-w-md'}`}>
        <DialogHeader>
          <DialogTitle>Import CSV</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="sheet-import-file">CSV file</Label>
              <Input
                id="sheet-import-file"
                type="file"
                accept=".csv"
                onChange={(event) => void handleFileChange(event.target.files?.[0] ?? null)}
                className="border-border bg-accent text-foreground file:text-foreground"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="sheet-import-name">Sheet name</Label>
              <Input
                id="sheet-import-name"
                value={sheetName}
                onChange={(event) => setSheetName(event.target.value)}
                className="border-border bg-accent text-foreground"
              />
            </div>
          </div>

          {drafts.length > 0 ? (
            <div className="overflow-x-auto border border-border">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-border bg-accent/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Header</th>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 font-medium">Options</th>
                    <th className="px-3 py-2 text-center font-medium">Drop</th>
                  </tr>
                </thead>
                <tbody>
                  {drafts.map((draft, index) => {
                    const lockedLabel = draft.lockedKey === 'date'
                      ? '→ Date'
                      : draft.lockedKey === 'ticker'
                        ? '→ Ticker'
                        : null;

                    return (
                      <tr key={`${draft.header}:${index}`} className="border-b border-border/70 last:border-0">
                        <td className="max-w-48 px-3 py-2 text-muted-foreground">
                          <span className="block truncate" title={draft.header || '(blank)'}>
                            {draft.header || '(blank)'}
                          </span>
                          {lockedLabel ? (
                            <span className="text-xs text-primary">{lockedLabel}</span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            value={draft.name}
                            disabled={draft.drop}
                            onChange={(event) => updateDraft(index, { name: event.target.value })}
                            className="h-8 min-w-40 border-border bg-accent text-foreground disabled:opacity-50"
                            aria-label={`Column name for ${draft.header || 'blank header'}`}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={draft.type}
                            disabled={Boolean(draft.lockedKey) || draft.drop}
                            onChange={(event) => updateDraft(index, { type: event.target.value as SheetColumnType })}
                            className="h-8 min-w-36 rounded-md border border-border bg-popover px-2 text-sm text-popover-foreground [color-scheme:dark] disabled:opacity-50"
                            aria-label={`Column type for ${draft.header || 'blank header'}`}
                          >
                            {USER_COLUMN_TYPES.map((columnType) => (
                              <option key={columnType} value={columnType}>
                                {columnType}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          {draft.type === 'select' && !draft.drop ? (
                            <textarea
                              value={draft.optionsText ?? (draft.options ?? []).join('\n')}
                              onChange={(event) => updateDraft(index, {
                                optionsText: event.target.value,
                                options: splitOptions(event.target.value),
                              })}
                              rows={2}
                              className="min-w-48 rounded-md border border-border bg-popover px-2 py-1.5 text-sm text-popover-foreground [color-scheme:dark]"
                              aria-label={`Select options for ${draft.header || 'blank header'}`}
                            />
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={draft.drop}
                            disabled={Boolean(draft.lockedKey)}
                            onChange={(event) => updateDraft(index, { drop: event.target.checked })}
                            aria-label={`Drop ${draft.header || 'blank header'}`}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}

          {drafts.length > 0 ? (
            <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <span>{dataRows.length} data rows</span>
              <span>{keptColumns} kept columns</span>
              <span>{preview.skipped} ticker-less skipped</span>
            </div>
          ) : null}

          {error || guardError ? (
            <p className="text-sm text-rose-400">{error ?? guardError}</p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => handleOpenChange(false)}
            className="bg-accent hover:bg-accent/80"
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!canImport}
            onClick={() => void handleImport()}
            className="border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40"
          >
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

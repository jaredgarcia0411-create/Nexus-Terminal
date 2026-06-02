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
  rootId: string | null;
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
  rootId: string | null;
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
        sheet: Sheet;
        rows: SheetRowRecord[];
        members: SheetMember[];
        role: SheetRole;
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
    if (!res.ok) {
      toast.error('Failed to create sheet');
      throw new Error(`create failed: ${res.status}`);
    }

    const data = (await res.json()) as { sheet: Sheet };
    await refreshList();
    await openSheet(data.sheet.id);
    toast.success('Sheet created');
  }, [openSheet, refreshList]);

  const renameSheet = useCallback(async (id: string, name: string, sheetDate?: string) => {
    const res = await sendJson(`/api/sheets/${id}`, { name, sheetDate: sheetDate ?? null }, 'PATCH');
    if (!res.ok) {
      toast.error('Failed to rename sheet');
      throw new Error(`rename failed: ${res.status}`);
    }

    const data = (await res.json()) as { sheet: Sheet };
    setActiveSheet((current) => (current && current.id === id ? data.sheet : current));
    await refreshList();
  }, [refreshList]);

  const snapshotSheet = useCallback(async (id: string, date: string) => {
    const res = await sendJson(`/api/sheets/${id}/snapshot`, { date });
    if (!res.ok) {
      toast.error('Failed to snapshot sheet');
      return;
    }

    await refreshList();
    await openSheet(id);
    toast.success('Snapshot saved; sheet cleared for today');
  }, [openSheet, refreshList]);

  const deleteSheet = useCallback(async (id: string) => {
    const res = await fetch(`/api/sheets/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      toast.error('Failed to delete sheet');
      return;
    }

    setActiveSheet((current) => {
      if (!current || current.id !== id) return current;
      setRows([]);
      setMembers([]);
      setRole(null);
      return null;
    });
    await refreshList();
    toast.success('Sheet deleted');
  }, [refreshList]);

  const addRow = useCallback(async () => {
    if (!activeSheet) return;

    const res = await sendJson(`/api/sheets/${activeSheet.id}/rows`, {});
    if (!res.ok) {
      toast.error('Failed to add row');
      return;
    }

    const data = (await res.json()) as { row: SheetRowRecord };
    setRows((current) => [...current, data.row]);
  }, [activeSheet]);

  const updateRow = useCallback(async (rowId: string, values: Record<string, unknown>) => {
    if (!activeSheet) return;

    const current = rows.find((row) => row.id === rowId);
    if (!current) return;

    const snapshot = rows;
    setRows((existing) => existing.map((row) => (row.id === rowId ? { ...row, values } : row)));

    const res = await sendJson(
      `/api/sheets/${activeSheet.id}/rows/${rowId}`,
      { values, version: current.version },
      'PATCH',
    );

    if (res.ok) {
      const data = (await res.json()) as { row: SheetRowRecord };
      setRows((existing) => existing.map((row) => (row.id === rowId ? data.row : row)));
      return;
    }

    if (res.status === 409) {
      const data = (await res.json()) as { row: SheetRowRecord };
      setRows((existing) => existing.map((row) => (row.id === rowId ? data.row : row)));
      toast.error('Row was changed by someone else; reloaded latest');
      return;
    }

    setRows(snapshot);
    toast.error('Failed to save cell');
  }, [activeSheet, rows]);

  const deleteRows = useCallback(async (rowIds: string[]) => {
    if (!activeSheet || rowIds.length === 0) return;

    const snapshot = rows;
    setRows((current) => current.filter((row) => !rowIds.includes(row.id)));

    const results = await Promise.all(
      rowIds.map((rowId) => fetch(`/api/sheets/${activeSheet.id}/rows/${rowId}`, { method: 'DELETE' })),
    );

    if (results.some((result) => !result.ok)) {
      setRows(snapshot);
      toast.error('Some rows could not be deleted');
    }
  }, [activeSheet, rows]);

  const reorderRows = useCallback(async (orderedIds: string[]) => {
    if (!activeSheet) return;

    const snapshot = rows;
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
      toast.error('Columns were changed by someone else; reloading');
      await openSheet(activeSheet.id);
      return;
    }

    toast.error('Failed to update columns');
    throw new Error(`columns failed: ${res.status}`);
  }, [activeSheet, openSheet]);

  const addMember = useCallback(async (email: string, role: 'editor' | 'viewer') => {
    if (!activeSheet) return;

    const res = await sendJson(`/api/sheets/${activeSheet.id}/members`, { email, role });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      toast.error(data?.error ?? 'Failed to add member');
      throw new Error(data?.error ?? 'Failed to add member');
    }

    const data = (await res.json()) as { member: SheetMember };
    setMembers((current) => {
      const withoutMember = current.filter((member) => member.userId !== data.member.userId);
      return [...withoutMember, data.member];
    });
    toast.success('Member added');
  }, [activeSheet]);

  const updateMemberRole = useCallback(async (userId: string, role: 'editor' | 'viewer') => {
    if (!activeSheet) return;

    const res = await sendJson(`/api/sheets/${activeSheet.id}/members/${userId}`, { role }, 'PATCH');
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      toast.error(data?.error ?? 'Failed to update role');
      return;
    }

    setMembers((current) => current.map((member) => (
      member.userId === userId ? { ...member, role } : member
    )));
  }, [activeSheet]);

  const removeMember = useCallback(async (userId: string) => {
    if (!activeSheet) return;

    const res = await fetch(`/api/sheets/${activeSheet.id}/members/${userId}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      toast.error(data?.error ?? 'Failed to remove member');
      return;
    }

    setMembers((current) => current.filter((member) => member.userId !== userId));
  }, [activeSheet]);

  return {
    list,
    listLoading,
    activeSheet,
    rows,
    members,
    role,
    detailLoading,
    refreshList,
    openSheet,
    createSheet,
    renameSheet,
    snapshotSheet,
    deleteSheet,
    addRow,
    updateRow,
    deleteRows,
    reorderRows,
    updateColumns,
    addMember,
    updateMemberRole,
    removeMember,
  };
}

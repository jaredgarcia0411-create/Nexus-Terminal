import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getDbMock,
  getPoolDbMock,
  requireUserMock,
  ensureUserMock,
  getSheetRoleMock,
} = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  getPoolDbMock: vi.fn(),
  requireUserMock: vi.fn(),
  ensureUserMock: vi.fn(),
  getSheetRoleMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ getDb: getDbMock, getPoolDb: getPoolDbMock }));
vi.mock('@/lib/server-db-utils', () => ({
  dbUnavailable: () => Response.json({ error: 'Database not configured' }, { status: 503 }),
  ensureUser: ensureUserMock,
  requireUser: requireUserMock,
}));
vi.mock('@/lib/sheets/access', () => ({ getSheetRole: getSheetRoleMock }));

import { DELETE as deleteSheet, GET as getSheet, PATCH as patchSheet } from '@/app/api/sheets/[id]/route';
import { POST as appendResearchRow } from '@/app/api/sheets/[id]/append-research-row/route';
import { GET as getRResults } from '@/app/api/sheets/[id]/r-results/route';
import { POST as postSheetRow } from '@/app/api/sheets/[id]/rows/route';
import { PATCH as patchSheetRow } from '@/app/api/sheets/[id]/rows/[rowId]/route';
import { PATCH as reorderRows } from '@/app/api/sheets/[id]/rows/reorder/route';
import { POST as snapshotSheet } from '@/app/api/sheets/[id]/snapshot/route';
import { GET as getSheets, POST as postSheet } from '@/app/api/sheets/route';
import { DEFAULT_SHEET_COLUMNS } from '@/lib/sheets/columns';

function createDbMock(options: {
  selectQueue?: unknown[];
  insertResult?: unknown[];
  updateResult?: unknown[];
}) {
  const selectQueue = [...(options.selectQueue ?? [])];
  const insertResult = options.insertResult ?? [];
  const updateResult = options.updateResult ?? [];
  const insertValuesMock = vi.fn(() => ({
    returning: vi.fn(() => Promise.resolve(insertResult)),
  }));

  return {
    select: vi.fn(() => {
      const result = selectQueue.shift() ?? [];
      const chain = {
        from: vi.fn(() => chain),
        innerJoin: vi.fn(() => chain),
        leftJoin: vi.fn(() => chain),
        where: vi.fn(() => chain),
        orderBy: vi.fn(() => chain),
        limit: vi.fn(() => Promise.resolve(result)),
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve(result).then(resolve, reject),
      };
      return chain;
    }),
    insert: vi.fn(() => ({
      values: insertValuesMock,
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve(updateResult)),
        })),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve()),
    })),
    _mocks: {
      insertValuesMock,
    },
  };
}

function createPoolDbMock(options: {
  selectQueue?: unknown[];
  insertResults?: unknown[][];
}) {
  const selectQueue = [...(options.selectQueue ?? [])];
  const insertResults = [...(options.insertResults ?? [])];
  const txInsertValuesMock = vi.fn(() => ({
    returning: vi.fn(() => Promise.resolve(insertResults.shift() ?? [])),
  }));
  const txDeleteWhereMock = vi.fn(() => Promise.resolve());

  const tx = {
    insert: vi.fn(() => ({
      values: txInsertValuesMock,
    })),
    select: vi.fn(() => {
      const result = selectQueue.shift() ?? [];
      const chain = {
        from: vi.fn(() => chain),
        where: vi.fn(() => Promise.resolve(result)),
      };
      return chain;
    }),
    delete: vi.fn(() => ({ where: txDeleteWhereMock })),
  };

  return {
    select: vi.fn(() => {
      const result = selectQueue.shift() ?? [];
      const chain = {
        from: vi.fn(() => chain),
        where: vi.fn(() => chain),
        limit: vi.fn(() => Promise.resolve(result)),
      };
      return chain;
    }),
    transaction: vi.fn(async (fn: (txArg: typeof tx) => Promise<unknown>) => fn(tx)),
    _mocks: {
      tx,
      txInsertValuesMock,
      txDeleteWhereMock,
    },
  };
}

function ensureResponse(response: Response | undefined): Response {
  if (!response) throw new Error('Expected response');
  return response;
}

describe('sheets routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({
      user: { id: 'user-1', email: 'user@example.com', name: 'User', picture: null },
    });
    ensureUserMock.mockResolvedValue(undefined);
    getSheetRoleMock.mockResolvedValue('owner');
  });

  it('POST /api/sheets creates with default columns and owner membership', async () => {
    const poolDb = createPoolDbMock({
      insertResults: [[{
        id: 'sheet-1',
        ownerUserId: 'user-1',
        name: 'Daily Sheet',
        columns: DEFAULT_SHEET_COLUMNS,
      }]],
    });
    getPoolDbMock.mockReturnValue(poolDb);

    const response = ensureResponse(await postSheet(new Request('http://localhost/api/sheets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Daily Sheet' }),
    })));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.sheet.id).toBe('sheet-1');
    expect(poolDb._mocks.txInsertValuesMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
      columns: DEFAULT_SHEET_COLUMNS,
      ownerUserId: 'user-1',
    }));
    expect(poolDb._mocks.txInsertValuesMock).toHaveBeenNthCalledWith(2, {
      sheetId: 'sheet-1',
      userId: 'user-1',
      role: 'owner',
    });
  });

  it('GET /api/sheets returns member rows', async () => {
    getDbMock.mockReturnValue(createDbMock({
      selectQueue: [[{
        id: 'sheet-1',
        name: 'Daily Sheet',
        role: 'editor',
      }]],
    }));

    const response = ensureResponse(await getSheets(new Request('http://localhost/api/sheets')));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.sheets).toEqual([{ id: 'sheet-1', name: 'Daily Sheet', role: 'editor' }]);
  });

  it('GET /api/sheets/[id] returns 404 when caller is not a member', async () => {
    getSheetRoleMock.mockResolvedValue(null);
    getDbMock.mockReturnValue(createDbMock({}));

    const response = ensureResponse(await getSheet(new Request('http://localhost/api/sheets/sheet-1'), {
      params: Promise.resolve({ id: 'sheet-1' }),
    }));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Sheet not found' });
  });

  it('GET /api/sheets/[id] returns sheet detail for a member', async () => {
    getSheetRoleMock.mockResolvedValue('viewer');
    getDbMock.mockReturnValue(createDbMock({
      selectQueue: [
        [{ id: 'sheet-1', name: 'Daily Sheet', columns: DEFAULT_SHEET_COLUMNS }],
        [{ id: 'row-1', sheetId: 'sheet-1', position: 0 }],
        [{ userId: 'user-1', role: 'viewer', name: 'User', email: 'user@example.com' }],
      ],
    }));

    const response = ensureResponse(await getSheet(new Request('http://localhost/api/sheets/sheet-1'), {
      params: Promise.resolve({ id: 'sheet-1' }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      sheet: { id: 'sheet-1', name: 'Daily Sheet', columns: DEFAULT_SHEET_COLUMNS },
      rows: [{ id: 'row-1', sheetId: 'sheet-1', position: 0 }],
      members: [{ userId: 'user-1', role: 'viewer', name: 'User', email: 'user@example.com' }],
      role: 'viewer',
    });
  });

  it('GET /api/sheets/[id]/r-results returns 404 when caller is not a member', async () => {
    getSheetRoleMock.mockResolvedValue(null);
    getDbMock.mockReturnValue(createDbMock({}));

    const response = ensureResponse(await getRResults(new Request('http://localhost/api/sheets/sheet-1/r-results'), {
      params: Promise.resolve({ id: 'sheet-1' }),
    }));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Sheet not found' });
  });

  it('GET /api/sheets/[id]/r-results prefers active sessions and falls back to latest reviewed sessions', async () => {
    getSheetRoleMock.mockResolvedValue('viewer');
    getDbMock.mockReturnValue(createDbMock({
      selectQueue: [
        [{ id: 'row-active' }, { id: 'row-reviewed' }, { id: 'row-empty' }],
        [
          {
            id: 'session-reviewed-ignored',
            userId: 'user-1',
            ticker: 'AAPL',
            date: '2024-01-02',
            status: 'REVIEWED',
            riskDollars: 100,
            label: null,
            notes: null,
            chartState: {},
            reviewedAt: new Date('2024-01-03T10:00:00Z'),
            createdAt: new Date('2024-01-03T09:00:00Z'),
            updatedAt: new Date('2024-01-03T10:00:00Z'),
            backtestId: null,
            sheetRowId: 'row-active',
          },
          {
            id: 'session-active',
            userId: 'user-1',
            ticker: 'AAPL',
            date: '2024-01-02',
            status: 'ACTIVE',
            riskDollars: 100,
            label: null,
            notes: null,
            chartState: {},
            reviewedAt: null,
            createdAt: new Date('2024-01-03T11:00:00Z'),
            updatedAt: new Date('2024-01-03T11:00:00Z'),
            backtestId: null,
            sheetRowId: 'row-active',
          },
          {
            id: 'session-reviewed',
            userId: 'user-1',
            ticker: 'MSFT',
            date: '2024-01-02',
            status: 'REVIEWED',
            riskDollars: 25,
            label: null,
            notes: null,
            chartState: {},
            reviewedAt: new Date('2024-01-03T08:00:00Z'),
            createdAt: new Date('2024-01-03T07:00:00Z'),
            updatedAt: new Date('2024-01-03T08:00:00Z'),
            backtestId: null,
            sheetRowId: 'row-reviewed',
          },
        ],
        [
          {
            id: 'a1',
            userId: 'user-1',
            sessionId: 'session-active',
            actionType: 'LONG',
            price: 100,
            shares: 10,
            stopPrice: null,
            barTime: '2024-01-02T09:30:00Z',
            sequence: 1,
            createdAt: new Date(),
          },
          {
            id: 'a2',
            userId: 'user-1',
            sessionId: 'session-active',
            actionType: 'SELL',
            price: 110,
            shares: 10,
            stopPrice: null,
            barTime: '2024-01-02T09:45:00Z',
            sequence: 2,
            createdAt: new Date(),
          },
          {
            id: 'a3',
            userId: 'user-1',
            sessionId: 'session-reviewed',
            actionType: 'SHORT',
            price: 50,
            shares: 5,
            stopPrice: null,
            barTime: '2024-01-02T09:30:00Z',
            sequence: 1,
            createdAt: new Date(),
          },
          {
            id: 'a4',
            userId: 'user-1',
            sessionId: 'session-reviewed',
            actionType: 'COVER',
            price: 40,
            shares: 5,
            stopPrice: null,
            barTime: '2024-01-02T09:45:00Z',
            sequence: 2,
            createdAt: new Date(),
          },
          {
            id: 'a5',
            userId: 'user-1',
            sessionId: 'session-reviewed-ignored',
            actionType: 'LONG',
            price: 100,
            shares: 10,
            stopPrice: null,
            barTime: '2024-01-02T09:30:00Z',
            sequence: 1,
            createdAt: new Date(),
          },
          {
            id: 'a6',
            userId: 'user-1',
            sessionId: 'session-reviewed-ignored',
            actionType: 'SELL',
            price: 200,
            shares: 10,
            stopPrice: null,
            barTime: '2024-01-02T09:45:00Z',
            sequence: 2,
            createdAt: new Date(),
          },
        ],
      ],
    }));

    const response = ensureResponse(await getRResults(new Request('http://localhost/api/sheets/sheet-1/r-results'), {
      params: Promise.resolve({ id: 'sheet-1' }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.results['row-active']).toBeCloseTo(1);
    expect(payload.results['row-reviewed']).toBeCloseTo(2);
    expect(payload.results).not.toHaveProperty('row-empty');
  });

  it('PATCH /api/sheets/[id] returns 403 for editors', async () => {
    getSheetRoleMock.mockResolvedValue('editor');
    getDbMock.mockReturnValue(createDbMock({}));

    const response = ensureResponse(await patchSheet(new Request('http://localhost/api/sheets/sheet-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed' }),
    }), {
      params: Promise.resolve({ id: 'sheet-1' }),
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Forbidden' });
  });

  it('PATCH /api/sheets/[id] returns 409 for stale columnsVersion', async () => {
    getDbMock.mockReturnValue(createDbMock({
      selectQueue: [[{ columnsVersion: 2 }]],
    }));

    const response = ensureResponse(await patchSheet(new Request('http://localhost/api/sheets/sheet-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ columns: DEFAULT_SHEET_COLUMNS, columnsVersion: 1 }),
    }), {
      params: Promise.resolve({ id: 'sheet-1' }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.currentColumnsVersion).toBe(2);
  });

  it('DELETE /api/sheets/[id] returns 403 for editors and succeeds for owners', async () => {
    getDbMock.mockReturnValue(createDbMock({}));
    getSheetRoleMock.mockResolvedValueOnce('editor');

    const forbidden = ensureResponse(await deleteSheet(new Request('http://localhost/api/sheets/sheet-1', {
      method: 'DELETE',
    }), {
      params: Promise.resolve({ id: 'sheet-1' }),
    }));

    expect(forbidden.status).toBe(403);

    getSheetRoleMock.mockResolvedValueOnce('owner');
    const ok = ensureResponse(await deleteSheet(new Request('http://localhost/api/sheets/sheet-1', {
      method: 'DELETE',
    }), {
      params: Promise.resolve({ id: 'sheet-1' }),
    }));

    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ deleted: true, id: 'sheet-1' });
  });

  it('POST /api/sheets/[id]/snapshot copies rows into a dated snapshot and clears the original', async () => {
    const poolDb = createPoolDbMock({
      selectQueue: [
        [{ id: 'source-1', name: 'Source', columns: DEFAULT_SHEET_COLUMNS, rootId: null }],
        [{ position: 0, values: { ticker: 'AAPL' } }, { position: 1, values: { ticker: 'TSLA' } }],
      ],
      insertResults: [[{ id: 'sheet-copy', ownerUserId: 'user-1', name: 'Source 2026-06-02' }]],
    });
    getPoolDbMock.mockReturnValue(poolDb);

    const response = ensureResponse(await snapshotSheet(new Request('http://localhost/api/sheets/source-1/snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: '2026-06-02' }),
    }), {
      params: Promise.resolve({ id: 'source-1' }),
    }));

    expect(response.status).toBe(201);
    expect(poolDb._mocks.txInsertValuesMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
      ownerUserId: 'user-1',
      name: 'Source 2026-06-02',
      sheetDate: '2026-06-02',
      rootId: 'source-1',
      columns: DEFAULT_SHEET_COLUMNS,
      isTemplate: false,
    }));
    expect(poolDb._mocks.txInsertValuesMock).toHaveBeenNthCalledWith(2, [
      { sheetId: 'sheet-copy', position: 0, values: { ticker: 'AAPL' }, createdByUserId: 'user-1' },
      { sheetId: 'sheet-copy', position: 1, values: { ticker: 'TSLA' }, createdByUserId: 'user-1' },
    ]);
    expect(poolDb._mocks.txInsertValuesMock).toHaveBeenNthCalledWith(3, {
      sheetId: 'sheet-copy',
      userId: 'user-1',
      role: 'owner',
    });
    expect(poolDb._mocks.txDeleteWhereMock).toHaveBeenCalledTimes(1);
  });

  it('POST /api/sheets/[id]/snapshot rejects snapshotting a snapshot', async () => {
    const poolDb = createPoolDbMock({
      selectQueue: [[{
        id: 'source-1',
        rootId: 'root-1',
        name: 'Source',
        columns: DEFAULT_SHEET_COLUMNS,
      }]],
    });
    getPoolDbMock.mockReturnValue(poolDb);

    const response = ensureResponse(await snapshotSheet(new Request('http://localhost/api/sheets/source-1/snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: '2026-06-02' }),
    }), {
      params: Promise.resolve({ id: 'source-1' }),
    }));

    expect(response.status).toBe(400);
    expect(poolDb._mocks.txInsertValuesMock).not.toHaveBeenCalled();
    expect(poolDb._mocks.txDeleteWhereMock).not.toHaveBeenCalled();
  });

  it('POST /api/sheets/[id]/snapshot returns 403 for editors', async () => {
    getSheetRoleMock.mockResolvedValue('editor');
    const poolDb = createPoolDbMock({
      selectQueue: [[{ id: 'source-1', name: 'Source', columns: DEFAULT_SHEET_COLUMNS, rootId: null }]],
    });
    getPoolDbMock.mockReturnValue(poolDb);

    const response = ensureResponse(await snapshotSheet(new Request('http://localhost/api/sheets/source-1/snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: '2026-06-02' }),
    }), {
      params: Promise.resolve({ id: 'source-1' }),
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Only the owner can snapshot' });
    expect(poolDb._mocks.txInsertValuesMock).not.toHaveBeenCalled();
  });

  it('POST /api/sheets/[id]/snapshot copies no rows when the original is empty', async () => {
    const poolDb = createPoolDbMock({
      selectQueue: [
        [{ id: 'source-1', name: 'Source', columns: DEFAULT_SHEET_COLUMNS, rootId: null }],
        [],
      ],
      insertResults: [[{ id: 'sheet-copy', ownerUserId: 'user-1', name: 'Source 2026-06-02' }]],
    });
    getPoolDbMock.mockReturnValue(poolDb);

    const response = ensureResponse(await snapshotSheet(new Request('http://localhost/api/sheets/source-1/snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: '2026-06-02' }),
    }), {
      params: Promise.resolve({ id: 'source-1' }),
    }));

    expect(response.status).toBe(201);
    expect(poolDb._mocks.txInsertValuesMock).toHaveBeenNthCalledWith(2, {
      sheetId: 'sheet-copy',
      userId: 'user-1',
      role: 'owner',
    });
    expect(poolDb._mocks.txInsertValuesMock).toHaveBeenCalledTimes(2);
    expect(poolDb._mocks.txDeleteWhereMock).toHaveBeenCalledTimes(1);
  });

  it('POST /api/sheets/[id]/rows returns 403 for viewers', async () => {
    getSheetRoleMock.mockResolvedValue('viewer');
    getDbMock.mockReturnValue(createDbMock({}));

    const response = ensureResponse(await postSheetRow(new Request('http://localhost/api/sheets/sheet-1/rows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: { ticker: 'AAPL' } }),
    }), {
      params: Promise.resolve({ id: 'sheet-1' }),
    }));

    expect(response.status).toBe(403);
  });

  it('POST /api/sheets/[id]/append-research-row appends for editors and dedupes ticker/date', async () => {
    getSheetRoleMock.mockResolvedValue('editor');
    const db = createDbMock({
      selectQueue: [
        [],
        [{ position: 0, values: { ticker: 'AAPL', date: '2026-06-01' } }],
      ],
      insertResult: [{
        id: 'row-1',
        sheetId: 'sheet-1',
        position: 0,
        values: { ticker: 'AAPL', date: '2026-06-01', research_report: 'report-1' },
      }],
    });
    getDbMock.mockReturnValue(db);

    const appended = ensureResponse(await appendResearchRow(new Request('http://localhost/api/sheets/sheet-1/append-research-row', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker: 'aapl', date: '2026-06-01', reportId: 'report-1' }),
    }), {
      params: Promise.resolve({ id: 'sheet-1' }),
    }));
    const appendedPayload = await appended.json();

    expect(appended.status).toBe(201);
    expect(appendedPayload).toEqual({
      row: {
        id: 'row-1',
        sheetId: 'sheet-1',
        position: 0,
        values: { ticker: 'AAPL', date: '2026-06-01', research_report: 'report-1' },
      },
      duplicate: false,
    });
    expect(db._mocks.insertValuesMock).toHaveBeenCalledTimes(1);
    expect(db._mocks.insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({
      sheetId: 'sheet-1',
      position: 0,
      values: { ticker: 'AAPL', date: '2026-06-01', research_report: 'report-1' },
      createdByUserId: 'user-1',
      updatedByUserId: 'user-1',
    }));

    const duplicate = ensureResponse(await appendResearchRow(new Request('http://localhost/api/sheets/sheet-1/append-research-row', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker: 'AAPL', date: '2026-06-01' }),
    }), {
      params: Promise.resolve({ id: 'sheet-1' }),
    }));

    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toEqual({ duplicate: true });
    expect(db._mocks.insertValuesMock).toHaveBeenCalledTimes(1);
  });

  it('POST /api/sheets/[id]/append-research-row returns 403 for viewers', async () => {
    getSheetRoleMock.mockResolvedValue('viewer');
    getDbMock.mockReturnValue(createDbMock({}));

    const response = ensureResponse(await appendResearchRow(new Request('http://localhost/api/sheets/sheet-1/append-research-row', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker: 'AAPL', date: '2026-06-01' }),
    }), {
      params: Promise.resolve({ id: 'sheet-1' }),
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Forbidden' });
  });

  it('POST /api/sheets/[id]/append-research-row returns 404 for unknown sheets', async () => {
    getSheetRoleMock.mockResolvedValue(null);
    getDbMock.mockReturnValue(createDbMock({}));

    const response = ensureResponse(await appendResearchRow(new Request('http://localhost/api/sheets/missing/append-research-row', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker: 'AAPL', date: '2026-06-01' }),
    }), {
      params: Promise.resolve({ id: 'missing' }),
    }));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Sheet not found' });
  });

  it('PATCH /api/sheets/[id]/rows/reorder reorders rows for editors', async () => {
    getSheetRoleMock.mockResolvedValue('editor');
    const db = createDbMock({});
    getDbMock.mockReturnValue(db);

    const response = ensureResponse(await reorderRows(new Request('http://localhost/api/sheets/sheet-1/rows/reorder', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rowIds: ['row-2', 'row-1'] }),
    }), {
      params: Promise.resolve({ id: 'sheet-1' }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(db.update).toHaveBeenCalledTimes(2);
  });

  it('PATCH /api/sheets/[id]/rows/reorder returns 403 for viewers', async () => {
    getSheetRoleMock.mockResolvedValue('viewer');
    getDbMock.mockReturnValue(createDbMock({}));

    const response = ensureResponse(await reorderRows(new Request('http://localhost/api/sheets/sheet-1/rows/reorder', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rowIds: ['row-1'] }),
    }), {
      params: Promise.resolve({ id: 'sheet-1' }),
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Forbidden' });
  });

  it('PATCH /api/sheets/[id]/rows/reorder returns 404 for unknown sheets', async () => {
    getSheetRoleMock.mockResolvedValue(null);
    getDbMock.mockReturnValue(createDbMock({}));

    const response = ensureResponse(await reorderRows(new Request('http://localhost/api/sheets/missing/rows/reorder', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rowIds: ['row-1'] }),
    }), {
      params: Promise.resolve({ id: 'missing' }),
    }));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Sheet not found' });
  });

  it('PATCH /api/sheets/[id]/rows/[rowId] returns 409 with current row on version conflict', async () => {
    getDbMock.mockReturnValue(createDbMock({
      selectQueue: [[{ id: 'row-1', sheetId: 'sheet-1', values: { ticker: 'AAPL' }, version: 2 }]],
      updateResult: [],
    }));

    const response = ensureResponse(await patchSheetRow(new Request('http://localhost/api/sheets/sheet-1/rows/row-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: { ticker: 'TSLA' }, version: 1 }),
    }), {
      params: Promise.resolve({ id: 'sheet-1', rowId: 'row-1' }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.row).toEqual({ id: 'row-1', sheetId: 'sheet-1', values: { ticker: 'AAPL' }, version: 2 });
  });

  it('POST /api/sheets rejects names longer than 100 characters', async () => {
    getPoolDbMock.mockReturnValue(createPoolDbMock({}));

    const response = ensureResponse(await postSheet(new Request('http://localhost/api/sheets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'a'.repeat(101) }),
    })));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Validation failed');
  });

  it('PATCH /api/sheets/[id] rejects columns without columnsVersion', async () => {
    getDbMock.mockReturnValue(createDbMock({}));

    const response = ensureResponse(await patchSheet(new Request('http://localhost/api/sheets/sheet-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ columns: DEFAULT_SHEET_COLUMNS }),
    }), {
      params: Promise.resolve({ id: 'sheet-1' }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Validation failed');
  });
});

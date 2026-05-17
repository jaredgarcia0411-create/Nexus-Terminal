import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireUserMock,
  ensureUserMock,
  getDbMock,
  getPoolDbMock,
} = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  ensureUserMock: vi.fn(),
  getDbMock: vi.fn(),
  getPoolDbMock: vi.fn(),
}));

vi.mock('@/lib/server-db-utils', () => ({
  requireUser: requireUserMock,
  ensureUser: ensureUserMock,
  dbUnavailable: () => Response.json({ error: 'DB unavailable' }, { status: 503 }),
}));

vi.mock('@/lib/db', () => ({
  getDb: getDbMock,
  getPoolDb: getPoolDbMock,
}));

import { GET as getSampleSets, POST as postSampleSet } from '@/app/api/sample-sets/route';
import {
  DELETE as deleteSampleSet,
  GET as getSampleSetDetail,
  PATCH as patchSampleSet,
} from '@/app/api/sample-sets/[id]/route';
import { POST as duplicateSampleSet } from '@/app/api/sample-sets/[id]/duplicate/route';

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
        leftJoin: vi.fn(() => chain),
        where: vi.fn(() => chain),
        groupBy: vi.fn(() => chain),
        orderBy: vi.fn(() => Promise.resolve(result)),
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
  lockRows?: Array<{ id: string; rows: unknown }>;
  selectQueue?: unknown[][];
  updateResult?: unknown[];
}) {
  const updateResult = options.updateResult ?? [];
  const lockRows = options.lockRows ?? [];
  const selectQueue = [...(options.selectQueue ?? [])];

  const tx = {
    execute: vi.fn(async () => ({ rows: lockRows })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve(selectQueue.shift() ?? [])),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve(updateResult)),
        })),
      })),
    })),
  };

  return {
    transaction: vi.fn(async (fn: (txArg: typeof tx) => Promise<unknown>) => fn(tx)),
    _mocks: {
      tx,
    },
  };
}

function ensureResponse(response: Response | undefined): Response {
  if (!response) throw new Error('Expected response');
  return response;
}

describe('sample set routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({ user: { id: 'user-1', email: 'user@example.com', name: 'User', picture: null } });
    ensureUserMock.mockResolvedValue(undefined);
  });

  it('GET /api/sample-sets returns the shared list without user filtering', async () => {
    getDbMock.mockReturnValue(createDbMock({
      selectQueue: [[{
        id: 'ss-1',
        name: 'Gappers',
        rowCount: 2,
        ownerId: 'user-2',
        ownerName: 'Other',
        createdAt: '2026-05-01T00:00:00.000Z',
        updatedAt: '2026-05-02T00:00:00.000Z',
      }]],
    }));

    const response = ensureResponse(await getSampleSets(new Request('http://localhost/api/sample-sets')));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.sampleSets).toHaveLength(1);
    expect(payload.sampleSets[0].ownerId).toBe('user-2');
  });

  it('POST /api/sample-sets creates a sample set with rows', async () => {
    const db = createDbMock({
      selectQueue: [[]],
      insertResult: [{
        id: 'ss-1',
        userId: 'user-1',
        name: 'Gappers',
        rows: [{ ticker: 'AAPL', date: '2026-05-01' }],
        rowCount: 1,
      }],
    });
    getDbMock.mockReturnValue(db);

    const response = ensureResponse(await postSampleSet(new Request('http://localhost/api/sample-sets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Gappers',
        rows: [{ ticker: 'AAPL', date: '2026-05-01' }],
      }),
    })));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.sampleSet.rowCount).toBe(1);
    expect(payload.skippedCount).toBe(0);
    expect(db._mocks.insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({
      rows: [{ ticker: 'AAPL', date: '2026-05-01' }],
      rowCount: 1,
    }));
  });

  it('POST /api/sample-sets dedupes in-batch rows', async () => {
    const db = createDbMock({
      selectQueue: [[]],
      insertResult: [{
        id: 'ss-1',
        userId: 'user-1',
        name: 'Gappers',
        rows: [
          { ticker: 'AAPL', date: '2026-05-01' },
          { ticker: 'TSLA', date: '2026-05-02' },
        ],
        rowCount: 2,
      }],
    });
    getDbMock.mockReturnValue(db);

    const response = ensureResponse(await postSampleSet(new Request('http://localhost/api/sample-sets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Gappers',
        rows: [
          { ticker: 'aapl', date: '2026-05-01' },
          { ticker: 'AAPL', date: '2026-05-01' },
          { ticker: 'TSLA', date: '2026-05-02' },
        ],
      }),
    })));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.sampleSet.rowCount).toBe(2);
    expect(payload.skippedCount).toBe(1);
    expect(db._mocks.insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({
      rows: [
        { ticker: 'AAPL', date: '2026-05-01' },
        { ticker: 'TSLA', date: '2026-05-02' },
      ],
      rowCount: 2,
    }));
  });

  it('POST /api/sample-sets returns 409 on name collision', async () => {
    getDbMock.mockReturnValue(createDbMock({
      selectQueue: [[{ id: 'ss-existing' }]],
    }));

    const response = ensureResponse(await postSampleSet(new Request('http://localhost/api/sample-sets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Gappers',
        rows: [{ ticker: 'AAPL', date: '2026-05-01' }],
      }),
    })));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'A sample set with that name already exists' });
  });

  it('GET /api/sample-sets/[id] returns full detail including rows', async () => {
    getDbMock.mockReturnValue(createDbMock({
      selectQueue: [[{
        id: 'ss-1',
        userId: 'user-2',
        name: 'Gappers',
        rows: [{ ticker: 'AAPL', date: '2026-05-01' }],
        rowCount: 1,
      }]],
    }));

    const response = ensureResponse(await getSampleSetDetail(new Request('http://localhost/api/sample-sets/ss-1'), {
      params: Promise.resolve({ id: 'ss-1' }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.sampleSet.rows).toEqual([{ ticker: 'AAPL', date: '2026-05-01' }]);
  });

  it('POST /api/sample-sets/[id]/duplicate creates a copy for the authed user', async () => {
    getDbMock.mockReturnValue(createDbMock({
      selectQueue: [
        [{
          id: 'ss-1',
          userId: 'user-2',
          name: 'Source',
          rows: [{ ticker: 'AAPL', date: '2026-05-01' }],
          rowCount: 1,
        }],
        [],
      ],
      insertResult: [{
        id: 'ss-2',
        userId: 'user-1',
        name: 'Source Copy',
        rows: [{ ticker: 'AAPL', date: '2026-05-01' }],
        rowCount: 1,
      }],
    }));

    const response = ensureResponse(await duplicateSampleSet(new Request('http://localhost/api/sample-sets/ss-1/duplicate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Source Copy' }),
    }), {
      params: Promise.resolve({ id: 'ss-1' }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.sampleSet.userId).toBe('user-1');
  });

  it('PATCH /api/sample-sets/[id] returns 403 when not owner', async () => {
    getDbMock.mockReturnValue(createDbMock({
      selectQueue: [[{ id: 'ss-1', userId: 'user-2' }]],
    }));

    const response = ensureResponse(await patchSampleSet(new Request('http://localhost/api/sample-sets/ss-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed' }),
    }), {
      params: Promise.resolve({ id: 'ss-1' }),
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Forbidden' });
  });

  it('PATCH appendRows succeeds for non-owner', async () => {
    getPoolDbMock.mockReturnValue(createPoolDbMock({
      lockRows: [{ id: 'ss-1', rows: [] }],
      updateResult: [{
        id: 'ss-1',
        userId: 'user-2',
        name: 'Shared',
        rows: [{ ticker: 'AAPL', date: '2026-05-01' }],
        rowCount: 1,
      }],
    }));

    const response = ensureResponse(await patchSampleSet(new Request('http://localhost/api/sample-sets/ss-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appendRows: [{ ticker: 'AAPL', date: '2026-05-01' }] }),
    }), {
      params: Promise.resolve({ id: 'ss-1' }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.sampleSet.rowCount).toBe(1);
    expect(payload.skippedCount).toBe(0);
  });

  it('PATCH appendRows dedupes against existing rows', async () => {
    const poolDb = createPoolDbMock({
      lockRows: [{ id: 'ss-1', rows: [{ ticker: 'AAPL', date: '2026-05-01' }] }],
      updateResult: [{
        id: 'ss-1',
        rows: [
          { ticker: 'AAPL', date: '2026-05-01' },
          { ticker: 'TSLA', date: '2026-05-02' },
        ],
        rowCount: 2,
      }],
    });
    getPoolDbMock.mockReturnValue(poolDb);

    const response = ensureResponse(await patchSampleSet(new Request('http://localhost/api/sample-sets/ss-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appendRows: [
          { ticker: 'AAPL', date: '2026-05-01' },
          { ticker: 'TSLA', date: '2026-05-02' },
        ],
      }),
    }), {
      params: Promise.resolve({ id: 'ss-1' }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.skippedCount).toBe(1);
    expect(payload.sampleSet.rowCount).toBe(2);
    expect(poolDb._mocks.tx.update).toHaveBeenCalledTimes(1);
  });

  it('PATCH appendRows on missing set returns 404', async () => {
    getPoolDbMock.mockReturnValue(createPoolDbMock({ lockRows: [] }));

    const response = ensureResponse(await patchSampleSet(new Request('http://localhost/api/sample-sets/ss-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appendRows: [{ ticker: 'AAPL', date: '2026-05-01' }] }),
    }), {
      params: Promise.resolve({ id: 'ss-1' }),
    }));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Sample set not found' });
  });

  it('PATCH appendRows with rename keeps owner-only name collisions at 409', async () => {
    getPoolDbMock.mockReturnValue(createPoolDbMock({
      lockRows: [{ id: 'ss-1', rows: [] }],
      selectQueue: [
        [{ userId: 'user-1' }],
        [{ id: 'ss-existing' }],
      ],
    }));

    const response = ensureResponse(await patchSampleSet(new Request('http://localhost/api/sample-sets/ss-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Existing',
        appendRows: [{ ticker: 'AAPL', date: '2026-05-01' }],
      }),
    }), {
      params: Promise.resolve({ id: 'ss-1' }),
    }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'A sample set with that name already exists' });
  });

  it('DELETE /api/sample-sets/[id] returns 403 when not owner', async () => {
    getDbMock.mockReturnValue(createDbMock({
      selectQueue: [[{ id: 'ss-1', userId: 'user-2' }]],
    }));

    const response = ensureResponse(await deleteSampleSet(new Request('http://localhost/api/sample-sets/ss-1', {
      method: 'DELETE',
    }), {
      params: Promise.resolve({ id: 'ss-1' }),
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Forbidden' });
  });

  it('DELETE /api/sample-sets/[id] succeeds for the owner', async () => {
    getDbMock.mockReturnValue(createDbMock({
      selectQueue: [[{ id: 'ss-1', userId: 'user-1' }]],
    }));

    const response = ensureResponse(await deleteSampleSet(new Request('http://localhost/api/sample-sets/ss-1', {
      method: 'DELETE',
    }), {
      params: Promise.resolve({ id: 'ss-1' }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true, id: 'ss-1' });
  });
});

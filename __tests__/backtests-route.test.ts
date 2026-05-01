import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireUserMock,
  ensureUserMock,
  getDbMock,
} = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  ensureUserMock: vi.fn(),
  getDbMock: vi.fn(),
}));

vi.mock('@/lib/server-db-utils', () => ({
  requireUser: requireUserMock,
  ensureUser: ensureUserMock,
  dbUnavailable: () => Response.json({ error: 'DB unavailable' }, { status: 503 }),
}));

vi.mock('@/lib/db', () => ({
  getDb: getDbMock,
}));

import { GET as getBacktests, POST as postBacktest } from '@/app/api/backtests/route';
import {
  DELETE as deleteBacktest,
  GET as getBacktestDetail,
  PATCH as patchBacktest,
} from '@/app/api/backtests/[id]/route';

function createDbMock(options: {
  selectQueue?: unknown[];
  insertResult?: unknown[];
  updateResult?: unknown[];
}) {
  const selectQueue = [...(options.selectQueue ?? [])];
  const insertResult = options.insertResult ?? [];
  const updateResult = options.updateResult ?? [];

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
      values: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve(insertResult)),
      })),
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
  };
}

function ensureResponse(response: Response | undefined): Response {
  if (!response) throw new Error('Expected response');
  return response;
}

describe('backtests routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({ user: { id: 'user-1', email: 'user@example.com', name: 'User', picture: null } });
    ensureUserMock.mockResolvedValue(undefined);
  });

  it('GET /api/backtests returns the shared list without user filtering', async () => {
    getDbMock.mockReturnValue(createDbMock({
      selectQueue: [
        [{
          id: 'bt-1',
          name: 'Momentum',
          description: null,
          sampleSetId: 'ss-1',
          sampleSetName: 'Sheet 1',
          sampleSetExists: true,
          ownerId: 'user-2',
          ownerName: 'Other',
          reviewCount: 3,
          createdAt: '2026-05-01T00:00:00.000Z',
          updatedAt: '2026-05-02T00:00:00.000Z',
        }],
        [],
      ],
    }));

    const response = ensureResponse(await getBacktests(new Request('http://localhost/api/backtests')));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.backtests).toHaveLength(1);
    expect(payload.backtests[0].ownerId).toBe('user-2');
  });

  it('POST /api/backtests creates a backtest for the authed user', async () => {
    getDbMock.mockReturnValue(createDbMock({
      selectQueue: [[], [{ id: 'ss-1' }]],
      insertResult: [{
        id: 'bt-1',
        userId: 'user-1',
        name: 'Momentum',
        description: 'Notes',
        sampleSetId: 'ss-1',
      }],
    }));

    const response = ensureResponse(await postBacktest(new Request('http://localhost/api/backtests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Momentum', description: 'Notes', sampleSetId: 'ss-1' }),
    })));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.backtest.userId).toBe('user-1');
    expect(payload.backtest.name).toBe('Momentum');
  });

  it('POST /api/backtests returns 409 on name collision', async () => {
    getDbMock.mockReturnValue(createDbMock({
      selectQueue: [[{ id: 'bt-existing' }]],
    }));

    const response = ensureResponse(await postBacktest(new Request('http://localhost/api/backtests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Momentum' }),
    })));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'A backtest with that name already exists' });
  });

  it('GET /api/backtests/[id] returns detail plus reviews', async () => {
    getDbMock.mockReturnValue(createDbMock({
      selectQueue: [
        [{
          id: 'bt-1',
          name: 'Momentum',
          description: null,
          sampleSetId: 'ss-1',
          userId: 'user-2',
          ownerId: 'user-2',
          ownerName: 'Other',
          sampleSetName: 'Sheet 1',
          sampleSetRows: [{ ticker: 'AAPL', date: '2026-05-01' }],
          createdAt: '2026-05-01T00:00:00.000Z',
          updatedAt: '2026-05-02T00:00:00.000Z',
        }],
        [{
          id: 'review-1',
          userId: 'user-2',
          ticker: 'AAPL',
          date: '2026-05-01',
          status: 'REVIEWED',
          riskDollars: 100,
          label: null,
          notes: 'Test',
          backtestId: 'bt-1',
          reviewedAt: '2026-05-02T00:00:00.000Z',
          createdAt: '2026-05-01T00:00:00.000Z',
          updatedAt: '2026-05-02T00:00:00.000Z',
        }],
        [{
          id: 'action-1',
          userId: 'user-2',
          sessionId: 'review-1',
          actionType: 'LONG',
          price: 10,
          shares: 100,
          stopPrice: 9,
          barTime: '2026-05-01T14:00:00.000Z',
          sequence: 1,
          createdAt: '2026-05-01T14:00:00.000Z',
        }],
        [{
          id: 'sys-1',
          ticker: 'AAPL',
          date: '2026-05-01',
          grade: 'A',
          setupType: 'ORB',
          day1GapPct: 18.2,
        }],
      ],
    }));

    const response = ensureResponse(await getBacktestDetail(new Request('http://localhost/api/backtests/bt-1'), {
      params: Promise.resolve({ id: 'bt-1' }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.backtest.name).toBe('Momentum');
    expect(payload.reviews).toHaveLength(1);
    expect(payload.reviews[0].actions).toHaveLength(1);
  });

  it('PATCH /api/backtests/[id] returns 403 when the authed user is not the owner', async () => {
    getDbMock.mockReturnValue(createDbMock({
      selectQueue: [[{ id: 'bt-1', userId: 'user-2' }]],
    }));

    const response = ensureResponse(await patchBacktest(new Request('http://localhost/api/backtests/bt-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed' }),
    }), {
      params: Promise.resolve({ id: 'bt-1' }),
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Forbidden' });
  });

  it('DELETE /api/backtests/[id] returns 403 when the authed user is not the owner', async () => {
    getDbMock.mockReturnValue(createDbMock({
      selectQueue: [[{ id: 'bt-1', userId: 'user-2' }]],
    }));

    const response = ensureResponse(await deleteBacktest(new Request('http://localhost/api/backtests/bt-1', {
      method: 'DELETE',
    }), {
      params: Promise.resolve({ id: 'bt-1' }),
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Forbidden' });
  });

  it('DELETE /api/backtests/[id] succeeds for the owner', async () => {
    getDbMock.mockReturnValue(createDbMock({
      selectQueue: [[{ id: 'bt-1', userId: 'user-1' }]],
    }));

    const response = ensureResponse(await deleteBacktest(new Request('http://localhost/api/backtests/bt-1', {
      method: 'DELETE',
    }), {
      params: Promise.resolve({ id: 'bt-1' }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true, id: 'bt-1' });
  });
});

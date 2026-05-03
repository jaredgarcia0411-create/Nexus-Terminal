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
vi.mock('@/lib/db', () => ({ getDb: getDbMock }));

import { POST as postAction } from '@/app/api/backtest/actions/route';
import { DELETE as deleteSession } from '@/app/api/backtest/sessions/[id]/route';
import { POST as reviewSession } from '@/app/api/backtest/sessions/[id]/review/route';
import { GET as getSessions, POST as postSession } from '@/app/api/backtest/sessions/route';
import { backtestActions, backtestSessions } from '@/lib/db/schema';

type SessionRow = {
  id: string;
  userId: string;
  ticker: string;
  date: string;
  status: 'ACTIVE' | 'REVIEWED';
  riskDollars: number;
  label: string | null;
  notes: string | null;
  chartState: Record<string, unknown>;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type ActionRow = {
  id: string;
  userId: string;
  sessionId: string;
  actionType: string;
  price: number;
  shares: number;
  stopPrice: number | null;
  barTime: string;
  sequence: number;
  createdAt: Date;
};

function projectRow<T extends Record<string, unknown>>(row: T, fields?: Record<string, unknown>) {
  if (!fields) return { ...row };
  return Object.fromEntries(Object.keys(fields).map((key) => [key, row[key]]));
}

function createBacktestDb() {
  const state: { sessions: SessionRow[]; actions: ActionRow[] } = {
    sessions: [],
    actions: [],
  };

  function getRows(table: unknown) {
    if (table === backtestSessions) return state.sessions;
    if (table === backtestActions) return state.actions;
    return [];
  }

  function sortRows(table: unknown, rows: Array<Record<string, unknown>>) {
    if (table === backtestActions) {
      return [...rows].sort((a, b) => Number(a.sequence) - Number(b.sequence));
    }

    if (table === backtestSessions) {
      return [...rows].sort((a, b) => {
        const aReviewed = a.reviewedAt ? new Date(String(a.reviewedAt)).getTime() : 0;
        const bReviewed = b.reviewedAt ? new Date(String(b.reviewedAt)).getTime() : 0;
        if (aReviewed !== bReviewed) return bReviewed - aReviewed;
        return new Date(String(b.createdAt)).getTime() - new Date(String(a.createdAt)).getTime();
      });
    }

    return rows;
  }

  return {
    state,
    select(fields?: Record<string, unknown>) {
      let table: unknown;

      return {
        from(nextTable: unknown) {
          table = nextTable;
          return this;
        },
        where() {
          return this;
        },
        orderBy() {
          return Promise.resolve(sortRows(table, getRows(table)).map((row) => projectRow(row, fields)));
        },
        limit(count: number) {
          return Promise.resolve(getRows(table).slice(0, count).map((row) => projectRow(row, fields)));
        },
      };
    },
    insert(table: unknown) {
      return {
        values(values: Record<string, unknown>) {
          return {
            returning() {
              if (table === backtestSessions) {
                const row: SessionRow = {
                  id: String(values.id),
                  userId: String(values.userId),
                  ticker: String(values.ticker),
                  date: String(values.date),
                  status: 'ACTIVE',
                  riskDollars: Number(values.riskDollars),
                  label: null,
                  notes: null,
                  chartState: {},
                  reviewedAt: null,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                };
                state.sessions.push(row);
                return Promise.resolve([{ ...row }]);
              }

              const row: ActionRow = {
                id: String(values.id),
                userId: String(values.userId),
                sessionId: String(values.sessionId),
                actionType: String(values.actionType),
                price: Number(values.price),
                shares: Number(values.shares),
                stopPrice: values.stopPrice == null ? null : Number(values.stopPrice),
                barTime: String(values.barTime),
                sequence: Number(values.sequence),
                createdAt: new Date(),
              };
              state.actions.push(row);
              return Promise.resolve([{ ...row }]);
            },
          };
        },
      };
    },
    update(table: unknown) {
      let patch: Record<string, unknown> = {};
      let updatedRows: Array<Record<string, unknown>> = [];

      const chain = {
        set(nextPatch: Record<string, unknown>) {
          patch = nextPatch;
          return chain;
        },
        where() {
          if (table === backtestSessions) {
            const target = state.sessions.find((row) => row.status === 'ACTIVE') ?? state.sessions[0];
            if (target) {
              Object.assign(target, patch);
              updatedRows = [{ ...target }];
            } else {
              updatedRows = [];
            }
          } else {
            updatedRows = [];
          }
          return chain;
        },
        returning() {
          return Promise.resolve(updatedRows.map((row) => ({ ...row })));
        },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          return Promise.resolve(updatedRows.map((row) => ({ ...row }))).then(resolve, reject);
        },
      };

      return chain;
    },
    delete(table: unknown) {
      return {
        where() {
          if (table === backtestSessions) {
            const target = state.sessions.find((row) => row.status === 'REVIEWED') ?? state.sessions[0];
            if (target) {
              state.sessions = state.sessions.filter((row) => row.id !== target.id);
              state.actions = state.actions.filter((row) => row.sessionId !== target.id);
            }
          }

          return Promise.resolve();
        },
      };
    },
  };
}

function ensureResponse(response: Response | undefined): Response {
  if (!response) throw new Error('Expected response');
  return response;
}

describe('backtest session routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({ user: { id: 'u1', email: 'u1@example.com', name: null, picture: null } });
    ensureUserMock.mockResolvedValue(undefined);
    getDbMock.mockReturnValue(createBacktestDb());
  });

  it('creates an active session, appends actions, reviews it, and lists the review', async () => {
    const createResponse = ensureResponse(await postSession(new Request('http://localhost/api/backtest/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker: 'AAPL', date: '2026-04-28', riskDollars: 100 }),
    })));
    const createPayload = await createResponse.json();

    expect(createResponse.status).toBe(200);
    expect(createPayload.session.status).toBe('ACTIVE');

    const longResponse = ensureResponse(await postAction(new Request('http://localhost/api/backtest/actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: createPayload.session.id,
        actionType: 'LONG',
        price: 10,
        shares: 100,
        stopPrice: 9,
        barTime: '2026-04-28T14:00:00.000Z',
      }),
    })));
    expect(longResponse.status).toBe(200);

    const sellResponse = ensureResponse(await postAction(new Request('http://localhost/api/backtest/actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: createPayload.session.id,
        actionType: 'SELL',
        price: 11,
        shares: 50,
        stopPrice: null,
        barTime: '2026-04-28T14:15:00.000Z',
      }),
    })));
    expect(sellResponse.status).toBe(200);

    const reviewResponse = ensureResponse(await reviewSession(new Request(`http://localhost/api/backtest/sessions/${createPayload.session.id}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: createPayload.session.id,
        label: 'A setup',
        notes: 'clean move',
        chartState: { drawings: [{ id: 'txt-1', type: 'text', position: { time: 1, price: 10 }, text: 'test' }], indicators: { primary: ['VWAP'] } },
      }),
    }), {
      params: Promise.resolve({ id: createPayload.session.id }),
    }));
    const reviewPayload = await reviewResponse.json();

    expect(reviewResponse.status).toBe(200);
    expect(reviewPayload.session.status).toBe('REVIEWED');
    expect(reviewPayload.session.label).toBe('A setup');
    expect(reviewPayload.session.chartState).toEqual({
      drawings: [{ id: 'txt-1', type: 'text', position: { time: 1, price: 10 }, text: 'test' }],
      indicators: { primary: ['VWAP'] },
    });

    const listResponse = ensureResponse(await getSessions(new Request('http://localhost/api/backtest/sessions?ticker=AAPL&date=2026-04-28')));
    const listPayload = await listResponse.json();

    expect(listResponse.status).toBe(200);
    expect(listPayload.session).toBeNull();
    expect(listPayload.reviews).toHaveLength(1);
    expect(listPayload.reviews[0].status).toBe('REVIEWED');
  });

  it('deletes a reviewed session and removes it from the session list', async () => {
    const createResponse = ensureResponse(await postSession(new Request('http://localhost/api/backtest/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker: 'AAPL', date: '2026-04-28', riskDollars: 100 }),
    })));
    const createPayload = await createResponse.json();

    const reviewResponse = ensureResponse(await reviewSession(new Request(`http://localhost/api/backtest/sessions/${createPayload.session.id}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: createPayload.session.id, label: 'A setup' }),
    }), {
      params: Promise.resolve({ id: createPayload.session.id }),
    }));
    expect(reviewResponse.status).toBe(200);

    const deleteResponse = ensureResponse(await deleteSession(new Request(`http://localhost/api/backtest/sessions/${createPayload.session.id}`, {
      method: 'DELETE',
    }), {
      params: Promise.resolve({ id: createPayload.session.id }),
    }));
    const deletePayload = await deleteResponse.json();

    expect(deleteResponse.status).toBe(200);
    expect(deletePayload).toMatchObject({ deleted: true, id: createPayload.session.id });

    const listResponse = ensureResponse(await getSessions(new Request('http://localhost/api/backtest/sessions?ticker=AAPL&date=2026-04-28')));
    const listPayload = await listResponse.json();

    expect(listResponse.status).toBe(200);
    expect(listPayload.reviews).toHaveLength(0);
  });
});

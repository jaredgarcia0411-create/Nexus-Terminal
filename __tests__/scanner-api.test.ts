import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getDbMock, requireUserMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  requireUserMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ getDb: getDbMock }));
vi.mock('@/lib/server-db-utils', () => ({ requireUser: requireUserMock }));

import { GET as getScanner } from '@/app/api/scanner/route';
import { DELETE as deletePreset, GET as getPresets, POST as postPreset } from '@/app/api/scanner/presets/route';

function ensureResponse(response: Response | undefined): Response {
  if (!response) {
    throw new Error('Expected response');
  }
  return response;
}

function makeScannerDb(rows: Array<Record<string, unknown>>) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue(rows),
          })),
        })),
      })),
    })),
  };
}

function makePresetsDb(presets: Array<Record<string, unknown>> = []) {
  const orderByMock = vi.fn().mockResolvedValue(presets);
  const onConflictDoUpdateMock = vi.fn().mockResolvedValue(undefined);
  const insertValuesMock = vi.fn(() => ({ onConflictDoUpdate: onConflictDoUpdateMock }));
  const deleteWhereMock = vi.fn().mockResolvedValue(undefined);

  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: orderByMock,
        })),
      })),
    })),
    insert: vi.fn(() => ({ values: insertValuesMock })),
    delete: vi.fn(() => ({ where: deleteWhereMock })),
    _mocks: {
      deleteWhereMock,
      insertValuesMock,
      onConflictDoUpdateMock,
      orderByMock,
    },
  };
}

describe('scanner API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({ user: { id: 'user-1', email: 'u@example.com', name: null, picture: null } });
  });

  it('returns scanner results with filters and sort metadata', async () => {
    getDbMock.mockReturnValue(
      makeScannerDb([
        {
          symbol: 'AAPL',
          assetType: 'equity',
          lastPrice: 205.15,
          netChange: 2.14,
          netChangePercent: 1.05,
          totalVolume: 1500000,
          updatedAt: '2026-03-16T14:30:00.000Z',
        },
      ]),
    );

    const response = ensureResponse(
      await getScanner(
        new Request(
          'http://localhost/api/scanner?minPrice=10&assetType=equity&sortBy=symbol&sortDir=asc&limit=50',
        ),
      ),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      results: [
        {
          symbol: 'AAPL',
          assetType: 'equity',
          lastPrice: 205.15,
          netChange: 2.14,
          netChangePercent: 1.05,
          totalVolume: 1500000,
          updatedAt: '2026-03-16T14:30:00.000Z',
        },
      ],
      count: 1,
      filters: {
        minPrice: 10,
        maxPrice: undefined,
        minChangePercent: undefined,
        maxChangePercent: undefined,
        minVolume: undefined,
        assetType: 'equity',
      },
      sort: {
        sortBy: 'symbol',
        sortDir: 'asc',
      },
    });
  });

  it('returns an empty preset list for a user with none', async () => {
    getDbMock.mockReturnValue(makePresetsDb());

    const response = ensureResponse(await getPresets());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ presets: [] });
  });

  it('creates a preset and returns its name and filters', async () => {
    const db = makePresetsDb();
    getDbMock.mockReturnValue(db);

    const response = ensureResponse(
      await postPreset(
        new Request('http://localhost/api/scanner/presets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Momentum', filters: { minVolume: 1000000, assetType: 'equity' } }),
        }),
      ),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      name: 'Momentum',
      filters: { minVolume: 1000000, assetType: 'equity' },
    });
    expect(db._mocks.insertValuesMock).toHaveBeenCalledTimes(1);
    expect(db._mocks.onConflictDoUpdateMock).toHaveBeenCalledTimes(1);
  });

  it('rejects preset POST when name is missing', async () => {
    getDbMock.mockReturnValue(makePresetsDb());

    const response = ensureResponse(
      await postPreset(
        new Request('http://localhost/api/scanner/presets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filters: { minPrice: 5 } }),
        }),
      ),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'name is required' });
  });

  it('rejects preset POST when name is longer than 100 characters', async () => {
    getDbMock.mockReturnValue(makePresetsDb());

    const response = ensureResponse(
      await postPreset(
        new Request('http://localhost/api/scanner/presets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'x'.repeat(101), filters: {} }),
        }),
      ),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'name must be 100 characters or fewer' });
  });

  it('deletes a preset by id', async () => {
    const db = makePresetsDb();
    getDbMock.mockReturnValue(db);

    const response = ensureResponse(
      await deletePreset(new Request('http://localhost/api/scanner/presets?id=preset-1', { method: 'DELETE' })),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ success: true });
    expect(db._mocks.deleteWhereMock).toHaveBeenCalledTimes(1);
  });

  it('rejects preset DELETE when id is missing', async () => {
    getDbMock.mockReturnValue(makePresetsDb());

    const response = ensureResponse(
      await deletePreset(new Request('http://localhost/api/scanner/presets', { method: 'DELETE' })),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'id is required' });
  });
});

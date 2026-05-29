// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Execution } from '@/lib/types';

const { apiRequestMock } = vi.hoisted(() => ({
  apiRequestMock: vi.fn(),
}));

vi.mock('@/lib/trade-utils', () => ({
  apiRequest: apiRequestMock,
  fromApiTrade: vi.fn((trade) => ({
    ...trade,
    rawExecutions: trade.rawExecutions ?? [],
  })),
}));

import { prefetchTradeExecutions, useTradeExecutions } from '@/hooks/use-trade-executions';

function makeExecution(id: string): Execution {
  return {
    id,
    side: 'ENTRY',
    price: 10,
    qty: 100,
    time: '09:30:00',
    commission: 0,
    fees: 0,
  };
}

describe('useTradeExecutions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns seeded executions immediately without fetching', () => {
    const seeded = [makeExecution('seed-1')];

    const { result } = renderHook(() => useTradeExecutions('t-seed', seeded));

    expect(result.current).toBe(seeded);
    expect(apiRequestMock).not.toHaveBeenCalled();
  });

  it('returns a later seed over previously fetched executions', async () => {
    const fetched = [makeExecution('trans-fetched')];
    const seeded = [makeExecution('trans-seed')];
    apiRequestMock.mockResolvedValue({ trade: { rawExecutions: fetched } });

    const { result, rerender } = renderHook(
      ({ tradeId, seed }) => useTradeExecutions(tradeId, seed),
      { initialProps: { tradeId: 't-trans', seed: [] as Execution[] } },
    );

    await waitFor(() => expect(result.current).toEqual(fetched));

    rerender({ tradeId: 't-trans', seed: seeded });

    expect(result.current).toBe(seeded);
  });

  it('lazy-loads executions for a trade once', async () => {
    const executions = [makeExecution('fetch-1'), makeExecution('fetch-2')];
    apiRequestMock.mockResolvedValue({ trade: { rawExecutions: executions } });

    const { result } = renderHook(() => useTradeExecutions('t-fetch', []));

    expect(apiRequestMock).toHaveBeenCalledWith('/api/trades/t-fetch');
    await waitFor(() => expect(result.current).toEqual(executions));
    expect(apiRequestMock).toHaveBeenCalledTimes(1);
  });

  it('serves a second hook from the shared cache', async () => {
    const executions = [makeExecution('cache-1')];
    apiRequestMock.mockResolvedValue({ trade: { rawExecutions: executions } });

    const first = renderHook(() => useTradeExecutions('t-cache', []));
    await waitFor(() => expect(first.result.current).toEqual(executions));
    expect(apiRequestMock).toHaveBeenCalledTimes(1);

    const second = renderHook(() => useTradeExecutions('t-cache', []));

    expect(second.result.current).toEqual(executions);
    expect(apiRequestMock).toHaveBeenCalledTimes(1);
  });

  it('uses prefetched executions without refetching from the hook', async () => {
    const executions = [makeExecution('pre-1')];
    apiRequestMock.mockResolvedValue({ trade: { rawExecutions: executions } });

    await prefetchTradeExecutions(['t-pre']);
    expect(apiRequestMock).toHaveBeenCalledTimes(1);

    const { result } = renderHook(() => useTradeExecutions('t-pre', []));

    expect(result.current).toEqual(executions);
    expect(apiRequestMock).toHaveBeenCalledTimes(1);
  });
});

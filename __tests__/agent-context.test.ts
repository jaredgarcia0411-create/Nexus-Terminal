import { describe, expect, it, vi } from 'vitest';

import {
  agentConversations,
  agentReports,
  trades,
} from '@/lib/db/schema';
import type { MacroSummaryReport } from '@/lib/agents/types';
const getMemoryMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/agents/memory', () => ({
  getMemory: getMemoryMock,
}));

import { buildContext } from '@/lib/agents/context';

function createDb(tableRows: Map<unknown, unknown[][]> = new Map()) {
  const select = vi.fn(() => ({
    from(table: unknown) {
      const queue = tableRows.get(table) ?? [];
      tableRows.set(table, queue);

      return {
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: async (count: number) => {
              const rows = queue.shift() ?? [];
              return rows.slice(0, count);
            },
          })),
          limit: async (count: number) => {
            const rows = queue.shift() ?? [];
            return rows.slice(0, count);
          },
        })),
      };
    },
  }));

  return {
    select,
  };
}

describe('agent context helper', () => {
  it('returns the empty shape when all sources are empty', async () => {
    const rows = new Map<unknown, unknown[][]>();
    rows.set(trades, [[]]);
    rows.set(agentConversations, [[]]);
    rows.set(agentReports, [[]]);
    const db = createDb(rows);
    getMemoryMock.mockResolvedValueOnce([]);

    await expect(buildContext(db as never, 'user-1', 'orchestrator')).resolves.toEqual({
      recentTrades: [],
      macroSummary: null,
      memory: [],
      conversationHistory: [],
    });
  });

  it('assembles memory, trades, conversations, and the latest macro summary', async () => {
    const macroSummary = {
      tradingDate: '2026-04-08',
      marketBias: 'neutral',
      summary: 'macro payload',
      riskAssessment: 'Risk is balanced and rates remain the main variable.',
      drivers: [],
      crossAssetSnapshot: [],
      keyLevels: [],
      ratesOutlook: 'Rates are steady.',
      fredData: [],
      scheduledCatalysts: [],
      sectorRotation: [],
      scenarioAnalysis: {
        consensus: 'The market stays range-bound.',
        disruption: 'A surprise macro print breaks the range.',
      },
      deskImplications: [],
      sourceIndex: [],
      confidence: 'medium',
      tldr: ['Macro bias is neutral.'],
    } as MacroSummaryReport;
    const rows = new Map<unknown, unknown[][]>();
    rows.set(trades, [[
      { id: 'trade-1', sortKey: '2026-04-07', symbol: 'AAPL' },
    ]]);
    rows.set(agentConversations, [[
      { id: 'msg-1', role: 'user', content: 'hello', createdAt: new Date('2026-04-07T14:55:00.000Z') },
    ]]);
    rows.set(agentReports, [[
      { reportJson: macroSummary },
    ]]);
    const db = createDb(rows);
    getMemoryMock.mockResolvedValueOnce([
      {
        id: 'memory-1',
        userId: 'user-1',
        agentId: 'orchestrator',
        category: 'fact',
        key: 'bias',
        value: 'bullish',
        valueJson: { bias: 'bullish' },
        source: 'manual',
        confidence: 'high',
        createdAt: new Date('2026-04-07T15:00:00.000Z'),
        updatedAt: new Date('2026-04-07T15:10:00.000Z'),
        expiresAt: null,
      },
    ]);

    const context = await buildContext(db as never, 'user-1', 'orchestrator');

    expect(context).toMatchObject({
      recentTrades: [
        { id: 'trade-1', sortKey: '2026-04-07', symbol: 'AAPL' },
      ],
      macroSummary,
      memory: [
        {
          id: 'memory-1',
          userId: 'user-1',
          agentId: 'orchestrator',
        },
      ],
      conversationHistory: [
        { id: 'msg-1', role: 'user', content: 'hello', createdAt: new Date('2026-04-07T14:55:00.000Z') },
      ],
    });
    expect(db.select).toHaveBeenCalledTimes(3);
  });

  it('keeps legacy macro summary JSON available even when new fields are missing', async () => {
    const rows = new Map<unknown, unknown[][]>();
    rows.set(trades, [[]]);
    rows.set(agentConversations, [[]]);
    const legacyMacroSummary = {
      tradingDate: '2026-04-07',
      marketBias: 'neutral',
      summary: 'legacy macro payload',
      drivers: [],
      crossAssetSnapshot: [],
      scheduledCatalysts: [],
      sectorRotation: [],
      deskImplications: [],
      sourceIndex: [],
      confidence: 'medium',
    } as unknown as MacroSummaryReport;
    rows.set(agentReports, [[
      {
        reportJson: legacyMacroSummary,
      },
    ]]);
    const db = createDb(rows);
    getMemoryMock.mockResolvedValueOnce([]);

    await expect(buildContext(db as never, 'user-1', 'orchestrator')).resolves.toEqual({
      recentTrades: [],
      macroSummary: {
        ...legacyMacroSummary,
        riskAssessment: '',
        keyLevels: [],
        ratesOutlook: '',
        fredData: [],
        scenarioAnalysis: {
          consensus: '',
          disruption: '',
        },
        tldr: [],
      },
      memory: [],
      conversationHistory: [],
    });
  });
});

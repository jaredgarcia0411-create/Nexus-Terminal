import { describe, expect, it, vi } from 'vitest';

import { agentMemoryV2 } from '@/lib/db/schema';
import { getMemory, upsertMemory } from '@/lib/agents/memory';

function createDb(tableRows: Map<unknown, unknown[][]> = new Map()) {
  const insertedValues: unknown[] = [];
  const conflictCalls: unknown[] = [];

  const select = vi.fn(() => ({
    from(table: unknown) {
      const queue = tableRows.get(table) ?? [];
      tableRows.set(table, queue);

      return {
        where: vi.fn(async () => queue.shift() ?? []),
      };
    },
  }));

  const conflict = vi.fn(async (args: unknown) => {
    conflictCalls.push(args);
  });

  const values = vi.fn((value: unknown) => {
    insertedValues.push(value);
    return {
      onConflictDoUpdate: conflict,
    };
  });

  const insert = vi.fn(() => ({
    values,
  }));

  return {
    insert,
    select,
    _state: {
      insertedValues,
      conflictCalls,
    },
  };
}

describe('agent memory helpers', () => {
  it('reads from agent_memory_v2 and returns rows for the requested scope', async () => {
    const tableRows = new Map<unknown, unknown[][]>();
    tableRows.set(agentMemoryV2, [[
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
        updatedAt: new Date('2026-04-07T15:00:00.000Z'),
        expiresAt: null,
      },
    ]]);
    const db = createDb(tableRows);

    const memoryRows = await getMemory(db as never, 'user-1', 'orchestrator', 'fact');

    expect(memoryRows).toHaveLength(1);
    expect(memoryRows[0]).toMatchObject({
      id: 'memory-1',
      userId: 'user-1',
      agentId: 'orchestrator',
      category: 'fact',
      key: 'bias',
    });
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it('upserts memory rows through the live unique key', async () => {
    const db = createDb();

    await upsertMemory(db as never, {
      userId: 'user-1',
      agentId: 'orchestrator',
      category: 'strategy_note',
      key: 'entry-rule',
      value: 'buy strength',
      valueJson: { priority: 1 },
      source: 'manual',
      confidence: 'medium',
      expiresAt: null,
    });

    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db._state.insertedValues[0]).toMatchObject({
      userId: 'user-1',
      agentId: 'orchestrator',
      category: 'strategy_note',
      key: 'entry-rule',
      value: 'buy strength',
      valueJson: { priority: 1 },
      source: 'manual',
      confidence: 'medium',
      expiresAt: null,
    });
    expect((db._state.insertedValues[0] as { id?: string }).id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(db._state.conflictCalls[0]).toMatchObject({
      target: [
        agentMemoryV2.userId,
        agentMemoryV2.agentId,
        agentMemoryV2.category,
        agentMemoryV2.key,
      ],
      set: {
        value: 'buy strength',
        valueJson: { priority: 1 },
        source: 'manual',
        confidence: 'medium',
        expiresAt: null,
      },
    });
  });
});

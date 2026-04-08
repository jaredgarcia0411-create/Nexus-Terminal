import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentReports, agentStepEffects } from '@/lib/db/schema';

const recordStepEffectMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/agents/checkpoints', () => ({
  recordStepEffect: recordStepEffectMock,
}));

import {
  redeliverReport,
  resolveWebhookUrl,
  writeAndDeliverReport,
} from '@/lib/agents/discord';

type RowQueues = Map<unknown, unknown[][]>;

function createStoredReport(overrides: Partial<(typeof agentReports.$inferSelect)> = {}) {
  return {
    id: 'job-1:research',
    agentId: 'small-cap-trader',
    userId: 'user-1',
    jobId: 'job-1',
    reportType: 'research',
    title: 'Research note',
    summary: 'Setup is improving',
    reportJson: {
      ticker: 'NVDA',
      thesis: 'Momentum is expanding',
    },
    status: 'published',
    deliveryChannel: 'discord',
    deliveredAt: null,
    deliveryError: null,
    createdAt: new Date('2026-04-07T14:00:00.000Z'),
    ...overrides,
  };
}

function makeDb(tableRows: RowQueues = new Map()) {
  const reportInsertValuesMock = vi.fn(() => ({
    onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
  }));
  const reportUpdateWhereMock = vi.fn().mockResolvedValue(undefined);
  const reportUpdateSetMock = vi.fn(() => ({
    where: reportUpdateWhereMock,
  }));

  const db = {
    select: vi.fn(() => ({
      from(table: unknown) {
        const queue = tableRows.get(table) ?? [];
        tableRows.set(table, queue);

        return {
          where: vi.fn(() => ({
            limit: async (count: number) => {
              const rows = queue.shift() ?? [];
              return rows.slice(0, count);
            },
          })),
        };
      },
    })),
    insert: vi.fn((table: unknown) => {
      if (table === agentReports) {
        return { values: reportInsertValuesMock };
      }

      throw new Error('Unexpected table in insert mock');
    }),
    update: vi.fn((table: unknown) => {
      if (table === agentReports) {
        return { set: reportUpdateSetMock };
      }

      throw new Error('Unexpected table in update mock');
    }),
    _mocks: {
      reportInsertValuesMock,
      reportUpdateSetMock,
      reportUpdateWhereMock,
    },
  };

  return db;
}

describe('agent discord helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    recordStepEffectMock.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('writes the deterministic report row, posts the webhook, and records the success marker after a 2xx response', async () => {
    vi.stubEnv('DISCORD_WEBHOOK_RESEARCH', 'https://discord.test/research');

    const rows = new Map<unknown, unknown[][]>();
    rows.set(agentReports, [
      [],
      [createStoredReport()],
    ]);
    rows.set(agentStepEffects, [
      [],
    ]);

    const db = makeDb(rows);
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));

    const result = await writeAndDeliverReport(db as never, {
      jobId: 'job-1',
      userId: 'user-1',
      agentId: 'small-cap-trader',
      reportType: 'research',
      title: 'Research note',
      summary: 'Setup is improving',
      reportJson: { ticker: 'NVDA', thesis: 'Momentum is expanding' },
    });

    expect(result).toEqual({
      reportId: 'job-1:research',
      status: 'published',
      deliveryError: null,
    });
    expect(db._mocks.reportInsertValuesMock).toHaveBeenCalledWith(expect.objectContaining({
      id: 'job-1:research',
      deliveryChannel: 'discord',
      deliveredAt: null,
      deliveryError: null,
    }));
    expect(fetchSpy).toHaveBeenCalledWith('https://discord.test/research', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: expect.any(String),
      signal: expect.any(AbortSignal),
    }));
    expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))).toEqual({
      embeds: [
        expect.objectContaining({
          title: 'Research note',
          color: 0x10B981,
        }),
      ],
    });
    expect(db._mocks.reportUpdateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      status: 'published',
      deliveredAt: expect.any(Date),
      deliveryError: null,
    }));
    expect(recordStepEffectMock).toHaveBeenCalledWith(db, {
      jobId: 'job-1',
      stepName: 'discord-delivery',
      effectType: 'discord-delivery',
      idempotencyKey: 'discord-delivery:job-1:research',
    });
    expect(db._mocks.reportInsertValuesMock.mock.invocationCallOrder[0]).toBeLessThan(fetchSpy.mock.invocationCallOrder[0]);
    expect(db._mocks.reportUpdateSetMock.mock.invocationCallOrder[0]).toBeLessThan(recordStepEffectMock.mock.invocationCallOrder[0]);
  });

  it('reuses the stored report row and skips reposting once the success marker exists', async () => {
    vi.stubEnv('DISCORD_WEBHOOK_RESEARCH', 'https://discord.test/research');

    const storedReport = createStoredReport();
    const rows = new Map<unknown, unknown[][]>();
    rows.set(agentReports, [
      [],
      [storedReport],
      [storedReport],
    ]);
    rows.set(agentStepEffects, [
      [],
      [{ id: 'effect-1' }],
    ]);

    const db = makeDb(rows);
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));

    const firstResult = await writeAndDeliverReport(db as never, {
      jobId: 'job-1',
      userId: 'user-1',
      agentId: 'small-cap-trader',
      reportType: 'research',
      title: 'Research note',
      summary: 'Setup is improving',
      reportJson: { ticker: 'NVDA' },
    });
    const secondResult = await writeAndDeliverReport(db as never, {
      jobId: 'job-1',
      userId: 'user-1',
      agentId: 'small-cap-trader',
      reportType: 'research',
      title: 'Changed title that should not matter',
      summary: 'Changed summary',
      reportJson: { ticker: 'TSLA' },
    });

    expect(firstResult.status).toBe('published');
    expect(secondResult).toEqual({
      reportId: 'job-1:research',
      status: 'published',
      deliveryError: null,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(db._mocks.reportUpdateSetMock).toHaveBeenCalledTimes(1);
    expect(recordStepEffectMock).toHaveBeenCalledTimes(1);
  });

  it('stores delivery_failed state when Discord returns a non-2xx response', async () => {
    vi.stubEnv('DISCORD_WEBHOOK_RESEARCH', 'https://discord.test/research');

    const rows = new Map<unknown, unknown[][]>();
    rows.set(agentReports, [
      [],
      [createStoredReport()],
    ]);
    rows.set(agentStepEffects, [
      [],
    ]);

    const db = makeDb(rows);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ error: 'webhook exploded' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    ));

    const result = await writeAndDeliverReport(db as never, {
      jobId: 'job-1',
      userId: 'user-1',
      agentId: 'small-cap-trader',
      reportType: 'research',
      title: 'Research note',
      summary: 'Setup is improving',
      reportJson: { ticker: 'NVDA' },
    });

    expect(result).toEqual({
      reportId: 'job-1:research',
      status: 'delivery_failed',
      deliveryError: '500: webhook exploded',
    });
    expect(db._mocks.reportUpdateSetMock).toHaveBeenCalledWith({
      status: 'delivery_failed',
      deliveryError: '500: webhook exploded',
    });
    expect(recordStepEffectMock).not.toHaveBeenCalled();
  });

  it('stores delivery_failed state when fetch throws', async () => {
    vi.stubEnv('DISCORD_WEBHOOK_RESEARCH', 'https://discord.test/research');

    const rows = new Map<unknown, unknown[][]>();
    rows.set(agentReports, [
      [],
      [createStoredReport()],
    ]);
    rows.set(agentStepEffects, [
      [],
    ]);

    const db = makeDb(rows);
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

    const result = await writeAndDeliverReport(db as never, {
      jobId: 'job-1',
      userId: 'user-1',
      agentId: 'small-cap-trader',
      reportType: 'research',
      title: 'Research note',
      summary: 'Setup is improving',
      reportJson: { ticker: 'NVDA' },
    });

    expect(result).toEqual({
      reportId: 'job-1:research',
      status: 'delivery_failed',
      deliveryError: 'network down',
    });
    expect(db._mocks.reportUpdateSetMock).toHaveBeenCalledWith({
      status: 'delivery_failed',
      deliveryError: 'network down',
    });
    expect(recordStepEffectMock).not.toHaveBeenCalled();
  });

  it('resolves known webhook mappings without warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    vi.stubEnv('DISCORD_WEBHOOK_RESEARCH', 'https://discord.test/research');
    vi.stubEnv('DISCORD_WEBHOOK_SWING_SETUPS', 'https://discord.test/swing-setups');

    expect(resolveWebhookUrl('small-cap-trader', 'research')).toBe('https://discord.test/research');
    expect(resolveWebhookUrl('swing-trader', 'research')).toBe('https://discord.test/swing-setups');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('returns null for unknown webhook combinations and logs the mismatch once', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(resolveWebhookUrl('orchestrator', 'chat')).toBeNull();
    expect(resolveWebhookUrl('orchestrator', 'chat')).toBeNull();

    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('marks delivery_failed when no webhook is configured', async () => {
    const rows = new Map<unknown, unknown[][]>();
    rows.set(agentReports, [
      [createStoredReport()],
    ]);
    rows.set(agentStepEffects, [
      [],
    ]);

    const db = makeDb(rows);
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));

    const result = await writeAndDeliverReport(db as never, {
      jobId: 'job-1',
      userId: 'user-1',
      agentId: 'small-cap-trader',
      reportType: 'research',
      title: 'Incoming title',
      summary: 'Incoming summary',
      reportJson: { ticker: 'TSLA' },
    });

    expect(result).toEqual({
      reportId: 'job-1:research',
      status: 'delivery_failed',
      deliveryError: 'no webhook configured for small-cap-trader/research',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(db._mocks.reportUpdateSetMock).toHaveBeenCalledWith({
      status: 'delivery_failed',
      deliveryError: 'no webhook configured for small-cap-trader/research',
    });
    expect(recordStepEffectMock).not.toHaveBeenCalled();
  });

  it('uses the stored row as the source of truth when delivering an existing report', async () => {
    vi.stubEnv('DISCORD_WEBHOOK_RESEARCH', 'https://discord.test/research');

    const storedReport = createStoredReport({
      title: 'Stored title',
      summary: 'Stored summary',
      reportJson: {
        ticker: 'NVDA',
        thesis: 'Stored thesis',
      },
    });
    const rows = new Map<unknown, unknown[][]>();
    rows.set(agentReports, [
      [storedReport],
    ]);
    rows.set(agentStepEffects, [
      [],
    ]);

    const db = makeDb(rows);
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));

    const result = await writeAndDeliverReport(db as never, {
      jobId: 'job-1',
      userId: 'user-1',
      agentId: 'small-cap-trader',
      reportType: 'research',
      title: 'Incoming title',
      summary: 'Incoming summary',
      reportJson: { ticker: 'TSLA', thesis: 'Incoming thesis' },
    });

    expect(result).toEqual({
      reportId: 'job-1:research',
      status: 'published',
      deliveryError: null,
    });
    expect(db._mocks.reportInsertValuesMock).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledWith('https://discord.test/research', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: expect.any(String),
      signal: expect.any(AbortSignal),
    }));
    expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))).toEqual({
      embeds: [
        expect.objectContaining({
          title: 'Stored title',
          description: 'Stored summary',
        }),
      ],
    });
  });

  it('manual redelivery posts again even when the success marker already exists', async () => {
    vi.stubEnv('DISCORD_WEBHOOK_RESEARCH', 'https://discord.test/research');

    const storedReport = createStoredReport();
    const rows = new Map<unknown, unknown[][]>();
    rows.set(agentReports, [
      [storedReport],
    ]);
    rows.set(agentStepEffects, [
      [{ id: 'effect-1' }],
    ]);

    const db = makeDb(rows);
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));

    const result = await redeliverReport(db as never, 'job-1:research');

    expect(result).toEqual({
      status: 'published',
      deliveryError: null,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(recordStepEffectMock).toHaveBeenCalledWith(db, expect.objectContaining({
      jobId: 'job-1',
      stepName: 'discord-delivery-manual',
      effectType: 'discord-delivery',
      idempotencyKey: expect.stringMatching(/^discord-delivery:job-1:research:manual:/),
    }));
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentReports, agentStepEffects } from '@/lib/db/schema';

const recordStepEffectMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/agents/checkpoints', () => ({
  recordStepEffect: recordStepEffectMock,
}));

import {
  buildMacroIntradayEmbed,
  buildResearchEmbed,
  buildMacroSummaryEmbed,
  buildSwingSetupEmbed,
  redeliverReport,
  resolveWebhookUrl,
  writeAndDeliverReport,
} from '@/lib/agents/discord';
import type {
  MacroSummaryReport,
  SmallCapResearchReport,
  SwingResearchReport,
} from '@/lib/agents/types';

type RowQueues = Map<unknown, unknown[][]>;

interface MacroSummaryReportFixture extends MacroSummaryReport {
  sentimentData?: {
    score: number;
    classification: string;
    source: string;
  };
  deltas?: string[];
}

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
      newsWhyRunning: { rating: 'yellow', explanation: 'Headline is getting attention.' },
      chartHistory: { rating: 'green', explanation: 'Ticker usually fades after opening pops.' },
      dilution: { rating: 'green', explanation: 'Registration is active and usable.' },
      offeringAbility: { rating: 'green', explanation: 'ATM can be tapped immediately.' },
      cashNeed: { rating: 'yellow', explanation: 'Runway is moderate.' },
      overallOfferingRisk: { rating: 'green', explanation: 'Offering probability is elevated.' },
      historicalStats: 'Average gap fade 18%.',
      gapStatsTable: [],
      financialCommentary: { rating: 'yellow', explanation: 'Management commentary was mixed.' },
      confidence: 'high',
    },
    status: 'published',
    deliveryChannel: 'discord',
    deliveredAt: null,
    deliveryError: null,
    createdAt: new Date('2026-04-07T14:00:00.000Z'),
    ...overrides,
  };
}

function createSmallCapReportJson(overrides: Partial<SmallCapResearchReport> = {}): SmallCapResearchReport {
  return {
    ticker: 'NVDA',
    newsWhyRunning: { rating: 'yellow', explanation: 'Headline is getting attention.' },
    themeMatch: { rating: 'green', explanation: 'Theme alignment is strong.' },
    otherCatalysts: [
      { catalyst: 'Positioning remains crowded', rating: 'yellow' },
    ],
    chartHistory: { rating: 'green', explanation: 'Ticker usually fades after opening pops.' },
    dilution: { rating: 'green', explanation: 'Registration is active and usable.' },
    offeringFrequency: { rating: 'yellow', explanation: 'Offerings are not frequent, but still possible.' },
    offeringAbility: { rating: 'green', explanation: 'ATM can be tapped immediately.' },
    cashNeed: { rating: 'yellow', explanation: 'Runway is moderate.' },
    overallOfferingRisk: { rating: 'green', explanation: 'Offering probability is elevated.' },
    jmt415Commentary: 'JMT-415 context is supportive.',
    historicalStats: 'Average gap fade 18%.',
    gapStatsTable: [],
    financialCommentary: { rating: 'yellow', explanation: 'Management commentary was mixed.' },
    confidence: 'high',
    evidenceIds: ['news:1', 'chart:1'],
    ...overrides,
  };
}

function createSwingReportJson(overrides: Partial<SwingResearchReport> = {}): SwingResearchReport {
  return {
    ticker: 'NVDA',
    mdrPatternMatch: { rating: 'green', explanation: 'Clean MDR analog.', mdrSimilarity: 87 },
    momentum: { rating: 'yellow', explanation: 'Momentum is still positive but slowing.' },
    catalyst: { rating: 'green', explanation: 'Catalyst remains in play.' },
    patternClassification: 'CONTINUATION',
    recommendation: { action: 'ADD', reasoning: 'Trend is intact above short-term support.' },
    volumeProfile: { rating: 'green', explanation: 'Volume remains elevated.' },
    gapStatsTable: [],
    financialCommentary: { rating: 'green', explanation: 'No financing stress was disclosed.' },
    confidence: 'medium',
    evidenceIds: ['pattern:1', 'volume:1'],
    ...overrides,
  };
}

function createMacroReportJson(
  overrides: Partial<MacroSummaryReportFixture> = {},
): MacroSummaryReportFixture {
  return {
    tradingDate: '2026-04-12',
    marketBias: 'bullish',
    summary: 'Risk appetite improved as macro data eased near-term rate fears.',
    riskAssessment: 'Rates and volatility are still the main cross-asset risks, but breadth is constructive.',
    drivers: [
      { driver: 'CPI print came in softer than expected', impact: 'positive', sourceRefs: ['headline:1'] },
      { driver: 'Fed speakers stayed balanced', impact: 'mixed', sourceRefs: ['headline:2'] },
      { driver: 'Rates backed off into the close', impact: 'negative', sourceRefs: ['snapshot:TLT'] },
    ],
    crossAssetSnapshot: [
      { ticker: 'SPY', price: 520.12, changePercent: 0.8 },
      { ticker: 'TLT', price: 95.34, changePercent: -0.4 },
    ],
    keyLevels: [
      { ticker: 'SPY', support: '520.00', resistance: '535.00', note: 'Prior breakout range remains intact.' },
      { ticker: 'QQQ', support: '450.00', resistance: '462.00', note: 'Semis-led leadership is holding.' },
    ],
    ratesOutlook: '10Y yields remain the key driver for tape direction, while the curve is still constructive.',
    fredData: [
      { seriesId: 'DGS10', label: '10Y Treasury', date: '2026-04-11', value: 4.32 },
      { seriesId: 'T10Y2Y', label: '10Y-2Y Spread', date: '2026-04-11', value: 0.47 },
    ],
    scheduledCatalysts: [
      { event: 'FOMC rate decision', date: '2026-04-15', expectedImpact: 'Could reset the risk-on backdrop.' },
    ],
    sectorRotation: ['Semis bid', 'Utilities lagged'],
    scenarioAnalysis: {
      consensus: 'SPY stays above support and large-cap growth keeps leadership.',
      disruption: 'A sharp move higher in yields breaks support and narrows breadth.',
    },
    deskImplications: ['Stay long beta into stronger tape.', 'Fade extended rates rallies.'],
    sourceIndex: [
      { id: 'headline:1', title: 'MarketWatch Latest News', url: 'https://example.com/1', fetchedAt: '2026-04-12T13:00:00.000Z' },
      { id: 'snapshot:TLT', title: 'TLT Session Snapshot', url: null, fetchedAt: '2026-04-12T13:00:00.000Z' },
    ],
    confidence: 'high',
    tldr: ['Risk appetite is improving.', 'Watch SPY 520 support and 10Y yields.'],
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

    vi.stubEnv('DISCORD_WEBHOOK_MACRO_DAILY', 'https://discord.test/macro-daily');
    vi.stubEnv('DISCORD_WEBHOOK_RESEARCH', 'https://discord.test/research');
    vi.stubEnv('DISCORD_WEBHOOK_SWING_SETUPS', 'https://discord.test/swing-setups');

    expect(resolveWebhookUrl('orchestrator', 'macro-summary')).toBe('https://discord.test/macro-daily');
    expect(resolveWebhookUrl('orchestrator', 'macro-intraday')).toBe('https://discord.test/macro-daily');
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
        newsWhyRunning: { rating: 'yellow', explanation: 'Stored catalyst context.' },
        chartHistory: { rating: 'green', explanation: 'Stored chart history.' },
        dilution: { rating: 'green', explanation: 'Stored dilution signal.' },
        offeringAbility: { rating: 'green', explanation: 'Stored offering ability.' },
        cashNeed: { rating: 'yellow', explanation: 'Stored cash need.' },
        overallOfferingRisk: { rating: 'green', explanation: 'Stored overall risk.' },
        historicalStats: 'Stored historical stats.',
        gapStatsTable: [],
        financialCommentary: { rating: 'yellow', explanation: 'Stored commentary was mixed.' },
        confidence: 'high',
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
          description: expect.stringContaining('**Offering Risk** 🟢\n• Stored overall risk.'),
        }),
      ],
    });
  });

  it('builds the small-cap research embed with traffic-light lines and history', () => {
    const embed = buildResearchEmbed(createStoredReport({
      reportJson: createSmallCapReportJson({
        newsWhyRunning: { rating: 'yellow', explanation: 'Headline is driving the move.' },
        chartHistory: { rating: 'green', explanation: 'This ticker usually fades.' },
        dilution: { rating: 'green', explanation: 'Shelf remains active.' },
        offeringAbility: { rating: 'green', explanation: 'ATM is live.' },
        cashNeed: { rating: 'red', explanation: 'Cash runway is healthy.' },
        overallOfferingRisk: { rating: 'green', explanation: 'Odds of an offering remain high.' },
        historicalStats: 'Average gap fade 22%.',
        gapStatsTable: [{ date: '2026-04-11', gapPct: 12.34, open: 1.23, close: 1.1 }],
        financialCommentary: { rating: 'red', explanation: 'Management highlighted liquidity concerns.' },
      }),
    }) as never);

    expect(embed.description).toContain('**Offering Risk** 🟢\n• Odds of an offering remain high.');
    expect(embed.description).toContain('**News/Catalyst** 🟡\n• Headline is driving the move.');
    expect(embed.description).toContain('**Financial Commentary** 🔴\n• Management highlighted liquidity concerns.');
    expect(embed.description).toContain('**Gap History**');
    expect(embed.description).toContain('2026-04-11 | +  12.34% |    1.23 |     1.1');
    expect(embed.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Ticker', value: 'NVDA' }),
      expect.objectContaining({ name: 'Confidence', value: 'high' }),
      expect.objectContaining({
        name: 'Historical Stats',
        value: '```\nAverage gap fade 22%.\n```',
        inline: false,
      }),
    ]));
  });

  it('builds the swing setup embed from nested recommendation and MDR fields', () => {
    const embed = buildSwingSetupEmbed(createStoredReport({
      agentId: 'swing-trader',
      reportJson: createSwingReportJson({
        gapStatsTable: [{ date: '2026-04-11', gapPct: 8.5, open: 10, close: 10.8 }],
        financialCommentary: { rating: 'red', explanation: 'Management flagged financing needs.' },
      }),
    }) as never);

    expect(embed.description).toContain('**MDR Match** 🟢\n• Clean MDR analog.');
    expect(embed.description).toContain('**Momentum** 🟡\n• Momentum is still positive but slowing.');
    expect(embed.description).toContain('**Financial Commentary** 🔴\n• Management flagged financing needs.');
    expect(embed.description).toContain('2026-04-11 | +   8.50% |      10 |    10.8');
    expect(embed.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Pattern', value: 'CONTINUATION' }),
      expect.objectContaining({ name: 'MDR Similarity', value: '87%' }),
      expect.objectContaining({ name: 'Action', value: 'ADD' }),
      expect.objectContaining({ name: 'Reasoning', value: 'Trend is intact above short-term support.', inline: false }),
    ]));
  });

  it('builds the macro summary embed from the typed report contract', () => {
    const embed = buildMacroSummaryEmbed(createStoredReport({
      agentId: 'orchestrator',
      reportType: 'macro-summary',
      title: '2026-04-12 macro briefing',
      summary: 'Legacy summary should not be used for the embed body.',
      reportJson: createMacroReportJson(),
    }) as never);

    expect(embed.description).toBe('Risk appetite improved as macro data eased near-term rate fears.');
    const fields = embed.fields ?? [];
    expect(fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Market Bias', value: 'bullish' }),
      expect.objectContaining({ name: 'Confidence', value: 'high' }),
      expect.objectContaining({
        name: 'Risk Assessment',
        value: expect.stringContaining('Rates and volatility are still the main cross-asset risks'),
        inline: false,
      }),
      expect.objectContaining({
        name: 'Key Levels',
        value: expect.stringContaining('**SPY**: 520.00 / 535.00'),
        inline: false,
      }),
      expect.objectContaining({
        name: 'Rates',
        value: expect.stringContaining('10Y Treasury: 4.32%'),
        inline: false,
      }),
      expect.objectContaining({
        name: 'Catalysts',
        value: expect.stringContaining('FOMC rate decision (2026-04-15) - Could reset the risk-on backdrop.'),
        inline: false,
      }),
      expect.objectContaining({
        name: 'Desk Implications',
        value: expect.stringContaining('• Stay long beta into stronger tape.'),
        inline: false,
      }),
      expect.objectContaining({
        name: 'Sector Rotation',
        value: expect.stringContaining('• Semis bid'),
        inline: false,
      }),
      expect.objectContaining({
        name: 'Scenarios',
        value: expect.stringContaining('Consensus'),
        inline: false,
      }),
      expect.objectContaining({
        name: 'TLDR',
        value: expect.stringContaining('• Risk appetite is improving.'),
        inline: false,
      }),
    ]));
    const topDrivers = fields.find((field) => field.name === 'Top Drivers');
    expect(topDrivers).toEqual(expect.objectContaining({
      name: 'Top Drivers',
      inline: false,
    }));
    expect(topDrivers?.value).toContain('🟢 CPI print came in softer than expected');
    expect(topDrivers?.value).toContain('🟡 Fed speakers stayed balanced');
    expect(topDrivers?.value).toContain('🔴 Rates backed off into the close');
    expect(fields.some((field) => field.name === 'crossAssetSnapshot')).toBe(false);
  });

  it('renders the Fear & Greed field when sentiment data is present', () => {
    const embed = buildMacroSummaryEmbed(createStoredReport({
      agentId: 'orchestrator',
      reportType: 'macro-summary',
      title: '2026-04-12 macro briefing',
      summary: 'Legacy summary should not be used for the embed body.',
      reportJson: createMacroReportJson({
        sentimentData: {
          score: 23,
          classification: 'Extreme Fear',
          source: 'alternative.me/fng',
        },
      }),
    }) as never);

    const fields = embed.fields ?? [];
    const fearAndGreed = fields.find((field) => field.name === 'Fear & Greed');

    expect(fearAndGreed).toEqual(expect.objectContaining({
      name: 'Fear & Greed',
      value: expect.stringContaining('23/100 - Extreme Fear'),
      inline: false,
    }));
  });

  it('skips Fear & Greed when sentiment data is absent', () => {
    const embed = buildMacroSummaryEmbed(createStoredReport({
      agentId: 'orchestrator',
      reportType: 'macro-summary',
      title: '2026-04-12 macro briefing',
      summary: 'Legacy summary should not be used for the embed body.',
      reportJson: createMacroReportJson(),
    }) as never);

    const fields = embed.fields ?? [];

    expect(fields.some((field) => field.name === 'Fear & Greed')).toBe(false);
  });

  it('skips empty macro summary sections and omits rates when fred data is unavailable', () => {
    const embed = buildMacroSummaryEmbed(createStoredReport({
      agentId: 'orchestrator',
      reportType: 'macro-summary',
      title: '2026-04-12 macro briefing',
      reportJson: createMacroReportJson({
        fredData: [],
        ratesOutlook: 'Rates still matter, but no hard data was available.',
        scheduledCatalysts: [],
        sectorRotation: [],
        deskImplications: [],
      }),
    }) as never);

    const fieldNames = (embed.fields ?? []).map((field) => field.name);

    expect(fieldNames).not.toContain('Rates');
    expect(fieldNames).not.toContain('Catalysts');
    expect(fieldNames).not.toContain('Sector Rotation');
    expect(fieldNames).not.toContain('Desk Implications');
  });

  it('renders the Deltas field when delta sentences are present', () => {
    const embed = buildMacroSummaryEmbed(createStoredReport({
      agentId: 'orchestrator',
      reportType: 'macro-summary',
      title: '2026-04-12 macro briefing',
      reportJson: createMacroReportJson({
        deltas: ['10Y at 4.32%, unchanged from yesterday.'],
      }),
    }) as never);

    const deltas = (embed.fields ?? []).find((field) => field.name === 'Deltas');

    expect(deltas).toEqual(expect.objectContaining({
      name: 'Deltas',
      value: expect.stringContaining('10Y at 4.32%, unchanged from yesterday.'),
      inline: false,
    }));
  });

  it('builds the macro intraday embed with session-specific sections', () => {
    const embed = buildMacroIntradayEmbed(createStoredReport({
      agentId: 'orchestrator',
      reportType: 'macro-intraday',
      title: '2026-04-12 intraday macro update',
      summary: 'Stored summary should remain the embed description.',
      reportJson: {
        tradingDate: '2026-04-12',
        sessionBias: 'bullish',
        sessionSummary: 'The session held the morning thesis and breadth improved into noon.',
        surprises: ['Semis are outperforming the morning brief.', 'UUP is fading despite stronger yields.'],
        updatedKeyWatch: 'Watch whether SPY can hold VWAP into the afternoon.',
        deskNote: 'Keep size small into lunch but lean with semis.',
      },
    }) as never);

    expect(embed.description).toBe('Stored summary should remain the embed description.');
    expect(embed.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Session Bias', value: 'bullish' }),
      expect.objectContaining({
        name: 'Surprises',
        value: expect.stringContaining('• Semis are outperforming the morning brief.'),
        inline: false,
      }),
      expect.objectContaining({
        name: 'Key Watch',
        value: 'Watch whether SPY can hold VWAP into the afternoon.',
        inline: false,
      }),
      expect.objectContaining({
        name: 'Desk Note',
        value: 'Keep size small into lunch but lean with semis.',
        inline: false,
      }),
    ]));
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

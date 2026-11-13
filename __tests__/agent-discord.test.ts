import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentReports, agentStepEffects } from '@/lib/db/schema';

const recordStepEffectMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/agents/checkpoints', () => ({
  recordStepEffect: recordStepEffectMock,
}));

import {
  buildMacroIntradayEmbed,
  buildParabolicScanEmbeds,
  buildTripleBeatScanEmbeds,
  buildResearchEmbed,
  buildMacroSummaryEmbeds,
  buildSwingSetupEmbed,
  packEmbedsForDiscord,
  redeliverReport,
  resolveWebhookUrl,
  writeAndDeliverReport,
} from '@/lib/agents/discord';
import type {
  MacroSummaryReport,
  SmallCapResearchReport,
  SwingResearchReport,
} from '@/lib/agents/types';

import { evaluateTripleBeatSetup } from '@/lib/triple-beat/scan';
import { UNKNOWN_EARNINGS_READ } from '@/lib/triple-beat/classify';

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
    gapStatsTable: [],
    financialCommentary: { rating: 'yellow', explanation: 'Management commentary was mixed.', source: 'llm' },
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
    financialCommentary: { rating: 'green', explanation: 'No financing stress was disclosed.', source: 'llm' },
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

// Real 2026-10-29 NUWE scan values, re-dated to the shared 2026-04-07 fixture day.
function createParabolicReportJson() {
  const met = (label: string, maxPoints: number) => ({ label, maxPoints, points: maxPoints, status: 'met' });
  const missed = (label: string, maxPoints: number) => ({ label, maxPoints, points: 0, status: 'not met' });
  return {
    tradingDate: '2026-04-07',
    asOf: '2026-04-07T13:00:00.000Z',
    candidatesChecked: 26,
    setups: [{
      ticker: 'NUWE', qualified: true, failedFilters: [], grade: 'C', score: 8, maxScore: 17,
      scoreItems: [
        met('3+ consecutive green days', 2), met('Trade-day gap-up', 3), missed('2+ consecutive gap-ups', 2),
        missed('Accelerating daily ranges', 3), missed('Increasing daily volume', 2), missed('Significant MA extension', 2),
        { label: 'Opening volume climax', maxPoints: 2, points: 0, status: 'unknown' }, met('Clean parabolic structure', 3),
      ],
      metrics: { tradeDayGapPct: 22.6, ext10Pct: 50.8, greenStreak: 3 },
      plan: { riskFraction: 0, entry: 6.94, stop: 7.56, riskPerShare: 0.62, target1: 5.66, target1RR: 2.04, target2: 4.76, target2RR: 3.52 },
    }],
  };
}

function createTripleBeatReportJson() {
  const history = Array.from({ length: 80 }, () => ({
    date: '2026-10-28', open: 19.9, high: 20.4, low: 19.6, close: 20, volume: 2000000, vwap: null,
  }));
  const setup = evaluateTripleBeatSetup(history, {
    last: 23, high: 23.4, low: 21.5, volume: 800000, premarketHigh: 23.4, premarketLow: 22.6, premarketVolume: 500000,
  }, {
    ...UNKNOWN_EARNINGS_READ, epsBeat: 'yes', revenueBeat: 'yes', guidance: 'raised',
    note: 'Beat on EPS and revenue and raised full-year guidance.',
  }, 20_000_000)!;
  return {
    tradingDate: '2026-10-29', asOf: '2026-10-29T13:00:00.000Z', earningsFilings: 2,
    setups: [{ ticker: 'NCLH', ...setup, plan: setup.plan! }],
  };
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
    vi.stubEnv('DISCORD_WEBHOOK_TRIPLE_BEAT', 'https://discord.test/triple-beat');
    vi.stubEnv('DISCORD_WEBHOOK_PARABOLIC', 'https://discord.test/parabolic');
    vi.stubEnv('DISCORD_WEBHOOK_RESEARCH', 'https://discord.test/research');
    vi.stubEnv('DISCORD_WEBHOOK_SWING_SETUPS', 'https://discord.test/swing-setups');

    expect(resolveWebhookUrl('orchestrator', 'macro-summary')).toBe('https://discord.test/macro-daily');
    expect(resolveWebhookUrl('orchestrator', 'macro-intraday')).toBe('https://discord.test/macro-daily');
    expect(resolveWebhookUrl('orchestrator', 'parabolic-scan')).toBe('https://discord.test/parabolic');
    expect(resolveWebhookUrl('orchestrator', 'triple-beat-scan')).toBe('https://discord.test/triple-beat');
    expect(resolveWebhookUrl('small-cap-trader', 'research')).toBe('https://discord.test/research');
    expect(resolveWebhookUrl('swing-trader', 'research')).toBe('https://discord.test/swing-setups');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('renders an empty parabolic scan as one gray header card', () => {
    const embeds = buildParabolicScanEmbeds(createStoredReport({
      agentId: 'orchestrator', reportType: 'parabolic-scan',
      summary: 'No qualified parabolic short setups.',
      reportJson: { tradingDate: '2026-04-07', asOf: '2026-04-07T13:00:00.000Z', candidatesChecked: 12, setups: [] },
    }) as never);
    expect(embeds).toEqual([{
      title: 'Parabolic shorts · Tue, Apr 7',
      description: 'No setups today · 12 scanned · premarket as of 9:00 AM ET',
      color: 0x80848E,
    }]);
  });

  it('renders a header card plus one grade-colored card per parabolic setup', () => {
    const embeds = buildParabolicScanEmbeds(createStoredReport({
      agentId: 'orchestrator', reportType: 'parabolic-scan',
      reportJson: createParabolicReportJson(),
    }) as never);
    expect(embeds).toHaveLength(2);
    expect(embeds[0]).toMatchObject({
      title: 'Parabolic shorts · Tue, Apr 7',
      description: '🟢 A 0 · 🟡 B 0 · ⚪ C 1 · 26 scanned · premarket as of 9:00 AM ET\n⚠️ Confirm borrow. Short the open with the card\'s stop. Same size for every grade. Gap fill isn\'t the exit: hold to the close unless stopped.',
      color: 0x5865F2,
    });
    expect(embeds[1]).toEqual({
      description: '**NUWE**\n**C · 8/17**',
      color: 0x80848E,
      fields: [
        { name: 'Entry', value: '$6.94', inline: true },
        { name: 'Stop', value: '$7.56', inline: true },
        { name: 'Risk / share', value: '$0.62', inline: true },
        { name: 'Gap fill', value: '$5.66 · 2.0R', inline: true },
        { name: '9EMA', value: '$4.76 · 3.5R', inline: true },
        { name: 'Gap · 10SMA', value: '+22.6% · +51%', inline: true },
        { name: 'Checklist', value: 'Green 3 ✅  Gap ✅  Gap-ups ❌  Ranges ❌  Volume ❌  MA ext ❌  Climax ❔  Parabolic ✅', inline: false },
      ],
    });
  });

  it('puts the name and the grade plus fund type on the first two card lines', () => {
    const parabolic = createParabolicReportJson();
    const parabolicEmbeds = buildParabolicScanEmbeds(createStoredReport({
      agentId: 'orchestrator', reportType: 'parabolic-scan',
      reportJson: { ...parabolic, setups: [{ ...parabolic.setups[0], name: 'Defiance Daily Target 2x Short PLTR ETF', fundType: 'ETF' }] },
    }) as never);
    expect(parabolicEmbeds[1].description).toBe('**NUWE · Defiance Daily Target 2x Short PLTR ETF**\n**C · 8/17** · ETF');
    const tripleBeat = createTripleBeatReportJson();
    const tripleBeatEmbeds = buildTripleBeatScanEmbeds(createStoredReport({
      agentId: 'orchestrator', reportType: 'triple-beat-scan',
      reportJson: { ...tripleBeat, setups: [{ ...tripleBeat.setups[0], name: 'Norwegian Cruise Line Holdings Ltd.' }] },
    }) as never);
    expect(tripleBeatEmbeds[1].description).toMatch(/^\*\*NCLH · Norwegian Cruise Line Holdings Ltd\.\*\*\n\*\*A\+ · 45\/45\*\*/);
  });

  it('posts every parabolic card in a single webhook message', async () => {
    vi.stubEnv('DISCORD_WEBHOOK_PARABOLIC', 'https://discord.test/parabolic');
    const stored = createStoredReport({
      id: 'job-1:parabolic-scan', agentId: 'orchestrator', reportType: 'parabolic-scan',
      title: '2026-04-07 parabolic short scan', reportJson: createParabolicReportJson(),
    });
    const rows = new Map<unknown, unknown[][]>();
    rows.set(agentReports, [[], [stored]]);
    rows.set(agentStepEffects, [[]]);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));

    await writeAndDeliverReport(makeDb(rows) as never, {
      jobId: 'job-1', userId: 'system-agent-user', agentId: 'orchestrator', reportType: 'parabolic-scan',
      title: stored.title, summary: null, reportJson: stored.reportJson,
    });

    const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
    expect(body.embeds.map((embed: { title: string }) => embed.title))
      .toEqual(['Parabolic shorts · Tue, Apr 7', undefined]);
  });

  it('renders an empty Triple Beat scan as a gray card', () => {
    const embeds = buildTripleBeatScanEmbeds(createStoredReport({
      agentId: 'orchestrator', reportType: 'triple-beat-scan',
      reportJson: { ...createTripleBeatReportJson(), setups: [] },
    }) as never);
    expect(embeds).toEqual([{
      title: 'Triple Beat earnings · Thu, Oct 29',
      description: 'No setups today · 2 earnings filers · premarket as of 9:00 AM ET',
      color: 0x80848E,
    }]);
  });

  it('renders the Triple Beat header, plan fields, evidence note, and checklist', () => {
    const embeds = buildTripleBeatScanEmbeds(createStoredReport({
      agentId: 'orchestrator', reportType: 'triple-beat-scan', reportJson: createTripleBeatReportJson(),
    }) as never);
    expect(embeds).toHaveLength(2);
    expect(embeds[0]).toMatchObject({
      title: 'Triple Beat earnings · Thu, Oct 29', color: 0x5865F2,
      description: '🟢 A+ 1 · 🟡 A 0 · ⚪ B 0 · 2 earnings filers · premarket as of 9:00 AM ET\n⚠️ Buy 1¢ over the 9:30–9:32 high. Stop 1¢ under the low of day; skip if that\'s under 2% of price. Sell at 3R or the close.',
    });
    expect(embeds[1]).toEqual({
      color: 0x23A55A,
      description: '**NCLH**\n**A+ · 45/45** · Half size (0.5R)\n🏆 Strict triple beat\nBeat on EPS and revenue and raised full-year guidance.',
      fields: [
        { name: 'Min stop', value: '$0.46 · 2% of $23.00', inline: true },
        { name: 'Gap · hold', value: '+15.0% (high +17.0%) · 79% of range', inline: true },
        { name: 'Checklist', value: 'EPS ✅  Rev ✅  Guide ✅  Base ✅  Breakout ✅  $10+ ✅', inline: false },
      ],
    });
  });

  it('limits Triple Beat setup cards to nine and flags mixed catalysts', () => {
    const payload = createTripleBeatReportJson();
    payload.setups[0].earnings.mixedCatalyst = true;
    payload.setups = Array.from({ length: 11 }, () => payload.setups[0]);
    const embeds = buildTripleBeatScanEmbeds(createStoredReport({ reportJson: payload }) as never);
    expect(embeds).toHaveLength(10);
    expect(embeds[0].description).toContain('Showing the top 9 of 11.');
    expect(embeds[1].description).toContain('⚠️ Mixed catalyst. Check headlines.');
  });

  it('posts every triple-beat card in a single webhook message', async () => {
    vi.stubEnv('DISCORD_WEBHOOK_TRIPLE_BEAT', 'https://discord.test/triple-beat');
    const stored = createStoredReport({
      id: 'job-1:triple-beat-scan', agentId: 'orchestrator', reportType: 'triple-beat-scan',
      title: '2026-10-29 triple beat earnings scan', reportJson: createTripleBeatReportJson(),
    });
    const rows = new Map<unknown, unknown[][]>();
    rows.set(agentReports, [[], [stored]]);
    rows.set(agentStepEffects, [[]]);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));

    await writeAndDeliverReport(makeDb(rows) as never, {
      jobId: 'job-1', userId: 'system-agent-user', agentId: 'orchestrator', reportType: 'triple-beat-scan',
      title: stored.title, summary: null, reportJson: stored.reportJson,
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
    expect(body.embeds.map((embed: { title: string }) => embed.title))
      .toEqual(['Triple Beat earnings · Thu, Oct 29', undefined]);
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
        gapStatsTable: [{ date: '2026-04-11', gapPct: 12.34, open: 1.23, close: 1.1 }],
        financialCommentary: { rating: 'red', explanation: 'Management highlighted liquidity concerns.', source: 'llm' },
      }),
    }) as never);

    expect(embed.description).toContain('**Offering Risk** 🟢\n• Odds of an offering remain high.');
    expect(embed.description).toContain('**News/Catalyst** 🟡\n• Headline is driving the move.');
    expect(embed.description).toContain('**Financial Commentary** 🔴 _LLM Generated Comments_\n• Management highlighted liquidity concerns.');
    expect(embed.description).toContain('**Gap History**');
    expect(embed.description).toContain('2026-04-11 | +  12.34% |    1.23 |     1.1');
    expect(embed.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Ticker', value: 'NVDA' }),
      expect.objectContaining({ name: 'Confidence', value: 'high' }),
    ]));
  });

  it('renders the empty-gap fallback in the small-cap embed when gapStatsTable is empty', () => {
    const embed = buildResearchEmbed(createStoredReport({
      reportJson: createSmallCapReportJson({ gapStatsTable: [] }),
    }) as never);

    expect(embed.description).toContain('**Gap History**');
    expect(embed.description).toContain('No historical gap data available.');
    expect(embed.description).not.toContain('| Date ');
  });

  it('renders verbatim financial commentary without the LLM tag and separates sections with blank lines', () => {
    const verbatim = 'The company faces tight liquidity, holding only $83,837 in cash at year-end while carrying a $3M loan.';
    const embed = buildResearchEmbed(createStoredReport({
      reportJson: createSmallCapReportJson({
        financialCommentary: { rating: 'red', explanation: verbatim, source: 'verbatim' },
      }),
    }) as never);

    expect(embed.description).toContain(`**Financial Commentary** 🔴\n• ${verbatim}`);
    expect(embed.description).not.toContain('_LLM Generated Comments_');
    // Blank line between adjacent sections (Offering Risk → Dilution).
    expect(embed.description).toMatch(/Offering Risk\b[\s\S]*?\n\n\*\*Dilution\*\*/);
  });

  it('renders verbatim financial commentary in the swing embed without the LLM tag', () => {
    const verbatim = 'Cash position remains stable with 18 months of runway and no near-term financing required.';
    const embed = buildSwingSetupEmbed(createStoredReport({
      agentId: 'swing-trader',
      reportJson: createSwingReportJson({
        financialCommentary: { rating: 'green', explanation: verbatim, source: 'verbatim' },
      }),
    }) as never);

    expect(embed.description).toContain(`**Financial Commentary** 🟢\n• ${verbatim}`);
    expect(embed.description).not.toContain('_LLM Generated Comments_');
    expect(embed.description).toMatch(/MDR Match\b[\s\S]*?\n\n\*\*Momentum\*\*/);
  });

  it('renders the empty-gap fallback in the swing setup embed when gapStatsTable is empty', () => {
    const embed = buildSwingSetupEmbed(createStoredReport({
      agentId: 'swing-trader',
      reportJson: createSwingReportJson({ gapStatsTable: [] }),
    }) as never);

    expect(embed.description).toContain('**Gap History**');
    expect(embed.description).toContain('No historical gap data available.');
  });

  it('builds the swing setup embed from nested recommendation and MDR fields', () => {
    const embed = buildSwingSetupEmbed(createStoredReport({
      agentId: 'swing-trader',
      reportJson: createSwingReportJson({
        gapStatsTable: [{ date: '2026-04-11', gapPct: 8.5, open: 10, close: 10.8 }],
        financialCommentary: { rating: 'red', explanation: 'Management flagged financing needs.', source: 'llm' },
      }),
    }) as never);

    expect(embed.description).toContain('**MDR Match** 🟢\n• Clean MDR analog.');
    expect(embed.description).toContain('**Momentum** 🟡\n• Momentum is still positive but slowing.');
    expect(embed.description).toContain('**Financial Commentary** 🔴 _LLM Generated Comments_\n• Management flagged financing needs.');
    expect(embed.description).toContain('2026-04-11 | +   8.50% |      10 |    10.8');
    expect(embed.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Pattern', value: 'CONTINUATION' }),
      expect.objectContaining({ name: 'MDR Similarity', value: '87%' }),
      expect.objectContaining({ name: 'Action', value: 'ADD' }),
      expect.objectContaining({ name: 'Reasoning', value: 'Trend is intact above short-term support.', inline: false }),
    ]));
  });

  it('builds the macro summary as a bias-colored header, a key levels card, and a story card', () => {
    const cards = buildMacroSummaryEmbeds(createStoredReport({
      agentId: 'orchestrator',
      reportType: 'macro-summary',
      title: '2026-04-12 macro briefing',
      summary: 'Legacy summary should not be used for the embed body.',
      reportJson: createMacroReportJson(),
    }) as never);

    expect(cards).toHaveLength(3);
    const [header, levels, story] = cards;

    expect(header.title).toBe('Macro Daily · Sun, Apr 12');
    expect(header.color).toBe(0x23A55A);
    expect(header.description).toBe('🟢 **Bullish** · High\nRisk appetite improved as macro data eased near-term rate fears.');
    expect(header.fields).toEqual([
      { name: 'SPY', value: '520.12 · +0.80%', inline: true },
      { name: 'TLT', value: '95.34 · −0.40%', inline: true },
    ]);
    expect(header.footer).toBeUndefined();

    expect(levels.description).toBe('**Key levels** · 10Y 4.32% · curve +47bp');
    expect(levels.fields).toEqual([
      { name: 'SPY S / R', value: '`520.00` / `535.00`', inline: true },
      { name: 'QQQ S / R', value: '`450.00` / `462.00`', inline: true },
      {
        name: 'Why',
        value: 'SPY: Prior breakout range remains intact. · QQQ: Semis-led leadership is holding.',
        inline: false,
      },
      {
        name: 'Rates read',
        value: '10Y yields remain the key driver for tape direction, while the curve is still constructive.',
        inline: false,
      },
    ]);

    expect(story.description).toBe([
      '**Drivers**',
      '🟢 CPI print came in softer than expected',
      '🟡 Fed speakers stayed balanced',
      '🔴 Rates backed off into the close',
    ].join('\n'));
    expect(story.fields).toEqual([
      { name: 'This week', value: '• FOMC rate decision · Wed, Apr 15 — Could reset the risk-on backdrop.', inline: false },
      { name: '✅ Base case', value: 'SPY stays above support and large-cap growth keeps leadership.', inline: false },
      { name: '⚠️ What breaks it', value: 'A sharp move higher in yields breaks support and narrows breadth.', inline: false },
    ]);
    expect(story.footer).toEqual({ text: 'orchestrator • macro-summary' });

    // Sections the shorter briefing dropped never render, even when an older report still has them.
    const text = JSON.stringify(cards);
    expect(text).not.toContain('Stay long beta');
    expect(text).not.toContain('Semis bid');
    expect(text).not.toContain('Risk appetite is improving.');
  });

  it('adds Fear & Greed to the header line when sentiment data is present', () => {
    const [header] = buildMacroSummaryEmbeds(createStoredReport({
      agentId: 'orchestrator',
      reportType: 'macro-summary',
      title: '2026-04-12 macro briefing',
      reportJson: createMacroReportJson({
        marketBias: 'neutral',
        confidence: 'medium',
        sentimentData: { score: 32, classification: 'Fear', source: 'alternative.me/fng' },
      }),
    }) as never);

    expect(header.color).toBe(0x80848E);
    expect(header.description).toMatch(/^⚪ \*\*Neutral\*\* · Medium · F&G 32 Fear\n/);
  });

  it('collapses to the header card with the footer when the other sections are empty', () => {
    const cards = buildMacroSummaryEmbeds(createStoredReport({
      agentId: 'orchestrator',
      reportType: 'macro-summary',
      title: '2026-04-12 macro briefing',
      reportJson: createMacroReportJson({
        marketBias: 'bearish',
        drivers: [],
        keyLevels: [],
        fredData: [],
        ratesOutlook: '',
        scheduledCatalysts: [],
        scenarioAnalysis: { consensus: '', disruption: '' },
      }),
    }) as never);

    expect(cards).toHaveLength(1);
    expect(cards[0].color).toBe(0xF23F43);
    expect(cards[0].footer).toEqual({ text: 'orchestrator • macro-summary' });
  });

  it('labels a catalyst with no date as date TBD', () => {
    const cards = buildMacroSummaryEmbeds(createStoredReport({
      agentId: 'orchestrator',
      reportType: 'macro-summary',
      title: '2026-04-12 macro briefing',
      reportJson: createMacroReportJson({
        scheduledCatalysts: [{ event: 'October CPI', date: null, expectedImpact: 'Hot print tests QQQ 662.' }],
      }),
    }) as never);

    expect(cards[2].fields?.[0]).toEqual({
      name: 'This week',
      value: '• October CPI · date TBD — Hot print tests QQQ 662.',
      inline: false,
    });
  });

  it('posts every macro card in a single webhook message', async () => {
    vi.stubEnv('DISCORD_WEBHOOK_MACRO_DAILY', 'https://discord.test/macro');
    const stored = createStoredReport({
      id: 'job-1:macro-summary', agentId: 'orchestrator', reportType: 'macro-summary',
      title: '2026-04-12 macro briefing', reportJson: createMacroReportJson(),
    });
    const rows = new Map<unknown, unknown[][]>();
    rows.set(agentReports, [[], [stored]]);
    rows.set(agentStepEffects, [[]]);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));

    await writeAndDeliverReport(makeDb(rows) as never, {
      jobId: 'job-1', userId: 'system-agent-user', agentId: 'orchestrator', reportType: 'macro-summary',
      title: stored.title, summary: null, reportJson: stored.reportJson,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
    expect(body.embeds.map((embed: { title?: string }) => embed.title))
      .toEqual(['Macro Daily · Sun, Apr 12', undefined, undefined]);
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
  it('sends an embed that fits Discord limits as one unchanged message', () => {
    const embed = { title: 'Macro', color: 1, fields: [{ name: 'TLDR', value: 'short' }] };
    expect(packEmbedsForDiscord([embed])).toEqual([[embed]]);
  });

  it('trims fields over 1024 chars and splits an embed over 6000 chars across messages', () => {
    const fields = Array.from({ length: 8 }, (_, index) => ({ name: `Section ${index}`, value: 'x'.repeat(1400) }));
    const messages = packEmbedsForDiscord([{ title: 'Daily Macro', color: 1, footer: { text: 'orchestrator' }, fields }]);

    expect(messages.length).toBeGreaterThan(1);
    const embeds = messages.flat();
    expect(embeds[0]?.title).toBe('Daily Macro');
    expect(embeds[1]?.title).toBe('Daily Macro (cont.)');
    // Every field survives, trimmed to Discord's 1024-char cap, in the original order.
    const sentFields = embeds.flatMap((embed) => embed.fields ?? []);
    expect(sentFields.map((field) => field.name)).toEqual(fields.map((field) => field.name));
    expect(sentFields.every((field) => field.value.length === 1024 && field.value.endsWith('…'))).toBe(true);
    for (const message of messages) {
      const chars = message.reduce((sum, embed) => sum + (embed.title?.length ?? 0) + (embed.footer?.text.length ?? 0)
        + (embed.fields ?? []).reduce((total, field) => total + field.name.length + field.value.length, 0), 0);
      expect(chars).toBeLessThanOrEqual(6000);
    }
  });

  it('trims an over-long system alert description to fit Discord', async () => {
    vi.stubEnv('DISCORD_WEBHOOK_SYSTEM', 'https://discord.test/system');
    const longDetail = 'y'.repeat(5000);
    const stored = createStoredReport({
      id: 'job-1:system-alert', agentId: 'orchestrator', reportType: 'system-alert',
      title: 'Scheduled job failed', summary: longDetail, reportJson: { severity: 'error' },
    });
    const rows = new Map<unknown, unknown[][]>();
    rows.set(agentReports, [[], [stored]]);
    rows.set(agentStepEffects, [[]]);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));

    const result = await writeAndDeliverReport(makeDb(rows) as never, {
      jobId: 'job-1', userId: 'system-agent-user', agentId: 'orchestrator', reportType: 'system-alert',
      title: stored.title, summary: longDetail, reportJson: stored.reportJson,
    });

    expect(result.status).toBe('published');
    const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
    expect(body.embeds[0].description.length).toBe(4096);
  });
});

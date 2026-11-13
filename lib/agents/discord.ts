import { eq } from 'drizzle-orm';
import { agentReports, agentStepEffects } from '@/lib/db/schema';
import type { ParabolicGrade, ParabolicScanReport } from '@/lib/parabolic/scan';
import { MAX_STOP_ATR, MIN_STOP_PCT, type TripleBeatGrade, type TripleBeatScanReport } from '@/lib/triple-beat/scan';
import { recordStepEffect } from './checkpoints';
import type { AgentDb } from './db';
import type {
  AgentId,
  AgentReport,
  FredDataPoint,
  MacroSummaryReport,
  SmallCapResearchReport,
  SwingResearchReport,
} from './types';

const DISCORD_EMBED_COLOR = 0x10B981;
const DISCORD_TIMEOUT_MS = 10_000;
const UNKNOWN_VALUE = 'n/a';
const DELIVERY_CHANNEL = 'discord';
const loggedUnknownWebhookCombos = new Set<string>();

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color: number;
  fields?: DiscordEmbedField[];
  footer?: { text: string };
  timestamp?: string;
}

export interface DiscordWebhookPayload {
  username?: string;
  embeds: DiscordEmbed[];
}

type Severity = 'info' | 'warn' | 'error';

interface DeliveryResult {
  status: 'published' | 'delivery_failed';
  deliveryError: string | null;
}

type AgentReportRow = typeof agentReports.$inferSelect;

function toReport(row: AgentReportRow): AgentReport {
  return row as AgentReport;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function coerceFieldValue(value: unknown): string {
  if (value === null || value === undefined) {
    return UNKNOWN_VALUE;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || UNKNOWN_VALUE;
  }

  if (
    typeof value === 'number'
    || typeof value === 'boolean'
    || typeof value === 'bigint'
  ) {
    return String(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  try {
    const json = JSON.stringify(value);
    return json && json !== '{}' ? json : UNKNOWN_VALUE;
  } catch {
    return String(value);
  }
}

function optionalText(...values: unknown[]): string | undefined {
  for (const value of values) {
    const rendered = coerceFieldValue(value);
    if (rendered !== UNKNOWN_VALUE) {
      return rendered;
    }
  }

  return undefined;
}

function readJsonValue(payload: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      return payload[key];
    }
  }

  return undefined;
}

function buildField(name: string, value: unknown, inline = true): DiscordEmbedField {
  return {
    name,
    value: coerceFieldValue(value),
    inline,
  };
}

function buildBaseEmbed(
  report: AgentReport,
  fields: DiscordEmbedField[],
  description?: string,
): DiscordEmbed {
  return {
    title: coerceFieldValue(report.title),
    description,
    color: DISCORD_EMBED_COLOR,
    fields: fields.length > 0 ? fields : undefined,
    footer: {
      text: `${report.agentId} • ${report.reportType}`,
    },
    timestamp: report.createdAt
      ? (report.createdAt instanceof Date
        ? report.createdAt.toISOString()
        : new Date(report.createdAt).toISOString())
      : undefined,
  };
}

function normalizeSeverity(value: unknown): Severity {
  if (value === 'warn' || value === 'error') {
    return value;
  }

  return 'info';
}

function truncate(value: string, maxLength = 240): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

function readFailureDetailFromPayload(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  const parsed = payload as {
    error?: string | { message?: string };
    message?: string;
  };

  if (typeof parsed.error === 'string' && parsed.error.trim()) {
    return truncate(parsed.error.trim());
  }

  if (
    parsed.error
    && typeof parsed.error === 'object'
    && typeof parsed.error.message === 'string'
    && parsed.error.message.trim()
  ) {
    return truncate(parsed.error.message.trim());
  }

  if (typeof parsed.message === 'string' && parsed.message.trim()) {
    return truncate(parsed.message.trim());
  }

  return '';
}

async function readFailureDetail(response: Response): Promise<string> {
  const bodyText = (await response.text()).trim();
  if (!bodyText) {
    return '';
  }

  try {
    return readFailureDetailFromPayload(JSON.parse(bodyText));
  } catch {
    return truncate(bodyText);
  }
}

function readThrownError(error: unknown): string {
  if ((error as { name?: string }).name === 'AbortError') {
    return `request timed out after ${DISCORD_TIMEOUT_MS}ms`;
  }

  if (error instanceof Error) {
    return truncate(error.message);
  }

  return truncate(String(error));
}

function selectEmbed(report: AgentReport): DiscordEmbed {
  if (report.reportType === 'macro-intraday') {
    return buildMacroIntradayEmbed(report);
  }

  if (report.reportType === 'pre-market-scan') {
    return buildScanEmbed(report);
  }

  if (report.reportType === 'pattern-check') {
    return buildSwingAlertEmbed(report);
  }

  if (
    report.agentId === 'swing-trader'
    && (report.reportType === 'research' || report.reportType === 'momentum-scan')
  ) {
    return buildSwingSetupEmbed(report);
  }

  if (report.reportType === 'system-alert' || report.reportType.startsWith('system-')) {
    const payload = asRecord(report.reportJson);
    return buildSystemEmbed(
      report.title,
      optionalText(report.summary, readJsonValue(payload, 'detail', 'message')) ?? UNKNOWN_VALUE,
      normalizeSeverity(readJsonValue(payload, 'severity', 'level')),
    );
  }

  return buildResearchEmbed(report);
}

async function getReportById(
  db: AgentDb,
  reportId: string,
): Promise<AgentReport | null> {
  const [row] = await db.select()
    .from(agentReports)
    .where(eq(agentReports.id, reportId))
    .limit(1);

  return row ? toReport(row) : null;
}

async function hasSuccessfulDeliveryMarker(
  db: AgentDb,
  reportId: string,
): Promise<boolean> {
  const [row] = await db.select({ id: agentStepEffects.id })
    .from(agentStepEffects)
    .where(eq(agentStepEffects.idempotencyKey, `discord-delivery:${reportId}`))
    .limit(1);

  return Boolean(row);
}

async function updateDeliveryState(
  db: AgentDb,
  reportId: string,
  update: Partial<AgentReportRow>,
): Promise<void> {
  await db.update(agentReports)
    .set(update)
    .where(eq(agentReports.id, reportId));
}

async function ensureStoredReport(
  db: AgentDb,
  params: {
    reportId: string;
    jobId: string;
    userId: string;
    agentId: AgentId;
    reportType: string;
    title: string;
    summary: string | null;
    reportJson: unknown;
  },
): Promise<AgentReport> {
  const existing = await getReportById(db, params.reportId);
  if (existing) {
    return existing;
  }

  await db.insert(agentReports)
    .values({
      id: params.reportId,
      jobId: params.jobId,
      userId: params.userId,
      agentId: params.agentId,
      reportType: params.reportType,
      title: params.title,
      summary: params.summary,
      reportJson: params.reportJson,
      status: 'published',
      deliveryChannel: DELIVERY_CHANNEL,
      deliveredAt: null,
      deliveryError: null,
    })
    .onConflictDoNothing({
      target: agentReports.id,
    });

  const stored = await getReportById(db, params.reportId);
  if (!stored) {
    throw new Error(`failed to load stored report ${params.reportId}`);
  }

  return stored;
}

// Discord rejects the whole message with a 400 if any limit is broken. Nov 2026: a longer macro briefing had
// 1,387-char fields and 8,767 chars total, so it never posted.
const DISCORD_DESCRIPTION_LIMIT = 4096;
const DISCORD_FIELD_VALUE_LIMIT = 1024;
const DISCORD_MESSAGE_CHAR_LIMIT = 6000;
const DISCORD_MESSAGE_EMBED_LIMIT = 10;

function trimToLimit(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

// Discord counts title + description + footer + every field name and value toward the 6,000 per message.
function countEmbedChars(embed: DiscordEmbed): number {
  return (embed.title?.length ?? 0)
    + (embed.description?.length ?? 0)
    + (embed.footer?.text.length ?? 0)
    + (embed.fields ?? []).reduce((sum, field) => sum + field.name.length + field.value.length, 0);
}

// One embed that's too big on its own gets its later fields moved into "(cont.)" embeds.
function splitOversizedEmbed(embed: DiscordEmbed): DiscordEmbed[] {
  if (countEmbedChars(embed) <= DISCORD_MESSAGE_CHAR_LIMIT) {
    return [embed];
  }

  const { fields = [], ...head } = embed;
  const parts: DiscordEmbed[] = [];
  let current: DiscordEmbed = { ...head, fields: [] };
  for (const field of fields) {
    const fieldChars = field.name.length + field.value.length;
    if (current.fields!.length > 0 && countEmbedChars(current) + fieldChars > DISCORD_MESSAGE_CHAR_LIMIT) {
      parts.push(current);
      current = { title: `${embed.title ?? 'Report'} (cont.)`, color: embed.color, fields: [] };
    }
    current.fields!.push(field);
  }
  parts.push(current);
  return parts;
}

// Trim anything over a per-item limit, then group embeds into as few messages as fit Discord's limits.
// Reports that already fit come back as a single message, unchanged.
export function packEmbedsForDiscord(embeds: DiscordEmbed[]): DiscordEmbed[][] {
  const fitted = embeds
    .map((embed) => ({
      ...embed,
      ...(embed.description ? { description: trimToLimit(embed.description, DISCORD_DESCRIPTION_LIMIT) } : {}),
      ...(embed.fields
        ? { fields: embed.fields.map((field) => ({ ...field, value: trimToLimit(field.value, DISCORD_FIELD_VALUE_LIMIT) })) }
        : {}),
    }))
    .flatMap(splitOversizedEmbed);

  const messages: DiscordEmbed[][] = [];
  let current: DiscordEmbed[] = [];
  let currentChars = 0;
  for (const embed of fitted) {
    const embedChars = countEmbedChars(embed);
    const full = currentChars + embedChars > DISCORD_MESSAGE_CHAR_LIMIT || current.length >= DISCORD_MESSAGE_EMBED_LIMIT;
    if (current.length > 0 && full) {
      messages.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(embed);
    currentChars += embedChars;
  }
  if (current.length > 0) {
    messages.push(current);
  }
  return messages;
}

// Posts each message in order and stops at the first failure.
async function postWebhook(embeds: DiscordEmbed[], url: string): Promise<DeliveryResult> {
  for (const messageEmbeds of packEmbedsForDiscord(embeds)) {
    const result = await postWebhookMessage(messageEmbeds, url);
    if (result.status !== 'published') {
      return result;
    }
  }

  return { status: 'published', deliveryError: null };
}

async function postWebhookMessage(embeds: DiscordEmbed[], url: string): Promise<DeliveryResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DISCORD_TIMEOUT_MS);
  const payload: DiscordWebhookPayload = { embeds };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (response.ok) {
      return {
        status: 'published',
        deliveryError: null,
      };
    }

    const detail = await readFailureDetail(response);
    return {
      status: 'delivery_failed',
      deliveryError: detail
        ? `${response.status}: ${detail}`
        : String(response.status),
    };
  } catch (error) {
    return {
      status: 'delivery_failed',
      deliveryError: readThrownError(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function deliverStoredReport(
  db: AgentDb,
  report: AgentReport,
  options: {
    allowMarkerShortCircuit: boolean;
    manualAttempt: boolean;
  },
): Promise<DeliveryResult> {
  const reportId = report.id;

  if (options.allowMarkerShortCircuit && await hasSuccessfulDeliveryMarker(db, reportId)) {
    return {
      status: 'published',
      deliveryError: null,
    };
  }

  const url = resolveWebhookUrl(report.agentId, report.reportType);
  if (!url) {
    const deliveryError = `no webhook configured for ${report.agentId}/${report.reportType}`;
    await updateDeliveryState(db, reportId, {
      status: 'delivery_failed',
      deliveryError,
    });
    return {
      status: 'delivery_failed',
      deliveryError,
    };
  }

  const embeds = report.reportType === 'parabolic-scan' ? buildParabolicScanEmbeds(report)
    : report.reportType === 'triple-beat-scan' ? buildTripleBeatScanEmbeds(report)
      : report.reportType === 'macro-summary' ? buildMacroSummaryEmbeds(report)
        : [selectEmbed(report)];
  const deliveryResult = await postWebhook(embeds, url);

  if (deliveryResult.status === 'published') {
    await updateDeliveryState(db, reportId, {
      status: 'published',
      deliveredAt: new Date(),
      deliveryError: null,
    });

    if (report.jobId) {
      await recordStepEffect(db, {
        jobId: report.jobId,
        stepName: options.manualAttempt ? 'discord-delivery-manual' : 'discord-delivery',
        effectType: 'discord-delivery',
        idempotencyKey: options.manualAttempt
          ? `discord-delivery:${reportId}:manual:${new Date().toISOString()}`
          : `discord-delivery:${reportId}`,
      });
    }

    return deliveryResult;
  }

  await updateDeliveryState(db, reportId, {
    status: 'delivery_failed',
    deliveryError: deliveryResult.deliveryError,
  });

  return deliveryResult;
}

export function buildScanEmbed(report: AgentReport): DiscordEmbed {
  const payload = asRecord(report.reportJson);
  const fields = [
    buildField('Ticker', readJsonValue(payload, 'ticker', 'symbol')),
    buildField('Price', readJsonValue(payload, 'price', 'currentPrice')),
    buildField('Move', readJsonValue(payload, 'movePercent', 'percentChange', 'gapPercent')),
    buildField('Volume', readJsonValue(payload, 'volume', 'relativeVolume')),
    buildField('Float', readJsonValue(payload, 'float', 'floatShares')),
    buildField('Catalyst', readJsonValue(payload, 'catalyst', 'headline'), false),
  ];

  return buildBaseEmbed(
    report,
    fields,
    optionalText(report.summary, readJsonValue(payload, 'summary', 'thesis', 'setup')),
  );
}

export function buildResearchEmbed(report: AgentReport): DiscordEmbed {
  const payload = report.reportJson as SmallCapResearchReport;
  const ticker = payload.ticker;

  const ratingEmoji = (rating: SmallCapResearchReport['newsWhyRunning']['rating']): string => {
    if (rating === 'green') return '\u{1F7E2}';
    if (rating === 'yellow') return '\u{1F7E1}';
    if (rating === 'red') return '\u{1F534}';
    return '\u{26AA}';
  };

  const ratingLine = (
    label: string,
    section: SmallCapResearchReport['newsWhyRunning'],
  ): string => `**${label}** ${ratingEmoji(section.rating)}\n• ${truncate(section.explanation, 300)}`;

  // Verbatim AskEdgar commentary can run 400-1000+ chars; LLM fallback stays short.
  // Tag the line only when LLM-generated so verbatim text reads cleanly.
  const financialCommentaryLine = ((): string => {
    const fc = payload.financialCommentary;
    const isVerbatim = fc.source === 'verbatim';
    const labelSuffix = isVerbatim ? '' : ' _LLM Generated Comments_';
    const limit = isVerbatim ? 1000 : 300;
    return `**Financial Commentary** ${ratingEmoji(fc.rating)}${labelSuffix}\n• ${truncate(fc.explanation, limit)}`;
  })();

  const gapBlock = payload.gapStatsTable.length === 0
    ? 'No historical gap data available.'
    : [
      '```',
      'Date        | Gap %    | Open    | Close',
      '------------|----------|---------|--------',
      ...payload.gapStatsTable.map(
        (row) =>
          `${row.date} | ${(row.gapPct > 0 ? '+' : '') + row.gapPct.toFixed(2).padStart(7)}% | ${String(row.open).padStart(7)} | ${String(row.close).padStart(7)}`,
      ),
      '```',
    ].join('\n');

  const sections = [
    ratingLine('Offering Risk', payload.overallOfferingRisk),
    ratingLine('Dilution', payload.dilution),
    ratingLine('Offering Ability', payload.offeringAbility),
    ratingLine('Cash Need', payload.cashNeed),
    ratingLine('News/Catalyst', payload.newsWhyRunning),
    `**Chart History** ${ratingEmoji(payload.chartHistory.rating)}\n• ${truncate(payload.chartHistory.explanation, 500)}`,
    financialCommentaryLine,
    `**Gap History**\n${gapBlock}`,
  ];

  const fields: DiscordEmbedField[] = [
    buildField('Ticker', ticker),
    buildField('Confidence', payload.confidence),
  ];

  return buildBaseEmbed(report, fields, sections.join('\n\n'));
}

export function buildSwingSetupEmbed(report: AgentReport): DiscordEmbed {
  const payload = report.reportJson as SwingResearchReport;
  const ticker = payload.ticker;

  const ratingEmoji = (rating: SwingResearchReport['momentum']['rating']): string => {
    if (rating === 'green') return '\u{1F7E2}';
    if (rating === 'yellow') return '\u{1F7E1}';
    if (rating === 'red') return '\u{1F534}';
    return '\u{26AA}';
  };

  const ratingLine = (
    label: string,
    section: SwingResearchReport['momentum'],
  ): string => `**${label}** ${ratingEmoji(section.rating)}\n• ${truncate(section.explanation, 300)}`;

  // Verbatim AskEdgar commentary can run 400-1000+ chars; LLM fallback stays short.
  // Tag the line only when LLM-generated so verbatim text reads cleanly.
  const financialCommentaryLine = ((): string => {
    const fc = payload.financialCommentary;
    const isVerbatim = fc.source === 'verbatim';
    const labelSuffix = isVerbatim ? '' : ' _LLM Generated Comments_';
    const limit = isVerbatim ? 1000 : 300;
    return `**Financial Commentary** ${ratingEmoji(fc.rating)}${labelSuffix}\n• ${truncate(fc.explanation, limit)}`;
  })();

  const gapBlock = payload.gapStatsTable.length === 0
    ? 'No historical gap data available.'
    : [
      '```',
      'Date        | Gap %    | Open    | Close',
      '------------|----------|---------|--------',
      ...payload.gapStatsTable.map(
        (row) =>
          `${row.date} | ${(row.gapPct > 0 ? '+' : '') + row.gapPct.toFixed(2).padStart(7)}% | ${String(row.open).padStart(7)} | ${String(row.close).padStart(7)}`,
      ),
      '```',
    ].join('\n');

  const sections = [
    ratingLine('MDR Match', payload.mdrPatternMatch),
    ratingLine('Momentum', payload.momentum),
    ratingLine('Catalyst', payload.catalyst),
    ratingLine('Volume', payload.volumeProfile),
    financialCommentaryLine,
    `**Gap History**\n${gapBlock}`,
  ];

  const fields: DiscordEmbedField[] = [
    buildField('Ticker', ticker),
    buildField('Pattern', payload.patternClassification),
    buildField('MDR Similarity', `${payload.mdrPatternMatch.mdrSimilarity}%`),
    buildField('Action', payload.recommendation.action),
    buildField('Confidence', payload.confidence),
  ];

  if (payload.recommendation.reasoning.trim()) {
    fields.push(buildField('Reasoning', truncate(payload.recommendation.reasoning, 200), false));
  }

  return buildBaseEmbed(report, fields, sections.join('\n\n'));
}

export function buildSwingAlertEmbed(report: AgentReport): DiscordEmbed {
  const payload = asRecord(report.reportJson);
  const fields = [
    buildField('Ticker', readJsonValue(payload, 'ticker', 'symbol')),
    buildField('Alert', readJsonValue(payload, 'alertType', 'status')),
    buildField('Action', readJsonValue(payload, 'action', 'signal')),
    buildField('Current Price', readJsonValue(payload, 'currentPrice', 'price')),
    buildField('Entry', readJsonValue(payload, 'entry', 'entryPrice')),
    buildField('Stop', readJsonValue(payload, 'stop', 'stopPrice')),
  ];

  return buildBaseEmbed(
    report,
    fields,
    optionalText(report.summary, readJsonValue(payload, 'summary', 'detail', 'rationale')),
  );
}

function formatBulletList(values: unknown, emptyValue = UNKNOWN_VALUE): string {
  if (!Array.isArray(values)) {
    return emptyValue;
  }

  const rendered = values
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length > 0)
    .map((value) => `• ${truncate(value, 240)}`);

  return rendered.length > 0 ? rendered.join('\n') : emptyValue;
}

function formatFredValue(point: FredDataPoint): string {
  if (point.value === null) {
    return 'n/a';
  }

  if (point.seriesId === 'T10Y2Y') {
    const basisPoints = Math.round(point.value * 100);
    return `${basisPoints >= 0 ? '+' : ''}${basisPoints}bp`;
  }

  return `${point.value.toFixed(2)}%`;
}

const MACRO_BIAS_COLORS: Record<MacroSummaryReport['marketBias'], number> = {
  bullish: 0x23A55A,
  bearish: 0xF23F43,
  neutral: 0x80848E,
};
const MACRO_BIAS_EMOJI: Record<MacroSummaryReport['marketBias'], string> = {
  bullish: '🟢',
  bearish: '🔴',
  neutral: '⚪',
};
// The 9 ETFs on the header card's price tape (3 rows of 3), out of the 17 the briefing snapshots.
const MACRO_TAPE_TICKERS = ['SPY', 'QQQ', 'IWM', 'DIA', 'SMH', 'XLF', 'TLT', 'GLD', 'UVXY'];
const MACRO_STORY_COLOR = 0x5865F2;

// Three cards, styled like the scan posts: a header colored by bias (summary + price tape), a key levels card,
// and a card with drivers, catalysts and scenarios. Nov 2026: replaced the single 13-section embed.
export function buildMacroSummaryEmbeds(report: AgentReport): DiscordEmbed[] {
  const payload = asRecord(report.reportJson) as Partial<MacroSummaryReport>;
  const bias = payload.marketBias && payload.marketBias in MACRO_BIAS_COLORS ? payload.marketBias : 'neutral';
  const pct = (value: number) => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(2)}%`;
  const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
  // 'YYYY-MM-DD' -> 'Tue, Nov 10'. Noon UTC keeps the date from shifting a day in any timezone.
  const shortDate = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const hasDate = typeof payload.tradingDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(payload.tradingDate);
  const title = hasDate ? `Macro Daily · ${shortDate(payload.tradingDate!)}` : coerceFieldValue(report.title);

  // Header line: bias, confidence, and Fear & Greed when the score is usable.
  const headerParts = [`${MACRO_BIAS_EMOJI[bias]} **${capitalize(bias)}**`];
  if (typeof payload.confidence === 'string') {
    headerParts.push(capitalize(payload.confidence));
  }
  const sentiment = payload.sentimentData;
  if (sentiment && typeof sentiment.score === 'number' && typeof sentiment.classification === 'string'
    && sentiment.score >= 0 && sentiment.score <= 100) {
    headerParts.push(`F&G ${sentiment.score} ${sentiment.classification}`);
  }
  const summary = optionalText(payload.summary, report.summary);

  const snapshot = Array.isArray(payload.crossAssetSnapshot) ? payload.crossAssetSnapshot : [];
  const tapeFields = MACRO_TAPE_TICKERS.flatMap((ticker) => {
    const entry = snapshot.find((item) => item?.ticker === ticker);
    if (!entry || typeof entry.price !== 'number' || typeof entry.changePercent !== 'number') {
      return [];
    }
    return [buildField(ticker, `${entry.price.toFixed(2)} · ${pct(entry.changePercent)}`)];
  });

  const header: DiscordEmbed = {
    title,
    description: [headerParts.join(' · '), summary].filter(Boolean).join('\n'),
    color: MACRO_BIAS_COLORS[bias],
    ...(tapeFields.length > 0 ? { fields: tapeFields } : {}),
  };

  // Key levels card: support / resistance side by side, the LLM's short notes in one line underneath,
  // and the 10Y, 2Y and curve from FRED in the label line.
  const fred = Array.isArray(payload.fredData) ? payload.fredData : [];
  const rateLabels: Record<string, string> = { DGS10: '10Y', DGS2: '2Y', T10Y2Y: 'curve' };
  const rates = Object.keys(rateLabels).flatMap((seriesId) => {
    const point = fred.find((item) => item?.seriesId === seriesId);
    return point && point.value !== null ? [`${rateLabels[seriesId]} ${formatFredValue(point)}`] : [];
  });
  const levels = Array.isArray(payload.keyLevels) ? payload.keyLevels.filter((level) => level?.ticker) : [];
  const notes = levels
    .filter((level) => typeof level.note === 'string' && level.note.trim())
    .map((level) => `${level.ticker}: ${level.note.trim()}`);
  const ratesRead = optionalText(payload.ratesOutlook);
  const levelsCard: DiscordEmbed | null = levels.length > 0 || rates.length > 0 || ratesRead
    ? {
      description: ['**Key levels**', ...rates].join(' · '),
      color: MACRO_STORY_COLOR,
      fields: [
        ...levels.map((level) => buildField(`${level.ticker} S / R`, `\`${level.support}\` / \`${level.resistance}\``)),
        ...(notes.length > 0 ? [buildField('Why', notes.join(' · '), false)] : []),
        ...(ratesRead ? [buildField('Rates read', ratesRead, false)] : []),
      ],
    }
    : null;

  // Story card: drivers in the description, then catalysts and the two scenarios as full-width fields.
  const impactEmoji = (impact: unknown) => (impact === 'positive' ? '🟢' : impact === 'negative' ? '🔴' : '🟡');
  const drivers = (Array.isArray(payload.drivers) ? payload.drivers : [])
    .filter((driver) => driver && typeof driver.driver === 'string' && driver.driver.trim())
    .slice(0, 3)
    .map((driver) => `${impactEmoji(driver.impact)} ${driver.driver.trim()}`);
  const catalysts = (Array.isArray(payload.scheduledCatalysts) ? payload.scheduledCatalysts : [])
    .filter((catalyst) => catalyst && typeof catalyst.event === 'string' && catalyst.event.trim())
    .slice(0, 3)
    .map((catalyst) => {
      const when = catalyst.date && /^\d{4}-\d{2}-\d{2}$/.test(catalyst.date) ? shortDate(catalyst.date) : 'date TBD';
      const impact = typeof catalyst.expectedImpact === 'string' && catalyst.expectedImpact.trim()
        ? ` — ${catalyst.expectedImpact.trim()}`
        : '';
      return `• ${catalyst.event.trim()} · ${when}${impact}`;
    });
  const consensus = optionalText(payload.scenarioAnalysis?.consensus);
  const disruption = optionalText(payload.scenarioAnalysis?.disruption);
  const storyFields = [
    ...(catalysts.length > 0 ? [buildField('This week', catalysts.join('\n'), false)] : []),
    ...(consensus ? [buildField('✅ Base case', consensus, false)] : []),
    ...(disruption ? [buildField('⚠️ What breaks it', disruption, false)] : []),
  ];
  const storyCard: DiscordEmbed | null = drivers.length > 0 || storyFields.length > 0
    ? {
      ...(drivers.length > 0 ? { description: ['**Drivers**', ...drivers].join('\n') } : {}),
      color: MACRO_STORY_COLOR,
      ...(storyFields.length > 0 ? { fields: storyFields } : {}),
    }
    : null;

  const cards = [header, levelsCard, storyCard].filter((card): card is DiscordEmbed => card !== null);
  // Footer and timestamp go on the last card only, like the bottom of a single post.
  const base = buildBaseEmbed(report, []);
  cards[cards.length - 1] = { ...cards[cards.length - 1], footer: base.footer, timestamp: base.timestamp };
  return cards;
}

export function buildMacroIntradayEmbed(report: AgentReport): DiscordEmbed {
  const payload = asRecord(report.reportJson);
  const fields: DiscordEmbedField[] = [
    buildField('Session Bias', readJsonValue(payload, 'sessionBias')),
  ];

  const surprises = readJsonValue(payload, 'surprises');
  if (Array.isArray(surprises) && surprises.length > 0) {
    fields.push(buildField('Surprises', formatBulletList(surprises), false));
  }

  const updatedKeyWatch = optionalText(readJsonValue(payload, 'updatedKeyWatch'));
  if (updatedKeyWatch) {
    fields.push(buildField('Key Watch', updatedKeyWatch, false));
  }

  const deskNote = optionalText(readJsonValue(payload, 'deskNote'));
  if (deskNote) {
    fields.push(buildField('Desk Note', deskNote, false));
  }

  return buildBaseEmbed(
    report,
    fields,
    optionalText(report.summary, readJsonValue(payload, 'sessionSummary')),
  );
}

const PARABOLIC_HEADER_COLOR = 0x5865F2;
const PARABOLIC_GRADE_COLORS: Record<ParabolicGrade, number> = {
  A: 0x23A55A,
  B: 0xF0B232,
  C: 0x80848E,
  Pass: 0x80848E,
};
const PARABOLIC_SIZE_LABELS: Record<number, string> = {
  1: 'Full size (1R)',
  0.5: 'Half size (0.5R)',
  0: 'Watch only',
};
// Short checklist names for the card, keyed by the score item labels in lib/parabolic/scan.ts.
const PARABOLIC_SHORT_LABELS: Record<string, string> = {
  '3+ consecutive green days': 'Green',
  'Trade-day gap-up': 'Gap',
  '2+ consecutive gap-ups': 'Gap-ups',
  'Accelerating daily ranges': 'Ranges',
  'Increasing daily volume': 'Volume',
  'Significant MA extension': 'MA ext',
  'Opening volume climax': 'Climax',
  'Clean parabolic structure': 'Parabolic',
};
// Discord allows 10 embeds per message: one header card + 9 setup cards.
const PARABOLIC_MAX_CARDS = 9;

// One header card, then one card per setup colored by grade.
export function buildParabolicScanEmbeds(report: AgentReport): DiscordEmbed[] {
  const payload = report.reportJson as ParabolicScanReport;
  const pct = (value: number, digits = 1) => `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`;
  const usd = (value: number) => `$${value.toFixed(2)}`;
  const target = (price: number, rr: number | null) => (rr === null ? usd(price) : `${usd(price)} · ${rr.toFixed(1)}R`);
  const dayLabel = new Date(`${payload.tradingDate}T12:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const asOfEt = new Date(payload.asOf).toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
  });
  const scanned = `${payload.candidatesChecked} scanned · premarket as of ${asOfEt} ET`;
  const title = `Parabolic shorts · ${dayLabel}`;

  if (payload.setups.length === 0) {
    return [{ title, description: `No setups today · ${scanned}`, color: PARABOLIC_GRADE_COLORS.C }];
  }

  const count = (grade: ParabolicGrade) => payload.setups.filter((setup) => setup.grade === grade).length;
  const shown = payload.setups.slice(0, PARABOLIC_MAX_CARDS);
  const overflow = payload.setups.length > shown.length ? `\nShowing the top ${shown.length} of ${payload.setups.length}.` : '';
  const header: DiscordEmbed = {
    title,
    // Footer text renders small in Discord, so the instructions live in the description.
    // 2024-11 to 2026-10 replay: grades didn't rank results, and covering everything at the gap fill underperformed holding to the close.
    // Waiting for a VWAP or opening-range break gave up most of the move (2024-11 to 2025-12: +87R vs +253R at the open); it only helped in the weak 2026 stretch.
    description: `🟢 A ${count('A')} · 🟡 B ${count('B')} · ⚪ C ${count('C')} · ${scanned}${overflow}\n⚠️ Confirm borrow. Short the open with the card's stop. Same size for every grade. Gap fill isn't the exit: hold to the close unless stopped.`,
    color: PARABOLIC_HEADER_COLOR,
  };

  const cards = shown.map((setup): DiscordEmbed => {
    const { metrics, plan } = setup;
    const checklist = setup.scoreItems.map((item) => {
      const icon = item.status === 'met' ? '✅' : item.status === 'unknown' ? '❔' : '❌';
      const name = PARABOLIC_SHORT_LABELS[item.label] ?? item.label;
      return `${name === 'Green' ? `Green ${metrics.greenStreak}` : name} ${icon}`;
    });
    return {
      // No embed title: Discord renders titles larger than description text, and the name and grade lines should match.
      description: [
        `**${setup.name ? `${setup.ticker} · ${setup.name}` : setup.ticker}**`,
        `**${setup.grade} · ${setup.score}/${setup.maxScore}**${setup.fundType ? ` · ${setup.fundType}` : ''}`,
      ].join('\n'),
      color: PARABOLIC_GRADE_COLORS[setup.grade],
      fields: [
        buildField('Entry', usd(plan.entry)),
        buildField('Stop', usd(plan.stop)),
        buildField('Risk / share', usd(plan.riskPerShare)),
        buildField('Gap fill', target(plan.target1, plan.target1RR)),
        buildField('9EMA', target(plan.target2, plan.target2RR)),
        buildField('Gap · 10SMA', `${pct(metrics.tradeDayGapPct)} · ${pct(metrics.ext10Pct, 0)}`),
        buildField('Checklist', checklist.join('  '), false),
      ],
    };
  });

  return [header, ...cards];
}

const TRIPLE_BEAT_GRADE_COLORS: Record<TripleBeatGrade, number> = {
  'A+': 0x23A55A,
  A: 0xF0B232,
  B: 0x80848E,
  Pass: 0x80848E,
};
// Short checklist names for the card, keyed by the score item labels in lib/triple-beat/scan.ts.
const TRIPLE_BEAT_SHORT_LABELS: Record<string, string> = {
  'EPS beat': 'EPS',
  'Revenue beat': 'Rev',
  'Guidance raised': 'Guide',
  '3-month base': 'Base',
  'Clears 3-month high': 'Breakout',
  'Price $10+': '$10+',
};

export function buildTripleBeatScanEmbeds(report: AgentReport): DiscordEmbed[] {
  const payload = report.reportJson as TripleBeatScanReport;
  const pct = (value: number, digits = 1) => `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`;
  const usd = (value: number) => `$${value.toFixed(2)}`;
  const dayLabel = new Date(`${payload.tradingDate}T12:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const asOfEt = new Date(payload.asOf).toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
  });
  const scanned = `${payload.earningsFilings} earnings filers · premarket as of ${asOfEt} ET`;
  const title = `Triple Beat earnings · ${dayLabel}`;

  if (payload.setups.length === 0) {
    return [{ title, description: `No setups today · ${scanned}`, color: TRIPLE_BEAT_GRADE_COLORS.B }];
  }

  const count = (grade: TripleBeatGrade) => payload.setups.filter((setup) => setup.grade === grade).length;
  const shown = payload.setups.slice(0, PARABOLIC_MAX_CARDS);
  const overflow = payload.setups.length > shown.length ? `\nShowing the top ${shown.length} of ${payload.setups.length}.` : '';
  const header: DiscordEmbed = {
    title,
    description: `🟢 A+ ${count('A+')} · 🟡 A ${count('A')} · ⚪ B ${count('B')} · ${scanned}${overflow}\n⚠️ Buy 1¢ over the 9:30–9:32 high. Stop 1¢ under the low of day; skip if that's under ${MIN_STOP_PCT}% of price or over ${MAX_STOP_ATR} ATR. Sell at 3R or the close.`,
    color: PARABOLIC_HEADER_COLOR,
  };

  const cards = shown.map((setup): DiscordEmbed => {
    const { metrics, plan, earnings } = setup;
    const checklist = setup.scoreItems.map((item) => {
      const icon = item.status === 'met' ? '✅' : item.status === 'unknown' ? '❔' : '❌';
      return `${TRIPLE_BEAT_SHORT_LABELS[item.label] ?? item.label} ${icon}`;
    });
    // No embed title: Discord renders titles larger than description text, and the name and grade lines should match.
    const description = [
      `**${setup.name ? `${setup.ticker} · ${setup.name}` : setup.ticker}**`,
      `**${setup.grade} · ${setup.score}/${setup.maxScore}** · ${PARABOLIC_SIZE_LABELS[plan.riskFraction]}`,
      setup.strictTripleBeat ? '🏆 Strict triple beat' : null,
      earnings.note || null,
      earnings.mixedCatalyst ? '⚠️ Mixed catalyst. Check headlines.' : null,
    ].filter(Boolean).join('\n');
    return {
      description,
      color: TRIPLE_BEAT_GRADE_COLORS[setup.grade],
      fields: [
        buildField('Min stop', `${usd((MIN_STOP_PCT / 100) * metrics.referencePrice)} · ${MIN_STOP_PCT}% of ${usd(metrics.referencePrice)}`),
        buildField('Max stop', MAX_STOP_ATR * metrics.atr14 < (MIN_STOP_PCT / 100) * metrics.referencePrice
          ? 'Under min stop, skip'
          : `${usd(MAX_STOP_ATR * metrics.atr14)} · ${MAX_STOP_ATR} ATR (${usd(metrics.atr14)})`),
        buildField('Gap · hold', `${pct(metrics.gapPct)} (high ${pct(metrics.maxGapPct)}) · ${metrics.holdPct.toFixed(0)}% of range`),
        buildField('Checklist', checklist.join('  '), false),
      ],
    };
  });

  return [header, ...cards];
}

export function buildSystemEmbed(
  title: string,
  detail: string,
  severity: Severity,
): DiscordEmbed {
  return {
    title: coerceFieldValue(title),
    description: optionalText(detail),
    color: DISCORD_EMBED_COLOR,
    footer: {
      text: `system • ${severity}`,
    },
  };
}

export function resolveWebhookUrl(agentId: AgentId, reportType: string): string | null {
  let envName: string | null = null;

  if (agentId === 'orchestrator' && reportType === 'macro-summary') {
    envName = 'DISCORD_WEBHOOK_MACRO_DAILY';
  } else if (agentId === 'orchestrator' && reportType === 'macro-intraday') {
    envName = 'DISCORD_WEBHOOK_MACRO_DAILY';
  } else if (agentId === 'orchestrator' && reportType === 'parabolic-scan') {
    envName = 'DISCORD_WEBHOOK_PARABOLIC';
  } else if (agentId === 'orchestrator' && reportType === 'triple-beat-scan') {
    envName = 'DISCORD_WEBHOOK_TRIPLE_BEAT';
  } else if (agentId === 'orchestrator' && (reportType === 'system-alert' || reportType.startsWith('system-'))) {
    envName = 'DISCORD_WEBHOOK_SYSTEM';
  } else if (agentId === 'small-cap-trader' && reportType === 'pre-market-scan') {
    envName = 'DISCORD_WEBHOOK_SCANS';
  } else if (agentId === 'small-cap-trader' && reportType === 'research') {
    envName = 'DISCORD_WEBHOOK_RESEARCH';
  } else if (agentId === 'swing-trader' && (reportType === 'momentum-scan' || reportType === 'research')) {
    envName = 'DISCORD_WEBHOOK_SWING_SETUPS';
  } else if (agentId === 'swing-trader' && reportType === 'pattern-check') {
    envName = 'DISCORD_WEBHOOK_SWING_ALERTS';
  } else {
    const combo = `${agentId}:${reportType}`;
    if (!loggedUnknownWebhookCombos.has(combo)) {
      loggedUnknownWebhookCombos.add(combo);
      console.warn(`Unknown agent webhook mapping: ${combo}`);
    }
    return null;
  }

  const resolved = process.env[envName]?.trim();
  return resolved ? resolved : null;
}

export async function writeAndDeliverReport(
  db: AgentDb,
  params: {
    jobId: string;
    userId: string;
    agentId: AgentId;
    reportType: string;
    title: string;
    summary: string | null;
    reportJson: unknown;
  },
): Promise<{ reportId: string; status: 'published' | 'delivery_failed'; deliveryError: string | null }> {
  const reportId = `${params.jobId}:${params.reportType}`;
  const storedReport = await ensureStoredReport(db, {
    reportId,
    ...params,
  });
  const deliveryResult = await deliverStoredReport(db, storedReport, {
    allowMarkerShortCircuit: true,
    manualAttempt: false,
  });

  return {
    reportId,
    ...deliveryResult,
  };
}

export async function redeliverReport(
  db: AgentDb,
  reportId: string,
): Promise<{ status: 'published' | 'delivery_failed'; deliveryError: string | null }> {
  const storedReport = await getReportById(db, reportId);
  if (!storedReport) {
    return {
      status: 'delivery_failed',
      deliveryError: 'report not found',
    };
  }

  return deliverStoredReport(db, storedReport, {
    allowMarkerShortCircuit: false,
    manualAttempt: true,
  });
}

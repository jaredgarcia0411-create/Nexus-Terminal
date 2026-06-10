import { z } from 'zod';

export type NewsFeedItem = {
  headline: string;
  summary: string;
  date: string;
  formType: string;
  url: string;
  tags: string[];
  isNews: boolean;
  isFiling: boolean;
  sentiment?: string | null;
  sentimentReasoning?: string | null;
};

export type BuildNewsFeedOptions = {
  maxItems?: number;
  maxAgeDays?: number;
  nowMs?: number;
};

export const newsFeedItemSchema = z.object({
  headline: z.string(),
  summary: z.string(),
  date: z.string(),
  formType: z.string(),
  url: z.string(),
  tags: z.array(z.string()),
  isNews: z.boolean(),
  isFiling: z.boolean(),
  sentiment: z.string().nullable().optional(),
  sentimentReasoning: z.string().nullable().optional(),
});

const DEFAULT_MAX_ITEMS = 10;
const DEFAULT_MAX_AGE_DAYS = 30;
const MAX_SUMMARY_LENGTH = 280;

function isValidRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readResults(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (!isValidRecord(value)) {
    return [];
  }

  return Array.isArray(value.results) ? value.results : [];
}

function getFieldValue(source: unknown, keys: string[]): unknown {
  if (!isValidRecord(source)) {
    return undefined;
  }

  for (const key of keys) {
    if (key in source) {
      return source[key];
    }
  }

  return undefined;
}

function getStringField(source: unknown, keys: string[]): string | null {
  const value = getFieldValue(source, keys);
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function getStringArrayField(source: unknown, keys: string[]): string[] {
  const value = getFieldValue(source, keys);
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

function toSummary(value: string | null): string {
  return value ? truncate(value, MAX_SUMMARY_LENGTH) : '';
}

function toTimestamp(value: string): number | null {
  const parsed = new Date(value);
  const timestamp = parsed.getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function normalizeDateKey(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const parsed = toTimestamp(value);
  if (parsed !== null) {
    return new Date(parsed).toISOString().slice(0, 10);
  }

  return value.trim() || null;
}

function shouldKeepItem(itemDate: string, options: Required<BuildNewsFeedOptions>): boolean {
  if (!itemDate) {
    return true;
  }

  const timestamp = toTimestamp(itemDate);
  if (timestamp === null) {
    return true;
  }

  return timestamp >= options.nowMs - (options.maxAgeDays * 86400000);
}

function readSentimentLabel(item: Record<string, unknown>): string | null {
  const sentiment = item.sentiment;
  if (!isValidRecord(sentiment)) return null;
  const pos = sentiment.pos, neg = sentiment.neg, neu = sentiment.neu;
  if (typeof pos !== 'number' || typeof neg !== 'number' || typeof neu !== 'number') return null;
  if (pos >= neg && pos >= neu) return 'positive';
  if (neg >= pos && neg >= neu) return 'negative';
  return 'neutral';
}

function buildNewsItem(item: unknown): NewsFeedItem | null {
  if (!isValidRecord(item)) {
    return null;
  }

  return {
    headline: getStringField(item, ['title']) ?? 'News item',
    summary: toSummary(getStringField(item, ['content'])),
    date: getStringField(item, ['date']) ?? '',
    formType: 'news',
    url: getStringField(item, ['link']) ?? '',
    tags: getStringArrayField(item, ['tags']),
    isNews: true,
    isFiling: false,
    sentiment: readSentimentLabel(item),
  };
}

function dedupeNewsFeed(
  items: Array<{ item: NewsFeedItem; source: unknown }>,
): NewsFeedItem[] {
  const seenAccessions = new Set<string>();
  const seenUrls = new Set<string>();

  return items.filter(({ item, source }) => {
    const accessionNumber = getStringField(source, ['accession_number', 'accessionNumber']);
    if (accessionNumber) {
      if (seenAccessions.has(accessionNumber)) {
        return false;
      }

      seenAccessions.add(accessionNumber);
      return true;
    }

    if (item.url) {
      if (seenUrls.has(item.url)) {
        return false;
      }

      seenUrls.add(item.url);
    }

    return true;
  }).map(({ item }) => item);
}

function sortNewsFeed(left: NewsFeedItem, right: NewsFeedItem): number {
  const leftTimestamp = left.date ? toTimestamp(left.date) : null;
  const rightTimestamp = right.date ? toTimestamp(right.date) : null;

  if (leftTimestamp !== null && rightTimestamp !== null) {
    return rightTimestamp - leftTimestamp;
  }

  if (leftTimestamp !== null) {
    return -1;
  }

  if (rightTimestamp !== null) {
    return 1;
  }

  return 0;
}

export function buildNewsFeedFromArrays(
  newsItems: unknown[],
  options?: BuildNewsFeedOptions,
): NewsFeedItem[] {
  const normalizedOptions: Required<BuildNewsFeedOptions> = {
    maxItems: options?.maxItems ?? DEFAULT_MAX_ITEMS,
    maxAgeDays: options?.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS,
    nowMs: options?.nowMs ?? Date.now(),
  };
  const normalizedItems = newsItems
    .map((source) => {
      const item = buildNewsItem(source);
      return item ? { item, source } : null;
    })
    .filter((entry): entry is { item: NewsFeedItem; source: unknown } => entry !== null);
  const dedupedItems = dedupeNewsFeed(normalizedItems);

  return dedupedItems
    .filter((item) => shouldKeepItem(item.date, normalizedOptions))
    .sort(sortNewsFeed)
    .slice(0, normalizedOptions.maxItems);
}

export function buildNewsFeed(
  rawData: Record<string, unknown>,
  options?: BuildNewsFeedOptions,
): NewsFeedItem[] {
  return buildNewsFeedFromArrays(
    readResults(rawData.news ?? rawData['news']),
    options,
  );
}

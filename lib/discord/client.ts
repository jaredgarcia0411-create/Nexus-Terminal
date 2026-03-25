/**
 * Discord REST API client for fetching channel message history.
 *
 * Uses a Discord Bot token for authentication. The bot needs
 * READ_MESSAGE_HISTORY permission on the target channel.
 *
 * Discord API docs: https://discord.com/developers/docs/resources/channel#get-channel-messages
 */

const DISCORD_API_BASE = 'https://discord.com/api/v10';

export function requireDiscordConfig(): { botToken: string; channelId: string } | Response {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  const channelId = process.env.DISCORD_CHANNEL_ID;
  if (!botToken || !channelId) {
    return Response.json(
      { error: 'DISCORD_BOT_TOKEN and DISCORD_CHANNEL_ID must be set' },
      { status: 503 },
    );
  }
  return { botToken, channelId };
}

/** Shape of a Discord embed from the REST API */
interface DiscordEmbed {
  title?: string;
  description?: string;
}

/** Shape of a Discord message from the REST API (only fields we use) */
export interface DiscordMessage {
  id: string;
  content: string;
  timestamp: string;
  embeds?: DiscordEmbed[];
  author: {
    id: string;
    username: string;
  };
}

/**
 * Extract the text content from a Discord message.
 *
 * IMPORTANT: This bot sends research reports as rich embeds, not plain text.
 * The report text is in `embeds[0].description`, while `content` is empty.
 * This helper checks embeds first, then falls back to `content`.
 */
export function getMessageText(message: DiscordMessage): string {
  if (message.embeds && message.embeds.length > 0) {
    const embedText = message.embeds
      .map((e) => [e.title, e.description].filter(Boolean).join('\n'))
      .join('\n\n');
    if (embedText) return embedText;
  }

  return message.content;
}

/**
 * Fetch messages from a Discord channel, paginating backwards from the most recent.
 *
 * Discord returns max 100 messages per request. To get all messages, we paginate
 * using the `before` parameter - each request fetches the 100 messages before
 * the oldest message from the previous batch.
 *
 * @param channelId - Discord channel ID
 * @param botToken - Discord bot token (from DISCORD_BOT_TOKEN env var)
 * @param options.before - Fetch messages before this message ID (for pagination)
 * @param options.after - Fetch messages after this message ID (for incremental sync)
 * @param options.limit - Max messages per request (1-100, default 100)
 */
export async function fetchMessages(
  channelId: string,
  botToken: string,
  options: { before?: string; after?: string; limit?: number } = {},
): Promise<DiscordMessage[]> {
  const params = new URLSearchParams();
  params.set('limit', String(options.limit ?? 100));
  if (options.before) params.set('before', options.before);
  if (options.after) params.set('after', options.after);

  const url = `${DISCORD_API_BASE}/channels/${channelId}/messages?${params.toString()}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bot ${botToken}`,
    },
  });

  // Handle rate limiting — Discord tells us exactly how long to wait
  if (response.status === 429) {
    const body = await response.json().catch(() => ({ retry_after: 1 }));
    const waitSeconds = (body as { retry_after?: number }).retry_after ?? 1;
    console.info(`[discord-client] Rate limited, waiting ${waitSeconds}s...`);
    await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
    // Retry the same request
    return fetchMessages(channelId, botToken, options);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '(no body)');
    throw new Error(`Discord API error ${response.status}: ${body}`);
  }

  return (await response.json()) as DiscordMessage[];
}

/**
 * Fetch ALL messages from a channel by paginating backwards.
 *
 * Calls fetchMessages repeatedly, moving the `before` cursor backwards
 * until no more messages are returned. For ~1000 messages this takes
 * ~10 requests (100 per page) and completes in a few seconds.
 *
 * @param channelId - Discord channel ID
 * @param botToken - Discord bot token
 * @param onBatch - Optional callback after each batch (for progress logging)
 */
export async function fetchAllMessages(
  channelId: string,
  botToken: string,
  onBatch?: (batchSize: number, totalSoFar: number) => void,
): Promise<DiscordMessage[]> {
  const allMessages: DiscordMessage[] = [];
  let before: string | undefined;

  while (true) {
    const batch = await fetchMessages(channelId, botToken, { before });

    if (batch.length === 0) break;

    allMessages.push(...batch);
    before = batch[batch.length - 1].id;

    if (onBatch) {
      onBatch(batch.length, allMessages.length);
    }

    if (batch.length === 100) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    } else {
      break;
    }
  }

  return allMessages;
}

/**
 * Fetch messages posted AFTER a specific message ID (for incremental sync).
 *
 * Uses the `after` parameter to get only new messages since the last import.
 * Paginates forward until no more messages are returned.
 */
export async function fetchNewMessages(
  channelId: string,
  botToken: string,
  afterMessageId: string,
): Promise<DiscordMessage[]> {
  const allMessages: DiscordMessage[] = [];
  let after = afterMessageId;

  while (true) {
    const batch = await fetchMessages(channelId, botToken, { after });

    if (batch.length === 0) break;

    allMessages.push(...batch);
    after = batch[0].id;

    if (batch.length < 100) break;

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return allMessages;
}

/**
 * Save parsed Discord reports to the database and update ticker summaries.
 *
 * Shared by all 3 Discord sync routes (import, sync, cron/sync).
 * Returns the number of successfully inserted reports and the set of tickers touched.
 */
export async function saveDiscordReports(
  db: any,
  userId: string,
  parsed: Array<{ messageId: string; timestamp: string; data: { ticker: string }; rawText: string }>,
  routeLabel: string,
): Promise<{ imported: number; tickers: Set<string> }> {
  const { importedResearchReports } = await import('@/lib/db/schema');
  const { updateTickerSummary } = await import('@/lib/jarvis/historical-summary');

  let imported = 0;
  const tickers = new Set<string>();

  for (const report of parsed) {
    try {
      await db.insert(importedResearchReports).values({
        id: crypto.randomUUID(),
        userId,
        ticker: report.data.ticker,
        reportDate: new Date(report.timestamp),
        source: 'discord_import',
        discordMessageId: report.messageId,
        rawText: report.rawText,
        parsedJson: report.data,
      }).onConflictDoNothing();

      imported++;
      tickers.add(report.data.ticker);
    } catch (error) {
      console.error(`[${routeLabel}] Failed to insert report ${report.messageId}:`, error);
    }
  }

  for (const ticker of tickers) {
    try {
      await updateTickerSummary(userId, ticker);
    } catch (error) {
      console.error(`[${routeLabel}] Failed to update summary for ${ticker}:`, error);
    }
  }

  return { imported, tickers };
}

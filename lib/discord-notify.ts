type TradeEventName = 'trade_imported' | 'sync_complete';

export function formatTradeEventMessage(event: TradeEventName, data: unknown) {
  const payload = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;

  if (event === 'trade_imported') {
    const symbol = typeof payload.symbol === 'string' ? payload.symbol : 'unknown symbol';
    const pnl = typeof payload.pnl === 'number' ? payload.pnl.toFixed(2) : null;
    return pnl == null
      ? `New trade imported for ${symbol}.`
      : `New trade imported for ${symbol}. PnL: ${pnl}.`;
  }

  const tradesImported = typeof payload.tradesImported === 'number' ? payload.tradesImported : null;
  return tradesImported == null
    ? 'Broker sync completed.'
    : `Broker sync completed. Imported ${tradesImported} trade(s).`;
}

async function sendDiscordDm(botToken: string, discordUserId: string, content: string) {
  const dmChannelRes = await fetch('https://discord.com/api/v10/users/@me/channels', {
    method: 'POST',
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ recipient_id: discordUserId }),
  });

  if (!dmChannelRes.ok) {
    const detail = await dmChannelRes.text().catch(() => '');
    throw new Error(`Failed to open DM for ${discordUserId}: ${detail}`);
  }

  const dm = (await dmChannelRes.json()) as { id?: string };
  if (!dm.id) {
    throw new Error(`Discord DM channel missing id for ${discordUserId}`);
  }

  const messageRes = await fetch(`https://discord.com/api/v10/channels/${dm.id}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content }),
  });

  if (!messageRes.ok) {
    const detail = await messageRes.text().catch(() => '');
    throw new Error(`Failed to send DM to ${discordUserId}: ${detail}`);
  }
}

export async function sendDiscordDms(botToken: string, userIds: string[], content: string, maxRecipients = 5) {
  const uniqueUsers = Array.from(new Set(userIds.filter(Boolean))).slice(0, maxRecipients);
  let delivered = 0;

  for (const userId of uniqueUsers) {
    try {
      await sendDiscordDm(botToken, userId, content);
      delivered += 1;
    } catch (error) {
      console.error('[discord-notify] DM send failed', { userId, error });
    }
  }

  return { delivered, attempted: uniqueUsers.length };
}

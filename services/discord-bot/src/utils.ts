import { EmbedBuilder } from "discord.js";

// ---------------------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------------------

function getEnv(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export function getNexusApiUrl(): string {
  return getEnv("NEXUS_API_URL", "http://localhost:3000");
}

export function getWebhookSecret(): string {
  return getEnv("TRADE_WEBHOOK_SECRET");
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

export interface NexusRequestOptions {
  method?: string;
  body?: unknown;
}

/**
 * Fetch wrapper for calling the Nexus Terminal API.
 * Automatically injects the shared-secret Bearer token.
 */
export async function fetchNexusApi<T = unknown>(
  path: string,
  options: NexusRequestOptions = {},
): Promise<T> {
  const base = getNexusApiUrl().replace(/\/+$/, "");
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${getWebhookSecret()}`,
  };

  const res = await fetch(url, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "Unknown error");
    throw new Error(`Nexus API ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/**
 * Format a number as USD currency.
 */
export function formatCurrency(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Pick an embed colour based on a PnL value.
 */
export function pnlColor(value: number): number {
  if (value > 0) return 0x22c55e; // green
  if (value < 0) return 0xef4444; // red
  return 0x6b7280; // gray / break-even
}

// ---------------------------------------------------------------------------
// Trade embed builder
// ---------------------------------------------------------------------------

export interface Trade {
  id?: string;
  symbol: string;
  direction: string;
  pnl: number;
  entryPrice?: number;
  exitPrice?: number;
  quantity?: number;
  entryDate?: string;
  exitDate?: string;
  notes?: string;
}

/**
 * Build a Discord embed summarising a single trade.
 */
export function createTradeEmbed(trade: Trade): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`${trade.symbol} — ${trade.direction.toUpperCase()}`)
    .setColor(pnlColor(trade.pnl))
    .addFields({ name: "PnL", value: formatCurrency(trade.pnl), inline: true });

  if (trade.entryPrice !== undefined) {
    embed.addFields({
      name: "Entry",
      value: `$${trade.entryPrice.toFixed(2)}`,
      inline: true,
    });
  }
  if (trade.exitPrice !== undefined) {
    embed.addFields({
      name: "Exit",
      value: `$${trade.exitPrice.toFixed(2)}`,
      inline: true,
    });
  }
  if (trade.quantity !== undefined) {
    embed.addFields({
      name: "Qty",
      value: trade.quantity.toString(),
      inline: true,
    });
  }
  if (trade.notes) {
    embed.addFields({ name: "Notes", value: trade.notes });
  }

  return embed;
}

import { EmbedBuilder } from "discord.js";
import { createHmac, randomUUID } from "node:crypto";

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

function base64UrlEncode(input: string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function signHmacSha256(input: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(input)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export const SERVICE_SCOPE = {
  TRADES_READ: "trades:read",
  ALERTS_READ: "alerts:read",
  ALERTS_WRITE: "alerts:write",
  ALERTS_EVALUATE: "alerts:evaluate",
  LINK_CODE_CREATE: "link:code:create",
  WEBHOOK_TRADE_EVENT: "webhooks:trade-event",
} as const;

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

export interface NexusRequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

/**
 * Fetch wrapper for calling the Nexus Terminal API.
 * Requires callers to provide Authorization with a scoped service JWT.
 */
export async function fetchNexusApi<T = unknown>(
  path: string,
  options: NexusRequestOptions = {},
): Promise<T> {
  const base = getNexusApiUrl().replace(/\/+$/, "");
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers ?? {}),
  };
  if (!headers.Authorization) {
    throw new Error(`Missing Authorization header for Nexus API request: ${path}`);
  }

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

export function buildDiscordUserHeaders(
  discordUserId: string,
  guildId?: string | null,
  scopes: string[] = [SERVICE_SCOPE.TRADES_READ],
): Record<string, string> {
  return {
    Authorization: `Bearer ${buildServiceTokenWithScopes(discordUserId, guildId, scopes)}`,
  };
}

function buildServiceTokenWithScopes(discordUserId: string, guildId: string | null | undefined, scopes: string[]): string {
  const now = Math.floor(Date.now() / 1000);
  const uniqueScopes = Array.from(new Set(scopes.map((scope) => scope.trim()).filter(Boolean)));
  const payload = {
    iss: "nexus-service",
    aud: "nexus-api",
    iat: now,
    exp: now + 5 * 60,
    jti: randomUUID(),
    scope: uniqueScopes,
    discordUserId,
    ...(guildId ? { guildId } : {}),
  };
  const header = { alg: "HS256", typ: "JWT" };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = signHmacSha256(signingInput, getWebhookSecret());
  return `${signingInput}.${signature}`;
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
  date?: string;
  sortKey?: string;
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

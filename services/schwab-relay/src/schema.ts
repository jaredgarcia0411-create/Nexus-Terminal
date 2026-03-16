/**
 * Relay schema - intentional SUBSET of the main app schema.
 * Source of truth: lib/db/schema.ts (in the main Nexus Terminal app).
 *
 * This file only declares the tables/columns the relay reads and writes.
 * Missing columns (accountLabel, linkedAt, status enum) and indexes are
 * defined by the main app's migrations and exist in the DB - they're just
 * not needed here.
 */
import { doublePrecision, index, jsonb, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';

export const schwabLinks = pgTable('schwab_links', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  encryptedTokens: text('encrypted_tokens').notNull(),
  tokenIv: text('token_iv').notNull(),
  tokenTag: text('token_tag').notNull(),
  status: text('status').notNull(),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }).notNull(),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
});

export const realtimeQuotes = pgTable('realtime_quotes', {
  symbol: text('symbol').primaryKey(),
  assetType: text('asset_type').notNull(),
  lastPrice: doublePrecision('last_price'),
  bidPrice: doublePrecision('bid_price'),
  askPrice: doublePrecision('ask_price'),
  openPrice: doublePrecision('open_price'),
  highPrice: doublePrecision('high_price'),
  lowPrice: doublePrecision('low_price'),
  closePrice: doublePrecision('close_price'),
  netChange: doublePrecision('net_change'),
  netChangePercent: doublePrecision('net_change_percent'),
  totalVolume: doublePrecision('total_volume'),
  exchangeId: text('exchange_id'),
  description: text('description'),
  securityStatus: text('security_status'),
  quoteTimeMs: doublePrecision('quote_time_ms'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const marketSnapshots = pgTable('market_snapshots', {
  id: text('id').primaryKey(),
  snapshotType: text('snapshot_type').notNull(),
  dataJson: jsonb('data_json').notNull(),
  warning: text('warning'),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (table) => [
  unique().on(table.snapshotType),
  index('market_snapshots_expires_idx').on(table.expiresAt),
]);

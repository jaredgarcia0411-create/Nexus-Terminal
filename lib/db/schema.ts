import { sql } from 'drizzle-orm';
import { pgTable, text, doublePrecision, integer, serial, timestamp, primaryKey, index, unique, foreignKey, boolean } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').unique().notNull(),
  name: text('name'),
  picture: text('picture'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const trades = pgTable('trades', {
  id: text('id').notNull(),
  userId: text('user_id').notNull().references(() => users.id),
  date: text('date').notNull(),
  sortKey: text('sort_key').notNull(),
  symbol: text('symbol').notNull(),
  direction: text('direction', { enum: ['LONG', 'SHORT'] }).notNull(),
  avgEntryPrice: doublePrecision('avg_entry_price').notNull(),
  avgExitPrice: doublePrecision('avg_exit_price').notNull(),
  totalQuantity: doublePrecision('total_quantity').notNull(),
  grossPnl: doublePrecision('gross_pnl').notNull().default(0),
  netPnl: doublePrecision('net_pnl').notNull().default(0),
  entryTime: text('entry_time').notNull().default(''),
  exitTime: text('exit_time').notNull().default(''),
  executionCount: integer('execution_count').notNull().default(1),
  mfe: doublePrecision('mfe'),
  mae: doublePrecision('mae'),
  bestExitPnl: doublePrecision('best_exit_pnl'),
  exitEfficiency: doublePrecision('exit_efficiency'),
  pnl: doublePrecision('pnl').notNull(),
  // Transitional legacy column retained for one release cycle.
  executions: integer('executions').notNull().default(1),
  initialRisk: doublePrecision('initial_risk'),
  commission: doublePrecision('commission').default(0),
  fees: doublePrecision('fees').default(0),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.id] }),
  index('idx_trades_user_sort_key').on(table.userId, table.sortKey),
]);

export const tradeExecutions = pgTable('trade_executions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tradeId: text('trade_id').notNull(),
  side: text('side', { enum: ['ENTRY', 'EXIT'] }).notNull(),
  price: doublePrecision('price').notNull(),
  qty: doublePrecision('qty').notNull(),
  time: text('time').notNull(),
  timestamp: text('timestamp'),
  commission: doublePrecision('commission').default(0),
  fees: doublePrecision('fees').default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  foreignKey({
    columns: [table.userId, table.tradeId],
    foreignColumns: [trades.userId, trades.id],
  }).onDelete('cascade'),
  index('idx_executions_user_trade').on(table.userId, table.tradeId),
]);

export const tradeTags = pgTable('trade_tags', {
  userId: text('user_id').notNull().references(() => users.id),
  tradeId: text('trade_id').notNull(),
  tag: text('tag').notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.tradeId, table.tag] }),
  foreignKey({
    columns: [table.userId, table.tradeId],
    foreignColumns: [trades.userId, trades.id],
  }).onDelete('cascade'),
  index('idx_trade_tags_user_trade_id').on(table.userId, table.tradeId),
]);

export const tags = pgTable('tags', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
}, (table) => [
  unique().on(table.userId, table.name),
  index('idx_tags_user_id').on(table.userId),
]);

export const brokerSyncLog = pgTable('broker_sync_log', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  broker: text('broker').notNull(),
  accountNumber: text('account_number').notNull(),
  syncStart: text('sync_start').notNull(),
  syncEnd: text('sync_end').notNull(),
  tradesSynced: integer('trades_synced').notNull().default(0),
  syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow(),
});

export const discordUserLinks = pgTable('discord_user_links', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  discordUserId: text('discord_user_id').notNull(),
  guildId: text('guild_id').notNull(),
  linkedAt: timestamp('linked_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.discordUserId] }),
  index('idx_discord_links_discord_guild').on(table.discordUserId, table.guildId),
  index('idx_discord_links_user_id').on(table.userId),
]);

export const discordLinkCodes = pgTable('discord_link_codes', {
  code: text('code').primaryKey(),
  discordUserId: text('discord_user_id').notNull(),
  guildId: text('guild_id').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_discord_link_codes_user').on(table.discordUserId),
  index('idx_discord_link_codes_expires').on(table.expiresAt),
]);

export const priceAlerts = pgTable('price_alerts', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  symbol: text('symbol').notNull(),
  condition: text('condition', { enum: ['above', 'below'] }).notNull(),
  targetPrice: doublePrecision('target_price').notNull(),
  triggered: boolean('triggered').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_price_alerts_user_triggered').on(table.userId, table.triggered),
]);

export const notificationJobs = pgTable('notification_jobs', {
  id: serial('id').primaryKey(),
  type: text('type', { enum: ['trade_event', 'price_alert'] }).notNull(),
  discordUserId: text('discord_user_id').notNull(),
  content: text('content').notNull(),
  dedupeKey: text('dedupe_key'),
  status: text('status', { enum: ['pending', 'processing', 'sent', 'failed'] }).notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(5),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
  lastError: text('last_error'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().$onUpdateFn(() => sql`now()`),
}, (table) => [
  unique().on(table.dedupeKey),
  index('idx_notification_jobs_status_next_attempt').on(table.status, table.nextAttemptAt),
  index('idx_notification_jobs_discord_user').on(table.discordUserId),
]);

export const jarvisSourceUrls = pgTable('jarvis_source_urls', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  useCount: integer('use_count').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.url] }),
  index('idx_jarvis_source_urls_user_last_used').on(table.userId, table.lastUsedAt),
]);

export const serviceTokenJtis = pgTable('service_token_jtis', {
  jti: text('jti').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_service_token_jtis_expires').on(table.expiresAt),
]);

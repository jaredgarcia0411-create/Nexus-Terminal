import { sql } from 'drizzle-orm';
import { pgTable, text, doublePrecision, integer, serial, timestamp, primaryKey, index, unique } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').unique().notNull(),
  name: text('name'),
  picture: text('picture'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const trades = pgTable('trades', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  date: text('date').notNull(),
  sortKey: text('sort_key').notNull(),
  symbol: text('symbol').notNull(),
  direction: text('direction', { enum: ['LONG', 'SHORT'] }).notNull(),
  avgEntryPrice: doublePrecision('avg_entry_price').notNull(),
  avgExitPrice: doublePrecision('avg_exit_price').notNull(),
  totalQuantity: doublePrecision('total_quantity').notNull(),
  pnl: doublePrecision('pnl').notNull(),
  executions: integer('executions').notNull().default(1),
  initialRisk: doublePrecision('initial_risk'),
  commission: doublePrecision('commission').default(0),
  fees: doublePrecision('fees').default(0),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_trades_user_sort_key').on(table.userId, table.sortKey),
]);

export const tradeTags = pgTable('trade_tags', {
  tradeId: text('trade_id').notNull().references(() => trades.id, { onDelete: 'cascade' }),
  tag: text('tag').notNull(),
}, (table) => [
  primaryKey({ columns: [table.tradeId, table.tag] }),
  index('idx_trade_tags_trade_id').on(table.tradeId),
]);

export const tags = pgTable('tags', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
}, (table) => [
  unique().on(table.userId, table.name),
  index('idx_tags_user_id').on(table.userId),
]);

export const schwabTokens = pgTable('schwab_tokens', {
  userId: text('user_id').primaryKey().references(() => users.id),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token').notNull(),
  expiresAt: text('expires_at').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().$onUpdateFn(() => sql`now()`),
});

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

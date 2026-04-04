import { pgTable, text, doublePrecision, integer, serial, timestamp, primaryKey, index, unique, foreignKey, jsonb } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').unique().notNull(),
  name: text('name'),
  picture: text('picture'),
  googleId: text('google_id').unique(),
  username: text('username').unique(),
  passwordHash: text('password_hash'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const trades = pgTable('trades', {
  id: text('id').notNull(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
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
  index('idx_trades_user_date').on(table.userId, table.date),
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
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
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
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
}, (table) => [
  unique().on(table.userId, table.name),
  index('idx_tags_user_id').on(table.userId),
]);

export const tradeImportBatches = pgTable('trade_import_batches', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  batchKey: text('batch_key').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.batchKey] }),
  index('idx_trade_import_batches_user_created').on(table.userId, table.createdAt),
]);

export const brokerSyncLog = pgTable('broker_sync_log', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  broker: text('broker').notNull(),
  accountNumber: text('account_number').notNull(),
  syncStart: text('sync_start').notNull(),
  syncEnd: text('sync_end').notNull(),
  tradesSynced: integer('trades_synced').notNull().default(0),
  syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow(),
});

export const agentMemory = pgTable('agent_memory', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  category: text('category').notNull(),
  key: text('key').notNull(),
  value: text('value').notNull(),
  valueJson: jsonb('value_json'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
}, (table) => [
  unique().on(table.userId, table.category, table.key),
  index('agent_memory_user_category_idx').on(table.userId, table.category),
]);

export const researchReports = pgTable('research_reports', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  ticker: text('ticker').notNull(),
  status: text('status').notNull().default('pending'),
  rawData: jsonb('raw_data'),
  reportJson: jsonb('report_json'),
  modelUsed: text('model_used'),
  errorMessage: text('error_message'),
  generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('research_reports_user_ticker_idx').on(table.userId, table.ticker, table.generatedAt),
]);

export const importedResearchReports = pgTable('imported_research_reports', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  ticker: text('ticker').notNull(),
  reportDate: timestamp('report_date', { withTimezone: true }).notNull(),
  source: text('source').notNull().default('discord_import'),
  discordMessageId: text('discord_message_id'),
  rawText: text('raw_text').notNull(),
  parsedJson: jsonb('parsed_json'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  unique().on(table.discordMessageId),
  index('imported_research_user_ticker_idx').on(table.userId, table.ticker, table.reportDate),
  index('imported_research_user_date_idx').on(table.userId, table.reportDate),
]);

export const tickerResearchSummaries = pgTable('ticker_research_summaries', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  ticker: text('ticker').notNull(),
  reportCount: integer('report_count').notNull().default(0),
  latestReportDate: timestamp('latest_report_date', { withTimezone: true }),
  historicalSummary: jsonb('historical_summary'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  unique().on(table.userId, table.ticker),
  index('ticker_research_summaries_user_idx').on(table.userId),
]);

export const dailyTickerSummaries = pgTable('daily_ticker_summaries', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  ticker: text('ticker').notNull(),
  date: text('date').notNull(),
  open: doublePrecision('open'),
  high: doublePrecision('high'),
  low: doublePrecision('low'),
  close: doublePrecision('close'),
  volume: doublePrecision('volume'),
  preMarket: doublePrecision('pre_market'),
  afterHours: doublePrecision('after_hours'),
  rawData: jsonb('raw_data'),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique().on(table.userId, table.ticker, table.date),
  index('daily_ticker_summaries_user_date_idx').on(table.userId, table.fetchedAt),
]);

export const savedTickers = pgTable('saved_tickers', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  ticker: text('ticker').notNull(),
  category: text('category').notNull().default('watchlist'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique().on(table.userId, table.ticker),
  index('saved_tickers_user_created_idx').on(table.userId, table.createdAt),
]);

// Shared cache for Ask Edgar API responses — no userId, shared across all users
export const askedgarCache = pgTable('askedgar_cache', {
  id: text('id').primaryKey(),
  cacheType: text('cache_type').notNull(),     // 'ticker' or 'gainers'
  ticker: text('ticker').notNull(),             // uppercase ticker symbol or '__GAINERS__'
  dataJson: jsonb('data_json').notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (table) => [
  unique().on(table.cacheType, table.ticker),
  index('askedgar_cache_expires_idx').on(table.expiresAt),
]);

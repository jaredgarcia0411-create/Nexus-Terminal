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

export const macroSummaries = pgTable('macro_summaries', {
  id: text('id').primaryKey(),
  summaryJson: jsonb('summary_json').notNull(),
  sourcesJson: jsonb('sources_json'),
  modelUsed: text('model_used'),
  generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('macro_summaries_generated_at_idx').on(table.generatedAt),
]);

export const jarvisConversations = pgTable('jarvis_conversations', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  sessionId: text('session_id').notNull(),
  role: text('role').notNull(),
  content: text('content').notNull(),
  mode: text('mode'),
  contextSnapshot: jsonb('context_snapshot'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('jarvis_conversations_user_session_idx').on(table.userId, table.sessionId, table.createdAt),
]);

export const jarvisRequestLog = pgTable('jarvis_request_log', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  mode: text('mode').notNull(),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  totalTokens: integer('total_tokens').notNull().default(0),
  durationMs: integer('duration_ms').notNull().default(0),
  success: integer('success').notNull().default(1),
  sourceCount: integer('source_count').notNull().default(0),
  chunkCount: integer('chunk_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_jarvis_request_log_user_created').on(table.userId, table.createdAt),
  index('idx_jarvis_request_log_created').on(table.createdAt),
]);

export const schwabLinks = pgTable('schwab_links', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  encryptedTokens: text('encrypted_tokens').notNull(),
  tokenIv: text('token_iv').notNull(),
  tokenTag: text('token_tag').notNull(),
  accountLabel: text('account_label'),
  status: text('status', { enum: ['active', 'expired', 'revoked'] }).notNull().default('active'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }).notNull(),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }).notNull(),
  linkedAt: timestamp('linked_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  unique().on(table.userId),
  index('schwab_links_status_idx').on(table.status),
]);

export const realtimeQuotes = pgTable('realtime_quotes', {
  symbol: text('symbol').primaryKey(),
  assetType: text('asset_type', { enum: ['equity', 'etf', 'future', 'forex', 'index', 'crypto'] }).notNull().default('equity'),
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
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('realtime_quotes_asset_type_idx').on(table.assetType),
  index('realtime_quotes_updated_at_idx').on(table.updatedAt),
]);

export const scannerPresets = pgTable('scanner_presets', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  filtersJson: jsonb('filters_json').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique().on(table.userId, table.name),
  index('scanner_presets_user_idx').on(table.userId),
]);

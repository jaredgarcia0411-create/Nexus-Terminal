import { pgTable, text, doublePrecision, integer, real, serial, timestamp, primaryKey, index, unique, foreignKey, jsonb, date, boolean } from 'drizzle-orm/pg-core';

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

export const agentRegistry = pgTable('agent_registry', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  description: text('description').notNull(),
  status: text('status').notNull().default('offline'),
  capabilities: jsonb('capabilities').notNull().default([]),
  config: jsonb('config').notNull().default({}),
  lastHeartbeat: timestamp('last_heartbeat', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const agentJobs = pgTable('agent_jobs', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => agentRegistry.id),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  jobType: text('job_type').notNull(),
  status: text('status').notNull().default('queued'),
  priority: integer('priority').notNull().default(0),
  input: jsonb('input').notNull(),
  result: jsonb('result'),
  errorMessage: text('error_message'),
  progressNote: text('progress_note'),
  stepLog: jsonb('step_log').default([]),
  attempt: integer('attempt').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
  nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
  lockedBy: text('locked_by'),
  lockExpiresAt: timestamp('lock_expires_at', { withTimezone: true }),
  lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }),
  leaseVersion: integer('lease_version').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => [
  index('idx_agent_jobs_poll').on(table.agentId, table.priority, table.createdAt),
  index('idx_agent_jobs_user_status').on(table.userId, table.status, table.createdAt),
  index('idx_agent_jobs_stale').on(table.status, table.lockExpiresAt),
]);

export const agentReports = pgTable('agent_reports', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => agentRegistry.id),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  jobId: text('job_id').references(() => agentJobs.id, { onDelete: 'set null' }),
  reportType: text('report_type').notNull(),
  title: text('title').notNull(),
  summary: text('summary'),
  reportJson: jsonb('report_json').notNull(),
  status: text('status').notNull().default('published'),
  deliveryChannel: text('delivery_channel').notNull().default('discord'),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  deliveryError: text('delivery_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_agent_reports_user_status').on(table.userId, table.status, table.createdAt),
  index('idx_agent_reports_agent').on(table.agentId, table.createdAt),
  index('idx_agent_reports_job').on(table.jobId),
]);

export const agentConversations = pgTable('agent_conversations', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  agentId: text('agent_id').notNull().references(() => agentRegistry.id),
  sessionId: text('session_id').notNull(),
  role: text('role').notNull(),
  content: text('content').notNull(),
  channel: text('channel').notNull().default('web'),
  contextSnapshot: jsonb('context_snapshot'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_agent_conversations_user_session').on(table.userId, table.sessionId, table.createdAt),
  index('idx_agent_conversations_agent').on(table.agentId, table.createdAt),
]);

export const agentRequestLog = pgTable('agent_request_log', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  agentId: text('agent_id').notNull().references(() => agentRegistry.id),
  mode: text('mode').notNull(),
  lane: text('lane').notNull().default('background'),
  modelUsed: text('model_used'),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  totalTokens: integer('total_tokens').notNull().default(0),
  estimatedCostCents: real('estimated_cost_cents').default(0),
  durationMs: integer('duration_ms').notNull().default(0),
  success: integer('success').notNull().default(1),
  sourceCount: integer('source_count').notNull().default(0),
  chunkCount: integer('chunk_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_agent_request_log_user_created').on(table.userId, table.createdAt),
  index('idx_agent_request_log_agent_created').on(table.agentId, table.createdAt),
  index('idx_agent_request_log_created').on(table.createdAt),
]);

export const agentMemoryV2 = pgTable('agent_memory_v2', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  agentId: text('agent_id').notNull().references(() => agentRegistry.id),
  category: text('category').notNull(),
  key: text('key').notNull(),
  value: text('value').notNull(),
  valueJson: jsonb('value_json'),
  source: text('source'),
  confidence: text('confidence'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
}, (table) => [
  unique('agent_memory_v2_user_agent_category_key').on(table.userId, table.agentId, table.category, table.key),
  index('agent_memory_v2_user_agent_category_idx').on(table.userId, table.agentId, table.category),
]);

export const agentScheduledRuns = pgTable('agent_scheduled_runs', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => agentRegistry.id),
  triggerType: text('trigger_type').notNull(),
  tradingDate: text('trading_date').notNull(),
  status: text('status').notNull().default('pending'),
  jobId: text('job_id').references(() => agentJobs.id),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  skipReason: text('skip_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  unique('agent_scheduled_runs_agent_trigger_date').on(table.agentId, table.triggerType, table.tradingDate),
  index('idx_scheduled_runs_status').on(table.agentId, table.status, table.tradingDate),
]);

export const agentStepEffects = pgTable('agent_step_effects', {
  id: text('id').primaryKey(),
  jobId: text('job_id').notNull().references(() => agentJobs.id, { onDelete: 'cascade' }),
  stepName: text('step_name').notNull(),
  effectType: text('effect_type').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  unique('agent_step_effects_idempotency').on(table.idempotencyKey),
]);

export const agentJobCheckpoints = pgTable('agent_job_checkpoints', {
  id: text('id').primaryKey(),
  jobId: text('job_id').notNull().references(() => agentJobs.id, { onDelete: 'cascade' }),
  stepIndex: integer('step_index').notNull(),
  stepName: text('step_name').notNull(),
  checkpointJson: jsonb('checkpoint_json').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  unique('agent_job_checkpoints_job_step').on(table.jobId, table.stepIndex),
  index('idx_agent_job_checkpoints_job_step').on(table.jobId, table.stepIndex),
]);

export const reportTemplates = pgTable('report_templates', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type', { enum: ['daily', 'weekly'] }).notNull(),
  fields: jsonb('fields').notNull(),
  isDefault: boolean('is_default').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  unique().on(t.userId, t.type),
  index('report_templates_user_type_idx').on(t.userId, t.type),
]);

export const dailyReviews = pgTable('daily_reviews', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  date: date('date').notNull(),
  templateId: text('template_id').references(() => reportTemplates.id, { onDelete: 'set null' }),
  templateSnapshot: jsonb('template_snapshot').notNull(),
  reportData: jsonb('report_data').notNull().default({}),
  tradeIds: jsonb('trade_ids').notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  unique().on(t.userId, t.date),
  index('daily_reviews_user_date_idx').on(t.userId, t.date),
]);

export const weeklyReviews = pgTable('weekly_reviews', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  weekStart: date('week_start').notNull(),
  weekEnd: date('week_end').notNull(),
  templateId: text('template_id').references(() => reportTemplates.id, { onDelete: 'set null' }),
  templateSnapshot: jsonb('template_snapshot').notNull(),
  reportData: jsonb('report_data').notNull().default({}),
  tradeIds: jsonb('trade_ids').notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  unique().on(t.userId, t.weekStart),
  index('weekly_reviews_user_week_idx').on(t.userId, t.weekStart),
]);

// Shared system-trades log from the team's Google Sheet — no userId, shared across all users
export const systemTickers = pgTable('system_tickers', {
  id: text('id').primaryKey(),
  ticker: text('ticker').notNull(),
  date: date('date').notNull(),
  grade: text('grade'),
  primaryAgenda: text('primary_agenda'),
  secondaryAgenda: text('secondary_agenda'),
  setupType: text('setup_type'),
  outcome: text('outcome'),
  tickerWinLoss: text('ticker_win_loss'),
  tickerR: doublePrecision('ticker_r'),
  triggerCount: integer('trigger_count'),
  day1GapPct: doublePrecision('day1_gap_pct'),
  attemptsJson: jsonb('attempts_json').notNull().default([]),
  rawJson: jsonb('raw_json').notNull(),
  importedAt: timestamp('imported_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique('system_tickers_ticker_date_unique').on(table.ticker, table.date),
  index('system_tickers_date_idx').on(table.date),
  index('system_tickers_ticker_idx').on(table.ticker),
]);

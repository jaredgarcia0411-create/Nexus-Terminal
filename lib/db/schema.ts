import { sql } from 'drizzle-orm';
import { pgTable, text, doublePrecision, integer, real, serial, timestamp, primaryKey, index, uniqueIndex, unique, foreignKey, jsonb, date, boolean } from 'drizzle-orm/pg-core';
import { randomUUID } from 'crypto';

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

// Reusable thesis options for the daily-review watchlist. Same shape as `tags` —
// each user has their own list of named theses they can pick from in a dropdown.
export const watchlistTheses = pgTable('watchlist_theses', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
}, (table) => [
  unique().on(table.userId, table.name),
  index('idx_watchlist_theses_user_id').on(table.userId),
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
  uniqueIndex('research_reports_in_progress_ticker_idx')
    .on(table.ticker)
    .where(sql`status = 'in_progress'`),
]);

// Shared cache for Ask Edgar API responses — no userId, shared across all users
export const askedgarCache = pgTable('askedgar_cache', {
  id: text('id').primaryKey(),
  cacheType: text('cache_type').notNull(),     // 'ticker' or 'scanner-summary'
  ticker: text('ticker').notNull(),             // uppercase ticker symbol
  dataJson: jsonb('data_json').notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (table) => [
  unique().on(table.cacheType, table.ticker),
  index('askedgar_cache_expires_idx').on(table.expiresAt),
]);

// Daily ticker usage for the AskEdgar daily-unique-ticker cap.
export const askedgarDailyTickers = pgTable('askedgar_daily_tickers', {
  date: date('date').notNull(),
  ticker: text('ticker').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.date, table.ticker] }),
  index('askedgar_daily_tickers_date_idx').on(table.date),
]);

// Singleton runtime state for AskEdgar retry windows across cold starts.
export const askedgarRuntimeState = pgTable('askedgar_runtime_state', {
  id: text('id').primaryKey(),
  rateLimitedUntil: timestamp('rate_limited_until', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const marketPulseDailyBars = pgTable('market_pulse_daily_bars', {
  tradeDate: date('trade_date').notNull(),
  ticker: text('ticker').notNull(),
  open: doublePrecision('open').notNull(),
  high: doublePrecision('high').notNull(),
  low: doublePrecision('low').notNull(),
  close: doublePrecision('close').notNull(),
  volume: doublePrecision('volume').notNull(),
  vwap: doublePrecision('vwap'),
  dollarVolume: doublePrecision('dollar_volume').notNull(),
  sourceTimestamp: timestamp('source_timestamp', { withTimezone: true }),
  sector: text('sector'),
  industry: text('industry'),
  country: text('country'),
  floatShares: doublePrecision('float_shares'),
  marketCap: doublePrecision('market_cap'),
  perf30d: doublePrecision('perf_30d'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.tradeDate, table.ticker] }),
  index('market_pulse_daily_bars_ticker_date_idx').on(table.ticker, table.tradeDate),
]);

export const marketPulseDailyStats = pgTable('market_pulse_daily_stats', {
  tradeDate: date('trade_date').primaryKey(),
  tickerCount: integer('ticker_count').notNull(),
  advancers: integer('advancers').notNull(),
  decliners: integer('decliners').notNull(),
  unchanged: integer('unchanged').notNull(),
  advancerPct: doublePrecision('advancer_pct').notNull(),
  declinerPct: doublePrecision('decliner_pct').notNull(),
  upVolume: doublePrecision('up_volume').notNull(),
  downVolume: doublePrecision('down_volume').notNull(),
  totalVolume: doublePrecision('total_volume').notNull(),
  medianChangePct: doublePrecision('median_change_pct'),
  avgChangePct: doublePrecision('avg_change_pct'),
  pctAbovePrevClose: doublePrecision('pct_above_prev_close'),
  pctAboveDollarVolumeFloor: doublePrecision('pct_above_dollar_volume_floor'),
  newHigh30dCount: integer('new_high_30d_count').notNull(),
  newLow30dCount: integer('new_low_30d_count').notNull(),
  rolling30Json: jsonb('rolling_30_json').notNull(),
  overview90Json: jsonb('overview_90_json'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('market_pulse_daily_stats_created_idx').on(table.createdAt),
]);

// SEC ticker -> CIK identity map. Hydrated from
// https://www.sec.gov/files/company_tickers_exchange.json with a 24h refresh.
// Shared across all users; no userId.
export const secTickerCik = pgTable('sec_ticker_cik', {
  ticker: text('ticker').primaryKey(),      // uppercase, share-class hyphenated (e.g. "BRK-B")
  cik: text('cik').notNull(),               // 10-digit zero-padded (e.g. "0000320193")
  name: text('name').notNull(),
  exchange: text('exchange'),               // "Nasdaq" | "NYSE" | "OTC" | null
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('sec_ticker_cik_fetched_idx').on(table.fetchedAt),
]);

// SEC companyfacts cache — full raw XBRL JSON keyed by CIK.
// ~3-5 MB per entry; Postgres TOAST handles compression automatically.
// TTL: 24h soft expiry enforced in lib/sec/companyfacts.ts.
export const secCompanyfactsCache = pgTable('sec_companyfacts_cache', {
  cik: text('cik').primaryKey(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).defaultNow().notNull(),
  payload: jsonb('payload').notNull(),
}, (table) => [
  index('sec_companyfacts_cache_fetched_idx').on(table.fetchedAt),
]);

// Cached filing primary-document HTML/text. Keyed by accession number
// (globally unique across SEC). TTL: 30 days soft expiry - filings are
// immutable once filed, so cache invalidation is purely a freshness concern
// for re-parsing if our parsers improve.
export const secFilingBodyCache = pgTable('sec_filing_body_cache', {
  accessionNumber: text('accession_number').primaryKey(),
  cik: text('cik').notNull(),
  formType: text('form_type').notNull(),
  filedAt: text('filed_at').notNull(),
  body: text('body').notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('sec_filing_body_cache_cik_form_idx').on(table.cik, table.formType),
  index('sec_filing_body_cache_fetched_idx').on(table.fetchedAt),
]);

// Raw SEC filing metadata keyed by accession number. This stores submissions
// metadata separately from body text and extracted event rows.
export const secFilingsRaw = pgTable('sec_filings_raw', {
  accessionNumber: text('accession_number').primaryKey(),
  cik: text('cik').notNull(),
  tickerRequested: text('ticker_requested').notNull(),
  tickerAtIngest: text('ticker_at_ingest'),
  formType: text('form_type').notNull(),
  filedAt: text('filed_at').notNull(),
  reportDate: text('report_date'),
  acceptanceDateTime: text('acceptance_datetime'),
  items: text('items'),
  primaryDocument: text('primary_document'),
  primaryDocDescription: text('primary_doc_description'),
  secUrl: text('sec_url'),
  archiveSource: text('archive_source'),
  metadataJson: jsonb('metadata_json').notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('sec_filings_raw_cik_filed_idx').on(table.cik, table.filedAt),
  index('sec_filings_raw_ticker_filed_idx').on(table.tickerRequested, table.filedAt),
  index('sec_filings_raw_form_idx').on(table.formType),
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

// Career P/L: one row per (user, calendar month). The `month` column is a date
// pinned to the 1st of the month (e.g. 2026-05-01) so years are tracked
// implicitly — June 2026 and June 2027 are separate rows.
export const careerPnlEntries = pgTable('career_pnl_entries', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  month: date('month').notNull(),
  amount: doublePrecision('amount').notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  unique().on(t.userId, t.month),
  index('career_pnl_user_month_idx').on(t.userId, t.month),
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

export const sampleSets = pgTable('sample_sets', {
  id: text('id').primaryKey().$defaultFn(() => randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  rows: jsonb('rows').$type<Array<{ ticker: string; date: string }>>().notNull().default([]),
  rowCount: integer('row_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('sample_sets_user_created_idx').on(t.userId, t.createdAt),
  uniqueIndex('sample_sets_user_name_idx').on(t.userId, t.name),
]);

export const backtests = pgTable('backtests', {
  id: text('id').primaryKey().$defaultFn(() => randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  sampleSetId: text('sample_set_id').references(() => sampleSets.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('backtests_user_created_idx').on(t.userId, t.createdAt),
  uniqueIndex('backtests_user_name_idx').on(t.userId, t.name),
]);

export const backtestSessions = pgTable('backtest_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  ticker: text('ticker').notNull(),
  date: date('date').notNull(),
  status: text('status', { enum: ['ACTIVE', 'REVIEWED'] }).notNull().default('ACTIVE'),
  riskDollars: doublePrecision('risk_dollars').notNull(),
  label: text('label'),
  notes: text('notes'),
  chartState: jsonb('chart_state').default({}).notNull(),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  backtestId: text('backtest_id').references(() => backtests.id, { onDelete: 'set null' }),
}, (t) => [
  unique('backtest_sessions_user_id_id_unique').on(t.userId, t.id),
  index('backtest_sessions_user_ticker_date_idx').on(t.userId, t.ticker, t.date),
  index('backtest_sessions_user_status_idx').on(t.userId, t.status),
  index('backtest_sessions_user_backtest_idx').on(t.userId, t.backtestId),
]);

export const backtestActions = pgTable('backtest_actions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  sessionId: text('session_id').notNull(),
  actionType: text('action_type', {
    enum: ['LONG', 'LONG_ADD', 'SELL', 'SHORT', 'SHORT_ADD', 'COVER'],
  }).notNull(),
  price: doublePrecision('price').notNull(),
  shares: doublePrecision('shares').notNull(),
  stopPrice: doublePrecision('stop_price'),
  barTime: text('bar_time').notNull(),
  sequence: integer('sequence').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  foreignKey({
    columns: [t.userId, t.sessionId],
    foreignColumns: [backtestSessions.userId, backtestSessions.id],
  }).onDelete('cascade'),
  index('backtest_actions_user_session_seq_idx').on(t.userId, t.sessionId, t.sequence),
]);

// MDR scanner triggers — one row per ticker per trigger date.
// Populated by the nightly cron (/api/cron/mdr-sweep) and read by
// /api/scanner/mdr-recent. Shared across all users; no userId.
//
// invalidated_at is set by the cron when a single -10% red day fires
// after the trigger date. The dashboard filters out invalidated rows.
//
// PK is (ticker, trigger_date) so a ticker that re-triggers on a later
// day gets a new row.
export const mdrTriggers = pgTable('mdr_triggers', {
  ticker: text('ticker').notNull(),
  triggerDate: date('trigger_date').notNull(),
  triggerClose: doublePrecision('trigger_close').notNull(),
  payload: jsonb('payload').notNull(),
  invalidatedAt: timestamp('invalidated_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  primaryKey({ columns: [t.ticker, t.triggerDate] }),
  index('mdr_triggers_trigger_date_idx').on(t.triggerDate),
  index('mdr_triggers_active_idx').on(t.invalidatedAt, t.triggerDate),
]);

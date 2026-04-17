import type { AgentDb } from './db';

export type AgentId = 'orchestrator' | 'small-cap-trader' | 'swing-trader';

export type JobType =
  | 'chat'
  | 'research'
  | 'macro-summary'
  | 'pre-market-scan'
  | 'momentum-scan'
  | 'pattern-check';

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export type ReportStatus = 'published' | 'delivery_failed' | 'archived';

export type TrafficLight = 'green' | 'yellow' | 'red';

export interface GapStatsRow {
  date: string;
  gapPct: number;
  open: number;
  close: number;
}

export type Confidence = 'high' | 'medium' | 'low';

export interface TrafficLightSection {
  rating: TrafficLight;
  explanation: string;
}

export interface RatedCatalyst {
  catalyst: string;
  rating: TrafficLight;
}

export interface SmallCapResearchReport {
  ticker: string;
  newsWhyRunning: TrafficLightSection;
  themeMatch: TrafficLightSection;
  otherCatalysts: RatedCatalyst[];
  chartHistory: TrafficLightSection;
  dilution: TrafficLightSection;
  offeringFrequency: TrafficLightSection;
  offeringAbility: TrafficLightSection;
  cashNeed: TrafficLightSection;
  overallOfferingRisk: TrafficLightSection;
  jmt415Commentary: string | null;
  historicalStats: string;
  gapStatsTable: GapStatsRow[];
  financialCommentary: { rating: TrafficLight; explanation: string };
  confidence: Confidence;
  evidenceIds: string[];
}

export interface SwingResearchReport {
  ticker: string;
  mdrPatternMatch: TrafficLightSection & { mdrSimilarity: number };
  momentum: TrafficLightSection;
  catalyst: TrafficLightSection;
  patternClassification: 'BREAKOUT' | 'EXHAUSTION' | 'CONTINUATION' | 'STOPPED';
  recommendation: {
    action: 'HOLD' | 'ADD' | 'TRIM' | 'EXIT' | 'WATCH';
    reasoning: string;
  };
  volumeProfile: TrafficLightSection;
  gapStatsTable: GapStatsRow[];
  financialCommentary: { rating: TrafficLight; explanation: string };
  confidence: Confidence;
  evidenceIds: string[];
}

export interface SentimentDataPoint {
  score: number;
  classification: string;
  source: string;
}

export interface MacroSource {
  id: string;
  title: string;
  url: string | null;
  fetchedAt: string;
}

export interface MacroDriver {
  driver: string;
  impact: 'positive' | 'negative' | 'mixed';
  sourceRefs: string[];
}

export interface CrossAssetEntry {
  ticker: string;
  price: number | null;
  changePercent: number | null;
}

export interface FredDataPoint {
  seriesId: string;
  label: string;
  date: string;
  value: number | null;
}

export interface KeyLevel {
  ticker: string;
  support: string;
  resistance: string;
  note: string;
}

export interface ScheduledCatalyst {
  event: string;
  date: string | null;
  expectedImpact: string;
}

export interface ScenarioAnalysis {
  consensus: string;
  disruption: string;
}

export interface MacroSummaryReport {
  tradingDate: string;
  marketBias: 'bullish' | 'bearish' | 'neutral';
  summary: string;
  riskAssessment: string;
  drivers: MacroDriver[];
  crossAssetSnapshot: CrossAssetEntry[];
  keyLevels: KeyLevel[];
  ratesOutlook: string;
  fredData: FredDataPoint[];
  sentimentData?: SentimentDataPoint;
  scheduledCatalysts: ScheduledCatalyst[];
  sectorRotation: string[];
  scenarioAnalysis: ScenarioAnalysis;
  deskImplications: string[];
  sourceIndex: MacroSource[];
  confidence: Confidence;
  tldr: string[];
  deltas?: string[];
}

export type StepType = 'code' | 'llm';

export type LlmLane = 'interactive' | 'background';

export type FailureClass =
  | 'transient'
  | 'input-quality'
  | 'contract'
  | 'dependency'
  | 'policy';

export type StepStatus =
  | 'queued'
  | 'running'
  | 'validated'
  | 'retrying'
  | 'blocked'
  | 'failed'
  | 'escalated'
  | 'completed';

export type MemoryCategory =
  | 'fact'
  | 'thesis'
  | 'watchlist'
  | 'scan_param'
  | 'performance'
  | 'trade_insight'
  | 'user_preference'
  | 'strategy_note'
  | 'macro_fact'
  | 'pattern'
  | 'sentiment';

export const V1_AGENT_IDS: AgentId[] = [
  'orchestrator',
  'small-cap-trader',
  'swing-trader',
];

export interface LlmRequest {
  systemPrompt: string;
  userMessage: string;
  temperature?: number;
  model?: string;
  maxTokens?: number;
}

export interface LlmResponse {
  content: string;
  modelUsed: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

export interface LlmLaneConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

export interface LlmBudgetConfig {
  dailyBudgetCents: number;
  monthlyBudgetCents: number;
  maxContextTokens: number;
  maxScanCandidates: number;
  maxPatternHistoryItems: number;
  maxRetriesPerStep: number;
}

export interface StepMetadata {
  canRetry: boolean;
  timeoutMs: number;
  maxRepairAttempts: number;
  sideEffect: boolean;
  idempotencyKey?: string;
  lane?: LlmLane;
  skipWhenRouted?: boolean;
}

export interface StepProvenance {
  sourceIds: string[];
  model?: string;
  promptVersion?: string;
  upstreamStepIds: string[];
  timestamp: string;
}

export interface StepResult<T = unknown> {
  status: StepStatus;
  data: T;
  artifacts?: Record<string, unknown>;
  metrics: {
    durationMs: number;
    tokensUsed?: number;
    attempt: number;
  };
  provenance: StepProvenance;
  validator?: {
    passed: boolean;
    errors?: string[];
    failureClass?: FailureClass;
  };
}

export interface StepInput {
  jobInput: unknown;
  previousOutput: unknown;
  memory: AgentMemoryRow[];
  context: AgentContext;
  job: AgentJob;
  db: AgentDb;
  agentConfig: AgentConfig;
}

export interface BlueprintStep {
  name: string;
  type: StepType;
  metadata: StepMetadata;
  inputSchema?: unknown;
  outputSchema?: unknown;
  run: (input: StepInput) => Promise<StepResult>;
}

export interface Blueprint {
  id: string;
  description: string;
  steps: BlueprintStep[];
}

export interface StepLogEntry {
  step: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  attempt: number;
  validatorResult?: 'pass' | 'fail';
  tokensUsed?: number;
  errorClass?: string;
}

export interface AgentJob {
  id: string;
  agentId: AgentId;
  userId: string;
  jobType: JobType;
  status: JobStatus;
  priority: number;
  input: unknown;
  result: unknown | null;
  errorMessage: string | null;
  progressNote: string | null;
  stepLog: StepLogEntry[];
  attempt: number;
  maxAttempts: number;
  nextRetryAt: Date | null;
  lockedBy: string | null;
  lockExpiresAt: Date | null;
  lastHeartbeatAt: Date | null;
  leaseVersion: number;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface AgentReport {
  id: string;
  agentId: AgentId;
  userId: string;
  jobId: string | null;
  reportType: string;
  title: string;
  summary: string | null;
  reportJson: unknown;
  status: ReportStatus;
  deliveryChannel: string;
  deliveredAt: Date | null;
  deliveryError: string | null;
  createdAt: Date;
}

export interface ReportApiResponse {
  id: string;
  agent_id: AgentId;
  report_type: string;
  title: string;
  summary: string | null;
  status: ReportStatus;
  delivery_error: string | null;
  created_at: string | null;
  report_json: SmallCapResearchReport | SwingResearchReport | MacroSummaryReport | unknown;
}

export interface AgentMemoryRow {
  id: string;
  userId: string;
  agentId: AgentId;
  category: MemoryCategory;
  key: string;
  value: string;
  valueJson: unknown | null;
  source: string | null;
  confidence: string | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
}

export interface AgentContext {
  recentTrades: unknown[];
  macroSummary: MacroSummaryReport | null;
  memory: AgentMemoryRow[];
  conversationHistory: unknown[];
}

export interface AgentConfig {
  id: AgentId;
  displayName: string;
  llmLane: LlmLane;
  modelOverride?: string;
  temperature?: number;
  capabilities: JobType[];
  rolePromptPath: string;
  blueprints: Record<string, Blueprint>;
  blueprintResolver: (job: AgentJob) => Blueprint;
}

export interface WorkerConfig {
  agentId: AgentId;
  pollIntervalMs: number;
}

export interface TokenTrackingEntry {
  userId: string;
  agentId: AgentId;
  mode: string;
  lane: LlmLane;
  modelUsed: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostCents: number;
  durationMs: number;
  success: boolean;
}

export interface CircuitBreakerState {
  consecutiveFailures: number;
  openedAt: string | null;
}

export interface AdminStatsResponse {
  circuitBreakers: Record<string, {
    status: 'closed' | 'open' | 'half-open';
    consecutiveFailures: number;
    lastFailureAt: string | null;
  }>;
  today: {
    totalRequests: number;
    totalTokens: number;
    estimatedCostCents: number;
    successRate: number;
    avgDurationMs: number;
    validationFailureRate: number;
    retryRate: number;
    byLane: Record<string, {
      totalRequests: number;
      totalTokens: number;
      estimatedCostCents: number;
      successRate: number;
      avgDurationMs: number;
    }>;
    byAgent: Record<string, {
      totalRequests: number;
      totalTokens: number;
      estimatedCostCents: number;
      successRate: number;
      avgDurationMs: number;
    }>;
  };
  thisMonth: {
    totalTokens: number;
    estimatedCostCents: number;
    budgetCents: number;
    budgetUsedPercent: number;
  };
  agents: Array<{
    id: string;
    displayName: string;
    status: string;
    lastHeartbeat: string | null;
  }>;
  delivery: {
    publishedToday: number;
    deliveryFailures: number;
    deliveryFailureRate: number;
  };
  memory: {
    total: number;
    byCategory: Record<string, number>;
  };
  macroSummaries: {
    latestGeneratedAt: string | null;
  };
  queue: {
    depth: number;
    oldestQueuedJobAgeSeconds: number | null;
    stuckProcessing: number;
  };
}

export interface QueueClaimResult {
  job: AgentJob;
  leaseVersion: number;
}

export class BlueprintValidationError extends Error {
  constructor(
    public stepName: string,
    public location: 'input' | 'output',
    public zodError: unknown,
  ) {
    super(`Validation failed at ${stepName} (${location})`);
  }
}

export class NotImplementedBlueprintError extends Error {
  constructor(public blueprintName: string) {
    super(`blueprint not implemented in Sprint 3: ${blueprintName}`);
    this.name = 'NotImplementedBlueprintError';
  }
}

export class BudgetExceededError extends Error {
  constructor(
    public agentId: AgentId,
    public limitType: 'daily' | 'monthly',
  ) {
    super(`${limitType} budget exceeded for ${agentId}`);
  }
}

export class RateLimitExceededError extends Error {
  constructor(public agentId: AgentId, public userId: string) {
    super(`rate limit exceeded for user ${userId}`);
    this.name = 'RateLimitExceededError';
  }
}

export class CircuitOpenError extends Error {
  constructor(public agentId: AgentId, public openedAt: string) {
    super(`circuit breaker open for ${agentId} since ${openedAt}`);
    this.name = 'CircuitOpenError';
  }
}

import { z } from 'zod';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const backtestActionTypes = ['LONG', 'LONG_ADD', 'SELL', 'SHORT', 'SHORT_ADD', 'COVER'] as const;

export const backtestSessionUpsertSchema = z.object({
  ticker: z.string().trim().min(1, 'ticker is required').max(20, 'ticker must be 20 characters or fewer').transform((value) => value.toUpperCase()),
  date: z.string().trim().regex(ISO_DATE_RE, 'date must be YYYY-MM-DD'),
  riskDollars: z.number().positive('riskDollars must be positive'),
  backtestId: z.string().trim().nullable().optional(),
});

export type BacktestSessionUpsertBody = z.infer<typeof backtestSessionUpsertSchema>;

export const backtestActionCreateSchema = z.object({
  sessionId: z.string().trim().min(1, 'sessionId is required'),
  actionType: z.enum(backtestActionTypes),
  price: z.number().positive('price must be positive'),
  shares: z.number().positive('shares must be positive'),
  stopPrice: z.number().positive('stopPrice must be positive').nullable(),
  barTime: z.string().trim().min(1, 'barTime is required'),
});

export type BacktestActionCreateBody = z.infer<typeof backtestActionCreateSchema>;

export const chartStateSchema = z.object({
  drawings: z.array(z.unknown()).optional(),
  indicators: z.record(z.string(), z.array(z.string())).optional(),
}).strict();

export type ChartStateBody = z.infer<typeof chartStateSchema>;

export const backtestSessionReviewSchema = z.object({
  sessionId: z.string().trim().min(1, 'sessionId is required'),
  label: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  chartState: chartStateSchema.optional(),
});

export type BacktestSessionReviewBody = z.infer<typeof backtestSessionReviewSchema>;

import { z } from 'zod';

const stageSchema = z.record(z.string(), z.union([z.string(), z.number(), z.null()]));

const attemptSchema = z.object({
  attemptIndex: z.number().int().min(1).max(4),
  triggerType: z.string().nullable(),
  starter: stageSchema,
  fmTrig: stageSchema,
  fmTrigSub30: stageSchema,
  popVwap: stageSchema,
  fmCloseSubPiv: stageSchema,
  exit: stageSchema,
});

export const systemSheetRowSchema = z.object({
  ticker: z.string().trim().min(1).max(20),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be ISO yyyy-MM-dd'),
  grade: z.string().nullable(),
  primaryAgenda: z.string().nullable(),
  secondaryAgenda: z.string().nullable(),
  setupType: z.string().nullable(),
  outcome: z.string().nullable(),
  tickerWinLoss: z.string().nullable(),
  tickerR: z.number().nullable(),
  triggerCount: z.number().int().nullable(),
  day1GapPct: z.number().nullable(),
  attempts: z.array(attemptSchema).max(4),
  rawJson: z.record(z.string(), z.union([z.string(), z.null()])),
});

export const systemSheetSyncBodySchema = z.object({
  rows: z.array(systemSheetRowSchema).min(1).max(5000),
});

export type SystemSheetSyncBody = z.infer<typeof systemSheetSyncBodySchema>;
export type SystemSheetRow = z.infer<typeof systemSheetRowSchema>;

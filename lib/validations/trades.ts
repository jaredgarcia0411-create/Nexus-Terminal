import { z } from 'zod';

const executionSchema = z.object({
  id: z.string(),
  side: z.enum(['ENTRY', 'EXIT']),
  price: z.number().finite(),
  qty: z.number().finite().positive(),
  time: z.string().min(1),
  timestamp: z.union([z.string(), z.date()]).optional(),
  commission: z.number().finite().optional().default(0),
  fees: z.number().finite().optional().default(0),
});

export const createTradeSchema = z.object({
  id: z.string().min(1),
  date: z.string().min(1),
  sortKey: z.string().min(1),
  symbol: z.string().min(1),
  direction: z.enum(['LONG', 'SHORT']),
  avgEntryPrice: z.number().finite().optional().default(0),
  avgExitPrice: z.number().finite().optional().default(0),
  totalQuantity: z.number().finite().optional().default(0),
  grossPnl: z.number().finite().optional(),
  netPnl: z.number().finite().optional(),
  pnl: z.number().finite().optional(),
  entryTime: z.string().optional().default(''),
  exitTime: z.string().optional().default(''),
  executionCount: z.number().int().optional(),
  executions: z.number().int().optional(),
  rawExecutions: z.array(executionSchema).optional(),
  mfe: z.number().finite().nullable().optional(),
  mae: z.number().finite().nullable().optional(),
  bestExitPnl: z.number().finite().nullable().optional(),
  exitEfficiency: z.number().finite().nullable().optional(),
  initialRisk: z.number().finite().nullable().optional(),
  commission: z.number().finite().optional().default(0),
  fees: z.number().finite().optional().default(0),
  notes: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
});

export type CreateTradeInput = z.infer<typeof createTradeSchema>;

export const updateTradeSchema = z.object({
  notes: z.string().optional(),
  initialRisk: z.number().finite().nullable().optional(),
  tags: z.array(z.string()).optional(),
});

export type UpdateTradeInput = z.infer<typeof updateTradeSchema>;

export const bulkTradeSchema = z.object({
  action: z.enum(['delete', 'applyRisk', 'addTag']),
  ids: z.array(z.string().min(1)).min(1, 'ids are required'),
  value: z.union([z.number(), z.string()]).optional(),
});

export type BulkTradeInput = z.infer<typeof bulkTradeSchema>;

export const importTradeItemSchema = z.object({
  id: z.string().min(1),
  date: z.string().min(1),
  sortKey: z.string().min(1),
  symbol: z.string().min(1),
  direction: z.enum(['LONG', 'SHORT']),
  avgEntryPrice: z.number().finite(),
  avgExitPrice: z.number().finite(),
  totalQuantity: z.number().finite(),
  grossPnl: z.number().finite().optional(),
  netPnl: z.number().finite().optional(),
  pnl: z.number().finite().optional(),
  entryTime: z.string().optional().default(''),
  exitTime: z.string().optional().default(''),
  executionCount: z.number().int().optional(),
  executions: z.number().int().optional(),
  rawExecutions: z.array(executionSchema).optional(),
  mfe: z.number().finite().nullable().optional(),
  mae: z.number().finite().nullable().optional(),
  bestExitPnl: z.number().finite().nullable().optional(),
  exitEfficiency: z.number().finite().nullable().optional(),
  initialRisk: z.number().finite().nullable().optional(),
  commission: z.number().finite().optional().default(0),
  fees: z.number().finite().optional().default(0),
  notes: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
});

export const importTradesSchema = z.object({
  trades: z.array(importTradeItemSchema).min(1, 'trades array must not be empty'),
  batchKey: z.string().max(256).optional(),
});

export type ImportTradesInput = z.infer<typeof importTradesSchema>;

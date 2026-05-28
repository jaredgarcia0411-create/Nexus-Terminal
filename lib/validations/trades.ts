import { z } from 'zod';

const executionSchema = z.object({
  id: z.string().min(1).max(256),
  side: z.enum(['ENTRY', 'EXIT']),
  price: z.number().finite(),
  qty: z.number().finite().positive(),
  time: z.string().min(1).max(50),
  timestamp: z.union([z.string().max(50), z.date()]).optional(),
  commission: z.number().finite().optional().default(0),
  fees: z.number().finite().optional().default(0),
});

export const createTradeSchema = z.object({
  id: z.string().min(1).max(256),
  date: z.string().min(1).max(50),
  sortKey: z.string().min(1).max(20),
  symbol: z.string().min(1).max(20),
  direction: z.enum(['LONG', 'SHORT']),
  avgEntryPrice: z.number().finite().optional().default(0),
  avgExitPrice: z.number().finite().optional().default(0),
  totalQuantity: z.number().finite().optional().default(0),
  grossPnl: z.number().finite().optional(),
  netPnl: z.number().finite().optional(),
  pnl: z.number().finite().optional(),
  entryTime: z.string().max(50).optional().default(''),
  exitTime: z.string().max(50).optional().default(''),
  executionCount: z.number().int().optional(),
  executions: z.number().int().optional(),
  rawExecutions: z.array(executionSchema).max(5000).optional(),
  mfe: z.number().finite().nullable().optional(),
  mae: z.number().finite().nullable().optional(),
  bestExitPnl: z.number().finite().nullable().optional(),
  exitEfficiency: z.number().finite().nullable().optional(),
  initialRisk: z.number().finite().nullable().optional(),
  commission: z.number().finite().optional().default(0),
  fees: z.number().finite().optional().default(0),
  notes: z.string().max(10000).nullable().optional(),
  tags: z.array(z.string().max(200)).max(100).optional(),
  isOpen: z.boolean().optional().default(false),
  closedAt: z.string().max(50).nullable().optional(),
  remainingQty: z.number().finite().optional().default(0),
});

export type CreateTradeInput = z.infer<typeof createTradeSchema>;

export const updateTradeSchema = z.object({
  notes: z.string().max(10000).optional(),
  initialRisk: z.number().finite().nullable().optional(),
  tags: z.array(z.string().max(200)).max(100).optional(),
});

export type UpdateTradeInput = z.infer<typeof updateTradeSchema>;

export const bulkTradeSchema = z.object({
  action: z.enum(['delete', 'applyRisk', 'addTag']),
  ids: z.array(z.string().min(1).max(256)).max(500).min(1, 'ids are required'),
  value: z.union([z.number().finite(), z.string().max(200)]).optional(),
});

export type BulkTradeInput = z.infer<typeof bulkTradeSchema>;

export const importTradeItemSchema = z.object({
  id: z.string().min(1).max(256),
  date: z.string().min(1).max(50),
  sortKey: z.string().min(1).max(20),
  symbol: z.string().min(1).max(20),
  direction: z.enum(['LONG', 'SHORT']),
  avgEntryPrice: z.number().finite(),
  avgExitPrice: z.number().finite(),
  totalQuantity: z.number().finite(),
  grossPnl: z.number().finite().optional(),
  netPnl: z.number().finite().optional(),
  pnl: z.number().finite().optional(),
  entryTime: z.string().max(50).optional().default(''),
  exitTime: z.string().max(50).optional().default(''),
  executionCount: z.number().int().optional(),
  executions: z.number().int().optional(),
  rawExecutions: z.array(executionSchema).max(5000).optional(),
  mfe: z.number().finite().nullable().optional(),
  mae: z.number().finite().nullable().optional(),
  bestExitPnl: z.number().finite().nullable().optional(),
  exitEfficiency: z.number().finite().nullable().optional(),
  initialRisk: z.number().finite().nullable().optional(),
  commission: z.number().finite().optional().default(0),
  fees: z.number().finite().optional().default(0),
  notes: z.string().max(10000).nullable().optional(),
  tags: z.array(z.string().max(200)).max(100).optional(),
  isOpen: z.boolean().optional().default(false),
  closedAt: z.string().max(50).nullable().optional(),
  remainingQty: z.number().finite().optional().default(0),
});

export const importTradesSchema = z.object({
  trades: z.array(importTradeItemSchema).max(5000).min(1, 'trades array must not be empty'),
  batchKey: z.string().max(256).optional(),
});

export type ImportTradesInput = z.infer<typeof importTradesSchema>;

export const closePositionSchema = z.object({
  action: z.literal('close'),
  exitPrice: z.number().finite().positive(),
  exitTime: z.string().min(1).max(50),
});

export type ClosePositionInput = z.infer<typeof closePositionSchema>;

export const mergeTradesSchema = z.object({
  ids: z.array(z.string().min(1).max(256)).max(500).min(2, 'Select at least 2 trades to merge'),
});

export type MergeTradesInput = z.infer<typeof mergeTradesSchema>;

export const coverPositionSchema = z.object({
  symbol: z.string().trim().min(1).max(20).transform((value) => value.toUpperCase()),
  coverDirection: z.enum(['LONG', 'SHORT']),
  price: z.number().finite().positive(),
  qty: z.number().int().positive(),
  time: z.string().min(1).max(50),
  date: z.string().min(1).max(20),
  sortKey: z.string().min(1).max(20),
});

export type CoverPositionInput = z.infer<typeof coverPositionSchema>;

export const importRawSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  executions: z.array(z.object({
    symbol: z.string().min(1).max(20),
    side: z.enum(['LONG_ENTRY', 'LONG_EXIT', 'SHORT_ENTRY', 'SHORT_EXIT']),
    qty: z.number().finite().positive(),
    price: z.number().finite(),
    time: z.string().min(1).max(50),
    commission: z.number().finite().optional().default(0),
    fees: z.number().finite().optional().default(0),
  })).max(5000).min(1, 'executions must not be empty'),
  batchKey: z.string().max(256).optional(),
});

export type ImportRawInput = z.infer<typeof importRawSchema>;

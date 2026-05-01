import { z } from 'zod';

export const backtestCreateSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(100, 'name must be 100 characters or fewer'),
  description: z.string().trim().optional(),
  sampleSetId: z.string().trim().optional(),
});

export const backtestPatchSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().nullable().optional(),
  sampleSetId: z.string().trim().nullable().optional(),
});

export type BacktestCreateBody = z.infer<typeof backtestCreateSchema>;
export type BacktestPatchBody = z.infer<typeof backtestPatchSchema>;

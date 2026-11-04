import { z } from 'zod';

export const backtestCreateSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(100, 'name must be 100 characters or fewer'),
  description: z.string().trim().max(2000).optional(),
  sampleSetId: z.string().trim().max(128).optional(),
});

export const backtestPatchSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  sampleSetId: z.string().trim().max(128).nullable().optional(),
});

export type BacktestCreateBody = z.infer<typeof backtestCreateSchema>;
export type BacktestPatchBody = z.infer<typeof backtestPatchSchema>;

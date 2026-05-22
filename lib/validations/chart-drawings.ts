import { z } from 'zod';

export const chartBucketSchema = z.enum(['intraday', 'higher']);
export type ChartBucket = z.infer<typeof chartBucketSchema>;

export const chartDrawingsQuerySchema = z.object({
  ticker: z.string().trim().min(1).max(20).transform((value) => value.toUpperCase()),
  bucket: chartBucketSchema,
});

export const chartDrawingsPutSchema = z.object({
  drawings: z.array(z.unknown()),
  indicators: z.record(z.string(), z.array(z.string())),
});

export type ChartDrawingsPutBody = z.infer<typeof chartDrawingsPutSchema>;

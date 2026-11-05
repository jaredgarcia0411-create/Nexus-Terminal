import { z } from 'zod';

export const chartBucketSchema = z.enum(['intraday', 'higher']);
export type ChartBucket = z.infer<typeof chartBucketSchema>;

export const chartDrawingsQuerySchema = z.object({
  ticker: z.string().trim().min(1).max(20).transform((value) => value.toUpperCase()),
  bucket: chartBucketSchema,
});

export const chartDrawingsPutSchema = z.object({
  drawings: z.array(z.unknown()).max(2000),
  indicators: z.record(z.string().max(100), z.array(z.string().max(100)).max(50)),
});

export type ChartDrawingsPutBody = z.infer<typeof chartDrawingsPutSchema>;

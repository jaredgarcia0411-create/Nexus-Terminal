import { z } from 'zod';

export const tagBodySchema = z.object({
  name: z.string().trim().optional(),
});

export type TagBody = z.infer<typeof tagBodySchema>;

export const presetBodySchema = z.object({
  name: z.string().trim().optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
});

export type PresetBody = z.infer<typeof presetBodySchema>;

export const savedTickerBodySchema = z.object({
  ticker: z.string().trim().optional(),
  category: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

export type SavedTickerBody = z.infer<typeof savedTickerBodySchema>;

export const dailySummaryBodySchema = z.object({
  ticker: z.string().trim().optional(),
  date: z.string().trim().optional(),
  startDate: z.string().trim().optional(),
  endDate: z.string().trim().optional(),
});

export type DailySummaryBody = z.infer<typeof dailySummaryBodySchema>;

export const adminMemoryDeleteBodySchema = z.object({
  userId: z.string().trim().optional(),
  category: z.string().trim().optional(),
  all: z.boolean().optional(),
});

export type AdminMemoryDeleteBody = z.infer<typeof adminMemoryDeleteBodySchema>;

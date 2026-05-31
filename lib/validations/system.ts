import { z } from 'zod';

export const tagBodySchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(200),
});

export type TagBody = z.infer<typeof tagBodySchema>;

export const renameTagBodySchema = z.object({
  from: z.string().trim().min(1, 'from is required').max(200),
  to: z.string().trim().min(1, 'to is required').max(200),
});

export type RenameTagBody = z.infer<typeof renameTagBodySchema>;

export const presetBodySchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(100, 'name must be 100 characters or fewer'),
  filters: z.record(z.string(), z.unknown()).optional(),
});

export type PresetBody = z.infer<typeof presetBodySchema>;

export const savedTickerBodySchema = z.object({
  ticker: z.string().trim().min(1, 'ticker is required'),
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

// Career P/L: client sends `month` as ISO date (YYYY-MM-DD), `amount` as a
// finite number (positive or negative), `notes` optional. We coerce the date
// to the 1st of the month server-side so the unique constraint can dedupe.
export const careerPnlBodySchema = z.object({
  month: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'month must be YYYY-MM-DD'),
  amount: z.number().finite(),
  notes: z.string().trim().max(2000).optional(),
});

export type CareerPnlBody = z.infer<typeof careerPnlBodySchema>;

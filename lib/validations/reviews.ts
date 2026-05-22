import { z } from 'zod';

export const templateFieldSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(['bool', 'text', 'number', 'enum', 'auto']),
  required: z.boolean(),
  options: z.array(z.string()).optional(),
});

export type TemplateField = z.infer<typeof templateFieldSchema>;

export const upsertTemplateSchema = z.object({
  type: z.enum(['daily', 'weekly', 'playbook']),
  fields: z.array(templateFieldSchema).min(1),
});

export type UpsertTemplateInput = z.infer<typeof upsertTemplateSchema>;

export const upsertDailyReviewSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  templateId: z.string().nullable().optional(),
  templateSnapshot: z.array(templateFieldSchema).min(1),
  reportData: z.record(z.string(), z.unknown()),
  tradeIds: z.array(z.string()),
});

export type UpsertDailyReviewInput = z.infer<typeof upsertDailyReviewSchema>;

export const upsertWeeklyReviewSchema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weekEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  templateId: z.string().nullable().optional(),
  templateSnapshot: z.array(templateFieldSchema).min(1),
  reportData: z.record(z.string(), z.unknown()),
  tradeIds: z.array(z.string()),
});

export type UpsertWeeklyReviewInput = z.infer<typeof upsertWeeklyReviewSchema>;

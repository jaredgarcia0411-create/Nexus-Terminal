import { z } from 'zod';

export const templateFieldSchema = z.object({
  id: z.string().min(1).max(256),
  label: z.string().min(1).max(200),
  type: z.enum(['bool', 'text', 'number', 'enum', 'auto']),
  required: z.boolean(),
  options: z.array(z.string().max(200)).max(50).optional(),
});

export type TemplateField = z.infer<typeof templateFieldSchema>;

export const upsertTemplateSchema = z.object({
  type: z.enum(['daily', 'weekly', 'playbook']),
  fields: z.array(templateFieldSchema).min(1).max(200),
});

export type UpsertTemplateInput = z.infer<typeof upsertTemplateSchema>;

export const upsertDailyReviewSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  templateId: z.string().max(256).nullable().optional(),
  templateSnapshot: z.array(templateFieldSchema).min(1).max(200),
  reportData: z.record(z.string(), z.unknown()),
  tradeIds: z.array(z.string().max(256)).max(2000),
});

export type UpsertDailyReviewInput = z.infer<typeof upsertDailyReviewSchema>;

export const upsertWeeklyReviewSchema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weekEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  templateId: z.string().max(256).nullable().optional(),
  templateSnapshot: z.array(templateFieldSchema).min(1).max(200),
  reportData: z.record(z.string(), z.unknown()),
  tradeIds: z.array(z.string().max(256)).max(2000),
});

export type UpsertWeeklyReviewInput = z.infer<typeof upsertWeeklyReviewSchema>;

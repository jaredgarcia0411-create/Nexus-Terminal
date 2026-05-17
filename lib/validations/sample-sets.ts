import { z } from 'zod';

const sampleSetRowSchema = z.object({
  ticker: z.string().trim().min(1).transform((value) => value.toUpperCase()),
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
});

export const sampleSetCreateSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(100, 'name must be 100 characters or fewer'),
  rows: z.array(sampleSetRowSchema).min(1, 'rows must not be empty'),
});

export const sampleSetPatchSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  appendRows: z.array(sampleSetRowSchema).min(1).optional(),
});

export const sampleSetDuplicateSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(100),
});

export const sampleSetFromTagsSchema = z.object({
  tags: z.array(z.string().trim().min(1)).min(1, 'at least one tag is required').max(20),
});

export type SampleSetCreateBody = z.infer<typeof sampleSetCreateSchema>;
export type SampleSetPatchBody = z.infer<typeof sampleSetPatchSchema>;
export type SampleSetDuplicateBody = z.infer<typeof sampleSetDuplicateSchema>;
export type SampleSetFromTagsBody = z.infer<typeof sampleSetFromTagsSchema>;

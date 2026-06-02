import { z } from 'zod';

export const SHEET_COLUMN_TYPES = [
  'text',
  'number',
  'date',
  'url',
  'checkbox',
  'select',
  'report',
  'chart',
  'action',
  'watchlist',
] as const;

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const columnSchema = z.object({
  key: z.string().trim().regex(/^[a-z0-9_]{1,40}$/, 'key must be lowercase letters, numbers, or underscores'),
  name: z.string().trim().min(1).max(60),
  type: z.enum(SHEET_COLUMN_TYPES),
  width: z.number().int().min(40).max(800).optional(),
  options: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
  locked: z.boolean().optional(),
});

const rowValuesSchema = z
  .record(z.string(), z.unknown())
  .refine((value) => Object.keys(value).length <= 60, 'a row may have at most 60 fields');

export const sheetCreateSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(100),
  isTemplate: z.boolean().optional(),
  sheetDate: z.string().trim().regex(DATE_REGEX, 'sheetDate must be YYYY-MM-DD').optional(),
  columns: z.array(columnSchema).max(40).optional(),
});

export const sheetPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    sheetDate: z.string().trim().regex(DATE_REGEX).nullable().optional(),
    isTemplate: z.boolean().optional(),
    archived: z.boolean().optional(),
    columns: z.array(columnSchema).max(40).optional(),
    columnsVersion: z.number().int().min(0).optional(),
  })
  .refine((value) => value.columns === undefined || value.columnsVersion !== undefined, {
    message: 'columnsVersion is required when updating columns',
    path: ['columnsVersion'],
  });

export const sheetDuplicateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  sheetDate: z.string().trim().regex(DATE_REGEX).optional(),
});

export const rowCreateSchema = z.object({
  values: rowValuesSchema.optional(),
});

export const rowPatchSchema = z.object({
  values: rowValuesSchema,
  version: z.number().int().min(0),
});

export const appendResearchRowSchema = z.object({
  ticker: z.string().trim().toUpperCase().regex(/^[A-Z0-9.\-^]{1,10}$/, 'Valid ticker required'),
  date: z.string().trim().regex(DATE_REGEX, 'date must be YYYY-MM-DD'),
  reportId: z.string().min(1).max(128).optional(),
});

export const reorderRowsSchema = z.object({
  rowIds: z.array(z.string().min(1).max(64)).min(1).max(2000),
});

export const memberAddSchema = z.object({
  email: z.string().trim().toLowerCase().email('a valid email is required').max(200),
  role: z.enum(['editor', 'viewer']).default('editor'),
});

export const memberRoleSchema = z.object({
  role: z.enum(['editor', 'viewer']),
});

export type SheetCreateBody = z.infer<typeof sheetCreateSchema>;
export type SheetPatchBody = z.infer<typeof sheetPatchSchema>;
export type SheetDuplicateBody = z.infer<typeof sheetDuplicateSchema>;
export type RowCreateBody = z.infer<typeof rowCreateSchema>;
export type RowPatchBody = z.infer<typeof rowPatchSchema>;
export type AppendResearchRowBody = z.infer<typeof appendResearchRowSchema>;
export type ReorderRowsBody = z.infer<typeof reorderRowsSchema>;
export type MemberAddBody = z.infer<typeof memberAddSchema>;
export type MemberRoleBody = z.infer<typeof memberRoleSchema>;

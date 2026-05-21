import { z } from 'zod';

// All sections are free-form text. Stored together as JSONB so adding
// a new section is a code change, not a migration. Empty strings are
// valid - a user can save a strategy with only Overview filled in.
export const playbookSectionsSchema = z.object({
  overview: z.string(),
  checklist: z.string(),
  entry: z.string(),
  invalidation: z.string(),
  risk: z.string(),
  targets: z.string(),
  notes: z.string(),
});

export type PlaybookSections = z.infer<typeof playbookSectionsSchema>;

export const createStrategySchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional().default(''),
  tag: z.string().max(100).optional().default(''),
  sections: playbookSectionsSchema,
});

export type CreateStrategyInput = z.infer<typeof createStrategySchema>;

export const updateStrategySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  tag: z.string().max(100).optional(),
  sections: playbookSectionsSchema.optional(),
});

export type UpdateStrategyInput = z.infer<typeof updateStrategySchema>;

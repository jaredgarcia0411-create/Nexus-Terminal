import { z } from 'zod';

// Sections are stored as a flexible map so the playbook template (managed via
// /api/report-templates?type=playbook) can rename / add / remove sections
// without a schema migration. Keys are TemplateField.id values; values are
// the user's free-form text for that section. Existing rows that used the old
// fixed-shape (overview, checklist, entry, invalidation, risk, targets, notes)
// keep working because those keys are still strings → strings.
export const playbookSectionsSchema = z.record(z.string(), z.string());

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

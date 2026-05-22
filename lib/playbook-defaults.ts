import { PLAYBOOK_DEFAULT_FIELDS } from '@/lib/journal-template-defaults';
import type { TemplateField } from '@/lib/validations/reviews';
import type { PlaybookSections } from '@/lib/validations/playbook';

// "+ New Strategy" creates a row pre-seeded with every section the user's
// template defines, all empty. Computed from the template's fields so renaming
// or adding a section in the template editor automatically flows through to
// new strategies.
export function emptySectionsForTemplate(fields: TemplateField[]): PlaybookSections {
  return Object.fromEntries(fields.map((field) => [field.id, '']));
}

// Used when no template has loaded yet (e.g. very first create) — falls back
// to the default 7 sections so a new strategy is never created with zero
// fields.
export const EMPTY_PLAYBOOK_SECTIONS: PlaybookSections = emptySectionsForTemplate(PLAYBOOK_DEFAULT_FIELDS);

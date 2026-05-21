import type { PlaybookSections } from '@/lib/validations/playbook';

// Used when the user clicks "+ New Strategy" - every section starts empty
// so the form renders all seven textareas without the user having to
// delete placeholder text.
export const EMPTY_PLAYBOOK_SECTIONS: PlaybookSections = {
  overview: '',
  checklist: '',
  entry: '',
  invalidation: '',
  risk: '',
  targets: '',
  notes: '',
};

// Display labels for the 7 sections, in the order the right panel
// should render them. Keys must match PlaybookSections.
export const PLAYBOOK_SECTION_ORDER: Array<{ key: keyof PlaybookSections; label: string; placeholder: string }> = [
  { key: 'overview', label: 'Overview', placeholder: 'What is this strategy in one paragraph?' },
  { key: 'checklist', label: 'Pre-Trade Checklist', placeholder: 'One bullet per line. e.g. price > 200MA' },
  { key: 'entry', label: 'Entry Criteria', placeholder: 'When do you take the trade?' },
  { key: 'invalidation', label: 'Invalidation', placeholder: 'When do you NOT take the trade?' },
  { key: 'risk', label: 'Risk / Stop', placeholder: 'Where is the stop? How much do you risk?' },
  { key: 'targets', label: 'Profit Targets', placeholder: 'Where do you scale or take full profit?' },
  { key: 'notes', label: 'Notes', placeholder: 'Anything else worth remembering.' },
];

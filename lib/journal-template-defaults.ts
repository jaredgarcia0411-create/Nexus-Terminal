import type { TemplateField } from '@/lib/validations/reviews';

export const DAILY_DEFAULT_FIELDS: TemplateField[] = [
  { id: 'followedProcess', label: 'Did I follow my process?', type: 'bool', required: false },
  { id: 'riskedAccordingly', label: 'Did I risk accordingly?', type: 'bool', required: false },
  { id: 'missedTrades', label: 'Missed trades', type: 'text', required: false },
  { id: 'thoughts', label: 'Thoughts', type: 'text', required: false },
  { id: 'goals', label: 'Goals for tomorrow', type: 'text', required: false },
  { id: 'grossResult', label: 'Gross result', type: 'auto', required: false },
  { id: 'netResult', label: 'Net result', type: 'auto', required: false },
  { id: 'rTotal', label: 'R total', type: 'auto', required: false },
  {
    id: 'grade',
    label: 'Grade',
    type: 'enum',
    required: false,
    options: ['A+', 'A', 'B+', 'B', 'C+', 'C', 'D', 'F'],
  },
];

// Playbook strategies are free-form: every section is a single text
// textarea. Keys match the original hard-coded PlaybookSections shape so
// existing rows (which stored these exact keys) keep rendering after the
// switch to the template-driven UI.
export const PLAYBOOK_DEFAULT_FIELDS: TemplateField[] = [
  { id: 'overview',     label: 'Overview',            type: 'text', required: false },
  { id: 'checklist',    label: 'Pre-Trade Checklist', type: 'text', required: false },
  { id: 'entry',        label: 'Entry Criteria',      type: 'text', required: false },
  { id: 'invalidation', label: 'Invalidation',        type: 'text', required: false },
  { id: 'risk',         label: 'Risk / Stop',         type: 'text', required: false },
  { id: 'targets',      label: 'Profit Targets',      type: 'text', required: false },
  { id: 'notes',        label: 'Notes',               type: 'text', required: false },
];

export const WEEKLY_DEFAULT_FIELDS: TemplateField[] = [
  { id: 'whatWorked', label: 'What worked', type: 'text', required: false },
  { id: 'whatDidnt', label: "What didn't work", type: 'text', required: false },
  { id: 'cycleNotes', label: 'Cycle notes', type: 'text', required: false },
  { id: 'enterTooSoon',      label: 'Did you enter trades too soon?',        type: 'text', required: false },
  { id: 'tookProfitTooLate', label: 'Did you take profit too late?',         type: 'text', required: false },
  { id: 'stopsTooTight',     label: 'Were stops too tight?',                 type: 'text', required: false },
  { id: 'poorRiskReward',    label: 'Did you take poor risk/reward trades?', type: 'text', required: false },
  { id: 'riskTooMuch',       label: 'Did you risk too much?',                type: 'text', required: false },
  { id: 'riskTooLittle',     label: 'Did you risk too little?',              type: 'text', required: false },
  { id: 'missedTrades',      label: 'Did you miss any trades?',              type: 'text', required: false },
  { id: 'thoughts',          label: 'Thoughts',                              type: 'text', required: false },
  { id: 'goalsNextWeek',     label: 'Goals For Next Week',                   type: 'text', required: false },
];

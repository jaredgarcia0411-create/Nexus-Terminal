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

export const WEEKLY_DEFAULT_FIELDS: TemplateField[] = [
  { id: 'weeklyTotal', label: 'Total for the week', type: 'auto', required: false },
  { id: 'whatWorked', label: 'What worked', type: 'text', required: false },
  { id: 'whatDidnt', label: "What didn't work", type: 'text', required: false },
  { id: 'cycleNotes', label: 'Cycle notes', type: 'text', required: false },
  { id: 'goalsNextWeek', label: 'Goals next week', type: 'text', required: false },
  { id: 'enterTooSoon',      label: 'Did you enter trades too soon?',        type: 'text', required: false },
  { id: 'tookProfitTooLate', label: 'Did you take profit too late?',         type: 'text', required: false },
  { id: 'stopsTooTight',     label: 'Were stops too tight?',                 type: 'text', required: false },
  { id: 'poorRiskReward',    label: 'Did you take poor risk/reward trades?', type: 'text', required: false },
  { id: 'riskTooMuch',       label: 'Did you risk too much?',                type: 'text', required: false },
  { id: 'riskTooLittle',     label: 'Did you risk too little?',              type: 'text', required: false },
  { id: 'missedTrades',      label: 'Did you miss any trades?',              type: 'text', required: false },
];

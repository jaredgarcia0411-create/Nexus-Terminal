export interface FilingSummaryInput {
  formType: string;
  items: string | null;
  primaryDocDescription: string | null;
}

const EIGHT_K_ITEMS: Record<string, string> = {
  '1.01': 'material definitive agreement',
  '1.02': 'termination of material agreement',
  '2.01': 'completion of acquisition or disposition',
  '2.02': 'results of operations',
  '2.03': 'creation of a material financial obligation',
  '3.01': 'exchange listing / delisting notice',
  '3.02': 'unregistered sale of equity',
  '5.02': 'director/officer change',
  '5.03': 'charter/bylaw amendment',
  '5.07': 'shareholder vote results',
  '7.01': 'Regulation FD disclosure',
  '8.01': 'other event',
  '9.01': 'financial statements and exhibits',
};

function baseFormLabel(form: string): string | null {
  if (form === '10-Q') return 'quarterly report';
  if (form === '10-K') return 'annual report';
  if (form === '20-F' || form === '40-F') return 'annual report (foreign issuer)';
  if (form === '6-K') return 'foreign issuer report';
  if (/^S-(1|3|4|8|11)$/.test(form)) return 'registration statement';
  if (/^F-(1|3|4)$/.test(form)) return 'registration statement';
  if (/^424[AB]\d?$/.test(form)) return 'prospectus supplement';
  if (form === '425') return 'merger/business-combination communication';
  if (form.startsWith('DEF') && /14[AC]/.test(form)) return 'proxy statement';
  if (form.startsWith('PRE') && /14[AC]/.test(form)) return 'preliminary proxy statement';
  if (/^(SC ?)?13G$/.test(form)) return 'beneficial ownership report';
  if (/^SCHEDULE ?13G$/.test(form)) return 'beneficial ownership report';
  if (/^(SC ?)?13D$/.test(form)) return 'beneficial ownership report';
  if (/^SCHEDULE ?13D$/.test(form)) return 'beneficial ownership report';
  if (form === '3' || form === '4' || form === '5') return 'insider ownership report';
  if (form === '144') return 'proposed sale of securities';

  return null;
}

export function summarizeFilingMetadata(input: FilingSummaryInput): string {
  const form = input.formType.trim().toUpperCase();
  const isAmended = form.endsWith('/A');
  const base = isAmended ? form.slice(0, -2) : form;

  let core: string;
  if (base === '8-K') {
    const codes: string[] = (input.items ?? '').match(/\d\.\d{2}/g) ?? [];
    const filteredCodes = codes.length > 1 && codes.includes('9.01')
      ? codes.filter((code) => code !== '9.01')
      : codes;
    const labels = filteredCodes
      .map((code) => EIGHT_K_ITEMS[code])
      .filter((label): label is string => Boolean(label))
      .slice(0, 2);
    core = labels.length > 0 ? labels.join(', ') : 'current report';
  } else {
    const label = baseFormLabel(base);
    if (label === null) return input.primaryDocDescription?.trim() || `${input.formType} filing`;
    core = label;
  }

  return isAmended ? `amended ${core}` : core;
}

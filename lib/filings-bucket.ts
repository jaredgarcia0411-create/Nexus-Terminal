import type { FilingBucket } from '@/lib/types';

// Unknown / less-common forms intentionally fall through to "other" so the
// research UI still surfaces them instead of dropping them.
export function bucketForFormType(formType: string): FilingBucket {
  const f = formType.trim().toUpperCase();

  if (/^10-[KQ](\/A)?$/.test(f)) return 'financials';
  if (/^20-F(\/A)?$/.test(f)) return 'financials';
  if (/^40-F(\/A)?$/.test(f)) return 'financials';

  if (/^8-K(\/A)?$/.test(f)) return 'news';
  if (/^6-K(\/A)?$/.test(f)) return 'news';

  if (/^S-(1|3|4|8|11)(\/A)?$/.test(f)) return 'registrations';
  if (/^F-(1|3|4)(\/A)?$/.test(f)) return 'registrations';

  if (/^424[AB]\d?$/.test(f)) return 'prospectus';
  if (f === 'EFFECT') return 'prospectus';

  if (/^(DEF|PRE|DEFA|DEFM|DEFC|DFAN|DFRN|PREM|PREC|PRER)/.test(f) && /14[AC]/.test(f)) return 'proxies';

  if (/^SC\s?13[GD](\/A)?$/.test(f)) return 'ownerships';
  if (/^[345](\/A)?$/.test(f)) return 'ownerships';

  return 'other';
}

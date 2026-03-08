export type AllowlistRegion = 'us' | 'eu' | 'asia' | 'global';

export interface AllowlistEntry {
  domain: string;
  label: string;
  category: 'earnings' | 'filings' | 'news' | 'general' | 'macro';
  region: AllowlistRegion;
}

const ALLOWLIST: AllowlistEntry[] = [
  {
    domain: 'earningswhispers.com',
    label: 'Earnings Whispers',
    category: 'earnings',
    region: 'us',
  },
  {
    domain: 'marketwatch.com',
    label: 'MarketWatch',
    category: 'earnings',
    region: 'us',
  },
  {
    domain: 'nasdaq.com',
    label: 'NASDAQ',
    category: 'earnings',
    region: 'us',
  },
  {
    domain: 'sec.gov',
    label: 'SEC EDGAR',
    category: 'filings',
    region: 'us',
  },
  {
    domain: 'cnbc.com',
    label: 'CNBC',
    category: 'macro',
    region: 'us',
  },
  {
    domain: 'reuters.com',
    label: 'Reuters',
    category: 'macro',
    region: 'us',
  },
  {
    domain: 'investing.com',
    label: 'Investing.com',
    category: 'macro',
    region: 'us',
  },
  {
    domain: 'federalreserve.gov',
    label: 'Federal Reserve',
    category: 'macro',
    region: 'us',
  },
  {
    domain: 'ecb.europa.eu',
    label: 'European Central Bank',
    category: 'macro',
    region: 'eu',
  },
  {
    domain: 'tradingeconomics.com',
    label: 'Trading Economics',
    category: 'macro',
    region: 'eu',
  },
  {
    domain: 'boj.or.jp',
    label: 'Bank of Japan',
    category: 'macro',
    region: 'asia',
  },
  {
    domain: 'nikkei.com',
    label: 'Nikkei',
    category: 'macro',
    region: 'asia',
  },
  {
    domain: 'imf.org',
    label: 'IMF',
    category: 'macro',
    region: 'global',
  },
  {
    domain: 'worldbank.org',
    label: 'World Bank',
    category: 'macro',
    region: 'global',
  },
];

export type UrlAllowResult = {
  allowed: boolean;
  entry?: AllowlistEntry;
  domain?: string;
  reason?: string;
};

const TRUST_SCORES_BY_CATEGORY: Record<AllowlistEntry['category'], number> = {
  earnings: 0.8,
  filings: 1,
  news: 0.75,
  general: 0.5,
  macro: 0.85,
};

function normalizeHostname(url: string) {
  const parsed = new URL(url);
  return parsed.hostname.toLowerCase();
}

function resolveEntry(hostname: string) {
  return ALLOWLIST.find((candidate) => {
    if (hostname === candidate.domain) return true;
    return hostname.endsWith(`.${candidate.domain}`);
  });
}

export function isUrlAllowed(rawUrl: string): UrlAllowResult {
  let hostname: string;
  try {
    hostname = normalizeHostname(rawUrl);
  } catch {
    return {
      allowed: false,
      reason: 'Invalid URL format',
    };
  }

  const entry = resolveEntry(hostname);

  if (!entry) {
    return {
      allowed: false,
      domain: hostname,
      reason: 'Domain is not allowlisted',
    };
  }

  return { allowed: true, entry };
}

export function getBlockedUrlMessage(rawUrl: string) {
  let domain = rawUrl;
  try {
    domain = new URL(rawUrl).hostname;
  } catch {
    // Keep best-effort message for malformed URLs.
  }

  return `Domain "${domain}" is not on the allowlist. To request this domain be added, please message support with the site and use case.`;
}

export function getAllowlistEntryForUrl(rawUrl: string) {
  try {
    return resolveEntry(normalizeHostname(rawUrl));
  } catch {
    return undefined;
  }
}

export function getTrustScoreForHost(hostname: string) {
  return TRUST_SCORES_BY_CATEGORY[resolveEntry(hostname)?.category ?? 'general'];
}

export function getTrustScoreForUrl(rawUrl: string) {
  try {
    return getTrustScoreForHost(normalizeHostname(rawUrl));
  } catch {
    return TRUST_SCORES_BY_CATEGORY.general;
  }
}

export function getAllowedDomains() {
  return [...ALLOWLIST];
}

export function getAllowlistByRegion(region: AllowlistRegion) {
  return ALLOWLIST.filter((entry) => entry.region === region);
}

export function getMacroAllowlistDomains() {
  return ALLOWLIST.filter((entry) => entry.category === 'macro');
}

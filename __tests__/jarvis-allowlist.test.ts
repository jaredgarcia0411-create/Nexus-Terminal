import { describe, expect, it } from 'vitest';

import {
  getAllowedDomains,
  getAllowlistByRegion,
  getBlockedUrlMessage,
  getMacroAllowlistDomains,
  getTrustScoreForHost,
  getTrustScoreForUrl,
  isUrlAllowed,
} from '@/lib/jarvis-allowlist';

describe('jarvis allowlist', () => {
  it('allows primary allowlisted domains', () => {
    expect(isUrlAllowed('https://www.sec.gov/')).toEqual({ allowed: true, entry: expect.objectContaining({ domain: 'sec.gov' }) });
    expect(isUrlAllowed('https://www.nasdaq.com/market-activity/earnings')).toEqual({
      allowed: true,
      entry: expect.objectContaining({ domain: 'nasdaq.com' }),
    });
  });

  it('allows subdomains under allowlisted roots', () => {
    expect(isUrlAllowed('https://research.marketwatch.com/test')).toEqual({
      allowed: true,
      entry: expect.objectContaining({ domain: 'marketwatch.com' }),
    });
  });

  it('blocks non-allowlisted domains and returns a clear message', () => {
    const result = isUrlAllowed('https://example.com/');
    expect(result.allowed).toBe(false);
    expect(result.domain).toBe('example.com');
    expect(result.reason).toBe('Domain is not allowlisted');
    expect(getBlockedUrlMessage('https://example.com/')).toContain('example.com');
    expect(getBlockedUrlMessage('https://example.com/')).toContain('request this domain be added');
  });

  it('returns all allowlist rows from a copy', () => {
    const domains = getAllowedDomains();
    const copyMutation = getAllowedDomains();
    expect(domains).toHaveLength(copyMutation.length);

    copyMutation.push({ domain: 'hack.local', label: 'Hack', category: 'general', region: 'us' });
    expect(domains).not.toContainEqual({ domain: 'hack.local', label: 'Hack', category: 'general', region: 'us' });
  });

  it('maps trust by host and full URLs', () => {
    expect(getTrustScoreForHost('sec.gov')).toBe(1);
    expect(getTrustScoreForHost('www.earningswhispers.com')).toBe(0.8);
    expect(getTrustScoreForUrl('https://www.sec.gov/market')).toBe(1);
    expect(getTrustScoreForUrl('https://sub.marketwatch.com/tools')).toBe(0.8);
    expect(getTrustScoreForUrl('https://example.com')).toBe(0.5);
  });

  it('filters allowlist entries by region', () => {
    const euEntries = getAllowlistByRegion('eu');

    expect(euEntries.length).toBeGreaterThan(0);
    expect(euEntries.every((entry) => entry.region === 'eu')).toBe(true);
    expect(euEntries.map((entry) => entry.domain)).toEqual(expect.arrayContaining(['ecb.europa.eu', 'tradingeconomics.com']));
  });

  it('returns macro-only entries from helper', () => {
    const macroEntries = getMacroAllowlistDomains();

    expect(macroEntries).toHaveLength(10);
    expect(macroEntries.every((entry) => entry.category === 'macro')).toBe(true);
    expect(macroEntries.map((entry) => entry.domain)).toEqual(expect.arrayContaining([
      'cnbc.com',
      'reuters.com',
      'investing.com',
      'federalreserve.gov',
      'ecb.europa.eu',
      'tradingeconomics.com',
      'boj.or.jp',
      'nikkei.com',
      'imf.org',
      'worldbank.org',
    ]));
  });
});

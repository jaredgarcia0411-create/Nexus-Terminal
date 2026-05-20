import { describe, expect, it } from 'vitest';

import {
  classifyOfferingType,
  detectSellingStockholderResale,
  extractOfferingFrom424B,
  extractOfferingFrom8K101,
  extractOfferingFrom8K302,
  extractOfferingFrom8KOtherItem,
  extractOfferingFromRegistrationForm,
  extractShareCount,
} from '@/lib/sec/offerings-extractors';

describe('SEC offerings extractors', () => {
  it('extracts ATM 424B5 offering fields', () => {
    const body = [
      'Introductory text.',
      'THE OFFERING',
      'This prospectus supplement relates to our at-the-market offering.',
      'We are offering 2,000,000 shares of common stock.',
      'The purchase price is $2.50 per share.',
      'We expect gross proceeds of $5.0 million before fees.',
    ].join(' ');

    expect(extractOfferingFrom424B(body, '424B5')).toEqual(expect.objectContaining({
      status: 'priced',
      offeringType: 'ATM USED',
      sharesAmount: 2_000_000,
      securitiesAmount: 2_000_000,
      sharePrice: 2.5,
      offeringAmount: 5_000_000,
      netProceedsAmount: null,
      warrantsAmount: null,
      isSellingStockholderResale: false,
      pricedDate: null,
      closedDate: null,
      sourceSnippet: expect.any(String),
      confidence: 'high',
    }));
  });

  it('extracts 424B3 registered direct fields including warrants', () => {
    const body = [
      'PROSPECTUS SUPPLEMENT SUMMARY',
      'We are conducting a registered direct offering of 5,000,000 shares of common stock.',
      'The purchase price is $1.25 per share.',
      'We expect aggregate offering price of $6.25 million.',
      'Investors will also receive 5,000,000 warrants to purchase common stock.',
    ].join(' ');

    expect(extractOfferingFrom424B(body, '424B3')).toEqual(expect.objectContaining({
      status: 'priced',
      offeringType: 'REGISTERED DIRECT',
      sharesAmount: 5_000_000,
      securitiesAmount: 5_000_000,
      sharePrice: 1.25,
      offeringAmount: 6_250_000,
      netProceedsAmount: null,
      warrantsAmount: 5_000_000,
      isSellingStockholderResale: false,
    }));
  });

  it('keeps share and price fields when a 424B lacks a gross proceeds anchor', () => {
    const body = [
      'SUMMARY OF THE OFFERING',
      'We are offering 4,000,000 shares of common stock.',
      'The purchase price is $1.25 per share.',
      'The maximum aggregate value of the transaction is up to $5,000,000.',
      'Investors will also receive 4,000,000 warrants to purchase common stock.',
    ].join(' ');

    expect(extractOfferingFrom424B(body, '424B5')).toEqual(expect.objectContaining({
      status: 'priced',
      offeringType: 'SHELF TAKEDOWN',
      sharesAmount: 4_000_000,
      securitiesAmount: 4_000_000,
      sharePrice: 1.25,
      offeringAmount: null,
      netProceedsAmount: null,
      warrantsAmount: 4_000_000,
      isSellingStockholderResale: false,
    }));
  });

  it('returns null when a 424B fallback scan still has no offering signal', () => {
    const body = 'This filing amends a prior prospectus supplement and contains no offering summary or numeric fields.';
    expect(extractOfferingFrom424B(body, '424B3')).toBeNull();
  });

  it('retains resale rows so projection can filter them later', () => {
    const body = [
      'This prospectus relates to the resale by the selling stockholders named herein.',
      'THE OFFERING',
      'This registered direct offering covers 3,000,000 shares of common stock.',
      'The purchase price is $1.00 per share.',
    ].join(' ');

    expect(extractOfferingFrom424B(body, '424B3')).toEqual(expect.objectContaining({
      status: 'resale_only',
      offeringType: 'REGISTERED DIRECT',
      sharesAmount: 3_000_000,
      securitiesAmount: 3_000_000,
      sharePrice: 1,
      offeringAmount: null,
      netProceedsAmount: null,
      warrantsAmount: null,
      isSellingStockholderResale: true,
    }));
  });

  it('extracts 8-K Item 3.02 PIPE fields', () => {
    const body = [
      'Item 3.02 Unregistered Sales of Equity Securities.',
      'The company issued 1,500,000 shares of common stock.',
      'The investors paid $2.00 per share.',
      'We expect gross proceeds of $3 million.',
    ].join(' ');

    expect(extractOfferingFrom8K302(body)).toEqual(expect.objectContaining({
      status: 'announced',
      offeringType: 'PIPE',
      sharesAmount: 1_500_000,
      securitiesAmount: 1_500_000,
      sharePrice: 2,
      offeringAmount: 3_000_000,
      netProceedsAmount: null,
      warrantsAmount: null,
      isSellingStockholderResale: false,
      confidence: 'medium',
    }));
  });

  it('keeps Item 3.02 rows even when no numeric fields are extracted', () => {
    expect(extractOfferingFrom8K302('Item 3.02 Unregistered Sales of Equity Securities.')).toEqual(expect.objectContaining({
      status: 'announced',
      offeringType: 'PIPE',
      sharesAmount: null,
      securitiesAmount: null,
      sharePrice: null,
      offeringAmount: null,
      netProceedsAmount: null,
      warrantsAmount: null,
      isSellingStockholderResale: false,
      confidence: 'low',
    }));
  });

  it('returns null for 8-K text without an Item 3.02 anchor', () => {
    expect(extractOfferingFrom8K302('Item 1.01 Entry into a Material Definitive Agreement.')).toBeNull();
  });

  it('extracts offering agreements from Item 1.01 8-Ks', () => {
    const body = [
      'Item 1.01 Entry into a Material Definitive Agreement.',
      'The company entered into a securities purchase agreement.',
      'The investors purchased 2,500,000 shares of common stock.',
      'The purchase price was $1.20 per share.',
      'We expect gross proceeds of $3 million.',
    ].join(' ');

    expect(extractOfferingFrom8K101(body)).toEqual(expect.objectContaining({
      status: 'priced',
      offeringType: 'PRIVATE PLACEMENT',
      sharesAmount: 2_500_000,
      securitiesAmount: 2_500_000,
      sharePrice: 1.2,
      offeringAmount: 3_000_000,
      netProceedsAmount: null,
      warrantsAmount: null,
      isSellingStockholderResale: false,
      confidence: 'high',
    }));
  });

  it('returns null for Item 1.01 agreements that are not offering-related', () => {
    const body = [
      'Item 1.01 Entry into a Material Definitive Agreement.',
      'The company entered into a license agreement with a commercial partner.',
    ].join(' ');

    expect(extractOfferingFrom8K101(body)).toBeNull();
  });

  it('detects selling stockholder resale only in the first 5K characters', () => {
    expect(detectSellingStockholderResale('Selling stockholders may resell the shares from time to time.')).toBe(true);
    expect(detectSellingStockholderResale(`${'A'.repeat(10_000)} selling stockholders`)).toBe(false);
  });

  it('applies offering-type classification in the documented order', () => {
    expect(classifyOfferingType('registered direct at-the-market offering', '424B3', null)).toBe('ATM USED');
    expect(classifyOfferingType('registered direct financing', '424B3', null)).toBe('REGISTERED DIRECT');
    expect(classifyOfferingType('best efforts offering with placement agent support', '424B3', null)).toBe('BEST EFFORTS');
    expect(classifyOfferingType('private placement transaction', '424B3', null)).toBe('PRIVATE PLACEMENT');
    expect(classifyOfferingType('initial public offering', '424B3', null)).toBe('IPO');
    expect(classifyOfferingType('plain shelf language', '424B5', null)).toBe('SHELF TAKEDOWN');
    expect(classifyOfferingType('plain public offering language', '424B4', null)).toBe('PUBLIC OFFERING');
    expect(classifyOfferingType('plain language', '424B3', '3.02')).toBe('PIPE');
    expect(classifyOfferingType('plain language', '424B3', null)).toBe('REGISTERED OFFERING');
  });

  it('skips authorized-share language when extracting share count', () => {
    const body = [
      'We are authorized to issue 200,000,000 shares of common stock.',
      'THE OFFERING',
      'We are offering 5,000,000 shares of common stock.',
    ].join(' ');

    expect(extractShareCount(body)).toBe(5_000_000);
  });

  it('extracts closed offering details from broader 8-K item disclosures', () => {
    const body = [
      'Item 8.01 Other Events.',
      'On May 12, 2026, the company closed its registered direct offering of 6,000,000 shares of common stock.',
      'The offering price was $0.75 per share.',
      'Gross proceeds were approximately $4.5 million and estimated net proceeds were approximately $4.1 million.',
      'Investors also received 6,000,000 warrants to purchase common stock.',
    ].join(' ');

    expect(extractOfferingFrom8KOtherItem(body)).toEqual(expect.objectContaining({
      status: 'closed',
      offeringType: 'REGISTERED DIRECT',
      sharesAmount: 6_000_000,
      securitiesAmount: 6_000_000,
      sharePrice: 0.75,
      offeringAmount: 4_500_000,
      netProceedsAmount: 4_100_000,
      warrantsAmount: 6_000_000,
      closedDate: '2026-05-12',
      sourceSnippet: expect.stringContaining('closed its registered direct offering'),
      confidence: 'high',
    }));
  });

  it('marks registration resale prospectuses as resale-only instead of completed offerings', () => {
    const body = [
      'This prospectus relates to the resale by the selling stockholders named herein.',
      'THE OFFERING',
      'The selling stockholders may offer up to 8,000,000 shares of common stock from time to time.',
    ].join(' ');

    expect(extractOfferingFromRegistrationForm(body, 'S-1')).toEqual(expect.objectContaining({
      status: 'resale_only',
      offeringType: 'REGISTERED OFFERING',
      sharesAmount: 8_000_000,
      isSellingStockholderResale: true,
      confidence: 'medium',
    }));
  });

  it('captures terminated offering status without treating it as closed', () => {
    const body = [
      'Item 7.01 Regulation FD Disclosure.',
      'The company terminated its previously announced public offering and will not proceed with the financing.',
    ].join(' ');

    expect(extractOfferingFrom8KOtherItem(body)).toEqual(expect.objectContaining({
      status: 'terminated',
      offeringType: 'PUBLIC OFFERING',
      closedDate: null,
      confidence: 'high',
    }));
  });

  it('extracts ADS-denominated 424B5 fields for foreign issuers', () => {
    const body = [
      'THE OFFERING',
      'We are offering 10,000,000 American Depositary Shares ("ADSs").',
      'The purchase price is $1.52 per ADS.',
      'We expect total proceeds of approximately $15.2 million.',
    ].join(' ');

    expect(extractOfferingFrom424B(body, '424B5')).toEqual(expect.objectContaining({
      status: 'priced',
      sharesAmount: 10_000_000,
      securitiesAmount: 10_000_000,
      sharePrice: 1.52,
      offeringAmount: 15_200_000,
      isSellingStockholderResale: false,
    }));
  });

  it('extracts ordinary-shares offerings without "of common stock" anchor', () => {
    const body = [
      'PROSPECTUS SUPPLEMENT SUMMARY',
      'We are offering 8,000,000 ordinary shares.',
      'The purchase price is $0.80 per ordinary share.',
      'Aggregate purchase price of $6.4 million.',
    ].join(' ');

    expect(extractOfferingFrom424B(body, '424B5')).toEqual(expect.objectContaining({
      status: 'priced',
      sharesAmount: 8_000_000,
      sharePrice: 0.8,
      offeringAmount: 6_400_000,
    }));
  });

  it('extracts dual-class Class A common share fields', () => {
    const body = [
      'THE OFFERING',
      'We are offering 4,000,000 shares of Class A common stock.',
      'The purchase price is $2.50 per Class A common share.',
      'Gross proceeds of $10 million.',
    ].join(' ');

    expect(extractOfferingFrom424B(body, '424B3')).toEqual(expect.objectContaining({
      status: 'priced',
      sharesAmount: 4_000_000,
      sharePrice: 2.5,
      offeringAmount: 10_000_000,
    }));
  });
});

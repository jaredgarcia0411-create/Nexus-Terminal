import { describe, expect, it } from 'vitest';

import { getMessageText, type DiscordMessage } from '@/lib/discord/client';
import { parseMessages, parseReport } from '@/lib/discord/parser';

const SAMPLE_REPORT = `**Ultimate Research Report for MULN**

Price: $1.23
Market Cap: $45.6M
Float/OS: 12.3M / 50M
Industry: Electric Vehicles

Gain: +145%

**Dilution** 🔴
The company has a history of significant dilution...

**Offering Ability** 🟡
Mixed shelf registration in place...

**Scam/Pump Risk** 🟢
No evidence of fraudulent activity...

**Cash Burn** 🔴
Current burn rate suggests runway of 6 months...`;

const NON_REPORT_MESSAGE = 'Hey everyone, check out TSLA today!';

describe('Discord Report Parser', () => {
  it('extracts ticker from report title', () => {
    const result = parseReport(SAMPLE_REPORT);
    expect(result.isReport).toBe(true);
    expect(result.data?.ticker).toBe('MULN');
  });

  it('extracts price', () => {
    const result = parseReport(SAMPLE_REPORT);
    expect(result.data?.price).toBe(1.23);
  });

  it('extracts market cap', () => {
    const result = parseReport(SAMPLE_REPORT);
    expect(result.data?.marketCap).toBe('45.6M');
  });

  it('extracts float and outstanding shares', () => {
    const result = parseReport(SAMPLE_REPORT);
    expect(result.data?.floatShares).toBe('12.3M');
    expect(result.data?.outstandingShares).toBe('50M');
  });

  it('extracts industry', () => {
    const result = parseReport(SAMPLE_REPORT);
    expect(result.data?.industry).toBe('Electric Vehicles');
  });

  it('extracts gain percentage', () => {
    const result = parseReport(SAMPLE_REPORT);
    expect(result.data?.gainPercent).toBe(145);
  });

  it('extracts risk levels from emoji indicators', () => {
    const result = parseReport(SAMPLE_REPORT);
    expect(result.data?.dilutionRisk).toBe('high');
    expect(result.data?.offeringRisk).toBe('medium');
    expect(result.data?.scamRisk).toBe('low');
    expect(result.data?.cashBurnRisk).toBe('high');
  });

  it('returns isReport: false for non-report messages', () => {
    const result = parseReport(NON_REPORT_MESSAGE);
    expect(result.isReport).toBe(false);
    expect(result.data).toBeNull();
  });

  it('handles reports with missing fields gracefully', () => {
    const minimal = 'Ultimate Research Report for AAPL\n\nSome text without structured fields.';
    const result = parseReport(minimal);
    expect(result.isReport).toBe(true);
    expect(result.data?.ticker).toBe('AAPL');
    expect(result.data?.price).toBeNull();
    expect(result.data?.marketCap).toBeNull();
    expect(result.data?.dilutionRisk).toBeNull();
  });

  it('handles case-insensitive ticker in title', () => {
    const report = 'ultimate research report for tsla\nPrice: $200';
    const result = parseReport(report);
    expect(result.isReport).toBe(true);
    expect(result.data?.ticker).toBe('TSLA');
  });

  it('parseMessages filters and maps a batch', () => {
    const author = { id: '123', username: 'bot' };
    const messages: DiscordMessage[] = [
      { id: '1', content: SAMPLE_REPORT, timestamp: '2026-01-15T10:00:00Z', author },
      { id: '2', content: NON_REPORT_MESSAGE, timestamp: '2026-01-15T11:00:00Z', author },
      {
        id: '3',
        content: 'Ultimate Research Report for AAPL\nPrice: $150',
        timestamp: '2026-01-16T09:00:00Z',
        author,
      },
    ];

    const results = parseMessages(messages);
    expect(results).toHaveLength(2);
    expect(results[0].messageId).toBe('1');
    expect(results[0].data.ticker).toBe('MULN');
    expect(results[1].messageId).toBe('3');
    expect(results[1].data.ticker).toBe('AAPL');
  });

  it('extracts text from embed description (real bot format)', () => {
    const embedMessage: DiscordMessage = {
      id: '99',
      content: '',
      timestamp: '2026-01-20T10:00:00Z',
      embeds: [
        {
          title: 'Ultimate Research Report for ORIS',
          description:
            '**Price:** $0.52\n**Market Cap:** 0.9M\n**Float / OS:** 4.2M / 5.1M\n\n**Dilution** 🔴\nClearly dilutive\n\n**Offering Ability** 🟡\nMixed signals',
        },
      ],
      author: { id: '456', username: 'Research Report' },
    };

    const text = getMessageText(embedMessage);
    expect(text).toContain('Ultimate Research Report for ORIS');
    expect(text).toContain('$0.52');

    const result = parseReport(text);
    expect(result.isReport).toBe(true);
    expect(result.data?.ticker).toBe('ORIS');
    expect(result.data?.dilutionRisk).toBe('high');
  });

  it('handles text-based risk indicators when no emoji', () => {
    const report = `Ultimate Research Report for XYZ

**Dilution**
HIGH RISK - Extensive dilution history

**Offering Ability**
MODERATE risk due to shelf registration`;

    const result = parseReport(report);
    expect(result.data?.dilutionRisk).toBe('high');
    expect(result.data?.offeringRisk).toBe('medium');
  });
});

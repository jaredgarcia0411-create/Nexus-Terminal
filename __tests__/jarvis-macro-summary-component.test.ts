import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import JarvisMacroSummary from '@/components/trading/JarvisMacroSummary';

describe('JarvisMacroSummary', () => {
  it('renders cron macro summary payload without crashing', () => {
    const html = renderToStaticMarkup(createElement(JarvisMacroSummary, {
      macroSummary: {
        headline: 'US inflation rate rises to 2.4%',
        key_themes: ['US inflation', 'Oil prices'],
        risk_flags: ['Inflation', 'Oil volatility'],
        watchlist_notes: ['Federal Reserve interest rate decision'],
      },
    }));

    expect(html).toContain('US inflation rate rises to 2.4%');
    expect(html).toContain('US inflation');
    expect(html).toContain('Federal Reserve interest rate decision');
    expect(html).toContain('Oil volatility');
    expect(html).toContain('Reference Links');
    expect(html).toContain('Google Finance');
    expect(html).toContain('text-base text-zinc-100');
    expect(html).toContain('text-sm text-zinc-200 transition');
  });

  it('renders legacy macro summary payload', () => {
    const html = renderToStaticMarkup(createElement(JarvisMacroSummary, {
      macroSummary: {
        date: '2026-03-11',
        overallSentiment: 'mixed',
        regions: [
          {
            region: 'us',
            headline: 'Rates remain elevated',
            details: ['CPI came in above expectations'],
            sentiment: 'mixed',
          },
        ],
        keyRisks: ['Interest rate volatility'],
      },
    }));

    expect(html).toContain('Macro Summary - 2026-03-11');
    expect(html).toContain('United States');
    expect(html).toContain('Rates remain elevated');
    expect(html).toContain('Interest rate volatility');
  });
});

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import MarketsTab from '@/components/trading/MarketsTab';

describe('MarketsTab', () => {
  it('renders key market sections', () => {
    const html = renderToStaticMarkup(createElement(MarketsTab));

    expect(html).toContain('Unified market snapshot with market movers across major asset classes.');
    expect(html).toContain('Indexes');
    expect(html).toContain('Commodities, Bonds &amp; FX');
    expect(html).toContain('Market Movers');
    expect(html).toContain('Major Equity Components');
    expect(html).toContain('Scanner');
    expect(html).toContain('text-base font-semibold text-zinc-100">Market Movers');
    expect(html).toContain('text-base font-semibold text-zinc-200">Indexes');
  });
});

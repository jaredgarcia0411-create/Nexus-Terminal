import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import MarketsTab from '@/components/trading/MarketsTab';

describe('MarketsTab', () => {
  it('renders key market sections', () => {
    const html = renderToStaticMarkup(createElement(MarketsTab));

    expect(html).toContain('Markets');
    expect(html).toContain('Indexes');
    expect(html).toContain('Futures');
    expect(html).toContain('Crypto');
    expect(html).toContain('FX');
    expect(html).toContain('Market Movers');
    expect(html).toContain('Major Equity Components');
  });
});

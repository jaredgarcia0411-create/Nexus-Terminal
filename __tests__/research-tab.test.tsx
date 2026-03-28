import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import ResearchTab from '@/components/trading/ResearchTab';

describe('ResearchTab', () => {
  it('renders research sub-tabs', () => {
    const html = renderToStaticMarkup(createElement(ResearchTab));

    expect(html).toContain('Search ticker...');
    expect(html).toContain('Select a gainer or search a ticker');
    expect(html).toContain('Top Gainers');
    expect(html).toContain('Loading gainers...');
  });
});

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import ResearchTab from '@/components/trading/ResearchTab';

describe('ResearchTab', () => {
  it('renders research sub-tabs', () => {
    const html = renderToStaticMarkup(createElement(ResearchTab));

    expect(html).toContain('Research');
    expect(html).toContain('AI Reports');
    expect(html).toContain('Daily Summaries');
    expect(html).toContain('Saved Tickers');
  });
});

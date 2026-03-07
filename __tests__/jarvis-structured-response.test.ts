import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import JarvisStructuredResponse from '@/components/trading/JarvisStructuredResponse';

describe('JarvisStructuredResponse', () => {
  it('renders structured sections with source links and badges', () => {
    const html = renderToStaticMarkup(
      React.createElement(JarvisStructuredResponse, {
        message: 'fallback message',
        structured: {
          tldr: 'Momentum trend is improving.',
          findings: ['AAPL earnings beat expectations'],
          actionSteps: ['Wait for pullback before entry'],
          risks: ['Guidance revisions can reverse momentum'],
        },
        sourceSummary: 'AAPL earnings sources',
        sources: [
          {
            url: 'https://www.marketwatch.com/story/example',
            title: 'AAPL earnings recap',
            host: 'www.marketwatch.com',
            excerpt: 'Revenue and guidance improved quarter over quarter.',
            relevance: 0.88,
            tickers: ['AAPL'],
          },
        ],
      }),
    );

    expect(html).toContain('TL;DR');
    expect(html).toContain('Findings');
    expect(html).toContain('Action Steps');
    expect(html).toContain('Risks');
    expect(html).toContain('href="https://www.marketwatch.com/story/example"');
    expect(html).toContain('High relevance');
    expect(html).toContain('AAPL');
  });

  it('falls back to plain message when structured payload is missing', () => {
    const html = renderToStaticMarkup(
      React.createElement(JarvisStructuredResponse, {
        message: 'No structured payload available.',
      }),
    );

    expect(html).toContain('No structured payload available.');
    expect(html).not.toContain('TL;DR');
  });
});

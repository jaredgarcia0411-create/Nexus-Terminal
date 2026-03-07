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
            sourceType: 'web_source',
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
    expect(html).toContain('Web');
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

  it('renders source-type badge labels for non-web sources', () => {
    const html = renderToStaticMarkup(
      React.createElement(JarvisStructuredResponse, {
        message: 'fallback',
        structured: {
          tldr: 'ok',
          findings: ['f'],
          actionSteps: ['a'],
          risks: ['r'],
        },
        sources: [
          {
            url: 'jarvis://trade/1',
            title: 'Trade note AAPL',
            host: 'journal.user-1',
            sourceType: 'trade_journal',
            excerpt: 'Trade journal context',
            relevance: 0.7,
            tickers: ['AAPL'],
          },
          {
            url: 'jarvis://document/doc-1',
            title: 'Playbook.pdf',
            host: 'docs.user-1',
            sourceType: 'user_document',
            excerpt: 'Document context',
            relevance: 0.6,
            tickers: ['MSFT'],
          },
        ],
      }),
    );

    expect(html).toContain('Journal');
    expect(html).toContain('Document');
  });
});

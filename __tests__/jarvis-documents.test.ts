import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import JarvisDocuments from '@/components/trading/JarvisDocuments';

describe('JarvisDocuments', () => {
  it('renders upload section copy', () => {
    const html = renderToStaticMarkup(React.createElement(JarvisDocuments));

    expect(html).toContain('Jarvis Documents');
    expect(html).toContain('Upload Document');
    expect(html).toContain('Uploaded Files');
  });
});

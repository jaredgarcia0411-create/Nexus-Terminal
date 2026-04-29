import { describe, expect, it } from 'vitest';

import { stripFilingBodyHtml } from '@/lib/sec/filing-body';

describe('stripFilingBodyHtml', () => {
  it('removes scripts/styles, strips tags, decodes entities, and collapses whitespace', () => {
    const input = `
      <html>
        <head>
          <style>.hidden { display: none; }</style>
          <script>window.alert('ignore me')</script>
        </head>
        <body>
          <h1>Reverse &amp; Split</h1>
          <p>Ratio:&nbsp;<strong>1-for-25</strong></p>
          <div>Effective &lt;March 14, 2026&gt; &quot;tomorrow&quot; &#39;quoted&#39;</div>
        </body>
      </html>
    `;

    expect(stripFilingBodyHtml(input)).toBe(
      'Reverse & Split Ratio: 1-for-25 Effective <March 14, 2026> "tomorrow" \'quoted\'',
    );
  });
});

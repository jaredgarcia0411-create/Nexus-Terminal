import { describe, expect, it } from 'vitest';

import { normalizeDrawings } from '@/hooks/use-chart-drawings';

describe('normalizeDrawings', () => {
  it('accepts fixed-style text drawings', () => {
    const drawings = normalizeDrawings([
      {
        id: 'text-1',
        type: 'text',
        position: { time: 1770000000000, price: 10.5 },
        text: 'test',
      },
    ]);

    expect(drawings).toEqual([
      {
        id: 'text-1',
        type: 'text',
        position: { time: 1770000000000, price: 10.5 },
        text: 'test',
      },
    ]);
  });

  it('rejects invalid text drawing payloads', () => {
    const drawings = normalizeDrawings([
      {
        id: 'empty-text',
        type: 'text',
        position: { time: 1770000000000, price: 10.5 },
        text: '',
      },
      {
        id: 'bad-text',
        type: 'text',
        position: { time: 1770000000000, price: 10.5 },
        text: 42,
      },
    ]);

    expect(drawings).toEqual([]);
  });
});

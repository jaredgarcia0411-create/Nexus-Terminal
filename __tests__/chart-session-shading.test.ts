import { describe, expect, it } from 'vitest';

import { buildExtendedHoursShadeSegments, buildSessionShadeRects } from '@/lib/chart-session-shading';
import { nyDateTimeToEpoch } from '@/lib/time-utils';

function epoch(sortKey: string, time: string) {
  const value = nyDateTimeToEpoch(sortKey, time);
  if (value == null) {
    throw new Error(`Could not parse ${sortKey} ${time}`);
  }
  return value;
}

describe('buildExtendedHoursShadeSegments', () => {
  it('builds continuous overnight shades around every visible session', () => {
    expect(buildExtendedHoursShadeSegments(['2026-04-22', '2026-04-21'])).toEqual([
      {
        key: '2026-04-20:overnight:2026-04-21',
        start: epoch('2026-04-20', '16:00:00'),
        end: epoch('2026-04-21', '09:30:00'),
      },
      {
        key: '2026-04-21:overnight:2026-04-22',
        start: epoch('2026-04-21', '16:00:00'),
        end: epoch('2026-04-22', '09:30:00'),
      },
      {
        key: '2026-04-22:overnight:2026-04-23',
        start: epoch('2026-04-22', '16:00:00'),
        end: epoch('2026-04-23', '09:30:00'),
      },
    ]);
  });

  it('includes the prior and next session for a single visible day', () => {
    expect(buildExtendedHoursShadeSegments(['2026-04-22'])).toEqual([
      {
        key: '2026-04-21:overnight:2026-04-22',
        start: epoch('2026-04-21', '16:00:00'),
        end: epoch('2026-04-22', '09:30:00'),
      },
      {
        key: '2026-04-22:overnight:2026-04-23',
        start: epoch('2026-04-22', '16:00:00'),
        end: epoch('2026-04-23', '09:30:00'),
      },
    ]);
  });

  it('maps shades to candle ranges when the exact session boundary has no candle', () => {
    const candles = [
      { datetime: epoch('2026-04-21', '15:55:00') },
      { datetime: epoch('2026-04-22', '04:00:00') },
      { datetime: epoch('2026-04-22', '09:30:00') },
      { datetime: epoch('2026-04-22', '09:35:00') },
    ];
    const coordinates = new Map(candles.map((candle, index) => [candle.datetime, index * 10]));

    expect(buildSessionShadeRects({
      candles,
      segments: [{
        key: '2026-04-21:overnight:2026-04-22',
        start: epoch('2026-04-21', '16:00:00'),
        end: epoch('2026-04-22', '09:30:00'),
      }],
      visibleStart: null,
      visibleEnd: null,
      viewportWidth: 100,
      timeToCoordinate: (epochMs) => coordinates.get(epochMs) ?? null,
    })).toEqual([
      {
        key: '2026-04-21:overnight:2026-04-22',
        left: 5,
        width: 20,
      },
    ]);
  });
});

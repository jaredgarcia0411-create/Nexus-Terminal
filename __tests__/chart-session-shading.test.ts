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

  it('starts the overnight band at 13:00 after a half day', () => {
    // 2026-11-27 is the half day after Thanksgiving (2026-11-26 is closed).
    expect(buildExtendedHoursShadeSegments(['2026-11-27'])).toEqual([
      {
        key: '2026-11-25:overnight:2026-11-27',
        start: epoch('2026-11-25', '16:00:00'),
        end: epoch('2026-11-27', '09:30:00'),
      },
      {
        key: '2026-11-27:overnight:2026-11-30',
        start: epoch('2026-11-27', '13:00:00'),
        end: epoch('2026-11-30', '09:30:00'),
      },
    ]);
  });

  it('spans the spring-forward weekend with real instants on both sides', () => {
    const [friday, monday] = buildExtendedHoursShadeSegments(['2026-03-09']);
    expect(friday).toEqual({
      key: '2026-03-06:overnight:2026-03-09',
      start: Date.parse('2026-03-06T16:00:00-05:00'),
      end: Date.parse('2026-03-09T09:30:00-04:00'),
    });
    expect(monday?.key).toBe('2026-03-09:overnight:2026-03-10');
    // Friday's close to Monday's open reads as 65.5 wall-clock hours, but the skipped hour makes it 64.5 real hours.
    expect((friday!.end - friday!.start) / 3_600_000).toBe(64.5);
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

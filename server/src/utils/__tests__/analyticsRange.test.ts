import { afterEach, describe, expect, it } from 'vitest';

import {
  ANALYTICS_TIME_ZONE,
  parseAnalyticsRange,
  startOfAnalyticsDay,
  startOfAnalyticsSemester,
} from '../analyticsRange';

const originalTimeZone = process.env.TZ;

const underHostTimeZone = <T>(timeZone: string, read: () => T): T => {
  process.env.TZ = timeZone;
  return read();
};

afterEach(() => {
  if (originalTimeZone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimeZone;
});

describe('analytics ranges', () => {
  it('declares New Haven time as the one dashboard zone', () => {
    expect(ANALYTICS_TIME_ZONE).toBe('America/New_York');
  });

  it('starts today at the same instant whatever zone the host runs in', () => {
    const lateEveningInNewHaven = new Date('2026-09-30T02:30:00.000Z');

    const starts = ['UTC', 'America/New_York', 'Asia/Tokyo', 'America/Los_Angeles'].map(
      (timeZone) =>
        underHostTimeZone(timeZone, () =>
          parseAnalyticsRange('today', lateEveningInNewHaven).start?.toISOString(),
        ),
    );

    expect(new Set(starts)).toEqual(new Set(['2026-09-29T04:00:00.000Z']));
  });

  it('starts today at New Haven midnight in winter and on both daylight-saving days', () => {
    expect(startOfAnalyticsDay(new Date('2026-01-15T03:00:00.000Z')).toISOString()).toBe(
      '2026-01-14T05:00:00.000Z',
    );
    expect(startOfAnalyticsDay(new Date('2026-03-08T15:00:00.000Z')).toISOString()).toBe(
      '2026-03-08T05:00:00.000Z',
    );
    expect(startOfAnalyticsDay(new Date('2026-11-01T15:00:00.000Z')).toISOString()).toBe(
      '2026-11-01T04:00:00.000Z',
    );
  });

  it('starts the semester on 1 July or 1 January in New Haven, whatever the host zone', () => {
    const lastEveningOfJuneInNewHaven = new Date('2026-07-01T02:00:00.000Z');

    const starts = ['UTC', 'Asia/Tokyo'].map((timeZone) =>
      underHostTimeZone(timeZone, () =>
        parseAnalyticsRange('semester', lastEveningOfJuneInNewHaven).start?.toISOString(),
      ),
    );

    expect(new Set(starts)).toEqual(new Set(['2026-01-01T05:00:00.000Z']));
    expect(startOfAnalyticsSemester(new Date('2026-09-30T12:00:00.000Z')).toISOString()).toBe(
      '2026-07-01T04:00:00.000Z',
    );
  });

  it('keeps the rolling ranges relative to now', () => {
    const now = new Date('2026-09-30T12:00:00.000Z');

    expect(parseAnalyticsRange('all', now)).toEqual({});
    expect(parseAnalyticsRange('7d', now).start?.toISOString()).toBe('2026-09-23T12:00:00.000Z');
    expect(parseAnalyticsRange('30d', now).start?.toISOString()).toBe('2026-08-31T12:00:00.000Z');
    expect(parseAnalyticsRange(undefined, now).end).toBe(now);
  });
});

import { afterEach, describe, expect, it } from 'vitest';

import { parseAwardPeriod, parseNehDate } from '../sources/nehGrantScraper';
import { parseNihDate } from '../sources/nihReporterScraper';
import { parseNsfDate } from '../sources/nsfAwardScraper';

const HOST_TIME_ZONES = ['UTC', 'America/New_York'] as const;
const originalTimeZone = process.env.TZ;

const isoUnderHostTimeZone = (timeZone: string, parse: () => Date | undefined) => {
  process.env.TZ = timeZone;
  return parse()?.toISOString();
};

const isoUnderEveryHostTimeZone = (parse: () => Date | undefined) =>
  HOST_TIME_ZONES.map((timeZone) => isoUnderHostTimeZone(timeZone, parse));

afterEach(() => {
  if (originalTimeZone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimeZone;
});

describe('grant lane award dates (#6041)', () => {
  it('stores an NIH RePORTER date as UTC midnight of its calendar day on any host', () => {
    expect(isoUnderEveryHostTimeZone(() => parseNihDate('2024-06-08T00:00:00'))).toEqual([
      '2024-06-08T00:00:00.000Z',
      '2024-06-08T00:00:00.000Z',
    ]);
    expect(isoUnderEveryHostTimeZone(() => parseNihDate('2026-01-31T00:00:00'))).toEqual([
      '2026-01-31T00:00:00.000Z',
      '2026-01-31T00:00:00.000Z',
    ]);
  });

  it('stores an NSF date as UTC midnight of its calendar day on any host', () => {
    expect(isoUnderEveryHostTimeZone(() => parseNsfDate('06/30/2027'))).toEqual([
      '2027-06-30T00:00:00.000Z',
      '2027-06-30T00:00:00.000Z',
    ]);
    expect(isoUnderEveryHostTimeZone(() => parseNsfDate('12/31/2025'))).toEqual([
      '2025-12-31T00:00:00.000Z',
      '2025-12-31T00:00:00.000Z',
    ]);
  });

  it('stores an NEH date and award period as UTC midnight of each calendar day on any host', () => {
    expect(isoUnderEveryHostTimeZone(() => parseNehDate('7/1/2024'))).toEqual([
      '2024-07-01T00:00:00.000Z',
      '2024-07-01T00:00:00.000Z',
    ]);
    expect(isoUnderEveryHostTimeZone(() => parseAwardPeriod('9/1/2025 - 1/31/2027').end)).toEqual([
      '2027-01-31T00:00:00.000Z',
      '2027-01-31T00:00:00.000Z',
    ]);
    expect(isoUnderEveryHostTimeZone(() => parseAwardPeriod('9/1/2025 - 1/31/2027').begin)).toEqual(
      ['2025-09-01T00:00:00.000Z', '2025-09-01T00:00:00.000Z'],
    );
  });

  it('refuses a date that names no real calendar day rather than rolling it over', () => {
    expect(parseNihDate('2025-02-30T00:00:00')).toBeUndefined();
    expect(parseNsfDate('02/30/2025')).toBeUndefined();
    expect(parseNehDate('13/1/2025')).toBeUndefined();
    expect(parseNihDate(undefined)).toBeUndefined();
    expect(parseNihDate('not a date')).toBeUndefined();
  });
});

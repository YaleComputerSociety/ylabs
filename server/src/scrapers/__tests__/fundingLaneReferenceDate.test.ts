import { describe, expect, it } from 'vitest';
import { fiscalYearsEndingAt } from '../sources/nihReporterScraper';
import { defaultDateStart } from '../sources/nsfAwardScraper';

describe('funding lane query windows follow the run reference date', () => {
  it('derives the NIH fiscal years from the reference date rather than the wall clock', () => {
    expect(fiscalYearsEndingAt(new Date('2026-10-03T12:00:00.000Z'))).toEqual([2024, 2025, 2026]);
    expect(fiscalYearsEndingAt(new Date('2031-03-01T12:00:00.000Z'))).toEqual([2029, 2030, 2031]);
  });

  it('derives the NSF lookback start from the reference date rather than the wall clock', () => {
    expect(defaultDateStart(new Date('2026-10-03T12:00:00.000Z'))).toBe('10/03/2021');
  });
});

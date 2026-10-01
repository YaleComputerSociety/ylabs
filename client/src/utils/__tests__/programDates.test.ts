import { describe, expect, it } from 'vitest';

import {
  formatProgramDate,
  formatShortProgramDate,
  isDateOnlyProgramDeadline,
  programDeadlineClosingInstant,
} from '../programDates';

describe('formatProgramDate', () => {
  it('shows a stated deadline time in New York with an ET label', () => {
    expect(formatProgramDate('2027-03-24T17:00:00.000Z', 'deadline')).toBe(
      'Mar 24, 2027, 1:00 PM ET',
    );
    expect(formatProgramDate('2027-02-24T18:00:00.000Z', 'deadline')).toBe(
      'Feb 24, 2027, 1:00 PM ET',
    );
    expect(formatProgramDate('2027-03-24T04:00:00.000Z', 'deadline')).toBe(
      'Mar 24, 2027, 12:00 AM ET',
    );
    expect(formatProgramDate('2027-03-25T03:59:00.000Z', 'deadline')).toBe(
      'Mar 24, 2027, 11:59 PM ET',
    );
  });

  it('shows only the date when the deadline stated no time', () => {
    expect(formatProgramDate('2027-03-25T03:59:59.999Z', 'deadline')).toBe('Mar 24, 2027');
    expect(formatProgramDate('2027-11-08T04:59:59.999Z', 'deadline')).toBe('Nov 7, 2027');
  });

  it('shows only the date for a deadline stored at the end of a UTC day', () => {
    expect(formatProgramDate('2027-03-24T23:59:59.999Z', 'deadline')).toBe('Mar 24, 2027');
  });

  it('shows only the date for an opening at New York midnight and the time otherwise', () => {
    expect(formatProgramDate('2026-09-01T04:00:00.000Z', 'opens')).toBe('Sep 1, 2026');
    expect(formatProgramDate('2026-09-01T13:00:00.000Z', 'opens')).toBe('Sep 1, 2026, 9:00 AM ET');
  });

  it('falls back when there is no date', () => {
    expect(formatProgramDate(null, 'deadline')).toBe('Not specified');
    expect(formatProgramDate('not-a-date', 'deadline', 'None')).toBe('None');
  });
});

describe('formatShortProgramDate', () => {
  it('names the New York calendar date whatever the UTC date is', () => {
    expect(formatShortProgramDate('2027-03-25T03:59:59.999Z')).toBe('Mar 24');
    expect(formatShortProgramDate('2027-03-24T17:00:00.000Z')).toBe('Mar 24');
  });
});

describe('programDeadlineClosingInstant', () => {
  it('closes a date-only deadline at the end of its New York day', () => {
    expect(programDeadlineClosingInstant('2027-03-24T23:59:59.999Z')?.toISOString()).toBe(
      '2027-03-25T03:59:59.999Z',
    );
    expect(programDeadlineClosingInstant('2027-03-25T03:59:59.999Z')?.toISOString()).toBe(
      '2027-03-25T03:59:59.999Z',
    );
  });

  it('closes a stated deadline at its stated minute', () => {
    expect(programDeadlineClosingInstant('2027-03-24T17:00:00.000Z')?.toISOString()).toBe(
      '2027-03-24T17:00:00.000Z',
    );
    expect(isDateOnlyProgramDeadline(new Date('2027-03-25T03:59:00.000Z'))).toBe(false);
  });
});

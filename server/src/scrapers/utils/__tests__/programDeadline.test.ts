import { describe, expect, it } from 'vitest';
import { parseProgramDate, statedClockTime } from '../programDeadline';

const iso = (text: string, boundary: 'deadline' | 'opens' = 'deadline', reference?: Date) =>
  parseProgramDate(text, boundary, reference)?.toISOString();

describe('statedClockTime', () => {
  it('reads twelve-hour times, with or without minutes or periods', () => {
    expect(statedClockTime(' 1:00 PM')).toEqual({ hour: 13, minute: 0 });
    expect(statedClockTime(' at 11:00pm ET')).toEqual({ hour: 23, minute: 0 });
    expect(statedClockTime(', 5 p.m. EST')).toEqual({ hour: 17, minute: 0 });
    expect(statedClockTime(' by 9:30 a.m.')).toEqual({ hour: 9, minute: 30 });
    expect(statedClockTime(' at noon')).toEqual({ hour: 12, minute: 0 });
  });

  it('reads 12:00 PM as noon and 12:00 AM as the start of the day', () => {
    expect(statedClockTime(' 12:00 PM')).toEqual({ hour: 12, minute: 0 });
    expect(statedClockTime(' 12:00 AM')).toEqual({ hour: 0, minute: 0 });
  });

  it('reads no time from a following number that is not a clock time', () => {
    expect(statedClockTime(' 2027 programs')).toBeUndefined();
    expect(statedClockTime('. 3 pm workshops follow')).toBeUndefined();
    expect(statedClockTime(' 13:00 PM')).toBeUndefined();
  });

  it('reads no time stated in a zone other than Eastern', () => {
    expect(statedClockTime(' 5:00 PM PT')).toBeUndefined();
    expect(statedClockTime(' 5:00 PM (Eastern Time)')).toEqual({ hour: 17, minute: 0 });
  });
});

describe('parseProgramDate', () => {
  it('stores a stated time as that New York minute', () => {
    expect(iso('3/24/2027 1:00 PM')).toBe('2027-03-24T17:00:00.000Z');
    expect(iso('3/24/2027 12:00 PM')).toBe('2027-03-24T16:00:00.000Z');
    expect(iso('3/24/2027 11:59 PM')).toBe('2027-03-25T03:59:00.000Z');
  });

  it('reads 12:00 AM as the start of the stated date, not the end of it', () => {
    expect(iso('3/24/2027 12:00 AM')).toBe('2027-03-24T04:00:00.000Z');
  });

  it('closes a date-only deadline at the end of the New York day, not the UTC day', () => {
    expect(iso('3/24/2027')).toBe('2027-03-25T03:59:59.999Z');
    expect(iso('February 6, 2027')).toBe('2027-02-07T04:59:59.999Z');
  });

  it('opens a date-only window at New York midnight', () => {
    expect(iso('3/24/2027', 'opens')).toBe('2027-03-24T04:00:00.000Z');
    expect(iso('3/24/2027 9:00 AM', 'opens')).toBe('2027-03-24T13:00:00.000Z');
  });

  it('applies the offset in force on the stated date across daylight-saving changes', () => {
    expect(iso('3/13/2027 1:00 PM')).toBe('2027-03-13T18:00:00.000Z');
    expect(iso('3/15/2027 1:00 PM')).toBe('2027-03-15T17:00:00.000Z');
    expect(iso('11/6/2027 1:00 PM')).toBe('2027-11-06T17:00:00.000Z');
    expect(iso('11/8/2027 1:00 PM')).toBe('2027-11-08T18:00:00.000Z');
    expect(iso('3/14/2027')).toBe('2027-03-15T03:59:59.999Z');
    expect(iso('11/7/2027')).toBe('2027-11-08T04:59:59.999Z');
  });

  it('reads a time that follows a month-name date', () => {
    expect(iso('Deadline: Friday, February 6, 2026 at 11:00pm ET')).toBe(
      '2026-02-07T04:00:00.000Z',
    );
    expect(iso('Applications due March 15, 2027, 5 p.m.')).toBe('2027-03-15T21:00:00.000Z');
  });

  it('falls back to the whole day when the time is stated in another zone', () => {
    expect(iso('3/24/2027 1:00 PM PT')).toBe('2027-03-25T03:59:59.999Z');
  });

  it('infers the year of an undated date from the New York reference date', () => {
    const lateDecemberInNewYork = new Date('2027-01-01T03:00:00.000Z');
    expect(iso('Deadline: December 20', 'deadline', lateDecemberInNewYork)).toBe(
      '2026-12-21T04:59:59.999Z',
    );
    expect(iso('Deadline: January 2', 'deadline', new Date('2027-03-15T12:00:00.000Z'))).toBe(
      '2028-01-03T04:59:59.999Z',
    );
  });

  it('refuses a date that does not exist', () => {
    expect(iso('Deadline: February 30, 2026')).toBeUndefined();
    expect(iso('Applications due 13/40/26')).toBeUndefined();
    expect(iso('Application deadline typically in February/March.')).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { isDateOnlyProgramDeadline, programDeadlineClosesAt } from '../programDeadlineInstant';

describe('programDeadlineClosesAt', () => {
  it('keeps a stated minute as stated', () => {
    const oneOClock = new Date('2027-03-24T17:00:00.000Z');
    expect(isDateOnlyProgramDeadline(oneOClock)).toBe(false);
    expect(programDeadlineClosesAt(oneOClock)).toEqual(oneOClock);
    expect(isDateOnlyProgramDeadline(new Date('2027-03-25T03:59:00.000Z'))).toBe(false);
  });

  it('keeps the end of a New York day as it is', () => {
    const endOfNewYorkDay = new Date('2027-03-25T03:59:59.999Z');
    expect(isDateOnlyProgramDeadline(endOfNewYorkDay)).toBe(true);
    expect(programDeadlineClosesAt(endOfNewYorkDay)).toEqual(endOfNewYorkDay);
  });

  it('moves the end of a UTC day to the end of the same New York day', () => {
    expect(programDeadlineClosesAt(new Date('2027-03-24T23:59:59.999Z')).toISOString()).toBe(
      '2027-03-25T03:59:59.999Z',
    );
    expect(programDeadlineClosesAt(new Date('2027-02-24T23:59:59.999Z')).toISOString()).toBe(
      '2027-02-25T04:59:59.999Z',
    );
  });
});

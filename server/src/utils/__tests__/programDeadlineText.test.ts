import { describe, expect, it } from 'vitest';
import { programTextDeadlineConflict } from '../programDeadlineText';

const deadline = '2027-02-12T04:00:00.000Z';

describe('programTextDeadlineConflict (#5158)', () => {
  it('flags a deadline the text gives on another day', () => {
    expect(
      programTextDeadlineConflict(deadline, [
        'Applications must be submitted online through the database by 11:00pm on Thursday, February 12, 2027.',
      ]),
    ).toBe('2027-02-12');
  });

  it('flags a deadline the text gives from the last cycle', () => {
    expect(
      programTextDeadlineConflict('2027-02-19T04:00:00.000Z', [
        'Applications are due by 11:00pm on Thursday, February 19, 2026 and must include a proposal.',
      ]),
    ).toBe('2026-02-19');
  });

  it('does not flag text that agrees with the served deadline on any date', () => {
    expect(
      programTextDeadlineConflict(deadline, [
        'The fall deadline is October 1, 2026. The spring deadline is February 11, 2027.',
      ]),
    ).toBeUndefined();
  });

  it('reads only a date the nearest event word ties to the deadline', () => {
    expect(
      programTextDeadlineConflict(deadline, [
        'The application will open on Friday, January 8, 2027 and the deadline is Thursday, February 11, 2027.',
        'Applicants will be notified by April 15, 2027.',
        'Program dates: June 4, 2018 - July 27, 2018.',
      ]),
    ).toBeUndefined();
  });

  it('states nothing without a served deadline or a stated date', () => {
    expect(programTextDeadlineConflict(null, ['The deadline is March 1, 2027.'])).toBeUndefined();
    expect(
      programTextDeadlineConflict(deadline, ['Deadlines are mid-October and mid-March.']),
    ).toBeUndefined();
  });
});

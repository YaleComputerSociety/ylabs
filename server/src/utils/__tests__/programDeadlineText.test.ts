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

describe('programTextDeadlineConflict reads only the application deadline (#5158)', () => {
  it.each([
    'Final reports are due May 1, 2027.',
    'Recommendation letters must be received by March 1, 2027.',
  ])('does not read a date owed after or beside the application as its deadline: %s', (text) => {
    expect(programTextDeadlineConflict(deadline, [text])).toBeUndefined();
  });

  it.each([
    'Due to high demand, interviews will be held on March 3, 2027.',
    'Fellows work in close collaboration with faculty from June 1, 2027.',
    'The lab sits close to campus and hosts a retreat on June 1, 2027.',
  ])('does not read due to or close as a deadline cue: %s', (text) => {
    expect(programTextDeadlineConflict(deadline, [text])).toBeUndefined();
  });

  it.each([
    ['Applications close on March 1, 2027.', '2027-03-01'],
    ['Applications close Monday, March 1, 2027.', '2027-03-01'],
  ])('reads close followed by on or a date as the deadline: %s', (text, expected) => {
    expect(programTextDeadlineConflict(deadline, [text])).toBe(expected);
  });

  it.each(['Application Deadline - March 1, 2027', 'Deadline \u2013 March 1, 2027'])(
    'reads a deadline label followed by a dash: %s',
    (text) => {
      expect(programTextDeadlineConflict(deadline, [text])).toBe('2027-03-01');
    },
  );

  it('reads the deadline that follows an opening date in the same sentence', () => {
    expect(
      programTextDeadlineConflict(deadline, [
        'The application will open on Friday, June 5, 2026 and the deadline for the year is Friday, July 10, 2026.',
      ]),
    ).toBe('2026-07-10');
  });

  it('says nothing for a projected or stale deadline, which the page already labels', () => {
    const text = ['Applications are due by 11:00pm on Thursday, February 19, 2026.'];
    expect(programTextDeadlineConflict(deadline, text, { projected: true })).toBeUndefined();
    expect(programTextDeadlineConflict(deadline, text, { stale: true })).toBeUndefined();
  });
});

it('does not read a program date range in a run-on sentence as a deadline (#5158)', () => {
  expect(
    programTextDeadlineConflict(deadline, [
      'Applications submitted late forfeit a spot in the program.All fellows must live on campus for the nine-week program; May 25 - July 24, 2027.',
    ]),
  ).toBeUndefined();
});

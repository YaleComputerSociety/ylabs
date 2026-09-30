import { describe, expect, it } from 'vitest';
import {
  cardAwardLabel,
  isOpenToFirstYears,
  programBoardSectionOf,
  programCardFacts,
} from '../programBoard';
import { getFellowshipCycleStatus } from '../fellowshipCycle';
import { createFellowship } from '../createFellowship';

const now = new Date('2026-05-14T00:00:00.000Z');
const isoDaysFromNow = (days: number) =>
  new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();

const served = (overrides: Record<string, unknown> = {}) =>
  createFellowship({
    _id: 'synthetic-program',
    title: 'Synthetic Research Fellowship',
    programKind: 'FELLOWSHIP_FUNDING',
    applicationLink: 'https://example.org/apply',
    ...overrides,
  });

const sectionOf = (overrides: Record<string, unknown> = {}) => {
  const program = served(overrides);
  return programBoardSectionOf(program, getFellowshipCycleStatus(program, now).category);
};

describe('programBoardSectionOf', () => {
  it('sorts a program into the section for what a student can do about it now', () => {
    expect(sectionOf({ deadline: isoDaysFromNow(10) })).toBe('closingSoon');
    expect(sectionOf({ deadline: isoDaysFromNow(90) })).toBe('open');
    expect(
      sectionOf({ applicationOpenDate: isoDaysFromNow(14), deadline: isoDaysFromNow(90) }),
    ).toBe('openingSoon');
    expect(sectionOf({ deadline: isoDaysFromNow(-40) })).toBe('nextCycle');
  });

  it('files a source-backed program with no posted dates under no dates, not deadline passed', () => {
    const undated = served({ deadline: null });
    const status = getFellowshipCycleStatus(undated, now);
    expect(status.label).toBe('No Dates Posted');
    expect(sectionOf({ deadline: null })).toBe('noDates');
    expect(sectionOf({ deadline: null, isAcceptingApplications: true })).toBe('noDates');
  });

  it('never files an estimated next-cycle date as an open application', () => {
    expect(sectionOf({ deadline: isoDaysFromNow(20), deadlineProjectedNextCycle: true })).toBe(
      'nextCycle',
    );
  });

  it('keeps an archive-review record out of every live section', () => {
    expect(
      sectionOf({ studentFacingCategory: 'Archive / review', deadline: isoDaysFromNow(90) }),
    ).toBe('archive');
    expect(sectionOf({ programKind: 'OTHER', deadline: isoDaysFromNow(90) })).toBe('archive');
  });
});

describe('programCardFacts', () => {
  it('states the award and that a mentor comes first', () => {
    expect(
      programCardFacts(served({ awardAmount: 'up to $1,500', requiresMentorBeforeApply: true })),
    ).toEqual(['Award: up to $1,500', 'Line up a mentor before you apply']);
  });

  it('says when the program finds the mentor', () => {
    expect(programCardFacts(served({ mentorMatching: true }))).toEqual([
      'Matches you with a mentor',
    ]);
  });

  it('claims nothing about mentors when the record asserts neither', () => {
    expect(programCardFacts(served())).toEqual([]);
  });
});

describe('cardAwardLabel', () => {
  it('adds a currency sign to a bare number', () => {
    expect(cardAwardLabel('3,300')).toBe('$3,300');
    expect(cardAwardLabel('3000-4000')).toBe('$3000-4000');
    expect(cardAwardLabel('up to $500')).toBe('up to $500');
  });

  it('keeps a long award sentence off the card rather than truncating it', () => {
    expect(cardAwardLabel('maximum amount around $2,500; smaller amounts typical')).toBeNull();
    expect(cardAwardLabel('')).toBeNull();
  });
});

describe('isOpenToFirstYears', () => {
  it('reads the served year-of-study list', () => {
    expect(isOpenToFirstYears(served({ yearOfStudy: ['First-Year Student', 'Sophomore'] }))).toBe(
      true,
    );
    expect(isOpenToFirstYears(served({ yearOfStudy: ['Junior'] }))).toBe(false);
  });
});

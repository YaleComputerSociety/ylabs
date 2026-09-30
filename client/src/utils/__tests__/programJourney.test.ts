import { describe, expect, it } from 'vitest';
import {
  PROGRAM_JOURNEY_CATEGORIES,
  getProgramJourneyStatus,
  programActionOrder,
  summarizeProgramJourney,
  programCategoryLabel,
} from '../programJourney';
import type { Fellowship } from '../../types/types';
import { createFellowship } from '../createFellowship';

const baseFellowship = (overrides: Partial<Fellowship> = {}): Fellowship => ({
  id: 'f1',
  programCategory: 'FELLOWSHIP',
  programKind: 'FELLOWSHIP_FUNDING',
  entryMode: 'SECURE_MENTOR_THEN_APPLY',
  studentFacingCategory: 'Funding after mentor',
  requiresMentorBeforeApply: true,
  mentorMatching: false,
  undergraduateOnly: true,
  yaleCollegeOnly: true,
  compensationSummary: '',
  hoursPerWeek: null,
  programDates: '',
  bestNextStep: '',
  prepSteps: [],
  title: 'Summer Research Fellowship',
  competitionType: 'Fellowship',
  summary: 'Annual funding for undergraduate research projects.',
  description: '',
  applicationInformation: '',
  eligibility: '',
  restrictionsToUseOfAward: '',
  additionalInformation: '',
  links: [{ label: 'Program page', url: 'https://example.edu/fellowship' }],
  applicationLink: 'https://example.edu/apply',
  awardAmount: '',
  isAcceptingApplications: false,
  applicationOpenDate: null,
  deadline: null,
  contactName: '',
  contactEmail: '',
  contactPhone: '',
  contactOffice: '',
  yearOfStudy: [],
  termOfAward: [],
  purpose: ['Research'],
  globalRegions: [],
  citizenshipStatus: [],
  sourceName: '',
  sourceUrl: '',
  sourceKey: '',
  sourceFingerprint: '',
  sourceLastVerifiedAt: null,
  sourceLastChangedAt: null,
  archived: false,
  audited: false,
  views: 0,
  favorites: 0,
  updatedAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const now = new Date('2026-05-14T00:00:00.000Z');
const isoDaysFromNow = (days: number) =>
  new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();

describe('summarizeProgramJourney', () => {
  const fellowships: Fellowship[] = [
    baseFellowship({
      id: 'apply-now',
      programKind: 'STRUCTURED_PROGRAM',
      requiresMentorBeforeApply: false,
      studentFacingCategory: 'Structured program',
      isAcceptingApplications: true,
      deadline: isoDaysFromNow(60),
    }),
    baseFellowship({
      id: 'structured',
      programKind: 'STRUCTURED_PROGRAM',
      requiresMentorBeforeApply: false,
      studentFacingCategory: 'Structured program',
      isAcceptingApplications: false,
      deadline: isoDaysFromNow(-40),
    }),
    baseFellowship({
      id: 'funding-a',
      isAcceptingApplications: false,
      deadline: isoDaysFromNow(-40),
    }),
    baseFellowship({
      id: 'funding-b',
      isAcceptingApplications: false,
      deadline: isoDaysFromNow(-90),
    }),
    baseFellowship({
      id: 'archive',
      programKind: 'OTHER',
      entryMode: 'UNKNOWN',
      studentFacingCategory: 'Archive / review',
      requiresMentorBeforeApply: false,
      links: [],
      applicationLink: '',
      isAcceptingApplications: false,
      deadline: isoDaysFromNow(-40),
    }),
    baseFellowship({
      id: 'projected-next-cycle',
      programKind: 'OTHER',
      requiresMentorBeforeApply: false,
      isAcceptingApplications: false,
      deadline: isoDaysFromNow(180),
      deadlineProjectedNextCycle: true,
    }),
  ];

  it('partitions the set so the buckets sum to the total record count', () => {
    const summary = summarizeProgramJourney(fellowships);
    const summed = PROGRAM_JOURNEY_CATEGORIES.reduce((sum, key) => sum + summary[key], 0);
    expect(summed).toBe(fellowships.length);
  });

  it('matches per-record getProgramJourneyStatus so tiles and sections cannot diverge', () => {
    const summary = summarizeProgramJourney(fellowships);
    const recomputed = PROGRAM_JOURNEY_CATEGORIES.reduce(
      (acc, key) => ({ ...acc, [key]: 0 }),
      {} as Record<(typeof PROGRAM_JOURNEY_CATEGORIES)[number], number>,
    );
    for (const fellowship of fellowships) {
      recomputed[getProgramJourneyStatus(fellowship).category] += 1;
    }
    expect(summary).toEqual(recomputed);
  });

  it('groups by what a student needs first, whatever the deadline', () => {
    const summary = summarizeProgramJourney(fellowships);
    expect(summary.routeIn).toBe(2);
    expect(summary.fundsResearch).toBe(2);
    expect(summary.archive).toBe(2);
    expect(summary.recognizesResearch).toBe(0);
  });

  it('orders a section so programs a student can act on now come first', () => {
    const byId = (id: string) => fellowships.find((f) => f.id === id)!;
    expect(programActionOrder(byId('apply-now'), now)).toBeLessThan(
      programActionOrder(byId('projected-next-cycle'), now),
    );
    expect(programActionOrder(byId('projected-next-cycle'), now)).toBeLessThan(
      programActionOrder(byId('funding-a'), now),
    );
  });
});

describe('getProgramJourneyStatus by program role (#3904)', () => {
  it('prefers the served programRole over the kind', () => {
    expect(
      getProgramJourneyStatus(
        baseFellowship({ programKind: 'FELLOWSHIP_FUNDING', programRole: 'RECOGNIZES_RESEARCH' }),
      ).category,
    ).toBe('recognizesResearch');
  });

  it('falls back to the kind for a record served before its role was written', () => {
    expect(
      getProgramJourneyStatus(
        baseFellowship({ programKind: 'DEPARTMENT_RESEARCH_GUIDE', studentFacingCategory: '' }),
      ).category,
    ).toBe('routeIn');
    expect(
      getProgramJourneyStatus(baseFellowship({ programKind: 'RESEARCH_AWARD' })).category,
    ).toBe('recognizesResearch');
    expect(getProgramJourneyStatus(baseFellowship()).category).toBe('fundsResearch');
  });

  it('keeps an archive-review record out of every live section', () => {
    expect(
      getProgramJourneyStatus(
        baseFellowship({ programRole: 'ROUTE_IN', studentFacingCategory: 'Archive / review' }),
      ).category,
    ).toBe('archive');
  });
});

describe('programCategoryLabel', () => {
  it('maps known legacy-category enums to human copy', () => {
    expect(programCategoryLabel('CENTER_INTERNSHIP')).toBe('Center internship');
    expect(programCategoryLabel('FELLOWSHIP')).toBe('Fellowship');
    expect(programCategoryLabel('RECURRING_PROGRAM')).toBe('Recurring program');
    expect(programCategoryLabel('SUMMER_RESEARCH_PROGRAM')).toBe('Summer research program');
  });

  it('falls back to a lowercased spaced form for unknown enums instead of the raw key', () => {
    expect(programCategoryLabel('SOME_NEW_KIND')).toBe('some new kind');
  });
});

describe('served programRole through createFellowship', () => {
  it('groups a served record by its programRole rather than its programKind', () => {
    const served = createFellowship({
      _id: 'served-award',
      programKind: 'FELLOWSHIP_FUNDING',
      programRole: 'RECOGNIZES_RESEARCH',
      title: 'Synthetic Award',
    });

    expect(getProgramJourneyStatus(served).category).toBe('recognizesResearch');
  });

  it('falls back to the programKind mapping when the served record has no programRole', () => {
    const served = createFellowship({
      _id: 'served-funding',
      programKind: 'FELLOWSHIP_FUNDING',
      title: 'Synthetic Funding',
    });

    expect(getProgramJourneyStatus(served).category).toBe('fundsResearch');
  });
});

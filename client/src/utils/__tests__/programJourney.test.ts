import { describe, expect, it } from 'vitest';
import {
  PROGRAM_JOURNEY_CATEGORIES,
  getMentorGuidance,
  getProgramJourneyStatus,
  summarizeProgramJourney,
  programCategoryLabel,
} from '../programJourney';
import type { Fellowship } from '../../types/types';

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
  ];

  it('partitions the set so the buckets sum to the total record count', () => {
    const summary = summarizeProgramJourney(fellowships, now);
    const summed = PROGRAM_JOURNEY_CATEGORIES.reduce((sum, key) => sum + summary[key], 0);
    expect(summed).toBe(fellowships.length);
  });

  it('matches per-record getProgramJourneyStatus so tiles and sections cannot diverge', () => {
    const summary = summarizeProgramJourney(fellowships, now);
    const recomputed = PROGRAM_JOURNEY_CATEGORIES.reduce(
      (acc, key) => ({ ...acc, [key]: 0 }),
      {} as Record<(typeof PROGRAM_JOURNEY_CATEGORIES)[number], number>,
    );
    for (const fellowship of fellowships) {
      recomputed[getProgramJourneyStatus(fellowship, now).category] += 1;
    }
    expect(summary).toEqual(recomputed);
  });

  it('counts the whole set rather than a single loaded page', () => {
    const summary = summarizeProgramJourney(fellowships, now);
    expect(summary.applyNow).toBe(1);
    expect(summary.structured).toBe(1);
    expect(summary.fundingAfterMentor).toBe(2);
    expect(summary.archive).toBe(1);
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

describe('getMentorGuidance', () => {
  it('does not contradict itself when a program matches mentors without requiring one first', () => {
    const guidance = getMentorGuidance(
      baseFellowship({ requiresMentorBeforeApply: false, mentorMatching: true }),
    );
    expect(guidance.answer).toBe('No, matched through the program');
    expect(guidance.answer).not.toMatch(/^(yes|not usually)$/i);
    expect(guidance.detail).toContain('do not need to secure one first');
  });

  it('answers "Not usually" with no extra line when no mentor is required or matched', () => {
    const guidance = getMentorGuidance(
      baseFellowship({ requiresMentorBeforeApply: false, mentorMatching: false }),
    );
    expect(guidance.answer).toBe('Not usually');
    expect(guidance.detail).toBeUndefined();
  });

  it('answers "Yes" and tells the student to line up a mentor when one is required', () => {
    const guidance = getMentorGuidance(
      baseFellowship({ requiresMentorBeforeApply: true, mentorMatching: false }),
    );
    expect(guidance.answer).toBe('Yes');
    expect(guidance.detail).toBe('Line up a mentor before applying.');
  });

  it('keeps a single coherent answer when a program both requires and matches mentors', () => {
    const guidance = getMentorGuidance(
      baseFellowship({ requiresMentorBeforeApply: true, mentorMatching: true }),
    );
    expect(guidance.answer).toBe('Yes');
    expect(guidance.detail).toContain('can help match you with one');
  });
});

import { describe, expect, it } from 'vitest';
import {
  getFellowshipCycleStatus,
  getFellowshipDeadlineSubtitle,
  isLikelyRecurringFellowship,
} from '../fellowshipCycle';
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

describe('fellowshipCycle', () => {
  it('classifies a future open date as opening soon even when not currently accepting', () => {
    const status = getFellowshipCycleStatus(
      baseFellowship({
        isAcceptingApplications: false,
        applicationOpenDate: '2026-06-01T12:00:00.000Z',
        deadline: '2026-07-01T12:00:00.000Z',
      }),
      now,
    );

    expect(status.category).toBe('openingSoon');
    expect(status.label).toBe('Opens Soon');
  });

  it('classifies active fellowships as open or closing soon', () => {
    expect(
      getFellowshipCycleStatus(
        baseFellowship({
          isAcceptingApplications: true,
          deadline: '2026-07-01T00:00:00.000Z',
        }),
        now,
      ).category,
    ).toBe('open');

    expect(
      getFellowshipCycleStatus(
        baseFellowship({
          isAcceptingApplications: true,
          deadline: '2026-05-20T00:00:00.000Z',
        }),
        now,
      ).category,
    ).toBe('closingSoon');
  });

  it('treats source-backed expired fellowships as next-cycle signals', () => {
    const fellowship = baseFellowship({
      isAcceptingApplications: true,
      deadline: '2026-05-01T00:00:00.000Z',
    });

    expect(isLikelyRecurringFellowship(fellowship)).toBe(true);
    expect(getFellowshipCycleStatus(fellowship, now)).toMatchObject({
      category: 'nextCycle',
      label: 'Next Cycle Signal',
      likelyRecurring: true,
    });
    expect(getFellowshipDeadlineSubtitle(fellowship, now)).toBe('Past cycle; track for reopening');
  });

  it('keeps unsourced inactive fellowships in the plain closed bucket', () => {
    const fellowship = baseFellowship({
      applicationLink: '',
      links: [],
      isAcceptingApplications: false,
      deadline: '2026-05-01T00:00:00.000Z',
    });

    expect(isLikelyRecurringFellowship(fellowship)).toBe(false);
    expect(getFellowshipCycleStatus(fellowship, now).category).toBe('closed');
  });
});

import { describe, expect, it } from 'vitest';

import { Fellowship } from '../../types/types';
import {
  getEligibilitySummary,
  getFellowshipApplicationStatus,
  getStructuredEligibilityDetails,
} from '../fellowshipStatus';

const NOW = new Date('2026-04-01T12:00:00.000Z');

const makeFellowship = (overrides: Partial<Fellowship> = {}): Fellowship => ({
  id: 'f-1',
  programCategory: 'FELLOWSHIP',
  programKind: 'FELLOWSHIP_FUNDING',
  entryMode: 'SECURE_MENTOR_THEN_APPLY',
  studentFacingCategory: 'Funding after mentor',
  requiresMentorBeforeApply: true,
  mentorMatching: false,
  undergraduateOnly: true,
  audience: 'UNDERGRADUATE',
  yaleCollegeOnly: true,
  compensationSummary: '',
  hoursPerWeek: null,
  programDates: '',
  bestNextStep: '',
  prepSteps: [],
  sourceName: '',
  sourceUrl: '',
  sourceKey: '',
  sourceFingerprint: '',
  sourceLastVerifiedAt: null,
  sourceLastChangedAt: null,
  title: 'Fellowship',
  competitionType: '',
  summary: '',
  description: '',
  applicationInformation: '',
  eligibility: 'Open to Yale College students.',
  restrictionsToUseOfAward: '',
  additionalInformation: '',
  links: [],
  applicationLink: '',
  awardAmount: '',
  isAcceptingApplications: true,
  applicationOpenDate: null,
  deadline: '2026-04-20T12:00:00.000Z',
  contactName: '',
  contactEmail: '',
  contactPhone: '',
  contactOffice: '',
  yearOfStudy: ['Junior'],
  termOfAward: [],
  purpose: [],
  globalRegions: [],
  citizenshipStatus: [],
  archived: false,
  audited: false,
  views: 0,
  favorites: 0,
  updatedAt: '',
  createdAt: '',
  ...overrides,
});

describe('fellowshipStatus', () => {
  it('marks open opportunities with upcoming deadlines as currently relevant', () => {
    const status = getFellowshipApplicationStatus(makeFellowship(), NOW);

    expect(status.kind).toBe('closingSoon');
    expect(status.label).toBe('Closing soon');
    expect(status.detail).toBe('19\u00a0days left');
    expect(status.isCurrentlyRelevant).toBe(true);
    expect(status.isApplicationWindowOpen).toBe(true);
  });

  it('does not present passed deadlines as open even when accepting is true', () => {
    const status = getFellowshipApplicationStatus(
      makeFellowship({ deadline: '2026-03-31T12:00:00.000Z' }),
      NOW,
    );

    expect(status.kind).toBe('deadlinePassed');
    expect(status.label).toBe('Deadline passed');
    expect(status.isCurrentlyRelevant).toBe(false);
    expect(status.isApplicationWindowOpen).toBe(false);
  });

  it('distinguishes future application windows from closed opportunities', () => {
    const status = getFellowshipApplicationStatus(
      makeFellowship({ applicationOpenDate: '2026-04-10T12:00:00.000Z' }),
      NOW,
    );

    expect(status.kind).toBe('notOpenYet');
    expect(status.label).toBe('Opens soon');
    expect(status.isCurrentlyRelevant).toBe(true);
    expect(status.isApplicationWindowOpen).toBe(false);
  });

  it('uses future application open dates for opening-soon status even when not currently accepting', () => {
    const status = getFellowshipApplicationStatus(
      makeFellowship({
        isAcceptingApplications: false,
        applicationOpenDate: '2026-04-10T12:00:00.000Z',
        deadline: '2026-05-01T12:00:00.000Z',
      }),
      NOW,
    );

    expect(status.kind).toBe('notOpenYet');
    expect(status.label).toBe('Opens soon');
    expect(status.isCurrentlyRelevant).toBe(true);
    expect(status.isApplicationWindowOpen).toBe(false);
  });

  it('flags accepting opportunities with unknown deadlines for admin review without opening a window', () => {
    const status = getFellowshipApplicationStatus(makeFellowship({ deadline: null }), NOW);

    expect(status.kind).toBe('unknown');
    expect(status.label).toBe('Timing not confirmed');
    expect(status.needsDateReview).toBe(true);
    expect(status.isCurrentlyRelevant).toBe(true);
    expect(status.isApplicationWindowOpen).toBe(false);
  });

  it('surfaces a future-deadline window even when the stored accepting flag is false', () => {
    const status = getFellowshipApplicationStatus(
      makeFellowship({
        isAcceptingApplications: false,
        applicationOpenDate: '2026-03-01T12:00:00.000Z',
        deadline: '2026-05-01T12:00:00.000Z',
      }),
      NOW,
    );

    expect(status.kind).toBe('closingSoon');
    expect(status.isCurrentlyRelevant).toBe(true);
    expect(status.isApplicationWindowOpen).toBe(true);
  });

  it('treats a rolling application program with no deadline as open', () => {
    const status = getFellowshipApplicationStatus(
      makeFellowship({
        isAcceptingApplications: false,
        deadline: null,
        applicationInformation: 'We review applications as we receive them on a rolling basis.',
      }),
      NOW,
    );

    expect(status.kind).toBe('open');
    expect(status.label).toBe('Accepting applications');
    expect(status.isApplicationWindowOpen).toBe(true);
  });

  it('keeps closed opportunities without a window closed regardless of the stored flag', () => {
    const status = getFellowshipApplicationStatus(
      makeFellowship({
        isAcceptingApplications: true,
        applicationOpenDate: null,
        deadline: null,
        applicationInformation: '',
        summary: '',
        description: '',
      }),
      NOW,
    );

    expect(status.kind).toBe('unknown');
    expect(status.isApplicationWindowOpen).toBe(false);
  });

  it('surfaces a projected next-cycle deadline as unconfirmed rather than an open window', () => {
    const status = getFellowshipApplicationStatus(
      makeFellowship({
        isAcceptingApplications: false,
        deadline: '2027-02-17T12:00:00.000Z',
        deadlineProjectedNextCycle: true,
      }),
      NOW,
    );

    expect(status.kind).toBe('projectedNextCycle');
    expect(status.label).toBe('Projected next cycle');
    expect(status.isCurrentlyRelevant).toBe(true);
    expect(status.isApplicationWindowOpen).toBe(false);
  });

  it('flags missing eligibility when neither text nor structured filters are present', () => {
    const fellowship = makeFellowship({
      eligibility: '',
      yearOfStudy: [],
      termOfAward: [],
      purpose: [],
      globalRegions: [],
      citizenshipStatus: [],
    });
    const status = getFellowshipApplicationStatus(fellowship, NOW);

    expect(status.needsEligibilityReview).toBe(true);
    expect(getEligibilitySummary(fellowship)).toBe('Eligibility not specified');
  });

  it('counts purpose metadata as structured eligibility', () => {
    const fellowship = makeFellowship({
      eligibility: '',
      yearOfStudy: [],
      termOfAward: [],
      purpose: ['Research'],
      globalRegions: [],
      citizenshipStatus: [],
    });
    const status = getFellowshipApplicationStatus(fellowship, NOW);

    expect(status.needsEligibilityReview).toBe(false);
    expect(getEligibilitySummary(fellowship)).toBe('Research');
  });

  it('counts global region metadata as structured eligibility', () => {
    const fellowship = makeFellowship({
      eligibility: '',
      yearOfStudy: [],
      termOfAward: [],
      purpose: [],
      globalRegions: ['Africa'],
      citizenshipStatus: [],
    });
    const status = getFellowshipApplicationStatus(fellowship, NOW);

    expect(status.needsEligibilityReview).toBe(false);
    expect(getEligibilitySummary(fellowship)).toBe('Africa');
  });
});

describe('getStructuredEligibilityDetails', () => {
  it('builds readable requirement lines from structured facets when the eligibility string is empty', () => {
    const fellowship = makeFellowship({
      eligibility: '',
      undergraduateOnly: true,
      audience: 'UNDERGRADUATE',
      yaleCollegeOnly: true,
      yearOfStudy: ['Sophomore', 'Junior'],
      termOfAward: ['Summer'],
      citizenshipStatus: ['U.S. citizens are eligible'],
      globalRegions: [],
      purpose: [],
    });
    const details = getStructuredEligibilityDetails(fellowship);
    expect(details).toEqual([
      { label: 'Level', value: 'Undergraduates only' },
      { label: 'School', value: 'Yale College students only' },
      { label: 'Year of study', value: 'Sophomore, Junior' },
      { label: 'Term', value: 'Summer' },
      { label: 'Citizenship', value: 'U.S. citizens are eligible' },
    ]);
  });

  it('returns no lines when no structured eligibility facets are present', () => {
    const fellowship = makeFellowship({
      eligibility: '',
      undergraduateOnly: null,
      audience: null,
      yaleCollegeOnly: null,
      yearOfStudy: [],
      termOfAward: [],
      citizenshipStatus: [],
      globalRegions: [],
      purpose: [],
    });
    expect(getStructuredEligibilityDetails(fellowship)).toEqual([]);
  });

  it('names a program open to undergraduates and graduates instead of calling it undergraduate-only', () => {
    const fellowship = makeFellowship({
      eligibility: '',
      undergraduateOnly: true,
      audience: 'UNDERGRADUATE_AND_GRADUATE',
      yaleCollegeOnly: true,
      yearOfStudy: ['Junior', 'PhD Pre-Candidacy'],
      termOfAward: [],
      citizenshipStatus: [],
      globalRegions: [],
      purpose: [],
    });
    expect(getStructuredEligibilityDetails(fellowship)).toEqual([
      { label: 'Level', value: 'Undergraduate and graduate students' },
      { label: 'Year of study', value: 'Junior, PhD Pre-Candidacy' },
    ]);
  });

  it('labels a stated deadline with its New York time and a date-only one with its date', () => {
    const stated = getFellowshipApplicationStatus(
      makeFellowship({ deadline: '2026-04-20T17:00:00.000Z' }),
      NOW,
    );
    expect(stated.deadlineLabel).toBe('Apr 20, 2026, 1:00 PM ET');

    const dateOnly = getFellowshipApplicationStatus(
      makeFellowship({ deadline: '2026-04-21T03:59:59.999Z' }),
      NOW,
    );
    expect(dateOnly.deadlineLabel).toBe('Apr 20, 2026');
  });

  it('keeps a date-only deadline open until the end of its New York day', () => {
    const lateEveningInNewHaven = new Date('2026-04-21T01:00:00.000Z');
    const stored = (deadline: string) =>
      getFellowshipApplicationStatus(makeFellowship({ deadline }), lateEveningInNewHaven).kind;
    expect(stored('2026-04-20T23:59:59.999Z')).toBe('closingSoon');
    expect(stored('2026-04-21T03:59:59.999Z')).toBe('closingSoon');
    expect(stored('2026-04-20T17:00:00.000Z')).toBe('deadlinePassed');
  });
});

import { describe, expect, it } from 'vitest';

import { Fellowship } from '../../types/types';
import { getEligibilitySummary, getFellowshipApplicationStatus } from '../fellowshipStatus';

const NOW = new Date('2026-04-01T12:00:00.000Z');

const makeFellowship = (overrides: Partial<Fellowship> = {}): Fellowship => ({
  id: 'f-1',
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
    expect(status.detail).toBe('19 days left');
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

  it('flags accepting opportunities with unknown deadlines for admin review', () => {
    const status = getFellowshipApplicationStatus(makeFellowship({ deadline: null }), NOW);

    expect(status.kind).toBe('unknown');
    expect(status.label).toBe('Timing not confirmed');
    expect(status.needsDateReview).toBe(true);
    expect(status.isCurrentlyRelevant).toBe(true);
    expect(status.isApplicationWindowOpen).toBe(true);
  });

  it('keeps not-accepting opportunities without future open dates closed', () => {
    const status = getFellowshipApplicationStatus(
      makeFellowship({
        isAcceptingApplications: false,
        applicationOpenDate: '2026-03-01T12:00:00.000Z',
        deadline: '2026-05-01T12:00:00.000Z',
      }),
      NOW,
    );

    expect(status.kind).toBe('closed');
    expect(status.label).toBe('Not accepting applications');
    expect(status.isCurrentlyRelevant).toBe(false);
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

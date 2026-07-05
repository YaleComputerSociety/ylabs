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
  });

  it('does not present passed deadlines as open even when accepting is true', () => {
    const status = getFellowshipApplicationStatus(
      makeFellowship({ deadline: '2026-03-31T12:00:00.000Z' }),
      NOW,
    );

    expect(status.kind).toBe('deadlinePassed');
    expect(status.label).toBe('Deadline passed');
    expect(status.isCurrentlyRelevant).toBe(false);
  });

  it('distinguishes future application windows from closed opportunities', () => {
    const status = getFellowshipApplicationStatus(
      makeFellowship({ applicationOpenDate: '2026-04-10T12:00:00.000Z' }),
      NOW,
    );

    expect(status.kind).toBe('notOpenYet');
    expect(status.label).toBe('Opens soon');
    expect(status.isCurrentlyRelevant).toBe(true);
  });

  it('flags accepting opportunities with unknown deadlines for admin review', () => {
    const status = getFellowshipApplicationStatus(makeFellowship({ deadline: null }), NOW);

    expect(status.kind).toBe('unknown');
    expect(status.label).toBe('Timing not confirmed');
    expect(status.needsDateReview).toBe(true);
    expect(status.isCurrentlyRelevant).toBe(true);
  });

  it('flags missing eligibility when neither text nor structured filters are present', () => {
    const fellowship = makeFellowship({
      eligibility: '',
      yearOfStudy: [],
      termOfAward: [],
      citizenshipStatus: [],
    });
    const status = getFellowshipApplicationStatus(fellowship, NOW);

    expect(status.needsEligibilityReview).toBe(true);
    expect(getEligibilitySummary(fellowship)).toBe('Eligibility not specified');
  });
});

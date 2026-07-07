import { describe, expect, it } from 'vitest';

import { Fellowship, Listing } from '../types';
import { BrowsableItem, isItemOpen } from '../browsable';

const futureDate = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
};

const makeListing = (overrides: Partial<Listing> = {}): Listing => ({
  id: '507f1f77bcf86cd799439011',
  ownerId: '',
  ownerFirstName: 'Ada',
  ownerLastName: 'Lovelace',
  ownerEmail: '',
  ownerTitle: 'Professor',
  ownerPrimaryDepartment: 'Computer Science',
  professorIds: [],
  professorNames: [],
  title: 'Computing lab',
  departments: ['Computer Science'],
  emails: [],
  websites: [],
  description: 'Research description',
  applicantDescription: '',
  keywords: [],
  researchAreas: [],
  established: '',
  views: 0,
  favorites: 0,
  hiringStatus: 1,
  archived: false,
  updatedAt: '',
  createdAt: '',
  confirmed: true,
  audited: false,
  ...overrides,
});

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
  deadline: futureDate(30),
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

describe('isItemOpen', () => {
  it('preserves listing hiring status behavior', () => {
    expect(isItemOpen({ type: 'listing', data: makeListing({ hiringStatus: 0 }) })).toBe(true);
    expect(isItemOpen({ type: 'listing', data: makeListing({ hiringStatus: -1 }) })).toBe(false);
  });

  it('does not treat future fellowship application windows as open', () => {
    const item: BrowsableItem = {
      type: 'fellowship',
      data: makeFellowship({
        applicationOpenDate: futureDate(7),
        deadline: futureDate(30),
      }),
    };

    expect(isItemOpen(item)).toBe(false);
  });

  it('treats currently accepting fellowship windows as open', () => {
    const item: BrowsableItem = {
      type: 'fellowship',
      data: makeFellowship({
        applicationOpenDate: null,
        deadline: futureDate(30),
      }),
    };

    expect(isItemOpen(item)).toBe(true);
  });
});

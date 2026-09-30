import { describe, expect, it } from 'vitest';
import { programCategoryLabel, programRoleOf } from '../programJourney';
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

describe('programRoleOf (#3904)', () => {
  it('prefers the served programRole over the kind', () => {
    expect(
      programRoleOf(
        baseFellowship({ programKind: 'FELLOWSHIP_FUNDING', programRole: 'RECOGNIZES_RESEARCH' }),
      ),
    ).toBe('RECOGNIZES_RESEARCH');
  });

  it('falls back to the kind for a record served before its role was written', () => {
    expect(programRoleOf(baseFellowship({ programKind: 'DEPARTMENT_RESEARCH_GUIDE' }))).toBe(
      'STARTS_RESEARCH',
    );
    expect(programRoleOf(baseFellowship({ programKind: 'RESEARCH_AWARD' }))).toBe(
      'RECOGNIZES_RESEARCH',
    );
    expect(programRoleOf(baseFellowship())).toBe('FUNDS_RESEARCH');
    expect(programRoleOf(baseFellowship({ programKind: 'OTHER' }))).toBe('UNCLASSIFIED');
  });

  it('reads the served programRole through createFellowship', () => {
    const served = createFellowship({
      _id: 'served-award',
      programKind: 'FELLOWSHIP_FUNDING',
      programRole: 'RECOGNIZES_RESEARCH',
      title: 'Synthetic Award',
    });
    expect(programRoleOf(served)).toBe('RECOGNIZES_RESEARCH');
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

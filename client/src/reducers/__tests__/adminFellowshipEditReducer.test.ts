import { describe, expect, it } from 'vitest';

import { Fellowship } from '../../types/types';
import {
  adminFellowshipEditReducer,
  createInitialAdminFellowshipEditState,
} from '../adminFellowshipEditReducer';

const makeFellowship = (overrides: Partial<Fellowship> = {}): Fellowship => ({
  id: 'f-1',
  title: 'Research Fellowship',
  competitionType: '',
  summary: 'Summary',
  description: 'Desc',
  applicationInformation: 'Info',
  eligibility: 'Elig',
  restrictionsToUseOfAward: '',
  additionalInformation: '',
  links: [],
  applicationLink: 'https://apply',
  awardAmount: '$5000',
  isAcceptingApplications: true,
  applicationOpenDate: null,
  deadline: null,
  contactName: 'Ada',
  contactEmail: 'ada@yale.edu',
  contactPhone: '',
  contactOffice: '',
  yearOfStudy: ['Senior'],
  termOfAward: ['Summer'],
  purpose: ['Research'],
  globalRegions: ['Europe'],
  citizenshipStatus: [],
  archived: false,
  audited: false,
  views: 0,
  favorites: 0,
  updatedAt: '',
  createdAt: '',
  ...overrides,
});

describe('adminFellowshipEditReducer', () => {
  describe('createInitialAdminFellowshipEditState', () => {
    it('copies simple fields from the fellowship', () => {
      const state = createInitialAdminFellowshipEditState(makeFellowship());
      expect(state.title).toBe('Research Fellowship');
      expect(state.awardAmount).toBe('$5000');
      expect(state.isAcceptingApplications).toBe(true);
      expect(state.yearOfStudy).toEqual(['Senior']);
      expect(state.isSaving).toBe(false);
    });

    it('serializes deadline ISO to datetime-local format when present', () => {
      const state = createInitialAdminFellowshipEditState(
        makeFellowship({ deadline: '2026-04-01T12:00:00.000Z' }),
      );
      // "YYYY-MM-DDTHH:mm"
      expect(state.deadline).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    });

    it('leaves date strings empty when source fields are null', () => {
      const state = createInitialAdminFellowshipEditState(
        makeFellowship({ deadline: null, applicationOpenDate: null }),
      );
      expect(state.deadline).toBe('');
      expect(state.applicationOpenDate).toBe('');
    });

    it('copies arrays defensively (no shared references)', () => {
      const source = makeFellowship({ yearOfStudy: ['Senior'] });
      const state = createInitialAdminFellowshipEditState(source);
      state.yearOfStudy.push('Junior');
      expect(source.yearOfStudy).toEqual(['Senior']);
    });
  });

  describe('simple setters', () => {
    it('SET_TITLE updates the title', () => {
      const state = createInitialAdminFellowshipEditState(makeFellowship());
      const next = adminFellowshipEditReducer(state, {
        type: 'SET_TITLE',
        payload: 'New',
      });
      expect(next.title).toBe('New');
    });

    it('SET_IS_ACCEPTING_APPLICATIONS toggles the flag', () => {
      const state = createInitialAdminFellowshipEditState(
        makeFellowship({ isAcceptingApplications: true }),
      );
      const next = adminFellowshipEditReducer(state, {
        type: 'SET_IS_ACCEPTING_APPLICATIONS',
        payload: false,
      });
      expect(next.isAcceptingApplications).toBe(false);
    });

    it('SET_DEADLINE stores the datetime-local string as-is', () => {
      const state = createInitialAdminFellowshipEditState(makeFellowship());
      const next = adminFellowshipEditReducer(state, {
        type: 'SET_DEADLINE',
        payload: '2026-05-01T10:00',
      });
      expect(next.deadline).toBe('2026-05-01T10:00');
    });

    it('SET_SAVING flips isSaving', () => {
      const state = createInitialAdminFellowshipEditState(makeFellowship());
      const next = adminFellowshipEditReducer(state, { type: 'SET_SAVING', payload: true });
      expect(next.isSaving).toBe(true);
    });
  });

  describe('array setters', () => {
    it('SET_PURPOSE replaces the array', () => {
      const state = createInitialAdminFellowshipEditState(makeFellowship({ purpose: ['Old'] }));
      const next = adminFellowshipEditReducer(state, {
        type: 'SET_PURPOSE',
        payload: ['Research', 'Study Abroad'],
      });
      expect(next.purpose).toEqual(['Research', 'Study Abroad']);
    });

    it('SET_CITIZENSHIP_STATUS accepts empty array to clear', () => {
      const state = createInitialAdminFellowshipEditState(
        makeFellowship({ citizenshipStatus: ['US Citizen'] }),
      );
      const next = adminFellowshipEditReducer(state, {
        type: 'SET_CITIZENSHIP_STATUS',
        payload: [],
      });
      expect(next.citizenshipStatus).toEqual([]);
    });
  });

  it('does not mutate prior state', () => {
    const state = createInitialAdminFellowshipEditState(makeFellowship());
    const snapshot = JSON.stringify(state);
    adminFellowshipEditReducer(state, { type: 'SET_TITLE', payload: 'X' });
    adminFellowshipEditReducer(state, { type: 'SET_PURPOSE', payload: ['Z'] });
    adminFellowshipEditReducer(state, { type: 'SET_SAVING', payload: true });
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('returns the same reference for unknown actions', () => {
    const state = createInitialAdminFellowshipEditState(makeFellowship());
    // @ts-expect-error intentionally invalid
    expect(adminFellowshipEditReducer(state, { type: 'NOPE' })).toBe(state);
  });
});

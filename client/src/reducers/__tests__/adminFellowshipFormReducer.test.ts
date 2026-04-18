import { describe, expect, it } from 'vitest';

import {
  AdminFellowshipFormSource,
  adminFellowshipFormReducer,
  createInitialAdminFellowshipFormState,
  toDatetimeLocal,
} from '../adminFellowshipFormReducer';

const baseSource: AdminFellowshipFormSource = {
  title: 'Research Fellowship',
  competitionType: 'Application',
  summary: 'Summary',
  description: 'Description',
  applicationInformation: 'Apply via portal',
  eligibility: 'Undergrads',
  restrictionsToUseOfAward: 'Tuition only',
  additionalInformation: 'Additional',
  links: [{ label: 'Info', url: 'https://info' }],
  applicationLink: 'https://apply',
  awardAmount: '$5000',
  contactName: 'Ada',
  contactEmail: 'ada@yale.edu',
  contactPhone: '555-0100',
  contactOffice: '123 Hall',
  isAcceptingApplications: true,
  applicationOpenDate: null,
  deadline: null,
  yearOfStudy: ['Senior'],
  termOfAward: ['Summer'],
  purpose: ['Research'],
  globalRegions: ['Europe'],
  citizenshipStatus: ['US Citizen'],
  audited: false,
  archived: false,
};

describe('adminFellowshipFormReducer', () => {
  describe('createInitialAdminFellowshipFormState', () => {
    it('hydrates all fields from source', () => {
      const state = createInitialAdminFellowshipFormState(baseSource);
      expect(state.title).toBe('Research Fellowship');
      expect(state.competitionType).toBe('Application');
      expect(state.restrictionsToUseOfAward).toBe('Tuition only');
      expect(state.additionalInformation).toBe('Additional');
      expect(state.contactPhone).toBe('555-0100');
      expect(state.links).toEqual([{ label: 'Info', url: 'https://info' }]);
      expect(state.yearOfStudy).toEqual(['Senior']);
    });

    it('defaults missing optional strings to empty', () => {
      const minimal: AdminFellowshipFormSource = {
        ...baseSource,
        competitionType: undefined,
        applicationInformation: undefined,
        restrictionsToUseOfAward: undefined,
        additionalInformation: undefined,
        links: undefined,
        contactName: undefined,
        contactPhone: undefined,
        contactOffice: undefined,
        awardAmount: undefined,
        audited: undefined,
        archived: undefined,
      };
      const state = createInitialAdminFellowshipFormState(minimal);
      expect(state.competitionType).toBe('');
      expect(state.applicationInformation).toBe('');
      expect(state.restrictionsToUseOfAward).toBe('');
      expect(state.contactPhone).toBe('');
      expect(state.links).toEqual([]);
      expect(state.audited).toBe(false);
      expect(state.archived).toBe(false);
    });

    it('copies arrays defensively', () => {
      const links = [{ label: 'a', url: 'b' }];
      const state = createInitialAdminFellowshipFormState({ ...baseSource, links });
      state.links.push({ label: 'new', url: 'new' });
      expect(links).toHaveLength(1);
    });

    it('converts ISO deadline to local datetime-input format', () => {
      const state = createInitialAdminFellowshipFormState({
        ...baseSource,
        deadline: '2026-04-01T12:00:00.000Z',
      });
      expect(state.deadline).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    });

    it('empty string for null dates', () => {
      const state = createInitialAdminFellowshipFormState(baseSource);
      expect(state.deadline).toBe('');
      expect(state.applicationOpenDate).toBe('');
    });
  });

  describe('toDatetimeLocal', () => {
    it('returns empty for null/invalid', () => {
      expect(toDatetimeLocal(null)).toBe('');
      expect(toDatetimeLocal('not a date')).toBe('');
    });

    it('formats a valid ISO string into YYYY-MM-DDTHH:mm', () => {
      const result = toDatetimeLocal('2026-04-01T12:00:00.000Z');
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    });
  });

  describe('setters', () => {
    it('SET_LINKS replaces the links array', () => {
      const state = createInitialAdminFellowshipFormState(baseSource);
      const next = adminFellowshipFormReducer(state, {
        type: 'SET_LINKS',
        payload: [{ label: 'New', url: 'https://new' }],
      });
      expect(next.links).toEqual([{ label: 'New', url: 'https://new' }]);
    });

    it('SET_IS_ACCEPTING_APPLICATIONS toggles the flag', () => {
      const state = createInitialAdminFellowshipFormState({
        ...baseSource,
        isAcceptingApplications: true,
      });
      const next = adminFellowshipFormReducer(state, {
        type: 'SET_IS_ACCEPTING_APPLICATIONS',
        payload: false,
      });
      expect(next.isAcceptingApplications).toBe(false);
    });

    it('SET_DEADLINE stores datetime-local string as-is', () => {
      const state = createInitialAdminFellowshipFormState(baseSource);
      const next = adminFellowshipFormReducer(state, {
        type: 'SET_DEADLINE',
        payload: '2026-05-01T10:00',
      });
      expect(next.deadline).toBe('2026-05-01T10:00');
    });

    it('each scalar setter only touches its own field', () => {
      const state = createInitialAdminFellowshipFormState(baseSource);
      const afterCompType = adminFellowshipFormReducer(state, {
        type: 'SET_COMPETITION_TYPE',
        payload: 'New type',
      });
      expect(afterCompType.competitionType).toBe('New type');
      expect(afterCompType.title).toBe(state.title);
      expect(afterCompType.summary).toBe(state.summary);
    });

    it('SET_PURPOSE replaces the purpose array', () => {
      const state = createInitialAdminFellowshipFormState(baseSource);
      const next = adminFellowshipFormReducer(state, {
        type: 'SET_PURPOSE',
        payload: ['A', 'B'],
      });
      expect(next.purpose).toEqual(['A', 'B']);
    });
  });

  it('does not mutate prior state', () => {
    const state = createInitialAdminFellowshipFormState(baseSource);
    const snapshot = JSON.stringify(state);
    adminFellowshipFormReducer(state, { type: 'SET_TITLE', payload: 'X' });
    adminFellowshipFormReducer(state, {
      type: 'SET_LINKS',
      payload: [{ label: 'Y', url: 'Z' }],
    });
    adminFellowshipFormReducer(state, { type: 'SET_ARCHIVED', payload: true });
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});

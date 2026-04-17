import { describe, expect, it } from 'vitest';

import {
  adminListingEditReducer,
  createInitialAdminListingEditState,
} from '../adminListingEditReducer';

const baseListing = {
  title: 'Lab',
  description: 'Desc',
  applicantDescription: 'App',
  departments: ['Biology'],
  researchAreas: ['Genomics'],
  professorNames: ['Alice'],
  professorIds: ['alice123'],
  emails: ['a@b.com'],
  websites: ['https://example.com'],
  hiringStatus: 0,
  archived: false,
  confirmed: true,
  audited: false,
};

describe('adminListingEditReducer', () => {
  describe('createInitialAdminListingEditState', () => {
    it('hydrates fields from the listing', () => {
      const state = createInitialAdminListingEditState(baseListing);
      expect(state.title).toBe('Lab');
      expect(state.departments).toEqual(['Biology']);
      expect(state.professorNames).toEqual(['Alice']);
      expect(state.confirmed).toBe(true);
      expect(state.audited).toBe(false);
    });

    it('normalizes hiringStatus: >=0 becomes 0', () => {
      expect(
        createInitialAdminListingEditState({ ...baseListing, hiringStatus: 5 }).hiringStatus,
      ).toBe(0);
    });

    it('normalizes hiringStatus: negative becomes -1', () => {
      expect(
        createInitialAdminListingEditState({ ...baseListing, hiringStatus: -3 }).hiringStatus,
      ).toBe(-1);
    });

    it('defaults missing audited to false', () => {
      const { audited: _audited, ...rest } = baseListing;
      expect(createInitialAdminListingEditState(rest).audited).toBe(false);
    });

    it('starts with empty new-value inputs and closed dropdowns', () => {
      const state = createInitialAdminListingEditState(baseListing);
      expect(state.newProfName).toBe('');
      expect(state.newEmail).toBe('');
      expect(state.showDeptDropdown).toBe(false);
      expect(state.isSaving).toBe(false);
      expect(state.resetCreatedAt).toBe(false);
    });
  });

  describe('simple setters', () => {
    it('SET_TITLE updates title', () => {
      const state = createInitialAdminListingEditState(baseListing);
      const next = adminListingEditReducer(state, { type: 'SET_TITLE', payload: 'New' });
      expect(next.title).toBe('New');
    });

    it('SET_HIRING_STATUS accepts any value (not renormalized)', () => {
      const state = createInitialAdminListingEditState(baseListing);
      const next = adminListingEditReducer(state, { type: 'SET_HIRING_STATUS', payload: -1 });
      expect(next.hiringStatus).toBe(-1);
    });

    it('SET_SAVING toggles isSaving', () => {
      const state = createInitialAdminListingEditState(baseListing);
      const next = adminListingEditReducer(state, { type: 'SET_SAVING', payload: true });
      expect(next.isSaving).toBe(true);
    });
  });

  describe('array fields support value and updater', () => {
    it('SET_EMAILS replaces', () => {
      const state = createInitialAdminListingEditState(baseListing);
      const next = adminListingEditReducer(state, {
        type: 'SET_EMAILS',
        payload: ['c@d.com'],
      });
      expect(next.emails).toEqual(['c@d.com']);
    });

    it('SET_PROFESSOR_NAMES supports a functional updater', () => {
      const state = createInitialAdminListingEditState(baseListing);
      const next = adminListingEditReducer(state, {
        type: 'SET_PROFESSOR_NAMES',
        payload: (prev) => [...prev, 'Bob'],
      });
      expect(next.professorNames).toEqual(['Alice', 'Bob']);
    });
  });

  describe('department dropdown', () => {
    it('SET_DEPT_SEARCH opens the dropdown', () => {
      const state = createInitialAdminListingEditState(baseListing);
      const next = adminListingEditReducer(state, {
        type: 'SET_DEPT_SEARCH',
        payload: 'bio',
      });
      expect(next.deptSearch).toBe('bio');
      expect(next.showDeptDropdown).toBe(true);
    });

    it('ADD_DEPARTMENT appends and closes the dropdown', () => {
      const state = adminListingEditReducer(createInitialAdminListingEditState(baseListing), {
        type: 'SET_DEPT_SEARCH',
        payload: 'phys',
      });
      const next = adminListingEditReducer(state, {
        type: 'ADD_DEPARTMENT',
        payload: 'Physics',
      });
      expect(next.departments).toEqual(['Biology', 'Physics']);
      expect(next.deptSearch).toBe('');
      expect(next.showDeptDropdown).toBe(false);
    });

    it('ADD_DEPARTMENT is a no-op if the dept already exists', () => {
      const state = createInitialAdminListingEditState(baseListing);
      const next = adminListingEditReducer(state, {
        type: 'ADD_DEPARTMENT',
        payload: 'Biology',
      });
      expect(next).toBe(state);
    });
  });

  describe('research-area dropdown', () => {
    it('ADD_RESEARCH_AREA appends and clears search', () => {
      const state = createInitialAdminListingEditState(baseListing);
      const next = adminListingEditReducer(state, {
        type: 'ADD_RESEARCH_AREA',
        payload: 'Neuroscience',
      });
      expect(next.researchAreas).toEqual(['Genomics', 'Neuroscience']);
      expect(next.raSearch).toBe('');
      expect(next.showRaDropdown).toBe(false);
    });

    it('ADD_RESEARCH_AREA no-op when duplicate', () => {
      const state = createInitialAdminListingEditState(baseListing);
      const next = adminListingEditReducer(state, {
        type: 'ADD_RESEARCH_AREA',
        payload: 'Genomics',
      });
      expect(next).toBe(state);
    });
  });

  it('SET_NEW_* fields update their transient inputs', () => {
    const state = createInitialAdminListingEditState(baseListing);
    const afterProfName = adminListingEditReducer(state, {
      type: 'SET_NEW_PROF_NAME',
      payload: 'Typed',
    });
    expect(afterProfName.newProfName).toBe('Typed');
    const afterEmail = adminListingEditReducer(afterProfName, {
      type: 'SET_NEW_EMAIL',
      payload: 'new@x.com',
    });
    expect(afterEmail.newEmail).toBe('new@x.com');
    expect(afterEmail.newProfName).toBe('Typed');
  });

  it('does not mutate prior state', () => {
    const state = createInitialAdminListingEditState(baseListing);
    const snapshot = JSON.stringify(state);
    adminListingEditReducer(state, { type: 'ADD_DEPARTMENT', payload: 'Physics' });
    adminListingEditReducer(state, {
      type: 'SET_EMAILS',
      payload: (prev) => [...prev, 'x@y.com'],
    });
    adminListingEditReducer(state, { type: 'SET_SAVING', payload: true });
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});

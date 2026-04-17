import { describe, expect, it } from 'vitest';

import { Listing } from '../../types/types';
import {
  createInitialListingFormState,
  listingFormReducer,
} from '../listingFormReducer';

const makeListing = (overrides: Partial<Listing> = {}): Listing => ({
  id: 'id-1',
  ownerId: 'owner-1',
  ownerFirstName: 'Ada',
  ownerLastName: 'Lovelace',
  ownerEmail: 'ada@example.com',
  professorIds: ['prof-1'],
  professorNames: ['Prof One'],
  title: 'Initial title',
  departments: ['Computer Science'],
  emails: ['contact@example.com'],
  websites: ['https://example.com'],
  description: 'Initial description',
  applicantDescription: 'Prereqs',
  keywords: [],
  researchAreas: ['AI'],
  established: '2000',
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

describe('listingFormReducer', () => {
  describe('createInitialListingFormState', () => {
    it('hydrates from a listing', () => {
      const listing = makeListing();
      const state = createInitialListingFormState(listing);
      expect(state.title).toBe('Initial title');
      expect(state.ownerName).toBe('Ada Lovelace');
      expect(state.departments).toEqual(['Computer Science']);
      expect(state.researchAreas).toEqual(['AI']);
      expect(state.loading).toBe(true);
      expect(state.errors).toEqual({});
      expect(state.availableDepartments).toEqual([]);
    });

    it('falls back to keywords when researchAreas is empty', () => {
      const listing = makeListing({ researchAreas: [], keywords: ['keyword1', 'keyword2'] });
      const state = createInitialListingFormState(listing);
      expect(state.researchAreas).toEqual(['keyword1', 'keyword2']);
    });

    it('copies arrays so mutations do not leak back into the source listing', () => {
      const listing = makeListing({ departments: ['A', 'B'] });
      const state = createInitialListingFormState(listing);
      state.departments.push('C');
      expect(listing.departments).toEqual(['A', 'B']);
    });
  });

  describe('simple field setters', () => {
    it('SET_TITLE updates the title', () => {
      const state = createInitialListingFormState(makeListing());
      const next = listingFormReducer(state, { type: 'SET_TITLE', payload: 'New' });
      expect(next.title).toBe('New');
    });

    it('SET_ARCHIVED updates the flag', () => {
      const state = createInitialListingFormState(makeListing());
      const next = listingFormReducer(state, { type: 'SET_ARCHIVED', payload: true });
      expect(next.archived).toBe(true);
    });

    it('SET_LOADING toggles loading', () => {
      const state = createInitialListingFormState(makeListing());
      const next = listingFormReducer(state, { type: 'SET_LOADING', payload: false });
      expect(next.loading).toBe(false);
    });
  });

  describe('array setters accept value or updater', () => {
    it('SET_EMAILS replaces with an array', () => {
      const state = createInitialListingFormState(makeListing());
      const next = listingFormReducer(state, {
        type: 'SET_EMAILS',
        payload: ['a@b.com', 'c@d.com'],
      });
      expect(next.emails).toEqual(['a@b.com', 'c@d.com']);
    });

    it('SET_RESEARCH_AREAS supports a functional updater', () => {
      const state = createInitialListingFormState(makeListing({ researchAreas: ['AI'] }));
      const next = listingFormReducer(state, {
        type: 'SET_RESEARCH_AREAS',
        payload: (prev) => [...prev, 'ML'],
      });
      expect(next.researchAreas).toEqual(['AI', 'ML']);
    });
  });

  describe('errors', () => {
    it('SET_ERRORS replaces the error map', () => {
      const state = createInitialListingFormState(makeListing());
      const next = listingFormReducer(state, {
        type: 'SET_ERRORS',
        payload: { title: 'Required', emails: 'Bad email' },
      });
      expect(next.errors).toEqual({ title: 'Required', emails: 'Bad email' });
    });

    it('UPDATE_ERROR patches a single field', () => {
      const state = listingFormReducer(createInitialListingFormState(makeListing()), {
        type: 'SET_ERRORS',
        payload: { title: 'Required', emails: 'Bad' },
      });
      const next = listingFormReducer(state, {
        type: 'UPDATE_ERROR',
        field: 'title',
        value: undefined,
      });
      expect(next.errors.title).toBeUndefined();
      expect(next.errors.emails).toBe('Bad');
    });
  });

  describe('department add/remove', () => {
    it('ADD_DEPARTMENT moves a dept from available to selected', () => {
      const base = createInitialListingFormState(makeListing({ departments: [] }));
      const withAvailable = listingFormReducer(base, {
        type: 'SET_AVAILABLE_DEPARTMENTS',
        payload: ['Biology', 'Chemistry', 'Physics'],
      });
      const next = listingFormReducer(withAvailable, {
        type: 'ADD_DEPARTMENT',
        department: 'Chemistry',
      });
      expect(next.departments).toEqual(['Chemistry']);
      expect(next.availableDepartments).toEqual(['Biology', 'Physics']);
    });

    it('REMOVE_DEPARTMENT moves a dept back into available, keeping order sorted', () => {
      const base = createInitialListingFormState(
        makeListing({ departments: ['Biology', 'Chemistry', 'Physics'] })
      );
      const withAvailable = listingFormReducer(base, {
        type: 'SET_AVAILABLE_DEPARTMENTS',
        payload: ['Astronomy'],
      });
      const next = listingFormReducer(withAvailable, { type: 'REMOVE_DEPARTMENT', index: 1 });
      expect(next.departments).toEqual(['Biology', 'Physics']);
      expect(next.availableDepartments).toEqual(['Astronomy', 'Chemistry']);
    });
  });

  describe('HYDRATE', () => {
    it('replaces state from a newly fetched listing and clears loading', () => {
      const original = createInitialListingFormState(makeListing({ title: 'Old' }));
      const fetched = makeListing({ title: 'Fresh', departments: ['Physics'] });
      const next = listingFormReducer(original, {
        type: 'HYDRATE',
        listing: fetched,
        availableDepartments: ['Biology', 'Chemistry'],
      });
      expect(next.title).toBe('Fresh');
      expect(next.departments).toEqual(['Physics']);
      expect(next.availableDepartments).toEqual(['Biology', 'Chemistry']);
      expect(next.loading).toBe(false);
      expect(next.errors).toEqual({});
    });
  });

  describe('RESET_FROM_LISTING', () => {
    it('discards edits but keeps loading and availableDepartments', () => {
      const listing = makeListing({ title: 'Original' });
      const initial = createInitialListingFormState(listing);
      const edited = listingFormReducer(
        listingFormReducer(initial, { type: 'SET_TITLE', payload: 'Edited' }),
        { type: 'SET_AVAILABLE_DEPARTMENTS', payload: ['Keep', 'Me'] }
      );
      const reset = listingFormReducer(edited, { type: 'RESET_FROM_LISTING', listing });
      expect(reset.title).toBe('Original');
      expect(reset.availableDepartments).toEqual(['Keep', 'Me']);
      expect(reset.errors).toEqual({});
    });
  });

  describe('purity', () => {
    it('does not mutate prior state', () => {
      const listing = makeListing();
      const state = createInitialListingFormState(listing);
      const snapshot = JSON.stringify(state);
      listingFormReducer(state, { type: 'SET_TITLE', payload: 'X' });
      listingFormReducer(state, { type: 'ADD_DEPARTMENT', department: 'New' });
      listingFormReducer(state, {
        type: 'SET_EMAILS',
        payload: (prev) => [...prev, 'extra@example.com'],
      });
      expect(JSON.stringify(state)).toBe(snapshot);
    });
  });
});

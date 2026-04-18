import { describe, expect, it } from 'vitest';

import {
  createInitialOwnListingsState,
  ownListingsReducer,
} from '../ownListingsReducer';
import { Listing } from '../../types/types';

const makeListing = (overrides: Partial<Listing> = {}): Listing =>
  ({
    id: 'L1',
    ownerId: 'u1',
    ownerFirstName: 'Alice',
    ownerLastName: 'Nguyen',
    ownerEmail: 'alice@example.edu',
    professorIds: [],
    professorNames: [],
    title: 'Neural Dynamics Lab',
    departments: ['Neuroscience'],
    emails: [],
    websites: [],
    description: '',
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
  }) as Listing;

describe('ownListingsReducer', () => {
  describe('initial state', () => {
    it('starts empty with all flags off', () => {
      const state = createInitialOwnListingsState();
      expect(state.ownListings).toEqual([]);
      expect(state.isLoading).toBe(false);
      expect(state.isEditing).toBe(false);
      expect(state.isCreating).toBe(false);
    });

    it('applies overrides', () => {
      const state = createInitialOwnListingsState({ isLoading: true, isEditing: true });
      expect(state.isLoading).toBe(true);
      expect(state.isEditing).toBe(true);
      expect(state.isCreating).toBe(false);
    });
  });

  describe('SET_OWN_LISTINGS', () => {
    it('replaces the listings array', () => {
      const initial = createInitialOwnListingsState({
        ownListings: [makeListing({ id: 'old' })],
      });
      const fresh = [makeListing({ id: 'A' }), makeListing({ id: 'B' })];
      const next = ownListingsReducer(initial, {
        type: 'SET_OWN_LISTINGS',
        listings: fresh,
      });
      expect(next.ownListings).toBe(fresh);
      expect(next.ownListings.map((l) => l.id)).toEqual(['A', 'B']);
    });

    it('replaces with an empty array', () => {
      const initial = createInitialOwnListingsState({
        ownListings: [makeListing({ id: 'L1' })],
      });
      const next = ownListingsReducer(initial, { type: 'SET_OWN_LISTINGS', listings: [] });
      expect(next.ownListings).toEqual([]);
    });

    it('does not touch edit/create flags', () => {
      const initial = createInitialOwnListingsState({ isEditing: true, isCreating: true });
      const next = ownListingsReducer(initial, {
        type: 'SET_OWN_LISTINGS',
        listings: [makeListing()],
      });
      expect(next.isEditing).toBe(true);
      expect(next.isCreating).toBe(true);
    });
  });

  describe('SET_LOADING', () => {
    it('turns loading on', () => {
      const state = createInitialOwnListingsState();
      const next = ownListingsReducer(state, { type: 'SET_LOADING', value: true });
      expect(next.isLoading).toBe(true);
    });

    it('turns loading off', () => {
      const state = createInitialOwnListingsState({ isLoading: true });
      const next = ownListingsReducer(state, { type: 'SET_LOADING', value: false });
      expect(next.isLoading).toBe(false);
    });
  });

  describe('START_EDIT', () => {
    it('sets isEditing to true without affecting isCreating', () => {
      const state = createInitialOwnListingsState();
      const next = ownListingsReducer(state, { type: 'START_EDIT' });
      expect(next.isEditing).toBe(true);
      expect(next.isCreating).toBe(false);
    });

    it('preserves isCreating when already creating', () => {
      const state = createInitialOwnListingsState({ isCreating: true });
      const next = ownListingsReducer(state, { type: 'START_EDIT' });
      expect(next.isEditing).toBe(true);
      expect(next.isCreating).toBe(true);
    });
  });

  describe('END_EDIT', () => {
    it('clears both isEditing and isCreating (save-success path)', () => {
      const state = createInitialOwnListingsState({ isEditing: true, isCreating: true });
      const next = ownListingsReducer(state, { type: 'END_EDIT' });
      expect(next.isEditing).toBe(false);
      expect(next.isCreating).toBe(false);
    });

    it('is safe when neither flag is set (save-error path from clean state)', () => {
      const state = createInitialOwnListingsState();
      const next = ownListingsReducer(state, { type: 'END_EDIT' });
      expect(next.isEditing).toBe(false);
      expect(next.isCreating).toBe(false);
    });

    it('does not touch the listings array', () => {
      const listing = makeListing();
      const state = createInitialOwnListingsState({
        ownListings: [listing],
        isEditing: true,
      });
      const next = ownListingsReducer(state, { type: 'END_EDIT' });
      expect(next.ownListings).toBe(state.ownListings);
    });
  });

  describe('START_CREATE', () => {
    it('appends the skeleton and flips editing + creating flags', () => {
      const state = createInitialOwnListingsState();
      const skeleton = makeListing({ id: 'create' });
      const next = ownListingsReducer(state, { type: 'START_CREATE', skeleton });
      expect(next.ownListings).toEqual([skeleton]);
      expect(next.isEditing).toBe(true);
      expect(next.isCreating).toBe(true);
    });

    it('appends the skeleton after existing listings', () => {
      const existing = makeListing({ id: 'L1' });
      const state = createInitialOwnListingsState({ ownListings: [existing] });
      const skeleton = makeListing({ id: 'create' });
      const next = ownListingsReducer(state, { type: 'START_CREATE', skeleton });
      expect(next.ownListings.map((l) => l.id)).toEqual(['L1', 'create']);
      expect(next.isEditing).toBe(true);
      expect(next.isCreating).toBe(true);
    });
  });

  describe('CANCEL_CREATE', () => {
    it('removes the skeleton row and clears the flags', () => {
      const existing = makeListing({ id: 'L1' });
      const skeleton = makeListing({ id: 'create' });
      const state = createInitialOwnListingsState({
        ownListings: [existing, skeleton],
        isEditing: true,
        isCreating: true,
      });
      const next = ownListingsReducer(state, { type: 'CANCEL_CREATE' });
      expect(next.ownListings.map((l) => l.id)).toEqual(['L1']);
      expect(next.isEditing).toBe(false);
      expect(next.isCreating).toBe(false);
    });

    it('still clears flags when no skeleton is present', () => {
      const existing = makeListing({ id: 'L1' });
      const state = createInitialOwnListingsState({
        ownListings: [existing],
        isEditing: true,
        isCreating: true,
      });
      const next = ownListingsReducer(state, { type: 'CANCEL_CREATE' });
      expect(next.ownListings.map((l) => l.id)).toEqual(['L1']);
      expect(next.isEditing).toBe(false);
      expect(next.isCreating).toBe(false);
    });

    it('does not affect listings whose id merely contains "create"', () => {
      const keeper = makeListing({ id: 'creative-lab' });
      const skeleton = makeListing({ id: 'create' });
      const state = createInitialOwnListingsState({
        ownListings: [keeper, skeleton],
        isEditing: true,
        isCreating: true,
      });
      const next = ownListingsReducer(state, { type: 'CANCEL_CREATE' });
      expect(next.ownListings.map((l) => l.id)).toEqual(['creative-lab']);
    });
  });

  describe('UPDATE_LISTING', () => {
    it('replaces the matching listing in place', () => {
      const a = makeListing({ id: 'L1', title: 'Old' });
      const b = makeListing({ id: 'L2', title: 'B' });
      const state = createInitialOwnListingsState({ ownListings: [a, b] });
      const updated = makeListing({ id: 'L1', title: 'New' });
      const next = ownListingsReducer(state, { type: 'UPDATE_LISTING', listing: updated });
      expect(next.ownListings[0].title).toBe('New');
      expect(next.ownListings[1]).toBe(b);
    });

    it('is effectively a no-op when the id does not exist', () => {
      const a = makeListing({ id: 'L1' });
      const state = createInitialOwnListingsState({ ownListings: [a] });
      const updated = makeListing({ id: 'nope', title: 'New' });
      const next = ownListingsReducer(state, { type: 'UPDATE_LISTING', listing: updated });
      expect(next.ownListings.map((l) => l.id)).toEqual(['L1']);
      expect(next.ownListings[0]).toBe(a);
    });

    it('does not change loading or edit flags', () => {
      const a = makeListing({ id: 'L1' });
      const state = createInitialOwnListingsState({
        ownListings: [a],
        isEditing: true,
        isLoading: true,
      });
      const next = ownListingsReducer(state, {
        type: 'UPDATE_LISTING',
        listing: makeListing({ id: 'L1', title: 'Renamed' }),
      });
      expect(next.isEditing).toBe(true);
      expect(next.isLoading).toBe(true);
    });
  });

  describe('REMOVE_LISTING', () => {
    it('drops the matching listing', () => {
      const a = makeListing({ id: 'L1' });
      const b = makeListing({ id: 'L2' });
      const state = createInitialOwnListingsState({ ownListings: [a, b] });
      const next = ownListingsReducer(state, { type: 'REMOVE_LISTING', listingId: 'L1' });
      expect(next.ownListings.map((l) => l.id)).toEqual(['L2']);
    });

    it('is a no-op for an unknown id', () => {
      const a = makeListing({ id: 'L1' });
      const state = createInitialOwnListingsState({ ownListings: [a] });
      const next = ownListingsReducer(state, { type: 'REMOVE_LISTING', listingId: 'missing' });
      expect(next.ownListings).toEqual([a]);
    });
  });

  describe('purity', () => {
    it('does not mutate the previous listings array', () => {
      const a = makeListing({ id: 'L1' });
      const state = createInitialOwnListingsState({ ownListings: [a] });
      const snapshot = JSON.stringify(state);
      ownListingsReducer(state, {
        type: 'START_CREATE',
        skeleton: makeListing({ id: 'create' }),
      });
      ownListingsReducer(state, { type: 'REMOVE_LISTING', listingId: 'L1' });
      ownListingsReducer(state, {
        type: 'UPDATE_LISTING',
        listing: makeListing({ id: 'L1', title: 'X' }),
      });
      expect(JSON.stringify(state)).toBe(snapshot);
    });
  });

  it('returns state unchanged for an unknown action', () => {
    const state = createInitialOwnListingsState({ isEditing: true });
    const next = ownListingsReducer(state, { type: 'UNKNOWN' } as any);
    expect(next).toBe(state);
  });
});

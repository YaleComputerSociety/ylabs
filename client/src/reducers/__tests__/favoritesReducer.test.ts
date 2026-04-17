import { describe, expect, it } from 'vitest';

import {
  FavoritesState,
  createInitialFavoritesState,
  favoritesReducer,
} from '../favoritesReducer';
import { Fellowship, Listing } from '../../types/types';

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

const makeFellowship = (overrides: Partial<Fellowship> = {}): Fellowship =>
  ({
    id: 'F1',
    title: 'Rhodes',
    competitionType: '',
    summary: '',
    description: '',
    applicationInformation: '',
    eligibility: '',
    restrictionsToUseOfAward: '',
    additionalInformation: '',
    links: [],
    applicationLink: '',
    awardAmount: '',
    isAcceptingApplications: true,
    applicationOpenDate: null,
    deadline: null,
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    contactOffice: '',
    yearOfStudy: [],
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
  }) as Fellowship;

describe('favoritesReducer', () => {
  describe('initial state', () => {
    it('starts empty with dateAdded ascending sort', () => {
      const state = createInitialFavoritesState();
      expect(state.favListings).toEqual([]);
      expect(state.favListingsIds).toEqual([]);
      expect(state.favFellowships).toEqual([]);
      expect(state.favFellowshipIds).toEqual([]);
      expect(state.sortKey).toBe('dateAdded');
      expect(state.sortAsc).toBe(true);
      expect(state.deptFilter).toBeNull();
      expect(state.statusFilter).toBe('all');
      expect(state.dashboardView).toBe('list');
    });

    it('applies overrides', () => {
      const state = createInitialFavoritesState({ statusFilter: 'open', dashboardView: 'card' });
      expect(state.statusFilter).toBe('open');
      expect(state.dashboardView).toBe('card');
    });
  });

  describe('HYDRATE', () => {
    it('replaces only the provided fields', () => {
      const listing = makeListing();
      const base: FavoritesState = createInitialFavoritesState({
        statusFilter: 'emailed',
        sortKey: 'name',
      });
      const next = favoritesReducer(base, {
        type: 'HYDRATE',
        payload: { favListings: [listing], favListingsIds: [listing.id] },
      });
      expect(next.favListings).toEqual([listing]);
      expect(next.favListingsIds).toEqual([listing.id]);
      // sort/filter state unchanged
      expect(next.statusFilter).toBe('emailed');
      expect(next.sortKey).toBe('name');
    });
  });

  describe('ADD_FAV_LISTING', () => {
    it('prepends the listing and its id', () => {
      const existing = makeListing({ id: 'L0' });
      const state = createInitialFavoritesState({
        favListings: [existing],
        favListingsIds: ['L0'],
      });
      const incoming = makeListing({ id: 'L1' });
      const next = favoritesReducer(state, { type: 'ADD_FAV_LISTING', listing: incoming });
      expect(next.favListings.map((l) => l.id)).toEqual(['L1', 'L0']);
      expect(next.favListingsIds).toEqual(['L1', 'L0']);
    });

    it('is a no-op if the id is already favorited', () => {
      const existing = makeListing({ id: 'L1' });
      const state = createInitialFavoritesState({
        favListings: [existing],
        favListingsIds: ['L1'],
      });
      const next = favoritesReducer(state, { type: 'ADD_FAV_LISTING', listing: existing });
      expect(next).toBe(state);
    });
  });

  describe('REMOVE_FAV_LISTING', () => {
    it('removes the listing and its id', () => {
      const a = makeListing({ id: 'L1' });
      const b = makeListing({ id: 'L2' });
      const state = createInitialFavoritesState({
        favListings: [a, b],
        favListingsIds: ['L1', 'L2'],
      });
      const next = favoritesReducer(state, { type: 'REMOVE_FAV_LISTING', listingId: 'L1' });
      expect(next.favListings.map((l) => l.id)).toEqual(['L2']);
      expect(next.favListingsIds).toEqual(['L2']);
    });

    it('is a no-op for an unknown id', () => {
      const a = makeListing({ id: 'L1' });
      const state = createInitialFavoritesState({
        favListings: [a],
        favListingsIds: ['L1'],
      });
      const next = favoritesReducer(state, { type: 'REMOVE_FAV_LISTING', listingId: 'nope' });
      expect(next.favListings).toEqual(state.favListings);
      expect(next.favListingsIds).toEqual(state.favListingsIds);
    });
  });

  describe('UPDATE_FAV_LISTING', () => {
    it('replaces the listing with the same id without touching others', () => {
      const a = makeListing({ id: 'L1', title: 'Old' });
      const b = makeListing({ id: 'L2', title: 'B' });
      const state = createInitialFavoritesState({
        favListings: [a, b],
        favListingsIds: ['L1', 'L2'],
      });
      const updated = makeListing({ id: 'L1', title: 'New' });
      const next = favoritesReducer(state, { type: 'UPDATE_FAV_LISTING', listing: updated });
      expect(next.favListings[0].title).toBe('New');
      expect(next.favListings[1]).toBe(b);
      // id list untouched
      expect(next.favListingsIds).toBe(state.favListingsIds);
    });
  });

  describe('fellowship favorites', () => {
    it('SET_FAV_FELLOWSHIPS replaces both the list and the ids', () => {
      const fellowship = makeFellowship();
      const next = favoritesReducer(createInitialFavoritesState(), {
        type: 'SET_FAV_FELLOWSHIPS',
        favFellowships: [fellowship],
        favFellowshipIds: [fellowship.id],
      });
      expect(next.favFellowships).toEqual([fellowship]);
      expect(next.favFellowshipIds).toEqual([fellowship.id]);
    });

    it('ADD_FAV_FELLOWSHIP_ID prepends and dedupes', () => {
      const state = createInitialFavoritesState({ favFellowshipIds: ['F1'] });
      const added = favoritesReducer(state, {
        type: 'ADD_FAV_FELLOWSHIP_ID',
        fellowshipId: 'F2',
      });
      expect(added.favFellowshipIds).toEqual(['F2', 'F1']);
      const deduped = favoritesReducer(added, {
        type: 'ADD_FAV_FELLOWSHIP_ID',
        fellowshipId: 'F1',
      });
      expect(deduped).toBe(added);
    });

    it('REMOVE_FAV_FELLOWSHIP drops the fellowship and the id', () => {
      const a = makeFellowship({ id: 'F1' });
      const b = makeFellowship({ id: 'F2' });
      const state = createInitialFavoritesState({
        favFellowships: [a, b],
        favFellowshipIds: ['F1', 'F2'],
      });
      const next = favoritesReducer(state, { type: 'REMOVE_FAV_FELLOWSHIP', fellowshipId: 'F1' });
      expect(next.favFellowships.map((f) => f.id)).toEqual(['F2']);
      expect(next.favFellowshipIds).toEqual(['F2']);
    });

    it('REMOVE_FAV_FELLOWSHIP matches legacy fellowships that only have _id', () => {
      const legacy = { ...makeFellowship({ id: '' }), _id: 'F1' } as Fellowship;
      const state = createInitialFavoritesState({
        favFellowships: [legacy],
        favFellowshipIds: ['F1'],
      });
      const next = favoritesReducer(state, { type: 'REMOVE_FAV_FELLOWSHIP', fellowshipId: 'F1' });
      expect(next.favFellowships).toEqual([]);
      expect(next.favFellowshipIds).toEqual([]);
    });
  });

  describe('sort transitions', () => {
    it('TOGGLE_SORT flips direction when the same key is reused', () => {
      const state = createInitialFavoritesState({ sortKey: 'name', sortAsc: true });
      const next = favoritesReducer(state, { type: 'TOGGLE_SORT', key: 'name' });
      expect(next.sortKey).toBe('name');
      expect(next.sortAsc).toBe(false);
    });

    it('TOGGLE_SORT switches to a new key and resets to ascending', () => {
      const state = createInitialFavoritesState({ sortKey: 'name', sortAsc: false });
      const next = favoritesReducer(state, { type: 'TOGGLE_SORT', key: 'department' });
      expect(next.sortKey).toBe('department');
      expect(next.sortAsc).toBe(true);
    });

    it('SET_SORT forces both key and direction', () => {
      const state = createInitialFavoritesState();
      const next = favoritesReducer(state, { type: 'SET_SORT', key: 'status', asc: false });
      expect(next.sortKey).toBe('status');
      expect(next.sortAsc).toBe(false);
    });
  });

  describe('filter + view setters', () => {
    it('SET_DEPT_FILTER accepts a value or null', () => {
      const state = createInitialFavoritesState();
      const filtered = favoritesReducer(state, { type: 'SET_DEPT_FILTER', value: 'CS' });
      expect(filtered.deptFilter).toBe('CS');
      const cleared = favoritesReducer(filtered, { type: 'SET_DEPT_FILTER', value: null });
      expect(cleared.deptFilter).toBeNull();
    });

    it('SET_STATUS_FILTER updates just the status filter', () => {
      const state = createInitialFavoritesState({ sortKey: 'name' });
      const next = favoritesReducer(state, { type: 'SET_STATUS_FILTER', value: 'emailed' });
      expect(next.statusFilter).toBe('emailed');
      expect(next.sortKey).toBe('name');
    });

    it('SET_DASHBOARD_VIEW toggles between list and card', () => {
      const state = createInitialFavoritesState();
      const card = favoritesReducer(state, { type: 'SET_DASHBOARD_VIEW', value: 'card' });
      expect(card.dashboardView).toBe('card');
      const list = favoritesReducer(card, { type: 'SET_DASHBOARD_VIEW', value: 'list' });
      expect(list.dashboardView).toBe('list');
    });
  });

  it('returns state unchanged for an unknown action', () => {
    const state = createInitialFavoritesState({ sortKey: 'name' });
    const next = favoritesReducer(state, { type: 'UNKNOWN' } as any);
    expect(next).toBe(state);
  });
});

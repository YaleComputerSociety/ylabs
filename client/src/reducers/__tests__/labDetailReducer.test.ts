import { describe, expect, it } from 'vitest';

import { ResearchGroup } from '../../types/researchGroup';
import { ResearchEntityDetailPayload } from '../../types/researchEntity';
import { Listing } from '../../types/types';
import {
  createInitialLabDetailState,
  labDetailReducer,
} from '../labDetailReducer';

const sampleGroup: ResearchGroup = {
  _id: 'g1',
  slug: 'synthetic-computation-lab',
  name: 'Synthetic Computation Lab',
  kind: 'lab',
  description: 'We study synthetic systems.',
  websiteUrl: 'https://synthetic-computation.example.test',
  location: 'Fixture Hall, Room 200',
  departments: ['Computer Science'],
  researchAreas: ['Theoretical CS'],
  school: 'Fixture School of Research',
  openness: 'open',
  acceptingUndergrads: true,
  typicalUndergradRoles: ['Research Assistant'],
  prerequisiteCourses: ['CPSC 201'],
  creditOptions: ['CPSC 490'],
  fundingPrograms: [],
  contactEmail: 'fixture.contact@example.test',
  contactName: 'Fixture Contact',
  contactRole: 'PI',
  sourceUrls: [],
};

const sampleListing: Listing = {
  id: 'l1',
  ownerId: 'fixture_owner',
  ownerFirstName: 'Fixture',
  ownerLastName: 'Owner',
  ownerEmail: 'fixture.owner@example.test',
  professorIds: [],
  professorNames: [],
  title: 'Undergrad RA opening',
  departments: ['Computer Science'],
  emails: [],
  websites: [],
  description: 'desc',
  applicantDescription: '',
  keywords: [],
  researchAreas: [],
  established: '',
  views: 0,
  favorites: 0,
  hiringStatus: 0,
  archived: false,
  updatedAt: '',
  createdAt: '',
  confirmed: true,
  audited: false,
};

const samplePayload: ResearchEntityDetailPayload = {
  group: sampleGroup,
  researchEntity: sampleGroup,
  members: [
    {
      user: {
        netid: 'fixture_owner',
        fname: 'Fixture',
        lname: 'Owner',
        image_url: '',
        primary_department: 'Computer Science',
        title: 'Professor',
      },
      role: 'pi',
    },
  ],
  recentPapers: [
    {
      _id: 'p1',
      title: 'Synthetic systems note',
      year: 1843,
      venue: 'Fixture Research Notes',
      tldr: 'A foundational paper.',
    },
  ],
  activeListings: [sampleListing],
};

const otherPayload: ResearchEntityDetailPayload = {
  ...samplePayload,
  group: {
    ...sampleGroup,
    _id: 'g2',
    slug: 'synthetic-systems-lab',
    name: 'Synthetic Systems Lab',
  },
  researchEntity: {
    ...sampleGroup,
    _id: 'g2',
    slug: 'synthetic-systems-lab',
    name: 'Synthetic Systems Lab',
  },
};

describe('labDetailReducer', () => {
  it('initial state starts loading with no payload, no error, modal closed', () => {
    const state = createInitialLabDetailState();
    expect(state.loading).toBe(true);
    expect(state.payload).toBeNull();
    expect(state.error).toBeNull();
    expect(state.isInquireModalOpen).toBe(false);
  });

  it('FETCH_START sets loading, clears error, and closes the inquire modal', () => {
    const state = createInitialLabDetailState({
      error: 'old failure',
      loading: false,
      payload: samplePayload,
      isInquireModalOpen: true,
    });
    const next = labDetailReducer(state, { type: 'FETCH_START' });
    expect(next.loading).toBe(true);
    expect(next.error).toBeNull();
    expect(next.isInquireModalOpen).toBe(false);
    // Stale payload is preserved during refetch
    expect(next.payload).toBe(samplePayload);
  });

  it('FETCH_SUCCESS populates payload and clears loading/error', () => {
    const state = createInitialLabDetailState({ error: 'network blip' });
    const next = labDetailReducer(state, { type: 'FETCH_SUCCESS', payload: samplePayload });
    expect(next.loading).toBe(false);
    expect(next.error).toBeNull();
    expect(next.payload).toEqual(samplePayload);
  });

  it('FETCH_FAILURE preserves a prior payload (stale is better than empty)', () => {
    const loaded = labDetailReducer(createInitialLabDetailState(), {
      type: 'FETCH_SUCCESS',
      payload: samplePayload,
    });
    const next = labDetailReducer(loaded, {
      type: 'FETCH_FAILURE',
      payload: 'Lab not found.',
    });
    expect(next.error).toBe('Lab not found.');
    expect(next.loading).toBe(false);
    expect(next.payload).toBe(samplePayload);
  });

  it('OPEN_INQUIRE_MODAL is a no-op when no payload is loaded', () => {
    const state = createInitialLabDetailState();
    const next = labDetailReducer(state, { type: 'OPEN_INQUIRE_MODAL' });
    expect(next).toBe(state);
    expect(next.isInquireModalOpen).toBe(false);
  });

  it('OPEN_INQUIRE_MODAL flips the toggle once the payload is present', () => {
    const loaded = labDetailReducer(createInitialLabDetailState(), {
      type: 'FETCH_SUCCESS',
      payload: samplePayload,
    });
    const opened = labDetailReducer(loaded, { type: 'OPEN_INQUIRE_MODAL' });
    expect(opened.isInquireModalOpen).toBe(true);
    expect(opened.payload).toBe(samplePayload);
    const closed = labDetailReducer(opened, { type: 'CLOSE_INQUIRE_MODAL' });
    expect(closed.isInquireModalOpen).toBe(false);
  });

  it('CLOSE_INQUIRE_MODAL is safe to call when modal is already closed', () => {
    const state = createInitialLabDetailState();
    const next = labDetailReducer(state, { type: 'CLOSE_INQUIRE_MODAL' });
    expect(next.isInquireModalOpen).toBe(false);
  });

  it('reducer does not mutate prior state', () => {
    const state = createInitialLabDetailState();
    const snapshot = JSON.stringify(state);
    labDetailReducer(state, { type: 'FETCH_SUCCESS', payload: samplePayload });
    labDetailReducer(state, { type: 'FETCH_FAILURE', payload: 'x' });
    labDetailReducer(state, { type: 'OPEN_INQUIRE_MODAL' });
    labDetailReducer(state, { type: 'CLOSE_INQUIRE_MODAL' });
    labDetailReducer(state, { type: 'FETCH_SUCCESS', payload: otherPayload });
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('returns same reference for unknown action', () => {
    const state = createInitialLabDetailState();
    // @ts-expect-error intentionally invalid
    expect(labDetailReducer(state, { type: 'NOPE' })).toBe(state);
  });
});

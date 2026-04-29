import { describe, expect, it } from 'vitest';

import { LabDetailPayload } from '../../types/labDetail';
import { ResearchGroup } from '../../types/researchGroup';
import { Listing } from '../../types/types';
import {
  createInitialLabDetailState,
  labDetailReducer,
} from '../labDetailReducer';

const sampleGroup: ResearchGroup = {
  _id: 'g1',
  slug: 'lovelace-lab',
  name: 'Lovelace Computational Lab',
  kind: 'lab',
  description: 'We study analytical engines.',
  websiteUrl: 'https://example.edu/lovelace',
  location: 'Watson Center, Room 200',
  departments: ['Computer Science'],
  researchAreas: ['Theoretical CS'],
  school: 'School of Engineering & Applied Science',
  openness: 'open',
  acceptingUndergrads: true,
  typicalUndergradRoles: ['Research Assistant'],
  prerequisiteCourses: ['CPSC 201'],
  creditOptions: ['CPSC 490'],
  fundingPrograms: [],
  contactEmail: 'ada@example.edu',
  contactName: 'Ada Lovelace',
  contactRole: 'PI',
  sourceUrls: [],
};

const sampleListing: Listing = {
  id: 'l1',
  ownerId: 'abc123',
  ownerFirstName: 'Ada',
  ownerLastName: 'Lovelace',
  ownerEmail: 'ada@example.edu',
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

const samplePayload: LabDetailPayload = {
  group: sampleGroup,
  members: [
    {
      user: {
        netid: 'abc123',
        fname: 'Ada',
        lname: 'Lovelace',
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
      title: 'On the analytical engine',
      year: 1843,
      venue: 'Notes on the Analytical Engine',
      tldr: 'A foundational paper.',
    },
  ],
  activeListings: [sampleListing],
};

const otherPayload: LabDetailPayload = {
  ...samplePayload,
  group: { ...sampleGroup, _id: 'g2', slug: 'hopper-lab', name: 'Hopper Lab' },
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

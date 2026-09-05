import { describe, expect, it } from 'vitest';

import { ResearchGroup } from '../../types/researchGroup';
import { ResearchEntityDetailPayload } from '../../types/researchEntity';
import { createInitialLabDetailState, labDetailReducer } from '../labDetailReducer';

const sampleGroup: ResearchGroup = {
  _id: 'g1',
  slug: 'synthetic-computation-lab',
  name: 'Synthetic Computation Lab',
  kind: 'lab',
  websiteUrl: 'https://synthetic-computation.example.test',
  location: 'Fixture Hall, Room 200',
  departments: ['Computer Science'],
  researchAreas: ['Theoretical CS'],
  school: 'Fixture School of Research',
  typicalUndergradRoles: ['Research Assistant'],
  prerequisiteCourses: ['CPSC 201'],
  creditOptions: ['CPSC 490'],
  fundingPrograms: [],
  contactEmail: 'fixture.contact@example.test',
  contactName: 'Fixture Contact',
  contactRole: 'PI',
  sourceUrls: [],
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
  it('initial state starts loading with no payload or error', () => {
    const state = createInitialLabDetailState();
    expect(state.loading).toBe(true);
    expect(state.payload).toBeNull();
    expect(state.error).toBeNull();
  });

  it('FETCH_START sets loading and clears error', () => {
    const state = createInitialLabDetailState({
      error: 'old failure',
      loading: false,
      payload: samplePayload,
    });
    const next = labDetailReducer(state, { type: 'FETCH_START' });
    expect(next.loading).toBe(true);
    expect(next.error).toBeNull();
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

  it('reducer does not mutate prior state', () => {
    const state = createInitialLabDetailState();
    const snapshot = JSON.stringify(state);
    labDetailReducer(state, { type: 'FETCH_SUCCESS', payload: samplePayload });
    labDetailReducer(state, { type: 'FETCH_FAILURE', payload: 'x' });
    labDetailReducer(state, { type: 'FETCH_SUCCESS', payload: otherPayload });
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('returns same reference for unknown action', () => {
    const state = createInitialLabDetailState();
    // @ts-expect-error intentionally invalid
    expect(labDetailReducer(state, { type: 'NOPE' })).toBe(state);
  });
});

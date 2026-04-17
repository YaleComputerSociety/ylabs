import { describe, expect, it } from 'vitest';

import { ConfigPayload, configReducer, createInitialConfigState } from '../configReducer';

const samplePayload: ConfigPayload = {
  researchAreas: [{ name: 'Neuroscience', field: 'Biology', colorKey: 'blue', isDefault: true }],
  researchFields: [{ name: 'Biology', colorKey: 'blue' }],
  fieldOrder: ['Biology'],
  departments: [
    {
      abbreviation: 'NEURO',
      name: 'Neuroscience',
      displayName: 'Neuroscience',
      categories: ['Sciences'],
      primaryCategory: 'Sciences',
      colorKey: 0,
    },
  ],
  departmentCategories: ['Sciences'],
};

describe('configReducer', () => {
  it('initial state starts in loading with no error and empty collections', () => {
    const state = createInitialConfigState();
    expect(state.isLoading).toBe(true);
    expect(state.isLoaded).toBe(false);
    expect(state.error).toBeNull();
    expect(state.researchAreas).toEqual([]);
    expect(state.departments).toEqual([]);
  });

  it('FETCH_START sets loading and clears prior error', () => {
    const state = createInitialConfigState({ error: 'old', isLoading: false });
    const next = configReducer(state, { type: 'FETCH_START' });
    expect(next.isLoading).toBe(true);
    expect(next.error).toBeNull();
  });

  it('FETCH_SUCCESS populates collections and marks loaded', () => {
    const state = createInitialConfigState();
    const next = configReducer(state, { type: 'FETCH_SUCCESS', payload: samplePayload });
    expect(next.isLoading).toBe(false);
    expect(next.isLoaded).toBe(true);
    expect(next.error).toBeNull();
    expect(next.researchAreas).toEqual(samplePayload.researchAreas);
    expect(next.departments).toEqual(samplePayload.departments);
    expect(next.departmentCategories).toEqual(['Sciences']);
  });

  it('FETCH_SUCCESS clears a previous error', () => {
    const state = createInitialConfigState({ error: 'network blip' });
    const next = configReducer(state, { type: 'FETCH_SUCCESS', payload: samplePayload });
    expect(next.error).toBeNull();
  });

  it('FETCH_FAILURE records the error message and stops loading without clearing data', () => {
    const loaded = configReducer(createInitialConfigState(), {
      type: 'FETCH_SUCCESS',
      payload: samplePayload,
    });
    const next = configReducer(loaded, { type: 'FETCH_FAILURE', payload: 'Server down' });
    expect(next.error).toBe('Server down');
    expect(next.isLoading).toBe(false);
    // isLoaded should remain true — we still have the old config, stale is better than empty
    expect(next.isLoaded).toBe(true);
    expect(next.departments).toEqual(samplePayload.departments);
  });

  it('reducer does not mutate prior state', () => {
    const state = createInitialConfigState();
    const snapshot = JSON.stringify(state);
    configReducer(state, { type: 'FETCH_SUCCESS', payload: samplePayload });
    configReducer(state, { type: 'FETCH_FAILURE', payload: 'x' });
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('returns same reference for unknown action', () => {
    const state = createInitialConfigState();
    // @ts-expect-error intentionally invalid
    expect(configReducer(state, { type: 'NOPE' })).toBe(state);
  });
});

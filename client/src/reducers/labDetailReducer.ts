/**
 * Pure reducer for the research detail page (`/research/:slug`).
 *
 * Models the fetch lifecycle for the `GET /api/research/:slug` payload
 * (idle → loading → loaded/error).
 *
 * Following the convention from `configReducer`:
 * stale data is preserved on FETCH_FAILURE so a transient network blip does
 * not blank out the page if a prior load succeeded.
 *
 */
import { ResearchEntityDetailPayload } from '../types/researchEntity';

export interface LabDetailState {
  payload: ResearchEntityDetailPayload | null;
  loading: boolean;
  error: string | null;
}

export type LabDetailAction =
  | { type: 'FETCH_START' }
  | { type: 'FETCH_SUCCESS'; payload: ResearchEntityDetailPayload }
  | { type: 'FETCH_FAILURE'; payload: string };

export const createInitialLabDetailState = (
  overrides: Partial<LabDetailState> = {},
): LabDetailState => ({
  payload: null,
  loading: true,
  error: null,
  ...overrides,
});

export function labDetailReducer(state: LabDetailState, action: LabDetailAction): LabDetailState {
  switch (action.type) {
    case 'FETCH_START':
      return { ...state, loading: true, error: null };

    case 'FETCH_SUCCESS':
      return {
        ...state,
        loading: false,
        error: null,
        payload: action.payload,
      };

    case 'FETCH_FAILURE':
      // Preserve stale payload — stale is better than empty if a prior load succeeded.
      return {
        ...state,
        loading: false,
        error: action.payload,
      };

    default:
      return state;
  }
}

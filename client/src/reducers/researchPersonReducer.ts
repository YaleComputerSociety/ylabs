import { ResearcherProfilePayload } from '../types/researcherProfile';

export interface ResearchPersonState {
  payload: ResearcherProfilePayload | null;
  loading: boolean;
  error: string | null;
  notFound: boolean;
}

export type ResearchPersonAction =
  | { type: 'FETCH_START' }
  | { type: 'FETCH_SUCCESS'; payload: ResearcherProfilePayload }
  | { type: 'FETCH_NOT_FOUND' }
  | { type: 'FETCH_FAILURE'; payload: string };

export const createInitialResearchPersonState = (
  overrides: Partial<ResearchPersonState> = {},
): ResearchPersonState => ({
  payload: null,
  loading: true,
  error: null,
  notFound: false,
  ...overrides,
});

export function researchPersonReducer(
  state: ResearchPersonState,
  action: ResearchPersonAction,
): ResearchPersonState {
  switch (action.type) {
    case 'FETCH_START':
      return { ...state, loading: true, error: null, notFound: false };

    case 'FETCH_SUCCESS':
      return { ...state, loading: false, error: null, notFound: false, payload: action.payload };

    case 'FETCH_NOT_FOUND':
      return { ...state, loading: false, error: null, notFound: true, payload: null };

    case 'FETCH_FAILURE':
      return { ...state, loading: false, error: action.payload };

    default:
      return state;
  }
}

/**
 * Pure reducer for the research detail page (`/research/:slug`).
 *
 * Models the fetch lifecycle for the `GET /api/research/:slug` payload
 * (idle → loading → loaded/error), plus a UI-only toggle for the Inquire modal.
 *
 * Following the convention from `configReducer` and `profilePageReducer`:
 * stale data is preserved on FETCH_FAILURE so a transient network blip does
 * not blank out the page if a prior load succeeded.
 *
 * The Inquire-modal toggle is intentionally inside the same reducer (rather
 * than a separate `useState`) so all transitions tied to the lab record live
 * in one place — closing the modal on a fresh fetch, for instance, becomes
 * a single state transition rather than a coordination dance between hooks.
 */
import { LabDetailPayload } from '../types/labDetail';

export interface LabDetailState {
  payload: LabDetailPayload | null;
  loading: boolean;
  error: string | null;
  isInquireModalOpen: boolean;
}

export type LabDetailAction =
  | { type: 'FETCH_START' }
  | { type: 'FETCH_SUCCESS'; payload: LabDetailPayload }
  | { type: 'FETCH_FAILURE'; payload: string }
  | { type: 'OPEN_INQUIRE_MODAL' }
  | { type: 'CLOSE_INQUIRE_MODAL' };

export const createInitialLabDetailState = (
  overrides: Partial<LabDetailState> = {},
): LabDetailState => ({
  payload: null,
  loading: true,
  error: null,
  isInquireModalOpen: false,
  ...overrides,
});

export function labDetailReducer(
  state: LabDetailState,
  action: LabDetailAction,
): LabDetailState {
  switch (action.type) {
    case 'FETCH_START':
      // Close any open inquire modal — the contact info may change after refetch.
      return { ...state, loading: true, error: null, isInquireModalOpen: false };

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

    case 'OPEN_INQUIRE_MODAL':
      // No-op if there is no payload yet; the modal needs contact info to render.
      if (!state.payload) return state;
      return { ...state, isInquireModalOpen: true };

    case 'CLOSE_INQUIRE_MODAL':
      return { ...state, isInquireModalOpen: false };

    default:
      return state;
  }
}

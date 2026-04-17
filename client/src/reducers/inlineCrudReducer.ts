/**
 * Generic reducer for admin "inline-edit CRUD" tables.
 *
 * Shape shared by AdminDepartments, AdminResearchAreas, and any future
 * admin tab that lets you add new rows at the top and edit existing rows
 * in place (no server-side pagination, client-side search).
 *
 * Type parameters:
 *   - T         — row type (e.g. DepartmentDoc, ResearchArea)
 *   - NewDraft  — shape of the "add new" form
 *   - EditDraft — shape of the "edit existing row" form
 *
 * NewDraft and EditDraft can differ (editing exposes fields like `isActive`
 * that aren't asked for when creating). SET_NEW_DRAFT and SET_EDIT_DRAFT
 * take a Partial, so callers patch one field at a time.
 */

export interface InlineCrudState<T, NewDraft, EditDraft> {
  items: T[];
  isLoading: boolean;
  search: string;
  newDraft: NewDraft;
  editingId: string | null;
  editDraft: EditDraft | null;
}

export type InlineCrudAction<T, NewDraft, EditDraft> =
  | { type: 'FETCH_START' }
  | { type: 'FETCH_SUCCESS'; items: T[] }
  | { type: 'FETCH_FAILURE' }
  | { type: 'SET_SEARCH'; payload: string }
  | { type: 'SET_NEW_DRAFT'; payload: Partial<NewDraft> }
  | { type: 'RESET_NEW_DRAFT'; initial: NewDraft }
  | { type: 'START_EDIT'; id: string; draft: EditDraft }
  | { type: 'SET_EDIT_DRAFT'; payload: Partial<EditDraft> }
  | { type: 'CANCEL_EDIT' };

export const createInitialInlineCrudState = <T, NewDraft, EditDraft>(
  newDraft: NewDraft,
): InlineCrudState<T, NewDraft, EditDraft> => ({
  items: [],
  isLoading: true,
  search: '',
  newDraft,
  editingId: null,
  editDraft: null,
});

export function inlineCrudReducer<T, NewDraft, EditDraft>(
  state: InlineCrudState<T, NewDraft, EditDraft>,
  action: InlineCrudAction<T, NewDraft, EditDraft>,
): InlineCrudState<T, NewDraft, EditDraft> {
  switch (action.type) {
    case 'FETCH_START':
      return { ...state, isLoading: true };

    case 'FETCH_SUCCESS':
      return { ...state, isLoading: false, items: action.items };

    case 'FETCH_FAILURE':
      return { ...state, isLoading: false };

    case 'SET_SEARCH':
      return { ...state, search: action.payload };

    case 'SET_NEW_DRAFT':
      return { ...state, newDraft: { ...state.newDraft, ...action.payload } };

    case 'RESET_NEW_DRAFT':
      return { ...state, newDraft: action.initial };

    case 'START_EDIT':
      return { ...state, editingId: action.id, editDraft: action.draft };

    case 'SET_EDIT_DRAFT':
      // Silently ignore if no row is being edited — SET_EDIT_DRAFT during a
      // stale keystroke shouldn't synthesize a phantom draft.
      return state.editDraft === null
        ? state
        : { ...state, editDraft: { ...state.editDraft, ...action.payload } };

    case 'CANCEL_EDIT':
      return { ...state, editingId: null, editDraft: null };

    default:
      return state;
  }
}

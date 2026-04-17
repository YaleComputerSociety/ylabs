/**
 * Pure reducer for the faculty ProfileEditor.
 *
 * Covers three intertwined concerns:
 *   1. Form values being edited (bio, primaryDept, secondaryDepts, research
 *      interests, image URL)
 *   2. The primary-department combobox UI (search text, open state, keyboard
 *      focus index)
 *   3. The fetch/save lifecycle (profile, loading, saving, editing mode,
 *      success/error message, validation errors)
 *
 * Keeping these together lets the component use a single useReducer while
 * letting the transitions stay unit-testable.
 */
import { FacultyProfile } from '../types/types';

export type ProfileMessage = { type: 'success' | 'error'; text: string } | null;

export interface ProfileEditorState {
  profile: FacultyProfile | null;
  loading: boolean;
  saving: boolean;
  editing: boolean;
  message: ProfileMessage;
  validationErrors: string[];

  bio: string;
  primaryDept: string;
  secondaryDepts: string[];
  researchInterests: string[];
  imageUrl: string;

  primaryDeptSearch: string;
  isPrimaryDropdownOpen: boolean;
  focusedPrimaryIndex: number;
}

export type ProfileEditorAction =
  | { type: 'SET_BIO'; payload: string }
  | { type: 'SET_IMAGE_URL'; payload: string }
  | { type: 'SET_PRIMARY_DEPT'; payload: string }
  | { type: 'CLEAR_PRIMARY_DEPT' }
  | { type: 'SET_SECONDARY_DEPTS'; payload: string[] | ((prev: string[]) => string[]) }
  | { type: 'SET_RESEARCH_INTERESTS'; payload: string[] | ((prev: string[]) => string[]) }
  | { type: 'SET_PRIMARY_DEPT_SEARCH'; payload: string }
  | { type: 'OPEN_PRIMARY_DROPDOWN' }
  | { type: 'CLOSE_PRIMARY_DROPDOWN' }
  | { type: 'SET_FOCUSED_PRIMARY_INDEX'; payload: number | ((prev: number) => number) }
  | { type: 'SELECT_PRIMARY_DEPT'; payload: string }
  | { type: 'START_EDITING' }
  | { type: 'CANCEL_EDITING'; profile: FacultyProfile }
  | { type: 'SAVE_START' }
  | { type: 'SAVE_VALIDATION_FAILED'; errors: string[] }
  | { type: 'SAVE_SUCCESS'; profile: FacultyProfile; message: ProfileMessage }
  | { type: 'SAVE_FAILURE'; message: ProfileMessage }
  | { type: 'FETCH_SUCCESS'; profile: FacultyProfile }
  | { type: 'FETCH_FAILURE' };

const resolve = <T>(payload: T | ((prev: T) => T), prev: T): T =>
  typeof payload === 'function' ? (payload as (prev: T) => T)(prev) : payload;

export const createInitialProfileEditorState = (
  overrides: Partial<ProfileEditorState> = {}
): ProfileEditorState => ({
  profile: null,
  loading: true,
  saving: false,
  editing: false,
  message: null,
  validationErrors: [],
  bio: '',
  primaryDept: '',
  secondaryDepts: [],
  researchInterests: [],
  imageUrl: '',
  primaryDeptSearch: '',
  isPrimaryDropdownOpen: false,
  focusedPrimaryIndex: -1,
  ...overrides,
});

/**
 * Derive form values from a freshly-loaded profile. Shared between fetch and
 * cancel-edit so we don't duplicate "copy profile fields into form state".
 */
const hydrateFromProfile = (
  profile: FacultyProfile
): Pick<ProfileEditorState, 'bio' | 'primaryDept' | 'secondaryDepts' | 'researchInterests' | 'imageUrl'> => ({
  bio: profile.bio || '',
  primaryDept: profile.primary_department || '',
  secondaryDepts: profile.secondary_departments || [],
  researchInterests: profile.research_interests || [],
  imageUrl: profile.image_url || '',
});

export function profileEditorReducer(
  state: ProfileEditorState,
  action: ProfileEditorAction
): ProfileEditorState {
  switch (action.type) {
    case 'SET_BIO':
      return { ...state, bio: action.payload };
    case 'SET_IMAGE_URL':
      return { ...state, imageUrl: action.payload };
    case 'SET_PRIMARY_DEPT':
      return { ...state, primaryDept: action.payload };
    case 'CLEAR_PRIMARY_DEPT':
      return { ...state, primaryDept: '', primaryDeptSearch: '' };
    case 'SET_SECONDARY_DEPTS':
      return { ...state, secondaryDepts: resolve(action.payload, state.secondaryDepts) };
    case 'SET_RESEARCH_INTERESTS':
      return { ...state, researchInterests: resolve(action.payload, state.researchInterests) };

    case 'SET_PRIMARY_DEPT_SEARCH':
      return { ...state, primaryDeptSearch: action.payload, focusedPrimaryIndex: -1 };
    case 'OPEN_PRIMARY_DROPDOWN':
      return { ...state, isPrimaryDropdownOpen: true, primaryDeptSearch: '' };
    case 'CLOSE_PRIMARY_DROPDOWN':
      return {
        ...state,
        isPrimaryDropdownOpen: false,
        primaryDeptSearch: '',
        focusedPrimaryIndex: -1,
      };
    case 'SET_FOCUSED_PRIMARY_INDEX':
      return {
        ...state,
        focusedPrimaryIndex: resolve(action.payload, state.focusedPrimaryIndex),
      };
    case 'SELECT_PRIMARY_DEPT':
      return {
        ...state,
        primaryDept: action.payload,
        isPrimaryDropdownOpen: false,
        primaryDeptSearch: '',
        focusedPrimaryIndex: -1,
      };

    case 'START_EDITING':
      return { ...state, editing: true, message: null };

    case 'CANCEL_EDITING':
      return {
        ...state,
        editing: false,
        validationErrors: [],
        ...hydrateFromProfile(action.profile),
      };

    case 'SAVE_START':
      return { ...state, saving: true, message: null, validationErrors: [] };

    case 'SAVE_VALIDATION_FAILED':
      return { ...state, saving: false, validationErrors: action.errors };

    case 'SAVE_SUCCESS':
      return {
        ...state,
        saving: false,
        editing: false,
        profile: action.profile,
        message: action.message,
        validationErrors: [],
        ...hydrateFromProfile(action.profile),
      };

    case 'SAVE_FAILURE':
      return { ...state, saving: false, message: action.message };

    case 'FETCH_SUCCESS':
      return {
        ...state,
        loading: false,
        profile: action.profile,
        // Newly-loaded profiles with profileVerified=false open in edit mode so
        // the user can review auto-populated fields before verifying.
        editing: state.editing || !action.profile.profileVerified,
        ...hydrateFromProfile(action.profile),
      };

    case 'FETCH_FAILURE':
      return { ...state, loading: false };

    default:
      return state;
  }
}

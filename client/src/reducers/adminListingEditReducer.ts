/**
 * Pure reducer for the admin listing-edit modal.
 *
 * Consolidates:
 *   - Listing fields being edited (title, description, arrays of depts/emails/
 *     websites/professors/research areas, boolean flags)
 *   - Combobox state for the department and research-area pickers
 *   - Transient "new value" inputs used by the array-add UI
 *   - Save lifecycle (isSaving, resetCreatedAt override)
 *
 * Supporting value-or-updater payloads on array fields preserves drop-in
 * compatibility with the `React.Dispatch<React.SetStateAction<string[]>>`
 * interface that the inline ArrayField helper expects.
 */

type AdminListingShape = {
  ownerTitle?: string;
  title: string;
  description: string;
  applicantDescription: string;
  departments: string[];
  researchAreas: string[];
  professorNames: string[];
  professorIds: string[];
  emails: string[];
  websites: string[];
  hiringStatus: number;
  archived: boolean;
  confirmed: boolean;
  audited?: boolean;
};

export interface AdminListingEditState {
  ownerTitle: string;
  title: string;
  description: string;
  applicantDescription: string;
  departments: string[];
  researchAreas: string[];
  professorNames: string[];
  professorIds: string[];
  emails: string[];
  websites: string[];
  hiringStatus: number;
  archived: boolean;
  confirmed: boolean;
  audited: boolean;

  resetCreatedAt: boolean;
  isSaving: boolean;

  deptSearch: string;
  showDeptDropdown: boolean;

  raSearch: string;
  showRaDropdown: boolean;

  newProfName: string;
  newProfId: string;
  newEmail: string;
  newWebsite: string;
}

export type AdminListingEditAction =
  | { type: 'SET_OWNER_TITLE'; payload: string }
  | { type: 'SET_TITLE'; payload: string }
  | { type: 'SET_DESCRIPTION'; payload: string }
  | { type: 'SET_APPLICANT_DESCRIPTION'; payload: string }
  | { type: 'SET_HIRING_STATUS'; payload: number }
  | { type: 'SET_ARCHIVED'; payload: boolean }
  | { type: 'SET_CONFIRMED'; payload: boolean }
  | { type: 'SET_AUDITED'; payload: boolean }
  | { type: 'SET_RESET_CREATED_AT'; payload: boolean }
  | { type: 'SET_SAVING'; payload: boolean }
  | { type: 'SET_DEPARTMENTS'; payload: string[] | ((prev: string[]) => string[]) }
  | { type: 'SET_RESEARCH_AREAS'; payload: string[] | ((prev: string[]) => string[]) }
  | { type: 'SET_PROFESSOR_NAMES'; payload: string[] | ((prev: string[]) => string[]) }
  | { type: 'SET_PROFESSOR_IDS'; payload: string[] | ((prev: string[]) => string[]) }
  | { type: 'SET_EMAILS'; payload: string[] | ((prev: string[]) => string[]) }
  | { type: 'SET_WEBSITES'; payload: string[] | ((prev: string[]) => string[]) }
  | { type: 'SET_DEPT_SEARCH'; payload: string }
  | { type: 'SHOW_DEPT_DROPDOWN'; payload: boolean }
  | { type: 'ADD_DEPARTMENT'; payload: string }
  | { type: 'SET_RA_SEARCH'; payload: string }
  | { type: 'SHOW_RA_DROPDOWN'; payload: boolean }
  | { type: 'ADD_RESEARCH_AREA'; payload: string }
  | { type: 'SET_NEW_PROF_NAME'; payload: string }
  | { type: 'SET_NEW_PROF_ID'; payload: string }
  | { type: 'SET_NEW_EMAIL'; payload: string }
  | { type: 'SET_NEW_WEBSITE'; payload: string };

const resolve = <T>(payload: T | ((prev: T) => T), prev: T): T =>
  typeof payload === 'function' ? (payload as (prev: T) => T)(prev) : payload;

export const createInitialAdminListingEditState = (
  listing: AdminListingShape
): AdminListingEditState => ({
  ownerTitle: listing.ownerTitle || '',
  title: listing.title || '',
  description: listing.description || '',
  applicantDescription: listing.applicantDescription || '',
  departments: listing.departments || [],
  researchAreas: listing.researchAreas || [],
  professorNames: listing.professorNames || [],
  professorIds: listing.professorIds || [],
  emails: listing.emails || [],
  websites: listing.websites || [],
  // Preserves the odd legacy semantics: if already open (>=0), normalize to 0;
  // otherwise mark not-open (-1). Checked against tests to avoid drift.
  hiringStatus: listing.hiringStatus >= 0 ? 0 : -1,
  archived: listing.archived,
  confirmed: listing.confirmed,
  audited: listing.audited ?? false,
  resetCreatedAt: false,
  isSaving: false,
  deptSearch: '',
  showDeptDropdown: false,
  raSearch: '',
  showRaDropdown: false,
  newProfName: '',
  newProfId: '',
  newEmail: '',
  newWebsite: '',
});

export function adminListingEditReducer(
  state: AdminListingEditState,
  action: AdminListingEditAction
): AdminListingEditState {
  switch (action.type) {
    case 'SET_OWNER_TITLE':
      return { ...state, ownerTitle: action.payload };
    case 'SET_TITLE':
      return { ...state, title: action.payload };
    case 'SET_DESCRIPTION':
      return { ...state, description: action.payload };
    case 'SET_APPLICANT_DESCRIPTION':
      return { ...state, applicantDescription: action.payload };
    case 'SET_HIRING_STATUS':
      return { ...state, hiringStatus: action.payload };
    case 'SET_ARCHIVED':
      return { ...state, archived: action.payload };
    case 'SET_CONFIRMED':
      return { ...state, confirmed: action.payload };
    case 'SET_AUDITED':
      return { ...state, audited: action.payload };
    case 'SET_RESET_CREATED_AT':
      return { ...state, resetCreatedAt: action.payload };
    case 'SET_SAVING':
      return { ...state, isSaving: action.payload };

    case 'SET_DEPARTMENTS':
      return { ...state, departments: resolve(action.payload, state.departments) };
    case 'SET_RESEARCH_AREAS':
      return { ...state, researchAreas: resolve(action.payload, state.researchAreas) };
    case 'SET_PROFESSOR_NAMES':
      return { ...state, professorNames: resolve(action.payload, state.professorNames) };
    case 'SET_PROFESSOR_IDS':
      return { ...state, professorIds: resolve(action.payload, state.professorIds) };
    case 'SET_EMAILS':
      return { ...state, emails: resolve(action.payload, state.emails) };
    case 'SET_WEBSITES':
      return { ...state, websites: resolve(action.payload, state.websites) };

    case 'SET_DEPT_SEARCH':
      return { ...state, deptSearch: action.payload, showDeptDropdown: true };
    case 'SHOW_DEPT_DROPDOWN':
      return { ...state, showDeptDropdown: action.payload };
    case 'ADD_DEPARTMENT':
      return state.departments.includes(action.payload)
        ? state
        : {
            ...state,
            departments: [...state.departments, action.payload],
            deptSearch: '',
            showDeptDropdown: false,
          };

    case 'SET_RA_SEARCH':
      return { ...state, raSearch: action.payload, showRaDropdown: true };
    case 'SHOW_RA_DROPDOWN':
      return { ...state, showRaDropdown: action.payload };
    case 'ADD_RESEARCH_AREA':
      return state.researchAreas.includes(action.payload)
        ? state
        : {
            ...state,
            researchAreas: [...state.researchAreas, action.payload],
            raSearch: '',
            showRaDropdown: false,
          };

    case 'SET_NEW_PROF_NAME':
      return { ...state, newProfName: action.payload };
    case 'SET_NEW_PROF_ID':
      return { ...state, newProfId: action.payload };
    case 'SET_NEW_EMAIL':
      return { ...state, newEmail: action.payload };
    case 'SET_NEW_WEBSITE':
      return { ...state, newWebsite: action.payload };

    default:
      return state;
  }
}

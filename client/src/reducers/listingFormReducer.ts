/**
 * Pure reducer for the listing create/edit form.
 *
 * The form owns ~15 fields plus an errors map. Centralizing transitions here
 * lets us unit-test hydration, add/remove-department, reset, and error
 * clearing without rendering the form.
 */
import { Listing } from '../types/types';

export interface ListingFormErrors {
  title?: string;
  description?: string;
  established?: string;
  professorIds?: string;
  professorNames?: string;
  emails?: string;
  websites?: string;
  departments?: string;
}

export interface ListingFormState {
  title: string;
  professorNames: string[];
  ownerName: string;
  departments: string[];
  availableDepartments: string[];
  professorIds: string[];
  emails: string[];
  ownerEmail: string;
  websites: string[];
  description: string;
  applicantDescription: string;
  researchAreas: string[];
  established: string;
  hiringStatus: number;
  archived: boolean;
  loading: boolean;
  errors: ListingFormErrors;
}

export type ListingFormAction =
  | { type: 'SET_TITLE'; payload: string }
  | { type: 'SET_PROFESSOR_NAMES'; payload: string[] | ((prev: string[]) => string[]) }
  | { type: 'SET_PROFESSOR_IDS'; payload: string[] | ((prev: string[]) => string[]) }
  | { type: 'SET_EMAILS'; payload: string[] | ((prev: string[]) => string[]) }
  | { type: 'SET_WEBSITES'; payload: string[] | ((prev: string[]) => string[]) }
  | { type: 'SET_DESCRIPTION'; payload: string }
  | { type: 'SET_APPLICANT_DESCRIPTION'; payload: string }
  | { type: 'SET_RESEARCH_AREAS'; payload: string[] | ((prev: string[]) => string[]) }
  | { type: 'SET_ESTABLISHED'; payload: string }
  | { type: 'SET_HIRING_STATUS'; payload: number | ((prev: number) => number) }
  | { type: 'SET_ARCHIVED'; payload: boolean }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_AVAILABLE_DEPARTMENTS'; payload: string[] }
  | { type: 'SET_ERRORS'; payload: ListingFormErrors }
  | { type: 'UPDATE_ERROR'; field: keyof ListingFormErrors; value: string | undefined }
  | { type: 'ADD_DEPARTMENT'; department: string }
  | { type: 'REMOVE_DEPARTMENT'; index: number }
  | { type: 'HYDRATE'; listing: Listing; availableDepartments: string[] }
  | { type: 'RESET_FROM_LISTING'; listing: Listing };

const resolve = <T>(payload: T | ((prev: T) => T), prev: T): T =>
  typeof payload === 'function' ? (payload as (prev: T) => T)(prev) : payload;

const researchAreasFromListing = (listing: Listing): string[] => {
  if (listing.researchAreas && listing.researchAreas.length > 0) {
    return [...listing.researchAreas];
  }
  if (listing.keywords) {
    return [...listing.keywords];
  }
  return [];
};

/**
 * Derive an initial form state from a listing.
 * Used both for the initial render and for HYDRATE/RESET transitions.
 */
export const createInitialListingFormState = (listing: Listing): ListingFormState => ({
  title: listing.title,
  professorNames: [...listing.professorNames],
  ownerName: `${listing.ownerFirstName} ${listing.ownerLastName}`,
  departments: [...listing.departments],
  availableDepartments: [],
  professorIds: [...listing.professorIds],
  emails: [...listing.emails],
  ownerEmail: listing.ownerEmail,
  websites: listing.websites ? [...listing.websites] : [],
  description: listing.description,
  applicantDescription: listing.applicantDescription || '',
  researchAreas: researchAreasFromListing(listing),
  established: listing.established || '',
  hiringStatus: listing.hiringStatus,
  archived: listing.archived,
  loading: true,
  errors: {},
});

export function listingFormReducer(
  state: ListingFormState,
  action: ListingFormAction,
): ListingFormState {
  switch (action.type) {
    case 'SET_TITLE':
      return { ...state, title: action.payload };
    case 'SET_PROFESSOR_NAMES':
      return { ...state, professorNames: resolve(action.payload, state.professorNames) };
    case 'SET_PROFESSOR_IDS':
      return { ...state, professorIds: resolve(action.payload, state.professorIds) };
    case 'SET_EMAILS':
      return { ...state, emails: resolve(action.payload, state.emails) };
    case 'SET_WEBSITES':
      return { ...state, websites: resolve(action.payload, state.websites) };
    case 'SET_DESCRIPTION':
      return { ...state, description: action.payload };
    case 'SET_APPLICANT_DESCRIPTION':
      return { ...state, applicantDescription: action.payload };
    case 'SET_RESEARCH_AREAS':
      return { ...state, researchAreas: resolve(action.payload, state.researchAreas) };
    case 'SET_ESTABLISHED':
      return { ...state, established: action.payload };
    case 'SET_HIRING_STATUS':
      return { ...state, hiringStatus: resolve(action.payload, state.hiringStatus) };
    case 'SET_ARCHIVED':
      return { ...state, archived: action.payload };
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    case 'SET_AVAILABLE_DEPARTMENTS':
      return { ...state, availableDepartments: action.payload };
    case 'SET_ERRORS':
      return { ...state, errors: action.payload };
    case 'UPDATE_ERROR':
      return {
        ...state,
        errors: { ...state.errors, [action.field]: action.value },
      };
    case 'ADD_DEPARTMENT':
      return {
        ...state,
        departments: [...state.departments, action.department],
        availableDepartments: state.availableDepartments
          .filter((d) => d !== action.department)
          .sort(),
      };
    case 'REMOVE_DEPARTMENT': {
      const nextDepartments = [...state.departments];
      const removed = nextDepartments.splice(action.index, 1)[0];
      const nextAvailable = removed
        ? [...state.availableDepartments, removed].sort()
        : state.availableDepartments;
      return {
        ...state,
        departments: nextDepartments,
        availableDepartments: nextAvailable,
      };
    }
    case 'HYDRATE': {
      const fromListing = createInitialListingFormState(action.listing);
      return {
        ...fromListing,
        availableDepartments: action.availableDepartments,
        loading: false,
        errors: {},
      };
    }
    case 'RESET_FROM_LISTING': {
      const fromListing = createInitialListingFormState(action.listing);
      // Preserve current loading / availableDepartments; caller recomputes if needed.
      return {
        ...fromListing,
        availableDepartments: state.availableDepartments,
        loading: state.loading,
        errors: {},
      };
    }
    default:
      return state;
  }
}

/**
 * Pure reducer for the admin faculty-profile edit modal.
 *
 * Covers form values (a mix of string fields including comma-joined list
 * inputs for secondary_departments / research_interests), permission flags,
 * and fetch/save lifecycle. The `full` state field carries the richer
 * profile payload returned on fetch (publications + topics) that isn't on
 * the list-view `AdminProfile`.
 */
import { Publication } from '../types/types';

export interface AdminProfileShape {
  netid: string;
  fname: string;
  lname: string;
  email: string;
  title?: string;
  bio?: string;
  phone?: string;
  primary_department?: string;
  secondary_departments?: string[];
  research_interests?: string[];
  h_index?: number;
  orcid?: string;
  image_url?: string;
  profileVerified?: boolean;
  userType: string;
  userConfirmed: boolean;
}

export interface FullAdminProfile extends AdminProfileShape {
  publications?: Publication[];
  topics?: string[];
  profile_urls?: Record<string, string>;
}

export interface AdminProfileEditState {
  full: FullAdminProfile | null;
  loading: boolean;
  saving: boolean;

  fname: string;
  lname: string;
  email: string;
  title: string;
  bio: string;
  phone: string;
  primaryDept: string;
  secondaryDepts: string; // comma-joined
  researchInterests: string; // comma-joined
  hIndex: string;
  orcid: string;
  imageUrl: string;
  profileVerified: boolean;
  userType: string;
  userConfirmed: boolean;
}

export type AdminProfileEditAction =
  | { type: 'SET_FNAME'; payload: string }
  | { type: 'SET_LNAME'; payload: string }
  | { type: 'SET_EMAIL'; payload: string }
  | { type: 'SET_TITLE'; payload: string }
  | { type: 'SET_BIO'; payload: string }
  | { type: 'SET_PHONE'; payload: string }
  | { type: 'SET_PRIMARY_DEPT'; payload: string }
  | { type: 'SET_SECONDARY_DEPTS'; payload: string }
  | { type: 'SET_RESEARCH_INTERESTS'; payload: string }
  | { type: 'SET_H_INDEX'; payload: string }
  | { type: 'SET_ORCID'; payload: string }
  | { type: 'SET_IMAGE_URL'; payload: string }
  | { type: 'SET_PROFILE_VERIFIED'; payload: boolean }
  | { type: 'SET_USER_TYPE'; payload: string }
  | { type: 'SET_USER_CONFIRMED'; payload: boolean }
  | { type: 'FETCH_SUCCESS'; profile: FullAdminProfile }
  | { type: 'FETCH_FAILURE' }
  | { type: 'SAVE_START' }
  | { type: 'SAVE_END' };

/**
 * Build the form-state slice that mirrors the profile fields. Shared between
 * the initial-state factory and the FETCH_SUCCESS transition so the hydration
 * logic lives in one place.
 */
const formFromProfile = (
  p: Partial<AdminProfileShape>,
): Pick<
  AdminProfileEditState,
  | 'fname'
  | 'lname'
  | 'email'
  | 'title'
  | 'bio'
  | 'phone'
  | 'primaryDept'
  | 'secondaryDepts'
  | 'researchInterests'
  | 'hIndex'
  | 'orcid'
  | 'imageUrl'
  | 'profileVerified'
  | 'userType'
  | 'userConfirmed'
> => ({
  fname: p.fname || '',
  lname: p.lname || '',
  email: p.email || '',
  title: p.title || '',
  bio: p.bio || '',
  phone: p.phone || '',
  primaryDept: p.primary_department || '',
  secondaryDepts: (p.secondary_departments || []).join(', '),
  researchInterests: (p.research_interests || []).join(', '),
  hIndex: p.h_index?.toString() || '',
  orcid: p.orcid || '',
  imageUrl: p.image_url || '',
  profileVerified: p.profileVerified || false,
  userType: p.userType || 'professor',
  userConfirmed: p.userConfirmed || false,
});

export const createInitialAdminProfileEditState = (
  profile: AdminProfileShape,
): AdminProfileEditState => ({
  full: null,
  loading: true,
  saving: false,
  ...formFromProfile(profile),
});

export function adminProfileEditReducer(
  state: AdminProfileEditState,
  action: AdminProfileEditAction,
): AdminProfileEditState {
  switch (action.type) {
    case 'SET_FNAME':
      return { ...state, fname: action.payload };
    case 'SET_LNAME':
      return { ...state, lname: action.payload };
    case 'SET_EMAIL':
      return { ...state, email: action.payload };
    case 'SET_TITLE':
      return { ...state, title: action.payload };
    case 'SET_BIO':
      return { ...state, bio: action.payload };
    case 'SET_PHONE':
      return { ...state, phone: action.payload };
    case 'SET_PRIMARY_DEPT':
      return { ...state, primaryDept: action.payload };
    case 'SET_SECONDARY_DEPTS':
      return { ...state, secondaryDepts: action.payload };
    case 'SET_RESEARCH_INTERESTS':
      return { ...state, researchInterests: action.payload };
    case 'SET_H_INDEX':
      return { ...state, hIndex: action.payload };
    case 'SET_ORCID':
      return { ...state, orcid: action.payload };
    case 'SET_IMAGE_URL':
      return { ...state, imageUrl: action.payload };
    case 'SET_PROFILE_VERIFIED':
      return { ...state, profileVerified: action.payload };
    case 'SET_USER_TYPE':
      return { ...state, userType: action.payload };
    case 'SET_USER_CONFIRMED':
      return { ...state, userConfirmed: action.payload };

    case 'FETCH_SUCCESS':
      return {
        ...state,
        full: action.profile,
        loading: false,
        ...formFromProfile(action.profile),
      };

    case 'FETCH_FAILURE':
      return { ...state, loading: false };

    case 'SAVE_START':
      return { ...state, saving: true };
    case 'SAVE_END':
      return { ...state, saving: false };

    default:
      return state;
  }
}

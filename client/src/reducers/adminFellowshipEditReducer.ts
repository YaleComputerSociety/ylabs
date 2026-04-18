/**
 * Pure reducer for the admin fellowship-edit modal.
 *
 * Covers all editable fellowship fields plus the isSaving flag. The inline
 * TagInput sub-component already owns its own search-input state; here we
 * only manage the value arrays it mutates.
 */
import { Fellowship } from '../types/types';

export interface AdminFellowshipEditState {
  title: string;
  summary: string;
  description: string;
  applicationInformation: string;
  eligibility: string;
  applicationLink: string;
  awardAmount: string;
  isAcceptingApplications: boolean;
  deadline: string;
  applicationOpenDate: string;
  contactName: string;
  contactEmail: string;
  archived: boolean;
  audited: boolean;
  yearOfStudy: string[];
  termOfAward: string[];
  purpose: string[];
  globalRegions: string[];
  citizenshipStatus: string[];
  isSaving: boolean;
}

export type AdminFellowshipEditAction =
  | { type: 'SET_TITLE'; payload: string }
  | { type: 'SET_SUMMARY'; payload: string }
  | { type: 'SET_DESCRIPTION'; payload: string }
  | { type: 'SET_APPLICATION_INFORMATION'; payload: string }
  | { type: 'SET_ELIGIBILITY'; payload: string }
  | { type: 'SET_APPLICATION_LINK'; payload: string }
  | { type: 'SET_AWARD_AMOUNT'; payload: string }
  | { type: 'SET_IS_ACCEPTING_APPLICATIONS'; payload: boolean }
  | { type: 'SET_DEADLINE'; payload: string }
  | { type: 'SET_APPLICATION_OPEN_DATE'; payload: string }
  | { type: 'SET_CONTACT_NAME'; payload: string }
  | { type: 'SET_CONTACT_EMAIL'; payload: string }
  | { type: 'SET_ARCHIVED'; payload: boolean }
  | { type: 'SET_AUDITED'; payload: boolean }
  | { type: 'SET_YEAR_OF_STUDY'; payload: string[] }
  | { type: 'SET_TERM_OF_AWARD'; payload: string[] }
  | { type: 'SET_PURPOSE'; payload: string[] }
  | { type: 'SET_GLOBAL_REGIONS'; payload: string[] }
  | { type: 'SET_CITIZENSHIP_STATUS'; payload: string[] }
  | { type: 'SET_SAVING'; payload: boolean };

/**
 * Fellowship.deadline and .applicationOpenDate come in as ISO strings or null.
 * The datetime-local input needs a "YYYY-MM-DDTHH:mm" string. Extracting
 * here keeps the reducer pure (component stays free of the date quirk).
 */
const toInputDateString = (iso: string | null | undefined): string => {
  if (!iso) return '';
  return new Date(iso).toISOString().slice(0, 16);
};

export const createInitialAdminFellowshipEditState = (
  fellowship: Fellowship,
): AdminFellowshipEditState => ({
  title: fellowship.title || '',
  summary: fellowship.summary || '',
  description: fellowship.description || '',
  applicationInformation: fellowship.applicationInformation || '',
  eligibility: fellowship.eligibility || '',
  applicationLink: fellowship.applicationLink || '',
  awardAmount: fellowship.awardAmount || '',
  isAcceptingApplications: fellowship.isAcceptingApplications,
  deadline: toInputDateString(fellowship.deadline),
  applicationOpenDate: toInputDateString(fellowship.applicationOpenDate),
  contactName: fellowship.contactName || '',
  contactEmail: fellowship.contactEmail || '',
  archived: fellowship.archived,
  audited: fellowship.audited ?? false,
  yearOfStudy: [...(fellowship.yearOfStudy || [])],
  termOfAward: [...(fellowship.termOfAward || [])],
  purpose: [...(fellowship.purpose || [])],
  globalRegions: [...(fellowship.globalRegions || [])],
  citizenshipStatus: [...(fellowship.citizenshipStatus || [])],
  isSaving: false,
});

export function adminFellowshipEditReducer(
  state: AdminFellowshipEditState,
  action: AdminFellowshipEditAction,
): AdminFellowshipEditState {
  switch (action.type) {
    case 'SET_TITLE':
      return { ...state, title: action.payload };
    case 'SET_SUMMARY':
      return { ...state, summary: action.payload };
    case 'SET_DESCRIPTION':
      return { ...state, description: action.payload };
    case 'SET_APPLICATION_INFORMATION':
      return { ...state, applicationInformation: action.payload };
    case 'SET_ELIGIBILITY':
      return { ...state, eligibility: action.payload };
    case 'SET_APPLICATION_LINK':
      return { ...state, applicationLink: action.payload };
    case 'SET_AWARD_AMOUNT':
      return { ...state, awardAmount: action.payload };
    case 'SET_IS_ACCEPTING_APPLICATIONS':
      return { ...state, isAcceptingApplications: action.payload };
    case 'SET_DEADLINE':
      return { ...state, deadline: action.payload };
    case 'SET_APPLICATION_OPEN_DATE':
      return { ...state, applicationOpenDate: action.payload };
    case 'SET_CONTACT_NAME':
      return { ...state, contactName: action.payload };
    case 'SET_CONTACT_EMAIL':
      return { ...state, contactEmail: action.payload };
    case 'SET_ARCHIVED':
      return { ...state, archived: action.payload };
    case 'SET_AUDITED':
      return { ...state, audited: action.payload };
    case 'SET_YEAR_OF_STUDY':
      return { ...state, yearOfStudy: action.payload };
    case 'SET_TERM_OF_AWARD':
      return { ...state, termOfAward: action.payload };
    case 'SET_PURPOSE':
      return { ...state, purpose: action.payload };
    case 'SET_GLOBAL_REGIONS':
      return { ...state, globalRegions: action.payload };
    case 'SET_CITIZENSHIP_STATUS':
      return { ...state, citizenshipStatus: action.payload };
    case 'SET_SAVING':
      return { ...state, isSaving: action.payload };
    default:
      return state;
  }
}

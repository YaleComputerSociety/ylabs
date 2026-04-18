/**
 * Pure reducer for the fellowship edit form embedded inside
 * AdminFellowshipsTable. A superset of adminFellowshipEditReducer — adds
 * competitionType, restrictionsToUseOfAward, additionalInformation,
 * contactPhone, contactOffice, and a structured links editor.
 *
 * Kept separate from adminFellowshipEditReducer because the two modals consume
 * slightly different admin-fellowship shapes and lumping them into one
 * reducer would muddy the contract.
 */

export interface FellowshipLink {
  label: string;
  url: string;
}

/** The subset of fields the reducer reads on initialization. */
export interface AdminFellowshipFormSource {
  title: string;
  competitionType?: string;
  summary: string;
  description: string;
  applicationInformation?: string;
  eligibility: string;
  restrictionsToUseOfAward?: string;
  additionalInformation?: string;
  links?: FellowshipLink[];
  applicationLink: string;
  awardAmount?: string;
  contactName?: string;
  contactEmail: string;
  contactPhone?: string;
  contactOffice?: string;
  isAcceptingApplications: boolean;
  applicationOpenDate: string | null;
  deadline: string | null;
  yearOfStudy: string[];
  termOfAward: string[];
  purpose: string[];
  globalRegions: string[];
  citizenshipStatus: string[];
  audited?: boolean;
  archived?: boolean;
}

export interface AdminFellowshipFormState {
  title: string;
  competitionType: string;
  summary: string;
  description: string;
  applicationInformation: string;
  eligibility: string;
  restrictionsToUseOfAward: string;
  additionalInformation: string;
  links: FellowshipLink[];
  applicationLink: string;
  awardAmount: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  contactOffice: string;
  isAcceptingApplications: boolean;
  applicationOpenDate: string;
  deadline: string;
  yearOfStudy: string[];
  termOfAward: string[];
  purpose: string[];
  globalRegions: string[];
  citizenshipStatus: string[];
  audited: boolean;
  archived: boolean;
}

export type AdminFellowshipFormAction =
  | { type: 'SET_TITLE'; payload: string }
  | { type: 'SET_COMPETITION_TYPE'; payload: string }
  | { type: 'SET_SUMMARY'; payload: string }
  | { type: 'SET_DESCRIPTION'; payload: string }
  | { type: 'SET_APPLICATION_INFORMATION'; payload: string }
  | { type: 'SET_ELIGIBILITY'; payload: string }
  | { type: 'SET_RESTRICTIONS'; payload: string }
  | { type: 'SET_ADDITIONAL_INFORMATION'; payload: string }
  | { type: 'SET_LINKS'; payload: FellowshipLink[] }
  | { type: 'SET_APPLICATION_LINK'; payload: string }
  | { type: 'SET_AWARD_AMOUNT'; payload: string }
  | { type: 'SET_CONTACT_NAME'; payload: string }
  | { type: 'SET_CONTACT_EMAIL'; payload: string }
  | { type: 'SET_CONTACT_PHONE'; payload: string }
  | { type: 'SET_CONTACT_OFFICE'; payload: string }
  | { type: 'SET_IS_ACCEPTING_APPLICATIONS'; payload: boolean }
  | { type: 'SET_APPLICATION_OPEN_DATE'; payload: string }
  | { type: 'SET_DEADLINE'; payload: string }
  | { type: 'SET_YEAR_OF_STUDY'; payload: string[] }
  | { type: 'SET_TERM_OF_AWARD'; payload: string[] }
  | { type: 'SET_PURPOSE'; payload: string[] }
  | { type: 'SET_GLOBAL_REGIONS'; payload: string[] }
  | { type: 'SET_CITIZENSHIP_STATUS'; payload: string[] }
  | { type: 'SET_AUDITED'; payload: boolean }
  | { type: 'SET_ARCHIVED'; payload: boolean };

/**
 * `datetime-local` inputs use "YYYY-MM-DDTHH:mm"; the fellowship payload
 * stores ISO. Re-implementing the conversion here (rather than using
 * new Date().toISOString().slice(0,16), which returns UTC) preserves the
 * admin-table's original local-timezone behavior.
 */
export const toDatetimeLocal = (dateStr: string | null): string => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
};

export const createInitialAdminFellowshipFormState = (
  f: AdminFellowshipFormSource,
): AdminFellowshipFormState => ({
  title: f.title,
  competitionType: f.competitionType || '',
  summary: f.summary,
  description: f.description,
  applicationInformation: f.applicationInformation || '',
  eligibility: f.eligibility,
  restrictionsToUseOfAward: f.restrictionsToUseOfAward || '',
  additionalInformation: f.additionalInformation || '',
  links: [...(f.links || [])],
  applicationLink: f.applicationLink,
  awardAmount: f.awardAmount || '',
  contactName: f.contactName || '',
  contactEmail: f.contactEmail,
  contactPhone: f.contactPhone || '',
  contactOffice: f.contactOffice || '',
  isAcceptingApplications: f.isAcceptingApplications,
  applicationOpenDate: toDatetimeLocal(f.applicationOpenDate),
  deadline: toDatetimeLocal(f.deadline),
  yearOfStudy: [...f.yearOfStudy],
  termOfAward: [...f.termOfAward],
  purpose: [...f.purpose],
  globalRegions: [...f.globalRegions],
  citizenshipStatus: [...f.citizenshipStatus],
  audited: f.audited ?? false,
  archived: f.archived ?? false,
});

export function adminFellowshipFormReducer(
  state: AdminFellowshipFormState,
  action: AdminFellowshipFormAction,
): AdminFellowshipFormState {
  switch (action.type) {
    case 'SET_TITLE':
      return { ...state, title: action.payload };
    case 'SET_COMPETITION_TYPE':
      return { ...state, competitionType: action.payload };
    case 'SET_SUMMARY':
      return { ...state, summary: action.payload };
    case 'SET_DESCRIPTION':
      return { ...state, description: action.payload };
    case 'SET_APPLICATION_INFORMATION':
      return { ...state, applicationInformation: action.payload };
    case 'SET_ELIGIBILITY':
      return { ...state, eligibility: action.payload };
    case 'SET_RESTRICTIONS':
      return { ...state, restrictionsToUseOfAward: action.payload };
    case 'SET_ADDITIONAL_INFORMATION':
      return { ...state, additionalInformation: action.payload };
    case 'SET_LINKS':
      return { ...state, links: action.payload };
    case 'SET_APPLICATION_LINK':
      return { ...state, applicationLink: action.payload };
    case 'SET_AWARD_AMOUNT':
      return { ...state, awardAmount: action.payload };
    case 'SET_CONTACT_NAME':
      return { ...state, contactName: action.payload };
    case 'SET_CONTACT_EMAIL':
      return { ...state, contactEmail: action.payload };
    case 'SET_CONTACT_PHONE':
      return { ...state, contactPhone: action.payload };
    case 'SET_CONTACT_OFFICE':
      return { ...state, contactOffice: action.payload };
    case 'SET_IS_ACCEPTING_APPLICATIONS':
      return { ...state, isAcceptingApplications: action.payload };
    case 'SET_APPLICATION_OPEN_DATE':
      return { ...state, applicationOpenDate: action.payload };
    case 'SET_DEADLINE':
      return { ...state, deadline: action.payload };
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
    case 'SET_AUDITED':
      return { ...state, audited: action.payload };
    case 'SET_ARCHIVED':
      return { ...state, archived: action.payload };
    default:
      return state;
  }
}

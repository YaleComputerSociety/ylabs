/**
 * Core TypeScript interfaces for listings, fellowships, and user profiles.
 */
import type { LabScholarlyLink } from './labDetail';

export type NewListing = {
  id: number;
  ownerId: string;
  ownerFirstName: string;
  ownerLastName: string;
  ownerEmail: string;
  professorIds: string[];
  professorNames: string[];
  title: string;
  departments: string[];
  emails: string[];
  websites: string[];
  description: string;
  keywords: string[];
  established: string;
  views: number;
  favorites: number;
  hiringStatus: number;
  archived: boolean;
  updatedAt: string;
  createdAt: string;
};

export type CreatedListing = {
  id?: number;
  ownerId?: string;
  ownerFirstName?: string;
  ownerLastName?: string;
  ownerEmail?: string;
  professorIds?: string[];
  professorNames?: string[];
  title: string;
  departments: string[];
  emails?: string[];
  websites?: string[];
  description?: string;
  keywords?: string[];
  established?: string;
  views?: number;
  favorites?: number;
  hiringStatus?: number;
  archived?: boolean;
  updatedAt?: string;
  createdAt?: string;
}

export type Listing = {
  id: string;
  ownerId: string;
  ownerFirstName: string;
  ownerLastName: string;
  ownerEmail: string;
  ownerTitle?: string;
  ownerPrimaryDepartment?: string;
  professorIds: string[];
  professorNames: string[];
  title: string;
  departments: string[];
  emails: string[];
  websites: string[];
  description: string;
  applicantDescription: string;
  keywords: string[];
  researchAreas: string[];
  established: string;
  views: number;
  favorites: number;
  hiringStatus: number;
  archived: boolean;
  updatedAt: string;
  createdAt: string;
  confirmed: boolean;
  audited: boolean;
};

export type FellowshipLink = {
  label: string;
  url: string;
};

export type Fellowship = {
  id: string;
  programCategory: string;
  programKind: string;
  entryMode: string;
  studentFacingCategory: string;
  requiresMentorBeforeApply: boolean;
  mentorMatching: boolean;
  undergraduateOnly: boolean | null;
  yaleCollegeOnly: boolean | null;
  compensationSummary: string;
  hoursPerWeek: number | null;
  programDates: string;
  bestNextStep: string;
  prepSteps: string[];
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
  isAcceptingApplications: boolean;
  applicationOpenDate: string | null;
  deadline: string | null;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  contactOffice: string;
  yearOfStudy: string[];
  termOfAward: string[];
  purpose: string[];
  globalRegions: string[];
  citizenshipStatus: string[];
  sourceName: string;
  sourceUrl: string;
  sourceKey: string;
  sourceFingerprint: string;
  sourceLastVerifiedAt: string | null;
  sourceLastChangedAt: string | null;
  studentVisibilityTier?: StudentVisibilityTier;
  studentVisibilityComputedTier?: StudentVisibilityTier;
  studentVisibilityOverrideTier?: StudentVisibilityTier;
  studentVisibilityReasons?: string[];
  studentVisibilitySuppressionReason?: string;
  studentVisibilityReviewRuleId?: string;
  studentVisibilityReviewNote?: string;
  archived: boolean;
  audited: boolean;
  views: number;
  favorites: number;
  updatedAt: string;
  createdAt: string;
};

export type StudentVisibilityTier =
  | 'student_ready'
  | 'limited_but_safe'
  | 'operator_review'
  | 'suppressed';

export type FellowshipStage = 'not_applied' | 'applied';

export type FellowshipFilterOptions = {
  programCategory: string[];
  programKind: string[];
  entryMode: string[];
  studentFacingCategory: string[];
  yearOfStudy: string[];
  termOfAward: string[];
  purpose: string[];
  globalRegions: string[];
  citizenshipStatus: string[];
};

export type User = {
  netId: string;
  userType: string;
  userConfirmed: boolean;
  profileVerified?: boolean;
  isAdmin?: boolean;
};

export type Publication = {
  title: string;
  doi?: string;
  year?: number;
  venue?: string;
  cited_by_count?: number;
  open_access_url?: string;
  source?: string;
};

export type FacultyProfile = {
  netid: string;
  fname: string;
  lname: string;
  title?: string;
  bio?: string;
  website?: string;
  primary_department?: string;
  secondary_departments: string[];
  departments: string[];
  image_url?: string;
  h_index?: number;
  orcid?: string;
  openalex_id?: string;
  profile_urls: Record<string, string>;
  publications: Publication[];
  scholarlyLinks?: LabScholarlyLink[];
  researchEntities?: Array<{
    _id: string;
    slug: string;
    name: string;
    displayName?: string;
    shortDescription?: string;
    description?: string;
    departments?: string[];
    researchAreas?: string[];
    role?: string;
  }>;
  research_interests: string[];
  research_interest_summary?: string;
  topics: string[];
  profileVerified: boolean;
  ownListings: string[];
};

export type Developer = {
  name: string;
  position: string;
  image?: string;
  location: string;
  website?: string;
  linkedin?: string;
  github?: string;
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface ImportMeta {
  readonly env: {
    readonly VITE_APP_TITLE: string;
    readonly MODE: string;
    readonly BASE_URL: string;
    readonly PROD: boolean;
    readonly DEV: boolean;
    [key: string]: string | boolean | undefined;
  };
}

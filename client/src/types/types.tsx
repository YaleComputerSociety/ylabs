/**
 * Core TypeScript interfaces for fellowships and user profiles.
 */

export type FellowshipLink = {
  label: string;
  url: string;
};

export type FellowshipSourceLinkHealth = {
  url: string;
  healthStatus: string;
  httpStatusCode?: number;
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
  researchFocused?: boolean;
  applicationMaterials?: string[];
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
  deadlineProjectedNextCycle?: boolean;
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
  sourceLinkHealth?: FellowshipSourceLinkHealth;
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
  subjects?: string[];
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

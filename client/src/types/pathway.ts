export type PathwayBestNextStepCategory =
  | 'apply'
  | 'register-for-credit'
  | 'find-funding'
  | 'plan-outreach'
  | 'contact-program'
  | 'save-for-thesis'
  | 'save-for-later'
  | 'check-back-later';

export type PathwaySortBy =
  | 'relevance'
  | 'confidence'
  | 'lastObservedAt'
  | 'deadline'
  | 'createdAt';

export type PathwaySortOrder = 'asc' | 'desc';

export interface PathwaySearchFilters {
  pathwayType?: string[];
  compensation?: string[];
  status?: string[];
  evidenceStrength?: string[];
  entityType?: string[];
  departments?: string[];
  researchAreas?: string[];
  hasActivePostedOpportunity?: boolean;
  bestNextStepCategory?: PathwayBestNextStepCategory[];
}

export interface PathwaySearchRequest {
  q?: string;
  page?: number;
  pageSize?: number;
  filters?: PathwaySearchFilters;
  sortBy?: PathwaySortBy;
  sortOrder?: PathwaySortOrder;
}

export interface PathwayResearchEntitySummary {
  _id: string;
  slug: string;
  name: string;
  displayName?: string;
  kind?: string;
  entityType?: string;
  departments: string[];
  researchAreas: string[];
  school?: string;
  websiteUrl?: string;
}

export interface PathwayPostedOpportunitySummary {
  _id: string;
  title: string;
  deadline?: string;
  applicationUrl?: string;
  status: 'OPEN' | 'ROLLING';
  term?: string;
}

export interface PathwayEvidenceSummary {
  signalType: string;
  confidence: string;
  confidenceScore?: number;
  excerpt?: string;
  sourceUrl?: string;
  observedAt?: string;
}

export interface PathwayContactRouteSummary {
  routeType: string;
  label?: string;
  url?: string;
  contactPolicy?: string;
  visibility?: string;
  rationale?: string;
}

export interface PathwaySearchHit {
  _id: string;
  pathwayType: string;
  status: string;
  evidenceStrength: string;
  studentFacingLabel: string;
  explanation?: string;
  bestNextStep?: string;
  bestNextStepCategory: PathwayBestNextStepCategory;
  compensation?: string;
  confidence?: number;
  sourceUrls: string[];
  lastObservedAt?: string;
  createdAt?: string;
  researchEntity: PathwayResearchEntitySummary;
  activePostedOpportunity?: PathwayPostedOpportunitySummary;
  evidence: PathwayEvidenceSummary[];
  contactRoute?: PathwayContactRouteSummary;
}

export interface PathwaySearchResponse {
  hits: PathwaySearchHit[];
  estimatedTotalHits: number;
  page: number;
  pageSize: number;
}

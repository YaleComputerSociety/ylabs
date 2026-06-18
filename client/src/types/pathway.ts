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
  | 'deadline';

export type PathwayActionability = 'ACTION_READY' | 'REFERENCE_ONLY';

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

export interface PathwayResearchEntitySummary {
  _id: string;
  slug: string;
  name: string;
  displayName?: string;
  shortDescription?: string;
  description?: string;
  fullDescription?: string;
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
  provenance?: 'LISTING_BRIDGED' | 'SCRAPER_DERIVED';
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
  researchEntity: PathwayResearchEntitySummary;
  activePostedOpportunity?: PathwayPostedOpportunitySummary;
  evidence: PathwayEvidenceSummary[];
  contactRoute?: PathwayContactRouteSummary;
  actionability?: PathwayActionability;
}

export interface PathwaySearchResponse {
  hits: PathwaySearchHit[];
  estimatedTotalHits: number;
  page: number;
  pageSize: number;
}

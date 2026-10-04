export type PathwayActionability = 'ACTION_READY' | 'REFERENCE_ONLY';

export interface PathwaySearchFilters {
  pathwayType?: string[];
  compensation?: string[];
  status?: string[];
  evidenceStrength?: string[];
  entityType?: string[];
  departments?: string[];
  researchAreas?: string[];
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
  compensation?: string;
  confidence?: number;
  sourceUrls: string[];
  lastObservedAt?: string;
  researchEntity: PathwayResearchEntitySummary;
  evidence: PathwayEvidenceSummary[];
  contactRoute?: PathwayContactRouteSummary;
  actionability?: PathwayActionability;
}

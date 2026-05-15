export interface OpportunityResearchEntitySummary {
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
  shortDescription?: string;
}

export interface OpportunityPathwaySummary {
  _id: string;
  pathwayType: string;
  status: string;
  evidenceStrength?: string;
  studentFacingLabel: string;
  explanation?: string;
  bestNextStep?: string;
  compensation?: string;
  confidence?: number;
  sourceUrls: string[];
}

export interface OpportunityEvidenceSummary {
  _id: string;
  sourceName?: string;
  sourceUrl?: string;
  field?: string;
  excerpt?: string;
  confidence?: number;
  observedAt?: string;
}

export type OpportunityDeadlineState =
  | 'NO_DEADLINE'
  | 'UPCOMING'
  | 'DUE_TODAY'
  | 'PAST'
  | 'ARCHIVED';

export type OpportunityApplicationState =
  | 'APPLY_NOW'
  | 'ROLLING'
  | 'CLOSED'
  | 'ARCHIVED'
  | 'NO_APPLICATION_URL';

export type OpportunityProvenance = 'LISTING_BRIDGED' | 'SCRAPER_DERIVED';

export interface OpportunityDetailPayload {
  _id: string;
  entryPathwayId: string;
  researchEntityId: string;
  listingId?: string;
  title: string;
  term?: string;
  deadline?: string;
  deadlineState: OpportunityDeadlineState;
  applicationUrl?: string;
  applicationState: OpportunityApplicationState;
  applicationLabel: string;
  status: string;
  provenance: OpportunityProvenance;
  provenanceLabel: string;
  hoursPerWeek?: number;
  payRate?: string;
  compensationType?: string;
  eligibility?: string;
  sourceUrls: string[];
  researchEntity: OpportunityResearchEntitySummary;
  pathway: OpportunityPathwaySummary;
  evidence: OpportunityEvidenceSummary[];
  createdAt?: string;
  updatedAt?: string;
}

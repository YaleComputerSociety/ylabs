/**
 * Client-side compatibility shape for canonical ResearchEntity records.
 *
 * Mirrors the server's `researchGroupSchema` in
 * `server/src/models/researchGroup.ts`. Kept narrow to what the UI consumes —
 * fields that are server-only (e.g. `embedding`) are intentionally omitted.
 */

export type ResearchGroupKind =
  | 'lab'
  | 'center'
  | 'institute'
  | 'program'
  | 'initiative'
  | 'group'
  | 'individual'
  | 'solo';

export type ResearchEntityType =
  | 'LAB'
  | 'CENTER'
  | 'INSTITUTE'
  | 'FACULTY_RESEARCH_AREA'
  | 'FACULTY_PROJECT'
  | 'DIGITAL_HUMANITIES_PROJECT'
  | 'COLLECTIONS_INITIATIVE'
  | 'RA_PROGRAM'
  | 'FELLOWSHIP_PROGRAM'
  | 'COURSE_SEQUENCE'
  | 'ARCHIVE_OR_MUSEUM_PROJECT'
  | 'PROGRAM'
  | 'INITIATIVE'
  | 'GROUP'
  | 'INDIVIDUAL_RESEARCH';

export type ResearchGroupOpenness = 'open' | 'inquire' | 'closed' | 'unknown';

export interface AccessSummary {
  status:
    | 'posted-opening'
    | 'evidence-backed'
    | 'reach-out-plausible'
    | 'not-currently-available'
    | 'unknown';
  confidence: number;
  evidence: Array<{
    signalType: string;
    confidence: string;
    excerpt?: string;
    sourceUrl?: string;
  }>;
  signalTypes: string[];
  entryPathwayTypes: string[];
  hasActivePostedOpportunity: boolean;
  bestNextStep: string;
}

export interface ResearchPlanningContext {
  category: 'open_position' | 'official_application' | 'reviewed_route' | 'qualified_participation';
  label: string;
  url: string;
}

export type StudentDecisionRecommendedAction =
  | 'APPLY'
  | 'OPEN_OFFICIAL_ROUTE'
  | 'PLAN_EXPLORATORY_OUTREACH'
  | 'ASK_ABOUT_CREDIT_AFTER_FIT'
  | 'FIND_FUNDING_AFTER_FIT'
  | 'SAVE_FOR_THESIS_PLANNING'
  | 'CHECK_BACK_LATER';

export interface StudentDecisionExplanation {
  recommendedAction: StudentDecisionRecommendedAction;
  headline: string;
  explanation: string;
  why: string[];
  notThis?: string;
  confidence: number;
  sourceUrls: string[];
  reviewFlags?: string[];
}

export interface TimeCommitmentRange {
  min?: number;
  max?: number;
}

export interface PastUndergradAdvisee {
  year?: number;
  programName?: string;
  count?: number;
}

export interface IndependentStudyCourse {
  code?: string;
  title?: string;
}

export interface RecentGrant {
  id?: string;
  agency?: string;
  title?: string;
  abstract?: string;
  startDate?: string;
  endDate?: string;
  dollarAmount?: number;
  url?: string;
  role?: 'pi' | 'copi';
}

export interface ResearchGroup {
  _id: string;
  // Meilisearch hits return `id` rather than `_id`. The search endpoint also
  // mirrors `id` back into `_id`, but other consumers may receive only `id`.
  id?: string;
  slug: string;
  name: string;
  displayName?: string;
  kind: ResearchGroupKind;
  entityType?: ResearchEntityType;
  description: string;
  shortDescription?: string;
  fullDescription?: string;
  profileSynthesisDescription?: string;
  descriptionSource?: 'ENTITY_SOURCE' | 'PI_PROFILE_SYNTHESIS' | 'NONE';
  websiteUrl: string;
  location: string;
  departments: string[];
  researchAreas: string[];
  keywords?: string[];
  profileResearchAreas?: string[];
  researchAreaSource?: 'PI_PROFILE_FALLBACK';
  school: string;
  openness: ResearchGroupOpenness;
  /**
   * The scraper subsystem now writes undefined/null when it cannot determine
   * acceptance — only an explicit boolean carries meaning. Treat absence as
   * "unknown" rather than coercing to a default.
   */
  acceptingUndergrads?: boolean;
  /** Number of undergrads currently named on the lab roster, when known. */
  currentUndergradCount?: number;
  /** Verbatim quote from the source page that supports acceptingUndergrads. */
  undergradEvidenceQuote?: string;
  /** Past undergrad advisees discovered via thesis/STARS/etc. scrapers. */
  pastUndergradAdvisees?: PastUndergradAdvisee[];
  /** True when the lab is reachable via an independent-study course. */
  offersIndependentStudy?: boolean;
  independentStudyCourses?: IndependentStudyCourse[];
  recentGrants?: RecentGrant[];
  recentGrantCount?: number;
  fundingAgencies?: string[];
  recentPaperCount?: number;
  /**
   * Denormalized 0–1 confidence score for `acceptingUndergrads`. Materializer
   * mirrors `confidenceByField['acceptingUndergrads']` here so Meili can filter
   * on it (Meili can't filter into nested mixed objects).
   */
  acceptanceConfidence?: number;
  typicalUndergradRoles: string[];
  prerequisiteCourses: string[];
  creditOptions: string[];
  fundingPrograms: string[];
  timeCommitmentHoursPerWeek?: TimeCommitmentRange;
  contactEmail?: string;
  contactName?: string;
  contactRole?: string;
  sourceUrls: string[];
  confidenceByField?: Record<string, number>;
  /**
   * Names of fields the PI / admin has manually set; the materializer never
   * overwrites these, even if scrapers disagree.
   */
  manuallyLockedFields?: string[];
  lastObservedAt?: string;
  archived?: boolean;
  createdAt?: string;
  updatedAt?: string;
  /**
   * Set client-side after a follow-up fetch when we know whether this group
   * has any non-archived Listings. Optional because the search endpoint does
   * not include it.
   */
  hasActiveListing?: boolean;
  accessSummary?: AccessSummary;
  planningContext?: ResearchPlanningContext;
  studentDecisionExplanation?: StudentDecisionExplanation;
  studentVisibilityTier?: 'student_ready' | 'limited_but_safe' | 'operator_review' | 'suppressed';
}

/**
 * Public API alias for the current ResearchGroup-backed ResearchEntity. New
 * client code should prefer this name across page/API boundaries while legacy
 * Historical names remain in this file while runtime APIs use ResearchEntity.
 */
export type ResearchEntity = ResearchGroup;

export interface ResearchGroupSearchResponse {
  hits: ResearchGroup[];
  researchEntities?: ResearchEntity[];
  estimatedTotalHits: number;
  page: number;
  pageSize: number;
  facetDistribution?: Record<string, Record<string, number>>;
}

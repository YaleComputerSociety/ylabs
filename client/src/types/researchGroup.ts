/**
 * Client-side type for ResearchGroup records (Yale labs/centers/institutes/etc.).
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

export type ResearchGroupOpenness = 'open' | 'inquire' | 'closed' | 'unknown';

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
  description: string;
  websiteUrl: string;
  location: string;
  departments: string[];
  researchAreas: string[];
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
  contactEmail: string;
  contactName: string;
  contactRole: string;
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
}

export type AcceptanceLevelFilter = 'verified' | 'verified-or-likely' | 'all';

export interface ResearchGroupSearchFilters {
  kind?: string[];
  school?: string[];
  departments?: string[];
  researchAreas?: string[];
  openness?: string[];
  acceptingUndergrads?: boolean;
  /**
   * Trust-gradient filter. `'all'` (default) preserves prior behavior — no
   * additional constraint. `'verified'` requires `acceptingUndergrads = true`
   * AND `acceptanceConfidence >= 0.7`. `'verified-or-likely'` matches any
   * group with at least one positive signal (active listing, past advisees,
   * current roster, or independent study).
   */
  acceptanceLevel?: AcceptanceLevelFilter;
}

export type ResearchGroupSortBy = 'lastObservedAt' | 'name' | 'createdAt' | 'updatedAt';
export type ResearchGroupSortOrder = 'asc' | 'desc';

export interface ResearchGroupSearchRequest {
  q?: string;
  page?: number;
  pageSize?: number;
  filters?: ResearchGroupSearchFilters;
  sortBy?: ResearchGroupSortBy;
  sortOrder?: ResearchGroupSortOrder;
}

export interface ResearchGroupSearchResponse {
  hits: ResearchGroup[];
  estimatedTotalHits: number;
  page: number;
  pageSize: number;
}

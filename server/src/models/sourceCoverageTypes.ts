/**
 * Typed coverage metadata for scraper/manual data sources.
 *
 * These values describe what a Source can discover or materialize. They are
 * stored on Source rows so admin/review tooling can reason about coverage
 * before a scraper is expanded.
 */
/**
 * `EntryPathway`, `AccessSignal`, `ContactRoute`, `PostedOpportunity` and
 * `UndergraduateLogisticsClaim` were removed (#2829). None of them had a model, a
 * collection or a materializer, so every source declaring one asserted a capability
 * nothing could satisfy, and `runReport` warned "expects access artifacts ... reports
 * zero" on every successful run. That permanent warning is what a real access-coverage
 * gap would have had to be spotted against.
 *
 * The concept survives as `Signal.type`: `AccessSignal` was already folded into
 * `Signal`, `ContactRoute` is `CONTACT_INSTRUCTIONS_EXIST` and `PostedOpportunity` is
 * `POSTED_OPENING`, both with real stored rows. One model with a type discriminator,
 * not five names for one idea.
 */
export const sourceCoverageArtifactTypes = [
  'Fellowship',
  'ResearchEntity',
  'ResearchEntityMember',
  'Observation',
] as const;

export type SourceCoverageArtifactType = (typeof sourceCoverageArtifactTypes)[number];

export const sourceCoverageEvidenceCategories = [
  'ENTITY_IDENTITY',
  'ENTITY_MEMBERSHIP',
  'TOPICS',
  'METHODS',
  'OFFICIAL_PROFILE',
  'RESEARCH_INFRASTRUCTURE',
  'OFFICIAL_RESOURCE',
  'LAB_WEBSITE',
  'JOIN_INSTRUCTIONS',
  'UNDERGRAD_ROLE_LANGUAGE',
  'OFFICIAL_CONTACT_ROUTE',
  'APPLICATION_LINK',
  'CONSTRAINTS',
  'COURSE_CREDIT',
  'SENIOR_THESIS',
  'RESEARCH_SEMINAR',
  'FELLOWSHIP_COMPATIBILITY',
  'PAST_UNDERGRADS',
  'UNDERGRAD_STUDENT_LEVEL',
  'UNDERGRAD_COMPENSATION',
  'UNDERGRAD_TIME_COMMITMENT',
  'UNDERGRAD_MODALITY',
  'UNDERGRAD_CURRENT_AVAILABILITY',
  'POSTED_OPENING',
  'FUNDING_ACTIVITY',
  'PUBLICATIONS',
] as const;

export type SourceCoverageEvidenceCategory = (typeof sourceCoverageEvidenceCategories)[number];

export const sourceCoverageTiers = [
  'PRIMARY_OFFICIAL',
  'OFFICIAL_INDEX',
  'DERIVED_OFFICIAL',
  'THIRD_PARTY_ENRICHMENT',
  'MANUAL_OVERRIDE',
] as const;

export type SourceCoverageTier = (typeof sourceCoverageTiers)[number];

export interface SourceCoverageMetadata {
  priority: number;
  tier: SourceCoverageTier;
  artifactTypes: SourceCoverageArtifactType[];
  evidenceCategories: SourceCoverageEvidenceCategory[];
  defaultConfidence: 'HIGH' | 'MEDIUM' | 'LOW';
  notes?: string;
}

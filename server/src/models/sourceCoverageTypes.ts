/**
 * Typed coverage metadata for scraper/manual data sources.
 *
 * These values describe what a Source can discover or materialize. They are
 * stored on Source rows so admin/review tooling can reason about coverage
 * before a scraper is expanded.
 */
export const sourceCoverageArtifactTypes = [
  'ResearchEntity',
  'Fellowship',
  'EntryPathway',
  'AccessSignal',
  'ContactRoute',
  'PostedOpportunity',
  'Observation',
] as const;

export type SourceCoverageArtifactType = (typeof sourceCoverageArtifactTypes)[number];

export const sourceCoverageEvidenceCategories = [
  'ENTITY_IDENTITY',
  'ENTITY_MEMBERSHIP',
  'TOPICS',
  'METHODS',
  'OFFICIAL_PROFILE',
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
  'POSTED_OPENING',
  'FUNDING_ACTIVITY',
  'PUBLICATIONS',
] as const;

export type SourceCoverageEvidenceCategory =
  (typeof sourceCoverageEvidenceCategories)[number];

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

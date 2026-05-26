/**
 * Source coverage registry for scraper planning and admin review.
 *
 * This is a declarative map from Source.name to the artifacts/evidence each
 * source can support. It does not change scraper behavior by itself; seeded
 * Source rows persist the metadata for reporting and future coverage metrics.
 */
import type { SourceCoverageMetadata } from '../models/sourceCoverageTypes';

export const sourceCoverageRegistry = {
  'manual-admin-edit': {
    priority: 0,
    tier: 'MANUAL_OVERRIDE',
    artifactTypes: [
      'ResearchEntity',
      'EntryPathway',
      'AccessSignal',
      'ContactRoute',
      'PostedOpportunity',
      'Observation',
    ],
    evidenceCategories: [
      'ENTITY_IDENTITY',
      'JOIN_INSTRUCTIONS',
      'OFFICIAL_CONTACT_ROUTE',
      'POSTED_OPENING',
    ],
    defaultConfidence: 'HIGH',
    notes: 'Admin override channel; treated as intentionally curated, not scraper evidence.',
  },
  'manual-pi-edit': {
    priority: 0,
    tier: 'MANUAL_OVERRIDE',
    artifactTypes: ['ResearchEntity', 'EntryPathway', 'ContactRoute', 'Observation'],
    evidenceCategories: ['ENTITY_IDENTITY', 'JOIN_INSTRUCTIONS', 'OFFICIAL_CONTACT_ROUTE'],
    defaultConfidence: 'HIGH',
    notes: 'PI edits should remain protected by manual locks where appropriate.',
  },
  'research-entity-cache-backfill': {
    priority: 1,
    tier: 'DERIVED_OFFICIAL',
    artifactTypes: ['Observation', 'EntryPathway', 'AccessSignal'],
    evidenceCategories: ['UNDERGRAD_ROLE_LANGUAGE', 'PAST_UNDERGRADS', 'JOIN_INSTRUCTIONS'],
    defaultConfidence: 'LOW',
    notes:
      'One-time provenance recovery from legacy ResearchEntity undergraduate-access cache fields; use only to bridge old scalar cache data into first-class access artifacts.',
  },
  'lab-microsite-description-llm': {
    priority: 1,
    tier: 'PRIMARY_OFFICIAL',
    artifactTypes: ['ResearchEntity', 'Observation'],
    evidenceCategories: ['LAB_WEBSITE', 'TOPICS', 'METHODS'],
    defaultConfidence: 'MEDIUM',
    notes:
      'Official microsite description extraction for research focus, questions, methods, and conservative areas only; must not create access, route, or opportunity evidence.',
  },
  'lab-microsite-undergrad-llm': {
    priority: 1,
    tier: 'PRIMARY_OFFICIAL',
    artifactTypes: ['EntryPathway', 'AccessSignal', 'ContactRoute', 'Observation'],
    evidenceCategories: [
      'LAB_WEBSITE',
      'JOIN_INSTRUCTIONS',
      'UNDERGRAD_ROLE_LANGUAGE',
      'OFFICIAL_CONTACT_ROUTE',
      'APPLICATION_LINK',
      'CONSTRAINTS',
      'PAST_UNDERGRADS',
    ],
    defaultConfidence: 'MEDIUM',
    notes:
      'Bounded lab/faculty microsite extraction from canonical ResearchEntity websites; evidence remains public-page quotes and source URLs.',
  },
  'lab-microsite-llm': {
    priority: 1,
    tier: 'PRIMARY_OFFICIAL',
    artifactTypes: ['ResearchEntity', 'AccessSignal', 'ContactRoute', 'Observation'],
    evidenceCategories: [
      'LAB_WEBSITE',
      'TOPICS',
      'METHODS',
      'JOIN_INSTRUCTIONS',
      'OFFICIAL_CONTACT_ROUTE',
    ],
    defaultConfidence: 'MEDIUM',
    notes: 'General lab microsite extraction used for entity context and access hints.',
  },
  'dept-faculty-roster': {
    priority: 2,
    tier: 'OFFICIAL_INDEX',
    artifactTypes: ['ResearchEntity', 'EntryPathway', 'ContactRoute', 'Observation'],
    evidenceCategories: [
      'ENTITY_IDENTITY',
      'ENTITY_MEMBERSHIP',
      'OFFICIAL_PROFILE',
      'LAB_WEBSITE',
      'TOPICS',
      'METHODS',
      'OFFICIAL_CONTACT_ROUTE',
    ],
    defaultConfidence: 'HIGH',
    notes:
      'Official department profile/roster joins and lab URL discovery; can also materialize guarded PI-profile fallback pathways/routes when no stronger public route exists.',
  },
  'department-undergrad-research': {
    priority: 2,
    tier: 'PRIMARY_OFFICIAL',
    artifactTypes: ['ResearchEntity', 'EntryPathway', 'AccessSignal', 'ContactRoute', 'Observation'],
    evidenceCategories: [
      'ENTITY_IDENTITY',
      'TOPICS',
      'JOIN_INSTRUCTIONS',
      'UNDERGRAD_ROLE_LANGUAGE',
      'OFFICIAL_CONTACT_ROUTE',
      'APPLICATION_LINK',
      'COURSE_CREDIT',
      'SENIOR_THESIS',
      'RESEARCH_SEMINAR',
    ],
    defaultConfidence: 'HIGH',
    notes:
      'Official department undergraduate research pages; can support source-backed research homes and access/action evidence, but generic guidance must not create posted opportunities.',
  },
  'official-profile-enrichment': {
    priority: 2,
    tier: 'OFFICIAL_INDEX',
    artifactTypes: ['Observation'],
    evidenceCategories: ['OFFICIAL_PROFILE', 'TOPICS', 'METHODS'],
    defaultConfidence: 'HIGH',
    notes:
      'Known official Yale profile URLs for existing faculty users; fills profile biography, research-interest, image, ORCID, and profile URL observations without creating research entities or access claims.',
  },
  'yale-directory': {
    priority: 2,
    tier: 'OFFICIAL_INDEX',
    artifactTypes: ['Observation'],
    evidenceCategories: ['ENTITY_MEMBERSHIP', 'OFFICIAL_PROFILE'],
    defaultConfidence: 'HIGH',
    notes: 'Authoritative Yale appointment metadata, not access evidence by itself.',
  },
  'yale-directory-csv': {
    priority: 3,
    tier: 'OFFICIAL_INDEX',
    artifactTypes: ['Observation'],
    evidenceCategories: ['ENTITY_MEMBERSHIP'],
    defaultConfidence: 'LOW',
    notes:
      'Static Yale directory CSV for coverage denominator and identity/affiliation observations only. Must not create public research entities, pathways, access signals, contact routes, or opportunities by itself.',
  },
  'ysm-atoz-index': {
    priority: 2,
    tier: 'OFFICIAL_INDEX',
    artifactTypes: ['ResearchEntity', 'Observation'],
    evidenceCategories: ['ENTITY_IDENTITY', 'LAB_WEBSITE'],
    defaultConfidence: 'HIGH',
    notes: 'YSM lab index for discovery; should not imply undergraduate access alone.',
  },
  'yse-centers-index': {
    priority: 2,
    tier: 'OFFICIAL_INDEX',
    artifactTypes: ['ResearchEntity', 'Observation'],
    evidenceCategories: ['ENTITY_IDENTITY', 'LAB_WEBSITE'],
    defaultConfidence: 'HIGH',
    notes: 'YSE center/program index for discovery; should not imply undergraduate access alone.',
  },
  'centers-institutes-index': {
    priority: 2,
    tier: 'OFFICIAL_INDEX',
    artifactTypes: ['ResearchEntity', 'Observation'],
    evidenceCategories: ['ENTITY_IDENTITY', 'ENTITY_MEMBERSHIP', 'OFFICIAL_PROFILE', 'TOPICS'],
    defaultConfidence: 'HIGH',
    notes: 'Center/institute discovery and membership context; contact routes require explicit guarded route evidence.',
  },
  'yale-research-official': {
    priority: 2,
    tier: 'OFFICIAL_INDEX',
    artifactTypes: ['ResearchEntity', 'Observation'],
    evidenceCategories: [
      'ENTITY_IDENTITY',
      'RESEARCH_INFRASTRUCTURE',
      'TOPICS',
      'METHODS',
      'OFFICIAL_RESOURCE',
    ],
    defaultConfidence: 'HIGH',
    notes:
      'Official research.yale.edu directories for centers, institutes, cores, and infrastructure resources. Discovery-only; must not imply undergraduate access, contact routes, or posted openings without a more explicit source.',
  },
  'undergrad-fellowships-recipients': {
    priority: 4,
    tier: 'DERIVED_OFFICIAL',
    artifactTypes: ['EntryPathway', 'AccessSignal', 'Observation'],
    evidenceCategories: ['FELLOWSHIP_COMPATIBILITY', 'PAST_UNDERGRADS'],
    defaultConfidence: 'MEDIUM',
    notes: 'Past recipient/advisor evidence supports historical participation and fellowship routes.',
  },
  'yale-college-fellowships-office': {
    priority: 4,
    tier: 'PRIMARY_OFFICIAL',
    artifactTypes: [
      'Fellowship',
      'EntryPathway',
      'AccessSignal',
      'ContactRoute',
      'PostedOpportunity',
      'Observation',
    ],
    evidenceCategories: [
      'FELLOWSHIP_COMPATIBILITY',
      'APPLICATION_LINK',
      'OFFICIAL_CONTACT_ROUTE',
      'POSTED_OPENING',
    ],
    defaultConfidence: 'HIGH',
    notes: 'Authoritative fellowship program, application-cycle, and official office route source.',
  },
  'ylabs-listing': {
    priority: 5,
    tier: 'MANUAL_OVERRIDE',
    artifactTypes: ['EntryPathway', 'AccessSignal', 'PostedOpportunity'],
    evidenceCategories: ['POSTED_OPENING', 'APPLICATION_LINK'],
    defaultConfidence: 'MEDIUM',
    notes:
      'Legacy YLabs listing rows bridged into opportunity-like records. Treat as audit seeds for scraper coverage, not proof that official scraper coverage is complete.',
  },
  'nih-reporter': {
    priority: 6,
    tier: 'THIRD_PARTY_ENRICHMENT',
    artifactTypes: ['ResearchEntity', 'Observation'],
    evidenceCategories: ['FUNDING_ACTIVITY', 'TOPICS'],
    defaultConfidence: 'MEDIUM',
    notes: 'Funding activity enriches entity context but is not undergraduate-access evidence alone.',
  },
  'nsf-award-search': {
    priority: 6,
    tier: 'THIRD_PARTY_ENRICHMENT',
    artifactTypes: ['ResearchEntity', 'Observation'],
    evidenceCategories: ['FUNDING_ACTIVITY', 'TOPICS'],
    defaultConfidence: 'MEDIUM',
    notes: 'Funding activity enriches entity context but is not undergraduate-access evidence alone.',
  },
  'openalex': {
    priority: 7,
    tier: 'THIRD_PARTY_ENRICHMENT',
    artifactTypes: ['Observation'],
    evidenceCategories: ['PUBLICATIONS', 'TOPICS'],
    defaultConfidence: 'MEDIUM',
    notes:
      'Research-activity enrichment source. ORCID is the identity anchor when present; stored OpenAlex author ids are used only without ORCID; name search is review-only.',
  },
  'orcid': {
    priority: 7,
    tier: 'THIRD_PARTY_ENRICHMENT',
    artifactTypes: ['Observation'],
    evidenceCategories: ['PUBLICATIONS', 'TOPICS'],
    defaultConfidence: 'HIGH',
    notes:
      'Accepted Yale user ORCID public works prove authorship for that user; downstream sources may enrich the paper metadata.',
  },
  'arxiv': {
    priority: 7,
    tier: 'THIRD_PARTY_ENRICHMENT',
    artifactTypes: ['Observation'],
    evidenceCategories: ['PUBLICATIONS', 'TOPICS'],
    defaultConfidence: 'MEDIUM',
    notes:
      'Preprint and recent research activity enrichment; not undergraduate-access evidence by itself.',
  },
  'crossref': {
    priority: 8,
    tier: 'THIRD_PARTY_ENRICHMENT',
    artifactTypes: ['Observation'],
    evidenceCategories: ['PUBLICATIONS'],
    defaultConfidence: 'MEDIUM',
    notes:
      'DOI-backed compact scholarly-link hydration. Crossref improves real destination metadata and never creates Yale authorship or access evidence by itself.',
  },
  'pubmed': {
    priority: 8,
    tier: 'THIRD_PARTY_ENRICHMENT',
    artifactTypes: ['Observation'],
    evidenceCategories: ['PUBLICATIONS'],
    defaultConfidence: 'HIGH',
    notes:
      'Biomedical metadata/authorship enrichment only when records identify the Yale user by accepted ORCID.',
  },
  'europe-pmc': {
    priority: 8,
    tier: 'THIRD_PARTY_ENRICHMENT',
    artifactTypes: ['Observation'],
    evidenceCategories: ['PUBLICATIONS'],
    defaultConfidence: 'HIGH',
    notes:
      'Europe PMC ORCID-backed paper discovery; author links require ORCID identity evidence.',
  },
  'semantic-scholar': {
    priority: 8,
    tier: 'THIRD_PARTY_ENRICHMENT',
    artifactTypes: ['Observation'],
    evidenceCategories: ['PUBLICATIONS', 'TOPICS'],
    defaultConfidence: 'MEDIUM',
    notes:
      'Paper metadata and TLDR enrichment; author-paper lists attach Yale authorship only for accepted Semantic Scholar author IDs.',
  },
} satisfies Record<string, SourceCoverageMetadata>;

export type SourceCoverageName = keyof typeof sourceCoverageRegistry;

export function getSourceCoverage(name: string): SourceCoverageMetadata | undefined {
  return sourceCoverageRegistry[name as SourceCoverageName];
}

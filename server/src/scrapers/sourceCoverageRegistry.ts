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
    notes: 'Bounded lab/faculty microsite extraction; preserve quotes and source URLs.',
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
    artifactTypes: ['ResearchEntity', 'Observation'],
    evidenceCategories: [
      'ENTITY_IDENTITY',
      'ENTITY_MEMBERSHIP',
      'OFFICIAL_PROFILE',
      'LAB_WEBSITE',
      'TOPICS',
      'METHODS',
    ],
    defaultConfidence: 'HIGH',
    notes:
      'Official department profile/roster joins and lab URL discovery; contact routes require explicit guarded route evidence.',
  },
  'yale-directory': {
    priority: 2,
    tier: 'OFFICIAL_INDEX',
    artifactTypes: ['Observation'],
    evidenceCategories: ['ENTITY_MEMBERSHIP', 'OFFICIAL_PROFILE'],
    defaultConfidence: 'HIGH',
    notes: 'Authoritative Yale appointment metadata, not access evidence by itself.',
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
  'official-yale-programs': {
    priority: 4,
    tier: 'PRIMARY_OFFICIAL',
    artifactTypes: [
      'Fellowship',
      'ResearchEntity',
      'EntryPathway',
      'AccessSignal',
      'ContactRoute',
      'PostedOpportunity',
      'Observation',
    ],
    evidenceCategories: [
      'ENTITY_IDENTITY',
      'APPLICATION_LINK',
      'OFFICIAL_CONTACT_ROUTE',
      'POSTED_OPENING',
      'FELLOWSHIP_COMPATIBILITY',
    ],
    defaultConfidence: 'HIGH',
    notes:
      'Curated official Yale program pages for structured undergraduate research programs outside the central fellowship catalog.',
  },
  'ylabs-listing': {
    priority: 5,
    tier: 'PRIMARY_OFFICIAL',
    artifactTypes: ['EntryPathway', 'AccessSignal', 'PostedOpportunity'],
    evidenceCategories: ['POSTED_OPENING', 'APPLICATION_LINK'],
    defaultConfidence: 'HIGH',
    notes: 'Legacy YLabs listing rows bridged into posted opportunities.',
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
      'Identity-backed authorship source only when queried by accepted ORCID/OpenAlex author ID; name search is review-only.',
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
      'DOI metadata hydration. Crossref author ORCIDs may support authorship only when they match an accepted Yale user ORCID.',
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

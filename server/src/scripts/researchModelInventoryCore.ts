/**
 * Pure logic for the research-model refactor Phase 0 inventory.
 *
 * The runner (`researchModelInventory.ts`) gathers raw facts from MongoDB and
 * hands them to `buildResearchModelInventoryReport`, which classifies every
 * collection against the target model in `docs/research-model-refactor.md`,
 * flags legacy residue and retirement-field prevalence, and summarizes
 * reference-integrity orphans. Keeping the shaping here means it can be unit
 * tested without a database, matching the other audit scripts in this folder.
 */
import {
  assertOperatorEnvironmentMatchesDatabase,
  type OperatorDatabaseEnvironment,
} from './operatorDatabaseEnvironment';

export type InventoryGroup =
  | 'canonical-domain'
  | 'dual-truth'
  | 'legacy-residue'
  | 'scholarly-retire'
  | 'evidence'
  | 'private'
  | 'reference-data'
  | 'operational';

export interface CollectionSpec {
  /** Physical MongoDB collection name. */
  collection: string;
  /** Logical Mongoose model name for readability. */
  model: string;
  group: InventoryGroup;
  /** Where this concept goes in the target model. */
  target: string;
  /** Owning migration phase from the refactor doc (or null when deferred). */
  phase: number | null;
  /**
   * When false, the collection is expected to already be gone; its presence
   * with documents is flagged as unresolved legacy residue.
   */
  expectPresent?: boolean;
}

export interface FieldProbe {
  collection: string;
  field: string;
  meaning: string;
  target: string;
}

export interface ReferenceEdge {
  name: string;
  fromCollection: string;
  localField: string;
  toCollection: string;
  required: boolean;
  meaning: string;
}

export type InventoryEnvironment = OperatorDatabaseEnvironment;

export function assertInventoryEnvironmentMatchesDatabase(
  environment: InventoryEnvironment,
  databaseName: string,
): void {
  try {
    assertOperatorEnvironmentMatchesDatabase(environment, databaseName);
  } catch {
    throw new Error(
      `Inventory environment ${environment} does not match MongoDB database ${databaseName || '(missing)'}`,
    );
  }
}

/** Refactor-relevant collections, keyed by physical name. */
export const INVENTORY_COLLECTIONS: CollectionSpec[] = [
  {
    collection: 'accounts',
    model: 'Account',
    group: 'canonical-domain',
    phase: 1,
    target: 'Account',
  },
  {
    collection: 'people',
    model: 'Person',
    group: 'canonical-domain',
    phase: 1,
    target: 'Person',
  },
  {
    collection: 'role_assignments',
    model: 'RoleAssignment',
    group: 'canonical-domain',
    phase: 1,
    target: 'RoleAssignment',
  },
  {
    collection: 'org_units',
    model: 'OrgUnit',
    group: 'canonical-domain',
    phase: 1,
    target: 'OrgUnit',
  },
  {
    collection: 'taxonomy_terms',
    model: 'TaxonomyTerm',
    group: 'canonical-domain',
    phase: 1,
    target: 'TaxonomyTerm',
  },
  {
    collection: 'users',
    model: 'User',
    group: 'dual-truth',
    phase: 2,
    target: 'Account + Person (+ StudentProfile, ResearchPlan)',
  },
  {
    collection: 'faculty_members',
    model: 'FacultyMember',
    group: 'dual-truth',
    phase: 2,
    target: 'Person (deterministic merge, quarantine conflicts)',
  },
  {
    collection: 'research_entity_members',
    model: 'ResearchGroupMember',
    group: 'dual-truth',
    phase: 2,
    target: 'RoleAssignment (one entity id, one person id)',
  },
  {
    collection: 'research_entities',
    model: 'ResearchEntity',
    group: 'canonical-domain',
    phase: 4,
    target: 'Clean ResearchEntity schema + bounded discovery projection',
  },
  {
    collection: 'research_entity_relationships',
    model: 'ResearchEntityRelationship',
    group: 'canonical-domain',
    phase: 4,
    target: 'ResearchEntityRelationship (retained)',
  },
  {
    collection: 'entry_pathways',
    model: 'EntryPathway',
    group: 'canonical-domain',
    phase: 4,
    target: 'EntryPathway (retained)',
  },
  {
    collection: 'posted_opportunities',
    model: 'PostedOpportunity',
    group: 'canonical-domain',
    phase: 4,
    target: 'PostedOpportunity (retained)',
  },
  {
    collection: 'access_signals',
    model: 'AccessSignal',
    group: 'canonical-domain',
    phase: 4,
    target: 'AccessSignal (retained)',
  },
  {
    collection: 'contact_routes',
    model: 'ContactRoute',
    group: 'canonical-domain',
    phase: 4,
    target: 'ContactRoute (retained)',
  },
  {
    collection: 'admin_grants',
    model: 'AdminGrant',
    group: 'canonical-domain',
    phase: null,
    target: 'AdminGrant (admin authority)',
  },
  {
    collection: 'listings',
    model: 'Listing',
    group: 'legacy-residue',
    phase: 4,
    target: 'EntryPathway + PostedOpportunity',
  },
  {
    collection: 'fellowships',
    model: 'Fellowship',
    group: 'legacy-residue',
    phase: 4,
    target: 'Classify: entity / pathway / posting / formalization',
  },
  {
    collection: 'departments',
    model: 'Department',
    group: 'reference-data',
    phase: 4,
    target: 'OrgUnit',
  },
  {
    collection: 'research_areas',
    model: 'ResearchArea',
    group: 'reference-data',
    phase: 4,
    target: 'TaxonomyTerm',
  },
  {
    collection: 'grants',
    model: 'Grant',
    group: 'reference-data',
    phase: null,
    target: 'Deferred; never undergraduate-access evidence',
  },
  {
    collection: 'papers',
    model: 'Paper',
    group: 'scholarly-retire',
    phase: 3,
    target: 'No target collection',
  },
  {
    collection: 'paper_authors',
    model: 'PaperAuthor',
    group: 'scholarly-retire',
    phase: 3,
    target: 'No target collection',
  },
  {
    collection: 'research_scholarly_links',
    model: 'ResearchScholarlyLink',
    group: 'scholarly-retire',
    phase: 3,
    target: 'Crux: bare outbound link vs curated activity surface',
  },
  {
    collection: 'research_scholarly_attributions',
    model: 'ResearchScholarlyAttribution',
    group: 'scholarly-retire',
    phase: 3,
    target: 'No target collection',
  },
  {
    collection: 'observations',
    model: 'Observation',
    group: 'evidence',
    phase: 5,
    target: 'EvidenceClaim (+ SourceDocument)',
  },
  {
    collection: 'evidence_claims',
    model: 'EvidenceClaim',
    group: 'evidence',
    phase: 5,
    target: 'EvidenceClaim (canonical predicate-based evidence)',
  },
  {
    collection: 'sources',
    model: 'Source',
    group: 'evidence',
    phase: 5,
    target: 'Source + SourceDocument',
  },
  {
    collection: 'source_documents',
    model: 'SourceDocument',
    group: 'evidence',
    phase: 5,
    target: 'SourceDocument (canonical fetched-resource identity and retention boundary)',
  },
  {
    collection: 'review_decisions',
    model: 'ReviewDecision',
    group: 'evidence',
    phase: 5,
    target: 'ReviewDecision (canonical append-only manual-resolution audit)',
  },
  {
    collection: 'student_profiles',
    model: 'StudentProfile',
    group: 'private',
    phase: 4,
    target: 'StudentProfile (retained)',
  },
  {
    collection: 'student_applications',
    model: 'StudentApplication',
    group: 'private',
    phase: 4,
    target: 'Private student application records (retained, normalized references)',
  },
  {
    collection: 'student_trackings',
    model: 'StudentTracking',
    group: 'private',
    phase: 4,
    target: 'ResearchPlan',
  },
  {
    collection: 'research_plans',
    model: 'ResearchPlan',
    group: 'private',
    phase: 4,
    target: 'ResearchPlan (canonical private planning state)',
  },
  {
    collection: 'student_outreaches',
    model: 'StudentOutreach',
    group: 'private',
    phase: null,
    target: 'Private outreach state',
  },
  {
    collection: 'student_engagement_events',
    model: 'StudentEngagementEvent',
    group: 'private',
    phase: null,
    target: 'EngagementEvent (append-only analytics)',
  },
  {
    collection: 'analytics_events',
    model: 'AnalyticsEvent',
    group: 'private',
    phase: null,
    target: 'EngagementEvent (append-only analytics with independent retention; never evidence)',
  },
  {
    collection: 'listingclaimrequests',
    model: 'ListingClaimRequest',
    group: 'legacy-residue',
    phase: 4,
    target:
      'Archive or migrate reviewed submissions before Listing retirement; no canonical ownership authority',
  },
  {
    collection: 'scrape_job_locks',
    model: 'ScrapeJobLock',
    group: 'operational',
    phase: null,
    target: 'Environment-local scraper leases (retained; never promoted between environments)',
  },
  {
    collection: 'scrape_runs',
    model: 'ScrapeRun',
    group: 'evidence',
    phase: 5,
    target: 'Retained source-run audit metadata for the EvidenceClaim cutover',
  },
  {
    collection: 'scrape_snapshots',
    model: 'ScrapeSnapshot',
    group: 'evidence',
    phase: 5,
    target:
      'Regenerable fetch cache; retained evidence moves behind SourceDocument retention policy',
  },
  {
    collection: 'visibility_release_queue_items',
    model: 'VisibilityReleaseQueueItem',
    group: 'operational',
    phase: 5,
    target: 'Environment-local rebuildable visibility repair queue over canonical projections',
  },
  // Expected already retired by the earlier hard-pivot; presence is residue.
  {
    collection: 'research_groups',
    model: 'ResearchGroup',
    group: 'legacy-residue',
    phase: 0,
    target: 'research_entities (should be dropped)',
    expectPresent: false,
  },
  {
    collection: 'research_group_members',
    model: 'ResearchGroupMember (legacy)',
    group: 'legacy-residue',
    phase: 0,
    target: 'research_entity_members (should be dropped)',
    expectPresent: false,
  },
  {
    collection: 'research_group_stats',
    model: 'ResearchGroupStats',
    group: 'legacy-residue',
    phase: 0,
    target: 'None (should be dropped)',
    expectPresent: false,
  },
  {
    collection: 'paper_group_links',
    model: 'PaperGroupLink',
    group: 'legacy-residue',
    phase: 0,
    target: 'None (should be dropped)',
    expectPresent: false,
  },
  {
    collection: 'applications',
    model: 'Application',
    group: 'legacy-residue',
    phase: 0,
    target: 'student_applications (should be dropped)',
    expectPresent: false,
  },
  {
    collection: 'paper_entity_links',
    model: 'PaperEntityLink (retired)',
    group: 'scholarly-retire',
    phase: 3,
    target: 'No target collection (expected-gone publication-link residue)',
    expectPresent: false,
  },
  {
    collection: 'research_entity_stats',
    model: 'ResearchEntityStats (retired)',
    group: 'legacy-residue',
    phase: 0,
    target: 'No target collection (expected-gone derived-statistics residue)',
    expectPresent: false,
  },
  {
    collection: 'researchareas',
    model: 'ResearchArea (legacy physical name)',
    group: 'legacy-residue',
    phase: 0,
    target: 'research_areas, then TaxonomyTerm in Phase 4',
    expectPresent: false,
  },
];

/** Legacy fields whose lingering prevalence gates their retirement phase. */
export const RETIREMENT_FIELD_PROBES: FieldProbe[] = [
  {
    collection: 'research_entities',
    field: 'kind',
    meaning: 'Legacy type field superseded by entityType',
    target: 'Retire after read cutover',
  },
  {
    collection: 'research_entities',
    field: 'acceptingUndergrads',
    meaning: 'Binary access cache',
    target: 'AccessSignal + computed access summary',
  },
  {
    collection: 'research_entities',
    field: 'openness',
    meaning: 'Openness cache',
    target: 'AccessSignal + computed access summary',
  },
  {
    collection: 'research_entities',
    field: 'acceptanceConfidence',
    meaning: 'Openness confidence cache',
    target: 'AccessSignal + computed access summary',
  },
  {
    collection: 'research_entities',
    field: 'opennessSignals',
    meaning: 'Embedded openness evidence',
    target: 'AccessSignal',
  },
  {
    collection: 'research_entities',
    field: 'opennessStatusCache',
    meaning: 'Derived openness status cache',
    target: 'Computed access summary',
  },
  {
    collection: 'research_entities',
    field: 'opennessExplanationCache',
    meaning: 'Derived openness explanation cache',
    target: 'Computed access summary',
  },
  {
    collection: 'research_entities',
    field: 'opennessComputedAt',
    meaning: 'Derived openness computation timestamp',
    target: 'Computed access summary',
  },
  {
    collection: 'research_entities',
    field: 'opennessLastSignalAt',
    meaning: 'Derived openness evidence timestamp',
    target: 'AccessSignal',
  },
  {
    collection: 'research_entities',
    field: 'recentPaperCount',
    meaning: 'Paper-derived activity count',
    target: 'Remove with scholarly mirrors',
  },
  {
    collection: 'research_entities',
    field: 'lastPaperAtCache',
    meaning: 'Paper-derived activity timestamp',
    target: 'Remove with scholarly mirrors',
  },
  {
    collection: 'research_entities',
    field: 'activePaperCount2yCache',
    meaning: 'Paper-derived recent activity count',
    target: 'Remove with scholarly mirrors',
  },
  {
    collection: 'research_entities',
    field: 'featuredPaperIds',
    meaning: 'Curated paper references',
    target: 'Remove with scholarly collections',
  },
  {
    collection: 'research_entities',
    field: 'shortDescription',
    meaning: 'Duplicate description field',
    target: 'Single description',
  },
  {
    collection: 'research_entities',
    field: 'fullDescription',
    meaning: 'Duplicate description field',
    target: 'Single description',
  },
  {
    collection: 'research_entity_members',
    field: 'researchGroupId',
    meaning: 'Legacy entity reference',
    target: 'RoleAssignment.target.id',
  },
  {
    collection: 'research_entity_members',
    field: 'researchEntityId',
    meaning: 'Canonical entity reference',
    target: 'RoleAssignment.target.id',
  },
  {
    collection: 'research_entity_members',
    field: 'userId',
    meaning: 'User person reference',
    target: 'RoleAssignment.personId',
  },
  {
    collection: 'research_entity_members',
    field: 'facultyMemberId',
    meaning: 'FacultyMember person reference',
    target: 'RoleAssignment.personId',
  },
  {
    collection: 'users',
    field: 'publications',
    meaning: 'Embedded publication array',
    target: 'Removed (link to official profile / ORCID)',
  },
  {
    collection: 'users',
    field: 'favPathways',
    meaning: 'Legacy saved-pathway array',
    target: 'ResearchPlan',
  },
  {
    collection: 'users',
    field: 'savedPathwayPlans',
    meaning: 'Legacy saved-pathway plan map',
    target: 'ResearchPlan',
  },
  {
    collection: 'users',
    field: 'savedResearchEntities',
    meaning: 'Saved-entity array',
    target: 'ResearchPlan',
  },
  {
    collection: 'users',
    field: 'savedResearchEntityPlans',
    meaning: 'Saved-entity plan map',
    target: 'ResearchPlan',
  },
  {
    collection: 'users',
    field: 'orcid',
    meaning: 'External researcher identifier',
    target: 'Person.identifiers.orcid plus verified PersonProfileLink kind ORCID',
  },
  {
    collection: 'users',
    field: 'facultyMemberId',
    meaning: 'Faculty identity reference',
    target: 'Person.accountId after identity reconciliation',
  },
  {
    collection: 'users',
    field: 'hIndex',
    meaning: 'Mirrored citation metric',
    target: 'Remove with professor-profile mirrors',
  },
  {
    collection: 'users',
    field: 'googleScholarId',
    meaning: 'Legacy Google Scholar profile identifier',
    target: 'Verified PersonProfileLink kind GOOGLE_SCHOLAR, then remove legacy field',
  },
  {
    collection: 'users',
    field: 'openAlexId',
    meaning: 'Mirrored scholarly identifier',
    target: 'Remove with professor-profile mirrors',
  },
  {
    collection: 'users',
    field: 'semanticScholarId',
    meaning: 'Mirrored scholarly identifier',
    target: 'Remove with professor-profile mirrors',
  },
  {
    collection: 'users',
    field: 'googleScholarMetricsUpdatedAt',
    meaning: 'Scholarly synchronization timestamp',
    target: 'Remove with professor-profile mirrors',
  },
  {
    collection: 'users',
    field: 'openAlexWorksSyncedAt',
    meaning: 'Scholarly synchronization timestamp',
    target: 'Remove with publication mirrors',
  },
  {
    collection: 'users',
    field: 'orcidWorksSyncedAt',
    meaning: 'Scholarly synchronization timestamp',
    target: 'Remove with publication mirrors',
  },
  {
    collection: 'users',
    field: 'europePmcWorksSyncedAt',
    meaning: 'Scholarly synchronization timestamp',
    target: 'Remove with publication mirrors',
  },
  {
    collection: 'users',
    field: 'pubmedWorksSyncedAt',
    meaning: 'Scholarly synchronization timestamp',
    target: 'Remove with publication mirrors',
  },
  {
    collection: 'faculty_members',
    field: 'orcidId',
    meaning: 'External researcher identifier',
    target: 'Person.identifiers.orcid plus verified PersonProfileLink kind ORCID',
  },
  {
    collection: 'faculty_members',
    field: 'googleScholarId',
    meaning: 'Legacy Google Scholar profile identifier',
    target: 'Verified PersonProfileLink kind GOOGLE_SCHOLAR, then remove legacy field',
  },
  {
    collection: 'faculty_members',
    field: 'openAlexId',
    meaning: 'Mirrored scholarly identifier',
    target: 'Remove with professor-profile mirrors',
  },
  {
    collection: 'faculty_members',
    field: 'semanticScholarId',
    meaning: 'Mirrored scholarly identifier',
    target: 'Remove with professor-profile mirrors',
  },
  {
    collection: 'listings',
    field: 'researchGroupId',
    meaning: 'Legacy entity reference',
    target: 'researchEntityId before Listing retirement',
  },
  {
    collection: 'student_trackings',
    field: 'researchGroupId',
    meaning: 'Legacy entity reference',
    target: 'researchEntityId',
  },
  {
    collection: 'student_outreaches',
    field: 'researchGroupId',
    meaning: 'Legacy entity reference',
    target: 'researchEntityId',
  },
  {
    collection: 'student_engagement_events',
    field: 'researchGroupId',
    meaning: 'Legacy entity reference',
    target: 'researchEntityId',
  },
];

/** Reference edges whose orphans block clean cutover. */
export const REFERENCE_EDGES: ReferenceEdge[] = [
  {
    name: 'member_to_entity',
    fromCollection: 'research_entity_members',
    localField: 'researchEntityId',
    toCollection: 'research_entities',
    required: false,
    meaning: 'Membership rows must resolve to a research entity',
  },
  {
    name: 'member_to_user',
    fromCollection: 'research_entity_members',
    localField: 'userId',
    toCollection: 'users',
    required: false,
    meaning: 'Membership user refs must resolve to a user',
  },
  {
    name: 'member_to_faculty',
    fromCollection: 'research_entity_members',
    localField: 'facultyMemberId',
    toCollection: 'faculty_members',
    required: false,
    meaning: 'Membership faculty refs must resolve to a faculty member',
  },
  {
    name: 'user_to_faculty',
    fromCollection: 'users',
    localField: 'facultyMemberId',
    toCollection: 'faculty_members',
    required: false,
    meaning: 'User faculty refs must resolve to a faculty member',
  },
  {
    name: 'user_to_student_profile',
    fromCollection: 'users',
    localField: 'studentProfileId',
    toCollection: 'student_profiles',
    required: false,
    meaning: 'User student-profile refs must resolve to a student profile',
  },
  {
    name: 'faculty_to_user',
    fromCollection: 'faculty_members',
    localField: 'userId',
    toCollection: 'users',
    required: false,
    meaning: 'Faculty user refs must resolve to a user',
  },
  {
    name: 'student_profile_to_user',
    fromCollection: 'student_profiles',
    localField: 'userId',
    toCollection: 'users',
    required: true,
    meaning: 'Student profiles must resolve to a user',
  },
  {
    name: 'access_signal_to_entity',
    fromCollection: 'access_signals',
    localField: 'researchEntityId',
    toCollection: 'research_entities',
    required: true,
    meaning: 'Access signals must resolve to a research entity',
  },
  {
    name: 'access_signal_to_pathway',
    fromCollection: 'access_signals',
    localField: 'entryPathwayId',
    toCollection: 'entry_pathways',
    required: false,
    meaning: 'Access signal pathway refs must resolve to an entry pathway',
  },
  {
    name: 'access_signal_to_source_evidence',
    fromCollection: 'access_signals',
    localField: 'sourceEvidenceId',
    toCollection: 'observations',
    required: false,
    meaning: 'Access signal source-evidence refs must resolve to an observation',
  },
  {
    name: 'access_signal_to_observation',
    fromCollection: 'access_signals',
    localField: 'observationId',
    toCollection: 'observations',
    required: false,
    meaning: 'Access signal observation refs must resolve to an observation',
  },
  {
    name: 'entry_pathway_to_entity',
    fromCollection: 'entry_pathways',
    localField: 'researchEntityId',
    toCollection: 'research_entities',
    required: true,
    meaning: 'Entry pathways must resolve to a research entity',
  },
  {
    name: 'contact_route_to_entity',
    fromCollection: 'contact_routes',
    localField: 'researchEntityId',
    toCollection: 'research_entities',
    required: true,
    meaning: 'Contact routes must resolve to a research entity',
  },
  {
    name: 'contact_route_to_pathway',
    fromCollection: 'contact_routes',
    localField: 'entryPathwayId',
    toCollection: 'entry_pathways',
    required: false,
    meaning: 'Contact route pathway refs must resolve to an entry pathway',
  },
  {
    name: 'contact_route_to_person',
    fromCollection: 'contact_routes',
    localField: 'personId',
    toCollection: 'users',
    required: false,
    meaning: 'Contact route person refs must resolve to a user',
  },
  {
    name: 'contact_route_to_source_evidence',
    fromCollection: 'contact_routes',
    localField: 'sourceEvidenceId',
    toCollection: 'observations',
    required: false,
    meaning: 'Contact route source-evidence refs must resolve to an observation',
  },
  {
    name: 'posted_opportunity_to_pathway',
    fromCollection: 'posted_opportunities',
    localField: 'entryPathwayId',
    toCollection: 'entry_pathways',
    required: true,
    meaning: 'Posted opportunities must resolve to an entry pathway',
  },
  {
    name: 'posted_opportunity_to_entity',
    fromCollection: 'posted_opportunities',
    localField: 'researchEntityId',
    toCollection: 'research_entities',
    required: false,
    meaning: 'Posted opportunity entity refs must resolve to a research entity',
  },
  {
    name: 'posted_opportunity_to_listing',
    fromCollection: 'posted_opportunities',
    localField: 'listingId',
    toCollection: 'listings',
    required: false,
    meaning: 'Posted opportunity listing refs must resolve to a listing',
  },
  {
    name: 'listing_to_entity',
    fromCollection: 'listings',
    localField: 'researchEntityId',
    toCollection: 'research_entities',
    required: false,
    meaning: 'Listing entity refs must resolve to a research entity',
  },
  {
    name: 'relationship_source_to_entity',
    fromCollection: 'research_entity_relationships',
    localField: 'sourceResearchEntityId',
    toCollection: 'research_entities',
    required: true,
    meaning: 'Relationship source must resolve to a research entity',
  },
  {
    name: 'relationship_target_to_entity',
    fromCollection: 'research_entity_relationships',
    localField: 'targetResearchEntityId',
    toCollection: 'research_entities',
    required: true,
    meaning: 'Relationship target must resolve to a research entity',
  },
  {
    name: 'student_application_to_listing',
    fromCollection: 'student_applications',
    localField: 'listingObjectId',
    toCollection: 'listings',
    required: false,
    meaning: 'Student application listing refs must resolve to a listing',
  },
  {
    name: 'student_application_to_opportunity',
    fromCollection: 'student_applications',
    localField: 'postedOpportunityId',
    toCollection: 'posted_opportunities',
    required: false,
    meaning: 'Student application opportunity refs must resolve to a posted opportunity',
  },
  {
    name: 'student_application_to_entity',
    fromCollection: 'student_applications',
    localField: 'researchEntityId',
    toCollection: 'research_entities',
    required: false,
    meaning: 'Student application entity refs must resolve to a research entity',
  },
  {
    name: 'student_application_to_user',
    fromCollection: 'student_applications',
    localField: 'studentUserId',
    toCollection: 'users',
    required: false,
    meaning: 'Student application user refs must resolve to a user',
  },
  {
    name: 'student_application_to_profile',
    fromCollection: 'student_applications',
    localField: 'studentProfileId',
    toCollection: 'student_profiles',
    required: false,
    meaning: 'Student application profile refs must resolve to a student profile',
  },
  {
    name: 'student_tracking_to_profile',
    fromCollection: 'student_trackings',
    localField: 'studentProfileId',
    toCollection: 'student_profiles',
    required: true,
    meaning: 'Student tracking profile refs must resolve to a student profile',
  },
  {
    name: 'student_tracking_to_entity',
    fromCollection: 'student_trackings',
    localField: 'researchEntityId',
    toCollection: 'research_entities',
    required: true,
    meaning: 'Student tracking entity refs must resolve to a research entity',
  },
  {
    name: 'student_outreach_to_profile',
    fromCollection: 'student_outreaches',
    localField: 'studentProfileId',
    toCollection: 'student_profiles',
    required: true,
    meaning: 'Student outreach profile refs must resolve to a student profile',
  },
  {
    name: 'student_outreach_to_entity',
    fromCollection: 'student_outreaches',
    localField: 'researchEntityId',
    toCollection: 'research_entities',
    required: true,
    meaning: 'Student outreach entity refs must resolve to a research entity',
  },
  {
    name: 'student_outreach_to_tracking',
    fromCollection: 'student_outreaches',
    localField: 'trackingId',
    toCollection: 'student_trackings',
    required: true,
    meaning: 'Student outreach tracking refs must resolve to a student tracking record',
  },
  {
    name: 'student_engagement_to_profile',
    fromCollection: 'student_engagement_events',
    localField: 'studentProfileId',
    toCollection: 'student_profiles',
    required: false,
    meaning: 'Student engagement profile refs must resolve to a student profile',
  },
  {
    name: 'student_engagement_to_entity',
    fromCollection: 'student_engagement_events',
    localField: 'researchEntityId',
    toCollection: 'research_entities',
    required: true,
    meaning: 'Student engagement entity refs must resolve to a research entity',
  },
  {
    name: 'observation_to_source',
    fromCollection: 'observations',
    localField: 'sourceId',
    toCollection: 'sources',
    required: true,
    meaning: 'Observations must resolve to a source',
  },
];

const SYSTEM_COLLECTION_PATTERN = /^system\./;

// ---------------------------------------------------------------------------
// Facts gathered by the runner
// ---------------------------------------------------------------------------

export interface SchemaVersionBucket {
  bsonType: string;
  value?: unknown;
  count: number;
}

export interface CollectionCensusFact {
  collection: string;
  present: boolean;
  documentCount: number;
  schemaVersions: SchemaVersionBucket[];
}

export interface FieldPresenceFact {
  collection: string;
  field: string;
  present: number;
  total: number;
}

export interface ReferenceIntegrityFact {
  name: string;
  fromCollection: string;
  toCollection: string;
  status: 'checked' | 'target-missing' | 'source-missing';
  checked: number;
  orphaned: number;
  sampleOrphanIds: string[];
}

export interface InventoryFacts {
  liveCollections: string[];
  census: CollectionCensusFact[];
  fieldPresence: FieldPresenceFact[];
  referenceIntegrity: ReferenceIntegrityFact[];
}

// ---------------------------------------------------------------------------
// Report shape
// ---------------------------------------------------------------------------

export interface CollectionReportRow {
  collection: string;
  model: string;
  group: InventoryGroup;
  phase: number | null;
  target: string;
  present: boolean;
  documentCount: number;
  schemaVersions: SchemaVersionBucket[];
  /** Legacy collection expected gone but still holding documents. */
  residue: boolean;
}

export interface RetirementFieldRow {
  collection: string;
  field: string;
  meaning: string;
  target: string;
  present: number;
  total: number;
  prevalence: number;
}

export interface ReferenceIntegrityRow extends Omit<ReferenceIntegrityFact, 'status'> {
  status: ReferenceIntegrityFact['status'] | 'not-gathered';
  localField: string;
  required: boolean;
  meaning: string;
  orphanRate: number;
  clean: boolean | null;
}

export interface InventorySummary {
  coverageScope: string;
  collectionsClassified: number;
  collectionsPresent: number;
  legacyResidueCollections: string[];
  unclassifiedCollections: string[];
  totalDocuments: number;
  retirementFieldsStillPresent: number;
  referenceEdgesChecked: number;
  referenceEdgesSkipped: number;
  referenceEdgesWithOrphans: number;
  totalOrphans: number;
}

export interface InventoryReport {
  summary: InventorySummary;
  collections: CollectionReportRow[];
  retirementFields: RetirementFieldRow[];
  referenceIntegrity: ReferenceIntegrityRow[];
}

function ratio(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 10000) / 10000;
}

/**
 * Any live collection that is not classified and not a Mongo system collection.
 * Surfacing these prevents a silent migration blind spot.
 */
export function findUnclassifiedCollections(
  liveCollections: string[],
  specs: CollectionSpec[] = INVENTORY_COLLECTIONS,
): string[] {
  const known = new Set(specs.map((spec) => spec.collection));
  return liveCollections
    .filter((name) => !known.has(name) && !SYSTEM_COLLECTION_PATTERN.test(name))
    .sort();
}

export function buildResearchModelInventoryReport(
  facts: InventoryFacts,
  specs: CollectionSpec[] = INVENTORY_COLLECTIONS,
  fieldProbes: FieldProbe[] = RETIREMENT_FIELD_PROBES,
  referenceEdges: ReferenceEdge[] = REFERENCE_EDGES,
): InventoryReport {
  const censusByCollection = new Map(facts.census.map((row) => [row.collection, row]));
  const fieldFactByKey = new Map(
    facts.fieldPresence.map((row) => [`${row.collection}.${row.field}`, row]),
  );
  const referenceFactByName = new Map(facts.referenceIntegrity.map((row) => [row.name, row]));

  const collections: CollectionReportRow[] = specs.map((spec) => {
    const census = censusByCollection.get(spec.collection);
    const present = census?.present ?? false;
    const documentCount = census?.documentCount ?? 0;
    const residue = spec.expectPresent === false && present && documentCount > 0;
    return {
      collection: spec.collection,
      model: spec.model,
      group: spec.group,
      phase: spec.phase,
      target: spec.target,
      present,
      documentCount,
      schemaVersions: census?.schemaVersions ?? [],
      residue,
    };
  });

  const retirementFields: RetirementFieldRow[] = fieldProbes.map((probe) => {
    const fact = fieldFactByKey.get(`${probe.collection}.${probe.field}`);
    const present = fact?.present ?? 0;
    const total = fact?.total ?? 0;
    return {
      collection: probe.collection,
      field: probe.field,
      meaning: probe.meaning,
      target: probe.target,
      present,
      total,
      prevalence: ratio(present, total),
    };
  });

  const referenceIntegrity: ReferenceIntegrityRow[] = referenceEdges.map((edge) => {
    const fact = referenceFactByName.get(edge.name);
    const status = fact?.status ?? 'not-gathered';
    const checked = fact?.checked ?? 0;
    const orphaned = fact?.orphaned ?? 0;
    return {
      name: edge.name,
      fromCollection: edge.fromCollection,
      toCollection: edge.toCollection,
      status,
      localField: edge.localField,
      required: edge.required,
      meaning: edge.meaning,
      checked,
      orphaned,
      sampleOrphanIds: fact?.sampleOrphanIds ?? [],
      orphanRate: ratio(orphaned, checked),
      clean:
        status === 'checked'
          ? orphaned === 0
          : status === 'target-missing' && checked > 0
            ? false
            : null,
    };
  });

  const legacyResidueCollections = collections
    .filter((row) => row.residue)
    .map((row) => row.collection);

  const summary: InventorySummary = {
    coverageScope:
      'Curated refactor-relevant collections, fields, and scalar reference edges; totalOrphans counts only tracked edges and is not an exhaustive referential-integrity proof.',
    collectionsClassified: specs.length,
    collectionsPresent: collections.filter((row) => row.present).length,
    legacyResidueCollections,
    unclassifiedCollections: findUnclassifiedCollections(facts.liveCollections, specs),
    totalDocuments: collections.reduce((sum, row) => sum + row.documentCount, 0),
    retirementFieldsStillPresent: retirementFields.filter((row) => row.present > 0).length,
    referenceEdgesChecked: referenceIntegrity.filter(
      (row) => row.status === 'checked' || row.status === 'target-missing',
    ).length,
    referenceEdgesSkipped: referenceIntegrity.filter(
      (row) => row.status === 'source-missing' || row.status === 'not-gathered',
    ).length,
    referenceEdgesWithOrphans: referenceIntegrity.filter((row) => row.orphaned > 0).length,
    totalOrphans: referenceIntegrity.reduce((sum, row) => sum + row.orphaned, 0),
  };

  return { summary, collections, retirementFields, referenceIntegrity };
}

// ---------------------------------------------------------------------------
// CLI args + output envelope
// ---------------------------------------------------------------------------

export interface ResearchModelInventoryArgs {
  environment: InventoryEnvironment;
  /** Max orphan sample ids retained per reference edge. */
  sampleLimit: number;
  /** Optional .json report output path (guarded to tmp roots). */
  output?: string;
}

export function parseResearchModelInventoryArgs(argv: string[]): ResearchModelInventoryArgs {
  let environment: InventoryEnvironment | undefined;
  let sampleLimit = 20;
  let output: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--environment') {
      const raw = argv[i + 1];
      if (
        raw !== 'development' &&
        raw !== 'beta' &&
        raw !== 'production-copy' &&
        raw !== 'production' &&
        raw !== 'test'
      ) {
        throw new Error(
          '--environment requires development, beta, production-copy, production, or test',
        );
      }
      environment = raw;
      i += 1;
    } else if (arg === '--sample-limit') {
      const raw = argv[i + 1];
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error('--sample-limit requires a non-negative number');
      }
      sampleLimit = Math.floor(parsed);
      i += 1;
    } else if (arg === '--output') {
      const raw = argv[i + 1];
      if (!raw) {
        throw new Error('--output requires a path');
      }
      output = raw;
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!environment) {
    throw new Error('--environment is required');
  }

  return { environment, sampleLimit, output };
}

export function buildResearchModelInventoryOutput(
  report: InventoryReport,
  metadata: {
    environment: InventoryEnvironment;
    db?: string;
    target?: string;
    sourceCommit?: string;
    generatedAt?: string;
    options: ResearchModelInventoryArgs;
  },
): InventoryReport & {
  generatedAt: string;
  environment: InventoryEnvironment;
  db?: string;
  target?: string;
  sourceCommit?: string;
  options: ResearchModelInventoryArgs;
} {
  return {
    generatedAt: metadata.generatedAt ?? new Date().toISOString(),
    environment: metadata.environment,
    ...(metadata.db ? { db: metadata.db } : {}),
    ...(metadata.target ? { target: metadata.target } : {}),
    ...(metadata.sourceCommit ? { sourceCommit: metadata.sourceCommit } : {}),
    ...report,
    options: metadata.options,
  };
}

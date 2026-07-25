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

export type InventoryGroup =
  | 'canonical-domain'
  | 'dual-truth'
  | 'legacy-residue'
  | 'scholarly-retire'
  | 'evidence'
  | 'private'
  | 'reference-data';

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
  meaning: string;
}

export type InventoryEnvironment =
  | 'development'
  | 'beta'
  | 'production-copy'
  | 'production'
  | 'test';

/** Refactor-relevant collections, keyed by physical name. */
export const INVENTORY_COLLECTIONS: CollectionSpec[] = [
  { collection: 'users', model: 'User', group: 'dual-truth', phase: 2, target: 'Account + Person (+ StudentProfile, ResearchPlan)' },
  { collection: 'faculty_members', model: 'FacultyMember', group: 'dual-truth', phase: 2, target: 'Person (deterministic merge, quarantine conflicts)' },
  { collection: 'research_entity_members', model: 'ResearchGroupMember', group: 'dual-truth', phase: 2, target: 'RoleAssignment (one entity id, one person id)' },
  { collection: 'research_entities', model: 'ResearchEntity', group: 'canonical-domain', phase: 4, target: 'Clean ResearchEntity schema + bounded discovery projection' },
  { collection: 'research_entity_relationships', model: 'ResearchEntityRelationship', group: 'canonical-domain', phase: 4, target: 'EntityRelationship' },
  { collection: 'entry_pathways', model: 'EntryPathway', group: 'canonical-domain', phase: 4, target: 'EntryPathway (retained)' },
  { collection: 'posted_opportunities', model: 'PostedOpportunity', group: 'canonical-domain', phase: 4, target: 'PostedOpportunity (retained)' },
  { collection: 'access_signals', model: 'AccessSignal', group: 'canonical-domain', phase: 4, target: 'AccessSignal (retained)' },
  { collection: 'contact_routes', model: 'ContactRoute', group: 'canonical-domain', phase: 4, target: 'ContactRoute (retained)' },
  { collection: 'admin_grants', model: 'AdminGrant', group: 'canonical-domain', phase: null, target: 'AdminGrant (admin authority)' },
  { collection: 'listings', model: 'Listing', group: 'legacy-residue', phase: 4, target: 'EntryPathway + PostedOpportunity' },
  { collection: 'fellowships', model: 'Fellowship', group: 'legacy-residue', phase: 4, target: 'Classify: entity / pathway / posting / formalization' },
  { collection: 'departments', model: 'Department', group: 'reference-data', phase: 4, target: 'OrgUnit' },
  { collection: 'research_areas', model: 'ResearchArea', group: 'reference-data', phase: 4, target: 'TaxonomyTerm' },
  { collection: 'grants', model: 'Grant', group: 'reference-data', phase: null, target: 'Deferred; never undergraduate-access evidence' },
  { collection: 'papers', model: 'Paper', group: 'scholarly-retire', phase: 3, target: 'No target collection' },
  { collection: 'paper_authors', model: 'PaperAuthor', group: 'scholarly-retire', phase: 3, target: 'No target collection' },
  { collection: 'research_scholarly_links', model: 'ResearchScholarlyLink', group: 'scholarly-retire', phase: 3, target: 'Crux: bare outbound link vs curated activity surface' },
  { collection: 'research_scholarly_attributions', model: 'ResearchScholarlyAttribution', group: 'scholarly-retire', phase: 3, target: 'No target collection' },
  { collection: 'observations', model: 'Observation', group: 'evidence', phase: 5, target: 'EvidenceClaim (+ SourceDocument)' },
  { collection: 'sources', model: 'Source', group: 'evidence', phase: 5, target: 'Source + SourceDocument' },
  { collection: 'student_profiles', model: 'StudentProfile', group: 'private', phase: 4, target: 'StudentProfile (retained)' },
  { collection: 'student_applications', model: 'StudentApplication', group: 'private', phase: 4, target: 'Private student application records (retained, normalized references)' },
  { collection: 'student_trackings', model: 'StudentTracking', group: 'private', phase: 4, target: 'ResearchPlan' },
  { collection: 'student_outreaches', model: 'StudentOutreach', group: 'private', phase: null, target: 'Private outreach state' },
  { collection: 'student_engagement_events', model: 'StudentEngagementEvent', group: 'private', phase: null, target: 'EngagementEvent (append-only analytics)' },
  // Expected already retired by the earlier hard-pivot; presence is residue.
  { collection: 'research_groups', model: 'ResearchGroup', group: 'legacy-residue', phase: 0, target: 'research_entities (should be dropped)', expectPresent: false },
  { collection: 'research_group_members', model: 'ResearchGroupMember (legacy)', group: 'legacy-residue', phase: 0, target: 'research_entity_members (should be dropped)', expectPresent: false },
  { collection: 'research_group_stats', model: 'ResearchGroupStats', group: 'legacy-residue', phase: 0, target: 'None (should be dropped)', expectPresent: false },
  { collection: 'paper_group_links', model: 'PaperGroupLink', group: 'legacy-residue', phase: 0, target: 'None (should be dropped)', expectPresent: false },
  { collection: 'applications', model: 'Application', group: 'legacy-residue', phase: 0, target: 'student_applications (should be dropped)', expectPresent: false },
];

/** Legacy fields whose lingering prevalence gates their retirement phase. */
export const RETIREMENT_FIELD_PROBES: FieldProbe[] = [
  { collection: 'research_entities', field: 'kind', meaning: 'Legacy type field superseded by entityType', target: 'Retire after read cutover' },
  { collection: 'research_entities', field: 'acceptingUndergrads', meaning: 'Binary access cache', target: 'AccessSignal + computed access summary' },
  { collection: 'research_entities', field: 'openness', meaning: 'Openness cache', target: 'AccessSignal + computed access summary' },
  { collection: 'research_entities', field: 'acceptanceConfidence', meaning: 'Openness confidence cache', target: 'AccessSignal + computed access summary' },
  { collection: 'research_entities', field: 'shortDescription', meaning: 'Duplicate description field', target: 'Single description' },
  { collection: 'research_entities', field: 'fullDescription', meaning: 'Duplicate description field', target: 'Single description' },
  { collection: 'research_entity_members', field: 'researchGroupId', meaning: 'Legacy entity reference', target: 'RoleAssignment.target.id' },
  { collection: 'research_entity_members', field: 'researchEntityId', meaning: 'Canonical entity reference', target: 'RoleAssignment.target.id' },
  { collection: 'research_entity_members', field: 'userId', meaning: 'User person reference', target: 'RoleAssignment.personId' },
  { collection: 'research_entity_members', field: 'facultyMemberId', meaning: 'FacultyMember person reference', target: 'RoleAssignment.personId' },
  { collection: 'users', field: 'publications', meaning: 'Embedded publication array', target: 'Removed (link to official profile / ORCID)' },
  { collection: 'users', field: 'favPathways', meaning: 'Legacy saved-pathway array', target: 'ResearchPlan' },
  { collection: 'users', field: 'savedPathwayPlans', meaning: 'Legacy saved-pathway plan map', target: 'ResearchPlan' },
  { collection: 'users', field: 'savedResearchEntities', meaning: 'Saved-entity array', target: 'ResearchPlan' },
  { collection: 'users', field: 'savedResearchEntityPlans', meaning: 'Saved-entity plan map', target: 'ResearchPlan' },
  { collection: 'users', field: 'orcid', meaning: 'External researcher identifier', target: 'Person.identifiers.orcid' },
  { collection: 'users', field: 'hIndex', meaning: 'Mirrored citation metric', target: 'Remove with professor-profile mirrors' },
  { collection: 'users', field: 'googleScholarId', meaning: 'Mirrored scholarly identifier', target: 'Remove with professor-profile mirrors' },
  { collection: 'users', field: 'openAlexId', meaning: 'Mirrored scholarly identifier', target: 'Remove with professor-profile mirrors' },
  { collection: 'users', field: 'semanticScholarId', meaning: 'Mirrored scholarly identifier', target: 'Remove with professor-profile mirrors' },
  { collection: 'listings', field: 'researchGroupId', meaning: 'Legacy entity reference', target: 'researchEntityId before Listing retirement' },
  { collection: 'student_trackings', field: 'researchGroupId', meaning: 'Legacy entity reference', target: 'researchEntityId' },
  { collection: 'student_outreaches', field: 'researchGroupId', meaning: 'Legacy entity reference', target: 'researchEntityId' },
  { collection: 'student_engagement_events', field: 'researchGroupId', meaning: 'Legacy entity reference', target: 'researchEntityId' },
];

/** Reference edges whose orphans block clean cutover. */
export const REFERENCE_EDGES: ReferenceEdge[] = [
  { name: 'member_to_entity', fromCollection: 'research_entity_members', localField: 'researchEntityId', toCollection: 'research_entities', meaning: 'Membership rows must resolve to a research entity' },
  { name: 'member_to_user', fromCollection: 'research_entity_members', localField: 'userId', toCollection: 'users', meaning: 'Membership user refs must resolve to a user' },
  { name: 'member_to_faculty', fromCollection: 'research_entity_members', localField: 'facultyMemberId', toCollection: 'faculty_members', meaning: 'Membership faculty refs must resolve to a faculty member' },
  { name: 'access_signal_to_entity', fromCollection: 'access_signals', localField: 'researchEntityId', toCollection: 'research_entities', meaning: 'Access signals must resolve to a research entity' },
  { name: 'access_signal_to_pathway', fromCollection: 'access_signals', localField: 'entryPathwayId', toCollection: 'entry_pathways', meaning: 'Access signal pathway refs must resolve to an entry pathway' },
  { name: 'entry_pathway_to_entity', fromCollection: 'entry_pathways', localField: 'researchEntityId', toCollection: 'research_entities', meaning: 'Entry pathways must resolve to a research entity' },
  { name: 'contact_route_to_entity', fromCollection: 'contact_routes', localField: 'researchEntityId', toCollection: 'research_entities', meaning: 'Contact routes must resolve to a research entity' },
  { name: 'contact_route_to_pathway', fromCollection: 'contact_routes', localField: 'entryPathwayId', toCollection: 'entry_pathways', meaning: 'Contact route pathway refs must resolve to an entry pathway' },
  { name: 'posted_opportunity_to_pathway', fromCollection: 'posted_opportunities', localField: 'entryPathwayId', toCollection: 'entry_pathways', meaning: 'Posted opportunities must resolve to an entry pathway' },
  { name: 'posted_opportunity_to_entity', fromCollection: 'posted_opportunities', localField: 'researchEntityId', toCollection: 'research_entities', meaning: 'Posted opportunity entity refs must resolve to a research entity' },
  { name: 'relationship_source_to_entity', fromCollection: 'research_entity_relationships', localField: 'sourceResearchEntityId', toCollection: 'research_entities', meaning: 'Relationship source must resolve to a research entity' },
  { name: 'relationship_target_to_entity', fromCollection: 'research_entity_relationships', localField: 'targetResearchEntityId', toCollection: 'research_entities', meaning: 'Relationship target must resolve to a research entity' },
];

const SYSTEM_COLLECTION_PATTERN = /^(system\.|__)/;

// ---------------------------------------------------------------------------
// Facts gathered by the runner
// ---------------------------------------------------------------------------

export interface SchemaVersionBucket {
  version: string;
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
  meaning: string;
  orphanRate: number;
  clean: boolean | null;
}

export interface InventorySummary {
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
  const referenceFactByName = new Map(
    facts.referenceIntegrity.map((row) => [row.name, row]),
  );

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
      meaning: edge.meaning,
      checked,
      orphaned,
      sampleOrphanIds: fact?.sampleOrphanIds ?? [],
      orphanRate: ratio(orphaned, checked),
      clean:
        status === 'checked'
          ? orphaned === 0
          : status === 'target-missing'
            ? false
            : null,
    };
  });

  const legacyResidueCollections = collections
    .filter((row) => row.residue)
    .map((row) => row.collection);

  const summary: InventorySummary = {
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

export function parseResearchModelInventoryArgs(
  argv: string[],
): ResearchModelInventoryArgs {
  let environment: InventoryEnvironment | undefined;
  let sampleLimit = 20;
  let output: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--environment') {
      const raw = argv[i + 1];
      if (
        raw !== 'development'
        && raw !== 'beta'
        && raw !== 'production-copy'
        && raw !== 'production'
        && raw !== 'test'
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
    generatedAt?: string;
    options: ResearchModelInventoryArgs;
  },
): InventoryReport & {
  generatedAt: string;
  environment: InventoryEnvironment;
  db?: string;
  target?: string;
  options: ResearchModelInventoryArgs;
} {
  return {
    generatedAt: metadata.generatedAt ?? new Date().toISOString(),
    environment: metadata.environment,
    ...(metadata.db ? { db: metadata.db } : {}),
    ...(metadata.target ? { target: metadata.target } : {}),
    ...report,
    options: metadata.options,
  };
}

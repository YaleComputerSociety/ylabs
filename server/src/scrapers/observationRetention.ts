import { Observation } from '../models/observation';
import { ScrapeRun } from '../models/scrapeRun';
import { materializationReadScopeFilter } from './entityMaterializer';
import { c4LosslessIngestDeclared } from './observationStore';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Both pruners key on `superseded: true`, which is only safe while the
 * materializer's read scope excludes superseded rows. Under C4_LOSSLESS_INGEST
 * the scope widens to the whole retained log, so the same delete stops being a
 * storage reclaim and becomes a projection change: a slot whose only remaining
 * evidence is superseded loses its sole backing, and the `fieldsWritten`
 * counters still report a clean run. Read the materializer's own scope rather
 * than restating the assumption here, so turning the flag on cannot leave the
 * two out of step.
 */
export function supersededPruneIsProjectionNeutral(): boolean {
  return materializationReadScopeFilter().superseded === false;
}

export function assertSupersededPruneDeletionAllowed(): void {
  if (supersededPruneIsProjectionNeutral()) return;
  throw new Error(
    'Superseded-observation pruning is disabled while the materializer projects superseded rows (C4_LOSSLESS_INGEST). Under lossless ingest a superseded row can still be the only evidence a field has, so deleting it changes the projection instead of reclaiming storage.',
  );
}

export interface SupersededObservationPruneOptions {
  now?: Date;
  olderThanDays?: number;
  keepRuns?: number;
  sourceName?: string;
  apply?: boolean;
}

export interface SupersededObservationPruneResult {
  apply: boolean;
  projectionNeutral: boolean;
  readScopeDeclared: boolean;
  eligibleCandidates: number;
  protectedCandidates: number;
  candidates: number;
  deleted: number;
  cutoff: string;
  keepRuns: number;
  retainedRuns: number;
  sourceName?: string;
  referenceSpecs: ObservationReferenceSpecCoverage[];
}

type ObservationReferenceKind = 'field' | 'provenance-map';

export interface ObservationReferenceSpec {
  collection: string;
  field: string;
  kind?: ObservationReferenceKind;
}

/**
 * Four of these name collections the canonical model retired (#210 Phase 6), and
 * they are kept rather than deleted because a target that has not had its drop
 * applied yet still needs the protection. An aggregate over an absent collection
 * returns an empty result rather than an error, so such a spec contributes zero
 * protected ids silently, which is indistinguishable from a live collection that
 * happens to reference nothing. `referenceSpecs` in a prune result separates the
 * two, so read it rather than trusting the list's length.
 */
export const OBSERVATION_REFERENCE_SPECS: ObservationReferenceSpec[] = [
  { collection: 'observations', field: 'supersededBy' },
  { collection: 'signals', field: 'source.evidenceIds' },
  { collection: 'research_entities', field: 'fieldProvenance', kind: 'provenance-map' },
  { collection: 'faculty_members', field: 'fieldProvenance', kind: 'provenance-map' },
  { collection: 'papers', field: 'fieldProvenance', kind: 'provenance-map' },
  { collection: 'paper_authors', field: 'fieldProvenance', kind: 'provenance-map' },
  { collection: 'research_entity_members', field: 'fieldProvenance', kind: 'provenance-map' },
];

export interface ObservationReferenceSpecCoverage {
  collection: string;
  field: string;
  collectionPresent: boolean;
  referencedObservations: number;
}

export function buildSupersededObservationPruneFilter(input: {
  cutoff: Date;
  sourceName?: string;
  keepRunIds?: unknown[];
}): Record<string, unknown> {
  const filter: Record<string, unknown> = {
    superseded: true,
    observedAt: { $lt: input.cutoff },
  };
  if (input.sourceName) filter.sourceName = input.sourceName;
  if (input.keepRunIds && input.keepRunIds.length > 0) {
    filter.scrapeRunId = { $nin: input.keepRunIds };
  }
  return filter;
}

export function buildObservationReferencePipeline(
  spec: ObservationReferenceSpec,
): Record<string, unknown>[] {
  if (spec.kind === 'provenance-map') {
    return [
      {
        $project: {
          provenanceValues: {
            $cond: [
              { $eq: [{ $type: `$${spec.field}` }, 'object'] },
              { $objectToArray: `$${spec.field}` },
              [],
            ],
          },
        },
      },
      { $unwind: '$provenanceValues' },
      { $project: { observationId: '$provenanceValues.v.observationId' } },
      { $match: { observationId: { $type: 'objectId' } } },
      { $group: { _id: '$observationId' } },
    ];
  }

  return [
    { $project: { observationId: `$${spec.field}` } },
    { $unwind: '$observationId' },
    { $match: { observationId: { $type: 'objectId' } } },
    { $group: { _id: '$observationId' } },
  ];
}

export async function pruneSupersededObservations(
  options: SupersededObservationPruneOptions = {},
): Promise<SupersededObservationPruneResult> {
  const now = options.now || new Date();
  if (options.apply) assertSupersededPruneDeletionAllowed();
  const olderThanDays = positiveInteger(options.olderThanDays ?? 30, 'olderThanDays');
  const keepRuns = nonNegativeInteger(options.keepRuns ?? 3, 'keepRuns');
  const cutoff = new Date(now.getTime() - olderThanDays * DAY_MS);
  const keptRunIds = await findKeptRunIds({
    sourceName: options.sourceName,
    keepRuns,
  });
  const eligibleFilter = buildSupersededObservationPruneFilter({
    cutoff,
    sourceName: options.sourceName,
    keepRunIds: keptRunIds,
  });
  const referenceScan = await scanReferencedObservations();
  const { eligibleCandidates, candidates, deleted } = await pruneUnreferencedEligibleObservations({
    eligibleFilter,
    referencedObservationIds: referenceScan.ids,
    apply: Boolean(options.apply),
  });

  return {
    apply: Boolean(options.apply),
    projectionNeutral: supersededPruneIsProjectionNeutral(),
    readScopeDeclared: c4LosslessIngestDeclared(),
    eligibleCandidates,
    protectedCandidates: Math.max(0, eligibleCandidates - candidates),
    candidates,
    deleted,
    cutoff: cutoff.toISOString(),
    keepRuns,
    retainedRuns: keptRunIds.length,
    sourceName: options.sourceName,
    referenceSpecs: referenceScan.specs,
  };
}

export const DEFAULT_DEAD_OBSERVATION_KEEP_RUNS = 3;

export interface DeadObservationPruneOptions {
  now?: Date;
  keepRuns?: number;
  sourceName?: string;
  apply?: boolean;
}

export interface DeadObservationPruneResult {
  apply: boolean;
  projectionNeutral: boolean;
  readScopeDeclared: boolean;
  eligibleCandidates: number;
  protectedCandidates: number;
  candidates: number;
  deleted: number;
  cutoff: string;
  keepRuns: number;
  retainedRuns: number;
  sourceName?: string;
  referenceSpecs: ObservationReferenceSpecCoverage[];
}

export async function pruneDeadObservations(
  options: DeadObservationPruneOptions = {},
): Promise<DeadObservationPruneResult> {
  const now = options.now || new Date();
  if (options.apply) assertSupersededPruneDeletionAllowed();
  const keepRuns = nonNegativeInteger(
    options.keepRuns ?? DEFAULT_DEAD_OBSERVATION_KEEP_RUNS,
    'keepRuns',
  );
  const keptRunIds = await findKeptRunIds({ sourceName: options.sourceName, keepRuns });
  const eligibleFilter = buildSupersededObservationPruneFilter({
    cutoff: now,
    sourceName: options.sourceName,
    keepRunIds: keptRunIds,
  });
  const referenceScan = await scanReferencedObservations();
  const { eligibleCandidates, candidates, deleted } = await pruneUnreferencedEligibleObservations({
    eligibleFilter,
    referencedObservationIds: referenceScan.ids,
    apply: Boolean(options.apply),
  });

  return {
    apply: Boolean(options.apply),
    projectionNeutral: supersededPruneIsProjectionNeutral(),
    readScopeDeclared: c4LosslessIngestDeclared(),
    eligibleCandidates,
    protectedCandidates: Math.max(0, eligibleCandidates - candidates),
    candidates,
    deleted,
    cutoff: now.toISOString(),
    keepRuns,
    retainedRuns: keptRunIds.length,
    sourceName: options.sourceName,
    referenceSpecs: referenceScan.specs,
  };
}

export const OBSERVATION_PRUNE_DELETE_BATCH_SIZE = 5000;

/**
 * Referenced ids are excluded in memory rather than sent as an `_id: { $nin }` filter,
 * because the referenced set grows with the corpus and passed the 16 MB BSON command
 * limit on Development at about one million ids (#3733).
 */
async function pruneUnreferencedEligibleObservations(input: {
  eligibleFilter: Record<string, unknown>;
  referencedObservationIds: unknown[];
  apply: boolean;
}): Promise<{ eligibleCandidates: number; candidates: number; deleted: number }> {
  const referencedKeys = new Set(input.referencedObservationIds.map((id) => String(id)));
  let eligibleCandidates = 0;
  const unreferencedIds: unknown[] = [];
  const cursor = Observation.find(input.eligibleFilter).select('_id').lean().cursor();
  for await (const row of cursor) {
    eligibleCandidates += 1;
    if (!referencedKeys.has(String(row._id))) unreferencedIds.push(row._id);
  }
  let deleted = 0;
  if (input.apply) {
    for (
      let start = 0;
      start < unreferencedIds.length;
      start += OBSERVATION_PRUNE_DELETE_BATCH_SIZE
    ) {
      const batch = unreferencedIds.slice(start, start + OBSERVATION_PRUNE_DELETE_BATCH_SIZE);
      const result = await Observation.deleteMany({ ...input.eligibleFilter, _id: { $in: batch } });
      deleted += result.deletedCount || 0;
    }
  }
  return { eligibleCandidates, candidates: unreferencedIds.length, deleted };
}

export interface ReferencedObservationScan {
  ids: unknown[];
  specs: ObservationReferenceSpecCoverage[];
}

/**
 * `specs` is an argument so a caller retiring a whole field can leave out
 * `observations.supersededBy`: when every observation of that field is deleted in one
 * pass, a pointer from one doomed row to another is bookkeeping rather than a reader, and
 * counting it as protection would keep the entire supersession chain (#4161).
 */
export async function scanReferencedObservations(
  specs: readonly ObservationReferenceSpec[] = OBSERVATION_REFERENCE_SPECS,
): Promise<ReferencedObservationScan> {
  const referencedIds = new Map<string, unknown>();
  const coverage: ObservationReferenceSpecCoverage[] = [];
  const presentCollections = new Set(
    (await Observation.db.listCollections()).map((info) => info.name),
  );
  for (const spec of specs) {
    const collectionPresent = presentCollections.has(spec.collection);
    const rows = await Observation.db
      .collection(spec.collection)
      .aggregate(buildObservationReferencePipeline(spec), { allowDiskUse: true })
      .toArray();
    const specIds = new Set<string>();
    for (const row of rows) {
      if (!row?._id) continue;
      specIds.add(String(row._id));
      referencedIds.set(String(row._id), row._id);
    }
    coverage.push({
      collection: spec.collection,
      field: spec.field,
      collectionPresent,
      referencedObservations: specIds.size,
    });
  }
  return { ids: Array.from(referencedIds.values()), specs: coverage };
}

export async function findReferencedObservationIds(): Promise<unknown[]> {
  return (await scanReferencedObservations()).ids;
}

export function observationReferenceSpecsWithoutCollection(
  specs: readonly ObservationReferenceSpecCoverage[],
): string[] {
  return specs.filter((spec) => !spec.collectionPresent).map((spec) => spec.collection);
}

export function observationReferenceCoverageWarning(
  specs: readonly ObservationReferenceSpecCoverage[],
): string | undefined {
  const absent = observationReferenceSpecsWithoutCollection(specs);
  if (absent.length === 0) return undefined;
  return `${absent.length} of ${specs.length} observation reference specs name a collection this database does not hold (${absent.join(', ')}), so they protected nothing on this run. Expected where the #210 Phase 6 drops have been applied; a name that should be live means the guard is not firing.`;
}

async function findKeptRunIds(input: {
  sourceName?: string;
  keepRuns: number;
}): Promise<unknown[]> {
  if (input.keepRuns <= 0) return [];

  const match = input.sourceName ? { sourceName: input.sourceName } : {};
  const rows = await ScrapeRun.aggregate([
    { $match: match },
    { $sort: { sourceName: 1, startedAt: -1 } },
    { $group: { _id: '$sourceName', runIds: { $push: '$_id' } } },
    { $project: { runIds: { $slice: ['$runIds', input.keepRuns] } } },
  ]);

  return rows.flatMap((row: any) => row.runIds || []);
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return Math.floor(value);
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return Math.floor(value);
}

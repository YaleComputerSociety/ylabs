import { Observation } from '../models/observation';
import { ScrapeRun } from '../models/scrapeRun';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SupersededObservationPruneOptions {
  now?: Date;
  olderThanDays?: number;
  keepRuns?: number;
  sourceName?: string;
  apply?: boolean;
}

export interface SupersededObservationPruneResult {
  apply: boolean;
  eligibleCandidates: number;
  protectedCandidates: number;
  candidates: number;
  deleted: number;
  cutoff: string;
  keepRuns: number;
  keptRunIds: unknown[];
  sourceName?: string;
}

type ObservationReferenceKind = 'field' | 'provenance-map';

export interface ObservationReferenceSpec {
  collection: string;
  field: string;
  kind?: ObservationReferenceKind;
}

export const OBSERVATION_REFERENCE_SPECS: ObservationReferenceSpec[] = [
  { collection: 'observations', field: 'supersededBy' },
  { collection: 'research_entities', field: 'opennessSignals.observationId' },
  { collection: 'entry_pathways', field: 'sourceEvidenceIds' },
  { collection: 'access_signals', field: 'sourceEvidenceId' },
  { collection: 'access_signals', field: 'observationId' },
  { collection: 'contact_routes', field: 'sourceEvidenceId' },
  { collection: 'contact_routes', field: 'sourceEvidenceIds' },
  { collection: 'posted_opportunities', field: 'sourceEvidenceIds' },
  { collection: 'undergraduate_logistics_claims', field: 'sourceEvidenceIds' },
  { collection: 'research_entities', field: 'fieldProvenance', kind: 'provenance-map' },
  { collection: 'faculty_members', field: 'fieldProvenance', kind: 'provenance-map' },
  { collection: 'papers', field: 'fieldProvenance', kind: 'provenance-map' },
  { collection: 'paper_authors', field: 'fieldProvenance', kind: 'provenance-map' },
  { collection: 'research_entity_members', field: 'fieldProvenance', kind: 'provenance-map' },
  { collection: 'grants', field: 'fieldProvenance', kind: 'provenance-map' },
];

export function buildSupersededObservationPruneFilter(input: {
  cutoff: Date;
  sourceName?: string;
  keepRunIds?: unknown[];
  protectedObservationIds?: unknown[];
}): Record<string, unknown> {
  const filter: Record<string, unknown> = {
    superseded: true,
    observedAt: { $lt: input.cutoff },
  };
  if (input.sourceName) filter.sourceName = input.sourceName;
  if (input.keepRunIds && input.keepRunIds.length > 0) {
    filter.scrapeRunId = { $nin: input.keepRunIds };
  }
  if (input.protectedObservationIds && input.protectedObservationIds.length > 0) {
    filter._id = { $nin: input.protectedObservationIds };
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
  const eligibleCandidates = await Observation.countDocuments(eligibleFilter);
  const protectedObservationIds = await findReferencedObservationIds();
  const filter = buildSupersededObservationPruneFilter({
    cutoff,
    sourceName: options.sourceName,
    keepRunIds: keptRunIds,
    protectedObservationIds,
  });
  const candidates = await Observation.countDocuments(filter);
  const deleted = options.apply ? (await Observation.deleteMany(filter)).deletedCount || 0 : 0;

  return {
    apply: Boolean(options.apply),
    eligibleCandidates,
    protectedCandidates: Math.max(0, eligibleCandidates - candidates),
    candidates,
    deleted,
    cutoff: cutoff.toISOString(),
    keepRuns,
    keptRunIds,
    sourceName: options.sourceName,
  };
}

async function findReferencedObservationIds(): Promise<unknown[]> {
  const referencedIds = new Map<string, unknown>();
  for (const spec of OBSERVATION_REFERENCE_SPECS) {
    const rows = await Observation.db
      .collection(spec.collection)
      .aggregate(buildObservationReferencePipeline(spec), { allowDiskUse: true })
      .toArray();
    for (const row of rows) {
      if (!row?._id) continue;
      referencedIds.set(String(row._id), row._id);
    }
  }
  return Array.from(referencedIds.values());
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

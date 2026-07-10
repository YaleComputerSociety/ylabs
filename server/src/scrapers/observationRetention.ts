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
  candidates: number;
  deleted: number;
  cutoff: string;
  keepRuns: number;
  keptRunIds: unknown[];
  sourceName?: string;
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
  const filter = buildSupersededObservationPruneFilter({
    cutoff,
    sourceName: options.sourceName,
    keepRunIds: keptRunIds,
  });
  const candidates = await Observation.countDocuments(filter);
  const deleted = options.apply ? (await Observation.deleteMany(filter)).deletedCount || 0 : 0;

  return {
    apply: Boolean(options.apply),
    candidates,
    deleted,
    cutoff: cutoff.toISOString(),
    keepRuns,
    keptRunIds,
    sourceName: options.sourceName,
  };
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

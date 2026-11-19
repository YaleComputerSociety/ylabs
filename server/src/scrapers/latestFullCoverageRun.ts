import { ScrapeRun } from '../models/scrapeRun';
import { serializedDocumentId } from '../utils/idSerialization';
import type { ObservationInput } from './types';

/**
 * A run that read the whole source: it finished `success`, nobody invalidated it, it wrote,
 * and nothing narrowed what it fetched. `--only` names a subset, `--limit` caps it, `--offset`
 * skips the leading rows, a run without `--exhaustive` is capped at the CLI's default row
 * count, and a run that consulted
 * the work planner skipped the targets it judged fresh, so each of those leaves some of the
 * lane's pages unread and cannot say the lane re-read a person (#5578).
 *
 * `Source.lastCrawledAt` is not this signal: `stampSourceCrawlIfEarned` stamps it after a
 * scoped or `partial` run too, and it records a time rather than which run read what.
 */
export function isFullCoverageRun(run: {
  status?: unknown;
  invalidated?: unknown;
  options?: Record<string, unknown> | null;
}): boolean {
  const options = run.options ?? {};
  const only = options.only;
  return (
    run.status === 'success' &&
    run.invalidated !== true &&
    options.dryRun === false &&
    options.exhaustive === true &&
    options.ignoreWorkPlanner === true &&
    options.benchmarkRun !== true &&
    (only === undefined || (Array.isArray(only) && only.length === 0)) &&
    (options.limit === undefined || options.limit === null) &&
    (options.offset === undefined || options.offset === null || options.offset === 0)
  );
}

const CANDIDATE_RUNS_PER_LANE = 20;

/**
 * Each lane's newest full-coverage run, read once per lane. A lane with no such run maps to
 * nothing, so none of its reads is fresh.
 */
export async function latestFullCoverageRunIdByLane(
  lanes: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const byLane = new Map<string, string>();
  await Promise.all(
    [...new Set(lanes)].map(async (sourceName) => {
      const runs = (await ScrapeRun.find({
        sourceName,
        status: 'success',
        invalidated: { $ne: true },
        'options.dryRun': false,
        'options.exhaustive': true,
        'options.ignoreWorkPlanner': true,
        'options.limit': null,
        'options.offset': { $in: [null, 0] },
        'options.benchmarkRun': { $ne: true },
        $or: [{ 'options.only': { $exists: false } }, { 'options.only': { $size: 0 } }],
      })
        .sort({ startedAt: -1 })
        .limit(CANDIDATE_RUNS_PER_LANE)
        .select('_id status invalidated options')
        .lean()) as Array<{ _id: unknown; status?: unknown; invalidated?: unknown; options?: any }>;
      const latest = runs.find(isFullCoverageRun);
      const runId = latest ? serializedDocumentId(latest._id) : undefined;
      if (runId) byLane.set(sourceName, runId);
    }),
  );
  return byLane;
}

export const TITLE_COVERED_KEYS_METRIC = 'titleCoveredKeys';

/**
 * A completed keyed run that states which people it read a `title` for: it finished
 * `success`, nobody invalidated it, it wrote, and `--only` named its targets. An
 * interrupted, failed, invalidated or dry run covers no one, whatever its metrics say (#6197).
 */
export function isCoveringKeyedRun(run: {
  status?: unknown;
  invalidated?: unknown;
  options?: Record<string, unknown> | null;
  metrics?: Record<string, unknown> | null;
}): boolean {
  const options = run.options ?? {};
  const covered = run.metrics?.[TITLE_COVERED_KEYS_METRIC];
  return (
    run.status === 'success' &&
    run.invalidated !== true &&
    options.dryRun === false &&
    options.benchmarkRun !== true &&
    Array.isArray(options.only) &&
    options.only.length > 0 &&
    Array.isArray(covered) &&
    covered.length > 0
  );
}

/**
 * For each lane, each covered key's newest covering keyed run, counting only runs that
 * started after the lane's latest full-coverage run, so an older keyed run never overrides
 * a newer full read.
 */
export async function newestCoveringKeyedRunIdByLaneAndKey(
  lanes: readonly string[],
  latestFullRunIdByLane: ReadonlyMap<string, string>,
): Promise<ReadonlyMap<string, ReadonlyMap<string, string>>> {
  const fullRunIds = [...latestFullRunIdByLane.values()];
  const fullRuns = fullRunIds.length
    ? ((await ScrapeRun.find({ _id: { $in: fullRunIds } })
        .select('_id startedAt')
        .lean()) as Array<{ _id: unknown; startedAt?: Date }>)
    : [];
  const fullRunStartById = new Map(
    fullRuns.map((run) => [serializedDocumentId(run._id), run.startedAt]),
  );
  const byLane = new Map<string, ReadonlyMap<string, string>>();
  await Promise.all(
    [...new Set(lanes)].map(async (sourceName) => {
      const fullRunId = latestFullRunIdByLane.get(sourceName);
      const fullRunStart = fullRunId ? fullRunStartById.get(fullRunId) : undefined;
      if (fullRunId && !fullRunStart) return;
      const runs = (await ScrapeRun.find({
        sourceName,
        status: 'success',
        invalidated: { $ne: true },
        'options.dryRun': false,
        'options.benchmarkRun': { $ne: true },
        'options.only.0': { $exists: true },
        [`metrics.${TITLE_COVERED_KEYS_METRIC}.0`]: { $exists: true },
        ...(fullRunStart ? { startedAt: { $gt: fullRunStart } } : {}),
      })
        .sort({ startedAt: -1 })
        .select(`_id status invalidated options metrics.${TITLE_COVERED_KEYS_METRIC}`)
        .lean()) as Array<{
        _id: unknown;
        status?: unknown;
        invalidated?: unknown;
        options?: any;
        metrics?: any;
      }>;
      const byKey = new Map<string, string>();
      for (const run of runs) {
        if (!isCoveringKeyedRun(run)) continue;
        const runId = serializedDocumentId(run._id);
        if (!runId) continue;
        for (const key of run.metrics[TITLE_COVERED_KEYS_METRIC] as unknown[]) {
          if (typeof key === 'string' && key && !byKey.has(key)) byKey.set(key, runId);
        }
      }
      if (byKey.size > 0) byLane.set(sourceName, byKey);
    }),
  );
  return byLane;
}

/**
 * Collects a keyed run's covered keys: the `user` keys it emitted a `title` for, which a lane
 * emits only after reading that person's page. An unkeyed run records nothing, because a full
 * run already covers the keys it read (#6197).
 */
export class TitleCoverageRecorder {
  private readonly covered = new Set<string>();

  constructor(private readonly options: { isKeyedRun: boolean }) {}

  recordEmitted(observations: readonly ObservationInput[]): void {
    if (!this.options.isKeyedRun) return;
    for (const observation of observations) {
      if (observation.entityType !== 'user' || observation.field !== 'title') continue;
      const key = typeof observation.entityKey === 'string' ? observation.entityKey.trim() : '';
      if (key) this.covered.add(key);
    }
  }

  resultMetrics(): { metrics?: { [TITLE_COVERED_KEYS_METRIC]: string[] } } {
    if (this.covered.size === 0) return {};
    return { metrics: { [TITLE_COVERED_KEYS_METRIC]: [...this.covered].sort() } };
  }
}

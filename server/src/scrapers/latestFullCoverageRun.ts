import { ScrapeRun } from '../models/scrapeRun';
import { serializedDocumentId } from '../utils/idSerialization';

/**
 * A run that read the whole source: it finished `success`, nobody invalidated it, it wrote,
 * and nothing narrowed what it fetched. `--only` names a subset, `--limit` caps it, a run
 * without `--exhaustive` is capped at the CLI's default row count, and a run that consulted
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
    (options.limit === undefined || options.limit === null)
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

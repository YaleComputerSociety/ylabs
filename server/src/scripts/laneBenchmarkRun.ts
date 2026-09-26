import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { ResearchEntity } from '../models/researchEntity';
import { buildOrchestrator } from '../scrapers/registry';
import type { ScraperOptions } from '../scrapers/types';
import type { PlannedObservation } from './laneScorecardCore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Lanes whose output is a function of the pages they fetch, read through `getCached`, over
 * the default axios instance. An LLM lane is excluded because one run of it is not
 * repeatable, and a rendered-page lane because its fetch bypasses the cache (#3526).
 */
export const BENCHMARKABLE_LANES: ReadonlySet<string> = new Set([
  'dept-faculty-roster',
  'ysm-faculty-directory',
  'official-profile-pi-backfill',
  'ysm-atoz-index',
]);

const EXPLAIN_EVERYTHING = 10_000_000;

export interface LaneBenchmarkSpec {
  sourceName: string;
  only: string[];
  limit?: number;
}

export function assertBenchmarkableLane(sourceName: string): void {
  if (!BENCHMARKABLE_LANES.has(sourceName)) {
    throw new Error(
      `${sourceName} is not benchmarkable. Supported: ${[...BENCHMARKABLE_LANES].join(', ')}`,
    );
  }
}

/**
 * One dry run of the lane, returning every value it planned. The work planner is ignored
 * because it skips targets by when they were last scraped, which is a property of the clock
 * rather than of the code under test.
 */
export async function runLaneDry(spec: LaneBenchmarkSpec): Promise<{
  observations: PlannedObservation[];
  truncated: boolean;
}> {
  const options: ScraperOptions = {
    dryRun: true,
    useCache: true,
    release: false,
    explain: true,
    explainLimit: EXPLAIN_EVERYTHING,
    ignoreWorkPlanner: true,
    only: spec.only.length > 0 ? spec.only : undefined,
    limit: spec.limit,
    triggeredBy: 'cli',
  };
  const { explainedObservations, explainTruncated } = await buildOrchestrator().run(
    spec.sourceName,
    options,
  );
  return {
    observations: (explainedObservations ?? []) as PlannedObservation[],
    truncated: explainTruncated === true,
  };
}

export async function slugsForPlannedEntities(
  observations: readonly PlannedObservation[],
): Promise<Map<string, string>> {
  const ids = [
    ...new Set(
      observations
        .filter(
          (observation) => observation.entityType === 'researchEntity' && observation.entityId,
        )
        .map((observation) => String(observation.entityId)),
    ),
  ];
  if (ids.length === 0) return new Map();
  const docs = (await ResearchEntity.find({ _id: { $in: ids } })
    .select('_id slug')
    .lean()) as unknown as Array<{ _id: unknown; slug?: string }>;
  return new Map(docs.filter((doc) => doc.slug).map((doc) => [String(doc._id), String(doc.slug)]));
}

export function currentCodeSha(): string | undefined {
  const declared =
    process.env.SOURCE_COMMIT || process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT;
  if (declared) return declared;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: path.resolve(__dirname, '../../..'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
}

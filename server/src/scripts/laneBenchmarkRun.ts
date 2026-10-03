import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { ResearchEntity } from '../models/researchEntity';
import { buildOrchestrator } from '../scrapers/registry';
import type { ScraperOptions } from '../scrapers/types';
import { installScraperHostConcurrencyInterceptor } from '../scrapers/utils/hostConcurrencyLimiter';
import { scraperHostSlotLimiter } from '../scrapers/utils/scraperHostSlotLimiter';
import type { PlannedObservation } from './laneScorecardCore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Lanes whose output is a function of the pages they fetch, through `getCached`,
 * `fetchPageWithPolicy` or the Scrapling renderer, and the model responses they receive over the
 * default axios instance (#3526, #3587, #3590). The two center LLM lanes stay out, because their
 * raw `axios.get` page fetch is frozen by none of those.
 */
export const BENCHMARKABLE_LANES: ReadonlySet<string> = new Set([
  'dept-faculty-roster',
  'ysm-faculty-directory',
  'official-profile-pi-backfill',
  'ysm-atoz-index',
  'lab-microsite-undergrad-llm',
  'lab-microsite-description-llm',
  'centers-institutes-index',
  'student-grants-database',
  'yale-college-fellowships-office',
]);

export const SOURCE_CONCURRENCY_LANES: ReadonlySet<string> = new Set([
  'lab-microsite-undergrad-llm',
  'lab-microsite-description-llm',
]);

const RUN_CLOCK_FIELDS_BY_LANE: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['lab-microsite-undergrad-llm', new Set(['lastObservedAt'])],
]);

export const runClockFieldsFor = (sourceName: string): ReadonlySet<string> =>
  RUN_CLOCK_FIELDS_BY_LANE.get(sourceName) ?? new Set();

const EXPLAIN_EVERYTHING = 10_000_000;

export interface LaneBenchmarkSpec {
  sourceName: string;
  only: string[];
  limit?: number;
  sourceConcurrency?: number;
  referenceDate?: Date;
}

export function assertBenchmarkableLane(sourceName: string): void {
  if (!BENCHMARKABLE_LANES.has(sourceName)) {
    throw new Error(
      `${sourceName} is not benchmarkable. Supported: ${[...BENCHMARKABLE_LANES].join(', ')}`,
    );
  }
}

export function assertLaneHonorsSourceConcurrency(sourceName: string): void {
  if (!SOURCE_CONCURRENCY_LANES.has(sourceName)) {
    throw new Error(
      `${sourceName} does not honor --source-concurrency. Supported: ${[...SOURCE_CONCURRENCY_LANES].join(', ')}`,
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
  installScraperHostConcurrencyInterceptor(scraperHostSlotLimiter());
  const options: ScraperOptions = {
    dryRun: true,
    useCache: true,
    release: false,
    explain: true,
    explainLimit: EXPLAIN_EVERYTHING,
    ignoreWorkPlanner: true,
    ...(spec.sourceConcurrency ? { sourceConcurrency: spec.sourceConcurrency } : {}),
    only: spec.only.length > 0 ? spec.only : undefined,
    limit: spec.limit,
    triggeredBy: 'cli',
    benchmarkRun: true,
    ...(spec.referenceDate ? { referenceDate: spec.referenceDate } : {}),
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

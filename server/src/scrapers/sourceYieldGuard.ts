/**
 * Turns a dead acquisition lane into a failed ScrapeRun (#2607).
 *
 * `runReport` already warned "Run produced zero observations" on every barren run and
 * the run still ended `success`, so six sources produced nothing for months while every
 * operator surface read healthy. A stored `failure` is what those surfaces already act
 * on: `scraperSweepArtifactError` fails the sweep step, and `sourceHealthService` raises
 * the source to `error` risk.
 *
 * The trigger is deliberately the streak rather than a single barren run. It is also
 * deliberately NOT gated on a recorded successful fetch: none of the six dead lanes
 * records `fetchMetrics` at all, so a fetch-gated guard could never fire.
 */
import type mongoose from 'mongoose';
import { ScrapeRun } from '../models/scrapeRun';
import { isManualOnlySweepSource } from './manualOnlySweepSources';
import { isRetiredSourceName } from './sourceDispatch';
import type { ScraperMetrics } from './types';

export const BARREN_RUN_STREAK_FAILURE_THRESHOLD = 3;
export const BARREN_RUN_HISTORY_SCAN_LIMIT = 12;

export type RunYieldClass = 'productive' | 'barren' | 'inconclusive';

export interface RunYieldFacts {
  status?: string;
  observationCount?: number;
  invalidated?: boolean;
  metrics?: ScraperMetrics;
  options?: { only?: unknown } | null;
}

export interface YieldExpectationSource {
  name?: string;
  coverage?: { tier?: string } | null;
}

export interface BarrenStreakFailure {
  barrenRunStreak: number;
  message: string;
}

export function workPlannerSkippedEveryTarget(metrics?: ScraperMetrics): boolean {
  const planner = metrics?.workPlanner;
  if (!planner || planner.planned <= 0 || planner.fetched > 0) return false;
  const skipped =
    (planner.skippedFresh || 0) +
    (planner.skippedManualLock || 0) +
    (planner.skippedNoIdentifier || 0);
  return skipped >= planner.planned;
}

function isEntityScopedRun(options?: RunYieldFacts['options']): boolean {
  const only = options?.only;
  return Array.isArray(only) && only.length > 0;
}

export function classifyRunYield(run: RunYieldFacts): RunYieldClass {
  if (run.invalidated || run.status === 'running' || run.status === 'interrupted') {
    return 'inconclusive';
  }
  if ((run.observationCount || 0) > 0) return 'productive';
  if (isEntityScopedRun(run.options)) return 'inconclusive';
  if (workPlannerSkippedEveryTarget(run.metrics)) return 'inconclusive';
  return 'barren';
}

function barrenStreak(
  runsNewestFirst: RunYieldFacts[],
  classify: (run: RunYieldFacts) => RunYieldClass,
): number {
  let streak = 0;
  for (const run of runsNewestFirst) {
    const yieldClass = classify(run);
    if (yieldClass === 'productive') break;
    if (yieldClass === 'barren') streak += 1;
  }
  return streak;
}

export function barrenRunStreak(runsNewestFirst: RunYieldFacts[]): number {
  return barrenStreak(runsNewestFirst, classifyRunYield);
}

/**
 * What each unit inside a lane yielded, keyed by unit (#3876).
 *
 * A unit is the smallest thing a lane fetches and parses on its own: one track page,
 * one department roster, one centre index. The per-source check cannot see one of
 * them going to zero, because the lane's other units keep yielding and the source's
 * own total never drops: one track listed zero faculty for three consecutive runs
 * while every run reported success and the source stayed healthy (#3833).
 *
 * The count is whatever that lane counts as a result, rows parsed or observations
 * emitted; the only requirement is that it counts the same thing every run, because
 * the comparison is within one unit across runs and never between units.
 *
 * A lane reports a unit only on a run that actually attempted it. An omitted unit
 * reads as inconclusive and a zero reads as barren, so reporting zero for a unit the
 * run never fetched is the one way to make this guard lie.
 */
export function unitYieldCounts(metrics?: ScraperMetrics): Record<string, number> | undefined {
  const counts = metrics?.unitYields;
  return counts && typeof counts === 'object' ? counts : undefined;
}

export function classifyUnitYield(run: RunYieldFacts, unit: string): RunYieldClass {
  if (run.invalidated || run.status === 'running' || run.status === 'interrupted') {
    return 'inconclusive';
  }
  if (isEntityScopedRun(run.options)) return 'inconclusive';
  if (workPlannerSkippedEveryTarget(run.metrics)) return 'inconclusive';
  const count = unitYieldCounts(run.metrics)?.[unit];
  if (typeof count !== 'number' || Number.isNaN(count)) return 'inconclusive';
  return count > 0 ? 'productive' : 'barren';
}

export function barrenUnitStreak(runsNewestFirst: RunYieldFacts[], unit: string): number {
  return barrenStreak(runsNewestFirst, (run) => classifyUnitYield(run, unit));
}

/**
 * Mirrors `classifySourceFreshness`: a source with no re-crawl expectation has no
 * yield expectation either. Retirement is read from the name rather than the stored
 * `enabled` flag, because a stored flag that disagrees with retirement is exactly the
 * drift that once exempted two live sweep sources from this guard (#4025).
 */
export function sourceIsExpectedToYield(source: YieldExpectationSource): boolean {
  if (typeof source.name === 'string' && isRetiredSourceName(source.name)) return false;
  return source.coverage?.tier !== 'MANUAL_OVERRIDE';
}

export function sourceIsExpectedToRecur(source: YieldExpectationSource): boolean {
  return sourceIsExpectedToYield(source) && !isManualOnlySweepSource(source.name);
}

function namedYieldSource(args: {
  sourceName: string;
  source: YieldExpectationSource;
}): YieldExpectationSource {
  return { ...args.source, name: args.source.name ?? args.sourceName };
}

export function resolveBarrenStreakFailure(args: {
  sourceName: string;
  source: YieldExpectationSource;
  currentRun: RunYieldFacts;
  priorRunsNewestFirst: RunYieldFacts[];
}): BarrenStreakFailure | undefined {
  if (!sourceIsExpectedToYield(namedYieldSource(args))) return undefined;
  if (classifyRunYield(args.currentRun) !== 'barren') return undefined;

  const streak = 1 + barrenRunStreak(args.priorRunsNewestFirst);
  if (streak < BARREN_RUN_STREAK_FAILURE_THRESHOLD) return undefined;

  return {
    barrenRunStreak: streak,
    message:
      `Acquisition lane "${args.sourceName}" emitted zero observations on ${streak} consecutive runs ` +
      `(threshold ${BARREN_RUN_STREAK_FAILURE_THRESHOLD}). The source is acquiring nothing, so this run ` +
      `is a failure rather than a success (#2607). Re-run it alone and read its report before trusting ` +
      `any corpus built from this sweep.`,
  };
}

export function resolveBarrenUnitStreakFailures(args: {
  sourceName: string;
  source: YieldExpectationSource;
  currentRun: RunYieldFacts;
  priorRunsNewestFirst: RunYieldFacts[];
}): BarrenStreakFailure[] {
  if (!sourceIsExpectedToYield(namedYieldSource(args))) return [];
  const counts = unitYieldCounts(args.currentRun.metrics);
  if (!counts) return [];

  const failures: BarrenStreakFailure[] = [];
  for (const unit of Object.keys(counts).sort()) {
    if (classifyUnitYield(args.currentRun, unit) !== 'barren') continue;
    const streak = 1 + barrenUnitStreak(args.priorRunsNewestFirst, unit);
    if (streak < BARREN_RUN_STREAK_FAILURE_THRESHOLD) continue;
    failures.push({
      barrenRunStreak: streak,
      message:
        `Acquisition lane "${args.sourceName}" yielded nothing from "${unit}" on ${streak} consecutive ` +
        `runs (threshold ${BARREN_RUN_STREAK_FAILURE_THRESHOLD}) while the lane's other units kept ` +
        `yielding, so the source total never dropped and the per-source check could not see it ` +
        `(#3876). Read that unit's page and the parser for it before trusting this sweep's corpus.`,
    });
  }
  return failures;
}

type StoredRunReference = mongoose.Types.ObjectId | string;

export async function readPriorRunYieldFacts(args: {
  sourceId: StoredRunReference;
  currentRunId: StoredRunReference | null;
}): Promise<RunYieldFacts[]> {
  const rows = await ScrapeRun.find({
    sourceId: args.sourceId,
    _id: { $ne: args.currentRunId },
  })
    .select(
      'status observationCount invalidated metrics.workPlanner metrics.unitYields options.only',
    )
    .sort({ startedAt: -1 })
    .limit(BARREN_RUN_HISTORY_SCAN_LIMIT)
    .lean();
  return (rows || []) as RunYieldFacts[];
}

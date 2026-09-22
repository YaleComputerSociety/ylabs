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
import { ScrapeRun } from '../models/scrapeRun';
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
  enabled?: boolean;
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
  if (run.invalidated || run.status === 'running') return 'inconclusive';
  if ((run.observationCount || 0) > 0) return 'productive';
  if (isEntityScopedRun(run.options)) return 'inconclusive';
  if (workPlannerSkippedEveryTarget(run.metrics)) return 'inconclusive';
  return 'barren';
}

export function barrenRunStreak(runsNewestFirst: RunYieldFacts[]): number {
  let streak = 0;
  for (const run of runsNewestFirst) {
    const yieldClass = classifyRunYield(run);
    if (yieldClass === 'productive') break;
    if (yieldClass === 'barren') streak += 1;
  }
  return streak;
}

/**
 * Mirrors `classifySourceFreshness`: a source with no re-crawl expectation has no
 * yield expectation either.
 */
export function sourceIsExpectedToYield(source: YieldExpectationSource): boolean {
  if (source.enabled === false) return false;
  return source.coverage?.tier !== 'MANUAL_OVERRIDE';
}

export function resolveBarrenStreakFailure(args: {
  sourceName: string;
  source: YieldExpectationSource;
  currentRun: RunYieldFacts;
  priorRunsNewestFirst: RunYieldFacts[];
}): BarrenStreakFailure | undefined {
  if (!sourceIsExpectedToYield(args.source)) return undefined;
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

export async function readPriorRunYieldFacts(args: {
  sourceId: unknown;
  currentRunId: unknown;
}): Promise<RunYieldFacts[]> {
  const rows = await ScrapeRun.find({
    sourceId: args.sourceId,
    _id: { $ne: args.currentRunId },
  })
    .select('status observationCount invalidated metrics.workPlanner options.only')
    .sort({ startedAt: -1 })
    .limit(BARREN_RUN_HISTORY_SCAN_LIMIT)
    .lean();
  return (rows || []) as RunYieldFacts[];
}

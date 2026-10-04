/**
 * The counting stage scripts keep their absolute exit contract, which operators and the
 * promotion gates read; the sweep owns the run history a regression is measured against, so
 * the comparison lives here rather than behind a stage flag (#4852).
 */
import { visibilityRepairStages } from '../models/visibilityReleaseQueueItem';

export interface StageCountRegression {
  name: string;
  previous: number;
  current: number;
}

export interface StageUnscoredBenchmark {
  benchmarkId: string;
  reason: string;
}

export interface StageJudgement {
  counts?: Record<string, number>;
  regressions: StageCountRegression[];
  unscored?: StageUnscoredBenchmark[];
}

export type StageCounts = Record<string, number>;

export type SweepStageCountBaseline = Record<string, StageCounts>;

export type StageResultJudge = (
  artifact: unknown,
  baseline: StageCounts | undefined,
) => StageJudgement;

type RecordLike = Record<string, unknown>;

const isRecord = (value: unknown): value is RecordLike =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

export function countRegressions(
  counts: StageCounts,
  baseline: StageCounts | undefined,
): StageCountRegression[] {
  if (!baseline) return [];
  return Object.entries(counts)
    .filter(([name, current]) => isCount(baseline[name]) && current > baseline[name])
    .map(([name, current]) => ({ name, previous: baseline[name], current }));
}

export function judgeIntegrityGateResult(
  artifact: unknown,
  baseline: StageCounts | undefined,
): StageJudgement {
  const counts = isRecord(artifact) ? artifact.counts : undefined;
  if (!isRecord(counts) || Object.keys(counts).length === 0) {
    throw new Error('integrity-gate result has no counts');
  }
  const recorded: StageCounts = {};
  for (const [name, value] of Object.entries(counts)) {
    if (!isCount(value)) throw new Error(`integrity-gate count ${name} is not a count`);
    recorded[name] = value;
  }
  return { counts: recorded, regressions: countRegressions(recorded, baseline) };
}

export const TRUST_CONTRACT_REPAIR_LANE_COUNT_PREFIX = 'repairLane:';

export function judgeTrustContractResult(
  artifact: unknown,
  baseline: StageCounts | undefined,
): StageJudgement {
  const report = isRecord(artifact) ? artifact : {};
  const reportCounts = isRecord(report.counts) ? report.counts : {};
  if (!isCount(reportCounts.publicVisibilityViolations) || !Array.isArray(report.repairLanes)) {
    throw new Error('trust-contract result has no publicVisibilityViolations or repairLanes');
  }
  const laneCounts = new Map<string, number>(visibilityRepairStages.map((stage) => [stage, 0]));
  for (const lane of report.repairLanes) {
    if (!isRecord(lane) || typeof lane.stage !== 'string' || !isCount(lane.count)) {
      throw new Error('trust-contract result has a repair lane without a stage and a count');
    }
    laneCounts.set(lane.stage, (laneCounts.get(lane.stage) ?? 0) + lane.count);
  }
  const counts: StageCounts = {
    publicVisibilityViolations: reportCounts.publicVisibilityViolations,
    violations: [...laneCounts.values()].reduce((total, count) => total + count, 0),
  };
  for (const [stage, count] of laneCounts) {
    counts[`${TRUST_CONTRACT_REPAIR_LANE_COUNT_PREFIX}${stage}`] = count;
  }
  return { counts, regressions: countRegressions(counts, baseline) };
}

/**
 * An unscored benchmark measured its instrument rather than the lane, so it needs a recapture
 * and is listed; only a scored precision or recall drop fails the stage.
 */
export function judgeLaneScorecardResult(artifact: unknown): StageJudgement {
  const report = isRecord(artifact) ? artifact : {};
  if (!Array.isArray(report.unscored) || !Array.isArray(report.results)) {
    throw new Error('lane-scorecard result has no unscored or results list');
  }
  const unscored = report.unscored.filter(isRecord).map((entry) => ({
    benchmarkId: String(entry.benchmarkId ?? ''),
    reason: String(entry.reason ?? ''),
  }));
  const regressions = (Array.isArray(report.regressions) ? report.regressions : [])
    .filter(isRecord)
    .filter((entry) => isCount(entry.previous) && isCount(entry.current))
    .map((entry) => ({
      name: `${String(entry.benchmarkId ?? '')} ${String(entry.field ?? '')} ${String(entry.metric ?? '')}`,
      previous: entry.previous as number,
      current: entry.current as number,
    }));
  return { regressions, unscored };
}

export function formatStageRegressions(
  stageName: string,
  regressions: StageCountRegression[],
): string {
  return `${stageName} regressed: ${regressions
    .map((regression) => `${regression.name} ${regression.previous} -> ${regression.current}`)
    .join(', ')}`;
}

export function formatStageCounts(counts: StageCounts): string {
  return Object.entries(counts)
    .map(([name, value]) => `${name}=${value}`)
    .join(', ');
}

interface StoredStageCounts {
  name?: unknown;
  counts?: unknown;
}

/**
 * Per count, not per run, so a stage that crashed last week is judged against the week before.
 */
export function stageCountBaselineFromRuns(
  newestFirst: ReadonlyArray<{ stages?: readonly StoredStageCounts[] | null }>,
): SweepStageCountBaseline {
  const baseline: SweepStageCountBaseline = {};
  for (const run of newestFirst) {
    for (const stage of run.stages ?? []) {
      if (typeof stage?.name !== 'string' || !isRecord(stage.counts)) continue;
      const stageBaseline = (baseline[stage.name] ??= {});
      for (const [name, value] of Object.entries(stage.counts)) {
        if (isCount(value) && !(name in stageBaseline)) stageBaseline[name] = value;
      }
    }
  }
  return baseline;
}

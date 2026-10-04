import {
  RENDER_CRON_RUN_LIMIT_MS,
  WEEKLY_SWEEP_MODES,
  type WeeklySweepMode,
  type WeeklySweepRunRecord,
} from './weeklyDevelopmentSweepCore';

export const DEFAULT_WEEKLY_SWEEP_RUNS_LIMIT = 5;

export const SLOWEST_STEP_COUNT = 5;

export interface WeeklySweepRunsReportArgs {
  limit: number;
  json: boolean;
  compare: boolean;
}

export function parseWeeklySweepRunsReportArgs(argv: string[]): WeeklySweepRunsReportArgs {
  const args: WeeklySweepRunsReportArgs = {
    limit: DEFAULT_WEEKLY_SWEEP_RUNS_LIMIT,
    json: false,
    compare: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--json') {
      args.json = true;
    } else if (arg === '--compare') {
      args.compare = true;
    } else if (arg === '--limit' || arg.startsWith('--limit=')) {
      const raw = arg === '--limit' ? argv[++index] : arg.slice('--limit='.length);
      const limit = Number(raw);
      if (!Number.isInteger(limit) || limit < 1) {
        throw new Error(`--limit must be a positive integer; got ${raw ?? '(missing)'}`);
      }
      args.limit = limit;
    } else {
      throw new Error(`Unknown scrape:sweep:weekly-runs argument: ${arg}`);
    }
  }
  return args;
}

type DeepPartial<T> = T extends Date
  ? T
  : T extends Array<infer Item>
    ? Array<DeepPartial<Item>>
    : T extends object
      ? { [Key in keyof T]?: DeepPartial<T[Key]> | null }
      : T;

export type StoredWeeklySweepRun = DeepPartial<WeeklySweepRunRecord> &
  Pick<WeeklySweepRunRecord, 'startedAt' | 'status'> & { _id?: unknown };

const MODE_LABELS: Record<string, string> = {
  'development-full': 'research',
  'fellowship-development-full': 'fellowship',
};

export function weeklySweepRunModes(run: StoredWeeklySweepRun): WeeklySweepMode[] {
  const requested = run.requestedModes ?? [];
  const named =
    requested.length > 0 ? requested : (run.modes ?? []).map((mode) => mode?.mode ?? null);
  return WEEKLY_SWEEP_MODES.filter((mode) => named.includes(mode));
}

const formatModes = (run: StoredWeeklySweepRun): string => {
  const modes = weeklySweepRunModes(run);
  return modes.length > 0
    ? modes.map((mode) => MODE_LABELS[mode] ?? mode).join('+')
    : 'no modes recorded';
};

export function formatDuration(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '-';
  const totalMinutes = Math.round(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h${String(minutes).padStart(2, '0')}m` : `${minutes}m`;
}

const formatStarted = (startedAt: Date): string =>
  `${new Date(startedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

interface TimedStep {
  label: string;
  durationMs: number;
}

export function slowestSteps(run: StoredWeeklySweepRun, count = SLOWEST_STEP_COUNT): TimedStep[] {
  const steps: TimedStep[] = [
    ...(run.sources ?? []).map((source) => ({
      label: source?.sourceName ?? '?',
      durationMs: source?.durationMs ?? NaN,
    })),
    ...(run.stages ?? []).map((stage) => ({
      label: `${stage?.name ?? '?'} (post-run)`,
      durationMs: stage?.durationMs ?? NaN,
    })),
  ];
  return steps
    .filter((step) => Number.isFinite(step.durationMs))
    .sort((left, right) => right.durationMs - left.durationMs)
    .slice(0, count);
}

function formatMode(mode: NonNullable<StoredWeeklySweepRun['modes']>[number]): string {
  const label = MODE_LABELS[mode?.mode ?? ''] ?? mode?.mode ?? '?';
  if (!mode?.summaryFound) return `${label}: exit ${mode?.exitCode ?? '?'}, no summary`;
  const postRun = mode.postRunStatus
    ? `, post-run ${mode.postRunStatus} (${formatDuration(mode.postRunDurationMs)})`
    : '';
  return `${label}: ${formatDuration(mode.durationMs)}, ${mode.succeeded ?? 0} ok / ${mode.failed ?? 0} failed / ${mode.notRun ?? 0} not run${postRun}`;
}

function formatStorage(run: StoredWeeklySweepRun): string | null {
  const before = run.preflight?.storageBefore;
  if (!before) return null;
  const after = run.preflight?.storageAfter;
  const dropped = run.preflight?.snapshotCacheDropped ? ', fetch cache dropped' : '';
  const afterText = after ? `, ${after.usedMb}/${after.quotaMb} MB after` : '';
  return `storage: ${before.usedMb}/${before.quotaMb} MB before${dropped}${afterText}`;
}

function formatElapsed(run: StoredWeeklySweepRun, now: Date): string {
  if (run.status === 'running') {
    const elapsedMs = now.getTime() - new Date(run.startedAt).getTime();
    return elapsedMs > RENDER_CRON_RUN_LIMIT_MS
      ? `never finished: started ${formatDuration(elapsedMs)} ago, past the ${formatDuration(RENDER_CRON_RUN_LIMIT_MS)} limit, so it was stopped before it could record its end`
      : `still running, ${formatDuration(elapsedMs)} so far of ${formatDuration(RENDER_CRON_RUN_LIMIT_MS)}`;
  }
  const limit = run.renderLimit;
  const headroom =
    limit && typeof limit.headroomMs === 'number'
      ? limit.withinLimit
        ? ` of ${formatDuration(limit.limitMs)} (${formatDuration(limit.headroomMs)} headroom)`
        : ` OVER the ${formatDuration(limit.limitMs)} limit by ${formatDuration(-limit.headroomMs)}`
      : '';
  return `took ${formatDuration(run.durationMs)}${headroom}`;
}

export function formatWeeklySweepRun(run: StoredWeeklySweepRun, now = new Date()): string {
  const lines = [
    `${formatStarted(run.startedAt)}  ${formatModes(run)}  ${run.status}  code ${run.codeSha ? run.codeSha.slice(0, 9) : 'unknown'}  ${formatElapsed(run, now)}`,
  ];
  for (const mode of run.modes ?? []) lines.push(`  ${formatMode(mode)}`);
  const storage = formatStorage(run);
  if (storage) lines.push(`  ${storage}`);
  const throttle = run.throttleRetry;
  const lostBySource = (run.sources ?? [])
    .filter((source) => (source?.throttleExhausted ?? 0) > 0)
    .map((source) => `${source?.sourceName ?? '?'} ${source?.throttleExhausted}`);
  const lostNames = lostBySource.length > 0 ? lostBySource : (throttle?.exhaustedSources ?? []);
  const lost = lostNames.length > 0 ? ` (${lostNames.join(', ')})` : '';
  lines.push(
    `  throttle: ${throttle?.recovered ?? 0} recovered, ${throttle?.exhausted ?? 0} lost${lost}`,
  );
  const slowest = slowestSteps(run);
  if (slowest.length > 0) {
    lines.push(
      `  slowest: ${slowest.map((step) => `${step.label} ${formatDuration(step.durationMs)}`).join(', ')}`,
    );
  }
  const failed = [
    ...(run.sources ?? [])
      .filter((source) => source?.status === 'failed')
      .map((source) => `${source?.sourceName ?? '?'} (exit ${source?.exitCode ?? '?'})`),
    ...(run.stages ?? [])
      .filter((stage) => stage?.status === 'failed')
      .map((stage) => `${stage?.name ?? '?'} (post-run, exit ${stage?.exitCode ?? '?'})`),
  ];
  lines.push(`  failed: ${failed.length > 0 ? failed.join(', ') : 'none'}`);
  for (const refusal of run.refusals ?? []) lines.push(`  refused: ${refusal}`);
  if (run.error) lines.push(`  error: ${run.error}`);
  lines.push(`  corpus snapshot: ${run.corpusSnapshot?.status ?? '-'}`);
  return lines.join('\n');
}

export function formatWeeklySweepRuns(runs: StoredWeeklySweepRun[], now = new Date()): string {
  if (runs.length === 0) return 'No weekly sweep runs recorded in weekly_sweep_runs.';
  return runs.map((run) => formatWeeklySweepRun(run, now)).join('\n\n');
}

function stepDurations(run: StoredWeeklySweepRun): Map<string, number> {
  const durations = new Map<string, number>();
  for (const source of run.sources ?? []) {
    if (source?.sourceName && typeof source.durationMs === 'number') {
      durations.set(source.sourceName, source.durationMs);
    }
  }
  for (const stage of run.stages ?? []) {
    if (stage?.name && typeof stage.durationMs === 'number') {
      const key = `${stage.name} (${MODE_LABELS[stage.mode ?? ''] ?? stage.mode} post-run)`;
      durations.set(key, stage.durationMs);
    }
  }
  return durations;
}

export function formatWeeklySweepRunsComparison(newestFirst: StoredWeeklySweepRun[]): string {
  if (newestFirst.length === 0) return 'No weekly sweep runs recorded in weekly_sweep_runs.';
  const runs = [...newestFirst].reverse();
  const perRun = runs.map(stepDurations);
  const latest = perRun.at(-1) ?? new Map<string, number>();
  const earlier = perRun.slice(0, -1).reverse();
  const previousDuration = (name: string): number | undefined =>
    earlier.find((durations) => durations.has(name))?.get(name);
  const latestRun = runs.at(-1);
  const previousSameModes = latestRun
    ? runs
        .slice(0, -1)
        .reverse()
        .find((run) => formatModes(run) === formatModes(latestRun))
    : undefined;
  const names = [...new Set(perRun.flatMap((durations) => [...durations.keys()]))].sort(
    (left, right) => (latest.get(right) ?? -1) - (latest.get(left) ?? -1),
  );
  const header = [
    'step',
    ...runs.map(
      (run) => `${new Date(run.startedAt).toISOString().slice(0, 10)} ${formatModes(run)}`,
    ),
    'change',
  ];
  const change = (now: number | undefined, before: number | undefined): string => {
    if (now === undefined || before === undefined || before === 0) return '-';
    const percent = Math.round(((now - before) / before) * 100);
    return `${percent > 0 ? '+' : ''}${percent}%`;
  };
  const rows = [
    [
      'TOTAL',
      ...runs.map((run) => formatDuration(run.durationMs)),
      change(latestRun?.durationMs ?? undefined, previousSameModes?.durationMs ?? undefined),
    ],
    ...names.map((name) => [
      name,
      ...perRun.map((durations) => formatDuration(durations.get(name))),
      change(latest.get(name), previousDuration(name)),
    ]),
  ];
  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => row[column].length)),
  );
  const line = (cells: string[]) =>
    cells
      .map((cell, column) =>
        column === 0 ? cell.padEnd(widths[column]) : cell.padStart(widths[column]),
      )
      .join('  ')
      .trimEnd();
  return [line(header), line(widths.map((width) => '-'.repeat(width))), ...rows.map(line)].join(
    '\n',
  );
}

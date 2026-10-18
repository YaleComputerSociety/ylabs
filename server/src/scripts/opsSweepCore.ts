import {
  resolveMongoDatabaseName,
  resolveScraperEnvironment,
} from '../scrapers/scraperEnvironment';
import { isManualOnlySweepSource } from '../scrapers/manualOnlySweepSources';
import { classifyScrapeRunLiveness } from '../scrapers/scrapeRunLiveness';
import { DEVELOPMENT_DATABASE_NAME } from './databaseCopyPairs';
import {
  buildScraperSweepChildArgs,
  FELLOWSHIP_SWEEP_SOURCES,
  RESEARCH_SWEEP_SOURCES,
  type ScraperSweepMode,
} from './runScraperSweep';
import { RENDER_CRON_RUN_LIMIT_MS } from './weeklyDevelopmentSweepCore';
import { formatDuration, type StoredWeeklySweepRun } from './weeklySweepRunsReportCore';

export const SWEEP_RENDER_SERVICE_ID = 'crn-db0sddk9v7es73cqui20';
export const SWEEP_DATABASE_ROLE = 'ylabs-sweep-dev';
export const ATLAS_PROJECT_ID = '685b36661a9a1101c14a007b';
export const RERUN_SOURCE_ENTRYPOINT_FLAG = '--rerun-source';
export const RESUME_WEEKLY_RUN_ENTRYPOINT_FLAG = '--resume-weekly-run';
const WEEKLY_RUN_ID_PATTERN = /^[0-9a-f]{24}$/;
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
export const OVERRIDE_HOLD_FLAG = '--override-hold';
export const SWEEP_ENTRYPOINT_PATH = 'deploy/sweep-runner/entrypoint.sh';
export const SWEEP_ENTRYPOINT_COMMAND = '/usr/bin/tini -- /app/deploy/sweep-runner/entrypoint.sh';
export const DEVELOPMENT_SEARCH_SYNC_SCRIPT = 'development:search:sync';

// Comparable exhaustive runs measured on Development for 2026-09-20 to 2026-10-17 dropped at
// most 12.7% in observations or entities updated on every non-held lane (center-director-llm,
// an LLM lane), and 20.6% once in student-grants-database's updates, so 25% clears the
// measured noise while a broken selector or a lost page list drops far more. The absolute floor
// keeps a lane with a handful of rows from flagging a drop of two.
export const REGRESSION_DROP_FRACTION = 0.25;
export const REGRESSION_MIN_ABSOLUTE_DROP = 10;

export const OWNER_HELD_SOURCES: Readonly<Record<string, string>> = {
  'lab-microsite-description-llm':
    'lab-microsite description lane, under the owner hold on description, writer, card and lab-microsite runs (#5020)',
  'lab-microsite-undergrad-llm':
    'lab-microsite lane, under the owner hold on description, writer, card and lab-microsite runs (#5020)',
  'coverage-synthesis-llm':
    'the description writer, under the owner hold on description, writer, card and lab-microsite runs (#5020)',
  'grant-corpus-synthesis-llm':
    'a description synthesis lane, under the owner hold on description, writer, card and lab-microsite runs (#5020)',
  'fra-profile-research-synthesis':
    'a description synthesis lane, under the owner hold on description, writer, card and lab-microsite runs (#5020)',
};

const SOURCE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export type OpsSweepCommand =
  | { command: 'status' }
  | { command: 'rerun'; sources: string[]; overrideHold: boolean; dryRun: boolean }
  | { command: 'probe-permissions'; dryRun: boolean }
  | { command: 'resume'; runId?: string; dryRun: boolean };

export const OPS_SWEEP_USAGE = [
  'Usage:',
  '  yarn ops:sweep status',
  `  yarn ops:sweep rerun <source>... [${OVERRIDE_HOLD_FLAG}] [--dry-run]`,
  '  yarn ops:sweep probe-permissions [--dry-run]',
  '  yarn ops:sweep resume [<weekly run id>] [--dry-run]',
].join('\n');

export function parseOpsSweepArgs(argv: string[]): OpsSweepCommand {
  const args = argv.filter((arg) => arg !== '--');
  const [command, ...rest] = args;
  const flags = rest.filter((arg) => arg.startsWith('--'));
  const positional = rest.filter((arg) => !arg.startsWith('--'));
  const allowFlags = (allowed: string[]) => {
    const unknown = flags.filter((flag) => !allowed.includes(flag));
    if (unknown.length > 0)
      throw new Error(`Unknown option ${unknown.join(', ')}\n${OPS_SWEEP_USAGE}`);
  };
  if (command === 'status') {
    allowFlags([]);
    if (positional.length > 0) throw new Error(`status takes no arguments\n${OPS_SWEEP_USAGE}`);
    return { command };
  }
  if (command === 'rerun') {
    allowFlags([OVERRIDE_HOLD_FLAG, '--dry-run']);
    if (positional.length === 0)
      throw new Error(`rerun needs at least one source\n${OPS_SWEEP_USAGE}`);
    return {
      command,
      sources: [...new Set(positional)],
      overrideHold: flags.includes(OVERRIDE_HOLD_FLAG),
      dryRun: flags.includes('--dry-run'),
    };
  }
  if (command === 'probe-permissions') {
    allowFlags(['--dry-run']);
    if (positional.length > 0) {
      throw new Error(`probe-permissions takes no arguments\n${OPS_SWEEP_USAGE}`);
    }
    return { command, dryRun: flags.includes('--dry-run') };
  }
  if (command === 'resume') {
    allowFlags(['--dry-run']);
    if (positional.length > 1)
      throw new Error(`resume takes at most one run id\n${OPS_SWEEP_USAGE}`);
    const [runId] = positional;
    if (runId && !WEEKLY_RUN_ID_PATTERN.test(runId)) {
      throw new Error(`resume needs a weekly_sweep_runs id (24 hex characters); got ${runId}`);
    }
    return { command, ...(runId ? { runId } : {}), dryRun: flags.includes('--dry-run') };
  }
  throw new Error(OPS_SWEEP_USAGE);
}

export function developmentTargetProblems(env: NodeJS.ProcessEnv): string[] {
  const problems: string[] = [];
  const environment = resolveScraperEnvironment(env);
  if (environment !== 'development') {
    problems.push(`SCRAPER_ENV must resolve to development; resolved ${environment}`);
  }
  const database = resolveMongoDatabaseName(env.MONGODBURL);
  if (database !== DEVELOPMENT_DATABASE_NAME) {
    problems.push(
      `MONGODBURL must name database ${DEVELOPMENT_DATABASE_NAME}; resolved ${database ?? 'none'}`,
    );
  }
  return problems;
}

export function sweepModeForSource(sourceName: string): ScraperSweepMode | undefined {
  if (RESEARCH_SWEEP_SOURCES.some((source) => source.name === sourceName)) {
    return 'development-full';
  }
  if (FELLOWSHIP_SWEEP_SOURCES.some((source) => source.name === sourceName)) {
    return 'fellowship-development-full';
  }
  return undefined;
}

export function rerunSourceProblems(sources: string[], overrideHold: boolean): string[] {
  const problems: string[] = [];
  if (sources.length === 0) problems.push('no source was named');
  for (const source of sources) {
    if (!SOURCE_NAME_PATTERN.test(source)) {
      problems.push(`${JSON.stringify(source)} is not a source name`);
      continue;
    }
    const heldReason = OWNER_HELD_SOURCES[source];
    if (heldReason && !overrideHold) {
      problems.push(
        `${source} is held: ${heldReason}; pass ${OVERRIDE_HOLD_FLAG} only with the owner's say-so`,
      );
    }
    if (isManualOnlySweepSource(source)) {
      problems.push(
        `${source} is manual-only and never part of a sweep (scrapers/manualOnlySweepSources.ts), so the sweep's flags do not apply to it`,
      );
    } else if (!sweepModeForSource(source)) {
      problems.push(
        `${source} is not a weekly sweep source, so there are no sweep flags to rerun it with`,
      );
    }
  }
  return problems;
}

export interface RunningWeeklySweep {
  _id?: unknown;
  status?: unknown;
  startedAt?: Date | string | null;
}

export interface RunningScrapeRun {
  _id?: unknown;
  sourceName?: string | null;
  status?: unknown;
  startedAt?: Date | string | null;
  heartbeatAt?: Date | string | null;
}

export interface RerunActivity {
  newestWeeklySweep?: RunningWeeklySweep | null;
  heldLockSources: string[];
  runningScrapeRuns: RunningScrapeRun[];
  now: Date;
}

export function isWeeklySweepInProgress(
  run: RunningWeeklySweep | null | undefined,
  now: Date,
): boolean {
  if (!run || run.status !== 'running' || !run.startedAt) return false;
  return now.getTime() - new Date(run.startedAt).getTime() <= RENDER_CRON_RUN_LIMIT_MS;
}

export function rerunActivityRefusals(sources: string[], activity: RerunActivity): string[] {
  const refusals: string[] = [];
  const sweep = activity.newestWeeklySweep;
  if (sweep && isWeeklySweepInProgress(sweep, activity.now)) {
    refusals.push(
      `the weekly sweep run ${String(sweep._id ?? 'with no id')} is running (started ${new Date(sweep.startedAt!).toISOString()}), so a rerun would write Development alongside it`,
    );
  }
  if (activity.heldLockSources.length > 0) {
    refusals.push(
      `another writer holds a live scrape job lock on ${activity.heldLockSources.join(', ')}`,
    );
  }
  for (const run of activity.runningScrapeRuns) {
    if (!run.sourceName || !sources.includes(run.sourceName)) continue;
    const liveness = classifyScrapeRunLiveness(
      {
        status: run.status,
        startedAt: run.startedAt ?? undefined,
        heartbeatAt: run.heartbeatAt ?? undefined,
      },
      activity.now,
    );
    if (liveness !== 'live') continue;
    refusals.push(
      `a run of ${run.sourceName} (${String(run._id ?? 'unknown id')}) is running with a live heartbeat`,
    );
  }
  return refusals;
}

export function buildRerunScrapeArgs(sourceName: string, artifactPath: string): string[] {
  const mode = sweepModeForSource(sourceName);
  if (!mode) throw new Error(`${sourceName} is not a weekly sweep source`);
  return buildScraperSweepChildArgs(mode, sourceName, artifactPath);
}

export function rerunJobStartCommand(sources: string[], overrideHold: boolean): string {
  const problems = sources.filter((source) => !SOURCE_NAME_PATTERN.test(source));
  if (problems.length > 0 || sources.length === 0) {
    throw new Error(`refusing to build a start command for ${JSON.stringify(sources)}`);
  }
  return [
    SWEEP_ENTRYPOINT_COMMAND,
    RERUN_SOURCE_ENTRYPOINT_FLAG,
    ...sources,
    ...(overrideHold ? [OVERRIDE_HOLD_FLAG] : []),
  ].join(' ');
}

export interface ResumableWeeklySweep extends RunningWeeklySweep {
  finishedAt?: Date | string | null;
  codeSha?: string | null;
}

/**
 * Why an interrupted weekly run cannot be resumed now. Only an unfinished run whose
 * Render time limit has passed is resumable: until then its container may still be writing
 * Development, and a run that finished, however it ended, has no checkpoint left to continue.
 */
export function resumeRefusals(input: {
  run: ResumableWeeklySweep | null | undefined;
  heldLockSources: string[];
  now: Date;
}): string[] {
  const { run } = input;
  if (!run) return ['no unfinished weekly_sweep_runs row was found'];
  const refusals: string[] = [];
  const id = String(run._id ?? 'with no id');
  if (run.status !== 'running' || run.finishedAt) {
    refusals.push(
      `run ${id} is ${String(run.status ?? 'unknown')}, and only an unfinished run can be resumed`,
    );
  }
  if (!run.codeSha || !COMMIT_SHA_PATTERN.test(run.codeSha)) {
    refusals.push(`run ${id} recorded no commit, so a resume cannot run the same code`);
  }
  if (isWeeklySweepInProgress(run, input.now)) {
    refusals.push(
      `run ${id} started ${new Date(run.startedAt!).toISOString()}, within the Render time limit, so its container may still be running`,
    );
  }
  if (input.heldLockSources.length > 0) {
    refusals.push(
      `another writer holds a live scrape job lock on ${input.heldLockSources.join(', ')}`,
    );
  }
  return refusals;
}

export function resumeJobStartCommand(runId: string, codeSha: string): string {
  if (!WEEKLY_RUN_ID_PATTERN.test(runId) || !COMMIT_SHA_PATTERN.test(codeSha)) {
    throw new Error(`refusing to build a resume command for ${JSON.stringify([runId, codeSha])}`);
  }
  return [
    SWEEP_ENTRYPOINT_COMMAND,
    RESUME_WEEKLY_RUN_ENTRYPOINT_FLAG,
    runId,
    codeSha,
    '--confirm-weekly-development-sweep',
  ].join(' ');
}

export function entrypointSupportsResume(entrypointText: string | null | undefined): boolean {
  return Boolean(
    entrypointText && entrypointText.includes(`"${RESUME_WEEKLY_RUN_ENTRYPOINT_FLAG}"`),
  );
}

export function entrypointSupportsRerun(entrypointText: string | null | undefined): boolean {
  return Boolean(entrypointText && entrypointText.includes(`"${RERUN_SOURCE_ENTRYPOINT_FLAG}"`));
}

export function comparableScrapeRunFilter(sourceName: string): Record<string, unknown> {
  return {
    sourceName,
    status: 'success',
    invalidated: { $ne: true },
    'options.dryRun': false,
    'options.exhaustive': true,
    'options.forceLlm': { $ne: true },
    'options.only': { $exists: false },
    'options.limit': { $exists: false },
    'options.benchmarkRun': { $ne: true },
  };
}

export interface ScrapeRunCounts {
  _id?: unknown;
  sourceName?: string;
  status?: string;
  startedAt?: Date | string;
  finishedAt?: Date | string;
  codeSha?: string;
  observationCount?: number;
  entitiesCreated?: number;
  entitiesUpdated?: number;
  entitiesArchived?: number;
  materializationErrors?: number;
  options?: Record<string, unknown>;
}

export type RerunVerdict =
  'ok' | 'no-baseline' | 'missing' | 'failed' | 'produced-nothing' | 'regression';

export interface RerunComparison {
  sourceName: string;
  verdict: RerunVerdict;
  problem: boolean;
  lines: string[];
}

function droppedPastThreshold(previous: number, current: number): boolean {
  const drop = previous - current;
  return drop >= REGRESSION_MIN_ABSOLUTE_DROP && drop > previous * REGRESSION_DROP_FRACTION;
}

const countOf = (value: number | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

const describeDelta = (label: string, previous: number, current: number): string => {
  const change =
    previous === 0 ? '' : ` (${(((current - previous) / previous) * 100).toFixed(1)}%)`;
  return `${label}: ${previous} -> ${current}${change}`;
};

export function compareRerunWithBaseline(input: {
  sourceName: string;
  baseline: ScrapeRunCounts | null | undefined;
  current: ScrapeRunCounts | null | undefined;
}): RerunComparison {
  const { sourceName, baseline, current } = input;
  const result = (verdict: RerunVerdict, lines: string[]): RerunComparison => ({
    sourceName,
    verdict,
    problem: !['ok', 'no-baseline'].includes(verdict),
    lines,
  });
  if (!current) {
    return result('missing', ['no scrape_runs row was written by this rerun']);
  }
  const summary = `run ${String(current._id ?? '?')} ${current.status ?? 'unknown'}, code ${current.codeSha?.slice(0, 9) ?? 'unknown'}, ${countOf(current.observationCount)} observations, ${countOf(current.entitiesCreated)} created / ${countOf(current.entitiesUpdated)} updated / ${countOf(current.entitiesArchived)} archived, ${countOf(current.materializationErrors)} materialization errors`;
  if (current.status !== 'success') return result('failed', [summary]);
  if (countOf(current.observationCount) === 0) {
    return result('produced-nothing', [summary, 'producedNothing: the run wrote no observations']);
  }
  if (!baseline) {
    return result('no-baseline', [summary, 'no earlier comparable successful run to compare with']);
  }
  const deltas: Array<[string, number, number]> = [
    ['observations', countOf(baseline.observationCount), countOf(current.observationCount)],
    ['entities updated', countOf(baseline.entitiesUpdated), countOf(current.entitiesUpdated)],
  ];
  const lines = [
    summary,
    `against run ${String(baseline._id ?? '?')} of ${baseline.startedAt ? new Date(baseline.startedAt).toISOString() : 'unknown date'}: ${deltas.map(([label, previous, now]) => describeDelta(label, previous, now)).join(', ')}`,
  ];
  const regressed = deltas.filter(([, previous, now]) => droppedPastThreshold(previous, now));
  if (regressed.length === 0) return result('ok', lines);
  return result('regression', [
    ...lines,
    `REGRESSION: ${regressed.map(([label]) => label).join(' and ')} dropped more than ${REGRESSION_DROP_FRACTION * 100}% (and at least ${REGRESSION_MIN_ABSOLUTE_DROP}) against the last comparable run`,
  ]);
}

export function formatSweepStatus(input: {
  run: StoredWeeklySweepRun | null | undefined;
  betaHeadSha: string | null;
  now?: Date;
}): string {
  const { run, betaHeadSha } = input;
  const now = input.now ?? new Date();
  if (!run) return 'No weekly_sweep_runs row in Development.';
  const lines: string[] = [];
  const started = new Date(run.startedAt).toISOString().slice(0, 16).replace('T', ' ');
  lines.push(`Newest weekly sweep ${String(run._id ?? '')}`.trimEnd());
  lines.push(`  status: ${run.status}`);
  lines.push(`  started: ${started} UTC`);
  if (run.status === 'running') {
    const elapsedMs = now.getTime() - new Date(run.startedAt).getTime();
    lines.push(
      elapsedMs > RENDER_CRON_RUN_LIMIT_MS
        ? `  duration: ${formatDuration(elapsedMs)} since start, past Render's ${formatDuration(RENDER_CRON_RUN_LIMIT_MS)} limit, so it was stopped before recording its end`
        : `  duration: ${formatDuration(elapsedMs)} so far`,
    );
  } else {
    lines.push(`  duration: ${formatDuration(run.durationMs)}`);
  }
  const codeSha = run.codeSha ?? null;
  const codeLine = !codeSha
    ? 'unknown'
    : !betaHeadSha
      ? `${codeSha.slice(0, 9)} (beta HEAD could not be read)`
      : codeSha === betaHeadSha
        ? `${codeSha.slice(0, 9)}, which is beta HEAD`
        : `${codeSha.slice(0, 9)}; beta HEAD is now ${betaHeadSha.slice(0, 9)}`;
  lines.push(`  code: ${codeLine}`);
  const searchIndex = run.searchIndex as
    { status?: string | null; remedy?: string | null } | null | undefined;
  lines.push(
    `  search index: ${searchIndex?.status ?? 'not recorded'}${searchIndex?.remedy ? `; remedy \`${searchIndex.remedy}\`` : ''}`,
  );
  for (const refusal of run.refusals ?? []) {
    if (refusal) lines.push(`  refusal: ${refusal}`);
  }
  if (run.error) lines.push(`  error: ${run.error}`);
  const failedSources = (run.sources ?? []).filter((source) => source?.status === 'failed');
  const failedStages = (run.stages ?? []).filter((stage) => stage?.status === 'failed');
  lines.push(`  failed sources: ${failedSources.length === 0 ? 'none' : failedSources.length}`);
  for (const source of failedSources) {
    lines.push(
      `    ${source?.sourceName ?? '?'} (${source?.mode ?? '?'}): ${source?.error ?? 'no error recorded'}`,
    );
  }
  lines.push(`  failed stages: ${failedStages.length === 0 ? 'none' : failedStages.length}`);
  for (const stage of failedStages) {
    lines.push(
      `    ${stage?.name ?? '?'} (${stage?.mode ?? '?'}) [${stage?.failureKind ?? 'unclassified'}]: ${stage?.error ?? 'no error recorded'}`,
    );
  }
  return lines.join('\n');
}

export function readRenderApiKey(
  env: NodeJS.ProcessEnv,
  cliConfigText: string | null | undefined,
): string | null {
  const fromEnv = env.RENDER_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  if (!cliConfigText) return null;
  const apiBlock = cliConfigText.match(/^api:\s*\n((?:[ \t]+.*\n?)*)/m);
  const key = apiBlock?.[1].match(/^[ \t]+key:[ \t]*["']?([^"'\s]+)["']?[ \t]*$/m)?.[1];
  return key ?? null;
}

export type PermissionProbeAction =
  | 'find'
  | 'insert'
  | 'update'
  | 'remove'
  | 'listCollections'
  | 'listIndexes'
  | 'dbStats'
  | 'listDatabases'
  | 'createIndex'
  | 'drop';

export interface PermissionProbeCheck {
  db: string;
  collection?: string;
  action: PermissionProbeAction;
  expect: 'allowed' | 'denied';
}

export interface PermissionProbePlan {
  expectedUser: string;
  checks: PermissionProbeCheck[];
  unprobedActions: string[];
}

const ATLAS_ACTIONS: Record<string, PermissionProbeAction> = {
  FIND: 'find',
  INSERT: 'insert',
  UPDATE: 'update',
  REMOVE: 'remove',
  LIST_COLLECTIONS: 'listCollections',
  LIST_INDEXES: 'listIndexes',
  DB_STATS: 'dbStats',
  LIST_DATABASES: 'listDatabases',
};

const COLLECTION_ACTIONS = new Set<PermissionProbeAction>([
  'find',
  'insert',
  'update',
  'remove',
  'listIndexes',
]);

export const PERMISSION_PROBE_COLLECTION = '__ops_sweep_permission_probe';

const EXPECTED_DENIALS: PermissionProbeCheck[] = [
  { db: DEVELOPMENT_DATABASE_NAME, collection: 'accounts', action: 'update', expect: 'denied' },
  {
    db: DEVELOPMENT_DATABASE_NAME,
    collection: PERMISSION_PROBE_COLLECTION,
    action: 'createIndex',
    expect: 'denied',
  },
  {
    db: DEVELOPMENT_DATABASE_NAME,
    collection: PERMISSION_PROBE_COLLECTION,
    action: 'drop',
    expect: 'denied',
  },
  ...['Beta', 'Prod'].flatMap((db): PermissionProbeCheck[] => [
    { db, collection: 'research_entities', action: 'find', expect: 'denied' },
    { db, collection: 'research_entities', action: 'update', expect: 'denied' },
  ]),
];

interface AtlasRoleResource {
  db?: string;
  collection?: string;
  cluster?: boolean;
}

interface AtlasCustomRole {
  roleName?: string;
  actions?: Array<{ action?: string; resources?: AtlasRoleResource[] }>;
  inheritedRoles?: Array<{ db?: string; role?: string }>;
}

const checkKey = (check: Omit<PermissionProbeCheck, 'expect'>): string =>
  `${check.action} ${check.db}.${check.collection ?? ''}`;

export function buildPermissionProbePlan(role: AtlasCustomRole): PermissionProbePlan {
  if (role.roleName !== SWEEP_DATABASE_ROLE) {
    throw new Error(`expected the ${SWEEP_DATABASE_ROLE} role; read ${role.roleName ?? 'none'}`);
  }
  if ((role.inheritedRoles ?? []).length > 0) {
    throw new Error(
      `${SWEEP_DATABASE_ROLE} inherits ${role.inheritedRoles!.map((inherited) => `${inherited.role}@${inherited.db}`).join(', ')}, which this probe cannot enumerate`,
    );
  }
  const granted = new Map<string, PermissionProbeCheck>();
  const unprobed = new Set<string>();
  for (const entry of role.actions ?? []) {
    const action = ATLAS_ACTIONS[entry.action ?? ''];
    if (!action) {
      unprobed.add(entry.action ?? '(unnamed)');
      continue;
    }
    for (const resource of entry.resources ?? []) {
      if (resource.cluster) {
        if (action === 'listDatabases') {
          granted.set(checkKey({ db: 'admin', action }), {
            db: 'admin',
            action,
            expect: 'allowed',
          });
        } else {
          unprobed.add(`${entry.action} on the cluster`);
        }
        continue;
      }
      if (!resource.db) continue;
      const collection = COLLECTION_ACTIONS.has(action)
        ? resource.collection || PERMISSION_PROBE_COLLECTION
        : undefined;
      const check: PermissionProbeCheck = {
        db: resource.db,
        ...(collection ? { collection } : {}),
        action,
        expect: 'allowed',
      };
      granted.set(checkKey(check), check);
    }
  }
  const conflicts = EXPECTED_DENIALS.filter((denial) => granted.has(checkKey(denial)));
  if (conflicts.length > 0) {
    throw new Error(
      `${SWEEP_DATABASE_ROLE} grants what it must not: ${conflicts.map((conflict) => checkKey(conflict)).join(', ')}`,
    );
  }
  const checks = [...granted.values()].sort((left, right) =>
    checkKey(left).localeCompare(checkKey(right)),
  );
  return {
    expectedUser: SWEEP_DATABASE_ROLE,
    checks: [...checks, ...EXPECTED_DENIALS],
    unprobedActions: [...unprobed].sort(),
  };
}

export function permissionProbeStartCommand(
  runtimeSource: string,
  plan: PermissionProbePlan,
): string {
  const payload = `${runtimeSource}\nrunPermissionProbeJob(${JSON.stringify(plan)});\n`;
  const encoded = Buffer.from(payload, 'utf8').toString('base64');
  return `node -e "eval(Buffer.from('${encoded}','base64').toString())"`;
}

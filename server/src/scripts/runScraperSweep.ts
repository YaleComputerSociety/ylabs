import { spawnSync, type SpawnSyncReturns } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { Source } from '../models/source';
import { buildOrchestrator } from '../scrapers/registry';
import {
  resolveMongoDatabaseName,
  resolveScraperEnvironment,
  type ScraperEnvironment,
} from '../scrapers/scraperEnvironment';
import { sanitizeLogValue } from '../utils/logSanitizer';

export type ScraperSweepMode =
  | 'development-plan'
  | 'development-sample'
  | 'development-full'
  | 'beta-plan'
  | 'beta-fetch';

export interface ScraperSweepSource {
  name: string;
  phase: 'identity' | 'discovery' | 'funding' | 'relationships' | 'content-access' | 'scholarly';
}

export const SCRAPER_SWEEP_SOURCES: ScraperSweepSource[] = [
  { name: 'yale-directory', phase: 'identity' },
  { name: 'ysm-atoz-index', phase: 'discovery' },
  { name: 'ysm-faculty-directory', phase: 'discovery' },
  { name: 'yse-centers-index', phase: 'discovery' },
  { name: 'yse-faculty-directory', phase: 'discovery' },
  { name: 'yale-research-official', phase: 'discovery' },
  { name: 'centers-institutes-index', phase: 'discovery' },
  { name: 'peabody-collections-research', phase: 'discovery' },
  { name: 'beinecke-collections-research', phase: 'discovery' },
  { name: 'library-collections-as-data', phase: 'discovery' },
  { name: 'beinecke-curatorial-units', phase: 'discovery' },
  { name: 'yuag-curatorial-areas', phase: 'discovery' },
  { name: 'ycba-collections-research', phase: 'discovery' },
  { name: 'dept-faculty-roster', phase: 'discovery' },
  { name: 'bbs-research-track', phase: 'discovery' },
  { name: 'department-research-areas', phase: 'discovery' },
  { name: 'department-undergrad-research', phase: 'discovery' },
  { name: 'course-based-research-pathways', phase: 'discovery' },
  { name: 'yale-college-fellowships-office', phase: 'discovery' },
  { name: 'yale-reu-programs', phase: 'discovery' },
  { name: 'yale-health-sciences-summer-programs', phase: 'discovery' },
  { name: 'student-grants-database', phase: 'discovery' },
  { name: 'undergrad-fellowships-recipients', phase: 'discovery' },
  { name: 'dh-lab-projects', phase: 'discovery' },
  { name: 'nih-reporter', phase: 'funding' },
  { name: 'nsf-award-search', phase: 'funding' },
  { name: 'neh-funded-projects', phase: 'funding' },
  { name: 'federal-award-usaspending', phase: 'funding' },
  { name: 'doe-osti', phase: 'funding' },
  { name: 'official-profile-pi-backfill', phase: 'relationships' },
  { name: 'official-research-home-roster', phase: 'relationships' },
  { name: 'center-affiliation-llm', phase: 'relationships' },
  { name: 'center-director-llm', phase: 'relationships' },
  { name: 'lab-microsite-description-llm', phase: 'content-access' },
  { name: 'lab-microsite-undergrad-llm', phase: 'content-access' },
  { name: 'undergrad-research-posting', phase: 'content-access' },
  { name: 'research-area-source-extractor', phase: 'content-access' },
  { name: 'ysm-mesh-keyword', phase: 'content-access' },
];

interface ScraperSweepModeConfig {
  environment: Extract<ScraperEnvironment, 'development' | 'beta'>;
  database: 'Development' | 'Beta';
  writes: boolean;
  autoMaterialize: boolean;
  stopOnFailure: boolean;
  scraperFlags: string[];
  confirmationFlag?: string;
}

export interface ScraperSweepCliOptions {
  mode: ScraperSweepMode;
  confirmations: Set<string>;
}

export interface ScraperSweepRunRow {
  sourceName: string;
  phase: ScraperSweepSource['phase'];
  status: 'succeeded' | 'failed' | 'not-run';
  artifactPath: string;
  runId?: string;
  runStatus?: string;
  warningCount?: number;
  observationCount?: number;
  entitiesObserved?: number;
  fetchAttempts?: number;
  fetchSucceeded?: number;
  fetchFailed?: number;
  fetchBlocked?: number;
  selectorBreakages?: number;
  materializationCreated?: number;
  materializationUpdated?: number;
  materializationArchived?: number;
  materializationSkipped?: number;
  materializationConflicts?: number;
  materializationErrors?: number;
  exitCode?: number;
  error?: string;
  betaRenderCommands?: {
    plan: string;
    apply: string;
  };
}

export interface DevelopmentPostRunStage {
  name: 'search-rebuild' | 'coverage-audit' | 'data-quality' | 'integrity-gate' | 'trust-contract';
  status: 'succeeded' | 'failed';
  artifactPath: string;
  exitCode: number;
  error?: string;
}

export interface ScraperSweepSummary {
  mode: ScraperSweepMode;
  environment: ScraperSweepModeConfig['environment'];
  database: ScraperSweepModeConfig['database'];
  startedAt: string;
  finishedAt: string;
  outputDirectory: string;
  sourceCount: number;
  succeeded: number;
  failed: number;
  notRun: number;
  rows: ScraperSweepRunRow[];
  postRun?: {
    status: 'succeeded' | 'failed';
    stages: DevelopmentPostRunStage[];
  };
}

const MODE_CONFIG: Record<ScraperSweepMode, ScraperSweepModeConfig> = {
  'development-plan': {
    environment: 'development',
    database: 'Development',
    writes: false,
    autoMaterialize: false,
    stopOnFailure: false,
    scraperFlags: ['--limit', '100', '--use-cache', '--dry-run'],
  },
  'development-sample': {
    environment: 'development',
    database: 'Development',
    writes: true,
    autoMaterialize: true,
    stopOnFailure: false,
    scraperFlags: ['--limit', '100', '--use-cache', '--auto-materialize'],
  },
  'development-full': {
    environment: 'development',
    database: 'Development',
    writes: true,
    autoMaterialize: true,
    stopOnFailure: false,
    scraperFlags: ['--ignore-work-planner', '--exhaustive', '--auto-materialize'],
    confirmationFlag: '--confirm-development-full-sweep',
  },
  'beta-plan': {
    environment: 'beta',
    database: 'Beta',
    writes: false,
    autoMaterialize: false,
    stopOnFailure: true,
    scraperFlags: ['--limit', '100', '--dry-run'],
  },
  'beta-fetch': {
    environment: 'beta',
    database: 'Beta',
    writes: true,
    autoMaterialize: false,
    stopOnFailure: true,
    scraperFlags: ['--ignore-work-planner', '--exhaustive'],
    confirmationFlag: '--confirm-beta-release-candidate',
  },
};

const SWEEP_MODE_VALUES = new Set(Object.keys(MODE_CONFIG));
const LOCAL_MEILI_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export function parseScraperSweepArgs(argv: string[]): ScraperSweepCliOptions {
  let mode: ScraperSweepMode | undefined;
  const confirmations = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith('--mode=')) {
      const value = arg.slice('--mode='.length);
      if (!SWEEP_MODE_VALUES.has(value)) {
        throw new Error(`Unknown scraper sweep mode: ${value}`);
      }
      mode = value as ScraperSweepMode;
      continue;
    }
    if (arg === '--mode') {
      const value = argv[index + 1];
      if (!value || !SWEEP_MODE_VALUES.has(value)) {
        throw new Error('--mode requires a valid scraper sweep mode');
      }
      mode = value as ScraperSweepMode;
      index += 1;
      continue;
    }
    if (arg === '--confirm-development-full-sweep' || arg === '--confirm-beta-release-candidate') {
      confirmations.add(arg);
      continue;
    }
    throw new Error(`Unknown scraper sweep argument: ${arg}`);
  }

  if (!mode) {
    throw new Error('--mode is required');
  }
  const requiredConfirmation = MODE_CONFIG[mode].confirmationFlag;
  if (requiredConfirmation && !confirmations.has(requiredConfirmation)) {
    throw new Error(`${mode} requires ${requiredConfirmation}`);
  }
  return { mode, confirmations };
}

export function validateScraperSweepManifest(registeredNames: string[]): void {
  const configuredNames = SCRAPER_SWEEP_SOURCES.map((source) => source.name);
  const configuredSet = new Set(configuredNames);
  const registeredSet = new Set(registeredNames);
  const duplicateNames = configuredNames.filter(
    (name, index) => configuredNames.indexOf(name) !== index,
  );
  const missingFromSweep = registeredNames.filter((name) => !configuredSet.has(name));
  const unknownInSweep = configuredNames.filter((name) => !registeredSet.has(name));

  if (duplicateNames.length || missingFromSweep.length || unknownInSweep.length) {
    throw new Error(
      [
        duplicateNames.length ? `duplicate sweep sources: ${duplicateNames.join(', ')}` : '',
        missingFromSweep.length
          ? `registered sources missing from sweep: ${missingFromSweep.join(', ')}`
          : '',
        unknownInSweep.length ? `unknown sweep sources: ${unknownInSweep.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('; '),
    );
  }
}

export function validateScraperSweepSourceRows(
  registeredNames: string[],
  sourceRowNames: string[],
): void {
  const sourceRowSet = new Set(sourceRowNames);
  const missingSourceRows = registeredNames.filter((name) => !sourceRowSet.has(name));
  if (missingSourceRows.length > 0) {
    throw new Error(
      `Missing Source metadata rows: ${missingSourceRows.join(', ')}. Run the source metadata seed plan and apply before starting the sweep.`,
    );
  }
}

async function validateScraperSweepDatabasePreflight(registeredNames: string[]): Promise<void> {
  const mongoUrl = process.env.MONGODBURL;
  if (!mongoUrl) throw new Error('MONGODBURL is required for the scraper sweep');
  await mongoose.connect(mongoUrl);
  try {
    const sourceRowNames = await Source.find({ name: { $in: registeredNames } }).distinct('name');
    validateScraperSweepSourceRows(registeredNames, sourceRowNames);
  } finally {
    await mongoose.disconnect();
  }
}

export function validateScraperSweepEnvironment(
  mode: ScraperSweepMode,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const config = MODE_CONFIG[mode];
  const environment = resolveScraperEnvironment(env);
  if (environment !== config.environment) {
    throw new Error(`${mode} requires SCRAPER_ENV=${config.environment}; resolved ${environment}`);
  }

  const database = resolveMongoDatabaseName(env.MONGODBURL);
  if (database !== config.database) {
    throw new Error(`${mode} requires MongoDB database ${config.database}; resolved ${database}`);
  }
  if (config.writes && env.ALLOW_NON_PROD_SCRAPER_WRITES !== 'true') {
    throw new Error(`${mode} requires ALLOW_NON_PROD_SCRAPER_WRITES=true`);
  }
  if (config.environment === 'development' && config.autoMaterialize) {
    let meiliHost: URL;
    try {
      meiliHost = new URL(env.MEILISEARCH_HOST || '');
    } catch {
      throw new Error(`${mode} requires an explicit local MEILISEARCH_HOST`);
    }
    if (!LOCAL_MEILI_HOSTS.has(meiliHost.hostname)) {
      throw new Error(`${mode} refuses a non-local Development Meilisearch target`);
    }
    if (env.MEILISEARCH_INDEX_PREFIX) {
      throw new Error(`${mode} requires an empty Development MEILISEARCH_INDEX_PREFIX`);
    }
  }
}

export function buildScraperSweepChildArgs(
  mode: ScraperSweepMode,
  sourceName: string,
  artifactPath: string,
): string[] {
  return [
    '--cwd',
    'server',
    'scrape',
    'run',
    '--source',
    sourceName,
    ...MODE_CONFIG[mode].scraperFlags,
    '--output',
    artifactPath,
  ];
}

function betaRenderCommands(sourceName: string, runId: string) {
  const prefix = `/tmp/ylabs-beta-${sourceName}`;
  return {
    plan:
      `SCRAPER_ENV=beta yarn --cwd server scrape materialize --run ${runId} ` +
      `--dry-run --output ${prefix}-materialize-plan.json`,
    apply:
      `SCRAPER_ENV=beta ALLOW_NON_PROD_SCRAPER_WRITES=true ` +
      `yarn --cwd server scrape materialize --run ${runId} ` +
      `--confirm-materialize --output ${prefix}-materialize-result.json`,
  };
}

type ScraperSweepArtifactSummary = Pick<
  ScraperSweepRunRow,
  | 'runId'
  | 'runStatus'
  | 'warningCount'
  | 'observationCount'
  | 'entitiesObserved'
  | 'fetchAttempts'
  | 'fetchSucceeded'
  | 'fetchFailed'
  | 'fetchBlocked'
  | 'selectorBreakages'
  | 'materializationCreated'
  | 'materializationUpdated'
  | 'materializationArchived'
  | 'materializationSkipped'
  | 'materializationConflicts'
  | 'materializationErrors'
>;

function safeArtifactSummary(artifactPath: string): ScraperSweepArtifactSummary {
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8')) as Record<string, any>;
  const numeric = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  return {
    runId: typeof artifact.run?.id === 'string' ? artifact.run.id : undefined,
    runStatus: typeof artifact.run?.status === 'string' ? artifact.run.status : undefined,
    warningCount: Array.isArray(artifact.warnings) ? artifact.warnings.length : undefined,
    observationCount: numeric(artifact.observations?.total),
    entitiesObserved: numeric(artifact.observations?.entitiesObserved),
    fetchAttempts: numeric(artifact.coverage?.fetch?.attempts),
    fetchSucceeded: numeric(artifact.coverage?.fetch?.succeeded),
    fetchFailed: numeric(artifact.coverage?.fetch?.failed),
    fetchBlocked: numeric(artifact.coverage?.fetch?.blocked),
    selectorBreakages: numeric(artifact.coverage?.fetch?.selectorBreakages),
    materializationCreated: numeric(artifact.materialization?.created),
    materializationUpdated: numeric(artifact.materialization?.updated),
    materializationArchived: numeric(artifact.materialization?.archived),
    materializationSkipped: numeric(artifact.materialization?.skipped),
    materializationConflicts: numeric(artifact.materialization?.conflicts),
    materializationErrors: numeric(artifact.materialization?.errors),
  };
}

export function scraperSweepArtifactError(
  mode: ScraperSweepMode,
  artifact: ScraperSweepArtifactSummary,
): string | undefined {
  if (!artifact.runId) return 'ScrapeRun report is missing run.id';
  if (artifact.runStatus !== 'success') {
    return `ScrapeRun status is ${artifact.runStatus || 'missing'}, expected success`;
  }
  if (
    (mode === 'development-sample' || mode === 'development-full') &&
    (artifact.materializationErrors || 0) > 0
  ) {
    return `Development materialization reported ${artifact.materializationErrors} errors`;
  }
  return undefined;
}

function sweepTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

export function defaultScraperSweepOutputDirectory(
  mode: ScraperSweepMode,
  date = new Date(),
): string {
  return path.join(os.tmpdir(), `ylabs-${mode}-sweep-${sweepTimestamp(date)}`);
}

type ChildRunner = (
  command: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    stdio: 'inherit';
  },
) => SpawnSyncReturns<Buffer>;

export function buildDevelopmentPostRunStages(outputDirectory: string): Array<{
  name: DevelopmentPostRunStage['name'];
  artifactPath: string;
  args: string[];
}> {
  const stage = (
    name: DevelopmentPostRunStage['name'],
    command: string,
    commandArgs: string[],
    artifactName: string,
  ) => {
    const artifactPath = path.join(outputDirectory, artifactName);
    return {
      name,
      artifactPath,
      args: ['--cwd', 'server', command, ...commandArgs, '--output', artifactPath],
    };
  };

  return [
    stage(
      'search-rebuild',
      'meili:rebuild-research-entities',
      ['--clear', '--confirm-meili-rebuild'],
      'development-search-rebuild.json',
    ),
    stage(
      'coverage-audit',
      'research-entity:coverage-audit',
      ['--all'],
      'development-coverage.json',
    ),
    stage(
      'data-quality',
      'beta:data-quality',
      ['--strict', '--include-samples', '--progress'],
      'development-data-quality.json',
    ),
    stage(
      'integrity-gate',
      'scraper:integrity-gate',
      ['--include-samples', '--include-claim-gate'],
      'development-integrity.json',
    ),
    stage(
      'trust-contract',
      'launch:trust-contract',
      [
        '--collection=all',
        '--mode=student-ready-only',
        '--include-research-activity',
        '--include-paper-quality',
        '--strict',
      ],
      'development-trust-contract.json',
    ),
  ];
}

function runDevelopmentPostRunStages(
  outputDirectory: string,
  repoRoot: string,
  childRunner: ChildRunner,
): ScraperSweepSummary['postRun'] {
  const stages: DevelopmentPostRunStage[] = [];
  for (const stage of buildDevelopmentPostRunStages(outputDirectory)) {
    console.log(`\n[post-run] ${stage.name}`);
    const child = childRunner('yarn', stage.args, {
      cwd: repoRoot,
      env: process.env,
      stdio: 'inherit',
    });
    const exitCode = child.status ?? 1;
    const error =
      child.error || exitCode !== 0
        ? sanitizeLogValue(child.error || `${stage.name} exited with status ${exitCode}`)
        : undefined;
    stages.push({
      name: stage.name,
      status: error ? 'failed' : 'succeeded',
      artifactPath: stage.artifactPath,
      exitCode,
      ...(error ? { error } : {}),
    });
  }
  return {
    status: stages.some((stage) => stage.status === 'failed') ? 'failed' : 'succeeded',
    stages,
  };
}

export async function runScraperSweep(
  options: ScraperSweepCliOptions,
  dependencies: {
    childRunner?: ChildRunner;
    now?: () => Date;
  } = {},
): Promise<ScraperSweepSummary> {
  const config = MODE_CONFIG[options.mode];
  validateScraperSweepEnvironment(options.mode);
  const registeredNames = buildOrchestrator()
    .list()
    .map((source) => source.name);
  validateScraperSweepManifest(registeredNames);
  await validateScraperSweepDatabasePreflight(registeredNames);

  const now = dependencies.now || (() => new Date());
  const startedAt = now();
  const outputDirectory = defaultScraperSweepOutputDirectory(options.mode, startedAt);
  fs.mkdirSync(outputDirectory, { recursive: true });
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const childRunner = dependencies.childRunner || spawnSync;
  const rows: ScraperSweepRunRow[] = [];
  let stopped = false;

  for (const [index, source] of SCRAPER_SWEEP_SOURCES.entries()) {
    const artifactPath = path.join(
      outputDirectory,
      `${String(index + 1).padStart(2, '0')}-${source.name}.json`,
    );
    if (stopped) {
      rows.push({
        sourceName: source.name,
        phase: source.phase,
        status: 'not-run',
        artifactPath,
      });
      continue;
    }

    console.log(`\n[${index + 1}/${SCRAPER_SWEEP_SOURCES.length}] ${source.phase}: ${source.name}`);
    const child = childRunner(
      'yarn',
      buildScraperSweepChildArgs(options.mode, source.name, artifactPath),
      {
        cwd: repoRoot,
        env: process.env,
        stdio: 'inherit',
      },
    );
    const exitCode = child.status ?? 1;
    if (child.error || exitCode !== 0 || !fs.existsSync(artifactPath)) {
      rows.push({
        sourceName: source.name,
        phase: source.phase,
        status: 'failed',
        artifactPath,
        exitCode,
        error: sanitizeLogValue(child.error || `scraper exited with status ${exitCode}`),
      });
      if (config.stopOnFailure) stopped = true;
      continue;
    }

    try {
      const artifact = safeArtifactSummary(artifactPath);
      const artifactError = scraperSweepArtifactError(options.mode, artifact);
      const row: ScraperSweepRunRow = {
        sourceName: source.name,
        phase: source.phase,
        status: artifactError ? 'failed' : 'succeeded',
        artifactPath,
        ...artifact,
        ...(artifactError ? { error: artifactError } : {}),
      };
      if (!artifactError && options.mode === 'beta-fetch' && artifact.runId) {
        row.betaRenderCommands = betaRenderCommands(source.name, artifact.runId);
      }
      rows.push(row);
      if (artifactError && config.stopOnFailure) stopped = true;
    } catch (error) {
      rows.push({
        sourceName: source.name,
        phase: source.phase,
        status: 'failed',
        artifactPath,
        exitCode,
        error: sanitizeLogValue(error),
      });
      if (config.stopOnFailure) stopped = true;
    }
  }

  const postRun =
    options.mode === 'development-full'
      ? runDevelopmentPostRunStages(outputDirectory, repoRoot, childRunner)
      : undefined;
  const summary: ScraperSweepSummary = {
    mode: options.mode,
    environment: config.environment,
    database: config.database,
    startedAt: startedAt.toISOString(),
    finishedAt: now().toISOString(),
    outputDirectory,
    sourceCount: rows.length,
    succeeded: rows.filter((row) => row.status === 'succeeded').length,
    failed: rows.filter((row) => row.status === 'failed').length,
    notRun: rows.filter((row) => row.status === 'not-run').length,
    rows,
    ...(postRun ? { postRun } : {}),
  };
  const summaryPath = path.join(outputDirectory, 'summary.json');
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`\nScraper sweep summary: ${summaryPath}`);
  console.log(
    JSON.stringify(
      {
        mode: summary.mode,
        sourceCount: summary.sourceCount,
        succeeded: summary.succeeded,
        failed: summary.failed,
        notRun: summary.notRun,
        postRun: summary.postRun?.status,
      },
      null,
      2,
    ),
  );
  return summary;
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  void (async () => runScraperSweep(parseScraperSweepArgs(process.argv.slice(2))))()
    .then((summary) => {
      if (summary.failed > 0 || summary.notRun > 0 || summary.postRun?.status === 'failed') {
        process.exitCode = 1;
      }
    })
    .catch((error) => {
      console.error(`Scraper sweep failed: ${sanitizeLogValue(error)}`);
      process.exitCode = 1;
    });
}

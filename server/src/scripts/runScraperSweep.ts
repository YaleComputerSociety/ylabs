import { spawn } from 'child_process';
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
import { DEFAULT_PER_HOST_CONCURRENCY } from '../scrapers/utils/hostConcurrencyLimiter';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  DEFAULT_EPONYMOUS_FRA_MERGE_MAX,
  SCRAPER_SWEEP_AUTO_MERGE_FRA_ENV,
  type EponymousFraLabMergeDelta,
} from './researchEntityEponymousMergeStage';
import { SCRAPER_SWEEP_DELETE_MERGE_RESIDUE_ENV } from './cleanupArchivedResearchEntities';
import {
  SCRAPER_SWEEP_DEDUPE_RESEARCHERS_ENV,
  type ResearcherDedupeStageDelta,
} from './dedupeAccountlessResearcherShells';
import {
  DEFAULT_URL_IDENTITY_MERGE_MAX,
  isUrlIdentityDedupeStageEnabled,
} from './dedupeResearchEntitiesByPi';
import { isSweepStageEnabledByDefault, isSweepStageOptedIn } from './sweepStageFlags';
import {
  SweepCheckpointStore,
  checkpointPathForMode,
  pruneStepId,
  removeSweepCheckpoint,
  sourceStepId,
  stageStepId,
  sweepCheckpointFlagSignature,
} from './scraperSweepCheckpoint';
import { SweepRunLogger } from './scraperSweepLogging';
import { PRUNE_DEAD_OBSERVATIONS_CONFIRM_FLAG } from './pruneDeadObservationsCore';

export type ScraperSweepMode =
  | 'development-plan'
  | 'development-sample'
  | 'development-full'
  | 'development-incremental'
  | 'fellowship-development-full'
  | 'beta-plan'
  | 'beta-fetch';

export interface ScraperSweepSource {
  name: string;
  phase: 'identity' | 'discovery' | 'funding' | 'relationships' | 'content-access' | 'scholarly';
}

export const FELLOWSHIP_SWEEP_SOURCES: ScraperSweepSource[] = [
  { name: 'yale-college-fellowships-office', phase: 'discovery' },
  { name: 'yale-reu-programs', phase: 'discovery' },
  { name: 'yale-health-sciences-summer-programs', phase: 'discovery' },
  { name: 'student-grants-database', phase: 'discovery' },
];

export const RESEARCH_SWEEP_SOURCES: ScraperSweepSource[] = [
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

export const MANUAL_ONLY_SWEEP_SOURCES: string[] = ['undergrad-fellowships-recipients'];

export function sweepSourcesForMode(mode: ScraperSweepMode): ScraperSweepSource[] {
  return isFellowshipSweepMode(mode) ? FELLOWSHIP_SWEEP_SOURCES : RESEARCH_SWEEP_SOURCES;
}

interface ScraperSweepModeConfig {
  environment: Extract<ScraperEnvironment, 'development' | 'beta'>;
  database: 'Development' | 'Beta';
  writes: boolean;
  autoMaterialize: boolean;
  stopOnFailure: boolean;
  scraperFlags: string[];
  confirmationFlag?: string;
  defaultConcurrency: number;
}

export interface ScraperSweepCliOptions {
  mode: ScraperSweepMode;
  confirmations: Set<string>;
  concurrency?: number;
  restart?: boolean;
  forceLlm?: boolean;
  pruneBetweenPhases?: boolean;
}

export type ScraperSweepPhase = ScraperSweepSource['phase'];

const LLM_PHASE_CONCURRENCY_CAP = 2;

const PHASE_CONCURRENCY_CAPS: Partial<Record<ScraperSweepPhase, number>> = {
  relationships: LLM_PHASE_CONCURRENCY_CAP,
  'content-access': LLM_PHASE_CONCURRENCY_CAP,
};

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
  name:
    | 'faculty-projection'
    | 'researcher-dedupe'
    | 'eponymous-fra-merge'
    | 'url-identity-dedupe'
    | 'visibility-gate'
    | 'search-rebuild'
    | 'coverage-audit'
    | 'data-quality'
    | 'integrity-gate'
    | 'trust-contract'
    | 'archived-cleanup'
    | 'dead-data-prune';
  status: 'succeeded' | 'failed';
  artifactPath: string;
  exitCode: number;
  error?: string;
  mergeDelta?: EponymousFraLabMergeDelta;
  researcherDedupeDelta?: ResearcherDedupeStageDelta;
}

export interface DevelopmentPostRunStageOptions {
  autoMergeEponymousFra?: boolean;
  dedupeResearchers?: boolean;
  mergeUrlIdentityDuplicates?: boolean;
  deleteMergeResidue?: boolean;
  pruneDeadObservations?: boolean;
  sinceIso?: string;
  maxMerges?: number;
  maxUrlIdentityMerges?: number;
}

export function isDevelopmentSweepMode(mode: ScraperSweepMode): boolean {
  return mode === 'development-full' || mode === 'development-incremental';
}

export function isFellowshipSweepMode(mode: ScraperSweepMode): boolean {
  return mode === 'fellowship-development-full';
}

export function isDeadObservationPruneSweepMode(mode: ScraperSweepMode): boolean {
  return isDevelopmentSweepMode(mode) || isFellowshipSweepMode(mode);
}

export function resolveDevelopmentPostRunOptions(
  mode: ScraperSweepMode,
  env: NodeJS.ProcessEnv,
  sinceIso: string,
): DevelopmentPostRunStageOptions | undefined {
  if (!isDevelopmentSweepMode(mode)) return undefined;
  return {
    autoMergeEponymousFra: isSweepStageEnabledByDefault(env[SCRAPER_SWEEP_AUTO_MERGE_FRA_ENV]),
    dedupeResearchers: isSweepStageEnabledByDefault(env[SCRAPER_SWEEP_DEDUPE_RESEARCHERS_ENV]),
    mergeUrlIdentityDuplicates: isUrlIdentityDedupeStageEnabled(env),
    deleteMergeResidue: isSweepStageEnabledByDefault(env[SCRAPER_SWEEP_DELETE_MERGE_RESIDUE_ENV]),
    sinceIso,
  };
}

const MERGE_RESIDUE_DELETION_STAGE_ARGS = [
  '--apply',
  '--confirm-archived-entity-cleanup',
  '--max-apply=5000',
];

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
    stages: Array<DevelopmentPostRunStage | FellowshipPostRunStage>;
  };
}

export interface FellowshipPostRunStage {
  name:
    | 'classification-backfill'
    | 'global-regions-backfill'
    | 'official-sources-backfill'
    | 'link-labels-backfill'
    | 'accepting-applications-invariant'
    | 'source-link-health'
    | 'catalog-refresh'
    | 'research-relevance-audit'
    | 'freshness-audit'
    | 'dead-data-prune';
  status: 'succeeded' | 'failed';
  artifactPath?: string;
  exitCode: number;
  error?: string;
}

export interface FellowshipPostRunStageOptions {
  applyOfficialSourceChangeSet?: boolean;
  refreshFellowshipCatalog?: boolean;
  fellowshipRefreshTarget?: string;
  fellowshipRefreshRestoreToken?: string;
  fellowshipRefreshLimit?: number;
  sweepRefreshTarget?: string;
  applyLimit?: number;
  pruneDeadObservations?: boolean;
}

const MODE_CONFIG: Record<ScraperSweepMode, ScraperSweepModeConfig> = {
  'development-plan': {
    environment: 'development',
    database: 'Development',
    writes: false,
    autoMaterialize: false,
    stopOnFailure: false,
    scraperFlags: ['--limit', '100', '--use-cache', '--dry-run'],
    defaultConcurrency: 4,
  },
  'development-sample': {
    environment: 'development',
    database: 'Development',
    writes: true,
    autoMaterialize: true,
    stopOnFailure: false,
    scraperFlags: ['--limit', '100', '--use-cache', '--auto-materialize'],
    defaultConcurrency: 4,
  },
  'development-full': {
    environment: 'development',
    database: 'Development',
    writes: true,
    autoMaterialize: true,
    stopOnFailure: false,
    scraperFlags: ['--ignore-work-planner', '--exhaustive', '--use-cache', '--auto-materialize'],
    confirmationFlag: '--confirm-development-full-sweep',
    defaultConcurrency: 8,
  },
  'development-incremental': {
    environment: 'development',
    database: 'Development',
    writes: true,
    autoMaterialize: true,
    stopOnFailure: false,
    scraperFlags: ['--exhaustive', '--use-cache', '--auto-materialize'],
    confirmationFlag: '--confirm-development-incremental-sweep',
    defaultConcurrency: 8,
  },
  'fellowship-development-full': {
    environment: 'development',
    database: 'Development',
    writes: true,
    autoMaterialize: true,
    stopOnFailure: false,
    scraperFlags: ['--ignore-work-planner', '--exhaustive', '--use-cache', '--auto-materialize'],
    confirmationFlag: '--confirm-fellowship-sweep',
    defaultConcurrency: 8,
  },
  'beta-plan': {
    environment: 'beta',
    database: 'Beta',
    writes: false,
    autoMaterialize: false,
    stopOnFailure: true,
    scraperFlags: ['--limit', '100', '--dry-run'],
    defaultConcurrency: 1,
  },
  'beta-fetch': {
    environment: 'beta',
    database: 'Beta',
    writes: true,
    autoMaterialize: false,
    stopOnFailure: true,
    scraperFlags: ['--ignore-work-planner', '--exhaustive'],
    confirmationFlag: '--confirm-beta-release-candidate',
    defaultConcurrency: 1,
  },
};

const SWEEP_MODE_VALUES = new Set(Object.keys(MODE_CONFIG));
const LOCAL_MEILI_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function parseConcurrencyValue(raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`--concurrency requires a positive integer; received ${raw}`);
  }
  return value;
}

export function parseScraperSweepArgs(argv: string[]): ScraperSweepCliOptions {
  let mode: ScraperSweepMode | undefined;
  let concurrency: number | undefined;
  let restart = false;
  let forceLlm = false;
  let pruneBetweenPhases = false;
  const confirmations = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--restart') {
      restart = true;
      continue;
    }
    if (arg === '--force-llm') {
      forceLlm = true;
      continue;
    }
    if (arg === '--prune-between-phases') {
      pruneBetweenPhases = true;
      continue;
    }
    if (arg.startsWith('--concurrency=')) {
      concurrency = parseConcurrencyValue(arg.slice('--concurrency='.length));
      continue;
    }
    if (arg === '--concurrency') {
      concurrency = parseConcurrencyValue(argv[index + 1] ?? '');
      index += 1;
      continue;
    }
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
    if (
      arg === '--confirm-development-full-sweep' ||
      arg === '--confirm-development-incremental-sweep' ||
      arg === '--confirm-fellowship-sweep' ||
      arg === '--confirm-beta-release-candidate'
    ) {
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
  return {
    mode,
    confirmations,
    ...(concurrency ? { concurrency } : {}),
    ...(restart ? { restart } : {}),
    ...(forceLlm ? { forceLlm } : {}),
    ...(pruneBetweenPhases ? { pruneBetweenPhases } : {}),
  };
}

export function orderedScraperSweepPhases(
  sources: ScraperSweepSource[] = RESEARCH_SWEEP_SOURCES,
): ScraperSweepPhase[] {
  const seen = new Set<ScraperSweepPhase>();
  const phases: ScraperSweepPhase[] = [];
  for (const source of sources) {
    if (!seen.has(source.phase)) {
      seen.add(source.phase);
      phases.push(source.phase);
    }
  }
  return phases;
}

export function resolvePhaseConcurrency(
  mode: ScraperSweepMode,
  phase: ScraperSweepPhase,
  requested?: number,
): number {
  const base = requested ?? MODE_CONFIG[mode].defaultConcurrency;
  const cap = PHASE_CONCURRENCY_CAPS[phase];
  return Math.max(1, cap ? Math.min(base, cap) : base);
}

export function resolveSweepChildPerHostConcurrency(
  phaseConcurrency: number,
  env: NodeJS.ProcessEnv = process.env,
  budget: number = DEFAULT_PER_HOST_CONCURRENCY,
): number {
  const shared = Math.max(1, Math.floor(budget / Math.max(1, phaseConcurrency)));
  const override = Number(env.SCRAPER_PER_HOST_CONCURRENCY);
  return Number.isInteger(override) && override >= 1 ? Math.min(override, shared) : shared;
}

export async function runWithBoundedConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, () =>
    (async () => {
      for (;;) {
        const next = queue.shift();
        if (next === undefined) return;
        await worker(next);
      }
    })(),
  );
  await Promise.all(runners);
}

export function validateScraperSweepManifest(registeredNames: string[]): void {
  const researchNames = RESEARCH_SWEEP_SOURCES.map((source) => source.name);
  const fellowshipNames = FELLOWSHIP_SWEEP_SOURCES.map((source) => source.name);
  const configuredNames = [...researchNames, ...fellowshipNames];
  const configuredSet = new Set(configuredNames);
  const registeredSet = new Set(registeredNames);
  const manualOnlySet = new Set(MANUAL_ONLY_SWEEP_SOURCES);

  const duplicateNames = configuredNames.filter(
    (name, index) => configuredNames.indexOf(name) !== index,
  );
  const missingFromSweep = registeredNames.filter(
    (name) => !configuredSet.has(name) && !manualOnlySet.has(name),
  );
  const unknownInSweep = configuredNames.filter((name) => !registeredSet.has(name));
  const manualInSweep = configuredNames.filter((name) => manualOnlySet.has(name));

  if (
    duplicateNames.length ||
    missingFromSweep.length ||
    unknownInSweep.length ||
    manualInSweep.length
  ) {
    throw new Error(
      [
        duplicateNames.length
          ? `sources present in both engines or duplicated: ${duplicateNames.join(', ')}`
          : '',
        missingFromSweep.length
          ? `registered sources missing from both sweep engines: ${missingFromSweep.join(', ')}`
          : '',
        unknownInSweep.length ? `unknown sweep sources: ${unknownInSweep.join(', ')}` : '',
        manualInSweep.length
          ? `manual-only sources must stay out of the sweep manifest: ${manualInSweep.join(', ')}`
          : '',
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
  options: { forceLlm?: boolean } = {},
): string[] {
  return [
    '--cwd',
    'server',
    'scrape',
    'run',
    '--source',
    sourceName,
    ...MODE_CONFIG[mode].scraperFlags,
    ...(options.forceLlm ? ['--force-llm'] : []),
    '--output',
    artifactPath,
  ];
}

export function buildPruneDeadObservationsChildArgs(artifactPath: string): string[] {
  return [
    '--cwd',
    'server',
    'observations:prune-dead',
    '--apply',
    PRUNE_DEAD_OBSERVATIONS_CONFIRM_FLAG,
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
  if (MODE_CONFIG[mode].autoMaterialize && (artifact.materializationErrors || 0) > 0) {
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

export interface ScraperSweepChildResult {
  status: number | null;
  error?: Error;
}

interface ChildRunnerOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  logPath?: string;
}

type ChildRunner = (
  command: string,
  args: string[],
  options: ChildRunnerOptions,
) => Promise<ScraperSweepChildResult>;

function spawnChild(
  command: string,
  args: string[],
  options: ChildRunnerOptions,
): Promise<ScraperSweepChildResult> {
  return new Promise((resolve) => {
    const logFd = options.logPath ? fs.openSync(options.logPath, 'a') : undefined;
    let settled = false;
    const finish = (result: ScraperSweepChildResult) => {
      if (settled) return;
      settled = true;
      if (logFd !== undefined) fs.closeSync(logFd);
      resolve(result);
    };
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: logFd === undefined ? 'inherit' : ['ignore', logFd, logFd],
    });
    child.on('error', (error) => finish({ status: null, error }));
    child.on('close', (code) => finish({ status: code }));
  });
}

interface PostRunStageDelta {
  mergeDelta?: EponymousFraLabMergeDelta;
  researcherDedupeDelta?: ResearcherDedupeStageDelta;
}

interface PostRunStageDefinition {
  name: DevelopmentPostRunStage['name'];
  command: string;
  artifactName: string;
  buildArgs: (options: DevelopmentPostRunStageOptions) => string[];
  isEnabled: (options: DevelopmentPostRunStageOptions) => boolean;
  parseResult?: (artifact: unknown) => PostRunStageDelta;
}

export function parseEponymousFraMergeResult(artifact: unknown): PostRunStageDelta {
  const record = artifact as Record<string, unknown> | null;
  const mergeDelta = record?.mergeDelta;
  if (!mergeDelta || typeof mergeDelta !== 'object') {
    throw new Error('eponymous-fra-merge result is missing a mergeDelta object');
  }
  return { mergeDelta: mergeDelta as EponymousFraLabMergeDelta };
}

export function parseResearcherDedupeResult(artifact: unknown): PostRunStageDelta {
  const record = artifact as Record<string, unknown> | null;
  if (!record || typeof record !== 'object' || record.byReason === undefined) {
    throw new Error('researcher-dedupe result is missing byReason totals');
  }
  const attributeUnion = (record.attributeUnion as { profileLinksAppended?: unknown }) ?? {};
  return {
    researcherDedupeDelta: {
      byReason: record.byReason as ResearcherDedupeStageDelta['byReason'],
      shellsMerged: Number(record.shellsMerged ?? 0),
      roleAssignmentsRepointed: Number(record.roleAssignmentsRepointed ?? 0),
      roleAssignmentsArchivedRedundant: Number(record.roleAssignmentsArchivedRedundant ?? 0),
      profileLinksAppended: Number(attributeUnion.profileLinksAppended ?? 0),
    },
  };
}

export const DEVELOPMENT_POST_RUN_STAGE_DEFINITIONS: PostRunStageDefinition[] = [
  {
    name: 'faculty-projection',
    command: 'research-entity:project-faculty',
    artifactName: 'development-faculty-projection.json',
    buildArgs: () => ['--apply', '--confirm-faculty-projection', '--concurrency', '12'],
    isEnabled: () => true,
  },
  {
    name: 'researcher-dedupe',
    command: 'researchers:dedupe-accountless-shells',
    artifactName: 'development-researcher-dedupe.json',
    buildArgs: () => ['--apply', '--confirm-dedupe-accountless-researcher-shells'],
    isEnabled: (options) => Boolean(options.dedupeResearchers),
    parseResult: parseResearcherDedupeResult,
  },
  {
    name: 'eponymous-fra-merge',
    command: 'research-entity:merge-eponymous-fra',
    artifactName: 'development-eponymous-fra-merge.json',
    buildArgs: (options) => [
      '--apply',
      '--confirm-auto-merge-eponymous-fra',
      '--since',
      options.sinceIso as string,
      '--max-merges',
      String(options.maxMerges ?? DEFAULT_EPONYMOUS_FRA_MERGE_MAX),
    ],
    isEnabled: (options) => Boolean(options.autoMergeEponymousFra && options.sinceIso),
    parseResult: parseEponymousFraMergeResult,
  },
  {
    name: 'url-identity-dedupe',
    command: 'research-entity:dedupe-by-pi',
    artifactName: 'development-url-identity-dedupe.json',
    buildArgs: (options) => [
      '--profile-lab-url-only',
      '--apply',
      '--confirm-research-entity-pi-dedupe',
      '--limit=10000',
      `--max-apply=${options.maxUrlIdentityMerges ?? DEFAULT_URL_IDENTITY_MERGE_MAX}`,
    ],
    isEnabled: (options) => Boolean(options.mergeUrlIdentityDuplicates),
  },
  {
    name: 'visibility-gate',
    command: 'student-visibility:gate',
    artifactName: 'development-visibility-gate.json',
    buildArgs: () => [
      '--collection=all',
      '--apply',
      '--confirm-student-visibility-apply',
      '--max-apply=100000',
    ],
    isEnabled: () => true,
  },
  {
    name: 'search-rebuild',
    command: 'meili:rebuild-research-entities',
    artifactName: 'development-search-rebuild.json',
    buildArgs: () => ['--clear', '--confirm-meili-rebuild'],
    isEnabled: () => true,
  },
  {
    name: 'coverage-audit',
    command: 'research-entity:coverage-audit',
    artifactName: 'development-coverage.json',
    buildArgs: () => ['--all'],
    isEnabled: () => true,
  },
  {
    name: 'data-quality',
    command: 'beta:data-quality',
    artifactName: 'development-data-quality.json',
    buildArgs: () => ['--strict', '--include-samples', '--progress'],
    isEnabled: () => true,
  },
  {
    name: 'integrity-gate',
    command: 'scraper:integrity-gate',
    artifactName: 'development-integrity.json',
    buildArgs: () => ['--include-samples', '--include-claim-gate'],
    isEnabled: () => true,
  },
  {
    name: 'trust-contract',
    command: 'launch:trust-contract',
    artifactName: 'development-trust-contract.json',
    buildArgs: () => ['--collection=all', '--mode=student-ready-only', '--strict'],
    isEnabled: () => true,
  },
  {
    name: 'archived-cleanup',
    command: 'research-entity:cleanup-archived',
    artifactName: 'development-archived-cleanup.json',
    buildArgs: (options) => [
      '--merge-residue-only',
      '--limit=5000',
      ...(options.deleteMergeResidue ? MERGE_RESIDUE_DELETION_STAGE_ARGS : []),
    ],
    isEnabled: () => true,
  },
  {
    name: 'dead-data-prune',
    command: 'observations:prune-dead',
    artifactName: 'development-dead-data-prune.json',
    buildArgs: () => ['--apply', PRUNE_DEAD_OBSERVATIONS_CONFIRM_FLAG],
    isEnabled: (options) => Boolean(options.pruneDeadObservations),
  },
];

interface PlannedPostRunStage {
  definition: PostRunStageDefinition;
  name: DevelopmentPostRunStage['name'];
  artifactPath: string;
  args: string[];
}

function planDevelopmentPostRunStages(
  outputDirectory: string,
  options: DevelopmentPostRunStageOptions,
): PlannedPostRunStage[] {
  return DEVELOPMENT_POST_RUN_STAGE_DEFINITIONS.filter((definition) =>
    definition.isEnabled(options),
  ).map((definition) => {
    const artifactPath = path.join(outputDirectory, definition.artifactName);
    return {
      definition,
      name: definition.name,
      artifactPath,
      args: [
        '--cwd',
        'server',
        definition.command,
        ...definition.buildArgs(options),
        '--output',
        artifactPath,
      ],
    };
  });
}

export function buildDevelopmentPostRunStages(
  outputDirectory: string,
  options: DevelopmentPostRunStageOptions = {},
): Array<{
  name: DevelopmentPostRunStage['name'];
  artifactPath: string;
  args: string[];
}> {
  return planDevelopmentPostRunStages(outputDirectory, options).map(
    ({ name, artifactPath, args }) => ({ name, artifactPath, args }),
  );
}

export function parseDevelopmentPostRunStageResult(
  artifactPath: string,
  parseResult: (artifact: unknown) => PostRunStageDelta,
): PostRunStageDelta {
  let raw: string;
  try {
    raw = fs.readFileSync(artifactPath, 'utf8');
  } catch {
    throw new Error(`result artifact was not written at ${artifactPath}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`result artifact at ${artifactPath} is not valid JSON`);
  }
  return parseResult(parsed);
}

interface SweepRuntimeContext {
  store: SweepCheckpointStore;
  logger: SweepRunLogger;
  now: () => Date;
}

function reconstructDevelopmentStageDelta(
  planned: PlannedPostRunStage,
): PostRunStageDelta | undefined {
  if (!planned.definition.parseResult) return {};
  try {
    return parseDevelopmentPostRunStageResult(planned.artifactPath, planned.definition.parseResult);
  } catch {
    return undefined;
  }
}

async function runDevelopmentPostRunStages(
  outputDirectory: string,
  repoRoot: string,
  childRunner: ChildRunner,
  options: DevelopmentPostRunStageOptions = {},
  ctx?: SweepRuntimeContext,
): Promise<ScraperSweepSummary['postRun']> {
  const stages: DevelopmentPostRunStage[] = [];
  for (const planned of planDevelopmentPostRunStages(outputDirectory, options)) {
    const stepId = stageStepId(planned.name);
    const resumedDelta = ctx?.store.isDone(stepId)
      ? reconstructDevelopmentStageDelta(planned)
      : undefined;
    if (resumedDelta) {
      console.log(`\n[post-run] ${planned.name} (resume: already done)`);
      stages.push({
        name: planned.name,
        status: 'succeeded',
        artifactPath: planned.artifactPath,
        exitCode: 0,
        ...resumedDelta,
      });
      continue;
    }
    if (ctx?.store.isDone(stepId)) {
      console.warn(
        `[post-run] ${planned.name} was marked done but its result artifact is missing or invalid; re-running`,
      );
    }
    console.log(`\n[post-run] ${planned.name}`);
    const logPath = `${planned.artifactPath}.log`;
    ctx?.store.markRunning(stepId, 'stage', ctx.now());
    ctx?.logger.logStart(stepId);
    const child = await childRunner('yarn', planned.args, {
      cwd: repoRoot,
      env: process.env,
      logPath,
    });
    const exitCode = child.status ?? 1;
    let error =
      child.error || exitCode !== 0
        ? sanitizeLogValue(child.error || `${planned.name} exited with status ${exitCode}`)
        : undefined;
    let delta: PostRunStageDelta = {};
    if (!error && planned.definition.parseResult) {
      try {
        delta = parseDevelopmentPostRunStageResult(
          planned.artifactPath,
          planned.definition.parseResult,
        );
      } catch (contractError) {
        error = sanitizeLogValue(contractError);
        console.error(`[post-run] ${planned.name} result contract failed: ${error}`);
      }
    }
    if (ctx) {
      if (error) {
        ctx.store.markFailed(stepId, 'stage', exitCode, ctx.now());
        ctx.logger.logFailed(stepId, exitCode, logPath);
      } else {
        ctx.store.markDone(stepId, 'stage', exitCode, ctx.now());
        ctx.logger.logDone(stepId, exitCode);
      }
    }
    stages.push({
      name: planned.name,
      status: error ? 'failed' : 'succeeded',
      artifactPath: planned.artifactPath,
      exitCode,
      ...(error ? { error } : {}),
      ...delta,
    });
  }
  return {
    status: stages.some((stage) => stage.status === 'failed') ? 'failed' : 'succeeded',
    stages,
  };
}

export const SCRAPER_SWEEP_REFRESH_FELLOWSHIPS_ENV = 'SCRAPER_SWEEP_REFRESH_FELLOWSHIPS';
export const SCRAPER_SWEEP_FELLOWSHIP_REFRESH_TARGET_ENV =
  'SCRAPER_SWEEP_FELLOWSHIP_REFRESH_TARGET';
export const SCRAPER_SWEEP_FELLOWSHIP_REFRESH_RESTORE_TOKEN_ENV =
  'SCRAPER_SWEEP_FELLOWSHIP_REFRESH_RESTORE_TOKEN';
export const SCRAPER_SWEEP_APPLY_OFFICIAL_SOURCE_CHANGE_SET_ENV =
  'SCRAPER_SWEEP_APPLY_OFFICIAL_SOURCE_CHANGE_SET';
export const FELLOWSHIP_REFRESH_RESTORE_TOKEN_ENV = 'FELLOWSHIP_REFRESH_RESTORE_TOKEN';

const DEFAULT_FELLOWSHIP_POST_RUN_APPLY_LIMIT = 10000;
const DEFAULT_FELLOWSHIP_REFRESH_LIMIT = 50;

export function sweepFellowshipRefreshTarget(mode: ScraperSweepMode): string | undefined {
  return MODE_CONFIG[mode].environment === 'beta' ? 'beta' : undefined;
}

export function resolveFellowshipPostRunOptions(
  mode: ScraperSweepMode,
  env: NodeJS.ProcessEnv,
): FellowshipPostRunStageOptions | undefined {
  if (!isFellowshipSweepMode(mode)) return undefined;
  return {
    applyOfficialSourceChangeSet: isSweepStageOptedIn(
      env[SCRAPER_SWEEP_APPLY_OFFICIAL_SOURCE_CHANGE_SET_ENV],
    ),
    refreshFellowshipCatalog: isSweepStageOptedIn(env[SCRAPER_SWEEP_REFRESH_FELLOWSHIPS_ENV]),
    fellowshipRefreshTarget: env[SCRAPER_SWEEP_FELLOWSHIP_REFRESH_TARGET_ENV],
    fellowshipRefreshRestoreToken: env[SCRAPER_SWEEP_FELLOWSHIP_REFRESH_RESTORE_TOKEN_ENV],
    sweepRefreshTarget: sweepFellowshipRefreshTarget(mode),
  };
}

interface FellowshipPostRunStageDefinition {
  name: FellowshipPostRunStage['name'];
  command: string;
  artifactName: string;
  buildArgs: (options: FellowshipPostRunStageOptions) => string[];
  buildSecretEnv?: (options: FellowshipPostRunStageOptions) => NodeJS.ProcessEnv;
  isEnabled: (options: FellowshipPostRunStageOptions) => boolean;
  appendsOutputArtifact: boolean;
}

function fellowshipApplyLimit(options: FellowshipPostRunStageOptions): number {
  return options.applyLimit ?? DEFAULT_FELLOWSHIP_POST_RUN_APPLY_LIMIT;
}

export function fellowshipCatalogRefreshBlocker(
  options: FellowshipPostRunStageOptions,
): string | undefined {
  if (!options.refreshFellowshipCatalog) {
    return `${SCRAPER_SWEEP_REFRESH_FELLOWSHIPS_ENV} is not set`;
  }
  if (!options.fellowshipRefreshTarget || !options.fellowshipRefreshRestoreToken) {
    return `${SCRAPER_SWEEP_FELLOWSHIP_REFRESH_TARGET_ENV} and ${SCRAPER_SWEEP_FELLOWSHIP_REFRESH_RESTORE_TOKEN_ENV} are both required`;
  }
  if (!options.sweepRefreshTarget) {
    return 'fellowships:refresh only accepts a beta or prod target, which no Development sweep mode can satisfy';
  }
  if (options.fellowshipRefreshTarget !== options.sweepRefreshTarget) {
    return `the requested refresh target does not match this sweep's ${options.sweepRefreshTarget} target`;
  }
  return undefined;
}

export const FELLOWSHIP_POST_RUN_STAGE_DEFINITIONS: FellowshipPostRunStageDefinition[] = [
  {
    name: 'classification-backfill',
    command: 'programs:backfill-classification',
    artifactName: 'fellowship-classification-backfill.json',
    buildArgs: (options) => [
      '--apply',
      '--confirm-program-classification-backfill',
      `--limit=${fellowshipApplyLimit(options)}`,
    ],
    isEnabled: () => true,
    appendsOutputArtifact: true,
  },
  {
    name: 'global-regions-backfill',
    command: 'programs:backfill-global-regions',
    artifactName: 'fellowship-global-regions-backfill.json',
    buildArgs: (options) => [
      '--apply',
      '--confirm-global-regions-backfill',
      `--limit=${fellowshipApplyLimit(options)}`,
    ],
    isEnabled: () => true,
    appendsOutputArtifact: true,
  },
  {
    name: 'official-sources-backfill',
    command: 'programs:backfill-official-sources',
    artifactName: 'fellowship-official-sources-backfill.json',
    buildArgs: (options) => [
      '--apply',
      '--confirm-program-official-source-backfill',
      `--limit=${fellowshipApplyLimit(options)}`,
    ],
    isEnabled: (options) => Boolean(options.applyOfficialSourceChangeSet),
    appendsOutputArtifact: true,
  },
  {
    name: 'link-labels-backfill',
    command: 'programs:backfill-link-labels',
    artifactName: 'fellowship-link-labels-backfill.json',
    buildArgs: () => ['--apply', '--confirm-program-link-label-backfill'],
    isEnabled: () => true,
    appendsOutputArtifact: true,
  },
  {
    name: 'accepting-applications-invariant',
    command: 'programs:backfill-accepting-applications-invariant',
    artifactName: 'fellowship-accepting-applications-invariant.json',
    buildArgs: () => ['--apply', '--confirm-accepting-applications-invariant-backfill'],
    isEnabled: () => true,
    appendsOutputArtifact: true,
  },
  {
    name: 'source-link-health',
    command: 'programs:backfill-source-link-health',
    artifactName: 'fellowship-source-link-health.json',
    buildArgs: (options) => [
      '--apply',
      '--confirm-source-link-health',
      `--limit=${fellowshipApplyLimit(options)}`,
    ],
    isEnabled: () => true,
    appendsOutputArtifact: true,
  },
  {
    name: 'catalog-refresh',
    command: 'fellowships:refresh',
    artifactName: 'fellowship-catalog-refresh.json',
    buildArgs: (options) => {
      const target = options.fellowshipRefreshTarget as string;
      return [
        `--target=${target}`,
        `--confirm=execute-fellowship-refresh-${target}`,
        '--execute',
        `--limit=${options.fellowshipRefreshLimit ?? DEFAULT_FELLOWSHIP_REFRESH_LIMIT}`,
      ];
    },
    buildSecretEnv: (options) => ({
      [FELLOWSHIP_REFRESH_RESTORE_TOKEN_ENV]: options.fellowshipRefreshRestoreToken,
    }),
    isEnabled: (options) => !fellowshipCatalogRefreshBlocker(options),
    appendsOutputArtifact: false,
  },
  {
    name: 'research-relevance-audit',
    command: 'programs:audit-research-relevance',
    artifactName: 'fellowship-research-relevance-audit.json',
    buildArgs: () => [],
    isEnabled: () => true,
    appendsOutputArtifact: true,
  },
  {
    name: 'freshness-audit',
    command: 'programs:audit-freshness',
    artifactName: 'fellowship-freshness-audit.json',
    buildArgs: () => [],
    isEnabled: () => true,
    appendsOutputArtifact: true,
  },
  {
    name: 'dead-data-prune',
    command: 'observations:prune-dead',
    artifactName: 'fellowship-dead-data-prune.json',
    buildArgs: () => ['--apply', PRUNE_DEAD_OBSERVATIONS_CONFIRM_FLAG],
    isEnabled: (options) => Boolean(options.pruneDeadObservations),
    appendsOutputArtifact: true,
  },
];

interface PlannedFellowshipPostRunStage {
  name: FellowshipPostRunStage['name'];
  artifactPath?: string;
  args: string[];
  secretEnv?: NodeJS.ProcessEnv;
}

function planFellowshipPostRunStages(
  outputDirectory: string,
  options: FellowshipPostRunStageOptions,
): PlannedFellowshipPostRunStage[] {
  return FELLOWSHIP_POST_RUN_STAGE_DEFINITIONS.filter((definition) =>
    definition.isEnabled(options),
  ).map((definition) => {
    const artifactPath = definition.appendsOutputArtifact
      ? path.join(outputDirectory, definition.artifactName)
      : undefined;
    const secretEnv = definition.buildSecretEnv?.(options);
    return {
      name: definition.name,
      ...(artifactPath ? { artifactPath } : {}),
      args: [
        '--cwd',
        'server',
        definition.command,
        ...definition.buildArgs(options),
        ...(artifactPath ? [`--output=${artifactPath}`] : []),
      ],
      ...(secretEnv ? { secretEnv } : {}),
    };
  });
}

export function buildFellowshipPostRunStages(
  outputDirectory: string,
  options: FellowshipPostRunStageOptions = {},
): PlannedFellowshipPostRunStage[] {
  return planFellowshipPostRunStages(outputDirectory, options);
}

export function fellowshipPostRunArtifactError(artifactPath: string): string | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(artifactPath, 'utf8');
  } catch {
    return `declared report artifact was not written at ${artifactPath}`;
  }
  try {
    JSON.parse(raw);
  } catch {
    return `report artifact at ${artifactPath} is not valid JSON`;
  }
  return undefined;
}

async function runFellowshipPostRunStages(
  outputDirectory: string,
  repoRoot: string,
  childRunner: ChildRunner,
  options: FellowshipPostRunStageOptions = {},
  ctx?: SweepRuntimeContext,
): Promise<ScraperSweepSummary['postRun']> {
  const refreshBlocker = options.refreshFellowshipCatalog
    ? fellowshipCatalogRefreshBlocker(options)
    : undefined;
  if (refreshBlocker) {
    console.warn(
      `[fellowship-post-run] catalog-refresh skipped: ${sanitizeLogValue(refreshBlocker)}`,
    );
  }
  const stages: FellowshipPostRunStage[] = [];
  for (const planned of planFellowshipPostRunStages(outputDirectory, options)) {
    const stepId = stageStepId(planned.name);
    if (ctx?.store.isDone(stepId)) {
      const resumeArtifactError = planned.artifactPath
        ? fellowshipPostRunArtifactError(planned.artifactPath)
        : undefined;
      if (!resumeArtifactError) {
        console.log(`\n[fellowship-post-run] ${planned.name} (resume: already done)`);
        stages.push({
          name: planned.name,
          status: 'succeeded',
          ...(planned.artifactPath ? { artifactPath: planned.artifactPath } : {}),
          exitCode: 0,
        });
        continue;
      }
      console.warn(
        `[fellowship-post-run] ${planned.name} was marked done but its report artifact is missing or invalid; re-running`,
      );
    }
    console.log(`\n[fellowship-post-run] ${planned.name}`);
    const logPath = planned.artifactPath
      ? `${planned.artifactPath}.log`
      : path.join(outputDirectory, `fellowship-${planned.name}.log`);
    ctx?.store.markRunning(stepId, 'stage', ctx.now());
    ctx?.logger.logStart(stepId);
    const child = await childRunner('yarn', planned.args, {
      cwd: repoRoot,
      env: planned.secretEnv ? { ...process.env, ...planned.secretEnv } : process.env,
      logPath,
    });
    const exitCode = child.status ?? 1;
    let error =
      child.error || exitCode !== 0
        ? sanitizeLogValue(child.error || `${planned.name} exited with status ${exitCode}`)
        : undefined;
    if (!error && planned.artifactPath) {
      const artifactError = fellowshipPostRunArtifactError(planned.artifactPath);
      if (artifactError) {
        error = sanitizeLogValue(artifactError);
        console.error(`[fellowship-post-run] ${planned.name} report contract failed: ${error}`);
      }
    }
    if (ctx) {
      if (error) {
        ctx.store.markFailed(stepId, 'stage', exitCode, ctx.now());
        ctx.logger.logFailed(stepId, exitCode, logPath);
      } else {
        ctx.store.markDone(stepId, 'stage', exitCode, ctx.now());
        ctx.logger.logDone(stepId, exitCode);
      }
    }
    stages.push({
      name: planned.name,
      status: error ? 'failed' : 'succeeded',
      ...(planned.artifactPath ? { artifactPath: planned.artifactPath } : {}),
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
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const checkpointPath = checkpointPathForMode(options.mode, os.tmpdir(), repoRoot);
  const { store, resumed } = SweepCheckpointStore.start({
    mode: options.mode,
    flags: sweepCheckpointFlagSignature(options),
    checkpointPath,
    outputDirectory: defaultScraperSweepOutputDirectory(options.mode, startedAt),
    now: startedAt,
    restart: Boolean(options.restart),
  });
  const outputDirectory = store.outputDirectory;
  fs.mkdirSync(outputDirectory, { recursive: true });
  console.log(
    resumed
      ? `Resuming ${options.mode} sweep from checkpoint ${checkpointPath} (output ${outputDirectory})`
      : `Starting ${options.mode} sweep (checkpoint ${checkpointPath}, output ${outputDirectory})`,
  );
  const logger = new SweepRunLogger(outputDirectory, now);
  const ctx: SweepRuntimeContext = { store, logger, now };
  const childRunner = dependencies.childRunner || spawnChild;
  const sweepSources = sweepSourcesForMode(options.mode);
  const rows = new Array<ScraperSweepRunRow>(sweepSources.length);
  let stopped = false;

  if (resumed && sweepSources.some((source) => !store.isDone(sourceStepId(source.name)))) {
    const invalidated = store.clearStageSteps(startedAt);
    if (invalidated.length > 0) {
      console.log(
        `Re-running ${invalidated.length} post-run stage(s) because at least one source still has to run: ${invalidated.join(', ')}`,
      );
    }
  }

  const artifactPathFor = (source: ScraperSweepSource, index: number): string =>
    path.join(outputDirectory, `${String(index + 1).padStart(2, '0')}-${source.name}.json`);

  const notRunRow = (source: ScraperSweepSource, index: number): ScraperSweepRunRow => ({
    sourceName: source.name,
    phase: source.phase,
    status: 'not-run',
    artifactPath: artifactPathFor(source, index),
  });

  const succeededRowFromArtifact = (
    source: ScraperSweepSource,
    artifactPath: string,
  ): ScraperSweepRunRow | undefined => {
    let artifact: ScraperSweepArtifactSummary;
    try {
      artifact = safeArtifactSummary(artifactPath);
    } catch {
      return undefined;
    }
    if (scraperSweepArtifactError(options.mode, artifact)) return undefined;
    const row: ScraperSweepRunRow = {
      sourceName: source.name,
      phase: source.phase,
      status: 'succeeded',
      artifactPath,
      ...artifact,
    };
    if (options.mode === 'beta-fetch' && artifact.runId) {
      row.betaRenderCommands = betaRenderCommands(source.name, artifact.runId);
    }
    return row;
  };

  const runSource = async (
    source: ScraperSweepSource,
    index: number,
    phaseConcurrency: number,
  ): Promise<void> => {
    const artifactPath = artifactPathFor(source, index);
    const stepId = sourceStepId(source.name);
    if (store.isDone(stepId)) {
      const resumedRow = succeededRowFromArtifact(source, artifactPath);
      if (resumedRow) {
        console.log(
          `\n[${index + 1}/${sweepSources.length}] ${source.phase}: ${source.name} (resume: already done)`,
        );
        rows[index] = resumedRow;
        return;
      }
      console.warn(
        `\n[${index + 1}/${sweepSources.length}] ${source.phase}: ${source.name} was marked done but its artifact is missing or invalid; re-running`,
      );
    }
    if (stopped) {
      rows[index] = notRunRow(source, index);
      return;
    }
    const logPath = `${artifactPath}.log`;
    console.log(
      `\n[${index + 1}/${sweepSources.length}] ${source.phase}: ${source.name} (logs -> ${logPath})`,
    );
    store.markRunning(stepId, 'source', now());
    logger.logStart(stepId);
    const child = await childRunner(
      'yarn',
      buildScraperSweepChildArgs(options.mode, source.name, artifactPath, {
        forceLlm: options.forceLlm,
      }),
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          SCRAPER_PER_HOST_CONCURRENCY: String(
            resolveSweepChildPerHostConcurrency(phaseConcurrency),
          ),
        },
        logPath,
      },
    );
    const exitCode = child.status ?? 1;
    const failStep = (error: string): void => {
      store.markFailed(stepId, 'source', exitCode, now());
      logger.logFailed(stepId, exitCode, logPath);
      rows[index] = {
        sourceName: source.name,
        phase: source.phase,
        status: 'failed',
        artifactPath,
        exitCode,
        error,
      };
      if (config.stopOnFailure) stopped = true;
    };
    if (child.error || exitCode !== 0 || !fs.existsSync(artifactPath)) {
      failStep(sanitizeLogValue(child.error || `scraper exited with status ${exitCode}`));
      return;
    }

    try {
      const artifact = safeArtifactSummary(artifactPath);
      const artifactError = scraperSweepArtifactError(options.mode, artifact);
      if (artifactError) {
        failStep(artifactError);
        return;
      }
      const row: ScraperSweepRunRow = {
        sourceName: source.name,
        phase: source.phase,
        status: 'succeeded',
        artifactPath,
        ...artifact,
      };
      if (options.mode === 'beta-fetch' && artifact.runId) {
        row.betaRenderCommands = betaRenderCommands(source.name, artifact.runId);
      }
      rows[index] = row;
      store.markDone(stepId, 'source', exitCode, now());
      logger.logDone(stepId, exitCode);
    } catch (error) {
      failStep(sanitizeLogValue(error));
    }
  };

  const runBetweenPhasesPrune = async (phase: ScraperSweepPhase): Promise<void> => {
    if (!options.pruneBetweenPhases || !isDeadObservationPruneSweepMode(options.mode) || stopped) {
      return;
    }
    const stepId = pruneStepId(phase);
    if (store.isDone(stepId)) {
      console.log(`\n[prune] between phases after ${phase} (resume: already done)`);
      return;
    }
    const artifactPath = path.join(outputDirectory, `prune-between-${phase}.json`);
    const logPath = `${artifactPath}.log`;
    console.log(`\n[prune] between phases after ${phase}`);
    store.markRunning(stepId, 'prune', now());
    logger.logStart(stepId);
    const child = await childRunner('yarn', buildPruneDeadObservationsChildArgs(artifactPath), {
      cwd: repoRoot,
      env: process.env,
      logPath,
    });
    const exitCode = child.status ?? 1;
    if (child.error || exitCode !== 0) {
      store.markFailed(stepId, 'prune', exitCode, now());
      logger.logFailed(stepId, exitCode, logPath);
      console.warn(
        `[prune] between-phases prune after ${phase} failed (exit ${exitCode}); continuing sweep`,
      );
      return;
    }
    store.markDone(stepId, 'prune', exitCode, now());
    logger.logDone(stepId, exitCode);
  };

  const globalEntries = sweepSources.map((source, index) => ({ source, index }));
  for (const phase of orderedScraperSweepPhases(sweepSources)) {
    const phaseEntries = globalEntries.filter((entry) => entry.source.phase === phase);
    if (stopped) {
      for (const { source, index } of phaseEntries) {
        if (!rows[index]) rows[index] = notRunRow(source, index);
      }
      continue;
    }
    const phaseConcurrency = resolvePhaseConcurrency(options.mode, phase, options.concurrency);
    await runWithBoundedConcurrency(phaseEntries, phaseConcurrency, ({ source, index }) =>
      runSource(source, index, phaseConcurrency),
    );
    await runBetweenPhasesPrune(phase);
  }

  for (const [index, source] of sweepSources.entries()) {
    if (!rows[index]) rows[index] = notRunRow(source, index);
  }

  const developmentPostRunOptions = resolveDevelopmentPostRunOptions(
    options.mode,
    process.env,
    startedAt.toISOString(),
  );
  const pruneDeadObservations =
    Boolean(options.pruneBetweenPhases) && isDeadObservationPruneSweepMode(options.mode);
  if (developmentPostRunOptions && pruneDeadObservations) {
    developmentPostRunOptions.pruneDeadObservations = true;
  }
  const fellowshipPostRunOptions = resolveFellowshipPostRunOptions(options.mode, process.env);
  if (fellowshipPostRunOptions && pruneDeadObservations) {
    fellowshipPostRunOptions.pruneDeadObservations = true;
  }
  let postRun: ScraperSweepSummary['postRun'];
  if (developmentPostRunOptions) {
    postRun = await runDevelopmentPostRunStages(
      outputDirectory,
      repoRoot,
      childRunner,
      developmentPostRunOptions,
      ctx,
    );
  } else if (fellowshipPostRunOptions) {
    postRun = await runFellowshipPostRunStages(
      outputDirectory,
      repoRoot,
      childRunner,
      fellowshipPostRunOptions,
      ctx,
    );
  }
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
  if (summary.failed === 0 && summary.notRun === 0 && summary.postRun?.status !== 'failed') {
    removeSweepCheckpoint(checkpointPath);
  }
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

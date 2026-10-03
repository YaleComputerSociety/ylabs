import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { Source } from '../models/source';
import { buildOrchestrator } from '../scrapers/registry';
import { MANUAL_ONLY_SWEEP_SOURCES } from '../scrapers/manualOnlySweepSources';
import {
  planSweepCodeDriftRefusal,
  sweepCodeIdentityFrom,
  type SweepCodeDriftRefusal,
} from './sweepCodeIdentityCore';
import {
  resolveMongoDatabaseName,
  resolveScraperEnvironment,
  type ScraperEnvironment,
} from '../scrapers/scraperEnvironment';
import { c4LosslessIngestEnabled } from '../scrapers/observationStore';
import { readCodeSha } from '../scrapers/scrapeRunCodeIdentity';
import { runWithBoundedConcurrency } from '../scrapers/utils/boundedConcurrency';
import {
  ChainedHostSlotLimiter,
  DEFAULT_PER_HOST_CONCURRENCY,
  HostConcurrencyLimiter,
  type HostSlotLimiter,
} from '../scrapers/utils/hostConcurrencyLimiter';
import {
  brokerSocketPath,
  HostSlotBroker,
  SCRAPER_HOST_SLOT_BROKER_ENV,
} from '../scrapers/utils/hostSlotBroker';
import {
  SCRAPER_SWEEP_PAGE_REUSE_ENV,
  SWEEP_PAGE_REUSE_HOSTS,
  resolveSweepPageReuseMaxBytes,
} from '../scrapers/utils/sweepPageReuse';
import { SweepPageStore, type SweepPageStoreStats } from '../scrapers/utils/sweepPageStore';
import { machineHostSlotLimiter } from '../scrapers/utils/scraperHostSlotLimiter';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { SOURCE_LINK_HEALTH_FRESHNESS_DAYS } from '../services/sourceLinkHealth';
import { SOURCE_LINK_HEALTH_REPROBE_HEALTHY_AFTER_DAYS } from './backfillSourceLinkHealthCore';
import {
  DEFAULT_EPONYMOUS_FRA_MERGE_MAX,
  SCRAPER_SWEEP_AUTO_MERGE_FRA_ENV,
  type EponymousFraLabMergeDelta,
} from './researchEntityEponymousMergeStage';
import { SCRAPER_SWEEP_DELETE_MERGE_RESIDUE_ENV } from './cleanupArchivedResearchEntities';
import {
  DEFAULT_GRANT_SHELL_PORT_MAX,
  SCRAPER_SWEEP_PORT_GRANT_SHELLS_ENV,
  type GrantShellPortDelta,
} from './portGrantShellsToFacultyProfiles';
import {
  SCRAPER_SWEEP_DEDUPE_RESEARCHERS_ENV,
  type ResearcherDedupeStageDelta,
} from './dedupeAccountlessResearcherShells';
import {
  DEFAULT_URL_IDENTITY_MERGE_MAX,
  isUrlIdentityDedupeStageEnabled,
  type UrlIdentityDedupeStageDelta,
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
import { formatSweepPreflightReport, runSweepPreflight } from './scraperSweepPreflight';
import { connectScriptMongo } from '../db/connections';

export type ScraperSweepMode =
  | 'development-plan'
  | 'development-sample'
  | 'development-full'
  | 'development-incremental'
  | 'fellowship-development-full';

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
  { name: 'dept-faculty-roster', phase: 'discovery' },
  { name: 'bbs-research-track', phase: 'discovery' },
  { name: 'department-research-areas', phase: 'discovery' },
  { name: 'department-undergrad-research', phase: 'discovery' },
  { name: 'nih-reporter', phase: 'funding' },
  { name: 'nsf-award-search', phase: 'funding' },
  { name: 'neh-funded-projects', phase: 'funding' },
  { name: 'doe-osti', phase: 'funding' },
  // Identity work, but deliberately not in the `identity` phase: the aliases it resolves are
  // minted by `dept-faculty-roster` during `discovery`, so running earlier would only ever
  // resolve the previous sweep's keys. It leads `relationships` because the lanes below it read
  // the person key it repairs.
  { name: 'directory-alias-resolution', phase: 'relationships' },
  { name: 'official-profile-pi-backfill', phase: 'relationships' },
  { name: 'official-research-home-roster', phase: 'relationships' },
  { name: 'lab-site-lead-verification', phase: 'relationships' },
  { name: 'center-affiliation-llm', phase: 'relationships' },
  { name: 'center-director-llm', phase: 'relationships' },
  { name: 'lab-microsite-description-llm', phase: 'content-access' },
  { name: 'research-area-source-extractor', phase: 'content-access' },
  { name: 'ysm-mesh-keyword', phase: 'content-access' },
];

export { MANUAL_ONLY_SWEEP_SOURCES };

export function sweepSourcesForMode(mode: ScraperSweepMode): ScraperSweepSource[] {
  return isFellowshipSweepMode(mode) ? FELLOWSHIP_SWEEP_SOURCES : RESEARCH_SWEEP_SOURCES;
}

interface ScraperSweepModeConfig {
  environment: Extract<ScraperEnvironment, 'development'>;
  database: 'Development';
  writes: boolean;
  autoMaterialize: boolean;
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
  skipPreflight?: boolean;
  noPageReuse?: boolean;
  fullLinkHealthReprobe?: boolean;
}

export type ScraperSweepPhase = ScraperSweepSource['phase'];

const LLM_PHASE_CONCURRENCY_CAP = 2;

const PHASE_CONCURRENCY_CAPS: Partial<Record<ScraperSweepPhase, number>> = {
  relationships: LLM_PHASE_CONCURRENCY_CAP,
  'content-access': LLM_PHASE_CONCURRENCY_CAP,
};

export interface SweepStepTiming {
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
}

export function sweepStepTiming(startedAt: Date, finishedAt: Date): Required<SweepStepTiming> {
  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
  };
}

export interface SweepPhaseTiming extends Required<SweepStepTiming> {
  phase: ScraperSweepPhase;
}

export interface ScraperSweepRunRow extends SweepStepTiming {
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
  throttleRecovered?: number;
  throttleExhausted?: number;
  materializationCreated?: number;
  materializationUpdated?: number;
  materializationArchived?: number;
  materializationSkipped?: number;
  materializationConflicts?: number;
  materializationErrors?: number;
  exitCode?: number;
  error?: string;
}

export interface DevelopmentPostRunStage extends SweepStepTiming {
  name:
    | 'stale-scrape-run-reap'
    | 'researcher-dedupe'
    | 'grant-shell-faculty-port'
    | 'eponymous-fra-merge'
    | 'url-identity-dedupe'
    | 'website-url-identity-dedupe'
    | 'source-link-health'
    | 'profile-link-health'
    | 'dead-research-website-clear'
    | 'organization-identity-website-retire'
    | 'shared-roster-website-retire'
    | 'refusal-lane-attribution'
    | 'inferred-pi-lead-reclaim'
    | 'visibility-gate'
    | 'search-rebuild'
    | 'lane-scorecard'
    | 'engine-benchmark'
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
  grantShellPortDelta?: GrantShellPortDelta;
  researcherDedupeDelta?: ResearcherDedupeStageDelta;
  urlIdentityDedupeDelta?: UrlIdentityDedupeStageDelta;
  profileLinkHealthDelta?: ProfileLinkHealthStageDelta;
  deadResearchWebsiteDelta?: DeadResearchWebsiteStageDelta;
  staleScrapeRunReapDelta?: StaleScrapeRunReapStageDelta;
  inferredPiLeadReclaimDelta?: InferredPiLeadReclaimStageDelta;
}

export interface DevelopmentPostRunStageOptions {
  autoMergeEponymousFra?: boolean;
  dedupeResearchers?: boolean;
  portGrantShells?: boolean;
  mergeUrlIdentityDuplicates?: boolean;
  deleteMergeResidue?: boolean;
  pruneDeadObservations?: boolean;
  fullLinkHealthReprobe?: boolean;
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
    portGrantShells: isSweepStageEnabledByDefault(env[SCRAPER_SWEEP_PORT_GRANT_SHELLS_ENV]),
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

/**
 * A source that ends `succeeded` having written no observation has learned nothing,
 * and counting it in `succeeded` is how five sources went months without producing
 * anything while the sweep summary read healthy (#2607). `runReport` already warns
 * on exactly this; the summary is where the warning was being dropped.
 *
 * Reported rather than failed, because a single zero-observation run is legitimate when
 * the work planner skipped every target. Escalation lives upstream in
 * `scrapers/sourceYieldGuard.ts`, which fails the run itself once a source has emitted
 * nothing on three consecutive runs; such a run arrives here with `runStatus: 'failure'`
 * and `scraperSweepArtifactError` counts it in `failed`, not here.
 */
export function sourcesThatProducedNothing(rows: ScraperSweepRunRow[]): string[] {
  return rows
    .filter((row) => row.status === 'succeeded' && row.observationCount === 0)
    .map((row) => row.sourceName);
}

export interface SweepThrottleRetrySummary {
  recovered: number;
  exhausted: number;
  exhaustedSources: string[];
}

export function sweepThrottleRetrySummary(rows: ScraperSweepRunRow[]): SweepThrottleRetrySummary {
  return {
    recovered: rows.reduce((total, row) => total + (row.throttleRecovered ?? 0), 0),
    exhausted: rows.reduce((total, row) => total + (row.throttleExhausted ?? 0), 0),
    exhaustedSources: rows
      .filter((row) => (row.throttleExhausted ?? 0) > 0)
      .map((row) => row.sourceName),
  };
}

export interface SweepPageReuseSummary extends SweepPageStoreStats {
  hosts: string[];
}

export interface ScraperSweepSummary {
  mode: ScraperSweepMode;
  environment: ScraperSweepModeConfig['environment'];
  database: ScraperSweepModeConfig['database'];
  startedAt: string;
  finishedAt: string;
  outputDirectory: string;
  /**
   * The commit the stages actually ran, which is a property of the checkout rather than of
   * `beta`. `null` where the checkout could not report one. `codeDrift` is present only when the
   * checkout moved mid-run, which is the condition that makes stage results unattributable.
   */
  codeSha: string | null;
  codeDrift?: SweepCodeDriftRefusal[];
  sourceCount: number;
  succeeded: number;
  failed: number;
  notRun: number;
  producedNothing: number;
  producedNothingSources: string[];
  throttleRetry: SweepThrottleRetrySummary;
  rows: ScraperSweepRunRow[];
  phases?: SweepPhaseTiming[];
  pageReuse?: SweepPageReuseSummary;
  postRun?: {
    status: 'succeeded' | 'failed';
    stages: Array<DevelopmentPostRunStage | FellowshipPostRunStage>;
  } & SweepStepTiming;
}

export interface FellowshipPostRunStage extends SweepStepTiming {
  name:
    | 'program-visibility-gate'
    | 'global-regions-backfill'
    | 'official-sources-backfill'
    | 'link-labels-backfill'
    | 'accepting-applications-invariant'
    | 'source-link-health'
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
  applyLimit?: number;
  pruneDeadObservations?: boolean;
}

// An exhaustive mode never passes --use-cache: it persists every fetched payload to
// scrape_snapshots for 24h, and one full sweep wrote more cache than the Development
// Atlas quota holds (#3536). Only the --limit modes may cache.
const MODE_CONFIG: Record<ScraperSweepMode, ScraperSweepModeConfig> = {
  'development-plan': {
    environment: 'development',
    database: 'Development',
    writes: false,
    autoMaterialize: false,
    scraperFlags: ['--limit', '100', '--use-cache', '--dry-run'],
    defaultConcurrency: 4,
  },
  'development-sample': {
    environment: 'development',
    database: 'Development',
    writes: true,
    autoMaterialize: true,
    scraperFlags: ['--limit', '100', '--use-cache', '--auto-materialize'],
    defaultConcurrency: 4,
  },
  'development-full': {
    environment: 'development',
    database: 'Development',
    writes: true,
    autoMaterialize: true,
    scraperFlags: ['--ignore-work-planner', '--exhaustive', '--auto-materialize'],
    confirmationFlag: '--confirm-development-full-sweep',
    defaultConcurrency: 8,
  },
  'development-incremental': {
    environment: 'development',
    database: 'Development',
    writes: true,
    autoMaterialize: true,
    scraperFlags: ['--exhaustive', '--auto-materialize'],
    confirmationFlag: '--confirm-development-incremental-sweep',
    defaultConcurrency: 8,
  },
  'fellowship-development-full': {
    environment: 'development',
    database: 'Development',
    writes: true,
    autoMaterialize: true,
    scraperFlags: ['--ignore-work-planner', '--exhaustive', '--auto-materialize'],
    confirmationFlag: '--confirm-fellowship-sweep',
    defaultConcurrency: 8,
  },
};

const SWEEP_MODE_VALUES = new Set(Object.keys(MODE_CONFIG));

export function scraperSweepModes(): ScraperSweepMode[] {
  return Object.keys(MODE_CONFIG) as ScraperSweepMode[];
}
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
  let skipPreflight = false;
  let noPageReuse = false;
  let fullLinkHealthReprobe = false;
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
    if (arg === '--skip-preflight') {
      skipPreflight = true;
      continue;
    }
    if (arg === '--no-page-reuse') {
      noPageReuse = true;
      continue;
    }
    if (arg === '--full-link-health-reprobe') {
      fullLinkHealthReprobe = true;
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
      arg === '--confirm-fellowship-sweep'
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
    ...(skipPreflight ? { skipPreflight } : {}),
    ...(noPageReuse ? { noPageReuse } : {}),
    ...(fullLinkHealthReprobe ? { fullLinkHealthReprobe } : {}),
  };
}

export function isSweepPageReuseEnabled(options: ScraperSweepCliOptions): boolean {
  return isDeadObservationPruneSweepMode(options.mode) && !options.noPageReuse;
}

export function isSweepPreflightEnabled(options: ScraperSweepCliOptions): boolean {
  return options.mode === 'development-full' && !options.skipPreflight;
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

export function resolveSweepHostSlotBudget(
  env: NodeJS.ProcessEnv = process.env,
  budget: number = DEFAULT_PER_HOST_CONCURRENCY,
): number {
  const override = Number(env.SCRAPER_PER_HOST_CONCURRENCY);
  return Number.isInteger(override) && override >= 1 ? Math.min(override, budget) : budget;
}

export function sweepHostSlotBrokerPath(tmpdir: string = os.tmpdir(), pid = process.pid): string {
  return brokerSocketPath(`ylabs-host-slots-${pid}.sock`, tmpdir);
}

export async function startSweepHostSlotBroker(
  env: NodeJS.ProcessEnv = process.env,
  socketPath: string = sweepHostSlotBrokerPath(),
  options: { pageReuse?: boolean; machineWide?: HostSlotLimiter } = {},
): Promise<HostSlotBroker> {
  return HostSlotBroker.listen(
    socketPath,
    new ChainedHostSlotLimiter([
      new HostConcurrencyLimiter(resolveSweepHostSlotBudget(env)),
      options.machineWide ?? machineHostSlotLimiter(),
    ]),
    options.pageReuse
      ? {
          pageStore: new SweepPageStore(resolveSweepPageReuseMaxBytes(env), SWEEP_PAGE_REUSE_HOSTS),
        }
      : {},
  );
}

export function sweepPageReuseSummary(broker: HostSlotBroker): SweepPageReuseSummary | undefined {
  const stats = broker.pageStore?.stats();
  return stats ? { hosts: [...SWEEP_PAGE_REUSE_HOSTS], ...stats } : undefined;
}

function formatMebibytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MiB`;
}

export function formatSweepPageReuseSummary(summary: SweepPageReuseSummary | undefined): string {
  if (!summary) return 'Page reuse within this sweep: off';
  return `Page reuse within this sweep: ${summary.hits} of ${summary.lookups} lookups served from a page fetched earlier in the sweep; ${summary.stored} stored, ${summary.evicted} evicted, peak ${formatMebibytes(summary.peakHeldBytes)} of ${formatMebibytes(summary.maxBytes)}`;
}

export { runWithBoundedConcurrency };

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
  const unregisteredManualOnly = MANUAL_ONLY_SWEEP_SOURCES.filter(
    (name) => !registeredSet.has(name),
  );

  if (
    duplicateNames.length ||
    missingFromSweep.length ||
    unknownInSweep.length ||
    manualInSweep.length ||
    unregisteredManualOnly.length
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
        unregisteredManualOnly.length
          ? `manual-only sources that are not registered: ${unregisteredManualOnly.join(', ')}`
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
  await connectScriptMongo(mongoUrl);
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
  if (config.autoMaterialize) {
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

/**
 * The prune children inherit this process's environment and refuse to delete unless the
 * materializer read scope is declared, because an absent flag is not proof it is off
 * (#2944). The sweep is the process that materialized the rows it is about to prune, so
 * its own resolved value is the declaration; leaving it unset would turn an opted-in
 * prune stage into a green no-op that reclaims nothing.
 */
export function declareMaterializationReadScopeForChildren(
  env: NodeJS.ProcessEnv = process.env,
): void {
  env.C4_LOSSLESS_INGEST = String(c4LosslessIngestEnabled(env));
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
  | 'throttleRecovered'
  | 'throttleExhausted'
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
    throttleRecovered: numeric(artifact.coverage?.fetch?.throttleRecovered),
    throttleExhausted: numeric(artifact.coverage?.fetch?.throttleExhausted),
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
  timedOut?: boolean;
}

interface ChildRunnerOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  logPath?: string;
  timeoutMs?: number;
}

const CHILD_KILL_GRACE_MS = 10_000;

type ChildRunner = (
  command: string,
  args: string[],
  options: ChildRunnerOptions,
) => Promise<ScraperSweepChildResult>;

// A container image carries no .git, so the commit it was built from arrives as RENDER_GIT_COMMIT
// (deploy/sweep-runner/Dockerfile). An image cannot move under a run, so it is a faithful HEAD.
export function readSweepHeadSha(
  repoRoot: string,
  env: NodeJS.ProcessEnv = process.env,
  runGit: (repoRoot: string) => { status: number | null; stdout: string } = (root) =>
    spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }),
): string | null {
  const result = runGit(repoRoot);
  if (result.status === 0) return result.stdout.trim();
  return readCodeSha(env, repoRoot) ?? null;
}

function defaultHeadShaReader(repoRoot: string): string | null {
  return readSweepHeadSha(repoRoot);
}

function spawnChild(
  command: string,
  args: string[],
  options: ChildRunnerOptions,
): Promise<ScraperSweepChildResult> {
  return new Promise((resolve) => {
    const logFd = options.logPath ? fs.openSync(options.logPath, 'a') : undefined;
    let settled = false;
    let timedOut = false;
    const timers: NodeJS.Timeout[] = [];
    const finish = (result: ScraperSweepChildResult) => {
      if (settled) return;
      settled = true;
      for (const timer of timers) clearTimeout(timer);
      if (logFd !== undefined) fs.closeSync(logFd);
      resolve(timedOut ? { ...result, timedOut } : result);
    };
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: logFd === undefined ? 'inherit' : ['ignore', logFd, logFd],
      detached: options.timeoutMs !== undefined,
    });
    if (options.timeoutMs !== undefined && child.pid !== undefined) {
      const killGroup = (signal: NodeJS.Signals) => {
        try {
          process.kill(-child.pid!, signal);
        } catch {
          child.kill(signal);
        }
      };
      const killOnParentExit = () => killGroup('SIGKILL');
      process.once('exit', killOnParentExit);
      child.once('close', () => process.removeListener('exit', killOnParentExit));
      timers.push(
        setTimeout(() => {
          timedOut = true;
          killGroup('SIGTERM');
          timers.push(setTimeout(() => killGroup('SIGKILL'), CHILD_KILL_GRACE_MS));
        }, options.timeoutMs),
      );
    }
    child.on('error', (error) => finish({ status: null, error }));
    child.on('close', (code) => finish({ status: code }));
  });
}

interface PostRunStageDelta {
  mergeDelta?: EponymousFraLabMergeDelta;
  grantShellPortDelta?: GrantShellPortDelta;
  researcherDedupeDelta?: ResearcherDedupeStageDelta;
  urlIdentityDedupeDelta?: UrlIdentityDedupeStageDelta;
  profileLinkHealthDelta?: ProfileLinkHealthStageDelta;
  deadResearchWebsiteDelta?: DeadResearchWebsiteStageDelta;
  staleScrapeRunReapDelta?: StaleScrapeRunReapStageDelta;
  inferredPiLeadReclaimDelta?: InferredPiLeadReclaimStageDelta;
}

export interface StaleScrapeRunReapStageDelta {
  running: number;
  planned: number;
  closed: number;
  changedSinceRead: number;
  keptByReason: Record<string, number>;
}

const numericField = (record: Record<string, unknown>, field: string): number => {
  const value = record[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`stale-scrape-run-reap result is missing a numeric ${field}`);
  }
  return value;
};

export function parseStaleScrapeRunReapResult(artifact: unknown): PostRunStageDelta {
  const record = artifact as Record<string, unknown> | null;
  if (!record || typeof record !== 'object' || record.mode !== 'apply') {
    throw new Error('stale-scrape-run-reap result is not an apply report');
  }
  if (record.heartbeatStaleOnly !== true || typeof record.startedBefore !== 'string') {
    throw new Error(
      'stale-scrape-run-reap result was not scoped to heartbeat-stale runs that started before the sweep',
    );
  }
  const plannedByReason = (record.plannedByReason ?? {}) as Record<string, unknown>;
  const foreignReasons = Object.keys(plannedByReason).filter(
    (reason) => reason !== 'heartbeat_stale',
  );
  if (foreignReasons.length > 0) {
    throw new Error(
      `stale-scrape-run-reap planned runs for ${foreignReasons.join(', ')}, which only an operator may close`,
    );
  }
  return {
    staleScrapeRunReapDelta: {
      running: numericField(record, 'running'),
      planned: numericField(record, 'planned'),
      closed: numericField(record, 'closed'),
      changedSinceRead: numericField(record, 'changedSinceRead'),
      keptByReason: (record.keptByReason ?? {}) as Record<string, number>,
    },
  };
}

export interface DeadResearchWebsiteStageDelta {
  plannedClears: number;
  cleared: number;
  refusalsWithdrawn: number;
  deliberatelyExcludedTotal: number;
  demotedRepairedRows: number;
  completed: boolean;
  stoppedAfter: string;
}

/**
 * The stage declares a result contract, which is what makes an unreported death loud:
 * a stage that exits successfully without a readable, valid artifact fails the sweep
 * rather than silently recording no delta. `completed` is carried through so a partial
 * run reads as partial in the sweep summary rather than as a run that found nothing.
 */
export function parseDeadResearchWebsiteResult(artifact: unknown): PostRunStageDelta {
  const record = artifact as Record<string, unknown> | null;
  if (!record || typeof record !== 'object' || record.plannedClears === undefined) {
    throw new Error('dead-research-website-clear result is missing plannedClears');
  }
  if (typeof record.completed !== 'boolean') {
    throw new Error('dead-research-website-clear result is missing a completed flag');
  }
  return {
    deadResearchWebsiteDelta: {
      plannedClears: Number(record.plannedClears ?? 0),
      cleared: Number(record.cleared ?? 0),
      refusalsWithdrawn: Number(record.refusalsWithdrawn ?? 0),
      deliberatelyExcludedTotal: Number(record.deliberatelyExcludedTotal ?? 0),
      demotedRepairedRows: Number(record.demotedRepairedRows ?? 0),
      completed: record.completed,
      stoppedAfter: String(record.stoppedAfter ?? ''),
    },
  };
}

export interface InferredPiLeadReclaimStageDelta {
  scanned: number;
  lagging: number;
  materializedLead: number;
  stillUnresolved: number;
}

export function parseInferredPiLeadReclaimResult(artifact: unknown): PostRunStageDelta {
  const record = artifact as Record<string, unknown> | null;
  if (!record || typeof record !== 'object' || record.mode !== 'apply' || record.scope !== 'all') {
    throw new Error('inferred-pi-lead-reclaim result is not an apply report over every entity');
  }
  const tally = (record.tally ?? {}) as Record<string, unknown>;
  const count = (source: Record<string, unknown>, field: string): number => {
    const value = source[field];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`inferred-pi-lead-reclaim result is missing a numeric ${field}`);
    }
    return value;
  };
  return {
    inferredPiLeadReclaimDelta: {
      scanned: count(record, 'scanned'),
      lagging: count(record, 'lagging'),
      materializedLead: count(tally, 'materialized-lead'),
      stillUnresolved: count(tally, 'still-unresolved'),
    },
  };
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

export function parseGrantShellPortResult(artifact: unknown): PostRunStageDelta {
  const record = artifact as Record<string, unknown> | null;
  const portDelta = record?.portDelta;
  if (!portDelta || typeof portDelta !== 'object' || record?.mode !== 'apply') {
    throw new Error('grant-shell-faculty-port result is missing an apply-mode portDelta object');
  }
  return { grantShellPortDelta: portDelta as GrantShellPortDelta };
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
      rosterChangedEntities: Number(record.rosterChangedEntities ?? 0),
      regatedEntities: Number(record.regatedEntities ?? 0),
      profileLinksAppended: Number(attributeUnion.profileLinksAppended ?? 0),
    },
  };
}

export function parseUrlIdentityDedupeResult(artifact: unknown): PostRunStageDelta {
  const record = artifact as Record<string, unknown> | null;
  const delta = record?.urlIdentityDedupeDelta;
  if (!delta || typeof delta !== 'object') {
    throw new Error('url-identity-dedupe result is missing a urlIdentityDedupeDelta object');
  }
  const counts = delta as Record<string, unknown>;
  for (const field of ['plannedGroups', 'appliedGroups', 'archivedEntities'] as const) {
    if (typeof counts[field] !== 'number' || !Number.isFinite(counts[field] as number)) {
      throw new Error(`url-identity-dedupe result is missing a numeric ${field}`);
    }
  }
  return { urlIdentityDedupeDelta: delta as UrlIdentityDedupeStageDelta };
}

export interface ProfileLinkHealthStageDelta {
  linksDue: number;
  attempted: number;
  probed: number;
  decisiveVerdicts: number;
  statusesWritten: number;
  hostsCompleted: number;
  hostsPlanned: number;
  linksStillDue: number;
  complete: boolean;
}

const profileLinkHealthDeltaFrom = (artifact: unknown): ProfileLinkHealthStageDelta => {
  const result = (artifact as { result?: Record<string, unknown> } | null)?.result;
  const coverage = (result as { coverage?: Record<string, unknown> } | undefined)?.coverage;
  if (!result || !coverage || typeof coverage !== 'object') {
    throw new Error('profile-link-health result is missing a coverage object');
  }
  for (const field of [
    'linksDue',
    'attempted',
    'probed',
    'hostsPlanned',
    'hostsCompleted',
  ] as const) {
    if (typeof coverage[field] !== 'number' || !Number.isFinite(coverage[field] as number)) {
      throw new Error(`profile-link-health coverage is missing a numeric ${field}`);
    }
  }
  return {
    linksDue: Number(coverage.linksDue),
    attempted: Number(coverage.attempted),
    probed: Number(coverage.probed),
    decisiveVerdicts: Number(result.decisiveVerdicts ?? 0),
    statusesWritten: Number(result.statusesWritten ?? 0),
    hostsCompleted: Number(coverage.hostsCompleted),
    hostsPlanned: Number(coverage.hostsPlanned),
    linksStillDue: Number(coverage.linksStillDue ?? 0),
    complete: coverage.complete === true,
  };
};

/**
 * A partial run must not read as a finished one.
 *
 * The verifier died four times in one night on the host carrying most of the corpus,
 * and with no parse contract the stage recorded only `failed` with no numbers, so
 * nobody could tell a run that covered 90% from one that covered nothing. Throwing on
 * an incomplete artifact is what keeps the sweep's resume from marking the stage done:
 * `reconstructDevelopmentStageDelta` swallows the throw and re-runs it, which is cheap
 * now that the staleness filter makes a re-run continue rather than start over (#3303).
 */
export function parseProfileLinkHealthResult(artifact: unknown): PostRunStageDelta {
  const delta = profileLinkHealthDeltaFrom(artifact);
  if (!delta.complete) {
    throw new Error(
      `profile-link-health stopped after ${delta.hostsCompleted} of ${delta.hostsPlanned} hosts with ${delta.linksStillDue} links still due`,
    );
  }
  return { profileLinkHealthDelta: delta };
}

/**
 * The same artifact read without the completeness contract, for the failure path.
 * A stage that died still has to say how far it got, or the sweep reports a bare
 * non-zero exit and the partial progress is invisible (#3303).
 */
export function partialProfileLinkHealthDelta(
  artifactPath: string,
): ProfileLinkHealthStageDelta | undefined {
  try {
    return profileLinkHealthDeltaFrom(JSON.parse(fs.readFileSync(artifactPath, 'utf8')));
  } catch {
    return undefined;
  }
}

// Above the corpus size (about 4,600 non-archived entities) so a sweep re-probes
// every row rather than silently truncating, while still satisfying the lane's
// requirement that apply mode names an explicit limit.
const SOURCE_LINK_HEALTH_STAGE_LIMIT = 10000;
// Above the whole `YALE_OFFICIAL` population (5,242 links on Development) so the
// stage is bounded without being a sample: a limit that truncates would leave the
// same links unverified every run, since the read order is stable.
const PROFILE_LINK_HEALTH_STAGE_LIMIT = 10000;
// Re-probe only what has aged out, which is what makes the stage resumable: the
// candidate list is otherwise the head of a stable read order, so a run that dies
// partway re-probes the same links next time and never reaches the tail. Matches
// `SOURCE_LINK_HEALTH_FRESHNESS_DAYS`, the window the entity-side lane already
// treats a stored verdict as good for, so the two halves of the served surface do
// not disagree about how old a fact may be (#3222).
const PROFILE_LINK_STALE_AFTER_DAYS = SOURCE_LINK_HEALTH_FRESHNESS_DAYS;

export const DEVELOPMENT_POST_RUN_STAGE_DEFINITIONS: PostRunStageDefinition[] = [
  {
    // First, so a later stage failing cannot skip it. It closes only a run whose heartbeat
    // went stale with no live owner process and no held source lock, and never one that
    // started during this sweep. A run that predates heartbeats has no sign of life to
    // judge, so closing it stays an operator step (#3595).
    name: 'stale-scrape-run-reap',
    command: 'scrape-runs:reconcile-stale',
    artifactName: 'development-stale-scrape-run-reap.json',
    buildArgs: (options) => [
      '--apply',
      '--confirm-reconcile-stale-scrape-runs',
      '--heartbeat-stale-only',
      '--started-before',
      options.sinceIso as string,
    ],
    isEnabled: (options) => Boolean(options.sinceIso),
    parseResult: parseStaleScrapeRunReapResult,
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
    name: 'grant-shell-faculty-port',
    command: 'research-entity:port-grant-shells-to-faculty-profiles',
    artifactName: 'development-grant-shell-faculty-port.json',
    buildArgs: () => [
      '--apply',
      '--confirm-port-grant-shells-to-faculty-profiles',
      '--max-ports',
      String(DEFAULT_GRANT_SHELL_PORT_MAX),
    ],
    isEnabled: (options) => Boolean(options.portGrantShells),
    parseResult: parseGrantShellPortResult,
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
    parseResult: parseUrlIdentityDedupeResult,
  },
  // The sibling lane above keys on a Yale `/lab/<x>` or `/profile/<x>` PATH, which
  // cannot express a lab that lives on its own domain, so a pair whose served
  // `websiteUrl` is byte-identical on a custom lab host was unreachable by every
  // unattended stage: none of the shared `websiteUrl` identity keys among served
  // rows matched the path lane's loader (#2581). This lane keys on the whole
  // normalized `websiteUrl`, so it covers exactly that gap.
  {
    name: 'website-url-identity-dedupe',
    command: 'research-entity:dedupe-by-pi',
    artifactName: 'development-website-url-identity-dedupe.json',
    buildArgs: (options) => [
      '--website-url-only',
      '--apply',
      '--confirm-research-entity-pi-dedupe',
      '--limit=10000',
      `--max-apply=${options.maxUrlIdentityMerges ?? DEFAULT_URL_IDENTITY_MERGE_MAX}`,
    ],
    isEnabled: (options) => Boolean(options.mergeUrlIdentityDuplicates),
    parseResult: parseUrlIdentityDedupeResult,
  },
  // Ordered before `visibility-gate` on purpose: the gate reads `sourceLinkHealth`
  // to decide whether a cited link still counts as a way in (#2531), so probing
  // after the gate would leave every decision one cycle stale. This is also the
  // only scheduled re-probe of research-entity links - without it a link
  // harvested alive rots indefinitely, which is how 41 served rows came to cite a
  // dead website while every scraper reported success (#2539).
  //
  // A `HEALTHY` verdict younger than the re-probe window is carried forward rather
  // than probed again; every other verdict, and every URL without one, is probed on
  // every sweep. `--full-link-health-reprobe` probes everything (#3568).
  {
    name: 'source-link-health',
    command: 'research-homes:backfill-source-link-health',
    artifactName: 'development-source-link-health.json',
    buildArgs: (options) => [
      '--apply',
      '--confirm-source-link-health',
      `--limit=${SOURCE_LINK_HEALTH_STAGE_LIMIT}`,
      ...(options.fullLinkHealthReprobe
        ? []
        : [`--reprobe-healthy-after-days=${SOURCE_LINK_HEALTH_REPROBE_HEALTHY_AFTER_DAYS}`]),
    ],
    isEnabled: () => true,
  },
  // The sibling of the stage above, for the other half of the served surface. The
  // one above re-probes RESEARCH-ENTITY links; a lead's `YALE_OFFICIAL` profile
  // link is a separate field with a separate health record, and nothing re-probed
  // it. `canonicalProfileLinkUrl` withholds a link only when its stored
  // `healthStatus` is `UNAVAILABLE`, correctly failing open on an unprobed one, so
  // the gate was reading a fact that nothing kept true: 3 served rows linked
  // students to a profile that 404s, two of them recorded HEALTHY three weeks
  // earlier, and 416 of 3,463 links had never been probed at all (#3222).
  //
  // The script only ever writes a settled verdict: a 403 or a 5xx is retried and
  // then left alone rather than recorded, so a run that draws a WAF block partway
  // through cannot un-retire a link an earlier decisive probe already judged. That
  // is what makes this safe to run unattended against a host as large as
  // medicine.yale.edu, which carries most of the corpus.
  {
    name: 'profile-link-health',
    command: 'researchers:verify-official-profile-links',
    artifactName: 'development-profile-link-health.json',
    buildArgs: () => [
      '--apply',
      '--confirm-profile-link-verification',
      `--limit=${PROFILE_LINK_HEALTH_STAGE_LIMIT}`,
      `--stale-after-days=${PROFILE_LINK_STALE_AFTER_DAYS}`,
    ],
    isEnabled: () => true,
    parseResult: parseProfileLinkHealthResult,
  },
  // Ordered after both link-health probes on purpose: this pass CONSUMES their verdicts,
  // so its reach is bounded by theirs. A url nothing has probed is not known dead, and a
  // verdict that arrives after this stage runs is cleared on the next sweep rather than
  // this one. That is why the count never settles at zero, and why it is scheduled rather
  // than run once (#3309).
  //
  // The profile verifier cannot currently finish its largest host, so the ceiling on this
  // stage is that verifier's coverage rather than anything here (#3303).
  {
    name: 'dead-research-website-clear',
    command: 'research-entity:clear-dead-research-websites',
    artifactName: 'development-dead-research-website-clear.json',
    buildArgs: () => ['--apply', '--confirm-clear-dead-research-websites'],
    isEnabled: () => true,
    parseResult: parseDeadResearchWebsiteResult,
  },
  {
    // Ordered with the other clear stage and ahead of the gate. It is safe to run every
    // sweep because it is idempotent by construction rather than by a marker: it skips a
    // row whose value is already in `fieldValueRefusals`, so a second run plans nothing
    // because the corpus is clean. Measured immediately after its first apply: 5 rows
    // repaired, then 0 planned (#3484).
    //
    // This is the stage that makes the correction stop being a one-off. The lane's
    // decision is relational - does another row, whose name denotes an organization, own
    // this same resolved page - so it cannot become a per-URL refusal arm the way the
    // four scripts in #3469 could, and a pass over rows is the only shape it can take.
    // Registering that pass here is the difference between a repair someone must remember
    // and engine behaviour that runs on every sweep.
    name: 'organization-identity-website-retire',
    command: 'observations:retire-organization-identity-websites',
    artifactName: 'development-organization-identity-website-retire.json',
    buildArgs: () => ['--apply', '--confirm-retire-organization-identity-websites'],
    isEnabled: () => true,
  },
  {
    // Relational like the stage above: whether a roster website is a group site depends on
    // which other people the lane gave it to. Ordered before `refusal-lane-attribution` so
    // the refusals it records are attributed the same sweep, and it plans nothing once the
    // lane's shared claims are retired (#3615).
    name: 'shared-roster-website-retire',
    command: 'observations:retire-shared-roster-websites',
    artifactName: 'development-shared-roster-website-retire.json',
    buildArgs: () => ['--apply', '--confirm-retire-shared-roster-websites'],
    isEnabled: () => true,
  },
  {
    // After every stage that records a refusal, so a refusal written this sweep is
    // attributed this sweep. It writes only the derived `attributedSourceNames` on a
    // refusal, never a field a student sees, and plans nothing once the corpus is
    // attributed (#3521).
    name: 'refusal-lane-attribution',
    command: 'refusals:attribute-lanes',
    artifactName: 'development-refusal-lane-attribution.json',
    buildArgs: () => ['--apply', '--confirm-attribute-refusal-lanes'],
    isEnabled: () => true,
  },
  {
    // Ordered before `visibility-gate` so the gate judges the leads this writes in the same
    // sweep. The materializer links an inferred PI only for rows a run re-observes, so a row
    // whose PI key became resolvable after its last materialize stays leadless until this
    // pass revisits every row whose evidence names a PI the gate does not yet accept (#3741).
    name: 'inferred-pi-lead-reclaim',
    command: 'data:materialize-inferred-pi-leads',
    artifactName: 'development-inferred-pi-lead-reclaim.json',
    buildArgs: () => ['--all', '--apply'],
    isEnabled: () => true,
    parseResult: parseInferredPiLeadReclaimResult,
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
    // Replays each lane against its frozen benchmark, so the stored trend moves only when
    // lane code does. It reads benchmark pages and never the network, and writes a
    // `lane_scorecard_snapshots` row plus one `invalidated` scrape run per replay, so no
    // health, freshness, or barren-streak reader mistakes a replay for a live run (#3526).
    name: 'lane-scorecard',
    command: 'lane:scorecard',
    artifactName: 'development-lane-scorecard.json',
    buildArgs: () => ['--apply', '--confirm-lane-scorecard'],
    isEnabled: () => true,
  },
  {
    // Replays resolve, derive and gate against the frozen engine benchmark, so the stored
    // trend moves only when engine code does (#3589). Deliberately does not pass
    // `--capture`: a sweep that re-froze the input every run would compare each run against
    // itself and could never show a regression. Capture is an operator step.
    name: 'engine-benchmark',
    command: 'engine:benchmark',
    artifactName: 'development-engine-benchmark.json',
    buildArgs: () => ['--apply', '--confirm-engine-benchmark', '--replays=2'],
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
  const clock = ctx?.now ?? (() => new Date());
  const postRunStartedAt = clock();
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
    const stageStartedAt = clock();
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
    if (error && planned.name === 'profile-link-health') {
      const partial = partialProfileLinkHealthDelta(planned.artifactPath);
      if (partial) {
        delta = { profileLinkHealthDelta: partial };
        console.error(
          `[post-run] profile-link-health covered ${partial.probed} of ${partial.attempted} links across ${partial.hostsCompleted} of ${partial.hostsPlanned} hosts; ${partial.linksStillDue} still due`,
        );
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
      ...sweepStepTiming(stageStartedAt, clock()),
      ...(error ? { error } : {}),
      ...delta,
    });
  }
  return {
    status: stages.some((stage) => stage.status === 'failed') ? 'failed' : 'succeeded',
    stages,
    ...sweepStepTiming(postRunStartedAt, clock()),
  };
}

export const SCRAPER_SWEEP_APPLY_OFFICIAL_SOURCE_CHANGE_SET_ENV =
  'SCRAPER_SWEEP_APPLY_OFFICIAL_SOURCE_CHANGE_SET';

const DEFAULT_FELLOWSHIP_POST_RUN_APPLY_LIMIT = 10000;

export function resolveFellowshipPostRunOptions(
  mode: ScraperSweepMode,
  env: NodeJS.ProcessEnv,
): FellowshipPostRunStageOptions | undefined {
  if (!isFellowshipSweepMode(mode)) return undefined;
  return {
    applyOfficialSourceChangeSet: isSweepStageOptedIn(
      env[SCRAPER_SWEEP_APPLY_OFFICIAL_SOURCE_CHANGE_SET_ENV],
    ),
  };
}

interface FellowshipPostRunStageDefinition {
  name: FellowshipPostRunStage['name'];
  command: string;
  artifactName: string;
  buildArgs: (options: FellowshipPostRunStageOptions) => string[];
  isEnabled: (options: FellowshipPostRunStageOptions) => boolean;
  appendsOutputArtifact: boolean;
}

function fellowshipApplyLimit(options: FellowshipPostRunStageOptions): number {
  return options.applyLimit ?? DEFAULT_FELLOWSHIP_POST_RUN_APPLY_LIMIT;
}

export const FELLOWSHIP_POST_RUN_STAGE_DEFINITIONS: FellowshipPostRunStageDefinition[] = [
  {
    name: 'program-visibility-gate',
    command: 'student-visibility:gate',
    artifactName: 'fellowship-program-visibility-gate.json',
    buildArgs: (options) => [
      '--collection=programs',
      '--apply',
      '--confirm-student-visibility-apply',
      `--max-apply=${fellowshipApplyLimit(options)}`,
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
  const clock = ctx?.now ?? (() => new Date());
  const postRunStartedAt = clock();
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
    const stageStartedAt = clock();
    const logPath = planned.artifactPath
      ? `${planned.artifactPath}.log`
      : path.join(outputDirectory, `fellowship-${planned.name}.log`);
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
      ...sweepStepTiming(stageStartedAt, clock()),
      ...(error ? { error } : {}),
    });
  }
  return {
    status: stages.some((stage) => stage.status === 'failed') ? 'failed' : 'succeeded',
    stages,
    ...sweepStepTiming(postRunStartedAt, clock()),
  };
}

export async function runScraperSweep(
  options: ScraperSweepCliOptions,
  dependencies: {
    childRunner?: ChildRunner;
    readHeadSha?: (repoRoot: string) => string | null;
    now?: () => Date;
    sweepSources?: ScraperSweepSource[];
  } = {},
): Promise<ScraperSweepSummary> {
  const config = MODE_CONFIG[options.mode];
  validateScraperSweepEnvironment(options.mode);
  declareMaterializationReadScopeForChildren();
  const registeredNames = buildOrchestrator()
    .list()
    .map((source) => source.name);
  validateScraperSweepManifest(registeredNames);
  await validateScraperSweepDatabasePreflight(registeredNames);

  const now = dependencies.now || (() => new Date());
  const startedAt = now();
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const checkpointPath = checkpointPathForMode(options.mode, os.tmpdir(), repoRoot);
  const readHeadSha = dependencies.readHeadSha || defaultHeadShaReader;
  const { store, resumed } = SweepCheckpointStore.start({
    mode: options.mode,
    flags: sweepCheckpointFlagSignature(options),
    codeSha: sweepCodeIdentityFrom(readHeadSha(repoRoot)),
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
  const sweepCodeSha = store.codeSha;
  console.log(
    sweepCodeSha
      ? `Sweep code: ${sweepCodeSha} (the checkout's HEAD, which is what every stage runs)`
      : 'Sweep code: the checkout did not report a commit, so stage results are not attributable to one',
  );
  const spawnStageChild = dependencies.childRunner || spawnChild;
  // Wrapped at the single injection point so every stage is covered: sources, both post-run
  // paths, and the between-phase prune all spawn through this one function.
  const childRunner: ChildRunner = async (command, args, childOptions) => {
    const stageLabel = `${command} ${args.join(' ')}`.slice(0, 120);
    const refusal = planSweepCodeDriftRefusal({
      stage: stageLabel,
      startedSha: sweepCodeSha,
      currentSha: sweepCodeIdentityFrom(readHeadSha(repoRoot)),
    });
    if (!refusal) return spawnStageChild(command, args, childOptions);
    // Fails closed and does no work, which is what keeps the run resumable: the stage is recorded
    // failed, so a resume re-runs it once the checkout is back at the commit the run started on.
    store.recordCodeDrift(refusal, now());
    console.error(`[sweep-code] ${refusal.message}`);
    return { status: 1, error: new Error(refusal.message) };
  };
  const sweepSources = dependencies.sweepSources || sweepSourcesForMode(options.mode);
  const rows = new Array<ScraperSweepRunRow>(sweepSources.length);

  if (resumed && sweepSources.some((source) => !store.isDone(sourceStepId(source.name)))) {
    const invalidated = store.clearStageSteps(startedAt);
    if (invalidated.length > 0) {
      console.log(
        `Re-running ${invalidated.length} post-run stage(s) because at least one source still has to run: ${invalidated.join(', ')}`,
      );
    }
  }

  const pageReuse = isSweepPageReuseEnabled(options);
  const hostSlotBroker = await startSweepHostSlotBroker(process.env, sweepHostSlotBrokerPath(), {
    pageReuse,
  });
  console.log(
    pageReuse
      ? `Page reuse within this sweep: on for ${SWEEP_PAGE_REUSE_HOSTS.join(', ')}, held in memory up to ${formatMebibytes(resolveSweepPageReuseMaxBytes())} and discarded when the sweep ends (disable with --no-page-reuse)`
      : 'Page reuse within this sweep: off',
  );

  if (isSweepPreflightEnabled(options)) {
    const pendingSources = sweepSources
      .map((source) => source.name)
      .filter((name) => !store.isDone(sourceStepId(name)));
    console.log(
      `Running sweep preflight: storage headroom plus a write-free canary for ${pendingSources.length} source(s) (skip with --skip-preflight)`,
    );
    const preflight = await runSweepPreflight({
      mongoUrl: process.env.MONGODBURL || '',
      sourceNames: pendingSources,
      outputDirectory,
      repoRoot,
      childRunner,
      forceLlm: options.forceLlm,
      env: { ...process.env, [SCRAPER_HOST_SLOT_BROKER_ENV]: hostSlotBroker.socketPath },
      now,
    }).catch(async (error: unknown) => {
      await hostSlotBroker.close();
      throw error;
    });
    console.log(formatSweepPreflightReport(preflight));
    if (preflight.status === 'failed') {
      await hostSlotBroker.close();
      throw new Error(
        `sweep preflight failed before any source ran (${preflight.failures.length} failure(s)); report at ${path.join(outputDirectory, 'preflight.json')}`,
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
    return {
      sourceName: source.name,
      phase: source.phase,
      status: 'succeeded',
      artifactPath,
      ...artifact,
    };
  };

  const runSource = async (
    source: ScraperSweepSource,
    index: number,
    phaseConcurrency: number,
  ): Promise<void> => {
    const artifactPath = artifactPathFor(source, index);
    const stepId = sourceStepId(source.name);
    if (store.isDone(stepId)) {
      const resumedRow = succeededRowFromArtifact(
        source,
        store.recordedArtifactPath(stepId) || artifactPath,
      );
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
    const logPath = `${artifactPath}.log`;
    console.log(
      `\n[${index + 1}/${sweepSources.length}] ${source.phase}: ${source.name} (logs -> ${logPath})`,
    );
    const sourceStartedAt = now();
    store.markRunning(stepId, 'source', sourceStartedAt);
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
          [SCRAPER_HOST_SLOT_BROKER_ENV]: hostSlotBroker.socketPath,
          [SCRAPER_SWEEP_PAGE_REUSE_ENV]: pageReuse ? '1' : '0',
        },
        logPath,
      },
    );
    const exitCode = child.status ?? 1;
    const sourceTiming = sweepStepTiming(sourceStartedAt, now());
    const failStep = (error: string): void => {
      store.markFailed(stepId, 'source', exitCode, now());
      logger.logFailed(stepId, exitCode, logPath);
      rows[index] = {
        sourceName: source.name,
        phase: source.phase,
        status: 'failed',
        artifactPath,
        exitCode,
        ...sourceTiming,
        error,
      };
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
      rows[index] = {
        sourceName: source.name,
        phase: source.phase,
        status: 'succeeded',
        artifactPath,
        exitCode,
        ...sourceTiming,
        ...artifact,
      };
      store.markDone(stepId, 'source', exitCode, now(), artifactPath);
      logger.logDone(stepId, exitCode);
    } catch (error) {
      failStep(sanitizeLogValue(error));
    }
  };

  const runBetweenPhasesPrune = async (phase: ScraperSweepPhase): Promise<void> => {
    if (!options.pruneBetweenPhases || !isDeadObservationPruneSweepMode(options.mode)) {
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
  const phases: SweepPhaseTiming[] = [];
  let pageReuseSummary: SweepPageReuseSummary | undefined;
  try {
    for (const phase of orderedScraperSweepPhases(sweepSources)) {
      const phaseStartedAt = now();
      const phaseEntries = globalEntries.filter((entry) => entry.source.phase === phase);
      const phaseConcurrency = resolvePhaseConcurrency(options.mode, phase, options.concurrency);
      await runWithBoundedConcurrency(phaseEntries, phaseConcurrency, ({ source, index }) =>
        runSource(source, index, phaseConcurrency),
      );
      await runBetweenPhasesPrune(phase);
      phases.push({ phase, ...sweepStepTiming(phaseStartedAt, now()) });
    }
  } finally {
    pageReuseSummary = sweepPageReuseSummary(hostSlotBroker);
    await hostSlotBroker.close();
  }
  console.log(formatSweepPageReuseSummary(pageReuseSummary));

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
  if (developmentPostRunOptions && options.fullLinkHealthReprobe) {
    developmentPostRunOptions.fullLinkHealthReprobe = true;
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
  const producedNothingSources = sourcesThatProducedNothing(rows);
  const summary: ScraperSweepSummary = {
    mode: options.mode,
    environment: config.environment,
    database: config.database,
    startedAt: startedAt.toISOString(),
    finishedAt: now().toISOString(),
    outputDirectory,
    codeSha: sweepCodeSha,
    ...(store.codeDrift.length > 0 ? { codeDrift: store.codeDrift } : {}),
    sourceCount: rows.length,
    succeeded: rows.filter((row) => row.status === 'succeeded').length,
    failed: rows.filter((row) => row.status === 'failed').length,
    notRun: rows.filter((row) => row.status === 'not-run').length,
    producedNothing: producedNothingSources.length,
    producedNothingSources,
    throttleRetry: sweepThrottleRetrySummary(rows),
    rows,
    phases,
    ...(pageReuseSummary ? { pageReuse: pageReuseSummary } : {}),
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
        producedNothing: summary.producedNothing,
        ...(summary.producedNothing > 0
          ? { producedNothingSources: summary.producedNothingSources }
          : {}),
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

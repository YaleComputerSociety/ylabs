/**
 * Guarded operator workflow for canonical MongoDB validators.
 *
 * Dry-run is the default.
 * Apply requires a reviewed dry-run artifact and an explicit confirmation flag.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';
import { summarizeMongoUrl } from '../scrapers/scraperEnvironment';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  buildCanonicalMongoValidatorRollbackPlan,
  canonicalMongoValidatorFingerprint,
  canonicalMongoValidatorValuesEqual,
  planCanonicalMongoValidators,
  type CanonicalMongoValidatorPlanItem,
  type CanonicalMongoValidatorRollbackItem,
  type CurrentMongoCollectionValidation,
} from './canonicalMongoValidatorsCore';
import {
  CANONICAL_MONGO_VALIDATORS,
  CANONICAL_MONGO_VALIDATOR_COLLECTIONS,
} from './canonicalMongoValidatorRegistry';
import {
  assertOperatorEnvironmentMatchesDatabase,
  databaseNameFromMongoUrl,
  parseOperatorDatabaseEnvironment,
  type OperatorDatabaseEnvironment,
} from './operatorDatabaseEnvironment';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const CANONICAL_MONGO_VALIDATOR_REPORT_VERSION = 1 as const;
export const CONFIRM_CANONICAL_VALIDATOR_APPLY_FLAG =
  '--confirm-canonical-validator-apply' as const;

interface MongoCollectionInfo {
  name: string;
  type?: string;
  options?: {
    validator?: unknown;
    validationLevel?: unknown;
    validationAction?: unknown;
    timeseries?: unknown;
  };
}

interface ValidatorMongoDb {
  databaseName: string;
  listCollections(
    filter?: Record<string, unknown>,
    options?: { nameOnly?: boolean },
  ): {
    toArray(): Promise<MongoCollectionInfo[]>;
  };
  command(command: Record<string, unknown>): Promise<unknown>;
}

export interface ValidatorMongoClient {
  connect(): Promise<unknown>;
  db(): ValidatorMongoDb;
  close(): Promise<void>;
}

export interface CanonicalMongoValidatorArgs {
  environment: OperatorDatabaseEnvironment;
  apply: boolean;
  confirmEnvironment?: OperatorDatabaseEnvironment;
  applyFrom?: string;
  output?: string;
}

export interface CanonicalMongoValidatorSummary {
  desiredCollections: number;
  createCollection: number;
  collMod: number;
  noop: number;
  writesPlanned: number;
}

export interface CanonicalMongoValidatorReport {
  reportVersion: typeof CANONICAL_MONGO_VALIDATOR_REPORT_VERSION;
  mode: 'dry-run' | 'apply';
  environment: OperatorDatabaseEnvironment;
  databaseName: string;
  target: string;
  desiredCollections: readonly string[];
  summary: CanonicalMongoValidatorSummary;
  currentCollections: CurrentMongoCollectionValidation[];
  plan: CanonicalMongoValidatorPlanItem[];
  rollbackPlan: CanonicalMongoValidatorRollbackItem[];
  planFingerprint: string;
  applied?: Array<{
    collectionName: string;
    action: Exclude<CanonicalMongoValidatorPlanItem['action'], 'noop'>;
  }>;
  postApplyPlan?: CanonicalMongoValidatorPlanItem[];
}

export class CanonicalMongoValidatorApplyError extends Error {
  readonly appliedCollections: readonly string[];
  readonly failedCollection: string;
  readonly failureReason: string;
  readonly unattemptedCollections: readonly string[];

  constructor(args: {
    appliedCollections: readonly string[];
    failedCollection: string;
    failureReason: string;
    unattemptedCollections: readonly string[];
  }) {
    super(
      `Canonical validator apply stopped at ${args.failedCollection}: ${args.failureReason}. Applied: ${
        args.appliedCollections.join(', ') || '(none)'
      }. Unattempted: ${args.unattemptedCollections.join(', ') || '(none)'}. Generate a fresh dry-run before retrying.`,
    );
    this.name = 'CanonicalMongoValidatorApplyError';
    this.appliedCollections = [...args.appliedCollections];
    this.failedCollection = args.failedCollection;
    this.failureReason = args.failureReason;
    this.unattemptedCollections = [...args.unattemptedCollections];
  }
}

export class CanonicalMongoValidatorVerificationError extends Error {
  readonly appliedCollections: readonly string[];
  readonly remainingCollections: readonly string[];

  constructor(args: {
    appliedCollections: readonly string[];
    failureReason: string;
    remainingCollections?: readonly string[];
  }) {
    const remainingCollections = args.remainingCollections ?? [];
    super(
      `Canonical validator post-apply verification failed: ${args.failureReason}. Applied commands: ${
        args.appliedCollections.join(', ') || '(none)'
      }. Remaining drift: ${
        remainingCollections.join(', ') || '(unknown)'
      }. Inspect the connected database and generate a fresh dry-run before any retry.`,
    );
    this.name = 'CanonicalMongoValidatorVerificationError';
    this.appliedCollections = [...args.appliedCollections];
    this.remainingCollections = [...remainingCollections];
  }
}

function requireFlagValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1]?.trim();
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function parseCanonicalMongoValidatorArgs(argv: string[]): CanonicalMongoValidatorArgs {
  let environment: OperatorDatabaseEnvironment | undefined;
  let apply = false;
  let confirmEnvironment: OperatorDatabaseEnvironment | undefined;
  let applyFrom: string | undefined;
  let output: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--environment') {
      environment = parseOperatorDatabaseEnvironment(
        requireFlagValue(argv, index, '--environment'),
      );
      index += 1;
    } else if (arg.startsWith('--environment=')) {
      environment = parseOperatorDatabaseEnvironment(arg.slice('--environment='.length));
    } else if (arg === '--apply') {
      apply = true;
    } else if (arg === CONFIRM_CANONICAL_VALIDATOR_APPLY_FLAG) {
      confirmEnvironment = parseOperatorDatabaseEnvironment(
        requireFlagValue(argv, index, CONFIRM_CANONICAL_VALIDATOR_APPLY_FLAG),
        CONFIRM_CANONICAL_VALIDATOR_APPLY_FLAG,
      );
      index += 1;
    } else if (arg.startsWith(`${CONFIRM_CANONICAL_VALIDATOR_APPLY_FLAG}=`)) {
      confirmEnvironment = parseOperatorDatabaseEnvironment(
        arg.slice(`${CONFIRM_CANONICAL_VALIDATOR_APPLY_FLAG}=`.length),
        CONFIRM_CANONICAL_VALIDATOR_APPLY_FLAG,
      );
    } else if (arg === '--apply-from') {
      applyFrom = requireFlagValue(argv, index, '--apply-from');
      index += 1;
    } else if (arg.startsWith('--apply-from=')) {
      applyFrom = arg.slice('--apply-from='.length).trim();
      if (!applyFrom) throw new Error('--apply-from requires a value');
    } else if (arg === '--output') {
      output = requireFlagValue(argv, index, '--output');
      index += 1;
    } else if (arg.startsWith('--output=')) {
      output = arg.slice('--output='.length).trim();
      if (!output) throw new Error('--output requires a value');
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!environment) {
    throw new Error('--environment is required');
  }

  return {
    environment,
    apply,
    ...(confirmEnvironment ? { confirmEnvironment } : {}),
    ...(applyFrom ? { applyFrom } : {}),
    ...(output ? { output } : {}),
  };
}

export function assertCanonicalMongoValidatorApplyAllowed(
  args: CanonicalMongoValidatorArgs,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!args.apply && (args.confirmEnvironment || args.applyFrom)) {
    throw new Error(`${CONFIRM_CANONICAL_VALIDATOR_APPLY_FLAG} and --apply-from require --apply.`);
  }
  if (args.apply && !args.confirmEnvironment) {
    throw new Error(`${CONFIRM_CANONICAL_VALIDATOR_APPLY_FLAG} is required when --apply is set.`);
  }
  if (args.apply && args.confirmEnvironment !== args.environment) {
    throw new Error(
      `${CONFIRM_CANONICAL_VALIDATOR_APPLY_FLAG} must match --environment ${args.environment}.`,
    );
  }
  if (args.apply && !args.applyFrom) {
    throw new Error('--apply-from is required when --apply is set.');
  }
  if (
    args.apply &&
    args.environment === 'production' &&
    env.CONFIRM_PROD_MONGO_VALIDATORS !== 'true'
  ) {
    throw new Error(
      'Production validator writes require CONFIRM_PROD_MONGO_VALIDATORS=true in the environment.',
    );
  }
}

export async function readCurrentCanonicalMongoValidators(
  db: ValidatorMongoDb,
): Promise<CurrentMongoCollectionValidation[]> {
  const desiredNames = new Set(CANONICAL_MONGO_VALIDATOR_COLLECTIONS);
  const infos = await db.listCollections({}, { nameOnly: false }).toArray();
  const infosByName = new Map<string, MongoCollectionInfo>();

  for (const info of infos) {
    if (!desiredNames.has(info.name)) continue;
    if (infosByName.has(info.name)) {
      throw new Error(`MongoDB returned duplicate collection metadata for ${info.name}.`);
    }
    if (info.type !== 'collection' || info.options?.timeseries !== undefined) {
      const collectionType =
        info.options?.timeseries !== undefined
          ? 'time-series collection'
          : (info.type ?? 'unknown');
      throw new Error(
        `Canonical validator target ${info.name} is a ${collectionType}, not a standard collection.`,
      );
    }
    infosByName.set(info.name, info);
  }

  return CANONICAL_MONGO_VALIDATOR_COLLECTIONS.map((collectionName) => {
    const info = infosByName.get(collectionName);
    if (!info) {
      return { collectionName, exists: false };
    }
    const options = info.options ?? {};
    return {
      collectionName,
      exists: true,
      ...(Object.hasOwn(options, 'validator')
        ? { validator: structuredClone(options.validator) }
        : {}),
      ...(Object.hasOwn(options, 'validationLevel')
        ? { validationLevel: options.validationLevel }
        : {}),
      ...(Object.hasOwn(options, 'validationAction')
        ? { validationAction: options.validationAction }
        : {}),
    };
  });
}

function summarizePlan(
  plan: readonly CanonicalMongoValidatorPlanItem[],
): CanonicalMongoValidatorSummary {
  const createCollection = plan.filter((item) => item.action === 'createCollection').length;
  const collMod = plan.filter((item) => item.action === 'collMod').length;
  const noop = plan.filter((item) => item.action === 'noop').length;
  return {
    desiredCollections: plan.length,
    createCollection,
    collMod,
    noop,
    writesPlanned: createCollection + collMod,
  };
}

function fingerprintInput(report: {
  reportVersion: number;
  environment: OperatorDatabaseEnvironment;
  databaseName: string;
  target: string;
  desiredCollections: readonly string[];
  summary: unknown;
  currentCollections: unknown;
  plan: unknown;
  rollbackPlan: unknown;
}): object {
  return {
    reportVersion: report.reportVersion,
    environment: report.environment,
    databaseName: report.databaseName,
    target: report.target,
    desiredCollections: report.desiredCollections,
    summary: report.summary,
    currentCollections: report.currentCollections,
    plan: report.plan,
    rollbackPlan: report.rollbackPlan,
  };
}

function buildReport(args: {
  mode: CanonicalMongoValidatorReport['mode'];
  environment: OperatorDatabaseEnvironment;
  databaseName: string;
  target: string;
  currentCollections: CurrentMongoCollectionValidation[];
}): CanonicalMongoValidatorReport {
  const plan = planCanonicalMongoValidators(CANONICAL_MONGO_VALIDATORS, args.currentCollections);
  const rollbackPlan = buildCanonicalMongoValidatorRollbackPlan(plan, args.currentCollections);
  const reportWithoutFingerprint = {
    reportVersion: CANONICAL_MONGO_VALIDATOR_REPORT_VERSION,
    mode: args.mode,
    environment: args.environment,
    databaseName: args.databaseName,
    target: args.target,
    desiredCollections: CANONICAL_MONGO_VALIDATOR_COLLECTIONS,
    summary: summarizePlan(plan),
    currentCollections: args.currentCollections,
    plan,
    rollbackPlan,
  };

  return {
    ...reportWithoutFingerprint,
    planFingerprint: canonicalMongoValidatorFingerprint(fingerprintInput(reportWithoutFingerprint)),
  };
}

export function assertReviewedCanonicalMongoValidatorPlan(
  reviewed: unknown,
  current: CanonicalMongoValidatorReport,
): void {
  if (!reviewed || typeof reviewed !== 'object' || Array.isArray(reviewed)) {
    throw new Error('--apply-from must contain a canonical validator dry-run report.');
  }
  const artifact = reviewed as Partial<CanonicalMongoValidatorReport>;
  if (artifact.mode !== 'dry-run') {
    throw new Error('--apply-from must reference a dry-run report.');
  }

  const artifactFingerprint = canonicalMongoValidatorFingerprint(
    fingerprintInput({
      reportVersion: artifact.reportVersion ?? 0,
      environment: artifact.environment ?? current.environment,
      databaseName: artifact.databaseName ?? '',
      target: artifact.target ?? '',
      desiredCollections: artifact.desiredCollections ?? [],
      summary: artifact.summary,
      currentCollections: artifact.currentCollections,
      plan: artifact.plan,
      rollbackPlan: artifact.rollbackPlan,
    }),
  );
  if (artifact.planFingerprint !== artifactFingerprint) {
    throw new Error('The reviewed validator artifact fingerprint is invalid.');
  }
  if (
    artifact.planFingerprint !== current.planFingerprint ||
    !canonicalMongoValidatorValuesEqual(
      fingerprintInput(artifact as CanonicalMongoValidatorReport),
      fingerprintInput(current),
    )
  ) {
    throw new Error(
      'The connected database validator state drifted after the reviewed dry-run. Generate and review a new plan.',
    );
  }
}

export async function runCanonicalMongoValidators(
  args: CanonicalMongoValidatorArgs,
  mongoUrl: string,
  options: {
    client?: ValidatorMongoClient;
    reviewedArtifact?: unknown;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<CanonicalMongoValidatorReport> {
  assertCanonicalMongoValidatorApplyAllowed(args, options.env);
  const configuredDatabaseName = databaseNameFromMongoUrl(mongoUrl);
  assertOperatorEnvironmentMatchesDatabase(args.environment, configuredDatabaseName);

  const client = options.client ?? (new MongoClient(mongoUrl) as unknown as ValidatorMongoClient);
  let primaryError: unknown;
  let failed = false;
  try {
    await client.connect();
    const db = client.db();
    assertOperatorEnvironmentMatchesDatabase(args.environment, db.databaseName);

    const currentCollections = await readCurrentCanonicalMongoValidators(db);
    const currentReport = buildReport({
      mode: args.apply ? 'apply' : 'dry-run',
      environment: args.environment,
      databaseName: db.databaseName,
      target: summarizeMongoUrl(mongoUrl),
      currentCollections,
    });

    if (!args.apply) return currentReport;

    assertReviewedCanonicalMongoValidatorPlan(options.reviewedArtifact, {
      ...currentReport,
      mode: 'dry-run',
    });

    const applied: NonNullable<CanonicalMongoValidatorReport['applied']> = [];
    const writePlan = currentReport.plan.filter(
      (
        item,
      ): item is CanonicalMongoValidatorPlanItem & {
        action: 'createCollection' | 'collMod';
      } => item.action !== 'noop',
    );
    for (const [index, item] of writePlan.entries()) {
      if (!item.command) {
        throw new Error(`Missing MongoDB command for ${item.collectionName}.`);
      }
      try {
        await db.command(structuredClone(item.command));
      } catch (error) {
        throw new CanonicalMongoValidatorApplyError({
          appliedCollections: applied.map(({ collectionName }) => collectionName),
          failedCollection: item.collectionName,
          failureReason: sanitizeLogValue(error instanceof Error ? error.message : error),
          unattemptedCollections: writePlan
            .slice(index + 1)
            .map(({ collectionName }) => collectionName),
        });
      }
      applied.push({
        collectionName: item.collectionName,
        action: item.action,
      });
    }

    let postApplyCurrent: CurrentMongoCollectionValidation[];
    try {
      postApplyCurrent = await readCurrentCanonicalMongoValidators(db);
    } catch (error) {
      throw new CanonicalMongoValidatorVerificationError({
        appliedCollections: applied.map(({ collectionName }) => collectionName),
        failureReason: sanitizeLogValue(error instanceof Error ? error.message : error),
      });
    }
    const postApplyPlan = planCanonicalMongoValidators(
      CANONICAL_MONGO_VALIDATORS,
      postApplyCurrent,
    );
    const remainingWrites = postApplyPlan.filter((item) => item.action !== 'noop');
    if (remainingWrites.length > 0) {
      throw new CanonicalMongoValidatorVerificationError({
        appliedCollections: applied.map(({ collectionName }) => collectionName),
        failureReason: `MongoDB still reports ${remainingWrites.length} validator write plan(s)`,
        remainingCollections: remainingWrites.map(({ collectionName }) => collectionName),
      });
    }

    return {
      ...currentReport,
      mode: 'apply',
      applied,
      postApplyPlan,
    };
  } catch (error) {
    failed = true;
    primaryError = error;
    throw error;
  } finally {
    try {
      await client.close();
    } catch (closeError) {
      if (!failed) throw closeError;

      const closeFailureReason = sanitizeLogValue(
        closeError instanceof Error ? closeError.message : closeError,
      );
      if (primaryError instanceof Error) {
        primaryError.message = `${primaryError.message}. MongoDB client cleanup also failed: ${closeFailureReason}`;
      } else {
        throw new AggregateError(
          [primaryError, closeError],
          `Canonical MongoDB validator operation and client cleanup both failed: ${closeFailureReason}`,
        );
      }
    }
  }
}

export function readCanonicalMongoValidatorArtifact(target: string): unknown {
  const safeTarget = resolveSafeJsonReportOutputPath(target, '--apply-from');
  return JSON.parse(fs.readFileSync(safeTarget, 'utf8')) as unknown;
}

export function writeCanonicalMongoValidatorReport(
  report: CanonicalMongoValidatorReport,
  target: string | undefined,
): void {
  if (!target) return;
  const safeTarget = resolveSafeJsonReportOutputPath(target);
  fs.writeFileSync(safeTarget, `${JSON.stringify(report, null, 2)}\n`);
}

function pathsReferToSameFile(left: string, right: string): boolean {
  const resolvedLeft = path.resolve(left);
  const resolvedRight = path.resolve(right);
  if (resolvedLeft === resolvedRight) return true;

  try {
    return fs.realpathSync(resolvedLeft) === fs.realpathSync(resolvedRight);
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const args = parseCanonicalMongoValidatorArgs(process.argv.slice(2));
  if (args.output) {
    resolveSafeJsonReportOutputPath(args.output);
  }
  if (args.applyFrom) {
    resolveSafeJsonReportOutputPath(args.applyFrom, '--apply-from');
  }
  if (args.applyFrom && args.output && pathsReferToSameFile(args.applyFrom, args.output)) {
    throw new Error('--output must not overwrite the reviewed --apply-from artifact.');
  }

  const mongoUrl = process.env.MONGODBURL;
  if (!mongoUrl) {
    throw new Error('MONGODBURL is required');
  }
  const reviewedArtifact = args.applyFrom
    ? readCanonicalMongoValidatorArtifact(args.applyFrom)
    : undefined;
  const report = await runCanonicalMongoValidators(args, mongoUrl, {
    reviewedArtifact,
  });
  console.log(JSON.stringify(report, null, 2));
  writeCanonicalMongoValidatorReport(report, args.output);
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error));
    process.exitCode = 1;
  });
}

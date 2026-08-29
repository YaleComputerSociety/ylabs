import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { Observation } from '../models/observation';
import {
  canonicalFingerprint,
  selectRetainedObservation,
  type NormalizableObservation,
} from '../scrapers/observationFingerprintNormalization';
import {
  LATEST_WINS_FINGERPRINT_FIELDS,
  QUALITY_GUARDED_PROSE_FIELDS,
} from '../scrapers/observationStore';
import { resolveMongoDatabaseName, summarizeMongoUrl } from '../scrapers/scraperEnvironment';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

dotenv.config();

const SCRIPT_NAME = 'observations:normalize-fingerprints';
const BATCH_SIZE = 1000;

export interface NormalizeFingerprintsArgs {
  apply: boolean;
  confirm: boolean;
  collapseProse: boolean;
  field?: string;
  sourceName?: string;
  output?: string;
}

export function parseNormalizeFingerprintsArgs(argv: string[]): NormalizeFingerprintsArgs {
  const args: NormalizeFingerprintsArgs = { apply: false, confirm: false, collapseProse: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') args.apply = true;
    else if (arg === '--confirm-fingerprint-normalization') args.confirm = true;
    else if (arg === '--collapse-prose') args.collapseProse = true;
    else if (arg === '--dry-run') args.apply = false;
    else if (arg.startsWith('--field=')) args.field = arg.slice('--field='.length).trim();
    else if (arg.startsWith('--source=')) args.sourceName = arg.slice('--source='.length).trim();
    else if (arg.startsWith('--output=')) args.output = arg.slice('--output='.length).trim();
    else if (arg === '--output') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--output requires a path');
      args.output = value.trim();
      index += 1;
    } else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  if (args.field === '') throw new Error('--field requires a field name');
  if (args.sourceName === '') throw new Error('--source requires a source name');
  return args;
}

// This rewrites and supersedes existing rows rather than appending, so it is restricted to the
// Development database: Beta and Production get the normalized log through their own copy or
// promotion, never through an ad-hoc mutation of a shared cluster.
export function assertNormalizeFingerprintsApplyAllowed(args: {
  apply: boolean;
  confirm: boolean;
  databaseName?: string;
}): void {
  if (!args.apply) return;
  if (!args.confirm) {
    throw new Error(`${SCRIPT_NAME} apply requires --confirm-fingerprint-normalization`);
  }
  if (args.databaseName !== 'Development') {
    throw new Error(
      `${SCRIPT_NAME} apply is restricted to the Development database (resolved: ${args.databaseName || 'unknown'})`,
    );
  }
}

function writeReport(report: Record<string, unknown>, output?: string): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
}

const scopeFilter = (args: NormalizeFingerprintsArgs): Record<string, unknown> => ({
  ...(args.field ? { field: args.field } : {}),
  ...(args.sourceName ? { sourceName: args.sourceName } : {}),
});

async function rewriteFingerprints(
  args: NormalizeFingerprintsArgs,
  apply: boolean,
): Promise<{ scanned: number; rewrites: number; unfingerprintable: number }> {
  let scanned = 0;
  let rewrites = 0;
  let unfingerprintable = 0;
  let pending: Array<{
    updateOne: { filter: Record<string, unknown>; update: Record<string, unknown> };
  }> = [];

  const flush = async (): Promise<void> => {
    if (pending.length === 0) return;
    if (apply) await Observation.bulkWrite(pending, { ordered: false });
    pending = [];
  };

  const cursor = Observation.find(scopeFilter(args))
    .select('_id sourceName entityType entityId entityKey field value observationFingerprint')
    .lean()
    .cursor({ batchSize: BATCH_SIZE });

  for await (const row of cursor) {
    scanned += 1;
    const observation = row as unknown as NormalizableObservation;
    const fingerprint = canonicalFingerprint(observation);
    if (!fingerprint) {
      unfingerprintable += 1;
      continue;
    }
    if (fingerprint === observation.observationFingerprint) continue;
    rewrites += 1;
    pending.push({
      updateOne: {
        filter: { _id: observation._id },
        update: { $set: { observationFingerprint: fingerprint } },
      },
    });
    if (pending.length >= BATCH_SIZE) await flush();
  }
  await flush();
  return { scanned, rewrites, unfingerprintable };
}

interface CollapseResult {
  groups: number;
  supersessions: number;
  proseGroupsKeptOlderUsefulValue: number;
  proseGroupsAllValuesUnusable: number;
  samples: Array<{
    entityKey?: string;
    sourceName: string;
    field: string;
    activeRows: number;
    retainedObservedAt?: string;
    keptOlderUsefulValue: boolean;
  }>;
}

async function collapseActiveDuplicates(
  args: NormalizeFingerprintsArgs,
  apply: boolean,
): Promise<CollapseResult> {
  const result: CollapseResult = {
    groups: 0,
    supersessions: 0,
    proseGroupsKeptOlderUsefulValue: 0,
    proseGroupsAllValuesUnusable: 0,
    samples: [],
  };

  // Scoped to latest-wins fields, which are the ones whose supersession keys on
  // (source, entity, field) rather than on the value fingerprint, and therefore the ones the
  // id/key identity split left with competing active rows (#2177). Grouping recomputes the
  // canonical identity with $ifNull so the result is identical in dry-run and apply, instead of
  // depending on whether the fingerprint rewrite above has already been written.
  //
  // fullDescription/shortDescription are EXCLUDED unless --collapse-prose is passed. Measured on
  // Development, the degraded August prose in the damaged groups (ysm-hafler's "Interested in
  // joining our lab?", nsf-pi-67d8928e50621bcef434a4a7's "Welcome to the Yan lab...") passes
  // fullDescriptionQuality with zero flags, so a newest-wins collapse retains the regression and
  // supersedes the good May prose that is still active. That changes nothing about what is served
  // today - the higher-confidence row already wins - but it would retire the only remaining copy
  // of the good text, which a non-subtractive quality signal could otherwise still promote.
  const groups = await Observation.aggregate([
    {
      $match: {
        ...scopeFilter(args),
        superseded: { $ne: true },
        ...(args.collapseProse ? {} : { field: { $nin: [...QUALITY_GUARDED_PROSE_FIELDS] } }),
        $or: [
          { field: { $in: [...LATEST_WINS_FINGERPRINT_FIELDS] } },
          { entityType: 'fellowship' },
        ],
      },
    },
    {
      $group: {
        _id: {
          identity: { $ifNull: ['$entityKey', { $toString: '$entityId' }] },
          sourceName: '$sourceName',
          entityType: '$entityType',
          field: '$field',
        },
        ids: { $push: '$_id' },
      },
    },
    { $match: { 'ids.1': { $exists: true } } },
  ]).allowDiskUse(true);

  let pending: Array<{
    updateMany: { filter: Record<string, unknown>; update: Record<string, unknown> };
  }> = [];
  const flush = async (): Promise<void> => {
    if (pending.length === 0) return;
    if (apply) await Observation.bulkWrite(pending, { ordered: false });
    pending = [];
  };

  for (const group of groups as Array<{ _id: Record<string, unknown>; ids: unknown[] }>) {
    const rows = (await Observation.find({ _id: { $in: group.ids } })
      .select('_id sourceName entityType entityId entityKey field value observedAt superseded')
      .lean()) as unknown as NormalizableObservation[];
    if (rows.length < 2) continue;
    const { retained, keptOlderUsefulValue, allValuesUnusable } = selectRetainedObservation(rows);
    result.groups += 1;
    if (keptOlderUsefulValue) result.proseGroupsKeptOlderUsefulValue += 1;
    if (allValuesUnusable) result.proseGroupsAllValuesUnusable += 1;
    const supersededIds = rows.filter((row) => row !== retained).map((row) => row._id);
    result.supersessions += supersededIds.length;
    if (result.samples.length < 25) {
      result.samples.push({
        ...(typeof rows[0].entityKey === 'string' ? { entityKey: rows[0].entityKey } : {}),
        sourceName: rows[0].sourceName,
        field: rows[0].field,
        activeRows: rows.length,
        ...(retained.observedAt
          ? { retainedObservedAt: new Date(retained.observedAt as string).toISOString() }
          : {}),
        keptOlderUsefulValue,
      });
    }
    pending.push({
      updateMany: {
        filter: { _id: { $in: supersededIds } },
        update: { $set: { superseded: true, supersededBy: retained._id } },
      },
    });
    if (pending.length >= 200) await flush();
  }
  await flush();
  return result;
}

async function main(args: NormalizeFingerprintsArgs): Promise<void> {
  const mongoUrl = process.env.MONGODBURL;
  if (!mongoUrl) throw new Error(`MONGODBURL is required for ${SCRIPT_NAME}`);
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl,
  });
  const databaseName = resolveMongoDatabaseName(mongoUrl);
  assertNormalizeFingerprintsApplyAllowed({ ...args, databaseName });

  await mongoose.connect(mongoUrl);
  try {
    const fingerprints = await rewriteFingerprints(args, args.apply);
    const collapse = await collapseActiveDuplicates(args, args.apply);
    const report = {
      generatedAt: new Date().toISOString(),
      script: SCRIPT_NAME,
      environment: guard.environment,
      db: summarizeMongoUrl(mongoUrl),
      mode: args.apply ? 'apply' : 'dry-run',
      scope: { ...scopeFilter(args), collapseProse: args.collapseProse },
      fingerprints,
      collapse,
    };
    console.log(JSON.stringify(report, null, 2));
    writeReport(report, args.output);
  } finally {
    await mongoose.disconnect();
  }
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main(parseNormalizeFingerprintsArgs(process.argv.slice(2))).catch((error) => {
    console.error(`[${SCRIPT_NAME}] ${sanitizeLogValue(String(error))}`);
    process.exitCode = 1;
  });
}

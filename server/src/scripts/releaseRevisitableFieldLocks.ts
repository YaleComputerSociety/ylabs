/**
 * Hands a revisitable `manuallyLockedFields` entry back to the engine when the
 * engine now derives the value the lock holds (#2612).
 *
 * `releaseRevisitableFieldLocksCore` owns the rules. This runner owns the reads and
 * the write: the engine's answer comes from a `dryRun` materialization with
 * `reviseRevisitableFieldLocks`, so it is the real resolve-and-project path
 * reporting its own plan rather than a reimplementation of it, and the release
 * `$set`s the lock list with the released fields filtered out and `$unset`s each
 * released field's provenance record.
 *
 * A whole-array `$set` is what makes the filter on `manuallyLockedFields` load
 * bearing: the write is conditioned on the exact lock list the decision was read
 * from, so a row another writer touched between the read and the write is reported
 * as a conflict instead of having that writer's lock overwritten by a stale list.
 * `summary` is therefore the plan; `appliedReleases` and `releasedRows` are what a
 * run actually wrote.
 *
 * No re-gate and no re-index: a release only ever happens when the engine agrees
 * with the stored value, so no served field moves. Verification is a re-read of the
 * served surface, not this script's counters.
 *
 * Usage:
 *   yarn --cwd server research-entity:release-field-locks
 *   yarn --cwd server research-entity:release-field-locks --apply \
 *     --confirm-field-lock-release [--slugs=a,b] [--output ./tmp/report.json]
 *   yarn --cwd server research-entity:release-field-locks --release-never-backed --slugs=a,b \
 *     [--accept-engine-value=a:fullDescription] [--apply --confirm-field-lock-release]
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { materializeEntity } from '../scrapers/entityMaterializer';
import { lockedNeverBackedProvenanceFields } from '../scrapers/neverBackedFieldProvenance';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { planFieldLockRelease } from '../utils/researchEntityFieldLocks';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  describeFieldLockReleaseDecision,
  releasedFieldsFromDecisions,
  resolveFieldLockReleases,
  summarizeFieldLockReleaseDecisions,
  type FieldLockReleaseDecision,
  type FieldLockReleaseSummary,
  type LockedFieldEntity,
} from './releaseRevisitableFieldLocksCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const SCRIPT_NAME = 'research-entity:release-field-locks';

export interface ReleaseRevisitableFieldLocksOptions {
  apply: boolean;
  confirm: boolean;
  releaseProvenInert: boolean;
  releaseNeverBacked?: boolean;
  acceptEngineValues?: string[];
  slugs: string[];
  output?: string;
}

const acceptedFieldsForSlug = (accepted: readonly string[], slug: string): string[] =>
  accepted
    .filter((entry) => entry.slice(0, entry.lastIndexOf(':')) === slug)
    .map((entry) => entry.slice(entry.lastIndexOf(':') + 1));

export function parseReleaseRevisitableFieldLocksArgs(
  argv: string[],
): ReleaseRevisitableFieldLocksOptions {
  const options: ReleaseRevisitableFieldLocksOptions & { acceptEngineValues: string[] } = {
    apply: false,
    confirm: false,
    releaseProvenInert: false,
    releaseNeverBacked: false,
    acceptEngineValues: [],
    slugs: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--apply') options.apply = true;
    else if (arg === '--dry-run') options.apply = false;
    else if (arg === '--confirm-field-lock-release') options.confirm = true;
    else if (arg === '--release-proven-inert') options.releaseProvenInert = true;
    else if (arg === '--release-never-backed') options.releaseNeverBacked = true;
    else if (arg.startsWith('--accept-engine-value=')) {
      options.acceptEngineValues.push(arg.slice('--accept-engine-value='.length).trim());
    } else if (arg.startsWith('--slugs=')) {
      options.slugs = arg
        .slice('--slugs='.length)
        .split(',')
        .map((slug) => slug.trim())
        .filter(Boolean);
    } else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else {
      throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
    }
  }
  if (options.releaseProvenInert && options.slugs.length === 0) {
    throw new Error(
      `${SCRIPT_NAME} --release-proven-inert requires --slugs; it releases locks that record no reason, on rows an operator has read.`,
    );
  }
  if (options.releaseNeverBacked && options.slugs.length === 0) {
    throw new Error(
      `${SCRIPT_NAME} --release-never-backed requires --slugs; it releases locks an operator has read one row at a time.`,
    );
  }
  for (const entry of options.acceptEngineValues) {
    const separator = entry.lastIndexOf(':');
    const slug = entry.slice(0, separator);
    if (separator <= 0 || separator === entry.length - 1 || !options.slugs.includes(slug)) {
      throw new Error(
        `${SCRIPT_NAME} --accept-engine-value takes <slug>:<field> for a slug named in --slugs: ${entry}`,
      );
    }
  }
  if (options.acceptEngineValues.length > 0 && !options.releaseNeverBacked) {
    throw new Error(`${SCRIPT_NAME} --accept-engine-value requires --release-never-backed.`);
  }
  return options;
}

export interface ReleaseRevisitableFieldLocksResult {
  decisions: FieldLockReleaseDecision[];
  summary: FieldLockReleaseSummary;
  appliedReleases: number;
  releasedRows: number;
  conflictedRows: string[];
  errors: { slug: string; message: string }[];
  applied: boolean;
}

/**
 * The engine's plan for one row with `revisedFields` ignored, or no answer.
 *
 * A slug that a durable merge redirect resolves elsewhere returns the canonical
 * row's plan, which describes a different document than the one this run would
 * write. Comparing the answer's `entityId` to the row read here is what keeps a
 * shell's locks from being judged against the survivor's derivation.
 */
async function askEngineForRow(
  rowId: unknown,
  slug: string,
  revisedFields: readonly string[],
  ignoreLockRecord: boolean,
): Promise<
  { plannedSet?: Record<string, unknown>; plannedUnset?: Record<string, unknown> } | undefined
> {
  // A lock that records no reason is not revisitable, so
  // `reviseRevisitableFieldLocks` would leave it in place and the plan would never
  // name its field. Asking about it at all needs the wider question.
  const answer = await materializeEntity(
    'researchEntity',
    { entityKey: slug },
    ignoreLockRecord
      ? { dryRun: true, auditFieldLocksIgnoringRecord: revisedFields }
      : { dryRun: true, reviseRevisitableFieldLocks: revisedFields },
  );
  if (answer.entityId !== String(rowId)) return undefined;
  if (!answer.plannedSet && !answer.plannedUnset) return undefined;
  return { plannedSet: answer.plannedSet, plannedUnset: answer.plannedUnset };
}

export async function runReleaseRevisitableFieldLocks(
  options: ReleaseRevisitableFieldLocksOptions,
): Promise<ReleaseRevisitableFieldLocksResult> {
  const filter: Record<string, unknown> = { manuallyLockedFields: { $exists: true, $ne: [] } };
  if (options.slugs.length > 0) filter.slug = { $in: options.slugs };
  const rows = await ResearchEntity.find(filter).lean<(LockedFieldEntity & { _id: unknown })[]>();

  const decisions: FieldLockReleaseDecision[] = [];
  const conflictedRows: string[] = [];
  const errors: { slug: string; message: string }[] = [];
  let appliedReleases = 0;
  let releasedRows = 0;

  // One throwing row must not abandon the rows after it, nor the report for the
  // rows already written, so each row carries its own failure.
  for (const row of rows) {
    const slug = typeof row.slug === 'string' ? row.slug : '';
    try {
      if (!slug) throw new Error('row has no slug to materialize by');
      const neverBackedFields = options.releaseNeverBacked
        ? await lockedNeverBackedProvenanceFields({ stored: row })
        : [];
      const rowDecisions = await resolveFieldLockReleases(
        row,
        (revisedFields) =>
          askEngineForRow(
            row._id,
            slug,
            revisedFields,
            options.releaseProvenInert || neverBackedFields.length > 0,
          ),
        {
          releaseProvenInert: options.releaseProvenInert,
          neverBackedFields,
          acceptEngineValueFields: acceptedFieldsForSlug(options.acceptEngineValues ?? [], slug),
        },
      );
      decisions.push(...rowDecisions);
      const released = releasedFieldsFromDecisions(rowDecisions);
      if (!options.apply || released.length === 0) continue;

      const update = planFieldLockRelease(row.manuallyLockedFields, released);
      const result = await ResearchEntity.updateOne(
        { _id: row._id, manuallyLockedFields: row.manuallyLockedFields as string[] },
        Object.keys(update.unset).length > 0
          ? { $set: update.set, $unset: update.unset }
          : { $set: update.set },
      );
      if (result.modifiedCount < 1) conflictedRows.push(slug);
      else {
        releasedRows += 1;
        appliedReleases += released.length;
      }
    } catch (error) {
      errors.push({ slug, message: String(sanitizeLogValue(error)) });
      console.error(`${SCRIPT_NAME} failed for ${slug || '(no slug)'}:`, sanitizeLogValue(error));
    }
  }

  return {
    decisions,
    summary: summarizeFieldLockReleaseDecisions(decisions),
    appliedReleases,
    releasedRows,
    conflictedRows,
    errors,
    applied: options.apply,
  };
}

async function main(): Promise<void> {
  const options = parseReleaseRevisitableFieldLocksArgs(process.argv.slice(2));
  assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  if (options.apply && !options.confirm) {
    throw new Error(
      `${SCRIPT_NAME} --apply requires --confirm-field-lock-release; it returns fields to engine derivation.`,
    );
  }
  await initializeConnections();
  try {
    const result = await runReleaseRevisitableFieldLocks(options);
    console.log(`${SCRIPT_NAME}: ${result.applied ? 'APPLIED' : 'DRY RUN'}`);
    for (const decision of result.decisions) {
      if (decision.verdict === 'keep_not_revisitable') continue;
      console.log(describeFieldLockReleaseDecision(decision));
    }
    console.log(`\nplan:\n${JSON.stringify(result.summary, null, 2)}`);
    console.log(
      `applied: ${result.appliedReleases} locks released across ${result.releasedRows} rows${
        result.conflictedRows.length > 0
          ? `, write conflicts: ${result.conflictedRows.join(', ')}`
          : ''
      }${result.errors.length > 0 ? `, errors: ${result.errors.length}` : ''}`,
    );
    if (options.output) {
      const safeOutput = resolveSafeJsonReportOutputPath(options.output);
      fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
      fs.writeFileSync(
        safeOutput,
        JSON.stringify({ generatedAt: new Date().toISOString(), ...result }, null, 2),
      );
      console.log(`Saved report to ${safeOutput}`);
    }
  } finally {
    await mongoose.disconnect();
  }
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error));
    process.exit(1);
  });
}

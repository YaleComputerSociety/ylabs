/**
 * Hands a revisitable `manuallyLockedFields` entry back to the engine when the
 * engine now derives the value the lock holds (#2612).
 *
 * `releaseRevisitableFieldLocksCore` owns the rules. This runner owns the reads and
 * the write: the engine's answer comes from a `dryRun` materialization with
 * `reviseRevisitableFieldLocks`, so it is the real resolve-and-project path
 * reporting its own plan rather than a reimplementation of it, and the release is a
 * `$pull` of the lock plus the removal of its provenance record.
 *
 * The write is conditioned on the lock list the decision was read from, so a row
 * another writer touched between the read and the write is reported as a conflict
 * instead of being released on a stale answer.
 *
 * No re-gate and no re-index: a release only ever happens when the engine agrees
 * with the stored value, so no served field moves. Verification is a re-read of the
 * served surface, not this script's counters.
 *
 * Usage:
 *   yarn --cwd server research-entity:release-field-locks
 *   yarn --cwd server research-entity:release-field-locks --apply \
 *     --confirm-field-lock-release [--slugs=a,b] [--output ./tmp/report.json]
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { materializeEntity } from '../scrapers/entityMaterializer';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { planFieldLockRelease } from '../utils/researchEntityFieldLocks';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  decideFieldLockReleases,
  releasedFieldsFromDecisions,
  summarizeFieldLockReleaseDecisions,
  type FieldLockReleaseDecision,
  type FieldLockReleaseSummary,
  type LockedFieldEntity,
} from './releaseRevisitableFieldLocksCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'research-entity:release-field-locks';

export interface ReleaseRevisitableFieldLocksOptions {
  apply: boolean;
  confirm: boolean;
  slugs: string[];
  output?: string;
}

export function parseReleaseRevisitableFieldLocksArgs(
  argv: string[],
): ReleaseRevisitableFieldLocksOptions {
  const options: ReleaseRevisitableFieldLocksOptions = { apply: false, confirm: false, slugs: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--apply') options.apply = true;
    else if (arg === '--dry-run') options.apply = false;
    else if (arg === '--confirm-field-lock-release') options.confirm = true;
    else if (arg.startsWith('--slugs=')) {
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
  return options;
}

export interface ReleaseRevisitableFieldLocksResult {
  decisions: FieldLockReleaseDecision[];
  summary: FieldLockReleaseSummary;
  releasedRows: number;
  conflictedRows: string[];
  applied: boolean;
}

export async function runReleaseRevisitableFieldLocks(
  options: ReleaseRevisitableFieldLocksOptions,
): Promise<ReleaseRevisitableFieldLocksResult> {
  const filter: Record<string, unknown> = { manuallyLockedFields: { $exists: true, $ne: [] } };
  if (options.slugs.length > 0) filter.slug = { $in: options.slugs };
  const rows = await ResearchEntity.find(filter).lean<(LockedFieldEntity & { _id: unknown })[]>();

  const decisions: FieldLockReleaseDecision[] = [];
  const conflictedRows: string[] = [];
  let releasedRows = 0;

  for (const row of rows) {
    const slug = typeof row.slug === 'string' ? row.slug : '';
    const answer = await materializeEntity(
      'researchEntity',
      { entityKey: slug },
      { dryRun: true, reviseRevisitableFieldLocks: true },
    );
    const rowDecisions = decideFieldLockReleases(
      row,
      answer.plannedSet || answer.plannedUnset
        ? { plannedSet: answer.plannedSet, plannedUnset: answer.plannedUnset }
        : undefined,
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
    else releasedRows += 1;
  }

  return {
    decisions,
    summary: summarizeFieldLockReleaseDecisions(decisions),
    releasedRows,
    conflictedRows,
    applied: options.apply,
  };
}

const describeValue = (value: unknown): string => {
  if (value === undefined) return '(absent)';
  if (typeof value === 'string') return value.trim() === '' ? '(empty)' : value;
  if (Array.isArray(value))
    return value.length === 0 ? '(empty list)' : `[${value.length} entries]`;
  return JSON.stringify(value) ?? String(value);
};

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
      console.log(
        `  ${decision.slug} ${decision.field} [${decision.reason}${
          decision.assertsNoValue ? ', asserts no value' : ''
        }]\n     stored ${describeValue(decision.storedValue)}\n     engine ${describeValue(
          decision.engineValue,
        )}\n     ${decision.verdict.toUpperCase()}`,
      );
    }
    console.log(`\n${JSON.stringify(result.summary, null, 2)}`);
    console.log(
      `rows written: ${result.releasedRows}${
        result.conflictedRows.length > 0
          ? `, write conflicts: ${result.conflictedRows.join(', ')}`
          : ''
      }`,
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

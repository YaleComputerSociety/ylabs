/**
 * research-entity:clear-stale-refusal-provenance unsets the `fieldProvenance.<field>` stamps
 * that a refusal recorded before #6318 cleared the value of but left in place. It derives every
 * target from the stored refusal records, writes nothing else, and leaves those records exactly
 * as they are.
 *
 *   yarn --cwd server research-entity:clear-stale-refusal-provenance
 *   yarn --cwd server research-entity:clear-stale-refusal-provenance --apply --confirm-clear-stale-refusal-provenance
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { updateOneKeepingLastCitation } from '../services/lastCitationGuard';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed } from './scriptWriteGuards';
import {
  fieldProvenancePath,
  staleRefusalProvenanceOf,
  type StaleRefusalProvenance,
} from './refusedFieldProvenance';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env'), quiet: true });

const SCRIPT_NAME = 'research-entity:clear-stale-refusal-provenance';

export async function runClearStaleRefusalProvenance(options: { apply: boolean }) {
  const rows = await ResearchEntity.find({
    fieldValueRefusals: { $exists: true },
    fieldProvenance: { $exists: true },
  }).lean<Record<string, unknown>[]>();
  const stamps: StaleRefusalProvenance[] = [];
  let unset = 0;
  let lastCitationStampsKept = 0;
  for (const row of rows) {
    for (const stamp of await staleRefusalProvenanceOf(row)) {
      stamps.push(stamp);
      if (!options.apply) continue;
      const outcome = await unsetStampIfUnchangedSinceRead(row, stamp.field);
      unset += outcome.modifiedCount;
      if (outcome.withheld.length > 0) lastCitationStampsKept += 1;
    }
  }
  return {
    mode: options.apply ? 'apply' : 'dry-run',
    rowsWithRefusals: rows.length,
    stamps,
    ...(options.apply
      ? {
          unset,
          lastCitationStampsKept,
          changedSinceRead: stamps.length - unset - lastCitationStampsKept,
        }
      : {}),
  };
}

const unchangedSinceRead = (value: unknown) => (value === undefined ? { $exists: false } : value);

export async function unsetStampIfUnchangedSinceRead(
  row: Record<string, unknown>,
  field: string,
): Promise<{ modifiedCount: number; withheld: string[] }> {
  const stampRead = (row.fieldProvenance as Record<string, { observationId?: unknown }>)[field];
  return updateOneKeepingLastCitation(
    ResearchEntity,
    {
      _id: row._id,
      [field]: unchangedSinceRead(row[field]),
      [`${fieldProvenancePath(field)}.observationId`]: unchangedSinceRead(stampRead?.observationId),
    },
    { $unset: { [fieldProvenancePath(field)]: '' } },
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  if (apply && !argv.includes('--confirm-clear-stale-refusal-provenance')) {
    throw new Error(`${SCRIPT_NAME} --apply requires --confirm-clear-stale-refusal-provenance.`);
  }
  assertScriptApplyAllowed({ apply, scriptName: SCRIPT_NAME, mongoUrl: process.env.MONGODBURL });
  await initializeConnections();
  try {
    console.log(JSON.stringify(await runClearStaleRefusalProvenance({ apply }), null, 2));
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

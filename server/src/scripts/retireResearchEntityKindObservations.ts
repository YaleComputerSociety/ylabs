import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  assertKindFullyRetired,
  buildRetiredKindRecord,
  RETIRE_KIND_ROLLBACK_REASON,
  RETIRE_KIND_SCRIPT_NAME,
  RETIRED_KIND_FIELD,
  type RetireKindCounts,
  type RetiredKindAssertion,
} from './retireResearchEntityKindObservationsCore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const LIVE_FILTER = {
  entityType: 'researchEntity',
  field: RETIRED_KIND_FIELD,
  superseded: { $ne: true },
};

/**
 * Reads and builds the record without writing anything.
 *
 * Separate from the supersede on purpose. An earlier shape applied first and wrote the
 * record afterwards, so a rejected `--record` path threw AFTER the data operation and
 * the record was lost; only superseding rather than deleting kept the assertions
 * recoverable. The caller must persist this before calling `supersede` (#3362).
 */
export async function planResearchEntityKindRetirement(): Promise<{
  counts: RetireKindCounts;
  record: RetiredKindAssertion[];
  servedRowsMissingAStoredType: number;
}> {
  const liveBefore = await Observation.countDocuments(LIVE_FILTER);
  const live = (await Observation.find(LIVE_FILTER)
    .select('entityKey value sourceName observedAt')
    .lean()) as Array<Record<string, unknown>>;

  const keysWithEntityTypeAssertion = new Set(
    (
      await Observation.distinct('entityKey', {
        entityType: 'researchEntity',
        field: 'entityType',
        superseded: { $ne: true },
      })
    ).map(String),
  );
  const keys = [...new Set(live.map((observation) => String(observation.entityKey ?? '')))].filter(
    Boolean,
  );
  const keysWithEntityRow = new Set(
    (
      (await ResearchEntity.find({ slug: { $in: keys } })
        .select('slug')
        .lean()) as Array<{ slug?: unknown }>
    ).map((row) => String(row.slug ?? '')),
  );

  // Recorded BEFORE anything is superseded: for a key with no entity row this is the
  // only remaining trace of what the lane asserted, so losing it is the one
  // irreversible part of the operation.
  const record = buildRetiredKindRecord({
    observations: live,
    keysWithEntityTypeAssertion,
    keysWithEntityRow,
  });

  const servedRowsMissingAStoredType = await ResearchEntity.countDocuments({
    slug: { $in: keys },
    archived: { $ne: true },
    studentVisibilityTier: 'student_ready',
    $or: [{ entityType: { $exists: false } }, { entityType: '' }],
  });

  const counts: RetireKindCounts = {
    liveBefore,
    liveAfter: liveBefore,
    superseded: 0,
    keysRecorded: keys.length,
    keysWithNoEntityRow: keys.filter((key) => !keysWithEntityRow.has(key)).length,
    keysWhoseOnlyTypeClaimThisWas: keys.filter((key) => !keysWithEntityTypeAssertion.has(key))
      .length,
  };
  return { counts, record, servedRowsMissingAStoredType };
}

export async function supersedeResearchEntityKindObservations(plan: {
  counts: RetireKindCounts;
  servedRowsMissingAStoredType: number;
}): Promise<RetireKindCounts> {
  const result = await Observation.updateMany(LIVE_FILTER, {
    $set: {
      superseded: true,
      rollback: { rolledBackAt: new Date(), reason: RETIRE_KIND_ROLLBACK_REASON },
    },
  });
  const counts: RetireKindCounts = {
    ...plan.counts,
    superseded: result.modifiedCount || 0,
    liveAfter: await Observation.countDocuments(LIVE_FILTER),
  };
  assertKindFullyRetired({
    liveAfter: counts.liveAfter,
    servedRowsMissingAStoredType: plan.servedRowsMissingAStoredType,
  });
  return counts;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const confirmed = argv.includes('--confirm-retire-kind');
  const recordIndex = argv.indexOf('--record');
  if (apply && !confirmed) throw new Error('Apply mode requires --confirm-retire-kind.');
  if (apply && recordIndex === -1) {
    throw new Error('Apply mode requires --record <path>: the record is the only trace kept.');
  }
  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: RETIRE_KIND_SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${apply ? 'apply' : 'dry-run'}`,
  );
  // Resolved BEFORE the connection, so a rejected path cannot fail after a write.
  const output = recordIndex === -1 ? '' : resolveSafeJsonReportOutputPath(argv[recordIndex + 1]);
  await initializeConnections();
  try {
    const plan = await planResearchEntityKindRetirement();
    if (output) {
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, `${JSON.stringify(plan.record, null, 2)}\n`);
      console.log(`Recorded ${plan.record.length} assertion(s) to ${output} before any write`);
    }
    const counts = apply ? await supersedeResearchEntityKindObservations(plan) : plan.counts;
    console.log(JSON.stringify(counts, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

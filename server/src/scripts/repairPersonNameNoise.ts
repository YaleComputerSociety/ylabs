import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Researcher } from '../models/researcher';
import { RoleAssignment } from '../models/roleAssignment';
import { runStudentVisibilityGate } from '../services/studentVisibilityGateService';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  planPersonNameRepair,
  summarizePersonNameRefusals,
  summarizePersonNameShapes,
  type PersonNameRow,
} from './repairPersonNameNoiseCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'researchers:repair-person-name-noise';
export const CONFIRM_FLAG = '--confirm-repair-person-name-noise';

export interface RepairPersonNameNoiseOptions {
  dryRun: boolean;
  confirmed: boolean;
  limit?: number;
  output?: string;
}

/**
 * The number of planned rewrites the report names in full. A rewrite deletes text
 * from a stored name, so an operator has to be able to read the planned before and
 * after rather than only a per-shape count.
 */
export const MAX_REPORTED_SAMPLES = 60;

function parsePositiveIntegerLimit(value: string | undefined): number {
  if (!value || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error('--limit must be a positive integer');
  }
  return Number(value);
}

export function parseRepairPersonNameNoiseArgs(argv: string[]): RepairPersonNameNoiseOptions {
  const options: RepairPersonNameNoiseOptions = { dryRun: true, confirmed: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') options.dryRun = false;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === CONFIRM_FLAG) options.confirmed = true;
    else if (arg === '--limit') {
      options.limit = parsePositiveIntegerLimit(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveIntegerLimit(arg.slice('--limit='.length));
    } else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  return options;
}

async function entityIdsForPeople(personIds: string[]): Promise<string[]> {
  const objectIds = personIds
    .filter((id) => mongoose.isValidObjectId(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  if (objectIds.length === 0) return [];
  const assignments = (await RoleAssignment.find({
    personId: { $in: objectIds },
    'target.kind': 'RESEARCH_ENTITY',
    archived: { $ne: true },
  })
    .select('target')
    .lean()) as unknown as Array<{ target?: { id?: unknown } }>;
  return [
    ...new Set(
      assignments
        .map((assignment) => serializedDocumentId(assignment.target?.id))
        .filter((id): id is string => Boolean(id)),
    ),
  ];
}

async function main(): Promise<void> {
  const options = parseRepairPersonNameNoiseArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: !options.dryRun,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  if (!options.dryRun && !options.confirmed) {
    throw new Error(`${SCRIPT_NAME} apply requires ${CONFIRM_FLAG}`);
  }

  await initializeConnections();

  const people = (await Researcher.find({ archived: { $ne: true } })
    .select('_id displayName')
    .lean()) as unknown as Array<{ _id: unknown; displayName?: unknown }>;
  const rows: PersonNameRow[] = people.flatMap((person) => {
    const id = serializedDocumentId(person._id);
    const displayName = typeof person.displayName === 'string' ? person.displayName : '';
    if (!id || !displayName.trim()) return [];
    return [{ id, displayName }];
  });

  const plan = planPersonNameRepair(rows);
  const planned = options.limit === undefined ? plan.rewrite : plan.rewrite.slice(0, options.limit);

  let rewritten = 0;
  let regatedEntities = 0;
  let regateError: string | undefined;
  if (!options.dryRun && planned.length > 0) {
    for (const row of planned) {
      if (!mongoose.isValidObjectId(row.id)) continue;
      // Compare-and-set on the value the plan read, so a name another session
      // rewrote in the meantime is left alone rather than reverted.
      const result = await Researcher.updateOne(
        { _id: new mongoose.Types.ObjectId(row.id), displayName: row.from },
        { $set: { displayName: row.to } },
      );
      rewritten += result.modifiedCount || 0;
    }

    // Re-gate through the ordinary gate rather than writing tiers here: a lead's
    // name feeds the served-description invariant, so a rewrite can change whether
    // a row is servable at all, and every other blocker still applies.
    const entityIds = await entityIdsForPeople(planned.map((row) => row.id));
    if (entityIds.length > 0) {
      // The names are already committed by here, so a gate refusal must not take the
      // report with it: an operator who cannot read what was written has no way to
      // tell which half of the repair landed.
      try {
        await runStudentVisibilityGate({
          collection: 'research',
          mode: 'apply',
          recordIds: entityIds,
        });
        regatedEntities = entityIds.length;
      } catch (error) {
        regateError = sanitizeLogValue(error instanceof Error ? error.message : error);
      }
    }
  }

  const report = {
    script: SCRIPT_NAME,
    mode: options.dryRun ? 'dry-run' : 'apply',
    environment: guard.environment,
    db: guard.dbLabel,
    limit: options.limit,
    peopleScanned: rows.length,
    noisyNames: plan.rewrite.length,
    plannedRewrites: planned.length,
    byShape: summarizePersonNameShapes(planned),
    refusedByReason: summarizePersonNameRefusals(plan.refused),
    samples: planned.slice(0, MAX_REPORTED_SAMPLES),
    rewritten,
    regatedEntities,
    regateError,
  };
  console.log(JSON.stringify(report, null, 2));

  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, JSON.stringify(report, null, 2));
    console.log(`Saved report to ${options.output}`);
  }

  await mongoose.disconnect();
  if (regateError) process.exitCode = 1;
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error instanceof Error ? error.message : error));
    process.exit(1);
  });
}

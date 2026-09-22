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
  output?: string;
}

export function parseRepairPersonNameNoiseArgs(argv: string[]): RepairPersonNameNoiseOptions {
  const options: RepairPersonNameNoiseOptions = { dryRun: true, confirmed: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') options.dryRun = false;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === CONFIRM_FLAG) options.confirmed = true;
    else if (arg === '--output') {
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

  let rewritten = 0;
  let regatedEntities = 0;
  if (!options.dryRun && plan.rewrite.length > 0) {
    for (const row of plan.rewrite) {
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
    const entityIds = await entityIdsForPeople(plan.rewrite.map((row) => row.id));
    if (entityIds.length > 0) {
      await runStudentVisibilityGate({
        collection: 'research',
        mode: 'apply',
        recordIds: entityIds,
      });
      regatedEntities = entityIds.length;
    }
  }

  const report = {
    script: SCRIPT_NAME,
    mode: options.dryRun ? 'dry-run' : 'apply',
    environment: guard.environment,
    db: guard.dbLabel,
    peopleScanned: rows.length,
    plannedRewrites: plan.rewrite.length,
    byShape: summarizePersonNameShapes(plan.rewrite),
    refusedByReason: summarizePersonNameRefusals(plan.refused),
    rewritten,
    regatedEntities,
  };
  console.log(JSON.stringify(report, null, 2));

  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, JSON.stringify(report, null, 2));
    console.log(`Saved report to ${options.output}`);
  }

  await mongoose.disconnect();
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

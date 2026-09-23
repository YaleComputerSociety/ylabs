import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  buildDeadEndTombstoneRepairPlan,
  malformedPointerEntityIds,
  type TombstoneChainNode,
} from './repairDeadEndTombstoneChainsCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'repair-dead-end-tombstone-chains';

export interface RepairDeadEndTombstoneOptions {
  apply: boolean;
  confirm: boolean;
  output?: string;
}

export function parseRepairDeadEndTombstoneArgs(argv: string[]): RepairDeadEndTombstoneOptions {
  const options: RepairDeadEndTombstoneOptions = { apply: false, confirm: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--apply') options.apply = true;
    else if (arg === '--dry-run') options.apply = false;
    else if (arg === '--confirm-dead-end-tombstone-repair') options.confirm = true;
    else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  return options;
}

export async function runRepairDeadEndTombstoneChains(
  options: RepairDeadEndTombstoneOptions,
): Promise<number> {
  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  if (options.apply && !options.confirm) {
    throw new Error(
      `${SCRIPT_NAME} apply requires --confirm-dead-end-tombstone-repair. Mongo target: ${guard.dbLabel}.`,
    );
  }

  await initializeConnections();

  const rows = await ResearchEntity.find({}).select('_id slug archived canonicalGroupId').lean<
    Array<{
      _id: mongoose.Types.ObjectId;
      slug?: string;
      archived?: boolean;
      canonicalGroupId?: mongoose.Types.ObjectId | null;
    }>
  >();

  const nodes = new Map<string, TombstoneChainNode>(
    rows.map((row) => [
      String(row._id),
      {
        id: String(row._id),
        archived: row.archived === true,
        ...(row.canonicalGroupId ? { canonicalGroupId: String(row.canonicalGroupId) } : {}),
      },
    ]),
  );

  const tombstones = rows
    .filter((row) => row.archived === true && row.canonicalGroupId)
    .map((row) => ({
      id: String(row._id),
      slug: row.slug || '',
      canonicalGroupId: String(row.canonicalGroupId),
    }));

  const summary = buildDeadEndTombstoneRepairPlan({
    tombstones,
    nodeById: (id) => nodes.get(id),
  });

  const clearIds = malformedPointerEntityIds(summary);
  let cleared = 0;
  if (options.apply && clearIds.length > 0) {
    const result = await ResearchEntity.updateMany(
      { _id: { $in: clearIds.map((id) => new mongoose.Types.ObjectId(id)) } },
      { $set: { canonicalGroupId: null } },
    );
    cleared = result.modifiedCount ?? 0;
  }

  const report = {
    script: SCRIPT_NAME,
    mode: options.apply ? 'apply' : 'dry-run',
    environment: guard.environment,
    database: guard.dbLabel,
    tombstonesScanned: summary.scanned,
    byVerdict: summary.byVerdict,
    byTerminalCause: summary.byTerminalCause,
    malformedPointersPlanned: clearIds.length,
    malformedPointersCleared: cleared,
  };

  if (options.output) {
    fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  }
  console.log(JSON.stringify(report, null, 2));

  await mongoose.disconnect();
  return 0;
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (invokedDirectly) {
  runRepairDeadEndTombstoneChains(parseRepairDeadEndTombstoneArgs(process.argv.slice(2)))
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(`${SCRIPT_NAME} failed:`, sanitizeLogValue(String(error)));
      process.exit(1);
    });
}

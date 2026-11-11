/**
 * Records an operator's judgement that two researcher records are different people, so no
 * researcher fold arm ever merges them (#5592). Dry-run by default; prints identity tiers,
 * never names.
 *
 *   yarn --cwd server researchers:record-distinct-people --left=<id> --right=<id>
 *   yarn --cwd server researchers:record-distinct-people --left=<id> --right=<id> \
 *     --apply --confirm-record-distinct-researchers
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Researcher } from '../models/researcher';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed } from './scriptWriteGuards';
import { researcherIdentityTier } from './dedupeAccountlessResearcherShellsCore';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env'), quiet: true });

const SCRIPT_NAME = 'researchers:record-distinct-people';
const CONFIRM_FLAG = '--confirm-record-distinct-researchers';

export interface RecordDistinctResearchersArgs {
  leftId: string;
  rightId: string;
  apply: boolean;
  confirmed: boolean;
}

export function parseRecordDistinctResearchersArgs(argv: string[]): RecordDistinctResearchersArgs {
  const value = (name: string) =>
    argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const leftId = String(value('left') ?? '').trim();
  const rightId = String(value('right') ?? '').trim();
  for (const id of [leftId, rightId]) {
    if (!/^[0-9a-f]{24}$/i.test(id))
      throw new Error('--left and --right must be 24-character researcher ids');
  }
  if (leftId.toLowerCase() === rightId.toLowerCase())
    throw new Error('--left and --right must differ');
  for (const arg of argv) {
    if (!/^--(left|right)=/.test(arg) && arg !== '--apply' && arg !== CONFIRM_FLAG) {
      throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
    }
  }
  return {
    leftId: leftId.toLowerCase(),
    rightId: rightId.toLowerCase(),
    apply: argv.includes('--apply'),
    confirmed: argv.includes(CONFIRM_FLAG),
  };
}

/** Adds each researcher to the other's `distinctFromResearcherIds`; idempotent. */
export async function recordDistinctResearchers(
  leftId: string,
  rightId: string,
  apply: boolean,
): Promise<{ found: number; tiers: string[]; alreadyRecorded: boolean; applied: boolean }> {
  const ids = [leftId, rightId].map((id) => new mongoose.Types.ObjectId(id));
  const rows = (await Researcher.find({ _id: { $in: ids } })
    .select('_id identifiers distinctFromResearcherIds')
    .lean()) as any[];
  const byId = new Map(rows.map((row) => [String(row._id), row]));
  const left = byId.get(leftId);
  const right = byId.get(rightId);
  const holds = (row: any, otherId: string) =>
    (row?.distinctFromResearcherIds ?? []).some((id: unknown) => String(id) === otherId);
  const alreadyRecorded = holds(left, rightId) && holds(right, leftId);
  const tiers = [left, right].map((row) =>
    row
      ? researcherIdentityTier({ email: row.identifiers?.email, netid: row.identifiers?.netid })
      : 'MISSING',
  );
  if (!left || !right || !apply || alreadyRecorded) {
    return { found: rows.length, tiers, alreadyRecorded, applied: false };
  }
  await Researcher.updateOne({ _id: ids[0] }, { $addToSet: { distinctFromResearcherIds: ids[1] } });
  await Researcher.updateOne({ _id: ids[1] }, { $addToSet: { distinctFromResearcherIds: ids[0] } });
  return { found: rows.length, tiers, alreadyRecorded, applied: true };
}

async function main(): Promise<void> {
  const args = parseRecordDistinctResearchersArgs(process.argv.slice(2));
  if (args.apply && !args.confirmed)
    throw new Error(`${SCRIPT_NAME} --apply requires ${CONFIRM_FLAG}`);
  assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();
  try {
    const result = await recordDistinctResearchers(args.leftId, args.rightId, args.apply);
    console.log(JSON.stringify({ mode: args.apply ? 'apply' : 'dry-run', ...result }));
    if (result.found !== 2) throw new Error('Both researcher ids must exist');
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

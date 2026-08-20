import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { Account } from '../models/account';
import { Researcher } from '../models/researcher';
import { User } from '../models/user';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  PERSON_DISPLAY_PROFILE_FIELDS,
  assertBackfillUpdateIsDisplayOnly,
  composeDisplayProfileFromLegacy,
  displayProfileFillUpdate,
  type PersonDisplayProfileField,
} from './backfillPersonDisplayFieldsCore';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);

export interface BackfillPersonDisplayFieldsArgs {
  apply: boolean;
  confirmBackfillPersonDisplayFields: boolean;
  output?: string;
}

export function parseBackfillPersonDisplayFieldsArgs(
  argv: string[],
): BackfillPersonDisplayFieldsArgs {
  const args: BackfillPersonDisplayFieldsArgs = {
    apply: false,
    confirmBackfillPersonDisplayFields: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--apply' || arg === '--mode=apply') {
      args.apply = true;
      continue;
    }
    if (arg === '--dry-run' || arg === '--mode=dry-run') {
      args.apply = false;
      continue;
    }
    if (arg === '--confirm-backfill-person-display-fields') {
      args.confirmBackfillPersonDisplayFields = true;
      continue;
    }
    if (arg.startsWith('--confirm-backfill-person-display-fields=')) {
      throw new Error('--confirm-backfill-person-display-fields does not accept a value');
    }
    if (arg.startsWith('--output=')) {
      args.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
      continue;
    }
    if (arg === '--output') {
      args.output = resolveSafeJsonReportOutputPath(argv[index + 1]);
      index += 1;
      continue;
    }
    throw new Error(`Unknown backfill:person-display-fields argument: ${arg}`);
  }

  return args;
}

export function assertBackfillPersonDisplayFieldsApplyAllowed(
  args: Pick<BackfillPersonDisplayFieldsArgs, 'apply' | 'confirmBackfillPersonDisplayFields'>,
): void {
  if (args.apply && !args.confirmBackfillPersonDisplayFields) {
    throw new Error(
      '--confirm-backfill-person-display-fields is required when --apply is set for backfill:person-display-fields',
    );
  }
}

export interface BackfillPersonDisplayFieldsResult {
  mode: 'dry-run' | 'apply';
  peopleScanned: number;
  peopleWithLegacyMatch: number;
  peopleUpdated: number;
  populatedByField: Record<PersonDisplayProfileField, number>;
}

const emptyPopulatedByField = (): Record<PersonDisplayProfileField, number> =>
  PERSON_DISPLAY_PROFILE_FIELDS.reduce(
    (acc, field) => {
      acc[field] = 0;
      return acc;
    },
    {} as Record<PersonDisplayProfileField, number>,
  );

const asObjectIdKey = (value: unknown): string | undefined =>
  value instanceof mongoose.Types.ObjectId ? value.toString() : undefined;

export async function backfillPersonDisplayFields(options: {
  apply: boolean;
}): Promise<BackfillPersonDisplayFieldsResult> {
  const people = await Researcher.find({ accountId: { $exists: true }, archived: { $ne: true } })
    .select('_id accountId profile')
    .lean();

  const populatedByField = emptyPopulatedByField();
  let peopleScanned = 0;
  let peopleWithLegacyMatch = 0;
  let peopleUpdated = 0;

  if (people.length === 0) {
    return {
      mode: options.apply ? 'apply' : 'dry-run',
      peopleScanned,
      peopleWithLegacyMatch,
      peopleUpdated,
      populatedByField,
    };
  }

  const accountIds = Array.from(
    new Set(people.map((person: any) => asObjectIdKey(person.accountId)).filter(Boolean)),
  ).map((id) => new mongoose.Types.ObjectId(id as string));

  const accounts = accountIds.length
    ? await Account.find({ _id: { $in: accountIds } })
        .select('_id netid')
        .lean()
    : [];
  const netidByAccountId = new Map<string, string>();
  for (const account of accounts as any[]) {
    if (account._id && typeof account.netid === 'string') {
      netidByAccountId.set(account._id.toString(), account.netid);
    }
  }

  const netids = Array.from(new Set([...netidByAccountId.values()]));
  const users = netids.length
    ? await User.find({ netid: { $in: netids } })
        .select('netid title primaryDepartment imageUrl website')
        .lean()
    : [];
  const userByNetid = new Map<string, any>();
  for (const user of users as any[]) {
    if (typeof user.netid === 'string') userByNetid.set(user.netid, user);
  }

  for (const person of people as any[]) {
    peopleScanned += 1;
    const netid = person.accountId ? netidByAccountId.get(person.accountId.toString()) : undefined;
    if (!netid) continue;
    const user = userByNetid.get(netid);
    if (!user) continue;
    peopleWithLegacyMatch += 1;

    const composed = composeDisplayProfileFromLegacy({ user });
    const update = displayProfileFillUpdate(person.profile, composed);
    const fields = Object.keys(update) as PersonDisplayProfileField[];
    if (fields.length === 0) continue;

    const setDocument: Record<string, string> = {};
    for (const field of fields) {
      setDocument[`profile.${field}`] = update[field] as string;
    }
    assertBackfillUpdateIsDisplayOnly(setDocument);

    for (const field of fields) populatedByField[field] += 1;
    peopleUpdated += 1;

    if (options.apply) {
      await Researcher.updateOne({ _id: person._id }, { $set: setDocument });
    }
  }

  return {
    mode: options.apply ? 'apply' : 'dry-run',
    peopleScanned,
    peopleWithLegacyMatch,
    peopleUpdated,
    populatedByField,
  };
}

function writeOutput(report: unknown, output?: string): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
}

async function main() {
  const args = parseBackfillPersonDisplayFieldsArgs(process.argv.slice(2));
  assertBackfillPersonDisplayFieldsApplyAllowed(args);
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'backfill:person-display-fields',
    mongoUrl: process.env.MONGODBURL,
  });

  await initializeConnections();
  const result = await backfillPersonDisplayFields({ apply: args.apply });

  const report = {
    generatedAt: new Date().toISOString(),
    environment: guard.environment,
    db: guard.dbLabel,
    options: args,
    ...result,
  };
  console.log(JSON.stringify(report, null, 2));
  writeOutput(report, args.output);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main()
    .catch((error) => {
      console.error('Failed to backfill person display fields:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}

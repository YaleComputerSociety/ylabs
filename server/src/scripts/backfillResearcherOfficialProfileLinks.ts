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
  assertBackfillPushIsOfficialProfileLinkOnly,
  composeOfficialProfileLink,
  officialProfileLinkFillUpdate,
} from './backfillResearcherOfficialProfileLinksCore';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);

export interface BackfillResearcherOfficialProfileLinksArgs {
  apply: boolean;
  confirmBackfillResearcherOfficialProfileLinks: boolean;
  output?: string;
}

export function parseBackfillResearcherOfficialProfileLinksArgs(
  argv: string[],
): BackfillResearcherOfficialProfileLinksArgs {
  const args: BackfillResearcherOfficialProfileLinksArgs = {
    apply: false,
    confirmBackfillResearcherOfficialProfileLinks: false,
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
    if (arg === '--confirm-backfill-researcher-official-profile-links') {
      args.confirmBackfillResearcherOfficialProfileLinks = true;
      continue;
    }
    if (arg.startsWith('--confirm-backfill-researcher-official-profile-links=')) {
      throw new Error(
        '--confirm-backfill-researcher-official-profile-links does not accept a value',
      );
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
    throw new Error(`Unknown backfill:researcher-official-profile-links argument: ${arg}`);
  }

  return args;
}

export function assertBackfillResearcherOfficialProfileLinksApplyAllowed(
  args: Pick<
    BackfillResearcherOfficialProfileLinksArgs,
    'apply' | 'confirmBackfillResearcherOfficialProfileLinks'
  >,
): void {
  if (args.apply && !args.confirmBackfillResearcherOfficialProfileLinks) {
    throw new Error(
      '--confirm-backfill-researcher-official-profile-links is required when --apply is set for backfill:researcher-official-profile-links',
    );
  }
}

export interface BackfillResearcherOfficialProfileLinksResult {
  mode: 'dry-run' | 'apply';
  researchersScanned: number;
  researchersWithLegacyMatch: number;
  researchersUpdated: number;
}

const asObjectIdKey = (value: unknown): string | undefined =>
  value instanceof mongoose.Types.ObjectId ? value.toString() : undefined;

export async function backfillResearcherOfficialProfileLinks(options: {
  apply: boolean;
  verifiedAt?: Date;
}): Promise<BackfillResearcherOfficialProfileLinksResult> {
  const verifiedAt = options.verifiedAt ?? new Date();
  const researchers = await Researcher.find({
    accountId: { $exists: true },
    archived: { $ne: true },
  })
    .select('_id accountId profileLinks')
    .lean();

  let researchersScanned = 0;
  let researchersWithLegacyMatch = 0;
  let researchersUpdated = 0;

  if (researchers.length === 0) {
    return {
      mode: options.apply ? 'apply' : 'dry-run',
      researchersScanned,
      researchersWithLegacyMatch,
      researchersUpdated,
    };
  }

  const accountIds = Array.from(
    new Set(
      researchers.map((researcher: any) => asObjectIdKey(researcher.accountId)).filter(Boolean),
    ),
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
        .select('netid profileUrls')
        .lean()
    : [];
  const userByNetid = new Map<string, any>();
  for (const user of users as any[]) {
    if (typeof user.netid === 'string') userByNetid.set(user.netid, user);
  }

  for (const researcher of researchers as any[]) {
    researchersScanned += 1;
    const netid = researcher.accountId
      ? netidByAccountId.get(researcher.accountId.toString())
      : undefined;
    if (!netid) continue;
    const user = userByNetid.get(netid);
    if (!user) continue;

    const composed = composeOfficialProfileLink({ profileUrls: user.profileUrls }, verifiedAt);
    if (!composed) continue;
    researchersWithLegacyMatch += 1;

    const link = officialProfileLinkFillUpdate(researcher.profileLinks, composed);
    if (!link) continue;

    assertBackfillPushIsOfficialProfileLinkOnly({ profileLinks: link });
    researchersUpdated += 1;

    if (options.apply) {
      await Researcher.updateOne({ _id: researcher._id }, { $push: { profileLinks: link } });
    }
  }

  return {
    mode: options.apply ? 'apply' : 'dry-run',
    researchersScanned,
    researchersWithLegacyMatch,
    researchersUpdated,
  };
}

function writeOutput(report: unknown, output?: string): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
}

async function main() {
  const args = parseBackfillResearcherOfficialProfileLinksArgs(process.argv.slice(2));
  assertBackfillResearcherOfficialProfileLinksApplyAllowed(args);
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'backfill:researcher-official-profile-links',
    mongoUrl: process.env.MONGODBURL,
  });

  await initializeConnections();
  const result = await backfillResearcherOfficialProfileLinks({ apply: args.apply });

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
      console.error(
        'Failed to backfill researcher official profile links:',
        sanitizeLogValue(error),
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}

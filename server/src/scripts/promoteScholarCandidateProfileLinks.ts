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
  assertBackfillPushIsScholarProfileLinkOnly,
  composeScholarProfileLink,
  scholarProfileLinkFillUpdate,
} from './promoteScholarCandidateProfileLinksCore';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);

export interface PromoteScholarCandidateProfileLinksArgs {
  apply: boolean;
  confirmPromoteScholarCandidateProfileLinks: boolean;
  output?: string;
}

export function parsePromoteScholarCandidateProfileLinksArgs(
  argv: string[],
): PromoteScholarCandidateProfileLinksArgs {
  const args: PromoteScholarCandidateProfileLinksArgs = {
    apply: false,
    confirmPromoteScholarCandidateProfileLinks: false,
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
    if (arg === '--confirm-promote-scholar-candidate-profile-links') {
      args.confirmPromoteScholarCandidateProfileLinks = true;
      continue;
    }
    if (arg.startsWith('--confirm-promote-scholar-candidate-profile-links=')) {
      throw new Error('--confirm-promote-scholar-candidate-profile-links does not accept a value');
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
    throw new Error(`Unknown backfill:scholar-candidate-profile-links argument: ${arg}`);
  }

  return args;
}

export function assertPromoteScholarCandidateProfileLinksApplyAllowed(
  args: Pick<
    PromoteScholarCandidateProfileLinksArgs,
    'apply' | 'confirmPromoteScholarCandidateProfileLinks'
  >,
): void {
  if (args.apply && !args.confirmPromoteScholarCandidateProfileLinks) {
    throw new Error(
      '--confirm-promote-scholar-candidate-profile-links is required when --apply is set for backfill:scholar-candidate-profile-links',
    );
  }
}

export interface PromoteScholarCandidateProfileLinksResult {
  mode: 'apply' | 'dry-run';
  researchersScanned: number;
  researchersWithCandidateMatch: number;
  researchersUpdated: number;
}

const asObjectIdKey = (value: unknown): string | undefined =>
  value instanceof mongoose.Types.ObjectId ? value.toString() : undefined;

export async function promoteScholarCandidateProfileLinks(options: {
  apply: boolean;
  verifiedAt?: Date;
}): Promise<PromoteScholarCandidateProfileLinksResult> {
  const verifiedAt = options.verifiedAt ?? new Date();
  const researchers = await Researcher.find({
    accountId: { $exists: true },
    archived: { $ne: true },
  })
    .select('_id accountId profileLinks')
    .lean();

  let researchersScanned = 0;
  let researchersWithCandidateMatch = 0;
  let researchersUpdated = 0;

  if (researchers.length === 0) {
    return {
      mode: options.apply ? 'apply' : 'dry-run',
      researchersScanned,
      researchersWithCandidateMatch,
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
        .select('netid scholarCandidateProfileUrls')
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

    const composed = composeScholarProfileLink(
      { scholarCandidateProfileUrls: user.scholarCandidateProfileUrls },
      verifiedAt,
    );
    if (!composed) continue;
    researchersWithCandidateMatch += 1;

    const link = scholarProfileLinkFillUpdate(researcher.profileLinks, composed);
    if (!link) continue;

    assertBackfillPushIsScholarProfileLinkOnly({ profileLinks: link });
    researchersUpdated += 1;

    if (options.apply) {
      await Researcher.updateOne({ _id: researcher._id }, { $push: { profileLinks: link } });
    }
  }

  return {
    mode: options.apply ? 'apply' : 'dry-run',
    researchersScanned,
    researchersWithCandidateMatch,
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
  const args = parsePromoteScholarCandidateProfileLinksArgs(process.argv.slice(2));
  assertPromoteScholarCandidateProfileLinksApplyAllowed(args);
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'backfill:scholar-candidate-profile-links',
    mongoUrl: process.env.MONGODBURL,
  });

  await initializeConnections();
  const result = await promoteScholarCandidateProfileLinks({ apply: args.apply });

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
        'Failed to promote scholar candidate profile links:',
        sanitizeLogValue(error),
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}

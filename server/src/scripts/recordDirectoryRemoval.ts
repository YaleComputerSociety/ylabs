import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { DirectoryRemoval } from '../models/directoryRemoval';
import { ResearchEntity } from '../models/researchEntity';
import { Researcher } from '../models/researcher';
import { RoleAssignment } from '../models/roleAssignment';
import { readDirectoryRemovalKey } from '../utils/directoryRemovalDigest';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed } from './scriptWriteGuards';
import {
  countDirectoryRemovalReach,
  digestForRemoval,
  parseDirectoryRemovalArgs,
} from './directoryRemovalCore';

dotenv.config({ quiet: true });
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const SCRIPT_NAME = 'directory-removal:record';

async function readStandardInput(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new Error('Pipe the identifier on standard input, for example from a password manager.');
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8').trim();
}

async function reachOf(key: string, digest: string) {
  const [researchers, liveRoleEdges, rosterRows] = await Promise.all([
    Researcher.find({ archived: { $ne: true } })
      .select('identifiers profileLinks.url')
      .lean(),
    RoleAssignment.find({ archived: { $ne: true }, state: { $ne: 'HISTORICAL' } })
      .select('personId role -_id')
      .lean(),
    ResearchEntity.find({
      archived: { $ne: true },
      'rosterEnrichment.undergraduates.0': { $exists: true },
    })
      .select('rosterEnrichment.undergraduates.name -_id')
      .lean(),
  ]);
  return countDirectoryRemovalReach({
    key,
    digest,
    researchers: researchers as any,
    liveRoleEdges: liveRoleEdges as any,
    undergraduateRosters: rosterRows.map((row: any) => ({
      names: (row.rosterEnrichment?.undergraduates ?? []).map((entry: any) => entry.name),
    })),
  });
}

async function main(): Promise<void> {
  const args = parseDirectoryRemovalArgs(process.argv.slice(2));
  const key = readDirectoryRemovalKey();
  if (!key) {
    throw new Error(
      'No directory removal key is configured, so no entry can be recorded or matched.',
    );
  }
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  const digest = digestForRemoval(key, args.kind, await readStandardInput());
  await initializeConnections();

  const existing = await DirectoryRemoval.findOne({ digest }).lean();
  const stateBefore = !existing ? 'absent' : existing.withdrawnAt ? 'withdrawn' : 'active';
  const reach = await reachOf(key, digest);
  const action = args.withdrawReason ? 'withdraw' : 'record';

  let changed = false;
  if (args.apply && action === 'record' && stateBefore !== 'active') {
    await DirectoryRemoval.updateOne(
      { digest },
      {
        $set: { kind: args.kind, recordedAt: new Date() },
        $unset: { withdrawnAt: '', withdrawnReason: '' },
      },
      { upsert: true },
    );
    changed = true;
  }
  if (args.apply && action === 'withdraw' && stateBefore === 'active') {
    await DirectoryRemoval.updateOne(
      { digest },
      { $set: { withdrawnAt: new Date(), withdrawnReason: args.withdrawReason } },
    );
    changed = true;
  }

  console.log(
    JSON.stringify(
      {
        script: SCRIPT_NAME,
        generatedAt: new Date().toISOString(),
        environment: guard.environment,
        db: guard.dbLabel,
        mode: args.apply ? 'apply' : 'dry-run',
        action,
        kind: args.kind,
        stateBefore,
        changed,
        reach,
      },
      null,
      2,
    ),
  );
  await mongoose.disconnect();
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error));
    process.exitCode = 1;
  });
}

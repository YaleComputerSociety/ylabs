import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { IDENTIFIED_LEAD_FALLBACK_DERIVATION_KEYS } from '../services/accessAcceptanceLevel';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  RETIRED_IDENTIFIED_LEAD_WAYS_IN_DERIVATION_KEYS,
  assertAcceptanceDenylistStillGuards,
  assertIdentifiedLeadWaysInSignalsFullyRetired,
  retiredIdentifiedLeadWaysInFilter,
} from './retireIdentifiedLeadWaysInSignalsCore';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_NAME = 'retire:identified-lead-ways-in';
const COLLECTION = 'signals';

type MongoDb = NonNullable<typeof mongoose.connection.db>;

export interface RetireIdentifiedLeadWaysInArgs {
  apply: boolean;
  confirmRetireIdentifiedLeadWaysIn: boolean;
  output?: string;
}

export function parseRetireIdentifiedLeadWaysInArgs(
  argv: string[],
): RetireIdentifiedLeadWaysInArgs {
  const args: RetireIdentifiedLeadWaysInArgs = {
    apply: false,
    confirmRetireIdentifiedLeadWaysIn: false,
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
    if (arg === '--confirm-retire-identified-lead-ways-in') {
      args.confirmRetireIdentifiedLeadWaysIn = true;
      continue;
    }
    if (arg.startsWith('--confirm-retire-identified-lead-ways-in=')) {
      throw new Error('--confirm-retire-identified-lead-ways-in does not accept a value');
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
    throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }

  return args;
}

export function assertRetireIdentifiedLeadWaysInApplyAllowed(
  args: Pick<RetireIdentifiedLeadWaysInArgs, 'apply' | 'confirmRetireIdentifiedLeadWaysIn'>,
  env: NodeJS.ProcessEnv = process.env,
  mongoUrl?: string,
) {
  if (args.apply && !args.confirmRetireIdentifiedLeadWaysIn) {
    throw new Error(
      `--confirm-retire-identified-lead-ways-in is required when --apply is set for ${SCRIPT_NAME}`,
    );
  }

  return assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl,
    env,
  });
}

async function countLiveRetiredSignals(db: MongoDb): Promise<number> {
  return db.collection(COLLECTION).countDocuments(retiredIdentifiedLeadWaysInFilter);
}

export interface RetireIdentifiedLeadWaysInResult {
  mode: 'dry-run' | 'apply';
  derivationKeys: readonly string[];
  presentBefore: number;
  presentAfter: number;
  matched: number;
  modified: number;
  entitiesAffected: number;
}

/**
 * Archives rather than deletes. `archived: true` is how every other signal
 * retirement in this repo withdraws a claim, it keeps the provenance readable if
 * a reviewer asks what the corpus used to assert, and every reader already
 * filters on it.
 */
export async function retireIdentifiedLeadWaysInSignals(options: {
  apply: boolean;
  db?: MongoDb;
}): Promise<RetireIdentifiedLeadWaysInResult> {
  const db = options.db || mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not initialized');

  const presentBefore = await countLiveRetiredSignals(db);
  const entitiesAffected = (
    await db.collection(COLLECTION).distinct('researchEntityId', retiredIdentifiedLeadWaysInFilter)
  ).length;

  assertAcceptanceDenylistStillGuards({
    presentBefore,
    denylistPresent: RETIRED_IDENTIFIED_LEAD_WAYS_IN_DERIVATION_KEYS.every((key) =>
      IDENTIFIED_LEAD_FALLBACK_DERIVATION_KEYS.has(key),
    ),
  });

  let matched = 0;
  let modified = 0;

  if (options.apply && presentBefore > 0) {
    const result = await db.collection(COLLECTION).updateMany(retiredIdentifiedLeadWaysInFilter, {
      $set: { archived: true, archivedAt: new Date(), archivedReason: SCRIPT_NAME },
    });
    matched = result.matchedCount || 0;
    modified = result.modifiedCount || 0;
  }

  const presentAfter = await countLiveRetiredSignals(db);
  if (options.apply) assertIdentifiedLeadWaysInSignalsFullyRetired(presentAfter);

  return {
    mode: options.apply ? 'apply' : 'dry-run',
    derivationKeys: RETIRED_IDENTIFIED_LEAD_WAYS_IN_DERIVATION_KEYS,
    presentBefore,
    presentAfter,
    matched,
    modified,
    entitiesAffected,
  };
}

function writeOutput(report: unknown, output?: string): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
}

async function main() {
  const args = parseRetireIdentifiedLeadWaysInArgs(process.argv.slice(2));
  const guard = assertRetireIdentifiedLeadWaysInApplyAllowed(
    args,
    process.env,
    process.env.MONGODBURL,
  );

  await initializeConnections();
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not initialized');

  const result = await retireIdentifiedLeadWaysInSignals({ apply: args.apply });

  const report = {
    generatedAt: new Date().toISOString(),
    environment: guard.environment,
    databaseName: db.databaseName,
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
        'Failed to retire the identified-lead ways-in signals:',
        sanitizeLogValue(error),
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}

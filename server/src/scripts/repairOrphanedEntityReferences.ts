import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { ResearchGroupMember } from '../models/index';
import { ResearchEntityRelationship } from '../models/researchEntityRelationship';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  assertConnectedDatabaseMatchesEnvironment,
  buildOrphanMemberEntityReferencePipeline,
  buildOrphanRelationshipReferencePipeline,
  buildOrphanedEntityReferencePlan,
  isSupportedOrphanReferenceEnvironment,
  summarizeOrphanedEntityReferencePlan,
  type OrphanedEntityReferenceEnvironment,
} from './repairOrphanedEntityReferencesCore';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

dotenv.config();

const SCRIPT_NAME = 'research-entity:repair-orphaned-refs';
const CONFIRM_FLAG = '--confirm-orphaned-entity-reference-repair';

interface CliOptions {
  environment: OrphanedEntityReferenceEnvironment;
  apply: boolean;
  confirm: boolean;
  limit: number;
  output?: string;
}

function positiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function flagValue(argv: string[], index: number, flag: string): { value: string; next: number } {
  const inline = argv[index].includes('=') ? argv[index].split('=').slice(1).join('=') : undefined;
  if (inline !== undefined) return { value: inline, next: index };
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return { value, next: index + 1 };
}

export function parseArgs(argv: string[]): CliOptions {
  let environment: string | undefined;
  let apply = false;
  let confirm = false;
  let limit = 1000;
  let output: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply' || arg === '--execute') apply = true;
    else if (arg === '--dry-run') apply = false;
    else if (arg === CONFIRM_FLAG) confirm = true;
    else if (arg.startsWith(`${CONFIRM_FLAG}=`)) throw new Error(`${CONFIRM_FLAG} does not accept a value`);
    else if (arg === '--environment' || arg.startsWith('--environment=')) {
      const parsed = flagValue(argv, index, '--environment');
      environment = parsed.value;
      index = parsed.next;
    } else if (arg === '--limit' || arg.startsWith('--limit=')) {
      const parsed = flagValue(argv, index, '--limit');
      limit = positiveInteger(parsed.value, '--limit');
      index = parsed.next;
    } else if (arg === '--output' || arg.startsWith('--output=')) {
      const parsed = flagValue(argv, index, '--output');
      output = parsed.value;
      index = parsed.next;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!environment || !isSupportedOrphanReferenceEnvironment(environment)) {
    throw new Error(
      `--environment is required and must be one of development, beta, production-copy, production, test`,
    );
  }
  if (apply && !confirm) {
    throw new Error(`Refusing to apply without ${CONFIRM_FLAG}`);
  }

  return { environment, apply, confirm, limit, output };
}

export interface OrphanedEntityReferenceRunResult {
  summary: ReturnType<typeof summarizeOrphanedEntityReferencePlan>;
  relationshipDeleteIds: string[];
  memberArchiveIds: string[];
  applied: { relationshipsDeleted: number; membersArchived: number } | null;
}

export async function runOrphanedEntityReferenceRepair(options: {
  apply: boolean;
  limit: number;
  now?: Date;
}): Promise<OrphanedEntityReferenceRunResult> {
  const memberRows = await ResearchGroupMember.aggregate(
    buildOrphanMemberEntityReferencePipeline(options.limit),
  );
  const relationshipRows = await ResearchEntityRelationship.aggregate(
    buildOrphanRelationshipReferencePipeline(options.limit),
  );

  const plan = buildOrphanedEntityReferencePlan({
    memberRows,
    relationshipRows,
    limit: options.limit,
  });

  let applied: { relationshipsDeleted: number; membersArchived: number } | null = null;
  if (options.apply) {
    const relationshipIds = relationshipRows.map((row) => row._id);
    const memberIds = memberRows.map((row) => row._id);
    const deletion = relationshipIds.length
      ? await ResearchEntityRelationship.deleteMany({ _id: { $in: relationshipIds } })
      : { deletedCount: 0 };
    const archival = memberIds.length
      ? await ResearchGroupMember.updateMany(
          { _id: { $in: memberIds } },
          { $set: { archived: true, isCurrentMember: false, updatedAt: options.now || new Date() } },
        )
      : { modifiedCount: 0 };
    applied = {
      relationshipsDeleted: deletion.deletedCount || 0,
      membersArchived: archival.modifiedCount || 0,
    };
  }

  return {
    summary: summarizeOrphanedEntityReferencePlan(plan),
    relationshipDeleteIds: plan.relationshipDeleteIds,
    memberArchiveIds: plan.memberArchiveIds,
    applied,
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const resolvedOutput = options.output
    ? resolveSafeJsonReportOutputPath(options.output)
    : undefined;
  if (resolvedOutput && fs.existsSync(resolvedOutput)) {
    throw new Error(`--output already exists: refusing to overwrite ${resolvedOutput}`);
  }

  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });

  await initializeConnections();
  const connectedDatabaseName = mongoose.connection.db?.databaseName;
  assertConnectedDatabaseMatchesEnvironment({
    environment: options.environment,
    connectedDatabaseName,
    scriptName: SCRIPT_NAME,
  });

  const now = new Date();
  const result = await runOrphanedEntityReferenceRepair({
    apply: options.apply,
    limit: options.limit,
    now,
  });

  const report = {
    script: SCRIPT_NAME,
    mode: options.apply ? 'apply' : 'dry-run',
    environment: guard.environment,
    db: connectedDatabaseName || guard.dbLabel,
    generatedAt: now.toISOString(),
    summary: result.summary,
    applied: result.applied,
    plan: {
      relationshipDeleteIds: result.relationshipDeleteIds,
      memberArchiveIds: result.memberArchiveIds,
    },
  };

  console.log(JSON.stringify({ ...report, plan: undefined }, null, 2));

  if (resolvedOutput) {
    fs.writeFileSync(resolvedOutput, JSON.stringify(report, null, 2), { mode: 0o600, flag: 'wx' });
  }
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error(sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}

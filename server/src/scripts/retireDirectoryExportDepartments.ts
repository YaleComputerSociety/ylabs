import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { Researcher } from '../models/researcher';
import {
  DIRECTORY_EXPORT_SOURCE,
  catalogDepartment,
} from '../scrapers/directoryExportDepartmentEvidence';
import { resetOrgUnitCanonicalizerCache } from '../scrapers/orgUnitCanonicalization';
import { DIRECTORY_EXPORT_CODE_PATTERN } from '../scrapers/utils/directoryExportDepartment';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  DIRECTORY_EXPORT_DEPARTMENT_FIELDS,
  DIRECTORY_EXPORT_DEPARTMENT_ROLLBACK_REASON,
  planStoredDirectoryExportDepartments,
} from './retireDirectoryExportDepartmentsCore';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

export const CONFIRM_FLAG = '--confirm-retire-directory-export-departments';

export interface RetireDirectoryExportDepartmentsOptions {
  dryRun: boolean;
  confirmed: boolean;
  output?: string;
  keysOut?: string;
}

export function parseRetireDirectoryExportDepartmentsArgs(
  argv: string[],
): RetireDirectoryExportDepartmentsOptions {
  const options: RetireDirectoryExportDepartmentsOptions = { dryRun: true, confirmed: false };
  for (const arg of argv) {
    if (arg === '--apply') options.dryRun = false;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === CONFIRM_FLAG) options.confirmed = true;
    else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else if (arg.startsWith('--keys-out=')) {
      options.keysOut = resolveSafeJsonReportOutputPath(arg.slice('--keys-out='.length));
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

export interface RetireDirectoryExportDepartmentsResult {
  mode: 'dry-run' | 'apply';
  observationsToRetire: number;
  keysToRederive: number;
  researchersStoringAnExportCode: number;
  storedToCanonical: number;
  storedToCleared: number;
  retiredObservations: number;
  writtenStoredDepartments: number;
  canonicalTargets: Array<[string, number]>;
  keys: string[];
}

/**
 * Retire-and-clear, as `observations:retire-school-as-department` does (#5796). Retiring the
 * export observations does not touch a stored value, because a key that resolves nothing leaves
 * the stored field alone, so the stored export codes are rewritten by the same decode the
 * resolver applies: the catalog department, or cleared. Re-derive the printed keys afterwards
 * with `observations:rematerialize-user-keys --only-fields=primaryDepartment`.
 */
export async function runRetireDirectoryExportDepartments(options: {
  dryRun: boolean;
}): Promise<RetireDirectoryExportDepartmentsResult> {
  resetOrgUnitCanonicalizerCache();
  const canonicalDepartment = await catalogDepartment();
  if (!canonicalDepartment) {
    throw new Error(
      'The org_units department catalog is unavailable, so no export code can be decoded; seed it first.',
    );
  }

  const observations = (await Observation.find({
    entityType: 'user',
    sourceName: DIRECTORY_EXPORT_SOURCE,
    field: { $in: DIRECTORY_EXPORT_DEPARTMENT_FIELDS },
    superseded: { $ne: true },
  })
    .select('_id entityKey')
    .lean()) as Array<{ _id: unknown; entityKey: string }>;
  const keys = [...new Set(observations.map((observation) => observation.entityKey))].sort();

  const stored = (await Researcher.find({
    archived: { $ne: true },
    'profile.primaryDepartment': { $regex: DIRECTORY_EXPORT_CODE_PATTERN.source },
  })
    .select('_id profile.primaryDepartment')
    .lean()) as Array<{ _id: unknown; profile?: { primaryDepartment?: string } }>;
  const plan = planStoredDirectoryExportDepartments(
    stored.map((row) => ({
      id: String(row._id),
      primaryDepartment: String(row.profile?.primaryDepartment ?? ''),
    })),
    canonicalDepartment,
  );

  let retiredObservations = 0;
  let writtenStoredDepartments = 0;
  if (!options.dryRun) {
    const retired = await Observation.updateMany(
      {
        _id: { $in: observations.map((observation) => observation._id) },
        superseded: { $ne: true },
      },
      {
        $set: {
          superseded: true,
          rollback: {
            rolledBackAt: new Date(),
            reason: DIRECTORY_EXPORT_DEPARTMENT_ROLLBACK_REASON,
          },
        },
      },
    );
    retiredObservations = retired.modifiedCount || 0;
    for (const row of plan.canonical) {
      const written = await Researcher.updateOne(
        { _id: new mongoose.Types.ObjectId(row.id), 'profile.primaryDepartment': row.from },
        { $set: { 'profile.primaryDepartment': row.to } },
      );
      writtenStoredDepartments += written.modifiedCount || 0;
    }
    for (const row of plan.cleared) {
      const written = await Researcher.updateOne(
        { _id: new mongoose.Types.ObjectId(row.id), 'profile.primaryDepartment': row.from },
        { $unset: { 'profile.primaryDepartment': '' } },
      );
      writtenStoredDepartments += written.modifiedCount || 0;
    }
  }

  const targets = new Map<string, number>();
  for (const row of plan.canonical) targets.set(row.to, (targets.get(row.to) || 0) + 1);
  return {
    mode: options.dryRun ? 'dry-run' : 'apply',
    observationsToRetire: observations.length,
    keysToRederive: keys.length,
    researchersStoringAnExportCode: stored.length,
    storedToCanonical: plan.canonical.length,
    storedToCleared: plan.cleared.length,
    retiredObservations,
    writtenStoredDepartments,
    canonicalTargets: [...targets.entries()].sort((left, right) => right[1] - left[1]),
    keys,
  };
}

async function main(): Promise<void> {
  const options = parseRetireDirectoryExportDepartmentsArgs(process.argv.slice(2));
  const apply = !options.dryRun;
  if (apply && !options.confirmed) throw new Error(`Apply mode requires ${CONFIRM_FLAG}.`);
  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'retire directory export department observations',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${apply ? 'apply' : 'dry-run'}`,
  );
  await initializeConnections();
  try {
    const result = await runRetireDirectoryExportDepartments({ dryRun: options.dryRun });
    if (options.keysOut) {
      fs.mkdirSync(path.dirname(options.keysOut), { recursive: true });
      fs.writeFileSync(options.keysOut, JSON.stringify(result.keys, null, 2));
      console.log(`Saved ${result.keys.length} keys to ${options.keysOut}`);
    }
    if (options.output) {
      fs.mkdirSync(path.dirname(options.output), { recursive: true });
      fs.writeFileSync(
        options.output,
        JSON.stringify(
          { generatedAt: new Date().toISOString(), environment: guard.environment, result },
          null,
          2,
        ),
      );
      console.log(`Saved report to ${options.output}`);
    }
    const { keys: _keys, ...summary } = result;
    console.log(JSON.stringify(summary, null, 2));
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

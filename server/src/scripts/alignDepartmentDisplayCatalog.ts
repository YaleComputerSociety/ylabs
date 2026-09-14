import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Department } from '../models/department';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  displayNameFor,
  planDepartmentDisplayAlignment,
  summarizeDepartmentDisplayPlan,
  type DepartmentDisplayPlan,
  type DepartmentDisplayRow,
} from './alignDepartmentDisplayCatalogCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export interface DepartmentDisplayCliOptions {
  dryRun: boolean;
  confirmDepartmentDisplay: boolean;
  output?: string;
}

export function parseDepartmentDisplayArgs(argv: string[]): DepartmentDisplayCliOptions {
  const options: DepartmentDisplayCliOptions = {
    dryRun: true,
    confirmDepartmentDisplay: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply' || arg === '--mode=apply') {
      options.dryRun = false;
    } else if (arg === '--dry-run' || arg === '--mode=dry-run') {
      options.dryRun = true;
    } else if (arg === '--confirm-department-display') {
      options.confirmDepartmentDisplay = true;
    } else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

export async function runDepartmentDisplayAlignment(options: { dryRun: boolean }): Promise<{
  mode: 'dry-run' | 'apply';
  plan: DepartmentDisplayPlan;
  summary: ReturnType<typeof summarizeDepartmentDisplayPlan>;
}> {
  const docs = await Department.find({})
    .select('_id abbreviation name displayName aliases isActive')
    .lean<
      {
        _id: unknown;
        abbreviation: string;
        name: string;
        displayName?: string;
        aliases?: string[];
        isActive?: boolean;
      }[]
    >();
  const existing: DepartmentDisplayRow[] = docs.map((doc) => ({
    id: String(doc._id),
    abbreviation: doc.abbreviation,
    name: doc.name,
    displayName: doc.displayName,
    aliases: doc.aliases,
    isActive: doc.isActive,
  }));

  const plan = planDepartmentDisplayAlignment(existing);

  if (!options.dryRun) {
    for (const row of plan.rows) {
      if (row.action === 'rename') {
        await Department.updateOne(
          { _id: row.targetId },
          { $set: { name: row.toName, displayName: row.displayName, aliases: row.aliases } },
        );
        continue;
      }
      if (row.action === 'repair-aliases') {
        await Department.updateOne({ _id: row.targetId }, { $set: { aliases: row.aliases } });
        continue;
      }
      await Department.create({
        abbreviation: row.abbreviation,
        name: row.name,
        displayName: displayNameFor(row.abbreviation, row.name),
        categories: row.categories,
        primaryCategory: row.primaryCategory,
        colorKey: row.colorKey,
        aliases: row.aliases,
        isActive: true,
      });
    }
  }

  return {
    mode: options.dryRun ? 'dry-run' : 'apply',
    plan,
    summary: summarizeDepartmentDisplayPlan(plan),
  };
}

async function main(): Promise<void> {
  const options = parseDepartmentDisplayArgs(process.argv.slice(2));
  const apply = !options.dryRun;

  if (apply && !options.confirmDepartmentDisplay) {
    throw new Error('Apply mode requires --confirm-department-display.');
  }

  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'department display catalog alignment',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${apply ? 'apply' : 'dry-run'}`,
  );

  await initializeConnections();
  try {
    const result = await runDepartmentDisplayAlignment({ dryRun: options.dryRun });
    if (options.output) {
      const safeOutput = resolveSafeJsonReportOutputPath(options.output);
      fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
      fs.writeFileSync(
        safeOutput,
        JSON.stringify(
          { generatedAt: new Date().toISOString(), environment: guard.environment, ...result },
          null,
          2,
        ),
      );
      console.log(`Saved department display alignment report to ${safeOutput}`);
    }
    console.log(JSON.stringify(result, null, 2));
    if (apply && result.plan.rows.length > 0) {
      console.log(
        'The served config is cached, so a running server picks these names up on the next config refresh.',
      );
    }
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

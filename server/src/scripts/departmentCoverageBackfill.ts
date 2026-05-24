import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Department } from '../models/department';
import { ResearchEntity } from '../models/researchEntity';
import { planDepartmentCoverageBackfill } from './departmentCoverageBackfillCore';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

interface Args {
  apply: boolean;
  limit: number;
  slug?: string;
  includeArchived: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    apply: false,
    limit: 0,
    includeArchived: false,
  };

  for (const arg of argv) {
    if (arg === '--apply') {
      args.apply = true;
      continue;
    }
    if (arg === '--include-archived') {
      args.includeArchived = true;
      continue;
    }
    if (arg.startsWith('--limit=')) {
      const parsed = Number(arg.slice('--limit='.length));
      if (Number.isFinite(parsed) && parsed >= 0) args.limit = Math.floor(parsed);
      continue;
    }
    if (arg.startsWith('--slug=')) {
      const value = arg.slice('--slug='.length).trim();
      if (value) args.slug = value;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'research-entity:department-backfill',
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const entityFilter: Record<string, unknown> = args.includeArchived
    ? {}
    : { archived: { $ne: true } };
  if (args.slug) entityFilter.slug = args.slug;

  const [departments, entities] = await Promise.all([
    Department.find({ isActive: true })
      .select('_id abbreviation name displayName aliases')
      .lean(),
    ResearchEntity.find(entityFilter)
      .select('_id slug name displayName departments manuallyLockedFields')
      .sort({ slug: 1 })
      .limit(args.limit || 0)
      .lean(),
  ]);

  const plan = planDepartmentCoverageBackfill(entities as any[], departments as any[]);
  let updated = 0;
  const failures: Array<{ id: string; slug: string; error: string }> = [];

  if (args.apply) {
    for (const row of plan.planned) {
      try {
        const result = await ResearchEntity.updateOne(
          {
            _id: new mongoose.Types.ObjectId(row.id),
            manuallyLockedFields: { $ne: 'departments' },
          },
          { $set: { departments: row.after } },
        );
        updated += result.modifiedCount || 0;
      } catch (error) {
        failures.push({
          id: row.id,
          slug: row.slug,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: args.apply ? 'apply' : 'dry-run',
        generatedAt: new Date().toISOString(),
        filters: {
          slug: args.slug || null,
          limit: args.limit,
          includeArchived: args.includeArchived,
        },
        summary: plan.summary,
        planned: plan.planned.slice(0, 50),
        omittedPlanned: Math.max(0, plan.planned.length - 50),
        updated,
        failures,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined);
  });

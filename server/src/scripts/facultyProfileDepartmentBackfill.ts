import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Department } from '../models/department';
import { User } from '../models/user';
import { planFacultyProfileDepartmentBackfill } from './facultyProfileDepartmentBackfillCore';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

interface Args {
  apply: boolean;
  limit: number;
  netid?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, limit: 0 };

  for (const arg of argv) {
    if (arg === '--apply') {
      args.apply = true;
      continue;
    }
    if (arg.startsWith('--limit=')) {
      const parsed = Number(arg.slice('--limit='.length));
      if (Number.isFinite(parsed) && parsed >= 0) args.limit = Math.floor(parsed);
      continue;
    }
    if (arg.startsWith('--netid=')) {
      const value = arg.slice('--netid='.length).trim().toLowerCase();
      if (value) args.netid = value;
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
    scriptName: 'faculty-profile:department-backfill',
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const userFilter: Record<string, unknown> = {
    userType: { $in: ['professor', 'faculty'] },
    $or: [
      { primaryDepartment: { $exists: true, $ne: '' } },
      { secondaryDepartments: { $exists: true, $ne: [] } },
      { departments: { $exists: true, $ne: [] } },
    ],
  };
  if (args.netid) userFilter.netid = args.netid;

  const [departments, users] = await Promise.all([
    Department.find({ isActive: true }).select('_id abbreviation name displayName aliases').lean(),
    User.find(userFilter)
      .select('_id netid fname lname userType primaryDepartment secondaryDepartments departments')
      .sort({ netid: 1 })
      .limit(args.limit || 0)
      .lean(),
  ]);

  const plan = planFacultyProfileDepartmentBackfill(users as any[], departments as any[]);
  let updated = 0;
  const failures: Array<{ id: string; netid: string; error: string }> = [];

  if (args.apply) {
    for (const row of plan.planned) {
      try {
        const result = await User.updateOne(
          { _id: new mongoose.Types.ObjectId(row.id) },
          {
            $set: {
              primaryDepartment: row.after.primaryDepartment,
              secondaryDepartments: row.after.secondaryDepartments,
              departments: row.after.departments,
            },
          },
        );
        updated += result.modifiedCount || 0;
      } catch (error) {
        failures.push({
          id: row.id,
          netid: row.netid,
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
          netid: args.netid || null,
          limit: args.limit,
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

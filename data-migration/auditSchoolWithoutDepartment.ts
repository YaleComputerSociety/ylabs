import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { researchEntityHasSchoolButNoRealDepartment } from '../server/src/scrapers/orgUnitCanonicalization';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../server/.env') });

interface AuditRow {
  slug?: string;
  name?: string;
  school?: unknown;
  schools?: unknown;
  departments?: unknown;
  studentVisibilityTier?: unknown;
}

export interface SchoolDepartmentDebtSummary {
  totalConsidered: number;
  flagged: number;
  bySchool: Array<{ school: string; count: number; samples: string[] }>;
}

const asStringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

function primarySchool(row: AuditRow): string {
  if (typeof row.school === 'string' && row.school.trim()) return row.school.trim();
  const schools = asStringList(row.schools);
  return schools[0]?.trim() || '(no school name)';
}

export function summarizeSchoolDepartmentDebt(rows: AuditRow[]): SchoolDepartmentDebtSummary {
  const bySchool = new Map<string, { count: number; samples: string[] }>();
  let flagged = 0;
  for (const row of rows) {
    if (!researchEntityHasSchoolButNoRealDepartment(row)) continue;
    flagged += 1;
    const school = primarySchool(row);
    const entry = bySchool.get(school) ?? { count: 0, samples: [] };
    entry.count += 1;
    if (entry.samples.length < 8) entry.samples.push(row.slug || row.name || '(unnamed)');
    bySchool.set(school, entry);
  }
  return {
    totalConsidered: rows.length,
    flagged,
    bySchool: Array.from(bySchool.entries())
      .map(([school, entry]) => ({ school, count: entry.count, samples: entry.samples }))
      .sort((left, right) => right.count - left.count),
  };
}

function servedOnly(argv: string[]): boolean {
  return !argv.includes('--all-tiers');
}

async function main(): Promise<void> {
  const url = process.env.MONGODBURL;
  if (!url) {
    console.error('ERROR: MONGODBURL not set in server/.env');
    process.exit(1);
  }
  const onlyServed = servedOnly(process.argv.slice(2));
  await mongoose.connect(url);
  try {
    const db = mongoose.connection.db;
    if (!db) throw new Error('No database handle after connect');
    const filter: Record<string, unknown> = { archived: { $ne: true } };
    if (onlyServed) filter.studentVisibilityTier = 'student_ready';
    const rows = await db
      .collection<AuditRow>('research_entities')
      .find(filter, { projection: { slug: 1, name: 1, school: 1, schools: 1, departments: 1 } })
      .toArray();
    const summary = summarizeSchoolDepartmentDebt(rows);

    console.log('\n=== School-without-real-department coverage debt ===');
    console.log(`Scope: ${onlyServed ? 'student_ready served corpus' : 'all non-archived entities'}`);
    console.log(`Considered: ${summary.totalConsidered}`);
    console.log(
      `Flagged (school present, no department below the school level): ${summary.flagged}`,
    );
    for (const bucket of summary.bySchool) {
      console.log(`  ${bucket.school}: ${bucket.count}`);
      for (const sample of bucket.samples) console.log(`    - ${sample}`);
    }
    if (summary.flagged === 0) {
      console.log('No school-bearing entity is missing a department below the school level.');
    }
  } finally {
    await mongoose.disconnect();
  }
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

/**
 * Backfill v4 StudentProfile identity rows from legacy User student fields.
 *
 * Dry-run by default; pass --apply to write. Supports --limit N / --limit=N.
 */
import mongoose from '../server/node_modules/mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { Department } from '../server/src/models/department';
import { StudentProfile } from '../server/src/models/studentProfile';
import { User } from '../server/src/models/user';

dotenv.config({ path: path.resolve(__dirname, '../server/.env') });

const APPLY = process.argv.includes('--apply') || process.argv.includes('--live');

function parseLimit(): number | undefined {
  const eq = process.argv.find((arg) => arg.startsWith('--limit='));
  const raw = eq ? eq.split('=')[1] : process.argv[process.argv.indexOf('--limit') + 1];
  if (!raw || raw.startsWith('--')) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function norm(value?: string): string {
  return (value || '').trim().toLowerCase();
}

function compact(values: Array<string | undefined | null>): string[] {
  return Array.from(
    new Set(values.map((value) => (value || '').trim()).filter((value) => value.length > 0)),
  );
}

function graduationYear(raw?: string): number | undefined {
  if (!raw) return undefined;
  const match = String(raw).match(/\b(20\d{2})\b/);
  if (!match) return undefined;
  const year = Number.parseInt(match[1], 10);
  return year >= 2020 && year <= 2100 ? year : undefined;
}

async function buildDepartmentMap(): Promise<Map<string, mongoose.Types.ObjectId>> {
  const departments = await Department.find({}).lean<any[]>();
  const byName = new Map<string, mongoose.Types.ObjectId>();
  for (const dept of departments) {
    for (const key of [dept.name, dept.displayName, dept.abbreviation]) {
      if (key) byName.set(norm(key), dept._id);
    }
  }
  return byName;
}

function departmentIdsFor(
  names: string[],
  byName: Map<string, mongoose.Types.ObjectId>,
): mongoose.Types.ObjectId[] {
  if (names.length === 0) return [];
  return Array.from(
    new Set(compact(names).map((name) => byName.get(norm(name))).filter(Boolean).map(String)),
  ).map((id) => new mongoose.Types.ObjectId(id));
}

async function main(): Promise<void> {
  const url = process.env.MONGODBURL;
  if (!url) {
    console.error('ERROR: MONGODBURL not set');
    process.exit(1);
  }

  const limit = parseLimit();
  console.log('\n=== Backfill v4 StudentProfile identity bridge ===');
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  console.log(`Limit: ${limit ?? 'none'}\n`);

  await mongoose.connect(url);

  const filter = { userType: { $in: ['undergraduate', 'graduate', 'student'] } };
  const total = await User.countDocuments(filter);
  const query = User.find(filter).sort({ netid: 1 }).lean<any[]>();
  if (limit) query.limit(limit);
  const users = await query;
  const departmentsByName = await buildDepartmentMap();
  console.log(`Student users found: ${total}; processing ${users.length}`);

  let upserted = 0;
  let linkedUsers = 0;
  let skipped = 0;
  const errors: Array<{ netid: string; error: string }> = [];

  for (const user of users) {
    if (!user.netid) {
      skipped++;
      continue;
    }

    const majorDepartmentIds = await departmentIdsFor([
      ...(Array.isArray(user.major) ? user.major : []),
      ...(Array.isArray(user.departments) ? user.departments : []),
    ], departmentsByName);

    try {
      if (APPLY) {
        const profile = await StudentProfile.findOneAndUpdate(
          { netid: user.netid },
          {
            $set: {
              userId: user._id,
              netid: user.netid,
              graduationYear: graduationYear(user.year),
              majorDepartmentIds,
            },
            $setOnInsert: {
              lookingFor: 'exploring',
              researchAreaIds: [],
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        ).lean<any>();
        await User.updateOne(
          { _id: user._id, $or: [{ studentProfileId: { $exists: false } }, { studentProfileId: null }] },
          { $set: { studentProfileId: profile._id } },
        );
      }
      upserted++;
      if (!user.studentProfileId) linkedUsers++;
    } catch (err: any) {
      errors.push({ netid: user.netid, error: err?.message || String(err) });
    }
  }

  console.log('\nDone.');
  console.log(`  Users processed:          ${users.length}`);
  console.log(`  Student rows upserted:    ${upserted} ${APPLY ? '' : '(dry run)'}`);
  console.log(`  User links added:         ${linkedUsers} ${APPLY ? '' : '(dry run)'}`);
  console.log(`  Skipped:                  ${skipped}`);
  console.log(`  Errors:                   ${errors.length}`);
  for (const error of errors.slice(0, 10)) console.log(`  ${error.netid}: ${error.error}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

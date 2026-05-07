/**
 * Backfill v4 FacultyMember identity rows from legacy User faculty fields.
 *
 * Dry-run by default; pass --apply to write. Supports --limit N / --limit=N.
 */
import mongoose from '../server/node_modules/mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { FacultyMember } from '../server/src/models/facultyMember';
import { Department } from '../server/src/models/department';
import { User } from '../server/src/models/user';
import { chunk } from './v4MigrationUtils';

dotenv.config({ path: path.resolve(__dirname, '../server/.env') });

const APPLY = process.argv.includes('--apply') || process.argv.includes('--live');

function parseLimit(): number | undefined {
  const eq = process.argv.find((arg) => arg.startsWith('--limit='));
  const raw = eq ? eq.split('=')[1] : process.argv[process.argv.indexOf('--limit') + 1];
  if (!raw || raw.startsWith('--')) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function isFacultyTitle(title?: string): boolean {
  const lower = (title || '').toLowerCase();
  return [
    'professor',
    'lecturer',
    'instructor',
    'research scientist',
    'research fellow',
    'senior lector',
    'clinical',
  ].some((keyword) => lower.includes(keyword));
}

function compact(values: Array<string | undefined | null>): string[] {
  return Array.from(
    new Set(values.map((value) => (value || '').trim()).filter((value) => value.length > 0)),
  );
}

function norm(value?: string): string {
  return (value || '').trim().toLowerCase();
}

function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['\u2018\u2019]s\b/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
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

function departmentIdsFor(names: string[], byName: Map<string, mongoose.Types.ObjectId>): {
  primaryDepartmentId?: mongoose.Types.ObjectId;
  departmentIds: mongoose.Types.ObjectId[];
} {
  if (names.length === 0) return { departmentIds: [] };
  const ids = compact(names).map((name) => byName.get(norm(name))).filter(Boolean);
  return {
    primaryDepartmentId: ids[0],
    departmentIds: Array.from(new Set(ids.map(String))).map((id) => new mongoose.Types.ObjectId(id)),
  };
}

async function main(): Promise<void> {
  const url = process.env.MONGODBURL;
  if (!url) {
    console.error('ERROR: MONGODBURL not set');
    process.exit(1);
  }

  const limit = parseLimit();
  console.log('\n=== Backfill v4 FacultyMember identity bridge ===');
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  console.log(`Limit: ${limit ?? 'none'}\n`);

  await mongoose.connect(url);

  const filter = {
    $or: [
      { userType: { $in: ['professor', 'faculty'] } },
      { title: /professor|lecturer|instructor|research scientist|research fellow|clinical/i },
    ],
  };
  const total = await User.countDocuments(filter);
  const query = User.find(filter).sort({ netid: 1 }).lean<any[]>();
  if (limit) query.limit(limit);
  const users = await query;
  const departmentsByName = await buildDepartmentMap();
  const emailCounts = new Map<string, number>();
  for (const user of users) {
    const email = String(user.email || '').trim().toLowerCase();
    if (email) emailCounts.set(email, (emailCounts.get(email) || 0) + 1);
  }
  console.log(`Faculty-like users found: ${total}; processing ${users.length}`);

  let upserted = 0;
  let linkedUsers = 0;
  let skipped = 0;
  const errors: Array<{ netid: string; error: string }> = [];
  const facultyOps: any[] = [];
  const usersToLink: any[] = [];

  for (const user of users) {
    if (!user.netid || !user.email || (!isFacultyTitle(user.title) && user.userType === 'unknown')) {
      skipped++;
      continue;
    }

    const departments = compact([
      user.primary_department,
      ...(Array.isArray(user.secondary_departments) ? user.secondary_departments : []),
      ...(Array.isArray(user.departments) ? user.departments : []),
    ]);
    const deptIds = departmentIdsFor(departments, departmentsByName);
    const name = compact([user.fname, user.lname]).join(' ') || user.email || user.netid;
    const email = String(user.email || '').trim().toLowerCase();
    const setFields: Record<string, unknown> = {
      userId: user._id,
      netid: user.netid,
      name,
      firstName: user.fname || '',
      lastName: user.lname || '',
      photoUrl: user.image_url || '',
      websiteUrl: user.website || '',
      bio: user.bio || '',
      title: user.title || '',
      primaryDepartmentId: deptIds.primaryDepartmentId,
      departmentIds: deptIds.departmentIds,
      researchInterests: Array.isArray(user.research_interests) ? user.research_interests : [],
      topics: Array.isArray(user.topics) ? user.topics : [],
      profileUrls: user.profile_urls || {},
      openAlexId: user.openalex_id || undefined,
      orcidId: user.orcid || undefined,
      activeAtYaleCache: true,
      lastObservedAt: new Date(),
    };
    if (email && emailCounts.get(email) === 1) setFields.email = email;
    const facultyUpdate = {
      $set: setFields,
      $setOnInsert: {
        slug: slugify(`${name || user.netid}-${user.netid}`),
      },
    };

    try {
      if (APPLY) {
        facultyOps.push({
          updateOne: {
            filter: { netid: user.netid },
            update: facultyUpdate,
            upsert: true,
          },
        });
        usersToLink.push(user);
      }
      upserted++;
      if (!user.facultyMemberId) linkedUsers++;
    } catch (err: any) {
      errors.push({ netid: user.netid, error: err?.message || String(err) });
    }
  }

  if (APPLY) {
    for (const ops of chunk(facultyOps, 1000)) {
      if (ops.length > 0) await FacultyMember.bulkWrite(ops, { ordered: false });
    }

    const facultyByNetid = new Map(
      (await FacultyMember.find(
        { netid: { $in: usersToLink.map((user) => user.netid) } },
        { _id: 1, netid: 1 },
      ).lean<any[]>()).map((faculty) => [faculty.netid, faculty._id]),
    );

    const userOps = usersToLink
      .map((user) => {
        const facultyMemberId = facultyByNetid.get(user.netid);
        if (!facultyMemberId) return null;
        return {
          updateOne: {
            filter: {
              _id: user._id,
              $or: [{ facultyMemberId: { $exists: false } }, { facultyMemberId: null }],
            },
            update: { $set: { facultyMemberId } },
          },
        };
      })
      .filter(Boolean);
    for (const ops of chunk(userOps, 1000)) {
      if (ops.length > 0) await User.bulkWrite(ops as any[], { ordered: false });
    }
  }

  console.log('\nDone.');
  console.log(`  Users processed:        ${users.length}`);
  console.log(`  Faculty rows upserted:  ${upserted} ${APPLY ? '' : '(dry run)'}`);
  console.log(`  User links added:       ${linkedUsers} ${APPLY ? '' : '(dry run)'}`);
  console.log(`  Skipped:                ${skipped}`);
  console.log(`  Errors:                 ${errors.length}`);
  for (const error of errors.slice(0, 10)) console.log(`  ${error.netid}: ${error.error}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

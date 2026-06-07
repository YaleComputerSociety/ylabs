/**
 * Backfill v4 FacultyMember identity rows from legacy User faculty fields.
 *
 * Dry-run by default; pass --apply to write. Supports --limit N / --limit=N.
 */
import mongoose from '../server/node_modules/mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { FacultyMember } from '../server/src/models/facultyMember';
import { Department } from '../server/src/models/department';
import { User } from '../server/src/models/user';
import { resolveScraperEnvironment } from '../server/src/scrapers/scraperEnvironment';
import {
  buildV4MigrationOutput,
  chunk,
  connectForMigration,
  disconnectForMigration,
  parseMigrationOptions,
  type MigrationOptions,
} from './v4MigrationUtils';

const __filename = fileURLToPath(import.meta.url);

interface V4FacultyMemberBackfillResult {
  usersProcessed: number;
  facultyRowsUpserted: number;
  userLinksAdded: number;
  skipped: number;
  errorCount: number;
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

function writeV4FacultyMemberBackfillOutput(payload: object, outputPath?: string): void {
  if (!outputPath) return;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
}

export async function backfillV4FacultyMembers(
  options: MigrationOptions = parseMigrationOptions(),
): Promise<ReturnType<typeof buildV4MigrationOutput<V4FacultyMemberBackfillResult>>> {
  await connectForMigration('Backfill v4 FacultyMember identity bridge', options);

  try {
    console.log(`Limit: ${options.limit ?? 'none'}\n`);

    const filter = {
    $or: [
      { userType: { $in: ['professor', 'faculty'] } },
      { title: /professor|lecturer|instructor|research scientist|research fellow|clinical/i },
    ],
  };
  const total = await User.countDocuments(filter);
  const query = User.find(filter).sort({ netid: 1 }).lean<any[]>();
  if (options.limit) query.limit(options.limit);
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
      if (options.apply) {
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

  if (options.apply) {
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

    const output = buildV4MigrationOutput(
      {
        usersProcessed: users.length,
        facultyRowsUpserted: upserted,
        userLinksAdded: linkedUsers,
        skipped,
        errorCount: errors.length,
      },
      {
        environment: resolveScraperEnvironment(process.env),
        db: FacultyMember.db.db?.databaseName || FacultyMember.db.name,
        options,
      },
    );

    console.log('\nDone.');
    console.log(`  Users processed:        ${users.length}`);
    console.log(`  Faculty rows upserted:  ${upserted} ${options.apply ? '' : '(dry run)'}`);
    console.log(`  User links added:       ${linkedUsers} ${options.apply ? '' : '(dry run)'}`);
    console.log(`  Skipped:                ${skipped}`);
    console.log(`  Errors:                 ${errors.length}`);
    for (const error of errors.slice(0, 10)) console.log(`  ${error.netid}: ${error.error}`);
    writeV4FacultyMemberBackfillOutput(output, options.output);
    if (options.output) console.log(`Wrote v4 faculty member backfill report to ${options.output}`);

    return output;
  } finally {
    await disconnectForMigration();
  }
}

if (process.argv[1] && __filename === path.resolve(process.argv[1])) {
  backfillV4FacultyMembers().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

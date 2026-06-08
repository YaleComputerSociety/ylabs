/**
 * Backfill v4 ResearchGroupMember faculty bridge fields.
 *
 * Dry-run by default; pass --apply to write. Supports --limit N / --limit=N.
 */
import mongoose from '../server/node_modules/mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { FacultyMember } from '../server/src/models/facultyMember';
import { ResearchGroup } from '../server/src/models/researchGroup';
import { ResearchGroupMember } from '../server/src/models/researchGroupMember';
import { User } from '../server/src/models/user';
import { resolveScraperEnvironment } from '../server/src/scrapers/scraperEnvironment';
import {
  buildV4MigrationOutput,
  connectForMigration,
  disconnectForMigration,
  parseMigrationOptions,
  type MigrationOptions,
} from './v4MigrationUtils';

const __filename = fileURLToPath(import.meta.url);

interface V4ResearchGroupMemberBackfillResult {
  membersProcessed: number;
  memberLinksAdded: number;
  claimedPiRowsUpserted: number;
  skipped: number;
  errorCount: number;
}

async function facultyIdForMember(member: any): Promise<mongoose.Types.ObjectId | null> {
  if (member.userId) {
    const user = await User.findById(member.userId, { facultyMemberId: 1, netid: 1 }).lean<any>();
    if (user?.facultyMemberId) return user.facultyMemberId;
    if (user?.netid) {
      const faculty = await FacultyMember.findOne({ netid: user.netid }, { _id: 1 }).lean<any>();
      if (faculty?._id) return faculty._id;
    }
  }
  if (member.email) {
    const faculty = await FacultyMember.findOne(
      { email: String(member.email).trim().toLowerCase() },
      { _id: 1 },
    ).lean<any>();
    if (faculty?._id) return faculty._id;
  }
  return null;
}

function writeV4ResearchGroupMemberBackfillOutput(payload: object, outputPath?: string): void {
  if (!outputPath) return;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
}

export async function backfillV4ResearchGroupMembers(
  options: MigrationOptions = parseMigrationOptions(),
): Promise<ReturnType<typeof buildV4MigrationOutput<V4ResearchGroupMemberBackfillResult>>> {
  await connectForMigration('Backfill v4 ResearchGroupMember faculty bridge', options);

  try {
    console.log(`Limit: ${options.limit ?? 'none'}\n`);

  const filter = {
    $or: [{ facultyMemberId: { $exists: false } }, { facultyMemberId: null }],
    $and: [{ $or: [{ userId: { $exists: true, $ne: null } }, { email: { $exists: true, $ne: '' } }] }],
  };
  const total = await ResearchGroupMember.countDocuments(filter);
  const query = ResearchGroupMember.find(filter).sort({ _id: 1 }).lean<any[]>();
  if (options.limit) query.limit(options.limit);
  const members = await query;
  console.log(`Members missing facultyMemberId: ${total}; processing ${members.length}`);

  let linked = 0;
  let skipped = 0;
  const errors: Array<{ memberId: string; error: string }> = [];

  for (const member of members) {
    try {
      const facultyMemberId = await facultyIdForMember(member);
      if (!facultyMemberId) {
        skipped++;
        continue;
      }
      if (options.apply) {
        await ResearchGroupMember.updateOne(
          { _id: member._id, $or: [{ facultyMemberId: { $exists: false } }, { facultyMemberId: null }] },
          { $set: { facultyMemberId, lastObservedAt: member.lastObservedAt || new Date() } },
        );
      }
      linked++;
    } catch (err: any) {
      errors.push({ memberId: String(member._id), error: err?.message || String(err) });
    }
  }

  const claimedFilter = {
    claimedByUserId: { $exists: true, $ne: null },
  };
  const claimedQuery = ResearchGroup.find(claimedFilter, { _id: 1, claimedByUserId: 1 }).sort({ _id: 1 }).lean<any[]>();
  if (options.limit) claimedQuery.limit(options.limit);
  const claimedGroups = await claimedQuery;

  let piUpserts = 0;
  for (const group of claimedGroups) {
    try {
      const user = await User.findById(group.claimedByUserId, {
        facultyMemberId: 1,
        fname: 1,
        lname: 1,
        email: 1,
      }).lean<any>();
      if (!user) continue;
      if (options.apply) {
        await ResearchGroupMember.updateOne(
          { researchGroupId: group._id, userId: group.claimedByUserId, role: 'pi' },
          {
            $setOnInsert: {
              researchGroupId: group._id,
              userId: group.claimedByUserId,
              facultyMemberId: user.facultyMemberId,
              name: [user.fname, user.lname].filter(Boolean).join(' '),
              email: user.email || '',
              role: 'pi',
              isCurrentMember: true,
              startedAt: new Date(),
              lastObservedAt: new Date(),
            },
          },
          { upsert: true },
        );
      }
      piUpserts++;
    } catch (err: any) {
      errors.push({ memberId: `claimed:${group._id}`, error: err?.message || String(err) });
    }
  }

    const output = buildV4MigrationOutput(
      {
        membersProcessed: members.length,
        memberLinksAdded: linked,
        claimedPiRowsUpserted: piUpserts,
        skipped,
        errorCount: errors.length,
      },
      {
        environment: resolveScraperEnvironment(process.env),
        db: ResearchGroupMember.db.db?.databaseName || ResearchGroupMember.db.name,
        options,
      },
    );

    console.log('\nDone.');
    console.log(`  Members processed:         ${members.length}`);
    console.log(`  Member links added:        ${linked} ${options.apply ? '' : '(dry run)'}`);
    console.log(`  Claimed PI rows upserted:  ${piUpserts} ${options.apply ? '' : '(dry run)'}`);
    console.log(`  Skipped:                   ${skipped}`);
    console.log(`  Errors:                    ${errors.length}`);
    for (const error of errors.slice(0, 10)) console.log(`  ${error.memberId}: ${error.error}`);
    writeV4ResearchGroupMemberBackfillOutput(output, options.output);
    if (options.output) console.log(`Wrote v4 research group member backfill report to ${options.output}`);

    return output;
  } finally {
    await disconnectForMigration();
  }
}

if (process.argv[1] && __filename === path.resolve(process.argv[1])) {
  backfillV4ResearchGroupMembers().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

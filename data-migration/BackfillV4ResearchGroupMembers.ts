/**
 * Backfill v4 ResearchGroupMember faculty bridge fields.
 *
 * Dry-run by default; pass --apply to write. Supports --limit N / --limit=N.
 */
import mongoose from '../server/node_modules/mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { FacultyMember } from '../server/src/models/facultyMember';
import { ResearchGroup } from '../server/src/models/researchGroup';
import { ResearchGroupMember } from '../server/src/models/researchGroupMember';
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

async function main(): Promise<void> {
  const url = process.env.MONGODBURL;
  if (!url) {
    console.error('ERROR: MONGODBURL not set');
    process.exit(1);
  }

  const limit = parseLimit();
  console.log('\n=== Backfill v4 ResearchGroupMember faculty bridge ===');
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  console.log(`Limit: ${limit ?? 'none'}\n`);

  await mongoose.connect(url);

  const filter = {
    $or: [{ facultyMemberId: { $exists: false } }, { facultyMemberId: null }],
    $and: [{ $or: [{ userId: { $exists: true, $ne: null } }, { email: { $exists: true, $ne: '' } }] }],
  };
  const total = await ResearchGroupMember.countDocuments(filter);
  const query = ResearchGroupMember.find(filter).sort({ _id: 1 }).lean<any[]>();
  if (limit) query.limit(limit);
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
      if (APPLY) {
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
  if (limit) claimedQuery.limit(limit);
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
      if (APPLY) {
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

  console.log('\nDone.');
  console.log(`  Members processed:         ${members.length}`);
  console.log(`  Member links added:        ${linked} ${APPLY ? '' : '(dry run)'}`);
  console.log(`  Claimed PI rows upserted:  ${piUpserts} ${APPLY ? '' : '(dry run)'}`);
  console.log(`  Skipped:                   ${skipped}`);
  console.log(`  Errors:                    ${errors.length}`);
  for (const error of errors.slice(0, 10)) console.log(`  ${error.memberId}: ${error.error}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

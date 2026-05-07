/**
 * Backfill v4 PaperAuthor and PaperGroupLink edge collections from legacy Paper fields.
 */
import { Paper } from '../server/src/models/paper';
import { PaperAuthor } from '../server/src/models/paperAuthor';
import { PaperGroupLink } from '../server/src/models/paperGroupLink';
import { ResearchGroupMember } from '../server/src/models/researchGroupMember';
import { User } from '../server/src/models/user';
import {
  connectForMigration,
  disconnectForMigration,
  chunk,
  parseMigrationOptions,
} from './v4MigrationUtils';

const options = parseMigrationOptions();

async function main(): Promise<void> {
  await connectForMigration('Backfill v4 paper graph', options);

  const papers = await Paper.find({})
    .sort({ _id: 1 })
    .limit(options.limit || 0)
    .lean<any[]>();

  const userIds = Array.from(
    new Set(
      papers
        .flatMap((paper) => paper.yaleAuthorIds || [])
        .map((id) => String(id))
        .filter(Boolean),
    ),
  );
  const users = await User.find({ _id: { $in: userIds } }).lean<any[]>();
  const usersById = new Map(users.map((user) => [String(user._id), user]));
  const facultyMemberIds = Array.from(
    new Set(users.map((user) => String(user.facultyMemberId || '')).filter(Boolean)),
  );
  const memberships = await ResearchGroupMember.find({
    role: { $in: ['pi', 'co-pi'] },
    $or: [
      { userId: { $in: userIds } },
      ...(facultyMemberIds.length > 0 ? [{ facultyMemberId: { $in: facultyMemberIds } }] : []),
    ],
  }).lean<any[]>();

  const membershipsByUserId = new Map<string, any[]>();
  const membershipsByFacultyId = new Map<string, any[]>();
  for (const member of memberships) {
    if (member.userId) {
      const key = String(member.userId);
      membershipsByUserId.set(key, [...(membershipsByUserId.get(key) || []), member]);
    }
    if (member.facultyMemberId) {
      const key = String(member.facultyMemberId);
      membershipsByFacultyId.set(key, [...(membershipsByFacultyId.get(key) || []), member]);
    }
  }

  let authorEdges = 0;
  let groupEdges = 0;
  let papersUpdated = 0;
  const paperAuthorOps: any[] = [];
  const paperGroupLinkOps: any[] = [];
  const paperOps: any[] = [];

  for (const paper of papers) {
    const paperFacultyMemberIds = new Set<string>();
    const researchGroupIds = new Set<string>();

    const yaleAuthorIds = (paper.yaleAuthorIds || []).map((id: any) => String(id));
    for (let i = 0; i < yaleAuthorIds.length; i++) {
      const user = usersById.get(yaleAuthorIds[i]);
      if (!user) continue;
      const facultyMemberId = user.facultyMemberId ? String(user.facultyMemberId) : undefined;
      if (facultyMemberId) paperFacultyMemberIds.add(facultyMemberId);

      const displayName =
        paper.authors?.[i] ||
        [user.fname, user.lname].filter(Boolean).join(' ').trim() ||
        user.email ||
        'Unknown author';

      if (options.apply) {
        paperAuthorOps.push({
          updateOne: {
            filter: { paperId: paper._id, userId: user._id },
            update: {
            $set: {
              paperId: paper._id,
              userId: user._id,
              facultyMemberId: user.facultyMemberId,
              displayName,
              authorPosition: i,
              confidence: 1,
              lastObservedAt: paper.lastObservedAt || paper.updatedAt || new Date(),
            },
          },
            upsert: true,
          },
        });
      }
      authorEdges++;

      const groups = [
        ...(membershipsByUserId.get(String(user._id)) || []),
        ...(user.facultyMemberId ? membershipsByFacultyId.get(String(user.facultyMemberId)) || [] : []),
      ];

      const seenGroups = new Set<string>();
      for (const member of groups) {
        const groupKey = String(member.researchGroupId);
        if (seenGroups.has(groupKey)) continue;
        seenGroups.add(groupKey);
        researchGroupIds.add(String(member.researchGroupId));
        const update: Record<string, unknown> = {
          $set: {
            paperId: paper._id,
            researchGroupId: member.researchGroupId,
            relationship: member.role === 'pi' ? 'pi-author' : 'coauthor',
            confidence: member.role === 'pi' ? 0.9 : 0.75,
            lastObservedAt: paper.lastObservedAt || paper.updatedAt || new Date(),
          },
        };
        if (user.facultyMemberId) {
          update.$addToSet = { matchedFacultyMemberIds: user.facultyMemberId };
        }
        if (options.apply) {
          paperGroupLinkOps.push({
            updateOne: {
              filter: { paperId: paper._id, researchGroupId: member.researchGroupId },
              update,
              upsert: true,
            },
          });
        }
        groupEdges++;
      }
    }

    const update: Record<string, unknown> = {};
    if (paperFacultyMemberIds.size > 0) update.facultyMemberIds = Array.from(paperFacultyMemberIds);
    if (researchGroupIds.size > 0) update.researchGroupIds = Array.from(researchGroupIds);
    if (!paper.plainSummary && paper.tldr) update.plainSummary = paper.tldr;

    if (Object.keys(update).length > 0) {
      if (options.apply) {
        paperOps.push({
          updateOne: {
            filter: { _id: paper._id },
            update: { $set: update },
          },
        });
      }
      papersUpdated++;
    }
  }

  if (options.apply) {
    for (const ops of chunk(paperAuthorOps, 1000)) {
      if (ops.length > 0) await PaperAuthor.bulkWrite(ops, { ordered: false });
    }
    for (const ops of chunk(paperGroupLinkOps, 1000)) {
      if (ops.length > 0) await PaperGroupLink.bulkWrite(ops, { ordered: false });
    }
    for (const ops of chunk(paperOps, 1000)) {
      if (ops.length > 0) await Paper.bulkWrite(ops, { ordered: false });
    }
  }

  console.log(`Papers scanned:       ${papers.length}`);
  console.log(`PaperAuthor edges:    ${authorEdges}${options.apply ? '' : ' (would upsert)'}`);
  console.log(`PaperGroupLink edges: ${groupEdges}${options.apply ? '' : ' (would upsert)'}`);
  console.log(`Papers updated:       ${papersUpdated}${options.apply ? '' : ' (would update)'}`);

  await disconnectForMigration();
}

main().catch(async (err) => {
  console.error(err);
  await disconnectForMigration();
  process.exit(1);
});

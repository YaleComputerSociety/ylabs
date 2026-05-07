/**
 * Initialize recomputable v4 ResearchGroupStats rows.
 */
import { ResearchGroup } from '../server/src/models/researchGroup';
import { ResearchGroupMember } from '../server/src/models/researchGroupMember';
import { ResearchGroupStats } from '../server/src/models/researchGroupStats';
import { StudentOutreach } from '../server/src/models/studentOutreach';
import {
  connectForMigration,
  disconnectForMigration,
  chunk,
  parseMigrationOptions,
} from './v4MigrationUtils';

const options = parseMigrationOptions();

async function main(): Promise<void> {
  await connectForMigration('Backfill v4 ResearchGroupStats', options);

  const groups = await ResearchGroup.find({})
    .sort({ _id: 1 })
    .limit(options.limit || 0)
    .lean<any[]>();

  const groupIds = groups.map((group) => group._id);
  const undergradCounts = await ResearchGroupMember.aggregate([
    {
      $match: {
        researchGroupId: { $in: groupIds },
        role: 'undergrad',
        isCurrentMember: { $ne: false },
      },
    },
    { $group: { _id: '$researchGroupId', count: { $sum: 1 } } },
  ]);
  const outreachCounts = await StudentOutreach.aggregate([
    {
      $match: {
        researchGroupId: { $in: groupIds },
        reachedOutAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
    },
    { $group: { _id: '$researchGroupId', count: { $sum: 1 } } },
  ]);
  const undergradCountByGroup = new Map(
    undergradCounts.map((row: any) => [String(row._id), row.count]),
  );
  const outreachCountByGroup = new Map(
    outreachCounts.map((row: any) => [String(row._id), row.count]),
  );

  let statsUpserted = 0;
  const ops: any[] = [];

  for (const group of groups) {
    const memberCount = undergradCountByGroup.get(String(group._id)) || 0;
    const outreachCount30d = outreachCountByGroup.get(String(group._id)) || 0;
    const evidenceCount = Math.max(memberCount, Number(group.currentUndergradCount || 0));

    const stats = {
      researchGroupId: group._id,
      responseRateAllTime: 0,
      responseRateAllTimeSampleSize: 0,
      responseRate90d: 0,
      responseRate90dSampleSize: 0,
      joinedRateAllTime: 0,
      joinedRateAllTimeSampleSize: 0,
      viewCount30d: 0,
      saveCount30d: 0,
      outreachCount30d,
      inquiryQualityScore: 0,
      undergradEvidence: {
        memberCount,
        reportedJoinedCount: 0,
        evidenceLabel: evidenceCount > 0 ? `At least ${evidenceCount} undergrads have worked here` : '',
      },
      publicVisibility: {
        showResponseRate: false,
        showJoinedRate: false,
        showMedianResponseTime: false,
      },
      computedAt: new Date(),
    };

    if (options.apply) {
      ops.push({
        updateOne: {
          filter: { researchGroupId: group._id },
          update: { $set: stats },
          upsert: true,
        },
      });
    }
    statsUpserted++;
  }

  if (options.apply) {
    for (const batch of chunk(ops, 1000)) {
      if (batch.length > 0) await ResearchGroupStats.bulkWrite(batch, { ordered: false });
    }
  }

  console.log(`Groups scanned: ${groups.length}`);
  console.log(`Stats upserted:${statsUpserted}${options.apply ? '' : ' (would upsert)'}`);

  await disconnectForMigration();
}

main().catch(async (err) => {
  console.error(err);
  await disconnectForMigration();
  process.exit(1);
});

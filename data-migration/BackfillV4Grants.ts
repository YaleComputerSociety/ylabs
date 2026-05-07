/**
 * Extract legacy ResearchGroup.recentGrants subdocuments into v4 Grant records.
 */
import { Grant } from '../server/src/models/grant';
import { ResearchGroup } from '../server/src/models/researchGroup';
import {
  connectForMigration,
  disconnectForMigration,
  parseMigrationOptions,
} from './v4MigrationUtils';

const options = parseMigrationOptions();

function normalizeAgency(raw?: string): 'NIH' | 'NSF' | 'DOD' | 'other' {
  const value = (raw || '').toUpperCase();
  if (value.includes('NIH')) return 'NIH';
  if (value.includes('NSF')) return 'NSF';
  if (value.includes('DOD')) return 'DOD';
  return 'other';
}

async function main(): Promise<void> {
  await connectForMigration('Backfill v4 Grant records', options);

  const groups = await ResearchGroup.find({ recentGrants: { $exists: true, $ne: [] } })
    .sort({ _id: 1 })
    .limit(options.limit || 0)
    .lean<any[]>();

  let grantsSeen = 0;
  let grantsUpserted = 0;
  let groupsUpdated = 0;

  for (const group of groups) {
    let lastGrantAt: Date | undefined;
    for (const legacyGrant of group.recentGrants || []) {
      if (!legacyGrant.id && !legacyGrant.title) continue;
      grantsSeen++;
      const agency = normalizeAgency(legacyGrant.agency);
      const externalId = String(legacyGrant.id || `${agency}:${group._id}:${legacyGrant.title}`).trim();
      const endDate = legacyGrant.endDate ? new Date(legacyGrant.endDate) : undefined;
      if (endDate && (!lastGrantAt || endDate > lastGrantAt)) lastGrantAt = endDate;

      if (options.apply) {
        await Grant.updateOne(
          { agency, externalId },
          {
            $set: {
              agency,
              externalId,
              title: legacyGrant.title || 'Untitled grant',
              abstract: legacyGrant.abstract || '',
              amount: legacyGrant.dollarAmount,
              startDate: legacyGrant.startDate,
              endDate: legacyGrant.endDate,
              sourceUrl: legacyGrant.url || '',
              lastObservedAt: group.lastObservedAt || group.updatedAt || new Date(),
            },
            $addToSet: {
              researchGroupIds: group._id,
            },
          },
          { upsert: true },
        );
      }
      grantsUpserted++;
    }

    if (options.apply) {
      await ResearchGroup.updateOne(
        { _id: group._id },
        {
          $set: {
            recentGrantCount: (group.recentGrants || []).length,
            lastGrantAtCache: lastGrantAt,
          },
        },
      );
    }
    groupsUpdated++;
  }

  console.log(`Groups scanned:    ${groups.length}`);
  console.log(`Legacy grants seen:${grantsSeen}`);
  console.log(`Grants upserted:   ${grantsUpserted}${options.apply ? '' : ' (would upsert)'}`);
  console.log(`Groups updated:    ${groupsUpdated}${options.apply ? '' : ' (would update)'}`);

  await disconnectForMigration();
}

main().catch(async (err) => {
  console.error(err);
  await disconnectForMigration();
  process.exit(1);
});

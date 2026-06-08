/**
 * Extract legacy ResearchGroup.recentGrants subdocuments into v4 Grant records.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Grant } from '../server/src/models/grant';
import { ResearchGroup } from '../server/src/models/researchGroup';
import { resolveScraperEnvironment } from '../server/src/scrapers/scraperEnvironment';
import {
  buildV4MigrationOutput,
  connectForMigration,
  disconnectForMigration,
  parseMigrationOptions,
  type MigrationOptions,
} from './v4MigrationUtils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface V4GrantBackfillResult {
  groupsScanned: number;
  grantsSeen: number;
  grantsUpserted: number;
  groupsUpdated: number;
}

export function normalizeAgency(raw?: string): 'NIH' | 'NSF' | 'DOD' | 'other' {
  const value = (raw || '').toUpperCase();
  if (value.includes('NIH')) return 'NIH';
  if (value.includes('NSF') || value.includes('NATIONAL SCIENCE FOUNDATION')) return 'NSF';
  if (value.includes('DOD') || value.includes('DEPARTMENT OF DEFENSE')) return 'DOD';
  return 'other';
}

export function buildV4GrantBackfillOutput<T extends object>(
  result: T,
  metadata: {
    generatedAt?: string;
    environment?: string;
    db?: string;
    options: MigrationOptions;
  },
): ReturnType<typeof buildV4MigrationOutput<T>> {
  return buildV4MigrationOutput(result, metadata);
}

function writeV4GrantBackfillOutput(payload: object, outputPath?: string): void {
  if (!outputPath) return;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
}

export async function backfillV4Grants(
  options = parseMigrationOptions(),
): Promise<ReturnType<typeof buildV4GrantBackfillOutput<V4GrantBackfillResult>>> {
  await connectForMigration('Backfill v4 Grant records', options);

  try {
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

    const output = buildV4GrantBackfillOutput(
      {
        groupsScanned: groups.length,
        grantsSeen,
        grantsUpserted,
        groupsUpdated,
      },
      {
        environment: resolveScraperEnvironment(process.env),
        db: Grant.db.db?.databaseName || Grant.db.name,
        options,
      },
    );

    console.log(`Groups scanned:    ${groups.length}`);
    console.log(`Legacy grants seen:${grantsSeen}`);
    console.log(`Grants upserted:   ${grantsUpserted}${options.apply ? '' : ' (would upsert)'}`);
    console.log(`Groups updated:    ${groupsUpdated}${options.apply ? '' : ' (would update)'}`);
    writeV4GrantBackfillOutput(output, options.output);
    if (options.output) console.log(`Wrote v4 grant backfill report to ${options.output}`);

    return output;
  } finally {
    await disconnectForMigration();
  }
}

if (process.argv[1] && __filename === path.resolve(process.argv[1])) {
  backfillV4Grants().catch(async (err) => {
    console.error(err);
    await disconnectForMigration();
    process.exit(1);
  });
}

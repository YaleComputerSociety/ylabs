/**
 * One-time migration for MongoDB naming conventions.
 *
 * - Collection names: lowercase plural; snake_case for multi-word names.
 * - Document fields: camelCase.
 *
 * Usage:
 *   MONGODBURL="mongodb://..." yarn --cwd server migrate:mongo-naming --dry-run --output /tmp/mongo-naming.json
 *   SCRAPER_ENV=beta MONGODBURL="mongodb://..." yarn --cwd server migrate:mongo-naming --apply
 */

import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

dotenv.config();

const COLLECTION_RENAMES = [
  ['accesssignals', 'access_signals'],
  ['analyticsevents', 'analytics_events'],
  ['contactroutes', 'contact_routes'],
  ['entrypathways', 'entry_pathways'],
  ['facultymembers', 'faculty_members'],
  ['paperauthors', 'paper_authors'],
  ['postedopportunities', 'posted_opportunities'],
  ['researchareas', 'research_areas'],
  ['researchAreas', 'research_areas'],
  ['researchgroups', 'research_entities'],
  ['researchgroupmembers', 'research_entity_members'],
  ['scraperuns', 'scrape_runs'],
  ['scrapesnapshots', 'scrape_snapshots'],
  ['studentengagementevents', 'student_engagement_events'],
  ['studentoutreaches', 'student_outreaches'],
  ['studentprofiles', 'student_profiles'],
  ['studenttrackings', 'student_trackings'],
] as const;

const USER_FIELD_RENAMES = {
  physical_location: 'physicalLocation',
  building_desk: 'buildingDesk',
  mailing_address: 'mailingAddress',
  primary_department: 'primaryDepartment',
  secondary_departments: 'secondaryDepartments',
  research_interests: 'researchInterests',
  image_url: 'imageUrl',
  profile_urls: 'profileUrls',
  h_index: 'hIndex',
  openalex_id: 'openAlexId',
  data_sources: 'dataSources',
} as const;

const PUBLICATION_FIELD_RENAMES = ['cited_by_count', 'open_access_url'];

export interface MongoNamingMigrationCliOptions {
  apply: boolean;
  confirmMongoNaming?: boolean;
  output?: string;
}

interface CollectionRenameResult {
  from: string;
  to: string;
  action:
    | 'already_exists'
    | 'skipped_missing_source'
    | 'blocked_overlap'
    | 'would_merge_and_drop'
    | 'merged_and_dropped'
    | 'would_rename'
    | 'renamed';
  sourceDocuments?: number;
  overlapDocuments?: number;
}

interface UserFieldRenameResult {
  collection: 'users';
  action: 'skipped_missing_collection' | 'would_update' | 'updated';
  topLevelDocuments: number;
  embeddedPublicationDocuments: number;
}

function parseRequiredOutputPath(value: string | undefined): string {
  return resolveSafeJsonReportOutputPath(value);
}

export function parseMongoNamingMigrationArgs(argv: string[]): MongoNamingMigrationCliOptions {
  const options: MongoNamingMigrationCliOptions = { apply: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') {
      options.apply = true;
      continue;
    }
    if (arg === '--confirm-mongo-naming') {
      options.confirmMongoNaming = true;
      continue;
    }
    if (arg === '--dry-run') {
      options.apply = false;
      continue;
    }
    if (arg === '--output') {
      options.output = parseRequiredOutputPath(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith('--output=')) {
      options.output = parseRequiredOutputPath(arg.slice('--output='.length));
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

export function assertMongoNamingMigrationWriteAllowed(
  options: Pick<MongoNamingMigrationCliOptions, 'apply' | 'confirmMongoNaming'>,
  env: NodeJS.ProcessEnv = process.env,
  mongoUrl = process.env.MONGODBURL,
) {
  if (options.apply && !options.confirmMongoNaming) {
    throw new Error('--confirm-mongo-naming is required when --apply is set for migrate:mongo-naming');
  }

  return assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'migrate:mongo-naming',
    env,
    mongoUrl,
  });
}

export function buildMongoNamingMigrationOutput<T extends object>(
  report: T,
  metadata: {
    environment: string;
    db: string;
    options: MongoNamingMigrationCliOptions;
  },
): T & {
  generatedAt: string;
  environment: string;
  db: string;
  options: MongoNamingMigrationCliOptions;
} {
  return {
    generatedAt: new Date().toISOString(),
    environment: metadata.environment,
    db: metadata.db,
    options: metadata.options,
    ...report,
  };
}

export function writeMongoNamingMigrationOutput(report: unknown, output?: string): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
}

async function collectionExists(name: string): Promise<boolean> {
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not initialized');

  const matches = await db.listCollections({ name }, { nameOnly: true }).toArray();
  return matches.length > 0;
}

async function renameCollections(apply: boolean): Promise<CollectionRenameResult[]> {
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not initialized');

  const results: CollectionRenameResult[] = [];

  for (const [from, to] of COLLECTION_RENAMES) {
    const fromExists = await collectionExists(from);
    const toExists = await collectionExists(to);

    if (!fromExists && toExists) {
      results.push({ from, to, action: 'already_exists' });
      continue;
    }

    if (!fromExists) {
      results.push({ from, to, action: 'skipped_missing_source' });
      continue;
    }

    if (toExists) {
      const fromCount = await db.collection(from).countDocuments();
      let overlapCount = 0;

      if (fromCount > 0) {
        const overlapResult = await db.collection(from).aggregate([
          {
            $lookup: {
              from: to,
              localField: '_id',
              foreignField: '_id',
              as: 'matchingTargetDocs',
            },
          },
          { $match: { matchingTargetDocs: { $ne: [] } } },
          { $count: 'count' },
        ]).toArray();
        overlapCount = overlapResult[0]?.count ?? 0;

        if (overlapCount > 0) {
          results.push({
            from,
            to,
            action: 'blocked_overlap',
            sourceDocuments: fromCount,
            overlapDocuments: overlapCount,
          });
          continue;
        }

        if (apply) {
          await db.collection(from).aggregate([
            {
              $merge: {
                into: to,
                on: '_id',
                whenMatched: 'fail',
                whenNotMatched: 'insert',
              },
            },
          ]).toArray();
        }
      }

      if (apply) await db.collection(from).drop();
      results.push({
        from,
        to,
        action: apply ? 'merged_and_dropped' : 'would_merge_and_drop',
        sourceDocuments: fromCount,
        overlapDocuments: overlapCount,
      });
      continue;
    }

    if (apply) await db.collection(from).rename(to);
    results.push({ from, to, action: apply ? 'renamed' : 'would_rename' });
  }

  return results;
}

export function buildUserFieldSetStage() {
  return Object.fromEntries(
    Object.entries(USER_FIELD_RENAMES).map(([from, to]) => [
      to,
      {
        $cond: [
          { $ne: [{ $type: `$${to}` }, 'missing'] },
          `$${to}`,
          {
            $cond: [
              { $ne: [{ $type: `$${from}` }, 'missing'] },
              `$${from}`,
              '$$REMOVE',
            ],
          },
        ],
      },
    ]),
  );
}

function userTopLevelLegacyFieldFilter() {
  return {
    $or: Object.keys(USER_FIELD_RENAMES).map((field) => ({ [field]: { $exists: true } })),
  };
}

function userPublicationLegacyFieldFilter() {
  return {
    $or: [
      { publications: { $elemMatch: { cited_by_count: { $exists: true } } } },
      { publications: { $elemMatch: { open_access_url: { $exists: true } } } },
    ],
  };
}

async function renameUserFields(apply: boolean): Promise<UserFieldRenameResult> {
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not initialized');

  if (!(await collectionExists('users'))) {
    return {
      collection: 'users',
      action: 'skipped_missing_collection',
      topLevelDocuments: 0,
      embeddedPublicationDocuments: 0,
    };
  }

  const topLevelFilter = userTopLevelLegacyFieldFilter();
  const publicationFilter = userPublicationLegacyFieldFilter();
  let topLevelDocuments = await db.collection('users').countDocuments(topLevelFilter);
  let embeddedPublicationDocuments = await db.collection('users').countDocuments(publicationFilter);

  if (apply) {
    const topLevelResult = await db.collection('users').updateMany(
      {},
      [
        { $set: buildUserFieldSetStage() },
        { $unset: Object.keys(USER_FIELD_RENAMES) },
      ] as any,
    );
    topLevelDocuments = topLevelResult.modifiedCount;

    const publicationsResult = await db.collection('users').updateMany(
      publicationFilter,
      [
        {
          $set: {
            publications: {
              $map: {
                input: '$publications',
                as: 'publication',
                in: {
                  $arrayToObject: {
                    $concatArrays: [
                      {
                        $filter: {
                          input: { $objectToArray: '$$publication' },
                          as: 'field',
                          cond: {
                            $not: {
                              $in: ['$$field.k', PUBLICATION_FIELD_RENAMES],
                            },
                          },
                        },
                      },
                      {
                        $cond: [
                          { $ne: [{ $type: '$$publication.citedByCount' }, 'missing'] },
                          [{ k: 'citedByCount', v: '$$publication.citedByCount' }],
                          {
                            $cond: [
                              { $ne: [{ $type: '$$publication.cited_by_count' }, 'missing'] },
                              [{ k: 'citedByCount', v: '$$publication.cited_by_count' }],
                              [],
                            ],
                          },
                        ],
                      },
                      {
                        $cond: [
                          { $ne: [{ $type: '$$publication.openAccessUrl' }, 'missing'] },
                          [{ k: 'openAccessUrl', v: '$$publication.openAccessUrl' }],
                          {
                            $cond: [
                              { $ne: [{ $type: '$$publication.open_access_url' }, 'missing'] },
                              [{ k: 'openAccessUrl', v: '$$publication.open_access_url' }],
                              [],
                            ],
                          },
                        ],
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      ] as any,
    );
    embeddedPublicationDocuments = publicationsResult.modifiedCount;
  }

  return {
    collection: 'users',
    action: apply ? 'updated' : 'would_update',
    topLevelDocuments,
    embeddedPublicationDocuments,
  };
}

export async function migrateMongoNaming(options: MongoNamingMigrationCliOptions) {
  const mongoUrl = process.env.MONGODBURL;
  if (!mongoUrl) {
    throw new Error('MONGODBURL environment variable is required');
  }

  await mongoose.connect(mongoUrl);

  try {
    return {
      mode: options.apply ? 'apply' : 'dry-run',
      collections: await renameCollections(options.apply),
      userFields: await renameUserFields(options.apply),
    };
  } finally {
    await mongoose.disconnect();
  }
}

async function main() {
  const options = parseMongoNamingMigrationArgs(process.argv.slice(2));
  const guard = assertMongoNamingMigrationWriteAllowed(options);
  const report = await migrateMongoNaming(options);
  const output = buildMongoNamingMigrationOutput(report, {
    environment: guard.environment,
    db: guard.dbLabel,
    options,
  });
  console.log(JSON.stringify(output, null, 2));
  writeMongoNamingMigrationOutput(output, options.output);
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main().catch(async (err) => {
    console.error('Fatal error:', sanitizeLogValue(err));
    await mongoose.disconnect().catch(() => {});
    process.exitCode = 1;
  });
}

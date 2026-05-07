/**
 * One-time migration for MongoDB naming conventions.
 *
 * - Collection names: lowercase plural; snake_case for multi-word names.
 * - Document fields: camelCase.
 *
 * Usage:
 *   MONGODBURL="mongodb://..." yarn --cwd server migrate:mongo-naming
 */

import mongoose from 'mongoose';

const COLLECTION_RENAMES = [
  ['analyticsevents', 'analytics_events'],
  ['facultymembers', 'faculty_members'],
  ['paperauthors', 'paper_authors'],
  ['papergrouplinks', 'paper_group_links'],
  ['researchareas', 'research_areas'],
  ['researchAreas', 'research_areas'],
  ['researchgroups', 'research_groups'],
  ['researchgroupmembers', 'research_group_members'],
  ['researchgroupstats', 'research_group_stats'],
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

async function collectionExists(name: string): Promise<boolean> {
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not initialized');

  const matches = await db.listCollections({ name }, { nameOnly: true }).toArray();
  return matches.length > 0;
}

async function renameCollections() {
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not initialized');

  console.log('\n=== Collection Renames ===');

  for (const [from, to] of COLLECTION_RENAMES) {
    const fromExists = await collectionExists(from);
    const toExists = await collectionExists(to);

    if (!fromExists && toExists) {
      console.log(`OK     ${to} already exists`);
      continue;
    }

    if (!fromExists) {
      console.log(`SKIP   ${from} does not exist`);
      continue;
    }

    if (toExists) {
      console.log(`WARN   ${from} and ${to} both exist; leaving both unchanged`);
      continue;
    }

    await db.collection(from).rename(to);
    console.log(`RENAMED ${from} -> ${to}`);
  }
}

function buildUserFieldSetStage() {
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

async function renameUserFields() {
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not initialized');

  console.log('\n=== User Field Renames ===');

  if (!(await collectionExists('users'))) {
    console.log('SKIP   users collection does not exist');
    return;
  }

  const topLevelResult = await db.collection('users').updateMany(
    {},
    [
      { $set: buildUserFieldSetStage() },
      { $unset: Object.keys(USER_FIELD_RENAMES) },
    ] as any,
  );

  console.log(
    `UPDATED users top-level fields in ${topLevelResult.modifiedCount} documents`,
  );

  const publicationsResult = await db.collection('users').updateMany(
    {
      $or: [
        { publications: { $elemMatch: { cited_by_count: { $exists: true } } } },
        { publications: { $elemMatch: { open_access_url: { $exists: true } } } },
      ],
    },
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

  console.log(
    `UPDATED embedded publications in ${publicationsResult.modifiedCount} documents`,
  );
}

async function migrateMongoNaming() {
  const mongoUrl = process.env.MONGODBURL;
  if (!mongoUrl) {
    console.error('Error: MONGODBURL environment variable is required');
    process.exit(1);
  }

  console.log('Connecting to MongoDB...');
  await mongoose.connect(mongoUrl);
  console.log('Connected');

  try {
    await renameCollections();
    await renameUserFields();
  } finally {
    await mongoose.disconnect();
  }

  console.log('\nDone.');
}

migrateMongoNaming().catch(async (err) => {
  console.error('Fatal error:', err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { initializeConnections } from '../db/connections';

dotenv.config();

type MongoDb = NonNullable<typeof mongoose.connection.db>;

interface ReferenceCheck {
  collection: string;
  field: string;
  label: string;
  array?: boolean;
  filter?: Record<string, unknown>;
}

const REFERENCE_CHECKS: ReferenceCheck[] = [
  { collection: 'entry_pathways', field: 'researchEntityId', label: 'EntryPathway host entity' },
  { collection: 'access_signals', field: 'researchEntityId', label: 'AccessSignal host entity' },
  { collection: 'contact_routes', field: 'researchEntityId', label: 'ContactRoute host entity' },
  {
    collection: 'posted_opportunities',
    field: 'researchEntityId',
    label: 'PostedOpportunity host entity',
  },
  { collection: 'listings', field: 'researchEntityId', label: 'Listing host entity' },
  {
    collection: 'research_entity_members',
    field: 'researchEntityId',
    label: 'ResearchEntity member host entity',
  },
  {
    collection: 'research_entity_stats',
    field: 'researchEntityId',
    label: 'ResearchEntityStats host entity',
  },
  { collection: 'paper_entity_links', field: 'researchEntityId', label: 'PaperEntityLink host entity' },
  {
    collection: 'research_group_members',
    field: 'researchEntityId',
    label: 'Legacy ResearchEntity member host entity',
  },
  {
    collection: 'research_group_stats',
    field: 'researchEntityId',
    label: 'Legacy ResearchEntityStats host entity',
  },
  {
    collection: 'paper_group_links',
    field: 'researchEntityId',
    label: 'Legacy PaperEntityLink host entity',
  },
  { collection: 'papers', field: 'researchEntityIds', label: 'Paper linked entities', array: true },
  { collection: 'grants', field: 'researchEntityIds', label: 'Grant linked entities', array: true },
  {
    collection: 'student_trackings',
    field: 'researchEntityId',
    label: 'StudentTracking host entity',
  },
  {
    collection: 'student_outreaches',
    field: 'researchEntityId',
    label: 'StudentOutreach host entity',
  },
  {
    collection: 'student_engagement_events',
    field: 'researchEntityId',
    label: 'StudentEngagementEvent host entity',
  },
  {
    collection: 'observations',
    field: 'entityId',
    label: 'Observation researchEntity entity',
    filter: { entityType: 'researchEntity' },
  },
];

async function collectionExists(db: MongoDb, name: string): Promise<boolean> {
  const matches = await db.listCollections({ name }, { nameOnly: true }).toArray();
  return matches.length > 0;
}

async function countCollection(db: MongoDb, name: string) {
  if (!(await collectionExists(db, name))) {
    return { exists: false, count: 0 };
  }

  return {
    exists: true,
    count: await db.collection(name).countDocuments(),
  };
}

async function countDanglingReferences(db: MongoDb, check: ReferenceCheck) {
  if (!(await collectionExists(db, check.collection))) {
    return {
      ...check,
      collectionExists: false,
      sourceDocuments: 0,
      danglingReferences: 0,
    };
  }

  const baseMatch = {
    ...(check.filter || {}),
    [check.field]: check.array
      ? { $exists: true, $type: 'array', $ne: [] }
      : { $exists: true, $ne: null },
  };

  const sourceDocuments = await db.collection(check.collection).countDocuments(baseMatch);
  const pipeline: Record<string, unknown>[] = [
    { $match: baseMatch },
    ...(check.array ? [{ $unwind: `$${check.field}` }] : []),
    {
      $lookup: {
        from: 'research_entities',
        localField: check.field,
        foreignField: '_id',
        as: 'matchedResearchEntity',
      },
    },
    { $match: { matchedResearchEntity: { $eq: [] } } },
    { $count: 'count' },
  ];
  const rows = await db.collection(check.collection).aggregate(pipeline).toArray();

  return {
    ...check,
    collectionExists: true,
    sourceDocuments,
    danglingReferences: Number(rows[0]?.count || 0),
  };
}

async function main() {
  await initializeConnections();
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not initialized');

  const [
    researchGroups,
    researchEntities,
    researchGroupMembers,
    researchEntityMembers,
    researchGroupStats,
    researchEntityStats,
    paperGroupLinks,
    paperEntityLinks,
    references,
  ] = await Promise.all([
    countCollection(db, 'research_groups'),
    countCollection(db, 'research_entities'),
    countCollection(db, 'research_group_members'),
    countCollection(db, 'research_entity_members'),
    countCollection(db, 'research_group_stats'),
    countCollection(db, 'research_entity_stats'),
    countCollection(db, 'paper_group_links'),
    countCollection(db, 'paper_entity_links'),
    Promise.all(REFERENCE_CHECKS.map((check) => countDanglingReferences(db, check))),
  ]);

  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        strategy: 'hard-pivot-copy',
        collections: {
          research_groups: researchGroups,
          research_entities: researchEntities,
          research_group_members: researchGroupMembers,
          research_entity_members: researchEntityMembers,
          research_group_stats: researchGroupStats,
          research_entity_stats: researchEntityStats,
          paper_group_links: paperGroupLinks,
          paper_entity_links: paperEntityLinks,
        },
        references,
        rollbackNote:
          'No writes are performed by this audit. research_entities is canonical; research_groups may be absent after verified source cleanup.',
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error('Failed to audit ResearchEntity rename readiness:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });

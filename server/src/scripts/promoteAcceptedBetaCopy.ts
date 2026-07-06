import dotenv from 'dotenv';
import fs from 'fs';
import { MongoClient, type AnyBulkWriteOperation, type Db, type Document } from 'mongodb';
import path from 'path';
import { fileURLToPath } from 'url';
import { summarizeMongoUrl } from '../scrapers/scraperEnvironment';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';

dotenv.config();

type Mode = 'dry-run' | 'apply';
type PromotionCollectionCategory = 'research-discovery' | 'source-audit' | 'base-support';

interface PromotionCollection {
  name: string;
  category: PromotionCollectionCategory;
  filter?: Document;
}

const DATASET_VERSION_PATTERN = /^prod-promote-\d{4}-\d{2}-\d{2}-lane-a-beta-copy$/;
const BATCH_SIZE = 1000;

const SYNTHETIC_USER_MATCHES: Document[] = [
  { netid: { $in: ['devadmin', 'test123'] } },
  { email: /@example\.invalid$/i },
  { email: /^test[+@.]/i },
];

const SYNTHETIC_USER_MATCH: Document = { $or: SYNTHETIC_USER_MATCHES };
const SYNTHETIC_USER_FILTER: Document = { $nor: SYNTHETIC_USER_MATCHES };

const COPY_COLLECTIONS: PromotionCollection[] = [
  { name: 'research_entities', category: 'research-discovery' },
  { name: 'research_entity_members', category: 'research-discovery' },
  { name: 'entry_pathways', category: 'research-discovery' },
  { name: 'access_signals', category: 'research-discovery' },
  { name: 'contact_routes', category: 'research-discovery' },
  { name: 'posted_opportunities', category: 'research-discovery' },
  { name: 'papers', category: 'research-discovery' },
  { name: 'paper_authors', category: 'research-discovery' },
  { name: 'research_scholarly_links', category: 'research-discovery' },
  { name: 'research_scholarly_attributions', category: 'research-discovery' },
  { name: 'grants', category: 'research-discovery' },
  { name: 'sources', category: 'source-audit' },
  { name: 'scrape_runs', category: 'source-audit' },
  { name: 'observations', category: 'source-audit' },
  { name: 'users', category: 'base-support', filter: SYNTHETIC_USER_FILTER },
  { name: 'listings', category: 'base-support' },
  { name: 'departments', category: 'base-support' },
  { name: 'research_areas', category: 'base-support' },
  { name: 'fellowships', category: 'base-support' },
];

export interface PromotionOptions {
  mode: Mode;
  datasetVersion: string;
  restorePoint: string;
  betaUrl: string;
  productionUrl: string;
  confirmLane: boolean;
  confirmProd: boolean;
  includeObservations: boolean;
  output?: string;
}

export interface CollectionPlan {
  name: string;
  category: PromotionCollectionCategory;
  sourceCount: number;
  sourceCopyCount: number;
  targetCount: number;
  excludedCount: number;
}

export interface SyntheticUserReference {
  collection: string;
  field: string;
  count: number;
}

interface CollectionCategorySummary {
  category: PromotionCollectionCategory;
  collectionCount: number;
  sourceCount: number;
  sourceCopyCount: number;
  targetCount: number;
  excludedCount: number;
}

export interface PromotionSummary {
  mode: Mode;
  sourceEnvironment: 'beta';
  targetEnvironment: 'production';
  datasetVersion: string;
  restorePoint: string | null;
  betaTarget: string;
  productionTarget: string;
  includesObservations: boolean;
  collections: CollectionPlan[];
  collectionCategories: CollectionCategorySummary[];
  excludedSyntheticUsers: number;
  syntheticReferenceBlockersClear: boolean;
  applyBlockers: string[];
  blockedSyntheticUserReferences: SyntheticUserReference[];
}

const USER_REFERENCE_FIELDS: Array<{ collection: string; field: string }> = [
  { collection: 'research_entity_members', field: 'userId' },
  { collection: 'research_entities', field: 'claimedByUserId' },
  { collection: 'research_entities', field: 'studentVisibilityReviewedByUserId' },
  { collection: 'entry_pathways', field: 'review.reviewedByUserId' },
  { collection: 'access_signals', field: 'review.reviewedByUserId' },
  { collection: 'contact_routes', field: 'personId' },
  { collection: 'contact_routes', field: 'review.reviewedByUserId' },
  { collection: 'posted_opportunities', field: 'review.reviewedByUserId' },
  { collection: 'paper_authors', field: 'userId' },
  { collection: 'research_scholarly_links', field: 'userId' },
  { collection: 'research_scholarly_attributions', field: 'targetUserId' },
  { collection: 'listings', field: 'createdByUserId' },
  { collection: 'fellowships', field: 'studentVisibilityReviewedByUserId' },
];

const COLLECTION_CATEGORY_ORDER: PromotionCollectionCategory[] = [
  'research-discovery',
  'source-audit',
  'base-support',
];

export function parsePromotionOptions(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): PromotionOptions {
  let mode: Mode = 'dry-run';
  let datasetVersion = env.PROMOTION_DATASET_VERSION || '';
  let restorePoint = env.ATLAS_RESTORE_POINT || '';
  let includeObservations = true;
  let output: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--apply' || arg === '--mode=apply') {
      mode = 'apply';
      continue;
    }
    if (arg === '--dry-run' || arg === '--mode=dry-run') {
      mode = 'dry-run';
      continue;
    }
    if (arg === '--skip-observations') {
      includeObservations = false;
      continue;
    }
    if (arg.startsWith('--dataset-version=')) {
      datasetVersion = arg.slice('--dataset-version='.length).trim();
      if (!datasetVersion) throw new Error('--dataset-version requires a value');
      continue;
    }
    if (arg === '--dataset-version') {
      const next = argv[index + 1]?.trim();
      if (!next || next.startsWith('--')) throw new Error('--dataset-version requires a value');
      datasetVersion = next;
      index += 1;
      continue;
    }
    if (arg.startsWith('--restore-point=')) {
      restorePoint = arg.slice('--restore-point='.length).trim();
      if (!restorePoint) throw new Error('--restore-point requires a value');
      continue;
    }
    if (arg === '--restore-point') {
      const next = argv[index + 1]?.trim();
      if (!next || next.startsWith('--')) throw new Error('--restore-point requires a value');
      restorePoint = next;
      index += 1;
      continue;
    }
    if (arg.startsWith('--output=')) {
      output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length).trim());
      continue;
    }
    if (arg === '--output') {
      const next = argv[index + 1]?.trim();
      output = resolveSafeJsonReportOutputPath(next);
      index += 1;
      continue;
    }

    throw new Error(`Unknown production:promote-beta-copy argument: ${arg}`);
  }

  const betaUrl = env.BETA_MONGODBURL || '';
  const productionUrl = env.PRODUCTION_MONGODBURL || '';

  return {
    mode,
    datasetVersion,
    restorePoint,
    betaUrl,
    productionUrl,
    includeObservations,
    output,
    confirmLane: env.CONFIRM_LANE_A_COPY === 'true',
    confirmProd: env.CONFIRM_PROD_SCRAPE === 'true',
  };
}

export function assertSafeOptions(options: PromotionOptions) {
  if (!options.betaUrl) throw new Error('BETA_MONGODBURL is required');
  if (!options.productionUrl) throw new Error('PRODUCTION_MONGODBURL is required');
  if (options.betaUrl === options.productionUrl) {
    throw new Error('BETA_MONGODBURL and PRODUCTION_MONGODBURL must be different');
  }
  if (!DATASET_VERSION_PATTERN.test(options.datasetVersion)) {
    throw new Error(
      'A dataset version like prod-promote-YYYY-MM-DD-lane-a-beta-copy is required via --dataset-version or PROMOTION_DATASET_VERSION',
    );
  }
  if (options.mode === 'apply') {
    if (!options.restorePoint) {
      throw new Error('Apply mode requires --restore-point or ATLAS_RESTORE_POINT');
    }
    if (!options.confirmLane || !options.confirmProd) {
      throw new Error(
        'Apply mode requires CONFIRM_LANE_A_COPY=true and CONFIRM_PROD_SCRAPE=true',
      );
    }
  }
}

export function buildPromotionSummary(
  options: PromotionOptions,
  plan: CollectionPlan[],
  blockedSyntheticUserReferences: SyntheticUserReference[],
): PromotionSummary {
  const collectionCategories = COLLECTION_CATEGORY_ORDER.flatMap((category) => {
    const rows = plan.filter((row) => row.category === category);
    if (rows.length === 0) return [];
    return {
      category,
      collectionCount: rows.length,
      sourceCount: rows.reduce((sum, row) => sum + row.sourceCount, 0),
      sourceCopyCount: rows.reduce((sum, row) => sum + row.sourceCopyCount, 0),
      targetCount: rows.reduce((sum, row) => sum + row.targetCount, 0),
      excludedCount: rows.reduce((sum, row) => sum + row.excludedCount, 0),
    };
  });
  const applyBlockers = buildApplyBlockers(blockedSyntheticUserReferences);

  return {
    mode: options.mode,
    sourceEnvironment: 'beta',
    targetEnvironment: 'production',
    datasetVersion: options.datasetVersion,
    restorePoint: options.restorePoint || null,
    betaTarget: summarizeMongoUrl(options.betaUrl),
    productionTarget: summarizeMongoUrl(options.productionUrl),
    includesObservations: options.includeObservations,
    collections: plan,
    collectionCategories,
    excludedSyntheticUsers: plan.find((row) => row.name === 'users')?.excludedCount || 0,
    syntheticReferenceBlockersClear: applyBlockers.length === 0,
    applyBlockers,
    blockedSyntheticUserReferences,
  };
}

function buildApplyBlockers(blockedSyntheticUserReferences: SyntheticUserReference[]): string[] {
  if (blockedSyntheticUserReferences.length === 0) return [];

  const totalReferences = blockedSyntheticUserReferences.reduce((sum, row) => sum + row.count, 0);
  const referenceWord = totalReferences === 1 ? 'link' : 'links';
  const fieldWord = blockedSyntheticUserReferences.length === 1 ? 'collection field' : 'collection fields';

  return [
    `Copied records reference ${totalReferences} excluded synthetic-user ${referenceWord} across ${blockedSyntheticUserReferences.length} ${fieldWord}.`,
  ];
}

export function assertPromotionSummaryCanApply(summary: PromotionSummary) {
  if (summary.applyBlockers.length > 0) {
    throw new Error(`Apply mode blocked: ${summary.applyBlockers.join(' ')}`);
  }
}

export function writePromotionOutput(report: unknown, output?: string): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
}

function promotionCollectionsForOptions(options: PromotionOptions): PromotionCollection[] {
  return COPY_COLLECTIONS.filter(
    (collection) => options.includeObservations || collection.name !== 'observations',
  );
}

export function promotionCollectionNamesForOptions(options: PromotionOptions): string[] {
  return promotionCollectionsForOptions(options).map((collection) => collection.name);
}

async function countCollection(db: Db, collection: PromotionCollection): Promise<CollectionPlan> {
  const exists = await db.listCollections({ name: collection.name }, { nameOnly: true }).hasNext();
  const targetPlaceholder = {
    name: collection.name,
    category: collection.category,
    sourceCount: 0,
    sourceCopyCount: 0,
    targetCount: 0,
    excludedCount: 0,
  };
  if (!exists) return targetPlaceholder;

  const source = db.collection(collection.name);
  const sourceCount = await source.countDocuments();
  const sourceCopyCount = await source.countDocuments(collection.filter || {});
  return {
    ...targetPlaceholder,
    sourceCount,
    sourceCopyCount,
    excludedCount: sourceCount - sourceCopyCount,
  };
}

async function buildPlan(
  betaDb: Db,
  productionDb: Db,
  options: PromotionOptions,
): Promise<CollectionPlan[]> {
  const collections = promotionCollectionsForOptions(options);
  return Promise.all(
    collections.map(async (collection) => {
      const sourcePlan = await countCollection(betaDb, collection);
      const targetExists = await productionDb
        .listCollections({ name: collection.name }, { nameOnly: true })
        .hasNext();
      const targetCount = targetExists
        ? await productionDb.collection(collection.name).countDocuments()
        : 0;
      return { ...sourcePlan, targetCount };
    }),
  );
}

async function syntheticUserReferences(betaDb: Db): Promise<SyntheticUserReference[]> {
  const excludedUsers = await betaDb
    .collection('users')
    .find(SYNTHETIC_USER_MATCH, { projection: { _id: 1 } })
    .toArray();
  const excludedIds = excludedUsers.map((user) => user._id);
  if (excludedIds.length === 0) return [];

  const rows = await Promise.all(
    USER_REFERENCE_FIELDS.map(async ({ collection, field }) => {
      const exists = await betaDb.listCollections({ name: collection }, { nameOnly: true }).hasNext();
      if (!exists) return { collection, field, count: 0 };
      const count = await betaDb.collection(collection).countDocuments({ [field]: { $in: excludedIds } });
      return { collection, field, count };
    }),
  );

  return rows.filter((row) => row.count > 0);
}

async function syncIndexes(betaDb: Db, productionDb: Db, collectionName: string) {
  const source = betaDb.collection(collectionName);
  const target = productionDb.collection(collectionName);
  const indexes = await source.indexes();
  const secondaryIndexes = indexes.filter((index) => index.name !== '_id_');
  if (secondaryIndexes.length === 0) return;

  await target.createIndexes(
    secondaryIndexes.map((index) => {
      const { key, name, v: _version, ns: _namespace, ...options } = index;
      return { key, name, ...options };
    }),
  );
}

async function copyCollection(betaDb: Db, productionDb: Db, collection: PromotionCollection) {
  const source = betaDb.collection(collection.name);
  const target = productionDb.collection(collection.name);
  await target.deleteMany({});

  const cursor = source.find(collection.filter || {}, { noCursorTimeout: true });
  let batch: AnyBulkWriteOperation<Document>[] = [];
  try {
    for await (const doc of cursor) {
      batch.push({ insertOne: { document: doc } });
      if (batch.length >= BATCH_SIZE) {
        await target.bulkWrite(batch, { ordered: false });
        batch = [];
      }
    }
    if (batch.length > 0) {
      await target.bulkWrite(batch, { ordered: false });
    }
  } finally {
    await cursor.close();
  }

  await syncIndexes(betaDb, productionDb, collection.name);
}

async function applyCopy(betaDb: Db, productionDb: Db, options: PromotionOptions) {
  const collections = promotionCollectionsForOptions(options);
  for (const collection of collections) {
    await copyCollection(betaDb, productionDb, collection);
  }
}

async function main() {
  const options = parsePromotionOptions(process.argv.slice(2));
  assertSafeOptions(options);

  const betaClient = new MongoClient(options.betaUrl);
  const productionClient = new MongoClient(options.productionUrl);

  try {
    await betaClient.connect();
    await productionClient.connect();
    const betaDb = betaClient.db();
    const productionDb = productionClient.db();
    const plan = await buildPlan(betaDb, productionDb, options);
    const blockedSyntheticUserReferences = await syntheticUserReferences(betaDb);

    const summary = buildPromotionSummary(options, plan, blockedSyntheticUserReferences);

    console.log(JSON.stringify(summary, null, 2));
    writePromotionOutput(summary, options.output);

    if (options.mode === 'apply') {
      assertPromotionSummaryCanApply(summary);
      await applyCopy(betaDb, productionDb, options);
      const after = await buildPlan(betaDb, productionDb, options);
      console.log(
        JSON.stringify(
          {
            status: 'applied',
            datasetVersion: options.datasetVersion,
            restorePoint: options.restorePoint,
            collections: after,
          },
          null,
          2,
        ),
      );
    }
  } finally {
    await betaClient.close();
    await productionClient.close();
  }
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error));
    process.exitCode = 1;
  });
}

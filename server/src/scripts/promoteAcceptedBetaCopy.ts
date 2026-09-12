import dotenv from 'dotenv';
import fs from 'fs';
import { MongoClient, type AnyBulkWriteOperation, type Db, type Document } from 'mongodb';
import path from 'path';
import { fileURLToPath } from 'url';
import { summarizeMongoUrl } from '../scrapers/scraperEnvironment';
import { assertNoNeverCopyCollections } from './mirrorCollectionPolicy';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { applyStagedCollectionSwap, stagedSwapCollectionExists } from './stagedCollectionSwap';

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

const PROMOTION_STAGING_PREFIX = '__prod_promote_staging_';
const PROMOTION_BACKUP_PREFIX = '__prod_promote_backup_';

const COPY_COLLECTIONS: PromotionCollection[] = [
  { name: 'research_entities', category: 'research-discovery' },
  { name: 'research_entity_relationships', category: 'research-discovery' },
  { name: 'research_entity_redirects', category: 'research-discovery' },
  { name: 'accounts', category: 'research-discovery', filter: SYNTHETIC_USER_FILTER },
  { name: 'researchers', category: 'research-discovery' },
  { name: 'role_assignments', category: 'research-discovery' },
  { name: 'signals', category: 'research-discovery' },
  { name: 'sources', category: 'source-audit' },
  { name: 'scrape_runs', category: 'source-audit' },
  { name: 'observations', category: 'source-audit' },
  { name: 'departments', category: 'base-support' },
  { name: 'org_units', category: 'base-support' },
  { name: 'research_areas', category: 'base-support' },
  { name: 'taxonomy_terms', category: 'base-support' },
  { name: 'fellowships', category: 'base-support' },
];

export interface PromotionOptions {
  mode: Mode;
  datasetVersion: string;
  betaUrl: string;
  productionUrl: string;
  confirmLane: boolean;
  confirmProd: boolean;
  includeObservations: boolean;
  includeScrapeRuns: boolean;
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
  betaTarget: string;
  productionTarget: string;
  includesObservations: boolean;
  includesScrapeRuns: boolean;
  collections: CollectionPlan[];
  collectionCategories: CollectionCategorySummary[];
  excludedSyntheticUsers: number;
  syntheticReferenceBlockersClear: boolean;
  emptySourceBlockersClear: boolean;
  runEvidenceBlockersClear: boolean;
  applyBlockers: string[];
  blockedSyntheticUserReferences: SyntheticUserReference[];
}

const ACCOUNT_REFERENCE_FIELDS: Array<{ collection: string; field: string }> = [
  { collection: 'researchers', field: 'accountId' },
  { collection: 'research_entities', field: 'studentVisibilityReviewedByAccountId' },
  { collection: 'fellowships', field: 'studentVisibilityReviewedByAccountId' },
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
  let includeObservations = false;
  // Default OFF, matching observations. Production has never scraped anything -
  // Development is the only environment that does - so a promoted scrape_runs is a
  // copy of Development's history wearing Production's name. That is the fabricated
  // trail #2513 filed, not audit history worth carrying (#2589).
  let includeScrapeRuns = false;
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
    if (arg === '--include-observations') {
      includeObservations = true;
      continue;
    }
    if (arg === '--skip-scrape-runs') {
      includeScrapeRuns = false;
      continue;
    }
    if (arg === '--include-scrape-runs') {
      includeScrapeRuns = true;
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
    betaUrl,
    productionUrl,
    includeObservations,
    includeScrapeRuns,
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
    // Deliberately no restore-point gate. `ATLAS_RESTORE_POINT` was this script's
    // only rollback story and it was unverifiable - any non-empty string satisfied
    // it, so it recorded an operator's intention rather than a recoverable state.
    // The staged swap is the rollback now, asserted by test against a real mongod
    // (#2347).
    if (!options.confirmLane || !options.confirmProd) {
      throw new Error('Apply mode requires CONFIRM_LANE_A_COPY=true and CONFIRM_PROD_SCRAPE=true');
    }
  }
}

/**
 * `scrape_runs` and `observations` may not move apart.
 *
 * A run history without the observations it produced is an audit trail that
 * cannot be checked, and it is what makes a cron that never fired read as
 * successful: Production shows ~1,869 scrape runs against 0 observations
 * (#2513). `observations` is opt-in behind `--include-observations` while
 * `scrape_runs` copies unconditionally, so the default promotion reproduces that
 * state on every run.
 *
 * Refusing here rather than silently coupling them is deliberate. Dropping
 * `scrape_runs` from the manifest would leave Production's existing history in
 * place, which is the same unverifiable trail by a different route, so the
 * operator has to choose: promote both, or promote neither.
 */
export function buildRunEvidenceBlockers(plan: readonly CollectionPlan[]): string[] {
  const runs = plan.find((row) => row.name === 'scrape_runs');
  if (!runs) return [];
  // Promoting no run history installs no unverifiable history, so an empty
  // scrape_runs is never the defect this guard exists for.
  if (runs.sourceCopyCount === 0) return [];
  const observations = plan.find((row) => row.name === 'observations');
  if (!observations) {
    return [
      'scrape_runs is in the promotion manifest but observations is not, which installs a run history with no evidence behind it (#2513). Pass --include-observations, or drop --include-scrape-runs.',
    ];
  }
  if (runs.sourceCopyCount > 0 && observations.sourceCopyCount === 0) {
    return [
      `Beta offers ${runs.sourceCopyCount} scrape runs and 0 observations, so promoting both still installs a run history with no evidence behind it (#2513).`,
    ];
  }
  return [];
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
  const syntheticReferenceBlockers = buildApplyBlockers(blockedSyntheticUserReferences);
  const emptySourceBlockers = buildEmptySourceBlockers(plan);
  const auditTrailBlockers = buildRunEvidenceBlockers(plan);
  const applyBlockers = [
    ...syntheticReferenceBlockers,
    ...emptySourceBlockers,
    ...auditTrailBlockers,
  ];

  return {
    mode: options.mode,
    sourceEnvironment: 'beta',
    targetEnvironment: 'production',
    datasetVersion: options.datasetVersion,
    betaTarget: summarizeMongoUrl(options.betaUrl),
    productionTarget: summarizeMongoUrl(options.productionUrl),
    includesObservations: options.includeObservations,
    includesScrapeRuns: options.includeScrapeRuns,
    collections: plan,
    collectionCategories,
    excludedSyntheticUsers: plan.find((row) => row.name === 'accounts')?.excludedCount || 0,
    syntheticReferenceBlockersClear: syntheticReferenceBlockers.length === 0,
    emptySourceBlockersClear: emptySourceBlockers.length === 0,
    runEvidenceBlockersClear: auditTrailBlockers.length === 0,
    applyBlockers,
    blockedSyntheticUserReferences,
  };
}

// copyCollection deletes the whole target before inserting, so a collection that
// is empty on beta would empty production rather than leave it untouched. Compare
// sourceCopyCount, not sourceCount: accounts copies through SYNTHETIC_USER_FILTER,
// so its raw count overstates what would actually be written.
function buildEmptySourceBlockers(plan: CollectionPlan[]): string[] {
  return plan
    .filter((row) => row.sourceCopyCount === 0 && row.targetCount > 0)
    .map(
      (row) =>
        `Collection ${row.name} would copy 0 documents over ${row.targetCount} existing production ${
          row.targetCount === 1 ? 'document' : 'documents'
        }, which would empty it.`,
    );
}

function buildApplyBlockers(blockedSyntheticUserReferences: SyntheticUserReference[]): string[] {
  if (blockedSyntheticUserReferences.length === 0) return [];

  const totalReferences = blockedSyntheticUserReferences.reduce((sum, row) => sum + row.count, 0);
  const referenceWord = totalReferences === 1 ? 'link' : 'links';
  const fieldWord =
    blockedSyntheticUserReferences.length === 1 ? 'collection field' : 'collection fields';

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
  const collections = COPY_COLLECTIONS.filter((collection) => {
    if (collection.name === 'observations') return options.includeObservations;
    if (collection.name === 'scrape_runs') return options.includeScrapeRuns;
    return true;
  });
  assertNoNeverCopyCollections(collections.map((collection) => collection.name));
  return collections;
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
    .collection('accounts')
    .find(SYNTHETIC_USER_MATCH, { projection: { _id: 1 } })
    .toArray();
  const excludedIds = excludedUsers.map((user) => user._id);
  if (excludedIds.length === 0) return [];

  const rows = await Promise.all(
    ACCOUNT_REFERENCE_FIELDS.map(async ({ collection, field }) => {
      const exists = await betaDb
        .listCollections({ name: collection }, { nameOnly: true })
        .hasNext();
      if (!exists) return { collection, field, count: 0 };
      const count = await betaDb
        .collection(collection)
        .countDocuments({ [field]: { $in: excludedIds } });
      return { collection, field, count };
    }),
  );

  return rows.filter((row) => row.count > 0);
}

async function syncIndexes(
  betaDb: Db,
  productionDb: Db,
  collectionName: string,
  targetCollectionName: string = collectionName,
) {
  const source = betaDb.collection(collectionName);
  const target = productionDb.collection(targetCollectionName);
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

/**
 * Copy one collection from Beta into a STAGING collection in Production.
 *
 * Nothing in Production is deleted or renamed here, so a source-side failure -
 * the shared-Atlas-tier cursor rejection that caused #2347, an auth failure, a
 * lost topology - aborts with every live Production collection untouched. The
 * cursor is still primed with `hasNext()` before any write so those failures
 * surface as early as possible (#2346).
 */
async function stageCollection(
  betaDb: Db,
  productionDb: Db,
  collection: PromotionCollection,
  operationId: string,
): Promise<string> {
  const stagingName = `${PROMOTION_STAGING_PREFIX}${operationId}_${collection.name}`;
  const staging = productionDb.collection(stagingName);
  if (await stagedSwapCollectionExists(productionDb, stagingName)) {
    await staging.drop();
  }

  const source = betaDb.collection(collection.name);
  const cursor = source.find(collection.filter || {}, { batchSize: BATCH_SIZE });
  let batch: AnyBulkWriteOperation<Document>[] = [];
  try {
    await cursor.hasNext();
    for await (const doc of cursor) {
      batch.push({ insertOne: { document: doc } });
      if (batch.length >= BATCH_SIZE) {
        await staging.bulkWrite(batch, { ordered: false });
        batch = [];
      }
    }
    if (batch.length > 0) {
      await staging.bulkWrite(batch, { ordered: false });
    }
  } finally {
    await cursor.close();
  }

  await syncIndexes(betaDb, productionDb, collection.name, stagingName);
  return stagingName;
}

/**
 * Every promoted collection must land in Production with exactly the row count
 * Beta offered for it, checked after cutover and before any backup is dropped.
 * Mirrors the Development sync's verify callback: a short copy is a failure, not
 * a warning, and it rolls the whole promotion back.
 */
export function buildPromotionCutoverMismatches(
  plan: readonly CollectionPlan[],
  actualCounts: ReadonlyMap<string, number>,
): string[] {
  return plan.flatMap((row) => {
    const actual = actualCounts.get(row.name);
    if (actual === row.sourceCopyCount) return [];
    return [
      `${row.name} promoted ${actual ?? 0} rows against ${row.sourceCopyCount} offered by Beta.`,
    ];
  });
}

async function applyCopy(betaDb: Db, productionDb: Db, options: PromotionOptions) {
  const collections = promotionCollectionsForOptions(options);
  const plan = await buildPlan(betaDb, productionDb, options);

  await applyStagedCollectionSwap({
    targetDb: productionDb,
    collections,
    backupPrefix: PROMOTION_BACKUP_PREFIX,
    label: 'Beta to Production promotion',
    stage: (collection, operationId) =>
      stageCollection(betaDb, productionDb, collection, operationId),
    verify: async () => {
      const actualCounts = new Map<string, number>();
      for (const collection of collections) {
        actualCounts.set(
          collection.name,
          await productionDb.collection(collection.name).countDocuments({}),
        );
      }
      const mismatches = buildPromotionCutoverMismatches(
        plan.filter((row) => collections.some((collection) => collection.name === row.name)),
        actualCounts,
      );
      if (mismatches.length > 0) {
        throw new Error(`Promotion cutover verification failed: ${mismatches.join(' ')}`);
      }
    },
  });
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

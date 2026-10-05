import dotenv from 'dotenv';
import fs from 'fs';
import {
  MongoClient,
  type AnyBulkWriteOperation,
  type Db,
  type Document,
  type ObjectId,
} from 'mongodb';
import path from 'path';
import { fileURLToPath } from 'url';
import { summarizeMongoUrl } from '../scrapers/scraperEnvironment';
import { reduceAccountToMirroredFields } from './mirroredAccountFields';
import { assertNoNeverCopyCollections } from './mirrorCollectionPolicy';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  assertDatabaseCopyPair,
  assertDatabaseCopyPairUrls,
  parseMongoTarget,
  type ResolvedDatabaseCopyPair,
} from './databaseCopyPairs';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  ACCOUNT_ID_REFERENCE_FIELDS,
  accountCountChange,
  applyAccountCarry,
  loadAccountCarryPlan,
  summarizeAccountCarry,
  type AccountCarryPlan,
} from './accountSwapCarry';
import {
  applyStagedCollectionSwap,
  mirroredValidationOptions,
  stagedSwapCollectionExists,
} from './stagedCollectionSwap';

dotenv.config({ quiet: true });

type Mode = 'dry-run' | 'apply';
type PromotionCollectionCategory = 'research-discovery' | 'source-audit' | 'base-support';

interface PromotionCollection {
  name: string;
  category: PromotionCollectionCategory;
  filter?: Document;
  transform?: (document: Document) => Document;
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

const PROMOTION_ACTOR_NETID_PATTERN = /^[a-z0-9]{2,12}$/;
const RETIRE_SCRAPE_RUNS_ACTION = 'promotion.retire_production_scrape_runs';

const PROMOTION_STAGING_PREFIX = '__prod_promote_staging_';
const PROMOTION_BACKUP_PREFIX = '__prod_promote_backup_';

const COPY_COLLECTIONS: PromotionCollection[] = [
  { name: 'research_entities', category: 'research-discovery' },
  { name: 'research_entity_relationships', category: 'research-discovery' },
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
  retireScrapeRunsActor: string;
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
  sourceDatabase: string;
  targetDatabase: string;
  includesObservations: boolean;
  includesScrapeRuns: boolean;
  collections: CollectionPlan[];
  collectionCategories: CollectionCategorySummary[];
  excludedSyntheticUsers: number;
  excludedBetaLoginAccounts: number;
  syntheticReferenceBlockersClear: boolean;
  emptySourceBlockersClear: boolean;
  runEvidenceBlockersClear: boolean;
  retiresProductionScrapeRuns: boolean;
  retireScrapeRunsBlockersClear: boolean;
  applyBlockers: string[];
  blockedSyntheticUserReferences: SyntheticUserReference[];
}

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
  let retireScrapeRunsActor = '';
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
    // Carries the operator's netid rather than being a bare switch: this deletes a
    // Production collection, so the audit marker it writes must name someone.
    if (arg.startsWith('--retire-scrape-runs=')) {
      retireScrapeRunsActor = arg.slice('--retire-scrape-runs='.length).trim().toLowerCase();
      if (!retireScrapeRunsActor) {
        throw new Error('--retire-scrape-runs requires the operator netid as its value');
      }
      continue;
    }
    if (arg === '--retire-scrape-runs') {
      throw new Error(
        '--retire-scrape-runs requires the operator netid as its value, for example --retire-scrape-runs=abc12',
      );
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
    retireScrapeRunsActor,
    output,
    confirmLane: env.CONFIRM_LANE_A_COPY === 'true',
    confirmProd: env.CONFIRM_PROD_SCRAPE === 'true',
  };
}

export function assertSafeOptions(options: PromotionOptions): ResolvedDatabaseCopyPair {
  if (!options.betaUrl) throw new Error('BETA_MONGODBURL is required');
  if (!options.productionUrl) throw new Error('PRODUCTION_MONGODBURL is required');
  if (options.betaUrl === options.productionUrl) {
    throw new Error('BETA_MONGODBURL and PRODUCTION_MONGODBURL must be different');
  }
  const databases = assertDatabaseCopyPairUrls(
    'beta-to-production',
    options.betaUrl,
    options.productionUrl,
  );
  if (!DATASET_VERSION_PATTERN.test(options.datasetVersion)) {
    throw new Error(
      'A dataset version like prod-promote-YYYY-MM-DD-lane-a-beta-copy is required via --dataset-version or PROMOTION_DATASET_VERSION',
    );
  }
  if (options.retireScrapeRunsActor) {
    if (!PROMOTION_ACTOR_NETID_PATTERN.test(options.retireScrapeRunsActor)) {
      throw new Error('--retire-scrape-runs requires a valid operator netid as its value');
    }
    if (options.includeScrapeRuns) {
      throw new Error(
        '--retire-scrape-runs and --include-scrape-runs contradict each other: one clears Production scrape_runs, the other replaces it',
      );
    }
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
  return databases;
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

/**
 * Clearing Production's run history is only correct while that history has no
 * evidence behind it.
 *
 * The rows are Development's runs arriving by promotion - Production has never
 * scraped anything - so they are the fabricated trail #2513 filed rather than a
 * record worth keeping. But if Production ever does hold observations, those runs
 * are the provenance for them, and deleting the runs would orphan the evidence.
 * So this refuses rather than assuming the premise still holds (#2589).
 */
export function buildRetireScrapeRunsBlockers(args: {
  requested: boolean;
  productionObservationCount: number;
}): string[] {
  if (!args.requested) return [];
  if (args.productionObservationCount > 0) {
    return [
      `Production holds ${args.productionObservationCount} observations, so its scrape_runs are the provenance for real evidence and must not be cleared (#2589).`,
    ];
  }
  return [];
}

export function buildPromotionSummary(
  options: PromotionOptions,
  plan: CollectionPlan[],
  blockedSyntheticUserReferences: SyntheticUserReference[],
  productionObservationCount = 0,
  excludedBetaLoginAccounts = 0,
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
  const retireBlockers = buildRetireScrapeRunsBlockers({
    requested: Boolean(options.retireScrapeRunsActor),
    productionObservationCount,
  });
  const applyBlockers = [
    ...syntheticReferenceBlockers,
    ...emptySourceBlockers,
    ...auditTrailBlockers,
    ...retireBlockers,
  ];

  return {
    mode: options.mode,
    sourceEnvironment: 'beta',
    targetEnvironment: 'production',
    datasetVersion: options.datasetVersion,
    betaTarget: summarizeMongoUrl(options.betaUrl),
    productionTarget: summarizeMongoUrl(options.productionUrl),
    sourceDatabase: parseMongoTarget(options.betaUrl).database,
    targetDatabase: parseMongoTarget(options.productionUrl).database,
    includesObservations: options.includeObservations,
    includesScrapeRuns: options.includeScrapeRuns,
    collections: plan,
    collectionCategories,
    // The accounts row's excludedCount now covers both exclusions, so the
    // synthetic count is what remains once the Beta logins are taken out.
    excludedSyntheticUsers: Math.max(
      (plan.find((row) => row.name === 'accounts')?.excludedCount || 0) - excludedBetaLoginAccounts,
      0,
    ),
    excludedBetaLoginAccounts,
    syntheticReferenceBlockersClear: syntheticReferenceBlockers.length === 0,
    emptySourceBlockersClear: emptySourceBlockers.length === 0,
    runEvidenceBlockersClear: auditTrailBlockers.length === 0,
    retiresProductionScrapeRuns: Boolean(options.retireScrapeRunsActor),
    retireScrapeRunsBlockersClear: retireBlockers.length === 0,
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

function collectionExists(db: Db, name: string): Promise<boolean> {
  return db.listCollections({ name }, { nameOnly: true }).hasNext();
}

async function distinctReferenceKeys(
  db: Db,
  collectionName: string,
  field: string,
): Promise<string[]> {
  if (!(await collectionExists(db, collectionName))) return [];
  const values = await db.collection(collectionName).distinct(field);
  return values.filter((value) => value != null).map(String);
}

/**
 * Beta accounts that describe a Beta login rather than the identity spine.
 *
 * Since #4139 the Development-to-Beta sync carries Beta's own login accounts
 * across the swap, so Beta holds real logins indefinitely. Production's accounts
 * are authoritative for Production, and a Beta login is not one of them, so such
 * a row must not cross: once promoted its Beta `lastLoginAt` makes it read as a
 * Production login to the carry, which then re-carries it forever (#4244).
 *
 * Login evidence is the same predicate the carry uses - a `lastLoginAt`, or an
 * owned `research_plans` row - read against Beta. Reachability is deliberately
 * measured over the promoted collections only, so a row the promotion itself
 * references is kept and no promoted reference is left dangling. `research_plans`
 * is not promoted, which is why owning one is evidence of a login rather than of
 * spine membership.
 *
 * Synthetic rows are read out under `SYNTHETIC_USER_FILTER` even though they are
 * excluded anyway, so that this set and the synthetic exclusion stay disjoint:
 * `excludedSyntheticUsers` is `excludedCount` minus this count, and an overlap
 * would under-report it.
 */
export async function betaOnlyLoginAccountIds(
  betaDb: Db,
  promotedCollectionNames: readonly string[],
): Promise<ObjectId[]> {
  const planOwnerKeys = new Set(await distinctReferenceKeys(betaDb, 'research_plans', 'accountId'));
  const accounts = await betaDb
    .collection('accounts')
    .find(SYNTHETIC_USER_FILTER, { projection: { _id: 1, lastLoginAt: 1 } })
    .toArray();
  const withLoginEvidence = accounts.filter(
    (account) => account.lastLoginAt != null || planOwnerKeys.has(String(account._id)),
  );
  if (withLoginEvidence.length === 0) return [];

  const promotedReferenceKeys = new Set<string>();
  for (const { collection, field } of ACCOUNT_ID_REFERENCE_FIELDS) {
    if (!promotedCollectionNames.includes(collection)) continue;
    for (const key of await distinctReferenceKeys(betaDb, collection, field)) {
      promotedReferenceKeys.add(key);
    }
  }

  return withLoginEvidence
    .filter((account) => !promotedReferenceKeys.has(String(account._id)))
    .map((account) => account._id as ObjectId);
}

function accountsPromotionFilter(excludedBetaLoginIds: readonly ObjectId[]): Document {
  if (excludedBetaLoginIds.length === 0) return SYNTHETIC_USER_FILTER;
  return { $and: [SYNTHETIC_USER_FILTER, { _id: { $nin: excludedBetaLoginIds } }] };
}

export interface ResolvedPromotionManifest {
  collections: PromotionCollection[];
  excludedBetaLoginAccounts: number;
}

/**
 * The promotion manifest with the `accounts` rule applied.
 *
 * Both halves belong to the same rule and must be resolved together: the filter
 * drops Beta-only logins, and the transform reduces every row that does cross to
 * the mirror allow-list so no `lastLoginAt` or student profile field leaves Beta.
 * The filter has to be known at plan time rather than at insert time because the
 * cutover verifies the promoted count against it.
 */
export async function resolvePromotionManifest(
  betaDb: Db,
  options: PromotionOptions,
): Promise<ResolvedPromotionManifest> {
  const collections = promotionCollectionsForOptions(options);
  const excludedBetaLoginIds = await betaOnlyLoginAccountIds(
    betaDb,
    collections.map((collection) => collection.name),
  );
  return {
    excludedBetaLoginAccounts: excludedBetaLoginIds.length,
    collections: collections.map((collection) =>
      collection.name === 'accounts'
        ? {
            ...collection,
            filter: accountsPromotionFilter(excludedBetaLoginIds),
            transform: reduceAccountToMirroredFields,
          }
        : collection,
    ),
  };
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
  collections: readonly PromotionCollection[],
): Promise<CollectionPlan[]> {
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

export async function syntheticUserReferences(betaDb: Db): Promise<SyntheticUserReference[]> {
  const excludedUsers = await betaDb
    .collection('accounts')
    .find(SYNTHETIC_USER_MATCH, { projection: { _id: 1 } })
    .toArray();
  const excludedIds = excludedUsers.map((user) => user._id);
  if (excludedIds.length === 0) return [];

  const rows = await Promise.all(
    ACCOUNT_ID_REFERENCE_FIELDS.filter(({ collection }) =>
      COPY_COLLECTIONS.some((copied) => copied.name === collection),
    ).map(async ({ collection, field }) => {
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
 *
 * Staging is created explicitly rather than implicitly by its first write so it
 * carries the mirrored validation options; the cutover renames it over the live
 * collection, and a rename carries none of its own (#754).
 */
async function stageCollection(
  betaDb: Db,
  productionDb: Db,
  collection: PromotionCollection,
  operationId: string,
): Promise<string> {
  const stagingName = `${PROMOTION_STAGING_PREFIX}${operationId}_${collection.name}`;
  if (await stagedSwapCollectionExists(productionDb, stagingName)) {
    await productionDb.collection(stagingName).drop();
  }
  await productionDb.createCollection(
    stagingName,
    await mirroredValidationOptions(betaDb, productionDb, collection.name),
  );
  const staging = productionDb.collection(stagingName);

  const source = betaDb.collection(collection.name);
  const cursor = source.find(collection.filter || {}, { batchSize: BATCH_SIZE });
  let batch: AnyBulkWriteOperation<Document>[] = [];
  try {
    await cursor.hasNext();
    for await (const doc of cursor) {
      batch.push({
        insertOne: { document: collection.transform ? collection.transform(doc) : doc },
      });
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

/**
 * Record that Production's run history was deliberately retired, not simply never
 * populated.
 *
 * After the clear Production reads 0 runs and 0 observations, which is the honest
 * state but is indistinguishable from "never scraped" - and that ambiguity read
 * from the other direction is what made #2513 hard to diagnose in the first place.
 * `admin_audit_events` is append-only, is not in the promotion manifest, and so is
 * not overwritten by a later promotion, which makes it the durable place to say so.
 */
async function recordScrapeRunsRetirement(
  productionDb: Db,
  options: PromotionOptions,
  retiredCount: number,
): Promise<void> {
  await productionDb.collection('admin_audit_events').insertOne({
    actorNetid: options.retireScrapeRunsActor,
    action: RETIRE_SCRAPE_RUNS_ACTION,
    targetType: 'collection',
    targetId: 'scrape_runs',
    summary: {
      retiredCount,
      datasetVersion: options.datasetVersion,
      reason:
        'Rows were Development scrape runs arriving by promotion; Production has never scraped, so the history had no evidence behind it (#2513/#2589).',
    },
    metadata: { promotedFrom: 'beta', clearedDuringPromotion: true },
    timestamp: new Date(),
  });
}

function withCarriedAccounts(plan: CollectionPlan[], carriedAccounts: number): CollectionPlan[] {
  return plan.map((row) =>
    row.name === 'accounts'
      ? { ...row, sourceCopyCount: row.sourceCopyCount + carriedAccounts }
      : row,
  );
}

// Reads the accounts rule the apply will use, so the dry run's
// `productionAccountCarry` describes the same promoted set the apply promotes.
export async function previewAccountCarry(
  betaDb: Db,
  productionDb: Db,
  manifest: ResolvedPromotionManifest,
): Promise<AccountCarryPlan> {
  const accounts = manifest.collections.find((collection) => collection.name === 'accounts');
  return loadAccountCarryPlan({
    targetDb: productionDb,
    targetAccountsCollection: 'accounts',
    loadPromotedAccounts: () =>
      betaDb
        .collection('accounts')
        .find(accounts?.filter ?? SYNTHETIC_USER_FILTER)
        .toArray(),
  });
}

export async function applyCopy(betaDb: Db, productionDb: Db, options: PromotionOptions) {
  const { collections } = await resolvePromotionManifest(betaDb, options);
  const plan = await buildPlan(betaDb, productionDb, collections);
  const retiring = Boolean(options.retireScrapeRunsActor);
  const retiredCount = retiring
    ? await productionDb.collection('scrape_runs').countDocuments({})
    : 0;

  let carriedAccountCountChange = 0;

  await applyStagedCollectionSwap({
    targetDb: productionDb,
    collections,
    clearedCollectionNames: retiring ? ['scrape_runs'] : [],
    backupPrefix: PROMOTION_BACKUP_PREFIX,
    label: 'Beta to Production promotion',
    stage: (collection, operationId) =>
      stageCollection(betaDb, productionDb, collection, operationId),
    afterCutover: async (backups) => {
      const productionAccounts = backups.get('accounts');
      if (!productionAccounts) return;
      const carry = await loadAccountCarryPlan({
        targetDb: productionDb,
        targetAccountsCollection: productionAccounts,
        loadPromotedAccounts: () =>
          productionDb.collection('accounts').find(SYNTHETIC_USER_FILTER).toArray(),
      });
      await applyAccountCarry(productionDb, carry);
      carriedAccountCountChange = accountCountChange(summarizeAccountCarry(carry));
    },
    verify: async () => {
      const actualCounts = new Map<string, number>();
      for (const collection of collections) {
        actualCounts.set(
          collection.name,
          await productionDb.collection(collection.name).countDocuments({}),
        );
      }
      const mismatches = buildPromotionCutoverMismatches(
        withCarriedAccounts(
          plan.filter((row) => collections.some((collection) => collection.name === row.name)),
          carriedAccountCountChange,
        ),
        actualCounts,
      );
      if (mismatches.length > 0) {
        throw new Error(`Promotion cutover verification failed: ${mismatches.join(' ')}`);
      }
      if (retiring) {
        const remaining = await productionDb.collection('scrape_runs').countDocuments({});
        if (remaining > 0) {
          throw new Error(
            `Promotion cutover verification failed: scrape_runs still holds ${remaining} rows after retirement.`,
          );
        }
      }
    },
  });

  // After the swap returns, so a rolled-back promotion never claims a retirement
  // that did not happen.
  if (retiring) {
    await recordScrapeRunsRetirement(productionDb, options, retiredCount);
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
    assertDatabaseCopyPair('beta-to-production', betaDb.databaseName, productionDb.databaseName);
    const manifest = await resolvePromotionManifest(betaDb, options);
    const plan = await buildPlan(betaDb, productionDb, manifest.collections);
    const blockedSyntheticUserReferences = await syntheticUserReferences(betaDb);
    // Counted directly rather than read off the plan: observations is opt-in, so it
    // is usually absent from the plan entirely and the guard would read 0 and pass.
    const productionObservationCount = await productionDb
      .collection('observations')
      .countDocuments({});

    const summary = buildPromotionSummary(
      options,
      plan,
      blockedSyntheticUserReferences,
      productionObservationCount,
      manifest.excludedBetaLoginAccounts,
    );

    const report = {
      ...summary,
      productionAccountCarry: summarizeAccountCarry(
        await previewAccountCarry(betaDb, productionDb, manifest),
      ),
    };
    console.log(JSON.stringify(report, null, 2));
    writePromotionOutput(report, options.output);

    if (options.mode === 'apply') {
      assertPromotionSummaryCanApply(summary);
      await applyCopy(betaDb, productionDb, options);
      const after = await buildPlan(
        betaDb,
        productionDb,
        (await resolvePromotionManifest(betaDb, options)).collections,
      );
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

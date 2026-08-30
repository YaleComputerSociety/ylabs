import dotenv from 'dotenv';
import fs from 'fs';
import {
  MongoClient,
  type AnyBulkWriteOperation,
  type CreateCollectionOptions,
  type Db,
  type Document,
  type ObjectId,
} from 'mongodb';
import path from 'path';
import { fileURLToPath } from 'url';
import { summarizeMongoUrl } from '../scrapers/scraperEnvironment';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertNoNeverCopyCollections } from './mirrorCollectionPolicy';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const betaOperatorProfilePath = path.join(SERVER_ROOT, '.env.beta-operator');
if (fs.existsSync(betaOperatorProfilePath) && !process.env.BETA_MONGODBURL) {
  const betaOperatorProfile = dotenv.parse(fs.readFileSync(betaOperatorProfilePath));
  if (betaOperatorProfile.MONGODBURL) {
    process.env.BETA_MONGODBURL = betaOperatorProfile.MONGODBURL;
  }
}
dotenv.config({ path: path.join(SERVER_ROOT, '.env') });

type SyncMode = 'dry-run' | 'apply';
type SyncCollectionCategory =
  | 'research-discovery'
  | 'identity-spine'
  | 'source-audit'
  | 'base-support';

export interface SyncCollection {
  name: string;
  category: SyncCollectionCategory;
  filter?: Document;
  transform?: (document: Document) => Document;
}

const BATCH_SIZE = 1000;
const LOCAL_MONGO_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

// The reviewable corpus plus the identity spine that resolves its leads. A
// mirrored environment that carries research_entities without researchers,
// accounts, and role_assignments serves a corpus whose every lead is
// unresolvable, so identity is not optional here.
const BASE_COPY_COLLECTIONS: SyncCollection[] = [
  { name: 'research_entities', category: 'research-discovery' },
  { name: 'research_entity_relationships', category: 'research-discovery' },
  { name: 'research_entity_redirects', category: 'research-discovery' },
  { name: 'canonical_aliases', category: 'research-discovery' },
  { name: 'signals', category: 'research-discovery' },
  { name: 'researchers', category: 'identity-spine' },
  { name: 'role_assignments', category: 'identity-spine' },
  { name: 'sources', category: 'source-audit' },
  { name: 'scrape_runs', category: 'source-audit' },
  { name: 'observations', category: 'source-audit' },
  { name: 'departments', category: 'base-support' },
  { name: 'org_units', category: 'base-support' },
  { name: 'research_areas', category: 'base-support' },
  { name: 'taxonomy_terms', category: 'base-support' },
  { name: 'fellowships', category: 'base-support' },
];

// An allow-list rather than a delete-list: account state and student PII live
// under `profile` on the current model, so a top-level field blocklist silently
// stops covering them the moment a field moves or a new one is added.
const MIRRORED_ACCOUNT_FIELDS = [
  '_id',
  'schemaVersion',
  'netid',
  'email',
  'status',
  'createdAt',
  'updatedAt',
];

const MIRRORED_ACCOUNT_PROFILE_FIELDS = [
  'firstName',
  'lastName',
  'userType',
  'title',
  'department',
];

export interface BetaToDevelopmentOptions {
  mode: SyncMode;
  betaUrl: string;
  developmentUrl: string;
  confirmSync: boolean;
  confirmAtlasDevelopmentOverwrite: boolean;
  clearDevelopmentNonMirrorData: boolean;
  includeObservations: boolean;
  output?: string;
}

export interface SyncCollectionPlan {
  name: string;
  category: SyncCollectionCategory;
  sourceCount: number;
  sourceCopyCount: number;
  targetCount: number;
  excludedCount: number;
}

export interface BetaToDevelopmentSummary {
  mode: SyncMode;
  sourceEnvironment: 'beta';
  targetEnvironment: 'development';
  betaTarget: string;
  developmentTarget: string;
  includesObservations: boolean;
  clearsDevelopmentNonMirrorData: boolean;
  collections: SyncCollectionPlan[];
  excludedOperationalCollections: string[];
  unclassifiedBetaCollections: string[];
  localCollectionsClearedOnApply: string[];
  userCopyPolicy: string;
}

interface ParsedMongoTarget {
  database: string;
  host: string;
  local: boolean;
}

const EXCLUDED_BETA_COLLECTIONS = [
  'admin_access_review_projection_state',
  'admin_access_review_projections',
  'admin_audit_events',
  'admin_grants',
  'analytics_events',
  'entitycorrectionreports',
  'evidence_claims',
  'listingclaimrequests',
  'observation_reference_repair_audits',
  'research_plans',
  'review_decisions',
  'scrape_job_locks',
  'scrape_snapshots',
  'source_documents',
  'student_applications',
  'student_engagement_events',
  'student_outreaches',
  'student_profiles',
  'student_trackings',
  'visibility_release_queue_items',
];

export function parseMongoTarget(value: string): ParsedMongoTarget {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('MongoDB URLs must be valid connection URLs');
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!database) {
    throw new Error('MongoDB URLs must include an explicit database name');
  }

  return {
    database,
    host: parsed.hostname,
    local: LOCAL_MONGO_HOSTS.has(parsed.hostname),
  };
}

export function replaceMongoDatabaseName(value: string, databaseName: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return '';
  }
  if (!parsed.pathname.replace(/^\//, '')) return '';
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

export function parseBetaToDevelopmentOptions(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): BetaToDevelopmentOptions {
  let mode: SyncMode = 'dry-run';
  let confirmSync = env.CONFIRM_BETA_TO_DEVELOPMENT_SYNC === 'true';
  let confirmAtlasDevelopmentOverwrite = env.CONFIRM_ATLAS_DEVELOPMENT_OVERWRITE === 'true';
  let clearDevelopmentNonMirrorData = false;
  let includeObservations = false;
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
    if (arg === '--confirm-beta-to-development') {
      confirmSync = true;
      continue;
    }
    if (arg === '--confirm-overwrite-atlas-development') {
      confirmAtlasDevelopmentOverwrite = true;
      continue;
    }
    if (arg === '--clear-development-non-mirror-data') {
      clearDevelopmentNonMirrorData = true;
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
    if (arg.startsWith('--output=')) {
      output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length).trim());
      continue;
    }
    if (arg === '--output') {
      output = resolveSafeJsonReportOutputPath(argv[index + 1]?.trim());
      index += 1;
      continue;
    }
    throw new Error(`Unknown development:refresh-from-beta argument: ${arg}`);
  }

  const developmentUrl =
    env.ATLAS_DEVELOPMENT_MONGODBURL || env.DEVELOPMENT_MONGODBURL || env.MONGODBURL || '';
  return {
    mode,
    betaUrl: env.BETA_MONGODBURL || replaceMongoDatabaseName(developmentUrl, 'Beta') || '',
    developmentUrl,
    confirmSync,
    confirmAtlasDevelopmentOverwrite,
    clearDevelopmentNonMirrorData,
    includeObservations,
    output,
  };
}

export function assertSafeBetaToDevelopmentOptions(options: BetaToDevelopmentOptions): void {
  if (!options.betaUrl) {
    throw new Error('BETA_MONGODBURL or a Beta MONGODBURL is required');
  }
  if (!options.developmentUrl) {
    throw new Error('DEVELOPMENT_MONGODBURL is required');
  }
  if (options.betaUrl === options.developmentUrl) {
    throw new Error('Beta and Development MongoDB URLs must be different');
  }

  const beta = parseMongoTarget(options.betaUrl);
  const development = parseMongoTarget(options.developmentUrl);
  if (beta.database !== 'Beta' || beta.local) {
    throw new Error(
      `Beta source must be a remote MongoDB database named Beta; resolved ${beta.host}/${beta.database}`,
    );
  }
  if (development.database !== 'Development' || development.local) {
    throw new Error(
      `Development destination must be remote MongoDB database Development; resolved ${development.host}/${development.database}`,
    );
  }
  if (options.mode === 'apply' && !options.confirmSync) {
    throw new Error('Apply mode requires --confirm-beta-to-development');
  }
  if (options.mode === 'apply' && !options.confirmAtlasDevelopmentOverwrite) {
    throw new Error('Apply mode requires --confirm-overwrite-atlas-development');
  }
}

export function sanitizeMirroredAccount(
  document: Document,
  preservePublicIdentity = true,
): Document {
  if (!preservePublicIdentity) {
    const rawId = document._id as { toHexString?: () => string } | undefined;
    if (!rawId || typeof rawId.toHexString !== 'function') {
      throw new Error('Mirrored account pseudonymization requires an ObjectId _id');
    }
    const token = rawId.toHexString().toLowerCase();
    return {
      _id: document._id,
      schemaVersion: document.schemaVersion,
      netid: `mirrored-${token}`,
      email: `mirrored-${token}@example.invalid`,
      status: document.status,
      archived: document.archived === true,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    };
  }

  const sanitized: Document = pickDefinedFields(document, MIRRORED_ACCOUNT_FIELDS);
  sanitized.archived = document.archived === true;
  const profile = mirroredAccountProfile(document.profile);
  if (profile) sanitized.profile = profile;
  return sanitized;
}

function pickDefinedFields(source: Document, fields: string[]): Document {
  const picked: Document = {};
  for (const field of fields) {
    if (source[field] !== undefined) picked[field] = source[field];
  }
  return picked;
}

function mirroredAccountProfile(profile: unknown): Document | undefined {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return undefined;
  const picked = pickDefinedFields(profile as Document, MIRRORED_ACCOUNT_PROFILE_FIELDS);
  return Object.keys(picked).length > 0 ? picked : undefined;
}

function collectionExists(db: Db, collectionName: string): Promise<boolean> {
  return db.listCollections({ name: collectionName }, { nameOnly: true }).hasNext();
}

async function distinctObjectIds(
  db: Db,
  collectionName: string,
  field: string,
  filter: Document = {},
): Promise<ObjectId[]> {
  if (!(await collectionExists(db, collectionName))) return [];
  const values = await db.collection(collectionName).distinct(field, filter);
  return values.filter(
    (value): value is ObjectId =>
      typeof value === 'object' &&
      value !== null &&
      typeof (value as { toHexString?: unknown }).toHexString === 'function',
  );
}

// An account reachable from a Researcher is a directory identity whose netid and
// email Yale already publishes. Every other account is somebody's real login, so
// it crosses environments pseudonymized or not at all.
export async function researchPersonAccountIds(sourceDb: Db): Promise<ObjectId[]> {
  const accountIds = await distinctObjectIds(sourceDb, 'researchers', 'accountId');
  return [...new Map(accountIds.map((id) => [id.toHexString(), id])).values()];
}

export function collectionsForOptions(
  options: BetaToDevelopmentOptions,
  researchAccountIds: ObjectId[],
): SyncCollection[] {
  const researchAccountIdSet = new Set(researchAccountIds.map((id) => id.toHexString()));
  const collections: SyncCollection[] = [
    ...BASE_COPY_COLLECTIONS.filter(
      (collection) => options.includeObservations || collection.name !== 'observations',
    ),
    {
      name: 'accounts',
      category: 'identity-spine',
      transform: (document) => {
        const rawId = document._id as { toHexString?: () => string } | undefined;
        const accountId =
          rawId && typeof rawId.toHexString === 'function' ? rawId.toHexString() : '';
        return sanitizeMirroredAccount(document, researchAccountIdSet.has(accountId));
      },
    },
  ];
  assertNoNeverCopyCollections(collections.map((collection) => collection.name));
  return collections;
}

export function betaToDevelopmentCollectionNames(includeObservations = true): string[] {
  const options = {
    includeObservations,
  } as BetaToDevelopmentOptions;
  return collectionsForOptions(options, []).map((collection) => collection.name);
}

async function countSourceCollection(
  betaDb: Db,
  collection: SyncCollection,
): Promise<Omit<SyncCollectionPlan, 'targetCount'>> {
  if (!(await collectionExists(betaDb, collection.name))) {
    return {
      name: collection.name,
      category: collection.category,
      sourceCount: 0,
      sourceCopyCount: 0,
      excludedCount: 0,
    };
  }
  const source = betaDb.collection(collection.name);
  const sourceCount = await source.countDocuments();
  const sourceCopyCount = await source.countDocuments(collection.filter || {});
  return {
    name: collection.name,
    category: collection.category,
    sourceCount,
    sourceCopyCount,
    excludedCount: sourceCount - sourceCopyCount,
  };
}

export async function buildPlan(
  betaDb: Db,
  developmentDb: Db,
  collections: SyncCollection[],
): Promise<SyncCollectionPlan[]> {
  return Promise.all(
    collections.map(async (collection) => {
      const source = await countSourceCollection(betaDb, collection);
      const targetCount = (await collectionExists(developmentDb, collection.name))
        ? await developmentDb.collection(collection.name).countDocuments()
        : 0;
      return { ...source, targetCount };
    }),
  );
}

export function buildBetaToDevelopmentSummary(
  options: BetaToDevelopmentOptions,
  collections: SyncCollectionPlan[],
  unclassifiedBetaCollections: string[] = [],
  localCollectionsClearedOnApply: string[] = [],
): BetaToDevelopmentSummary {
  return {
    mode: options.mode,
    sourceEnvironment: 'beta',
    targetEnvironment: 'development',
    betaTarget: summarizeMongoUrl(options.betaUrl),
    developmentTarget: summarizeMongoUrl(options.developmentUrl),
    includesObservations: options.includeObservations,
    clearsDevelopmentNonMirrorData: options.clearDevelopmentNonMirrorData,
    collections,
    excludedOperationalCollections: EXCLUDED_BETA_COLLECTIONS,
    unclassifiedBetaCollections,
    localCollectionsClearedOnApply,
    userCopyPolicy:
      'Copy the identity spine. Preserve accounts reachable from a Researcher, pseudonymize every other account, and remove account activity fields.',
  };
}

export function unclassifiedBetaCollectionNames(
  betaCollectionNames: string[],
  mirrorCollectionNames: string[],
): string[] {
  const classified = new Set([...mirrorCollectionNames, ...EXCLUDED_BETA_COLLECTIONS]);
  return betaCollectionNames
    .filter((name) => !name.startsWith('system.') && !classified.has(name))
    .sort();
}

export function assertNoUnclassifiedBetaCollections(collectionNames: string[]): void {
  if (collectionNames.length === 0) return;
  throw new Error(
    `Apply blocked because Beta has unclassified collections: ${collectionNames.join(', ')}`,
  );
}

function localNonMirrorCollectionNames(
  developmentCollectionNames: string[],
  mirrorCollectionNames: string[],
): string[] {
  const mirror = new Set(mirrorCollectionNames);
  return developmentCollectionNames
    .filter((name) => !name.startsWith('system.') && !mirror.has(name))
    .sort();
}

function writeOutput(report: unknown, output?: string): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
}

async function syncIndexes(
  betaDb: Db,
  developmentDb: Db,
  sourceCollectionName: string,
  stagingCollectionName: string,
): Promise<void> {
  const indexes = await betaDb.collection(sourceCollectionName).indexes();
  const secondaryIndexes = indexes.filter((index) => index.name !== '_id_');
  if (secondaryIndexes.length === 0) return;

  await developmentDb.collection(stagingCollectionName).createIndexes(
    secondaryIndexes.map((index) => {
      const { key, name, v: _version, ns: _namespace, ...options } = index;
      return { key, name, ...options };
    }),
  );
}

// The cutover renames staging over the target, and a rename carries no
// collection options, so any $jsonSchema validator on the replaced collection is
// lost unless staging is created with it. Source options win because the mirror
// makes the target match the source; the target's own options are the fallback
// so a mirror never downgrades a validated collection to unvalidated.
async function mirroredValidationOptions(
  sourceDb: Db,
  targetDb: Db,
  collectionName: string,
): Promise<CreateCollectionOptions> {
  const sourceOptions = await collectionValidationOptions(sourceDb, collectionName);
  if (Object.keys(sourceOptions).length > 0) return sourceOptions;
  return collectionValidationOptions(targetDb, collectionName);
}

async function collectionValidationOptions(
  db: Db,
  collectionName: string,
): Promise<CreateCollectionOptions> {
  const [info] = await db.listCollections({ name: collectionName }).toArray();
  const options = ((info as { options?: Document } | undefined)?.options ?? {}) as Document;
  const validation: CreateCollectionOptions = {};
  if (options.validator) validation.validator = options.validator;
  if (options.validationLevel) validation.validationLevel = options.validationLevel;
  if (options.validationAction) validation.validationAction = options.validationAction;
  return validation;
}

async function copyCollection(
  betaDb: Db,
  developmentDb: Db,
  collection: SyncCollection,
  operationId: string,
): Promise<string> {
  const stagingName = `__beta_sync_${operationId}_${collection.name}`;
  const staging = developmentDb.collection(stagingName);
  if (await collectionExists(developmentDb, stagingName)) {
    await staging.drop();
  }

  try {
    await developmentDb.createCollection(
      stagingName,
      await mirroredValidationOptions(betaDb, developmentDb, collection.name),
    );
    if (await collectionExists(betaDb, collection.name)) {
      const cursor = betaDb.collection(collection.name).find(collection.filter || {});
      let batch: AnyBulkWriteOperation<Document>[] = [];
      try {
        for await (const sourceDocument of cursor) {
          const document = collection.transform
            ? collection.transform(sourceDocument)
            : sourceDocument;
          batch.push({ insertOne: { document } });
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
      await syncIndexes(betaDb, developmentDb, collection.name, stagingName);
    }

    const expectedCount = await betaDb
      .collection(collection.name)
      .countDocuments(collection.filter || {});
    const actualCount = await staging.countDocuments();
    if (expectedCount !== actualCount) {
      throw new Error(
        `Count mismatch for ${collection.name}: expected ${expectedCount}, copied ${actualCount}`,
      );
    }
    return stagingName;
  } catch (error) {
    if (await collectionExists(developmentDb, stagingName)) {
      await staging.drop();
    }
    throw error;
  }
}

export async function applySync(
  betaDb: Db,
  developmentDb: Db,
  collections: SyncCollection[],
  clearedCollectionNames: string[],
  verify: () => Promise<void>,
): Promise<void> {
  const operationId = `${process.pid}_${Date.now()}`;
  const staged = new Map<string, string>();
  const backups = new Map<string, string>();
  const replaced: string[] = [];
  let cutoverVerified = false;

  try {
    for (const collection of collections) {
      staged.set(
        collection.name,
        await copyCollection(betaDb, developmentDb, collection, operationId),
      );
    }

    for (const collection of collections) {
      const targetName = collection.name;
      const backupName = `__beta_backup_${operationId}_${targetName}`;
      if (await collectionExists(developmentDb, targetName)) {
        await developmentDb.collection(targetName).rename(backupName);
        backups.set(targetName, backupName);
      }
      await developmentDb.collection(staged.get(targetName)!).rename(targetName);
      replaced.push(targetName);
    }

    for (const targetName of clearedCollectionNames) {
      if (!(await collectionExists(developmentDb, targetName))) continue;
      const backupName = `__beta_backup_${operationId}_${targetName}`;
      await developmentDb.collection(targetName).rename(backupName);
      backups.set(targetName, backupName);
    }

    await verify();
    cutoverVerified = true;

    for (const backupName of backups.values()) {
      if (await collectionExists(developmentDb, backupName)) {
        await developmentDb.collection(backupName).drop();
      }
    }
  } catch (error) {
    if (cutoverVerified) {
      throw error;
    }
    let rollbackError: unknown;
    try {
      for (const targetName of [...replaced].reverse()) {
        if (await collectionExists(developmentDb, targetName)) {
          await developmentDb.collection(targetName).drop();
        }
        const backupName = backups.get(targetName);
        if (backupName && (await collectionExists(developmentDb, backupName))) {
          await developmentDb.collection(backupName).rename(targetName);
          backups.delete(targetName);
        }
      }
      for (const [targetName, backupName] of backups) {
        if (await collectionExists(developmentDb, backupName)) {
          await developmentDb.collection(backupName).rename(targetName);
        }
      }
    } catch (caughtRollbackError) {
      rollbackError = caughtRollbackError;
    }
    if (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        'Beta to Development sync and rollback failed',
      );
    }
    throw error;
  } finally {
    for (const stagingName of staged.values()) {
      if (await collectionExists(developmentDb, stagingName)) {
        await developmentDb.collection(stagingName).drop();
      }
    }
  }
}

async function main(): Promise<void> {
  const options = parseBetaToDevelopmentOptions(process.argv.slice(2));
  assertSafeBetaToDevelopmentOptions(options);

  const betaClient = new MongoClient(options.betaUrl);
  const developmentClient = new MongoClient(options.developmentUrl);
  try {
    await betaClient.connect();
    await developmentClient.connect();
    const betaDb = betaClient.db();
    const developmentDb = developmentClient.db();
    const researchAccountIds = await researchPersonAccountIds(betaDb);
    const collections = collectionsForOptions(options, researchAccountIds);
    const approvedMirrorCollectionNames = betaToDevelopmentCollectionNames(true);
    const [betaCollectionRows, developmentCollectionRows] = await Promise.all([
      betaDb.listCollections({}, { nameOnly: true }).toArray(),
      developmentDb.listCollections({}, { nameOnly: true }).toArray(),
    ]);
    const unclassifiedBetaCollections = unclassifiedBetaCollectionNames(
      betaCollectionRows.map((collection) => collection.name),
      approvedMirrorCollectionNames,
    );
    const localCollectionsClearedOnApply = options.clearDevelopmentNonMirrorData
      ? localNonMirrorCollectionNames(
          developmentCollectionRows.map((collection) => collection.name),
          approvedMirrorCollectionNames,
        )
      : [];
    const before = await buildPlan(betaDb, developmentDb, collections);
    const summary = buildBetaToDevelopmentSummary(
      options,
      before,
      unclassifiedBetaCollections,
      localCollectionsClearedOnApply,
    );

    if (options.mode === 'dry-run') {
      console.log(JSON.stringify(summary, null, 2));
      writeOutput(summary, options.output);
      return;
    }

    assertNoUnclassifiedBetaCollections(unclassifiedBetaCollections);
    const clearedDevelopmentCollections = localCollectionsClearedOnApply;
    let after: SyncCollectionPlan[] = [];
    await applySync(betaDb, developmentDb, collections, clearedDevelopmentCollections, async () => {
      after = await buildPlan(betaDb, developmentDb, collections);
      const mismatches = after.filter((row) => row.sourceCopyCount !== row.targetCount);
      if (mismatches.length > 0) {
        throw new Error(
          `Post-sync count verification failed for: ${mismatches.map((row) => row.name).join(', ')}`,
        );
      }
    });
    const result = {
      ...summary,
      status: 'applied',
      collections: after,
      clearedDevelopmentCollections,
    };
    console.log(JSON.stringify(result, null, 2));
    writeOutput(result, options.output);
  } finally {
    await betaClient.close();
    await developmentClient.close();
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

import { spawnSync } from 'child_process';
import fs from 'fs';
import {
  MongoClient,
  ReadPreference,
  type ClientSession,
  type ClientSessionOptions,
  type Document,
  type FindOptions,
  type MongoClientOptions,
} from 'mongodb';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  assertOperatorEnvironmentMatchesDatabase,
  databaseNameFromMongoUrl,
} from './operatorDatabaseEnvironment';
import {
  assertHardenedIdentityCollisionProfile,
  assertPhase0IdentityCollisionAuditTargetAllowed,
} from './phase0IdentityCollisionAudit';
import { parsePhase0SummaryOnlyEnvironment } from './phase0SummaryOnlyAudit';
import {
  buildPhase2IdentityMigrationPlan,
  type LegacyIdentityFacultyMember,
  type LegacyIdentityMembership,
  type LegacyIdentityUser,
} from './phase2IdentityMigrationPlannerCore';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const FULL_COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const FILESYSTEM_ERROR_CODES = new Set([
  'EACCES',
  'EEXIST',
  'EISDIR',
  'ELOOP',
  'EMFILE',
  'ENAMETOOLONG',
  'ENFILE',
  'ENOENT',
  'ENOSPC',
  'ENOTDIR',
  'EPERM',
  'EROFS',
]);

export interface Phase2IdentityMigrationPlanArgs {
  environment: 'development' | 'beta' | 'production-copy';
  documentLimit: number;
  quarantineLimit: number;
  maxTimeMs: number;
  strict: boolean;
  output: string;
}

export const PHASE2_IDENTITY_MONGO_CLIENT_OPTIONS: Readonly<MongoClientOptions> = Object.freeze({
  maxPoolSize: 2,
  readPreference: ReadPreference.SECONDARY_PREFERRED,
  retryWrites: false,
});

export const PHASE2_IDENTITY_SNAPSHOT_SESSION_OPTIONS: Readonly<ClientSessionOptions> =
  Object.freeze({ snapshot: true });

const PHASE2_PROJECTIONS = Object.freeze({
  users: {
    _id: 1,
    netid: 1,
    email: 1,
    userType: 1,
    fname: 1,
    lname: 1,
    userConfirmed: 1,
    loginCount: 1,
    lastLogin: 1,
    lastLoginAt: 1,
    lastActive: 1,
    website: 1,
    profileUrls: 1,
    orcid: 1,
    googleScholarId: 1,
    facultyMemberId: 1,
    archived: 1,
  },
  faculty_members: {
    _id: 1,
    userId: 1,
    netid: 1,
    email: 1,
    name: 1,
    firstName: 1,
    lastName: 1,
    websiteUrl: 1,
    profileUrls: 1,
    orcidId: 1,
    googleScholarId: 1,
    archived: 1,
  },
  research_entity_members: {
    _id: 1,
    researchEntityId: 1,
    userId: 1,
    facultyMemberId: 1,
    name: 1,
    email: 1,
    profileUrl: 1,
    role: 1,
    isCurrentMember: 1,
    archived: 1,
    evidenceStatus: 1,
    confidence: 1,
    joinedAt: 1,
    leftAt: 1,
    startedAt: 1,
    endedAt: 1,
  },
  research_entities: {
    _id: 1,
  },
});

function consumeValue(
  argv: string[],
  index: number,
  flag: string,
): { value: string; nextIndex: number } {
  const arg = argv[index];
  const inline = arg.startsWith(`${flag}=`) ? arg.slice(flag.length + 1) : undefined;
  const value = inline !== undefined ? inline : arg === flag ? argv[index + 1] : undefined;
  if (!value || !value.trim() || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return { value, nextIndex: inline !== undefined ? index : index + 1 };
}

function boundedPositiveInteger(value: string, flag: string, maximum: number): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${flag} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new Error(`${flag} must be a positive integer no greater than ${maximum}`);
  }
  return parsed;
}

export function parsePhase2IdentityMigrationPlanArgs(
  argv: string[],
): Phase2IdentityMigrationPlanArgs {
  let environment: Phase2IdentityMigrationPlanArgs['environment'] | undefined;
  let documentLimit = 100_000;
  let quarantineLimit = 25_000;
  let maxTimeMs = 5_000;
  let strict = false;
  let output: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--environment' || arg.startsWith('--environment=')) {
      const consumed = consumeValue(argv, index, '--environment');
      environment = parsePhase0SummaryOnlyEnvironment(consumed.value);
      index = consumed.nextIndex;
      continue;
    }
    if (arg === '--document-limit' || arg.startsWith('--document-limit=')) {
      const consumed = consumeValue(argv, index, '--document-limit');
      documentLimit = boundedPositiveInteger(consumed.value, '--document-limit', 1_000_000);
      index = consumed.nextIndex;
      continue;
    }
    if (arg === '--quarantine-limit' || arg.startsWith('--quarantine-limit=')) {
      const consumed = consumeValue(argv, index, '--quarantine-limit');
      quarantineLimit = boundedPositiveInteger(consumed.value, '--quarantine-limit', 100_000);
      index = consumed.nextIndex;
      continue;
    }
    if (arg === '--max-time-ms' || arg.startsWith('--max-time-ms=')) {
      const consumed = consumeValue(argv, index, '--max-time-ms');
      maxTimeMs = boundedPositiveInteger(consumed.value, '--max-time-ms', 60_000);
      index = consumed.nextIndex;
      continue;
    }
    if (arg === '--strict') {
      strict = true;
      continue;
    }
    if (arg.startsWith('--strict=')) {
      throw new Error('--strict does not accept a value');
    }
    if (arg === '--output' || arg.startsWith('--output=')) {
      const consumed = consumeValue(argv, index, '--output');
      output = resolveSafeJsonReportOutputPath(consumed.value);
      index = consumed.nextIndex;
      continue;
    }
    throw new Error(`Unknown Phase 2 identity-plan option: ${arg}`);
  }

  if (!environment) {
    throw new Error(
      '--environment requires development, beta, or production-copy; Production is never allowed',
    );
  }
  if (!output) {
    throw new Error(
      '--output is required so private identity planning data never prints to stdout',
    );
  }
  return { environment, documentLimit, quarantineLimit, maxTimeMs, strict, output };
}

export function buildPhase2IdentityFindOptions(
  projection: Document,
  maxTimeMs: number,
  session: ClientSession,
): FindOptions {
  return {
    projection,
    comment: 'ylabs-phase2:identity-migration-plan',
    maxTimeMS: maxTimeMs,
    readConcern: { level: 'snapshot' },
    session,
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function optionalDate(value: unknown): Date | string | null | undefined {
  return value instanceof Date || typeof value === 'string' || value === null ? value : undefined;
}

function optionalId(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

function userFromDocument(document: Document): LegacyIdentityUser {
  return {
    id: String(document._id),
    ...(optionalString(document.netid) ? { netid: optionalString(document.netid) } : {}),
    ...(optionalString(document.email) ? { email: optionalString(document.email) } : {}),
    ...(optionalString(document.userType) ? { userType: optionalString(document.userType) } : {}),
    ...(optionalString(document.fname) ? { fname: optionalString(document.fname) } : {}),
    ...(optionalString(document.lname) ? { lname: optionalString(document.lname) } : {}),
    ...(document.userConfirmed !== undefined
      ? { userConfirmed: Boolean(document.userConfirmed) }
      : {}),
    ...(Number.isFinite(Number(document.loginCount))
      ? { loginCount: Number(document.loginCount) }
      : {}),
    ...(optionalDate(document.lastLogin) !== undefined
      ? { lastLogin: optionalDate(document.lastLogin) }
      : {}),
    ...(optionalDate(document.lastLoginAt) !== undefined
      ? { lastLoginAt: optionalDate(document.lastLoginAt) }
      : {}),
    ...(optionalDate(document.lastActive) !== undefined
      ? { lastActive: optionalDate(document.lastActive) }
      : {}),
    ...(optionalString(document.website) ? { website: optionalString(document.website) } : {}),
    ...(document.profileUrls !== undefined ? { profileUrls: document.profileUrls } : {}),
    ...(optionalString(document.orcid) ? { orcid: optionalString(document.orcid) } : {}),
    ...(optionalString(document.googleScholarId)
      ? { googleScholarId: optionalString(document.googleScholarId) }
      : {}),
    ...(optionalId(document.facultyMemberId)
      ? { facultyMemberId: optionalId(document.facultyMemberId) }
      : {}),
    ...(document.archived !== undefined ? { archived: Boolean(document.archived) } : {}),
  };
}

function facultyMemberFromDocument(document: Document): LegacyIdentityFacultyMember {
  return {
    id: String(document._id),
    ...(optionalId(document.userId) ? { userId: optionalId(document.userId) } : {}),
    ...(optionalString(document.netid) ? { netid: optionalString(document.netid) } : {}),
    ...(optionalString(document.email) ? { email: optionalString(document.email) } : {}),
    ...(optionalString(document.name) ? { name: optionalString(document.name) } : {}),
    ...(optionalString(document.firstName)
      ? { firstName: optionalString(document.firstName) }
      : {}),
    ...(optionalString(document.lastName) ? { lastName: optionalString(document.lastName) } : {}),
    ...(optionalString(document.websiteUrl)
      ? { websiteUrl: optionalString(document.websiteUrl) }
      : {}),
    ...(document.profileUrls !== undefined ? { profileUrls: document.profileUrls } : {}),
    ...(optionalString(document.orcidId) ? { orcidId: optionalString(document.orcidId) } : {}),
    ...(optionalString(document.googleScholarId)
      ? { googleScholarId: optionalString(document.googleScholarId) }
      : {}),
    ...(document.archived !== undefined ? { archived: Boolean(document.archived) } : {}),
  };
}

function membershipFromDocument(document: Document): LegacyIdentityMembership {
  return {
    id: String(document._id),
    ...(optionalId(document.researchEntityId)
      ? { researchEntityId: optionalId(document.researchEntityId) }
      : {}),
    ...(optionalId(document.userId) ? { userId: optionalId(document.userId) } : {}),
    ...(optionalId(document.facultyMemberId)
      ? { facultyMemberId: optionalId(document.facultyMemberId) }
      : {}),
    ...(optionalString(document.name) ? { name: optionalString(document.name) } : {}),
    ...(optionalString(document.email) ? { email: optionalString(document.email) } : {}),
    ...(optionalString(document.profileUrl)
      ? { profileUrl: optionalString(document.profileUrl) }
      : {}),
    ...(optionalString(document.role) ? { role: optionalString(document.role) } : {}),
    ...(document.isCurrentMember !== undefined
      ? { isCurrentMember: Boolean(document.isCurrentMember) }
      : {}),
    ...(document.archived !== undefined ? { archived: Boolean(document.archived) } : {}),
    ...(optionalString(document.evidenceStatus)
      ? { evidenceStatus: optionalString(document.evidenceStatus) }
      : {}),
    ...(Number.isFinite(Number(document.confidence))
      ? { confidence: Number(document.confidence) }
      : {}),
    ...(optionalDate(document.joinedAt) !== undefined
      ? { joinedAt: optionalDate(document.joinedAt) }
      : {}),
    ...(optionalDate(document.leftAt) !== undefined
      ? { leftAt: optionalDate(document.leftAt) }
      : {}),
    ...(optionalDate(document.startedAt) !== undefined
      ? { startedAt: optionalDate(document.startedAt) }
      : {}),
    ...(optionalDate(document.endedAt) !== undefined
      ? { endedAt: optionalDate(document.endedAt) }
      : {}),
  };
}

function researchEntityIdFromDocument(document: Document): string {
  const id = optionalId(document._id);
  if (!id) throw new Error('Phase 2 identity planning found a research entity without an id.');
  return id;
}

async function loadBoundedCollection<T>(args: {
  client: MongoClient;
  collectionName: keyof typeof PHASE2_PROJECTIONS;
  documentLimit: number;
  maxTimeMs: number;
  session: ClientSession;
  mapDocument: (document: Document) => T;
}): Promise<{ documents: T[]; truncated: boolean }> {
  const cursor = args.client
    .db()
    .collection(args.collectionName)
    .find(
      buildPhase2IdentityCollectionFilter(),
      buildPhase2IdentityFindOptions(
        PHASE2_PROJECTIONS[args.collectionName],
        args.maxTimeMs,
        args.session,
      ),
    )
    .sort({ _id: 1 })
    .limit(args.documentLimit + 1)
    .batchSize(500);
  const documents: T[] = [];
  let truncated = false;
  for await (const document of cursor) {
    if (documents.length >= args.documentLimit) {
      truncated = true;
      break;
    }
    documents.push(args.mapDocument(document));
  }
  return { documents, truncated };
}

export async function loadPhase2IdentitySnapshot(args: {
  client: MongoClient;
  documentLimit: number;
  maxTimeMs: number;
  session: ClientSession;
}) {
  const users = await loadBoundedCollection({
    ...args,
    collectionName: 'users',
    mapDocument: userFromDocument,
  });
  const facultyMembers = await loadBoundedCollection({
    ...args,
    collectionName: 'faculty_members',
    mapDocument: facultyMemberFromDocument,
  });
  const memberships = await loadBoundedCollection({
    ...args,
    collectionName: 'research_entity_members',
    mapDocument: membershipFromDocument,
  });
  const researchEntities = await loadBoundedCollection({
    ...args,
    collectionName: 'research_entities',
    mapDocument: researchEntityIdFromDocument,
  });
  return { users, facultyMembers, memberships, researchEntities };
}

export function buildPhase2IdentityCollectionFilter(): Document {
  return {};
}

export function resolveCleanPhase2IdentityPlanSourceCommit(
  declaredCommit = process.env.YLABS_INVENTORY_SOURCE_COMMIT,
  runCommand = spawnSync,
): string {
  const status = runCommand('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (status.status !== 0 || status.stdout?.trim()) {
    throw new Error('Phase 2 identity planning requires a clean source worktree.');
  }
  const head = runCommand('git', ['rev-parse', 'HEAD'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const sourceCommit = head.stdout?.trim();
  if (head.status !== 0 || !FULL_COMMIT_PATTERN.test(sourceCommit || '')) {
    throw new Error('Unable to resolve a full source commit for Phase 2 identity planning.');
  }
  if (
    declaredCommit !== undefined &&
    (!FULL_COMMIT_PATTERN.test(declaredCommit) || declaredCommit !== sourceCommit)
  ) {
    throw new Error('Declared Phase 2 source commit does not match the clean worktree HEAD.');
  }
  return sourceCommit;
}

export function assertPhase2IdentityPlanOutputAvailable(output: string): string {
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  const parent = path.dirname(safeOutput);
  let parentStat: fs.Stats;
  let realParent: string;
  try {
    parentStat = fs.lstatSync(parent);
    realParent = fs.realpathSync.native(parent);
  } catch {
    throw new Error('Unable to validate the private Phase 2 report location.');
  }
  if (
    !parentStat.isDirectory() ||
    parentStat.isSymbolicLink() ||
    realParent !== path.resolve(parent)
  ) {
    throw new Error('The Phase 2 report parent must be a real directory without symlinks.');
  }
  if (fs.existsSync(safeOutput)) {
    throw new Error('--output already exists; private Phase 2 reports are never overwritten.');
  }
  return safeOutput;
}

export function writePhase2IdentityPlanOutput(report: object, output: string): void {
  const safeOutput = assertPhase2IdentityPlanOutputAvailable(output);
  try {
    fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    fs.chmodSync(safeOutput, 0o600);
  } catch {
    throw new Error('Unable to create the private Phase 2 identity-plan artifact.');
  }
}

export function serializePhase2IdentityPlanCompletion(report: {
  environment: string;
  databaseName: string;
  sourceCommit: string;
}): string {
  return JSON.stringify({
    status: 'complete',
    environment: report.environment,
    databaseName: report.databaseName,
    sourceCommit: report.sourceCommit,
    mode: 'read-only-dry-run',
  });
}

export function serializePhase2IdentityPlanError(error: unknown): string {
  const code =
    error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined;
  if (code && FILESYSTEM_ERROR_CODES.has(code)) {
    return 'Phase 2 identity planning failed because a private filesystem operation was unavailable.';
  }
  if (
    (error &&
      typeof error === 'object' &&
      typeof (error as { code?: unknown }).code === 'number') ||
    (error instanceof Error &&
      /Mongo|server selection|snapshot|database|query|maxTimeMS|timed out/i.test(
        `${error.name} ${error.message}`,
      ))
  ) {
    return 'Phase 2 identity planning failed during the protected database read.';
  }
  return 'Phase 2 identity planning failed during protected validation.';
}

export function assertStrictPhase2IdentityPlanComplete(
  strict: boolean,
  report: { scan: { complete: boolean } },
): void {
  if (strict && !report.scan.complete) {
    throw new Error(
      'Strict Phase 2 identity planning was truncated; the private artifact was preserved.',
    );
  }
}

async function runPhase2IdentityMigrationPlan(
  args: Phase2IdentityMigrationPlanArgs,
  mongoUrl: string,
): Promise<void> {
  assertPhase0IdentityCollisionAuditTargetAllowed(args);
  assertHardenedIdentityCollisionProfile(args.environment);
  const output = assertPhase2IdentityPlanOutputAvailable(args.output);
  const configuredDatabaseName = databaseNameFromMongoUrl(mongoUrl);
  assertOperatorEnvironmentMatchesDatabase(args.environment, configuredDatabaseName);
  const sourceCommit = resolveCleanPhase2IdentityPlanSourceCommit();
  const client = new MongoClient(mongoUrl, PHASE2_IDENTITY_MONGO_CLIENT_OPTIONS);
  try {
    await client.connect();
    const databaseName = client.db().databaseName;
    assertOperatorEnvironmentMatchesDatabase(args.environment, databaseName);
    const session = client.startSession(PHASE2_IDENTITY_SNAPSHOT_SESSION_OPTIONS);
    let snapshot: Awaited<ReturnType<typeof loadPhase2IdentitySnapshot>>;
    try {
      snapshot = await loadPhase2IdentitySnapshot({
        client,
        documentLimit: args.documentLimit,
        maxTimeMs: args.maxTimeMs,
        session,
      });
    } finally {
      await session.endSession();
    }
    const report = buildPhase2IdentityMigrationPlan({
      users: snapshot.users.documents,
      facultyMembers: snapshot.facultyMembers.documents,
      memberships: snapshot.memberships.documents,
      knownResearchEntityIds: snapshot.researchEntities.documents,
      environment: args.environment,
      databaseName,
      sourceCommit,
      limits: {
        documentsPerCollection: args.documentLimit,
        quarantineRecords: args.quarantineLimit,
      },
      truncation: {
        users: snapshot.users.truncated,
        facultyMembers: snapshot.facultyMembers.truncated,
        memberships: snapshot.memberships.truncated,
        researchEntities: snapshot.researchEntities.truncated,
      },
    });
    const finalSourceCommit = resolveCleanPhase2IdentityPlanSourceCommit(sourceCommit);
    if (finalSourceCommit !== sourceCommit) {
      throw new Error('The Phase 2 identity-plan source commit changed during evidence capture.');
    }
    writePhase2IdentityPlanOutput(report, output);
    assertStrictPhase2IdentityPlanComplete(args.strict, report);
    console.log(serializePhase2IdentityPlanCompletion(report));
  } finally {
    await client.close();
  }
}

async function main(): Promise<void> {
  const args = parsePhase2IdentityMigrationPlanArgs(process.argv.slice(2));
  const mongoUrl = process.env.MONGODBURL;
  if (!mongoUrl) throw new Error('MONGODBURL is required');
  await runPhase2IdentityMigrationPlan(args, mongoUrl);
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main().catch((error) => {
    console.error(serializePhase2IdentityPlanError(error));
    process.exitCode = 1;
  });
}

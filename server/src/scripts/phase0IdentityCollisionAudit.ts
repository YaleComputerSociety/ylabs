import { spawnSync } from 'child_process';
import { randomBytes } from 'crypto';
import dotenv from 'dotenv';
import fs from 'fs';
import {
  MongoClient,
  ReadPreference,
  type ClientSession,
  type Document,
  type FindOptions,
  type MongoClientOptions,
  type ClientSessionOptions,
} from 'mongodb';
import path from 'path';
import { fileURLToPath } from 'url';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  assertOperatorEnvironmentMatchesDatabase,
  databaseNameFromMongoUrl,
} from './operatorDatabaseEnvironment';
import {
  buildPhase0IdentityCollisionAuditReport,
  type Phase0IdentityAuditUser,
  type Phase0IdentityCollisionAuditArgs,
} from './phase0IdentityCollisionAuditCore';
import { parsePhase0SummaryOnlyEnvironment } from './phase0SummaryOnlyAudit';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const FULL_COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const PROFILE_PLACEHOLDER_PATTERN =
  /[<>]|\b(?:change[-_ ]?me|placeholder|replace[-_ ]?me|todo)\b|your[-_ ]|example\.(?:com|net|org)/i;
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
const PROTECTED_PROFILE_SPECS = {
  beta: {
    name: 'beta-inventory',
    databaseName: 'Beta',
    inventoryFile: 'beta-inventory.env',
  },
  'production-copy': {
    name: 'production-copy-inventory',
    databaseName: 'ProductionCopy',
    inventoryFile: 'production-copy-inventory.env',
  },
} as const;

export const PHASE0_IDENTITY_MONGO_CLIENT_OPTIONS: Readonly<MongoClientOptions> = Object.freeze({
  maxPoolSize: 2,
  readPreference: ReadPreference.SECONDARY_PREFERRED,
  retryWrites: false,
});
export const PHASE0_IDENTITY_SNAPSHOT_SESSION_OPTIONS: Readonly<ClientSessionOptions> =
  Object.freeze({ snapshot: true });

export function buildPhase0IdentityFindOptions(
  maxTimeMs: number,
  session: ClientSession,
): FindOptions {
  return {
    projection: {
      _id: 1,
      fname: 1,
      lname: 1,
      netid: 1,
      email: 1,
      orcid: 1,
      openAlexId: 1,
      googleScholarId: 1,
      userConfirmed: 1,
      archived: 1,
    },
    comment: 'ylabs-phase0:identity-collision-audit',
    maxTimeMS: maxTimeMs,
    readConcern: { level: 'snapshot' },
    session,
  };
}

function consumeValue(
  argv: string[],
  index: number,
  flag: string,
): { value: string; nextIndex: number } {
  const arg = argv[index];
  const inline = arg.startsWith(`${flag}=`) ? arg.slice(flag.length + 1) : undefined;
  const value = inline !== undefined ? inline : arg === flag ? argv[index + 1] : undefined;
  if (!value || value.trim() === '' || value.startsWith('--')) {
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

export function parsePhase0IdentityCollisionAuditArgs(
  argv: string[],
): Phase0IdentityCollisionAuditArgs {
  let environment: Phase0IdentityCollisionAuditArgs['environment'] | undefined;
  let documentLimit = 100_000;
  let groupLimit = 10_000;
  let groupMemberLimit = 100;
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
    if (arg === '--group-limit' || arg.startsWith('--group-limit=')) {
      const consumed = consumeValue(argv, index, '--group-limit');
      groupLimit = boundedPositiveInteger(consumed.value, '--group-limit', 100_000);
      index = consumed.nextIndex;
      continue;
    }
    if (arg === '--group-member-limit' || arg.startsWith('--group-member-limit=')) {
      const consumed = consumeValue(argv, index, '--group-member-limit');
      groupMemberLimit = boundedPositiveInteger(consumed.value, '--group-member-limit', 1_000);
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
    throw new Error(`Unknown identity-collision audit option: ${arg}`);
  }

  if (!environment) {
    throw new Error(
      '--environment requires development, beta, or production-copy for the identity-collision audit',
    );
  }
  if (!output) {
    throw new Error('--output is required so detailed identity evidence never prints to stdout');
  }

  return {
    environment,
    documentLimit,
    groupLimit,
    groupMemberLimit,
    maxTimeMs,
    strict,
    output,
  };
}

export function assertPhase0IdentityCollisionAuditTargetAllowed(
  args: Pick<Phase0IdentityCollisionAuditArgs, 'environment'>,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const protectedProfileActive = env.YLABS_INVENTORY_PROFILE_ACTIVE === 'true';
  if (args.environment !== 'development' && !protectedProfileActive) {
    throw new Error(
      'Beta and ProductionCopy identity-collision audits require the protected profile launcher.',
    );
  }
  if (protectedProfileActive && args.environment === 'development') {
    throw new Error('Protected identity-collision profiles do not target Development.');
  }
}

export function assertHardenedIdentityCollisionProfile(
  environment: Phase0IdentityCollisionAuditArgs['environment'],
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (environment === 'development') {
    if (databaseNameFromMongoUrl(env.MONGODBURL || '').toLowerCase() === 'production') {
      throw new Error('Development identity-collision audits must never target Production.');
    }
    return;
  }
  const expected = PROTECTED_PROFILE_SPECS[environment];
  const inventoryPathValue = env.YLABS_INVENTORY_PROFILE_PATH;
  if (
    !expected ||
    env.YLABS_INVENTORY_PROFILE_ACTIVE !== 'true' ||
    env.YLABS_IDENTITY_AUDIT_PROFILE_ACTIVE !== 'true' ||
    env.YLABS_INVENTORY_PROFILE_NAME !== expected.name ||
    !inventoryPathValue ||
    !path.isAbsolute(inventoryPathValue)
  ) {
    throw new Error(
      'Beta and ProductionCopy identity-collision audits require hardened external profiles.',
    );
  }

  const inventoryPath = path.resolve(inventoryPathValue);
  const profileDirectory = path.dirname(inventoryPath);
  const relativeToRepo = path.relative(REPO_ROOT, profileDirectory);
  if (
    relativeToRepo === '' ||
    (!relativeToRepo.startsWith(`..${path.sep}`) &&
      relativeToRepo !== '..' &&
      !path.isAbsolute(relativeToRepo))
  ) {
    throw new Error('Protected identity-collision profiles must be outside the repository.');
  }
  let realProfileDirectory: string;
  let realInventoryPath: string;
  let directoryStat: fs.Stats;
  let inventoryStat: fs.Stats;
  let inventoryProfileBody: Buffer;
  try {
    realProfileDirectory = fs.realpathSync.native(profileDirectory);
    realInventoryPath = fs.realpathSync.native(inventoryPath);
    directoryStat = fs.lstatSync(profileDirectory);
    inventoryStat = fs.lstatSync(inventoryPath);
    inventoryProfileBody = fs.readFileSync(inventoryPath);
  } catch {
    throw new Error('Unable to validate the protected identity-collision profile.');
  }
  if (
    path.basename(inventoryPath) !== expected.inventoryFile ||
    realProfileDirectory !== profileDirectory ||
    realInventoryPath !== inventoryPath
  ) {
    throw new Error('Protected identity-collision profile paths are invalid or contain symlinks.');
  }

  if (!directoryStat.isDirectory() || (directoryStat.mode & 0o077) !== 0) {
    throw new Error('The protected identity-collision profile directory must be private.');
  }
  if (!inventoryStat.isFile() || (inventoryStat.mode & 0o777) !== 0o600) {
    throw new Error('Protected identity-collision profiles must be mode-0600 regular files.');
  }
  if (
    typeof process.getuid === 'function' &&
    (directoryStat.uid !== process.getuid() || inventoryStat.uid !== process.getuid())
  ) {
    throw new Error('Protected identity-collision profiles must be owned by the current user.');
  }

  const inventoryValues = dotenv.parse(inventoryProfileBody);
  if (
    Object.keys(inventoryValues).length !== 1 ||
    !inventoryValues.MONGODBURL ||
    inventoryValues.MONGODBURL !== env.MONGODBURL
  ) {
    throw new Error('MONGODBURL must exactly match the protected inventory profile.');
  }
  let parsed: URL;
  let username: string;
  let password: string;
  try {
    parsed = new URL(inventoryValues.MONGODBURL);
    username = decodeURIComponent(parsed.username);
    password = decodeURIComponent(parsed.password);
  } catch {
    throw new Error('The protected inventory profile must contain a valid Atlas URL.');
  }
  const tlsDisabled =
    parsed.searchParams.getAll('tls').some((value) => value.toLowerCase() === 'false') ||
    parsed.searchParams.getAll('ssl').some((value) => value.toLowerCase() === 'false');
  const directConnection = parsed.searchParams
    .getAll('directConnection')
    .some((value) => value.toLowerCase() === 'true');
  if (
    parsed.protocol !== 'mongodb+srv:' ||
    !parsed.hostname.toLowerCase().endsWith('.mongodb.net') ||
    !username ||
    !password ||
    PROFILE_PLACEHOLDER_PATTERN.test(username) ||
    PROFILE_PLACEHOLDER_PATTERN.test(password) ||
    tlsDisabled ||
    directConnection
  ) {
    throw new Error('The inventory profile no longer satisfies the protected Atlas contract.');
  }
  assertOperatorEnvironmentMatchesDatabase(
    environment,
    databaseNameFromMongoUrl(inventoryValues.MONGODBURL),
  );
}

export function assertPhase0IdentityCollisionOutputAvailable(output: string): string {
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  const parent = path.dirname(safeOutput);
  let parentStat: fs.Stats;
  let realParent: string;
  try {
    parentStat = fs.lstatSync(parent);
    realParent = fs.realpathSync.native(parent);
  } catch {
    throw new Error('Unable to validate the protected identity-collision output location.');
  }
  if (parentStat.isSymbolicLink()) {
    throw new Error('The identity-collision output parent must not contain symlink components.');
  }
  if (!parentStat.isDirectory()) {
    throw new Error('The identity-collision output parent must be a directory.');
  }
  if (realParent !== path.resolve(parent)) {
    throw new Error('The identity-collision output parent must not contain symlink components.');
  }
  if (fs.existsSync(safeOutput)) {
    throw new Error(
      '--output already exists; protected identity-collision evidence is never overwritten.',
    );
  }
  return safeOutput;
}

export function resolveCleanIdentityAuditSourceCommit(
  declaredCommit = process.env.YLABS_INVENTORY_SOURCE_COMMIT,
  runCommand = spawnSync,
): string {
  const status = runCommand('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (status.status !== 0 || status.stdout?.trim()) {
    throw new Error('Identity-collision evidence requires a clean source worktree.');
  }
  const head = runCommand('git', ['rev-parse', 'HEAD'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const sourceCommit = head.stdout?.trim();
  if (head.status !== 0 || !FULL_COMMIT_PATTERN.test(sourceCommit || '')) {
    throw new Error('Unable to resolve a full source commit for identity-collision evidence.');
  }
  if (declaredCommit !== undefined) {
    if (!FULL_COMMIT_PATTERN.test(declaredCommit) || declaredCommit !== sourceCommit) {
      throw new Error(
        'Declared identity-collision source commit does not match the clean worktree HEAD.',
      );
    }
  }
  return sourceCommit;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function auditUserFromDocument(document: Document): Phase0IdentityAuditUser {
  return {
    id: String(document._id),
    ...(optionalString(document.fname) ? { fname: optionalString(document.fname) } : {}),
    ...(optionalString(document.lname) ? { lname: optionalString(document.lname) } : {}),
    ...(optionalString(document.netid) ? { netid: optionalString(document.netid) } : {}),
    ...(optionalString(document.email) ? { email: optionalString(document.email) } : {}),
    ...(optionalString(document.orcid) ? { orcid: optionalString(document.orcid) } : {}),
    ...(optionalString(document.openAlexId)
      ? { openAlexId: optionalString(document.openAlexId) }
      : {}),
    ...(optionalString(document.googleScholarId)
      ? { googleScholarId: optionalString(document.googleScholarId) }
      : {}),
    ...(document.userConfirmed !== undefined
      ? { userConfirmed: Boolean(document.userConfirmed) }
      : {}),
    ...(document.archived !== undefined ? { archived: Boolean(document.archived) } : {}),
  };
}

export async function loadBoundedIdentityAuditUsers(
  client: MongoClient,
  documentLimit: number,
  maxTimeMs: number,
  session: ClientSession,
): Promise<{ users: Phase0IdentityAuditUser[]; possibleDocumentTruncation: boolean }> {
  const findOptions = buildPhase0IdentityFindOptions(maxTimeMs, session);
  const cursor = client
    .db()
    .collection('users')
    .find({ archived: { $ne: true } }, findOptions)
    .sort({ _id: 1 })
    .limit(documentLimit + 1)
    .batchSize(500);
  const users: Phase0IdentityAuditUser[] = [];
  let possibleDocumentTruncation = false;
  for await (const document of cursor) {
    if (users.length >= documentLimit) {
      possibleDocumentTruncation = true;
      break;
    }
    users.push(auditUserFromDocument(document));
  }
  return { users, possibleDocumentTruncation };
}

export function writePhase0IdentityCollisionAuditOutput(report: object, output: string): void {
  const safeOutput = assertPhase0IdentityCollisionOutputAvailable(output);
  try {
    fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    fs.chmodSync(safeOutput, 0o600);
  } catch {
    throw new Error('Unable to create the protected identity-collision artifact.');
  }
}

export function serializePhase0IdentityCollisionAuditCompletion(report: {
  environment: string;
  db: string;
  sourceCommit: string;
}): string {
  return JSON.stringify({
    status: 'complete',
    environment: report.environment,
    databaseName: report.db,
    sourceCommit: report.sourceCommit,
  });
}

export function serializePhase0IdentityCollisionAuditError(error: unknown): string {
  const code =
    error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined;
  if (code && FILESYSTEM_ERROR_CODES.has(code)) {
    return 'Identity-collision audit failed because a protected filesystem operation was unavailable.';
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
    return 'Identity-collision audit failed during the protected database read.';
  }
  return sanitizeLogValue(error);
}

export function assertStrictIdentityCollisionAuditComplete(
  strict: boolean,
  report: { scan: { countSemantics: string } },
): void {
  if (strict && report.scan.countSemantics !== 'complete-within-document-scan') {
    throw new Error(
      'Strict identity-collision evidence is truncated; the private artifact was preserved for review.',
    );
  }
}

async function runPhase0IdentityCollisionAudit(
  args: Phase0IdentityCollisionAuditArgs,
  mongoUrl: string,
): Promise<void> {
  assertPhase0IdentityCollisionAuditTargetAllowed(args);
  assertHardenedIdentityCollisionProfile(args.environment);
  const output = assertPhase0IdentityCollisionOutputAvailable(args.output);
  const configuredDatabaseName = databaseNameFromMongoUrl(mongoUrl);
  assertOperatorEnvironmentMatchesDatabase(args.environment, configuredDatabaseName);
  const sourceCommit = resolveCleanIdentityAuditSourceCommit();
  const fingerprintSalt = randomBytes(32).toString('hex');
  const client = new MongoClient(mongoUrl, PHASE0_IDENTITY_MONGO_CLIENT_OPTIONS);
  try {
    await client.connect();
    const databaseName = client.db().databaseName;
    assertOperatorEnvironmentMatchesDatabase(args.environment, databaseName);
    const session = client.startSession(PHASE0_IDENTITY_SNAPSHOT_SESSION_OPTIONS);
    let scan: Awaited<ReturnType<typeof loadBoundedIdentityAuditUsers>>;
    try {
      scan = await loadBoundedIdentityAuditUsers(
        client,
        args.documentLimit,
        args.maxTimeMs,
        session,
      );
    } finally {
      await session.endSession();
    }
    const report = buildPhase0IdentityCollisionAuditReport({
      users: scan.users,
      environment: args.environment,
      db: databaseName,
      sourceCommit,
      documentLimit: args.documentLimit,
      groupLimit: args.groupLimit,
      groupMemberLimit: args.groupMemberLimit,
      maxTimeMs: args.maxTimeMs,
      strict: args.strict,
      possibleDocumentTruncation: scan.possibleDocumentTruncation,
      fingerprintSalt,
    });
    const finalSourceCommit = resolveCleanIdentityAuditSourceCommit(sourceCommit);
    if (finalSourceCommit !== sourceCommit) {
      throw new Error('The identity-collision source commit changed during evidence capture.');
    }
    writePhase0IdentityCollisionAuditOutput(report, output);
    assertStrictIdentityCollisionAuditComplete(args.strict, report);
    console.log(serializePhase0IdentityCollisionAuditCompletion(report));
  } finally {
    await client.close();
  }
}

async function main(): Promise<void> {
  const args = parsePhase0IdentityCollisionAuditArgs(process.argv.slice(2));
  const mongoUrl = process.env.MONGODBURL;
  if (!mongoUrl) throw new Error('MONGODBURL is required');
  await runPhase0IdentityCollisionAudit(args, mongoUrl);
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main().catch((error) => {
    console.error(serializePhase0IdentityCollisionAuditError(error));
    process.exitCode = 1;
  });
}

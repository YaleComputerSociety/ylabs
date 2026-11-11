import { randomUUID } from 'crypto';
import { hostname } from 'os';
import type { Collection, Db } from 'mongodb';

import { onInterrupt } from '../utils/interruptCleanup';
import { operatorEnvironmentForDatabaseName } from './operatorDatabaseEnvironment';
import {
  DEV_WRITE_OWNER_LABEL_ENV,
  describeDevWriteLaunch,
  recordDevWriteLaunch,
  redactLaunchArgv,
} from './devWriteLaunch';

/**
 * One apply-class write to Development at a time, and one lane run per fetched host (#5756).
 *
 * Leases live in Development's `scrape_job_locks`, which is never copied between environments,
 * under reserved names no source can take. They are written through the connection the script
 * opened rather than a model bound to the default connection, because some scripts write
 * through a second connection, and a lease on the wrong database would guard nothing.
 */
export const DEV_WRITE_LEASE_COLLECTION = 'scrape_job_locks';
export const DEV_WRITE_LEASE_ENVIRONMENT = 'development';
export const DEV_APPLY_LEASE_NAME = '__dev-apply__';
export const DEV_HOST_LEASE_PREFIX = 'host:';
export const DEV_WRITE_LEASE_HEARTBEAT_MS = 30_000;
export const DEV_WRITE_LEASE_TTL_MS = 5 * 60_000;
export const DEV_WRITE_LEASE_OWNER_ENV = 'DEV_WRITE_LEASE_OWNER';
export const DEV_WRITE_LEASE_SWITCH_ENV = 'DEV_WRITE_LEASE';
export { DEV_WRITE_OWNER_LABEL_ENV };

/**
 * Append-only measurement writes go to their own collections and run during long applies by
 * design, so they never take the exclusive lease (approved on #5756).
 */
export const DEV_APPLY_LEASE_EXEMPT_SCRIPTS: ReadonlySet<string> = new Set([
  'corpus:snapshot',
  'gates:refresh',
  'lane:benchmark-capture',
  'lane:benchmark-label',
  'lane:scorecard',
  'engine:benchmark',
]);

const LOCAL_MONGO_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export type DevWriteLeaseTarget =
  { kind: 'development' } | { kind: 'skip'; reason: string } | { kind: 'refuse'; reason: string };

/**
 * Decides whether a connection is the shared Development database the lease protects. A
 * Development-named database takes the lease; a test, local, Beta or Production database never
 * reads or writes one; any other remote database cannot be placed, so an apply against it refuses
 * rather than writing unguarded.
 */
export function resolveDevWriteLeaseTarget(input: {
  databaseName: string;
  host?: string;
}): DevWriteLeaseTarget {
  const environment = operatorEnvironmentForDatabaseName(input.databaseName);
  if (environment === 'development') return { kind: 'development' };
  if (environment === 'test') return { kind: 'skip', reason: 'test database' };
  if (environment) {
    return { kind: 'skip', reason: `${environment} receives data only by promotion` };
  }
  if (input.host && LOCAL_MONGO_HOSTS.has(input.host.toLowerCase())) {
    return { kind: 'skip', reason: 'local database' };
  }
  return {
    kind: 'refuse',
    reason: `cannot tell whether database "${input.databaseName}" is Development, so an apply against it would write without the Development write lease`,
  };
}

export const devWriteLeaseSwitchedOff = (env: NodeJS.ProcessEnv = process.env): boolean =>
  ['off', 'false', '0'].includes((env[DEV_WRITE_LEASE_SWITCH_ENV] ?? '').trim().toLowerCase());

interface DevApplyIntent {
  scriptName: string;
  args: string[];
}

let applyIntent: DevApplyIntent | undefined;

/** Called by the apply guard, so a script that will write says so before it connects. */
export function recordDevApplyIntent(scriptName: string, args: string[] = process.argv.slice(2)) {
  if (DEV_APPLY_LEASE_EXEMPT_SCRIPTS.has(scriptName)) return;
  applyIntent ??= { scriptName, args };
}

export function hasDevApplyIntent(): boolean {
  return applyIntent !== undefined;
}

export function describeDevWriteCommand(intent: DevApplyIntent): string {
  return [intent.scriptName, ...redactLaunchArgv(intent.args).slice(0, 12)].join(' ').slice(0, 300);
}

export interface DevWriteLeaseRecord {
  _id: string;
  sourceName: string;
  locked?: boolean;
  ownerId?: string;
  ownerHost?: string;
  ownerPid?: number;
  ownerLabel?: string;
  command?: string;
  acquiredAt?: Date;
  heartbeatAt?: Date;
  leaseExpiresAt?: Date;
}

export class DevWriteLeaseHeldError extends Error {
  constructor(
    readonly leaseName: string,
    readonly holder: DevWriteLeaseRecord,
    now: Date,
  ) {
    const heartbeatAge = holder.heartbeatAt
      ? `${Math.round((now.getTime() - new Date(holder.heartbeatAt).getTime()) / 1000)} s ago`
      : 'never';
    super(
      `Development write lease "${leaseName}" is held by ${holder.ownerLabel || holder.ownerId || 'an unidentified owner'}` +
        ` running "${holder.command || 'an unrecorded command'}" (last heartbeat ${heartbeatAge}).` +
        ' Nothing was written. Wait for it to finish, or read `yarn --cwd server dev:locks`.',
    );
    this.name = 'DevWriteLeaseHeldError';
  }
}

export function devWriteLeaseCollection(db: Db): Collection<DevWriteLeaseRecord> {
  return db.collection<DevWriteLeaseRecord>(DEV_WRITE_LEASE_COLLECTION);
}

export class DevWriteOwnerMissingError extends Error {
  constructor(action: string) {
    super(
      `${action} refused: ${DEV_WRITE_OWNER_LABEL_ENV} is not set. Every apply or lane run against Development must name who launched it; set ${DEV_WRITE_OWNER_LABEL_ENV}=<your session name> and run it again. Nothing was written.`,
    );
    this.name = 'DevWriteOwnerMissingError';
  }
}

export function assertDevWriteOwnerLabel(action: string, env: NodeJS.ProcessEnv = process.env) {
  if (!env[DEV_WRITE_OWNER_LABEL_ENV]?.trim()) throw new DevWriteOwnerMissingError(action);
}

export function labelSweepRunnerOwner(scriptName: string, env: NodeJS.ProcessEnv = process.env) {
  if (!env[DEV_WRITE_OWNER_LABEL_ENV]?.trim()) {
    env[DEV_WRITE_OWNER_LABEL_ENV] = `sweep-runner:${scriptName}@${hostname()}`;
  }
}

const leaseId = (name: string) => `${DEV_WRITE_LEASE_ENVIRONMENT}:${name}`;

const isLiveFor = (record: DevWriteLeaseRecord | null | undefined, now: Date): boolean =>
  Boolean(
    record?.locked &&
    record.leaseExpiresAt &&
    new Date(record.leaseExpiresAt).getTime() > now.getTime(),
  );

export interface DevWriteLeaseDependencies {
  db: Db;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  host?: string;
  pid?: number;
  isLocalProcessAlive?: (pid: number) => boolean;
  newOwnerId?: () => string;
}

const defaultIsLocalProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === 'EPERM';
  }
};

export interface HeldDevWriteLease {
  name: string;
  ownerId: string;
  joined: boolean;
  heartbeat(): Promise<boolean>;
  release(): Promise<void>;
}

/**
 * Takes a named lease, or joins it when this process's parent holds it and passed its owner id
 * down, and throws `DevWriteLeaseHeldError` before anything is written when someone else holds it.
 * An expired lease, or one whose owner process on this host is dead, is taken over.
 */
export async function acquireDevWriteLease(
  input: { name: string; command: string },
  deps: DevWriteLeaseDependencies,
): Promise<HeldDevWriteLease> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());
  const host = deps.host ?? hostname();
  const pid = deps.pid ?? process.pid;
  const isAlive = deps.isLocalProcessAlive ?? defaultIsLocalProcessAlive;
  const collection = devWriteLeaseCollection(deps.db);
  const inherited = env[DEV_WRITE_LEASE_OWNER_ENV]?.trim();
  const ownerId = inherited || (deps.newOwnerId ?? (() => `${host}:${pid}:${randomUUID()}`))();

  const current = await collection.findOne({ _id: leaseId(input.name) });
  if (inherited && current?.ownerId === inherited && isLiveFor(current, now())) {
    return heldLease(input.name, inherited, deps.db, now, { releasable: false });
  }
  // A process started by a lease holder shares its owner id, so siblings share a host lease, and
  // only the root owner releases it: a sibling that finished first must not end it for the rest.
  const releasable = !inherited;

  const at = now();
  const fields = {
    locked: true,
    ownerId,
    ownerHost: host,
    ownerPid: pid,
    ownerLabel: env[DEV_WRITE_OWNER_LABEL_ENV]?.trim() || undefined,
    command: input.command,
    acquiredAt: at,
    heartbeatAt: at,
    leaseExpiresAt: new Date(at.getTime() + DEV_WRITE_LEASE_TTL_MS),
  };
  const takeoverable = current && !isLiveFor(current, at);
  const deadLocalOwner =
    current?.locked &&
    current.ownerHost === host &&
    typeof current.ownerPid === 'number' &&
    current.ownerPid !== pid &&
    !isAlive(current.ownerPid);

  if (!current) {
    const inserted = await collection
      .insertOne({
        _id: leaseId(input.name),
        environment: DEV_WRITE_LEASE_ENVIRONMENT,
        sourceName: input.name,
        ...fields,
      } as DevWriteLeaseRecord)
      .then(
        () => true,
        (error: { code?: number }) => {
          if (error.code !== 11000) throw error;
          return false;
        },
      );
    if (inserted) return heldLease(input.name, ownerId, deps.db, now, { releasable });
  } else if (takeoverable || deadLocalOwner) {
    const result = await collection.updateOne(
      {
        _id: leaseId(input.name),
        ownerId: current.ownerId,
        leaseExpiresAt: current.leaseExpiresAt,
      },
      { $set: fields, $unset: { releasedAt: '', releaseReason: '' } },
    );
    if (result.matchedCount === 1) {
      if (current.locked) {
        console.warn(
          `Took over Development write lease "${input.name}" from ${current.ownerLabel || current.ownerId} ("${current.command || 'unrecorded'}"), whose ${deadLocalOwner ? 'process on this host had exited' : 'lease had expired'}.`,
        );
      }
      return heldLease(input.name, ownerId, deps.db, now, { releasable });
    }
  }
  const unrecorded: DevWriteLeaseRecord = { _id: '', sourceName: input.name };
  const holder = (await collection.findOne({ _id: leaseId(input.name) })) ?? current ?? unrecorded;
  if (holder.ownerId === ownerId && isLiveFor(holder, now())) {
    return heldLease(input.name, ownerId, deps.db, now, { releasable: false });
  }
  throw new DevWriteLeaseHeldError(input.name, holder, at);
}

function heldLease(
  name: string,
  ownerId: string,
  db: Db,
  now: () => Date,
  { releasable }: { releasable: boolean },
): HeldDevWriteLease {
  return {
    name,
    ownerId,
    joined: !releasable,
    async heartbeat() {
      const at = now();
      const result = await devWriteLeaseCollection(db).updateOne(
        { _id: leaseId(name), ownerId, locked: true },
        {
          $set: {
            heartbeatAt: at,
            leaseExpiresAt: new Date(at.getTime() + DEV_WRITE_LEASE_TTL_MS),
          },
        },
      );
      return result.matchedCount === 1;
    },
    async release() {
      if (!releasable) return;
      await releaseLeasesOwnedBy(db, ownerId, now());
    },
  };
}

const releaseLeasesOwnedBy = (db: Db, ownerId: string, at: Date) =>
  devWriteLeaseCollection(db).updateMany(
    { environment: DEV_WRITE_LEASE_ENVIRONMENT, ownerId, locked: true } as Record<string, unknown>,
    {
      $set: { locked: false, releasedAt: at, releaseReason: 'success' },
      $unset: { ownerId: '', leaseExpiresAt: '' },
    },
  );

export interface ConnectionDescriptor {
  db: Db;
  databaseName: string;
  host?: string;
}

const heldLeases = new Map<string, HeldDevWriteLease>();
let heartbeatTimer: NodeJS.Timeout | undefined;

function ensureHeartbeat(onLost: (name: string) => void) {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    for (const lease of heldLeases.values()) {
      lease.heartbeat().then(
        (alive) => {
          if (!alive) onLost(lease.name);
        },
        () => undefined,
      );
    }
  }, DEV_WRITE_LEASE_HEARTBEAT_MS);
  heartbeatTimer.unref();
}

const exitOnLostLease = (name: string) => {
  console.error(
    `Lost the Development write lease "${name}" to another owner; stopping before the next write.`,
  );
  process.exit(1);
};

let removeInterruptRelease: (() => void) | undefined;

export async function releaseHeldDevWriteLeases(): Promise<void> {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
  }
  removeInterruptRelease?.();
  removeInterruptRelease = undefined;
  const leases = [...heldLeases.values()];
  heldLeases.clear();
  await Promise.all(leases.map((lease) => lease.release().catch(() => undefined)));
}

async function holdLease(
  name: string,
  command: string,
  connection: ConnectionDescriptor,
): Promise<HeldDevWriteLease> {
  const existing = heldLeases.get(name);
  if (existing) return existing;
  const lease = await acquireDevWriteLease({ name, command }, { db: connection.db });
  heldLeases.set(name, lease);
  if (!lease.joined) process.env[DEV_WRITE_LEASE_OWNER_ENV] ??= lease.ownerId;
  ensureHeartbeat(exitOnLostLease);
  removeInterruptRelease ??= onInterrupt(() => releaseHeldDevWriteLeases());
  return lease;
}

/**
 * Run by the shared connect path. It acts only for a process whose apply guard recorded an apply
 * intent, which no request-path code does, so the API server never reads or waits on a lease.
 */
export async function acquireIntendedDevApplyLease(
  connection: ConnectionDescriptor,
  env: NodeJS.ProcessEnv = process.env,
): Promise<HeldDevWriteLease | undefined> {
  if (devWriteLeaseSwitchedOff(env)) return undefined;
  if (!applyIntent) return undefined;
  // Already held through an earlier connection, which owns its release; a later, shorter-lived
  // connection must not end it when it closes.
  if (heldLeases.has(DEV_APPLY_LEASE_NAME)) return undefined;
  const target = resolveDevWriteLeaseTarget(connection);
  if (target.kind === 'skip') return undefined;
  if (target.kind === 'refuse') {
    throw new Error(`${applyIntent.scriptName} refused to apply: ${target.reason}.`);
  }
  assertDevWriteOwnerLabel(applyIntent.scriptName, env);
  const lease = await holdLease(
    DEV_APPLY_LEASE_NAME,
    describeDevWriteCommand(applyIntent),
    connection,
  );
  try {
    await recordDevWriteLaunch(connection.db, {
      kind: 'apply',
      scriptName: applyIntent.scriptName,
      leaseOwnerId: lease.ownerId,
      joinedParentLease: lease.joined,
      launchedAt: new Date(),
      launch: describeDevWriteLaunch({ env }),
    });
  } catch (error) {
    await releaseHeldDevWriteLeases();
    throw new Error(
      `${applyIntent.scriptName} refused to apply: its launch record could not be written (${(error as Error)?.message ?? error}).`,
      { cause: error },
    );
  }
  return lease;
}

/**
 * For a script that writes Development through its own MongoClient rather than the shared connect
 * path: takes the apply lease on that client's database and returns the release.
 */
export async function holdDevApplyLeaseOnDb(
  connection: ConnectionDescriptor,
  scriptName: string,
): Promise<() => Promise<void>> {
  recordDevApplyIntent(scriptName);
  const lease = await acquireIntendedDevApplyLease(connection);
  return lease ? releaseHeldDevWriteLeases : async () => undefined;
}

let armedHostLeaseConnection: { connection: ConnectionDescriptor; command: string } | undefined;
const pendingHostLeases = new Map<string, Promise<HeldDevWriteLease>>();

/** Arms per-host leases for a writing lane run against Development; any other run stays unarmed. */
export function armDevHostLeases(
  connection: ConnectionDescriptor,
  command: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (devWriteLeaseSwitchedOff(env)) return;
  if (resolveDevWriteLeaseTarget(connection).kind !== 'development') return;
  assertDevWriteOwnerLabel(command, env);
  armedHostLeaseConnection = { connection, command };
}

export const devHostLeaseName = (host: string) =>
  `${DEV_HOST_LEASE_PREFIX}${host.trim().toLowerCase()}`;

/**
 * The fetch path calls this with each host before its first request. Unarmed it does nothing;
 * armed, the first request to a host takes that host's lease and a held one fails the fetch.
 */
export async function ensureDevHostLease(host: string): Promise<void> {
  const armed = armedHostLeaseConnection;
  if (!armed || !host) return;
  const name = devHostLeaseName(host);
  if (heldLeases.has(name)) return;
  let pending = pendingHostLeases.get(name);
  if (!pending) {
    pending = holdLease(name, armed.command, armed.connection);
    pendingHostLeases.set(name, pending);
  }
  try {
    await pending;
  } finally {
    pendingHostLeases.delete(name);
  }
}

export function resetDevWriteLeaseStateForTests() {
  applyIntent = undefined;
  armedHostLeaseConnection = undefined;
  pendingHostLeases.clear();
  heldLeases.clear();
  removeInterruptRelease?.();
  removeInterruptRelease = undefined;
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = undefined;
}

export function describeScrapeRunLaunch(env: NodeJS.ProcessEnv = process.env) {
  const devWriteLeaseOwnerId = env[DEV_WRITE_LEASE_OWNER_ENV]?.trim();
  return {
    ...describeDevWriteLaunch({ env }),
    ...(devWriteLeaseOwnerId ? { devWriteLeaseOwnerId } : {}),
  };
}

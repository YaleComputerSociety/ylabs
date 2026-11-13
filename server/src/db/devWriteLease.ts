import { randomUUID } from 'crypto';
import { hostname } from 'os';
import type { Collection, Db } from 'mongodb';

import { onInterrupt } from '../utils/interruptCleanup';
import {
  DEV_WRITE_STOP_CLEANUP_ATTEMPT_TIMEOUT_MS,
  DEV_WRITE_STOP_CLEANUP_WINDOW_MS,
  enterDevWriteStoppedMode,
  registerDevWriteStopCleanup,
  resetDevWriteStopForTests,
  runDevWriteStopCleanups,
  type DevWriteStopCleanupOutcome,
} from './devWriteStop';
import { operatorEnvironmentForDatabaseName } from './operatorDatabaseEnvironment';
import {
  DEV_WRITE_OWNER_LABEL_ENV,
  describeDevWriteLaunch,
  recordDevWriteLaunch,
  redactLaunchArgv,
} from './devWriteLaunch';
import {
  devWriteProgress,
  longestWatchedSocketTimeout,
  resetDevWriteProgressForTests,
  setDevWriteProgressClock,
  startDevWriteProgressClock,
  watchMongoClientProgress,
  watchOutboundHttpProgress,
} from './devWriteProgress';

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
/** Bounds each heartbeat round trip, so a hung renewal cannot outlast the next tick. */
export const DEV_WRITE_LEASE_HEARTBEAT_TIMEOUT_MS = DEV_WRITE_LEASE_HEARTBEAT_MS / 3;
/**
 * A held lease that goes this long without a successful renewal stops the process. It must stay
 * well under the TTL: past the TTL another run may take the lease while this one is still writing.
 */
export const DEV_WRITE_LEASE_RENEWAL_DEADLINE_MS = (DEV_WRITE_LEASE_TTL_MS * 2) / 5;
/** A dead-pid takeover also needs the holder's heartbeat this stale, so a misread pid probe cannot take a live lease. */
export const DEV_WRITE_LEASE_DEAD_OWNER_HEARTBEAT_AGE_MS = 2 * DEV_WRITE_LEASE_HEARTBEAT_MS;
export const DEV_HOST_LEASE_IDLE_RELEASE_MS = 10 * 60_000;
/** Each database read or write of a lease acquire fails past this, so a fetch never waits on it. */
export const DEV_WRITE_LEASE_ACQUIRE_TIMEOUT_MS = 30_000;
/** `dev:locks` flags a live lease whose owner has completed no work for this long (#5880). */
export const DEV_WRITE_LEASE_STALLED_MS = 15 * 60_000;
/**
 * A holder that completes no work for this long stops before its next write (#5880). It must stay
 * above the 10-minute script socket timeout, so one legitimately slow operation can never trip it,
 * and a holder with any watched client that has no socket ceiling below it is never stopped.
 */
export const DEV_WRITE_LEASE_NO_PROGRESS_STOP_MS = 20 * 60_000;
/** A stopped holder exits with this code once its bounded cleanup ends, whatever the cleanup managed. */
export const DEV_WRITE_LEASE_STOP_EXIT_CODE = 1;
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
  progressAt?: Date;
  progressCount?: number;
  releasedAt?: Date;
  releaseReason?: 'success' | 'stopped' | HostLeaseReleaseReason;
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
    const progress = holder.progressAt
      ? `, no progress for ${Math.floor((now.getTime() - new Date(holder.progressAt).getTime()) / 60_000)} min`
      : '';
    super(
      `Development write lease "${leaseName}" is held by ${holder.ownerLabel || holder.ownerId || 'an unidentified owner'}` +
        ` running "${holder.command || 'an unrecorded command'}" (last heartbeat ${heartbeatAge}${progress}).` +
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
  acquired: boolean;
  heartbeat(): Promise<boolean>;
  release(): Promise<void>;
}

/**
 * Takes a named lease, or joins it when this process's parent holds it and passed its owner id
 * down, and throws `DevWriteLeaseHeldError` before anything is written when someone else holds it.
 * An expired lease is taken over, and so is one whose owner process on this host is dead and whose
 * heartbeat is older than two intervals.
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

  const current = await withinTimeout(
    collection.findOne(
      { _id: leaseId(input.name) },
      boundedOptions(DEV_WRITE_LEASE_ACQUIRE_TIMEOUT_MS),
    ),
    DEV_WRITE_LEASE_ACQUIRE_TIMEOUT_MS,
  );
  if (inherited && current?.ownerId === inherited && isLiveFor(current, now())) {
    return heldLease(input.name, inherited, deps.db, now, { releasable: false, acquired: false });
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
    progressAt: at,
    progressCount: 0,
  };
  const takeoverable = current && !isLiveFor(current, at);
  const holderHeartbeatStale =
    !current?.heartbeatAt ||
    at.getTime() - new Date(current.heartbeatAt).getTime() >
      DEV_WRITE_LEASE_DEAD_OWNER_HEARTBEAT_AGE_MS;
  const deadLocalOwner =
    current?.locked &&
    current.ownerHost === host &&
    typeof current.ownerPid === 'number' &&
    current.ownerPid !== pid &&
    holderHeartbeatStale &&
    !isAlive(current.ownerPid);

  if (!current) {
    const inserted = await withinTimeout(
      collection
        .insertOne(
          {
            _id: leaseId(input.name),
            environment: DEV_WRITE_LEASE_ENVIRONMENT,
            sourceName: input.name,
            ...fields,
          } as DevWriteLeaseRecord,
          boundedOptions(DEV_WRITE_LEASE_ACQUIRE_TIMEOUT_MS),
        )
        .then(
          () => true,
          (error: { code?: number }) => {
            if (error.code !== 11000) throw error;
            return false;
          },
        ),
      DEV_WRITE_LEASE_ACQUIRE_TIMEOUT_MS,
    );
    if (inserted) {
      return heldLease(input.name, ownerId, deps.db, now, { releasable, acquired: true });
    }
  } else if (takeoverable || deadLocalOwner) {
    const result = await withinTimeout(
      collection.updateOne(
        {
          _id: leaseId(input.name),
          ownerId: current.ownerId,
          leaseExpiresAt: current.leaseExpiresAt,
        },
        { $set: fields, $unset: { releasedAt: '', releaseReason: '' } },
        boundedOptions(DEV_WRITE_LEASE_ACQUIRE_TIMEOUT_MS),
      ),
      DEV_WRITE_LEASE_ACQUIRE_TIMEOUT_MS,
    );
    if (result.matchedCount === 1) {
      if (current.locked) {
        console.warn(
          `Took over Development write lease "${input.name}" from ${current.ownerLabel || current.ownerId} ("${current.command || 'unrecorded'}"), whose ${deadLocalOwner ? 'process on this host had exited' : 'lease had expired'}.`,
        );
      }
      return heldLease(input.name, ownerId, deps.db, now, { releasable, acquired: true });
    }
  }
  const unrecorded: DevWriteLeaseRecord = { _id: '', sourceName: input.name };
  const holder =
    (await withinTimeout(
      collection.findOne(
        { _id: leaseId(input.name) },
        boundedOptions(DEV_WRITE_LEASE_ACQUIRE_TIMEOUT_MS),
      ),
      DEV_WRITE_LEASE_ACQUIRE_TIMEOUT_MS,
    )) ??
    current ??
    unrecorded;
  if (holder.ownerId === ownerId && isLiveFor(holder, now())) {
    return heldLease(input.name, ownerId, deps.db, now, { releasable: false, acquired: false });
  }
  throw new DevWriteLeaseHeldError(input.name, holder, at);
}

function heldLease(
  name: string,
  ownerId: string,
  db: Db,
  now: () => Date,
  { releasable, acquired }: { releasable: boolean; acquired: boolean },
): HeldDevWriteLease {
  return {
    name,
    ownerId,
    joined: !releasable,
    acquired,
    async heartbeat() {
      const renewed = await renewLeases(db, ownerId, [name], now(), {
        timeoutMs: DEV_WRITE_LEASE_HEARTBEAT_TIMEOUT_MS,
      });
      return renewed.has(name);
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

export interface DevWriteLeaseStaleRenewal {
  name: string;
  lastRenewedAt: Date;
  withoutRenewalMs: number;
}

export type DevWriteLeaseStop =
  | { reason: 'lost'; leases: string[]; message: string }
  | { reason: 'renewal-failed'; leases: DevWriteLeaseStaleRenewal[]; message: string }
  | {
      reason: 'no-progress';
      leases: string[];
      lastProgressAt: Date;
      withoutProgressMs: number;
      message: string;
    }
  | { reason: 'refused'; leases: string[]; message: string };

interface DevWriteLeaseRuntime {
  now: () => Date;
  heartbeatTimeoutMs: number;
  log: (message: string) => void;
  stop: (stop: DevWriteLeaseStop) => void;
  exit: (code: number) => void;
  sleep: (ms: number) => Promise<void>;
  deferExits: () => () => void;
  cleanupWindowMs: number;
  cleanupAttemptTimeoutMs: number;
}

const sleepFor = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Another path in the stopping process, such as a CLI catch that sees its refused fetch, may call
 * `process.exit` while the bounded cleanup is still retrying, which would leave the run, the source
 * lock and the leases behind exactly as before. So exits are held until the cleanup ends.
 */
function deferProcessExitsUntilCleanupEnds(): () => void {
  const originalExit = process.exit;
  let announced = false;
  // Intentionally replaces process.exit for the length of the bounded cleanup only.
  process.exit = ((code?: number | string | null) => {
    if (!announced) {
      announced = true;
      console.error(
        `Holding process.exit(${code ?? ''}) until the Development write lease stop cleanup ends; the process exits with code ${DEV_WRITE_LEASE_STOP_EXIT_CODE} then.`,
      );
    }
    return undefined as never;
  }) as typeof process.exit;
  return () => {
    process.exit = originalExit;
  };
}

let stopCleanupEnded: Promise<void> | undefined;

const defaultRuntime: DevWriteLeaseRuntime = {
  now: () => new Date(),
  heartbeatTimeoutMs: DEV_WRITE_LEASE_HEARTBEAT_TIMEOUT_MS,
  log: (message) => console.error(message),
  stop: (stop) => {
    stopCleanupEnded = stopAfterBoundedCleanup(stop);
  },
  exit: (code) => process.exit(code),
  sleep: sleepFor,
  deferExits: deferProcessExitsUntilCleanupEnds,
  cleanupWindowMs: DEV_WRITE_STOP_CLEANUP_WINDOW_MS,
  cleanupAttemptTimeoutMs: DEV_WRITE_STOP_CLEANUP_ATTEMPT_TIMEOUT_MS,
};

let runtime: DevWriteLeaseRuntime = defaultRuntime;

export function setDevWriteLeaseRuntimeForTests(overrides: Partial<DevWriteLeaseRuntime>) {
  runtime = {
    ...defaultRuntime,
    exit: () => undefined,
    deferExits: () => () => undefined,
    ...overrides,
  };
  setDevWriteProgressClock(runtime.now);
}

interface HeldLeaseState {
  lease: HeldDevWriteLease;
  db: Db;
  lastRenewedAt: Date;
  lastUsedAt: Date;
  idleReleasable: boolean;
}

const heldLeases = new Map<string, HeldLeaseState>();
const pendingIdleReleases = new Map<string, Promise<void>>();
let mintedOwner: { db: Db; ownerId: string } | undefined;
let removeStopLeaseRelease: (() => void) | undefined;
let heartbeatTimer: NodeJS.Timeout | undefined;
let tickInFlight: Promise<void> | undefined;
let stopped = false;
const reportedProgressCounts = new Map<string, number>();
let progressUnobservable = false;

export const UNMONITORED_LEASE_CLIENT_WARNING =
  'holds a Development write lease through a MongoDB client without command monitoring';

function warnUnmonitoredLeaseClient(name: string, command: string) {
  console.warn(
    `WARNING: ${command} ${UNMONITORED_LEASE_CLIENT_WARNING} (lease "${name}"), so its progress cannot be seen and a hang will never self-stop. Connect through db/connections.ts, or create the client with monitorCommands: true.`,
  );
}
let heldForChildProcesses = false;

class DevWriteLeaseTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`timed out after ${timeoutMs} ms`);
    this.name = 'DevWriteLeaseTimeoutError';
  }
}

async function withinTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DevWriteLeaseTimeoutError(timeoutMs)), timeoutMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const boundedOptions = (timeoutMs: number) => ({ maxTimeMS: timeoutMs, timeoutMS: timeoutMs });

interface ProgressReport {
  progressAt: Date;
  newProgress: number;
}

async function renewLeases(
  db: Db,
  ownerId: string,
  names: string[],
  at: Date,
  { timeoutMs, progress }: { timeoutMs: number; progress?: ProgressReport },
): Promise<Set<string>> {
  const collection = devWriteLeaseCollection(db);
  const filter = { _id: { $in: names.map(leaseId) }, ownerId, locked: true };
  const result = await withinTimeout(
    collection.updateMany(
      filter,
      {
        $set: {
          heartbeatAt: at,
          leaseExpiresAt: new Date(at.getTime() + DEV_WRITE_LEASE_TTL_MS),
        },
        // $max because a parent and the children that joined its lease renew the same document,
        // and one process's older progress must not overwrite another's newer progress.
        ...(progress
          ? {
              $max: { progressAt: progress.progressAt },
              $inc: { progressCount: progress.newProgress },
            }
          : {}),
      },
      boundedOptions(timeoutMs),
    ),
    timeoutMs,
  );
  if (result.matchedCount === names.length) return new Set(names);
  const stillOwned = await withinTimeout(
    collection
      .find(filter, { projection: { sourceName: 1 }, ...boundedOptions(timeoutMs) })
      .toArray(),
    timeoutMs,
  );
  return new Set(stillOwned.map((record) => record.sourceName));
}

export class DevWriteLeaseStoppedError extends Error {
  constructor(leaseName: string) {
    super(
      `Development write lease "${leaseName}" is no longer confirmed, so this run is stopping and the fetch was not made.`,
    );
    this.name = 'DevWriteLeaseStoppedError';
  }
}

const quoted = (names: string[]) => names.map((name) => `"${name}"`).join(', ');

function stopProcess(stop: DevWriteLeaseStop) {
  if (stopped) return;
  stopped = true;
  enterDevWriteStoppedMode(stop.reason);
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
  }
  runtime.stop(stop);
}

function describeStopCleanup(
  outcomes: DevWriteStopCleanupOutcome[],
  joinedLeases: string[],
): string {
  const cleaned = outcomes.filter((outcome) => outcome.cleaned);
  const notCleaned = outcomes.filter((outcome) => !outcome.cleaned);
  const lines = [
    `Cleanup after the stop (bounded to ${Math.round(runtime.cleanupWindowMs / 1000)} s): ${cleaned.length} cleaned, ${notCleaned.length + (joinedLeases.length > 0 ? 1 : 0)} not cleaned.`,
    ...cleaned.map(({ description, detail }) => `  cleaned: ${description}: ${detail}`),
    ...notCleaned.map(
      ({ description, detail, attempts }) =>
        `  not cleaned: ${description} after ${attempts} attempt(s), ${detail}; it is left to expire on its own.`,
    ),
  ];
  if (joinedLeases.length > 0) {
    lines.push(
      `  not cleaned: ${joinedLeases.length} lease(s) joined from the parent owner (${quoted(joinedLeases)}); the parent owner releases them.`,
    );
  }
  if (outcomes.length === 0 && joinedLeases.length === 0) {
    lines.push('  nothing was registered for cleanup.');
  }
  return lines.join('\n');
}

/**
 * The stop sequence after stopped mode is entered: print the stop report, run the bounded cleanup,
 * report what it cleaned and what it left, and exit with the stop exit code. It exits even when the
 * database never answers, at the end of the cleanup window.
 */
async function stopAfterBoundedCleanup(stop: DevWriteLeaseStop): Promise<void> {
  runtime.log(stop.message);
  const joinedLeases = [...heldLeases.values()]
    .filter(({ lease }) => lease.ownerId !== mintedOwner?.ownerId)
    .map(({ lease }) => lease.name);
  const releaseExits = runtime.deferExits();
  try {
    const outcomes = await runDevWriteStopCleanups({
      now: runtime.now,
      sleep: runtime.sleep,
      windowMs: runtime.cleanupWindowMs,
      attemptTimeoutMs: runtime.cleanupAttemptTimeoutMs,
    });
    runtime.log(describeStopCleanup(outcomes, joinedLeases));
  } catch (error) {
    runtime.log(
      `Cleanup after the stop failed: ${(error as Error)?.message ?? error}; what it did not reach is left to expire on its own.`,
    );
  } finally {
    releaseExits();
    runtime.exit(DEV_WRITE_LEASE_STOP_EXIT_CODE);
  }
}

function registerStopLeaseRelease(db: Db, ownerId: string) {
  removeStopLeaseRelease ??= registerDevWriteStopCleanup({
    description: `Development write leases of owner ${ownerId}`,
    run: async () => {
      const result = await devWriteLeaseCollection(db).updateMany(
        { environment: DEV_WRITE_LEASE_ENVIRONMENT, ownerId, locked: true } as Record<
          string,
          unknown
        >,
        {
          $set: { locked: false, releasedAt: runtime.now(), releaseReason: 'stopped' },
          $unset: { ownerId: '', leaseExpiresAt: '' },
        },
        boundedOptions(runtime.cleanupAttemptTimeoutMs),
      );
      return `released ${result.modifiedCount} lease(s)`;
    },
  });
}

function stopForLostLeases(names: string[]) {
  stopProcess({
    reason: 'lost',
    leases: names,
    message: `Lost the Development write lease ${quoted(names)} to another owner; stopping before the next write.`,
  });
}

function overdueRenewals(states: Iterable<HeldLeaseState>, at: Date): DevWriteLeaseStaleRenewal[] {
  return [...states]
    .map(({ lease, lastRenewedAt }) => ({
      name: lease.name,
      lastRenewedAt,
      withoutRenewalMs: at.getTime() - lastRenewedAt.getTime(),
    }))
    .filter(({ withoutRenewalMs }) => withoutRenewalMs > DEV_WRITE_LEASE_RENEWAL_DEADLINE_MS);
}

function stopIfRenewalOverdue(states: Iterable<HeldLeaseState> = heldLeases.values()): boolean {
  const overdue = overdueRenewals(states, runtime.now());
  if (overdue.length === 0) return false;
  const lines = overdue.map(
    ({ name, lastRenewedAt, withoutRenewalMs }) =>
      `  "${name}": last renewed ${lastRenewedAt.toISOString()}, ${Math.round(withoutRenewalMs / 1000)} s without a renewal`,
  );
  stopProcess({
    reason: 'renewal-failed',
    leases: overdue,
    message: [
      `Renewal failed for ${overdue.length} Development write lease(s) for longer than ${DEV_WRITE_LEASE_RENEWAL_DEADLINE_MS / 1000} s; stopping before the next write, because another run may take them over once they expire.`,
      'Fetches and writes guarded by these leases since their last renewal ran without a confirmed lease:',
      ...lines,
    ].join('\n'),
  });
  return true;
}

const progressStopArmed = () =>
  !progressUnobservable &&
  !heldForChildProcesses &&
  longestWatchedSocketTimeout() < DEV_WRITE_LEASE_NO_PROGRESS_STOP_MS;

/**
 * Stops a holder that has completed no work for `DEV_WRITE_LEASE_NO_PROGRESS_STOP_MS`, through the
 * same stop as a missed renewal deadline. Nobody else may take a lease that is still heartbeating,
 * so the hung holder ending itself is what frees it.
 */
function stopIfNoProgress(): boolean {
  if (!progressStopArmed() || heldLeases.size === 0) return false;
  const { lastAt } = devWriteProgress();
  if (!lastAt) return false;
  const withoutProgressMs = runtime.now().getTime() - lastAt.getTime();
  if (withoutProgressMs < DEV_WRITE_LEASE_NO_PROGRESS_STOP_MS) return false;
  const leases = [...heldLeases.keys()];
  const minutes = Math.floor(withoutProgressMs / 60_000);
  stopProcess({
    reason: 'no-progress',
    leases,
    lastProgressAt: lastAt,
    withoutProgressMs,
    message: [
      `No progress for ${minutes} min while holding ${leases.length} Development write lease(s); stopping before the next write, because a holder whose work has hung keeps every other Development write waiting while its heartbeat runs.`,
      `Last progress (a completed database command or fetch) at ${lastAt.toISOString()}. Leases held:`,
      ...leases.map(
        (name) =>
          `  "${name}": last progress ${lastAt.toISOString()}, ${minutes} min without progress`,
      ),
    ].join('\n'),
  });
  return true;
}

function groupByOwner(states: HeldLeaseState[]) {
  const groups = new Map<Db, Map<string, HeldLeaseState[]>>();
  for (const state of states) {
    const byOwner = groups.get(state.db) ?? new Map<string, HeldLeaseState[]>();
    groups.set(state.db, byOwner);
    byOwner.set(state.lease.ownerId, [...(byOwner.get(state.lease.ownerId) ?? []), state]);
  }
  return [...groups].flatMap(([db, byOwner]) =>
    [...byOwner].map(([ownerId, members]) => ({ db, ownerId, members })),
  );
}

type HostLeaseReleaseReason = 'idle' | 'host-done';

function releaseHostLeaseStates(
  states: HeldLeaseState[],
  at: Date,
  reason: HostLeaseReleaseReason,
): Promise<void> {
  for (const state of states) heldLeases.delete(state.lease.name);
  const described = reason === 'idle' ? 'idle' : 'finished';
  return Promise.all(
    groupByOwner(states).map(({ db, ownerId, members }) => {
      const names = members.map(({ lease }) => lease.name);
      const release = withinTimeout(
        devWriteLeaseCollection(db).updateMany(
          { _id: { $in: names.map(leaseId) }, ownerId, locked: true },
          {
            $set: { locked: false, releasedAt: at, releaseReason: reason },
            $unset: { ownerId: '', leaseExpiresAt: '' },
          },
          boundedOptions(runtime.heartbeatTimeoutMs),
        ),
        runtime.heartbeatTimeoutMs,
      ).then(
        () => runtime.log(`Released ${described} Development host lease ${quoted(names)}.`),
        (error) =>
          runtime.log(
            `Could not release ${described} Development host lease ${quoted(names)} (${(error as Error)?.message ?? error}); it expires on its own.`,
          ),
      );
      for (const name of names) pendingIdleReleases.set(name, release);
      return release.finally(() => {
        for (const name of names) {
          if (pendingIdleReleases.get(name) === release) pendingIdleReleases.delete(name);
        }
      });
    }),
  ).then(() => undefined);
}

/**
 * A host lease this process took under its own owner id and has not fetched through for
 * `DEV_HOST_LEASE_IDLE_RELEASE_MS` is released, and taken again on the next fetch. The apply lease
 * and a lease joined from a parent are never idle-released: a sibling may still be using it.
 */
async function releaseIdleHostLeases(at: Date) {
  const idle = [...heldLeases.values()].filter(
    (state) =>
      state.idleReleasable &&
      at.getTime() - state.lastUsedAt.getTime() >= DEV_HOST_LEASE_IDLE_RELEASE_MS,
  );
  await releaseHostLeaseStates(idle, at, 'idle');
}

async function renewHeldLeases(at: Date) {
  const lost: string[] = [];
  const { count, lastAt } = devWriteProgress();
  await Promise.all(
    groupByOwner([...heldLeases.values()]).map(async ({ db, ownerId, members }) => {
      const names = members.map(({ lease }) => lease.name);
      try {
        const renewed = await renewLeases(db, ownerId, names, at, {
          timeoutMs: runtime.heartbeatTimeoutMs,
          progress: lastAt
            ? {
                progressAt: lastAt,
                newProgress: count - (reportedProgressCounts.get(ownerId) ?? 0),
              }
            : undefined,
        });
        reportedProgressCounts.set(ownerId, count);
        for (const state of members) {
          if (renewed.has(state.lease.name)) state.lastRenewedAt = at;
          else lost.push(state.lease.name);
        }
      } catch (error) {
        runtime.log(
          `Development write lease heartbeat failed for ${quoted(names)}: ${(error as Error)?.message ?? error}.`,
        );
      }
    }),
  );
  if (lost.length > 0) stopForLostLeases(lost);
}

export function runDevWriteLeaseHeartbeatTick(): Promise<void> {
  if (stopped) return Promise.resolve();
  tickInFlight ??= (async () => {
    try {
      await releaseIdleHostLeases(runtime.now());
      await renewHeldLeases(runtime.now());
      if (!stopIfRenewalOverdue()) stopIfNoProgress();
    } catch (error) {
      runtime.log(
        `Development write lease heartbeat tick failed: ${(error as Error)?.message ?? error}.`,
      );
    }
  })().finally(() => {
    tickInFlight = undefined;
  });
  return tickInFlight;
}

function ensureHeartbeat() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    void runDevWriteLeaseHeartbeatTick();
  }, DEV_WRITE_LEASE_HEARTBEAT_MS);
  heartbeatTimer.unref();
}

let removeInterruptRelease: (() => void) | undefined;

export async function releaseHeldDevWriteLeases(): Promise<void> {
  await stopCleanupEnded;
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
  }
  removeInterruptRelease?.();
  removeInterruptRelease = undefined;
  removeStopLeaseRelease?.();
  removeStopLeaseRelease = undefined;
  const leases = [...heldLeases.values()].map(({ lease }) => lease);
  heldLeases.clear();
  await Promise.allSettled([...pendingIdleReleases.values()]);
  const owner = mintedOwner;
  mintedOwner = undefined;
  await Promise.all([
    ...leases.map((lease) => lease.release().catch(() => undefined)),
    owner
      ? releaseLeasesOwnedBy(owner.db, owner.ownerId, runtime.now()).catch(() => undefined)
      : undefined,
  ]);
}

async function holdLease(
  name: string,
  command: string,
  connection: ConnectionDescriptor,
): Promise<HeldDevWriteLease> {
  const existing = heldLeases.get(name);
  if (existing) return existing.lease;
  const lease = await acquireDevWriteLease(
    { name, command },
    { db: connection.db, now: runtime.now },
  );
  if (!lease.joined) {
    process.env[DEV_WRITE_LEASE_OWNER_ENV] ??= lease.ownerId;
    mintedOwner ??= { db: connection.db, ownerId: lease.ownerId };
    registerStopLeaseRelease(mintedOwner.db, mintedOwner.ownerId);
  }
  const at = runtime.now();
  startDevWriteProgressClock(at);
  watchOutboundHttpProgress();
  if (!watchMongoClientProgress(connection.db.client)) {
    if (!progressUnobservable) warnUnmonitoredLeaseClient(name, command);
    progressUnobservable = true;
  }
  heldLeases.set(name, {
    lease,
    db: connection.db,
    lastRenewedAt: at,
    lastUsedAt: at,
    idleReleasable:
      name.startsWith(DEV_HOST_LEASE_PREFIX) &&
      lease.acquired &&
      lease.ownerId === mintedOwner?.ownerId,
  });
  ensureHeartbeat();
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

let firstWriteApplyLease: Promise<HeldDevWriteLease | undefined> | undefined;
let firstWriteApplyLeaseRefusal: Error | undefined;

export function devApplyLeaseFirstWriteRefusal(): Error | undefined {
  return firstWriteApplyLeaseRefusal;
}

/**
 * Run by the model write guard for a script that recorded its apply intent only after it connected,
 * so the connect path took nothing. Takes the apply lease on the writing model's connection before
 * that first write. A refusal is kept and the process stops, so no later write can land either.
 */
export async function acquireIntendedDevApplyLeaseAtFirstWrite(
  connection: ConnectionDescriptor,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  if (firstWriteApplyLeaseRefusal) throw firstWriteApplyLeaseRefusal;
  if (!applyIntent) return false;
  if (heldLeases.has(DEV_APPLY_LEASE_NAME)) return true;
  firstWriteApplyLease ??= acquireIntendedDevApplyLease(connection, env).finally(() => {
    firstWriteApplyLease = undefined;
  });
  try {
    await firstWriteApplyLease;
  } catch (error) {
    firstWriteApplyLeaseRefusal ??=
      error instanceof Error ? error : new Error(String(error), { cause: error });
    stopProcess({
      reason: 'refused',
      leases: [DEV_APPLY_LEASE_NAME],
      message: `${firstWriteApplyLeaseRefusal.message} Stopping before the first write.`,
    });
    throw firstWriteApplyLeaseRefusal;
  }
  return heldLeases.has(DEV_APPLY_LEASE_NAME);
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

/**
 * For an orchestrator that holds the apply lease while child processes do the writing. Its own
 * process completes little work, so it is never stopped for lack of progress; each child that writes
 * joins the lease and is judged by its own progress.
 */
export function markDevWriteLeaseHeldForChildProcesses() {
  heldForChildProcesses = true;
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

/**
 * A lane that knows it has finished every row on a host calls this to hand the host back before the
 * run ends. It releases only a host lease this process took under its own owner id, the same set
 * the idle release may end; a later fetch to the host takes it again through the normal acquire.
 */
export async function releaseDevHostLease(host: string): Promise<void> {
  if (!armedHostLeaseConnection || !host || stopped) return;
  const name = devHostLeaseName(host);
  await pendingHostLeases.get(name)?.catch(() => undefined);
  const state = heldLeases.get(name);
  if (!state?.idleReleasable) return;
  await releaseHostLeaseStates([state], runtime.now(), 'host-done');
}

export function holdsDevApplyLease(): boolean {
  return heldLeases.has(DEV_APPLY_LEASE_NAME);
}

export function devHostLeasesArmed(): boolean {
  return armedHostLeaseConnection !== undefined;
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
  if (stopped || stopIfRenewalOverdue() || stopIfNoProgress()) {
    throw new DevWriteLeaseStoppedError(name);
  }
  const held = heldLeases.get(name);
  if (held) {
    held.lastUsedAt = runtime.now();
    return;
  }
  await pendingIdleReleases.get(name);
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
  firstWriteApplyLease = undefined;
  firstWriteApplyLeaseRefusal = undefined;
  armedHostLeaseConnection = undefined;
  pendingHostLeases.clear();
  heldLeases.clear();
  pendingIdleReleases.clear();
  mintedOwner = undefined;
  tickInFlight = undefined;
  stopped = false;
  stopCleanupEnded = undefined;
  reportedProgressCounts.clear();
  progressUnobservable = false;
  heldForChildProcesses = false;
  resetDevWriteProgressForTests();
  runtime = defaultRuntime;
  removeInterruptRelease?.();
  removeInterruptRelease = undefined;
  removeStopLeaseRelease = undefined;
  resetDevWriteStopForTests();
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

import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { isExcludedHostname, normalizeExcludedHost } from '../../utils/excludedHosts';
import { isBenchmarkReplayActive } from '../benchmarkModeState';
import { HostPausedError } from './hostPausedError';
import {
  DEFAULT_PER_HOST_CONCURRENCY,
  HOST_SLOT_WAIT_TIMEOUT_MS,
  HOST_THROTTLE_OVERRIDES,
  HostSlotWaitTimeoutError,
  YALE_HOST_DEFAULT_THROTTLE,
  type HostSlotLimiter,
  type HostSlotRelease,
  type HostThrottle,
} from './hostThrottlePolicy';

/**
 * One per-host request budget for every process on this machine (#4535, #6168).
 *
 * Each host has a small state file and a lock file under one per-user directory. A process takes
 * the lock only for one read-modify-write, records its slot with its pid, and replaces the state by
 * an atomic rename, so a crash leaves either the old state or the new one. A slot whose process has
 * died, or that has outlived any fetch deadline, is reclaimed by the next reader. When the state
 * cannot be read the host is paused, and when it cannot be written nothing is sent: the budget
 * fails slower, never faster.
 */
export const MACHINE_HOST_SLOTS_ENV = 'SCRAPER_MACHINE_HOST_SLOTS';
export const MACHINE_HOST_SLOT_DIR_ENV = 'SCRAPER_MACHINE_HOST_SLOT_DIR';
export const MACHINE_HOST_SLOT_ACQUIRE_TIMEOUT_ENV = 'SCRAPER_HOST_SLOT_ACQUIRE_TIMEOUT_MS';

export const MACHINE_DEFAULT_HOST_BUDGET: HostThrottle = {
  concurrency: DEFAULT_PER_HOST_CONCURRENCY,
  minIntervalMs: 400,
};
/** Above the longest fetch deadline (90 s policy fetch, 30 s rendered fetch), so a live slot never expires. */
export const MACHINE_HOST_SLOT_TTL_MS = 5 * 60_000;
export const MACHINE_HOST_LOCK_STALE_MS = 2_000;
export const MACHINE_HOST_CORRUPT_STATE_PAUSE_MS = 60_000;
export const MACHINE_HOST_UNAVAILABLE_TIMEOUT_MS = 30_000;
const CAPACITY_POLL_MS = 100;
const CAPACITY_POLL_JITTER_MS = 150;
const LOCK_RETRY_MS = 5;
const LOCK_RETRY_JITTER_MS = 20;
const UNAVAILABLE_RETRY_MS = 250;
const STATE_VERSION = 1;

/**
 * Tier 2 of the host retry ladder (#6168): a pause every process on this machine honours, recorded
 * by a caller once a request has exhausted its own quick retries (tier 1) or met a plain 429 or 503.
 */
export const HOST_BACKOFF_BASE_MS = 30_000;
export const HOST_BACKOFF_CAP_MS = 3_600_000;
export const HOST_BACKOFF_QUIET_RESET_MS = 600_000;
export const HOST_BACKOFF_JITTER_RATIO = 0.1;
/** A pause ending within this bound is waited out inside acquire; a longer one fails fast. */
export const HOST_PAUSE_INLINE_WAIT_MS = 2_000;
const MAX_RECORDED_BACKOFF_LEVEL = 30;

// Concurrent workers can each hand back the same host's refusal, so refusals this close together
// count as one step; a later refusal still escalates even while the host is paused.
export const HOST_BACKOFF_DEDUPE_MS = 5_000;
const NO_HTTP_STATUS = 0;

export function isMachineHostSlotSharingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[MACHINE_HOST_SLOTS_ENV]?.trim().toLowerCase();
  return !(raw === 'off' || raw === '0' || raw === 'false');
}

function userTag(): string {
  try {
    return String(os.userInfo().uid);
  } catch {
    return 'user';
  }
}

// Under the user's cache root rather than os.tmpdir(), because TMPDIR differs between shells and
// sandboxes on one machine and a per-TMPDIR directory would split the budget it exists to share.
export function machineHostBudgetDirectory(env: NodeJS.ProcessEnv = process.env): string {
  const root =
    env[MACHINE_HOST_SLOT_DIR_ENV]?.trim() ||
    path.join(env.XDG_CACHE_HOME?.trim() || path.join(os.homedir(), '.cache'), 'ylabs');
  return path.join(root, `host-budget-${userTag()}`);
}

export function machineHostBudgetKey(host: string): string {
  return normalizeExcludedHost(host);
}

const YALE_DOMAINS = ['yale.edu'];

export function machineHostBudgetFor(host: string): HostThrottle {
  const key = machineHostBudgetKey(host);
  const override = Object.hasOwn(HOST_THROTTLE_OVERRIDES, key)
    ? HOST_THROTTLE_OVERRIDES[key]
    : undefined;
  const floor = isExcludedHostname(key, YALE_DOMAINS)
    ? YALE_HOST_DEFAULT_THROTTLE
    : MACHINE_DEFAULT_HOST_BUDGET;
  if (!override) return floor;
  return {
    concurrency: Math.min(override.concurrency, floor.concurrency),
    minIntervalMs: Math.max(override.minIntervalMs, floor.minIntervalMs),
  };
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export interface MachineHostBudgetSlot {
  id: string;
  pid: number;
  grantedAt: number;
  expiresAt: number;
}

/**
 * Optional so a process still running the budget without backoff reads, keeps and rewrites the
 * field unchanged; a version bump would make that process discard it as corrupt.
 */
export interface HostBackoffRecord {
  level: number;
  pausedUntil: number;
  lastStatus: number;
  since: number;
  lastBackoffAt: number;
  statedUntil?: number;
}

export interface MachineHostBudgetState {
  v: typeof STATE_VERSION;
  host: string;
  nextGrantAt: number;
  lastGrantAt: number;
  lastReleaseAt?: number;
  slots: MachineHostBudgetSlot[];
  backoff?: HostBackoffRecord;
}

export interface HostBackoffVerdict {
  status: number;
  retryAfterMs?: number;
  statedUntil?: Date;
}

export interface HostBackoffState {
  level: number;
  pausedUntil: Date;
  lastStatus: number;
  since: Date;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function isSlot(value: unknown): value is MachineHostBudgetSlot {
  const slot = value as MachineHostBudgetSlot;
  return (
    typeof slot?.id === 'string' &&
    Number.isInteger(slot.pid) &&
    isFiniteNumber(slot.grantedAt) &&
    isFiniteNumber(slot.expiresAt)
  );
}

function isBackoffRecord(value: unknown): value is HostBackoffRecord {
  const record = value as HostBackoffRecord;
  return (
    Number.isInteger(record?.level) &&
    record.level >= 0 &&
    isFiniteNumber(record.pausedUntil) &&
    Number.isInteger(record.lastStatus) &&
    isFiniteNumber(record.since) &&
    isFiniteNumber(record.lastBackoffAt) &&
    (record.statedUntil === undefined || isFiniteNumber(record.statedUntil))
  );
}

// A paused host is sent nothing, so quiet counts from the end of the pause, never from the last
// refusal; counting from the refusal would make every pause over the window look clean.
const quietSince = (backoff: HostBackoffRecord): number =>
  Math.max(backoff.lastBackoffAt, backoff.pausedUntil);

function parseState(raw: string, host: string): MachineHostBudgetState | undefined {
  try {
    const parsed = JSON.parse(raw) as MachineHostBudgetState;
    const valid =
      parsed?.v === STATE_VERSION &&
      parsed.host === host &&
      isFiniteNumber(parsed.nextGrantAt) &&
      isFiniteNumber(parsed.lastGrantAt) &&
      (parsed.lastReleaseAt === undefined || isFiniteNumber(parsed.lastReleaseAt)) &&
      Array.isArray(parsed.slots) &&
      parsed.slots.every(isSlot) &&
      (parsed.backoff === undefined || isBackoffRecord(parsed.backoff));
    return valid ? parsed : undefined;
  } catch {
    return undefined;
  }
}

// A request can reach the host well after its grant (DNS, connect, a cold process), so at one in
// flight the next grant waits out the interval from the later of the last grant and the last
// response, which bounds the gap the host sees. With more slots every response would push the
// anchor forward and drain the host before each grant, so those hosts space from the last grant.
const spacingAnchor = (state: MachineHostBudgetState, budget: HostThrottle): number =>
  budget.concurrency === 1
    ? Math.max(state.lastGrantAt, state.lastReleaseAt ?? Number.MIN_SAFE_INTEGER)
    : state.lastGrantAt;

const freshState = (host: string, nextGrantAt = 0): MachineHostBudgetState => ({
  v: STATE_VERSION,
  host,
  nextGrantAt,
  lastGrantAt: Number.MIN_SAFE_INTEGER,
  slots: [],
});

export class HostBudgetUnavailableError extends Error {
  readonly code = 'ERR_HOST_BUDGET_UNAVAILABLE';

  constructor(host: string, directory: string, cause: unknown) {
    super(
      `the machine-wide host budget for ${host} at ${directory} could not be read or written (${(cause as Error)?.message ?? cause}), so the request was not sent`,
    );
    this.name = 'HostBudgetUnavailableError';
  }
}

const BUSY = Symbol('busy');

interface Mutation<T> {
  result: T;
  write: boolean;
}

type SpacingOutcome = { remaining: number } | { stamp: SpacingStamp };

interface HostReservation {
  at: number;
  priorNextGrantAt: number;
  nextGrantAt: number;
}

interface SpacingStamp {
  priorLastGrantAt: number;
  stampedAt: number;
}

/** What one grant moved in the shared ledger, so a replay that sent nothing can hand it back. */
interface SpacingRefund {
  reservation: HostReservation;
  stamp: SpacingStamp;
}

type MachineHostGrantObserver = (host: string, stampedAt: number) => void;

let grantObserver: MachineHostGrantObserver | undefined;

/** Reports the grant time each spacing stamp records, which is what the next grant is spaced from. */
export function observeMachineHostGrants(observer: MachineHostGrantObserver | undefined): void {
  grantObserver = observer;
}

export interface MachineHostBudgetLimiterOptions {
  env?: NodeJS.ProcessEnv;
  directory?: string;
  acquireTimeoutMs?: number;
  unavailableTimeoutMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  pid?: number;
  isProcessAlive?: (pid: number) => boolean;
  isBypassed?: () => boolean;
  warn?: (message: string) => void;
  random?: () => number;
  inlinePauseWaitMs?: number;
}

interface CachedBackoff {
  ino: number;
  mtimeMs: number;
  size: number;
  record?: HostBackoffRecord;
  failClosed: boolean;
}

type BackoffRead = Pick<CachedBackoff, 'record' | 'failClosed'>;

const NOTHING_RECORDED: BackoffRead = { failClosed: false };
const FAIL_CLOSED: BackoffRead = { failClosed: true };

function resolveAcquireTimeoutMs(env: NodeJS.ProcessEnv): number {
  const raw = Number(env[MACHINE_HOST_SLOT_ACQUIRE_TIMEOUT_ENV]);
  return Number.isFinite(raw) && raw > 0 ? raw : HOST_SLOT_WAIT_TIMEOUT_MS;
}

const realSleep = (ms: number): Promise<void> =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

const jittered = (base: number, jitter: number): number =>
  base + Math.floor(Math.random() * jitter);

export class MachineHostBudgetLimiter implements HostSlotLimiter {
  readonly directory: string;
  private readonly enabled: boolean;
  private readonly acquireTimeoutMs: number;
  private readonly unavailableTimeoutMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly pid: number;
  private readonly isAlive: (pid: number) => boolean;
  private readonly isBypassed: () => boolean;
  private readonly warn: (message: string) => void;
  private readonly random: () => number;
  private readonly inlinePauseWaitMs: number;
  private readonly backoffCache = new Map<string, CachedBackoff>();
  private readonly processLocalState = new Map<string, MachineHostBudgetState>();
  private optOutLogged = false;

  constructor(options: MachineHostBudgetLimiterOptions = {}) {
    const env = options.env ?? process.env;
    this.directory = options.directory ?? machineHostBudgetDirectory(env);
    this.enabled = isMachineHostSlotSharingEnabled(env);
    this.acquireTimeoutMs = options.acquireTimeoutMs ?? resolveAcquireTimeoutMs(env);
    this.unavailableTimeoutMs = options.unavailableTimeoutMs ?? MACHINE_HOST_UNAVAILABLE_TIMEOUT_MS;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? realSleep;
    this.pid = options.pid ?? process.pid;
    this.isAlive = options.isProcessAlive ?? isProcessAlive;
    this.isBypassed = options.isBypassed ?? (() => false);
    this.warn = options.warn ?? ((message) => console.warn(`[host-budget] ${message}`));
    this.random = options.random ?? Math.random;
    this.inlinePauseWaitMs = options.inlinePauseWaitMs ?? HOST_PAUSE_INLINE_WAIT_MS;
  }

  acquire(host: string): Promise<HostSlotRelease> {
    return this.acquireAround(host);
  }

  /**
   * Takes this host's budget slot, then `inner`, and only then stamps the spacing, so however long
   * `inner` takes to grant, the request still leaves at least the host's interval after the last.
   */
  async acquireAround(host: string, inner?: HostSlotLimiter): Promise<HostSlotRelease> {
    const key = host ? machineHostBudgetKey(host) : '';
    const acquireInner = async (): Promise<HostSlotRelease> =>
      inner ? inner.acquire(host) : () => {};
    if (!key || this.isBypassed()) return acquireInner();
    if (!this.enabled) {
      this.logOptOut();
      return acquireInner();
    }
    const budget = machineHostBudgetFor(key);
    for (;;) {
      await this.waitOutShortPause(key);
      const id = `${this.pid}-${randomUUID()}`;
      const reservation = await this.reserve(key, id, budget);
      let releaseInner: HostSlotRelease | undefined;
      let stamp: SpacingStamp;
      try {
        await this.sleep(reservation.at - this.now());
        if (this.activePauseMs(key) !== undefined) {
          await this.releaseSlot(key, id);
          continue;
        }
        releaseInner = await acquireInner();
        stamp = await this.stampSpacing(key, budget);
      } catch (error) {
        releaseInner?.();
        await this.releaseSlot(key, id);
        throw error;
      }
      let released = false;
      return (outcome) => {
        if (released) return;
        released = true;
        releaseInner?.(outcome);
        void this.releaseSlot(key, id, outcome?.reused ? { reservation, stamp } : undefined);
      };
    }
  }

  /**
   * Records tier-2 backoff for one exact host under its lock. Without a stated date the pause is the
   * exponential step (jittered) or the Retry-After, whichever is longer; a stated date is honoured
   * even beyond the cap. A pause already recorded is never shortened.
   */
  async recordBackoff(host: string, verdict: HostBackoffVerdict): Promise<Date | undefined> {
    const key = host ? machineHostBudgetKey(host) : '';
    if (!key || this.isBypassed()) return undefined;
    const pausedUntil = await this.transact(key, (state, now) => {
      const prior = state.backoff;
      const clean = prior !== undefined && now - quietSince(prior) >= HOST_BACKOFF_QUIET_RESET_MS;
      const alreadyStepped =
        prior !== undefined && !clean && now - prior.lastBackoffAt < HOST_BACKOFF_DEDUPE_MS;
      const stepped = prior && !clean ? prior.level + (alreadyStepped ? 0 : 1) : 0;
      const level = Math.min(stepped, MAX_RECORDED_BACKOFF_LEVEL);
      const exponential = Math.min(HOST_BACKOFF_CAP_MS, HOST_BACKOFF_BASE_MS * 2 ** level);
      const jitter = exponential * HOST_BACKOFF_JITTER_RATIO * (this.random() * 2 - 1);
      const retryAfterMs = isFiniteNumber(verdict.retryAfterMs) ? verdict.retryAfterMs : 0;
      const computed = now + Math.max(retryAfterMs, Math.round(exponential + jitter));
      const statedMs = verdict.statedUntil?.getTime();
      const stated = isFiniteNumber(statedMs) && statedMs > now ? statedMs : undefined;
      const until = Math.max(prior?.pausedUntil ?? 0, stated ?? computed, now + retryAfterMs);
      const statedUntil = Math.max(stated ?? 0, prior?.statedUntil ?? 0) || undefined;
      state.backoff = {
        level,
        pausedUntil: until,
        lastStatus: Number.isInteger(verdict.status) ? verdict.status : NO_HTTP_STATUS,
        since: prior && !clean ? prior.since : now,
        lastBackoffAt: now,
        ...(statedUntil ? { statedUntil } : {}),
      };
      return { result: until, write: true };
    });
    return new Date(pausedUntil);
  }

  /**
   * Forgets the backoff once the host has gone a quiet window past both its last backoff and the
   * end of its pause, so the first success after a long pause does not drop straight to the base
   * step. An active pause is never cleared. Costs one stat when nothing is recorded.
   */
  async recordSuccess(host: string): Promise<void> {
    const key = host ? machineHostBudgetKey(host) : '';
    if (!key || this.isBypassed()) return;
    const { record } = this.readBackoff(key);
    if (!record || this.now() - quietSince(record) < HOST_BACKOFF_QUIET_RESET_MS) return;
    try {
      await this.transact(key, (state, now) => {
        const backoff = state.backoff;
        if (!backoff || now - quietSince(backoff) < HOST_BACKOFF_QUIET_RESET_MS) {
          return { result: undefined, write: false };
        }
        delete state.backoff;
        return { result: undefined, write: true };
      });
    } catch (error) {
      // A missed reset only keeps the next pause longer, so it must not fail a page that answered.
      this.warn(
        `could not reset the ${key} backoff (${(error as Error)?.message ?? error}); its next pause starts from the recorded level`,
      );
    }
  }

  /** When this exact host's pause ends, or undefined when it is not paused. One stat on a cache hit. */
  pausedUntil(host: string): Date | undefined {
    const key = host ? machineHostBudgetKey(host) : '';
    if (!key || this.isBypassed()) return undefined;
    const until = this.activePauseMs(key);
    return until === undefined ? undefined : new Date(until);
  }

  backoffState(host: string): HostBackoffState | undefined {
    const key = host ? machineHostBudgetKey(host) : '';
    if (!key || this.isBypassed()) return undefined;
    const { record, failClosed } = this.readBackoff(key);
    if (failClosed) {
      const now = this.now();
      return {
        level: 0,
        pausedUntil: new Date(now + MACHINE_HOST_CORRUPT_STATE_PAUSE_MS),
        lastStatus: NO_HTTP_STATUS,
        since: new Date(now),
      };
    }
    if (!record) return undefined;
    return {
      level: record.level,
      pausedUntil: new Date(record.pausedUntil),
      lastStatus: record.lastStatus,
      since: new Date(record.since),
    };
  }

  private activePauseMs(key: string): number | undefined {
    const { record, failClosed } = this.readBackoff(key);
    const now = this.now();
    if (failClosed) return now + MACHINE_HOST_CORRUPT_STATE_PAUSE_MS;
    return record && record.pausedUntil > now ? record.pausedUntil : undefined;
  }

  // A corrupt file reads as paused, so the first acquire repairs it under the lock (recording the
  // corruption pause in the file) before deciding whether to wait or fail fast.
  private async waitOutShortPause(key: string): Promise<void> {
    let repaired = false;
    for (;;) {
      if (!repaired && this.readBackoff(key).failClosed) {
        repaired = true;
        await this.transact(key, () => ({ result: undefined, write: false }));
        continue;
      }
      const until = this.activePauseMs(key);
      if (until === undefined) return;
      const remaining = until - this.now();
      if (remaining <= 0) return;
      if (remaining > this.inlinePauseWaitMs) {
        throw new HostPausedError({ host: key, until: new Date(until) });
      }
      await this.sleep(remaining);
    }
  }

  // The state file is replaced by rename, so a new inode marks every write from any process.
  private readBackoff(key: string): BackoffRead {
    if (!this.enabled)
      return { failClosed: false, record: this.processLocalState.get(key)?.backoff };
    const target = this.statePath(key);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return FAIL_CLOSED;
      this.backoffCache.delete(key);
      return NOTHING_RECORDED;
    }
    const cached = this.backoffCache.get(key);
    if (
      cached &&
      cached.ino === stat.ino &&
      cached.mtimeMs === stat.mtimeMs &&
      cached.size === stat.size
    ) {
      return cached;
    }
    let raw: string;
    try {
      raw = fs.readFileSync(target, 'utf8');
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ENOENT' ? NOTHING_RECORDED : FAIL_CLOSED;
    }
    const parsed = parseState(raw, key);
    const entry: CachedBackoff = {
      ino: stat.ino,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      record: parsed?.backoff,
      failClosed: !parsed,
    };
    this.backoffCache.set(key, entry);
    return entry;
  }

  private async stampSpacing(key: string, budget: HostThrottle): Promise<SpacingStamp> {
    for (;;) {
      const outcome = await this.transact<SpacingOutcome>(key, (state, now) => {
        const gap = spacingAnchor(state, budget) + budget.minIntervalMs - now;
        if (gap > 0) return { result: { remaining: gap }, write: false };
        const stamp: SpacingStamp = { priorLastGrantAt: state.lastGrantAt, stampedAt: now };
        state.lastGrantAt = now;
        return { result: { stamp }, write: true };
      });
      if ('stamp' in outcome) {
        grantObserver?.(key, outcome.stamp.stampedAt);
        return outcome.stamp;
      }
      await this.sleep(outcome.remaining);
    }
  }

  forgetProcessLocalStateForTests(): void {
    this.processLocalState.clear();
    this.backoffCache.clear();
  }

  /** Reads one host's state as the budget sees it, for tests and operator inspection. */
  readState(host: string): MachineHostBudgetState | undefined {
    const key = machineHostBudgetKey(host);
    try {
      return parseState(fs.readFileSync(this.statePath(key), 'utf8'), key);
    } catch {
      return undefined;
    }
  }

  statePath(host: string): string {
    return path.join(this.directory, `${this.fileStem(host)}.json`);
  }

  private async reserve(key: string, id: string, budget: HostThrottle): Promise<HostReservation> {
    const deadline = this.now() + this.acquireTimeoutMs;
    for (;;) {
      const reservation = await this.transact<HostReservation | undefined>(key, (state, now) => {
        if (state.slots.length >= budget.concurrency) return { result: undefined, write: false };
        const at = Math.max(now, state.nextGrantAt);
        state.slots.push({
          id,
          pid: this.pid,
          grantedAt: at,
          expiresAt: at + MACHINE_HOST_SLOT_TTL_MS,
        });
        const priorNextGrantAt = state.nextGrantAt;
        state.nextGrantAt = at + budget.minIntervalMs;
        return {
          result: { at, priorNextGrantAt, nextGrantAt: state.nextGrantAt },
          write: true,
        };
      });
      if (reservation !== undefined) return reservation;
      if (this.now() >= deadline) throw new HostSlotWaitTimeoutError(key, this.acquireTimeoutMs);
      await this.sleep(jittered(CAPACITY_POLL_MS, CAPACITY_POLL_JITTER_MS));
    }
  }

  /**
   * Hands the slot back. With a refund the request never reached the host (a local cache answered),
   * so this also gives back the spacing that grant reserved, and leaves `lastReleaseAt` alone: a
   * one-at-a-time host spaces from the later of the last grant and the last response, and a replay
   * is neither. The restore is conditional, so a grant that has already moved on keeps its spacing.
   */
  private async releaseSlot(key: string, id: string, refund?: SpacingRefund): Promise<void> {
    try {
      await this.transact(key, (state, now) => {
        const before = state.slots.length;
        state.slots = state.slots.filter((slot) => slot.id !== id);
        const removed = state.slots.length !== before;
        if (refund) {
          if (state.lastGrantAt === refund.stamp.stampedAt) {
            state.lastGrantAt = refund.stamp.priorLastGrantAt;
          }
          if (state.nextGrantAt === refund.reservation.nextGrantAt) {
            state.nextGrantAt = refund.reservation.priorNextGrantAt;
          }
          return { result: undefined, write: true };
        }
        if (!removed) return { result: undefined, write: false };
        state.lastReleaseAt = now;
        return { result: undefined, write: true };
      });
    } catch (error) {
      this.warn(
        `could not hand back a ${key} slot (${(error as Error)?.message ?? error}); it frees itself when this process exits or the slot expires`,
      );
    }
  }

  private async transact<T>(
    key: string,
    mutate: (state: MachineHostBudgetState, now: number) => Mutation<T>,
  ): Promise<T> {
    if (!this.enabled) return this.transactProcessLocal(key, mutate);
    let unavailableSince: number | undefined;
    for (;;) {
      let outcome: T | typeof BUSY;
      try {
        outcome = this.transactOnce(key, mutate);
      } catch (error) {
        if (typeof (error as NodeJS.ErrnoException)?.code !== 'string') throw error;
        unavailableSince ??= this.now();
        if (this.now() - unavailableSince >= this.unavailableTimeoutMs) {
          throw new HostBudgetUnavailableError(key, this.directory, error);
        }
        await this.sleep(UNAVAILABLE_RETRY_MS);
        continue;
      }
      if (outcome !== BUSY) return outcome;
      await this.sleep(jittered(LOCK_RETRY_MS, LOCK_RETRY_JITTER_MS));
    }
  }

  // An opted-out process (every hermetic test sets SCRAPER_MACHINE_HOST_SLOTS=off) keeps its
  // backoff to itself, so it can never pause a host for a live scrape on the same machine.
  private transactProcessLocal<T>(
    key: string,
    mutate: (state: MachineHostBudgetState, now: number) => Mutation<T>,
  ): T {
    const state = this.processLocalState.get(key) ?? freshState(key);
    const { result } = mutate(state, this.now());
    this.processLocalState.set(key, state);
    return result;
  }

  private transactOnce<T>(
    key: string,
    mutate: (state: MachineHostBudgetState, now: number) => Mutation<T>,
  ): T | typeof BUSY {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const lockPath = path.join(this.directory, `${this.fileStem(key)}.lock`);
    const token = `${this.pid}-${randomUUID()}`;
    if (
      !this.tryLock(lockPath, token) &&
      !(this.breakLockIfStale(lockPath) && this.tryLock(lockPath, token))
    ) {
      return BUSY;
    }
    try {
      const now = this.now();
      const { state, repaired } = this.readForUpdate(key, now);
      const before = state.slots.length;
      state.slots = state.slots.filter(
        (slot) => slot.expiresAt > now && (slot.pid === this.pid || this.isAlive(slot.pid)),
      );
      const { result, write } = mutate(state, now);
      if (write || repaired || state.slots.length !== before) this.writeState(key, state);
      return result;
    } finally {
      this.unlockIfOurs(lockPath, token);
    }
  }

  private readForUpdate(
    key: string,
    now: number,
  ): { state: MachineHostBudgetState; repaired: boolean } {
    let raw: string;
    try {
      raw = fs.readFileSync(this.statePath(key), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { state: freshState(key), repaired: false };
      }
      throw error;
    }
    const parsed = parseState(raw, key);
    if (parsed) return { state: parsed, repaired: false };
    this.warn(
      `${this.statePath(key)} is unreadable, so ${key} is paused for ${MACHINE_HOST_CORRUPT_STATE_PAUSE_MS / 1000} s and its budget starts again`,
    );
    const pausedUntil = now + MACHINE_HOST_CORRUPT_STATE_PAUSE_MS;
    const state = freshState(key, pausedUntil);
    state.backoff = {
      level: 0,
      pausedUntil,
      lastStatus: NO_HTTP_STATUS,
      since: now,
      lastBackoffAt: now,
    };
    return { state, repaired: true };
  }

  private writeState(key: string, state: MachineHostBudgetState): void {
    const target = this.statePath(key);
    const temporary = `${target}.${this.pid}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
      fs.renameSync(temporary, target);
    } catch (error) {
      fs.rmSync(temporary, { force: true });
      throw error;
    } finally {
      this.backoffCache.delete(key);
    }
  }

  private tryLock(lockPath: string, token: string): boolean {
    try {
      fs.writeFileSync(lockPath, JSON.stringify({ pid: this.pid, token }), {
        flag: 'wx',
        mode: 0o600,
      });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw error;
    }
  }

  // Breaking a lock by rename is atomic, so two processes that both judged it stale cannot each
  // delete the other's fresh lock; whoever moved a lock it did not judge puts it back.
  private breakLockIfStale(lockPath: string): boolean {
    let raw: string;
    let ageMs: number;
    try {
      raw = fs.readFileSync(lockPath, 'utf8');
      ageMs = Date.now() - fs.statSync(lockPath).mtimeMs;
    } catch {
      return true;
    }
    let holder: number | undefined;
    try {
      const pid = (JSON.parse(raw) as { pid?: unknown }).pid;
      holder = Number.isInteger(pid) ? (pid as number) : undefined;
    } catch {
      holder = undefined;
    }
    const stale =
      ageMs > MACHINE_HOST_LOCK_STALE_MS ||
      (holder !== undefined && holder !== this.pid && !this.isAlive(holder));
    if (!stale) return false;
    const moved = `${lockPath}.${this.pid}.${randomUUID()}.stale`;
    try {
      fs.renameSync(lockPath, moved);
    } catch {
      return true;
    }
    try {
      if (fs.readFileSync(moved, 'utf8') !== raw) {
        try {
          fs.linkSync(moved, lockPath);
        } catch {
          // A newer lock already exists, so the one moved aside is obsolete either way.
        }
      }
    } finally {
      fs.rmSync(moved, { force: true });
    }
    return true;
  }

  private unlockIfOurs(lockPath: string, token: string): void {
    try {
      const raw = fs.readFileSync(lockPath, 'utf8');
      if ((JSON.parse(raw) as { token?: unknown }).token === token) fs.rmSync(lockPath);
    } catch {
      // Already broken as stale by another process; nothing of ours is left to remove.
    }
  }

  private fileStem(host: string): string {
    return host.replace(/[^a-z0-9.-]/g, '_');
  }

  private logOptOut(): void {
    if (this.optOutLogged) return;
    this.optOutLogged = true;
    this.warn(
      `${MACHINE_HOST_SLOTS_ENV}=off: this process sends without the machine-wide per-host budget`,
    );
  }
}

let sharedBudget: MachineHostBudgetLimiter | undefined;
let sharedClock: (() => number) | undefined;
let sharedRandom: (() => number) | undefined;

/** The one budget instance per process, so the pause cache and the slots share one view. */
export function sharedMachineHostBudget(): MachineHostBudgetLimiter {
  sharedBudget ??= new MachineHostBudgetLimiter({
    isBypassed: isBenchmarkReplayActive,
    now: () => (sharedClock ?? Date.now)(),
    random: () => (sharedRandom ?? Math.random)(),
  });
  return sharedBudget;
}

export function setSharedMachineHostBudgetForTests(overrides: {
  now?: () => number;
  random?: () => number;
}): void {
  if (overrides.now) sharedClock = overrides.now;
  if (overrides.random) sharedRandom = overrides.random;
}

export function resetSharedMachineHostBudgetForTests(): void {
  sharedClock = undefined;
  sharedRandom = undefined;
  sharedBudget?.forgetProcessLocalStateForTests();
}

export function recordHostBackoff(
  host: string,
  verdict: HostBackoffVerdict,
): Promise<Date | undefined> {
  return sharedMachineHostBudget().recordBackoff(host, verdict);
}

export function recordHostSuccess(host: string): Promise<void> {
  return sharedMachineHostBudget().recordSuccess(host);
}

export function hostPausedUntil(host: string): Date | undefined {
  return sharedMachineHostBudget().pausedUntil(host);
}

export function hostBackoffState(host: string): HostBackoffState | undefined {
  return sharedMachineHostBudget().backoffState(host);
}

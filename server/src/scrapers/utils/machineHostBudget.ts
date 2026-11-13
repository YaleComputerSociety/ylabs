import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { isExcludedHostname, normalizeExcludedHost } from '../../utils/excludedHosts';
import {
  DEFAULT_PER_HOST_CONCURRENCY,
  HOST_SLOT_WAIT_TIMEOUT_MS,
  HOST_THROTTLE_OVERRIDES,
  HostSlotWaitTimeoutError,
  YALE_HOST_DEFAULT_THROTTLE,
  type HostSlotLimiter,
  type HostSlotRelease,
  type HostThrottle,
} from './hostConcurrencyLimiter';

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

export interface MachineHostBudgetState {
  v: typeof STATE_VERSION;
  host: string;
  nextGrantAt: number;
  lastGrantAt: number;
  lastReleaseAt?: number;
  slots: MachineHostBudgetSlot[];
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
      parsed.slots.every(isSlot);
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
}

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
    const id = `${this.pid}-${randomUUID()}`;
    const grantAt = await this.reserve(key, id, budget);
    let releaseInner: HostSlotRelease | undefined;
    try {
      await this.sleep(grantAt - this.now());
      releaseInner = await acquireInner();
      await this.stampSpacing(key, budget);
    } catch (error) {
      releaseInner?.();
      await this.releaseSlot(key, id);
      throw error;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      releaseInner?.();
      void this.releaseSlot(key, id);
    };
  }

  private async stampSpacing(key: string, budget: HostThrottle): Promise<void> {
    for (;;) {
      const remaining = await this.transact(key, (state, now) => {
        const gap = spacingAnchor(state, budget) + budget.minIntervalMs - now;
        if (gap > 0) return { result: gap, write: false };
        state.lastGrantAt = now;
        return { result: 0, write: true };
      });
      if (remaining <= 0) return;
      await this.sleep(remaining);
    }
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

  private async reserve(key: string, id: string, budget: HostThrottle): Promise<number> {
    const deadline = this.now() + this.acquireTimeoutMs;
    for (;;) {
      const grantAt = await this.transact(key, (state, now) => {
        if (state.slots.length >= budget.concurrency) return { result: undefined, write: false };
        const at = Math.max(now, state.nextGrantAt);
        state.slots.push({
          id,
          pid: this.pid,
          grantedAt: at,
          expiresAt: at + MACHINE_HOST_SLOT_TTL_MS,
        });
        state.nextGrantAt = at + budget.minIntervalMs;
        return { result: at, write: true };
      });
      if (grantAt !== undefined) return grantAt;
      if (this.now() >= deadline) throw new HostSlotWaitTimeoutError(key, this.acquireTimeoutMs);
      await this.sleep(jittered(CAPACITY_POLL_MS, CAPACITY_POLL_JITTER_MS));
    }
  }

  private async releaseSlot(key: string, id: string): Promise<void> {
    try {
      await this.transact(key, (state, now) => {
        const before = state.slots.length;
        state.slots = state.slots.filter((slot) => slot.id !== id);
        if (state.slots.length === before) return { result: undefined, write: false };
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
    return { state: freshState(key, now + MACHINE_HOST_CORRUPT_STATE_PAUSE_MS), repaired: true };
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

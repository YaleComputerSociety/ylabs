import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { lineReader, writeLine as send } from './brokerWire';
import {
  DEFAULT_PER_HOST_CONCURRENCY,
  HostConcurrencyLimiter,
  type HostSlotLimiter,
  type HostSlotRelease,
} from './hostConcurrencyLimiter';
import { brokerSocketPath, HostSlotBroker, type BrokerMessage } from './hostSlotBroker';

export const MACHINE_HOST_SLOTS_ENV = 'SCRAPER_MACHINE_HOST_SLOTS';
export const MACHINE_HOST_SLOT_DIR_ENV = 'SCRAPER_MACHINE_HOST_SLOT_DIR';
export const MACHINE_HOST_SLOT_ACQUIRE_TIMEOUT_ENV = 'SCRAPER_HOST_SLOT_ACQUIRE_TIMEOUT_MS';

export const DEFAULT_MACHINE_ACQUIRE_TIMEOUT_MS = 180_000;
export const DEFAULT_MACHINE_WEDGE_TIMEOUT_MS = 15_000;
export const DEFAULT_MACHINE_JOIN_TIMEOUT_MS = 3_000;
export const DEFAULT_MACHINE_FALLBACK_COOL_OFF_MS = 30_000;
const CONNECT_TIMEOUT_MS = 1_000;
const JOIN_RETRY_MS = 50;
const PING_INTERVAL_MS = 2_000;
const LOCK_GRACE_MS = 5_000;
const TAKEOVER_GRACE_MS = 10 * JOIN_RETRY_MS;

export interface MachineHostSlotPaths {
  socketPath: string;
  lockPath: string;
}

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
// sandboxes on one machine and a per-TMPDIR broker would split the budget it exists to share.
function defaultBrokerDirectory(env: NodeJS.ProcessEnv): string {
  const cacheRoot = env.XDG_CACHE_HOME?.trim() || path.join(os.homedir(), '.cache');
  return path.join(cacheRoot, 'ylabs');
}

export function machineHostSlotPaths(env: NodeJS.ProcessEnv = process.env): MachineHostSlotPaths {
  const directory = env[MACHINE_HOST_SLOT_DIR_ENV]?.trim() || defaultBrokerDirectory(env);
  const socketPath = brokerSocketPath(`ylabs-machine-host-slots-${userTag()}.sock`, directory);
  return {
    socketPath,
    lockPath: path.join(path.dirname(socketPath), `ylabs-machine-host-slots-${userTag()}.lock`),
  };
}

function resolveAcquireTimeoutMs(env: NodeJS.ProcessEnv): number {
  const raw = Number(env[MACHINE_HOST_SLOT_ACQUIRE_TIMEOUT_ENV]);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MACHINE_ACQUIRE_TIMEOUT_MS;
}

interface LockRecord {
  pid: number;
  token: string;
}

function readLock(lockPath: string): { raw: string; record?: LockRecord; ageMs: number } | null {
  try {
    const raw = fs.readFileSync(lockPath, 'utf8');
    const ageMs = Date.now() - fs.statSync(lockPath).mtimeMs;
    try {
      const parsed = JSON.parse(raw) as LockRecord;
      return Number.isInteger(parsed?.pid) ? { raw, record: parsed, ageMs } : { raw, ageMs };
    } catch {
      return { raw, ageMs };
    }
  } catch {
    return null;
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function isStaleLock(lock: { record?: LockRecord; ageMs: number }): boolean {
  if (!lock.record) return lock.ageMs > LOCK_GRACE_MS;
  if (!isProcessAlive(lock.record.pid)) return true;
  // Reached only after the socket refused a connection: a live broker listens within moments
  // of taking the lock, so a lock this old with nothing listening belongs to a reused pid.
  return lock.ageMs > LOCK_GRACE_MS;
}

function tryCreateLock(lockPath: string, record: LockRecord): boolean {
  try {
    fs.writeFileSync(lockPath, JSON.stringify(record), { flag: 'wx', mode: 0o600 });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
}

// Breaking a lock by rename is atomic, so two processes that both judged it stale cannot each
// delete the other's fresh lock; whoever renamed a lock it did not judge puts it back.
export function breakStaleLock(lockPath: string, observedRaw: string): void {
  const moved = `${lockPath}.${process.pid}.${Math.random().toString(36).slice(2)}.stale`;
  try {
    fs.renameSync(lockPath, moved);
  } catch {
    return;
  }
  try {
    if (fs.readFileSync(moved, 'utf8') !== observedRaw) {
      try {
        fs.linkSync(moved, lockPath);
      } catch {
        // A newer lock already exists, so the one moved aside is obsolete either way.
      }
    }
  } finally {
    fs.rmSync(moved, { force: true });
  }
}

function connectOnce(socketPath: string): Promise<net.Socket | null> {
  return new Promise((resolve) => {
    const socket = net.createConnection(socketPath);
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(null);
    }, CONNECT_TIMEOUT_MS);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(null);
    });
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Lease {
  id: number;
  host: string;
  release: HostSlotRelease;
}

interface PendingAcquire {
  id: number;
  host: string;
  resolve: (release: HostSlotRelease) => void;
  timer?: NodeJS.Timeout;
}

interface AdoptingSlotLimiter extends HostSlotLimiter {
  adopt(host: string): HostSlotRelease;
}

// A new broker starts from zero, and the other clients of the one it replaces reconnect and
// re-register their in-flight slots a few join retries later, so it grants nothing new until
// they have had that long; adopting a held slot is never delayed.
function grantingAfterTakeoverGrace(limiter: HostConcurrencyLimiter): AdoptingSlotLimiter {
  const graceOver = sleep(TAKEOVER_GRACE_MS);
  return {
    acquire: async (host) => {
      await graceOver;
      return limiter.acquire(host);
    },
    adopt: (host) => limiter.adopt(host),
  };
}

interface Hosted {
  kind: 'host';
  broker: HostSlotBroker;
  limiter: AdoptingSlotLimiter;
  token: string;
}

interface Joined {
  kind: 'client';
  socket: net.Socket;
  awaitingPongSince?: number;
  pinger: NodeJS.Timeout;
}

export interface MachineHostSlotLimiterOptions {
  env?: NodeJS.ProcessEnv;
  paths?: MachineHostSlotPaths;
  acquireTimeoutMs?: number;
  wedgeTimeoutMs?: number;
  joinTimeoutMs?: number;
  fallbackCoolOffMs?: number;
  isBypassed?: () => boolean;
  warn?: (message: string) => void;
}

export type MachineHostSlotRole = 'idle' | 'host' | 'client' | 'fallback';

export class MachineHostSlotLimiter implements HostSlotLimiter {
  private readonly paths: MachineHostSlotPaths;
  private readonly enabled: boolean;
  private readonly acquireTimeoutMs: number;
  private readonly wedgeTimeoutMs: number;
  private readonly joinTimeoutMs: number;
  private readonly fallbackCoolOffMs: number;
  private readonly isBypassed: () => boolean;
  private readonly warn: (message: string) => void;
  private link?: Hosted | Joined;
  private joining?: Promise<void>;
  private fallbackUntil = 0;
  private nextId = 1;
  private closed = false;
  private readonly leases = new Map<number, Lease>();
  private readonly pending = new Map<number, PendingAcquire>();
  private exitHookInstalled = false;

  constructor(options: MachineHostSlotLimiterOptions = {}) {
    const env = options.env ?? process.env;
    this.paths = options.paths ?? machineHostSlotPaths(env);
    this.enabled = isMachineHostSlotSharingEnabled(env);
    this.acquireTimeoutMs = options.acquireTimeoutMs ?? resolveAcquireTimeoutMs(env);
    this.wedgeTimeoutMs = options.wedgeTimeoutMs ?? DEFAULT_MACHINE_WEDGE_TIMEOUT_MS;
    this.joinTimeoutMs = options.joinTimeoutMs ?? DEFAULT_MACHINE_JOIN_TIMEOUT_MS;
    this.fallbackCoolOffMs = options.fallbackCoolOffMs ?? DEFAULT_MACHINE_FALLBACK_COOL_OFF_MS;
    this.isBypassed = options.isBypassed ?? (() => false);
    this.warn =
      options.warn ??
      ((message) =>
        console.warn(`[host-slots] ${message}; using this process's own per-host cap meanwhile`));
  }

  get role(): MachineHostSlotRole {
    if (this.link) return this.link.kind;
    return Date.now() < this.fallbackUntil ? 'fallback' : 'idle';
  }

  get socketPath(): string {
    return this.paths.socketPath;
  }

  async acquire(host: string): Promise<HostSlotRelease> {
    if (!this.enabled || this.closed || this.isBypassed()) return () => {};
    await this.ensureLinked();
    const id = this.nextId++;
    return new Promise<HostSlotRelease>((resolve) => {
      const waiter: PendingAcquire = { id, host, resolve };
      this.pending.set(id, waiter);
      waiter.timer = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        this.warn(`no machine-wide host slot for ${host} within ${this.acquireTimeoutMs} ms`);
        resolve(() => {});
        this.holdEventLoopWhileBusy();
      }, this.acquireTimeoutMs);
      this.dispatch(waiter);
    });
  }

  close(): void {
    this.closed = true;
    this.dropLink();
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.resolve(() => {});
    }
    this.pending.clear();
  }

  private ensureLinked(): Promise<void> {
    if (this.link || Date.now() < this.fallbackUntil) return Promise.resolve();
    this.joining ??= this.join().finally(() => {
      this.joining = undefined;
    });
    return this.joining;
  }

  private async join(): Promise<void> {
    const deadline = Date.now() + this.joinTimeoutMs;
    while (!this.closed && Date.now() < deadline) {
      const socket = await connectOnce(this.paths.socketPath);
      if (socket) {
        this.adoptClientLink(socket);
        return;
      }
      try {
        if (await this.tryBecomeHost()) return;
      } catch (error) {
        this.enterFallback(
          `could not start the machine-wide host slot broker at ${this.paths.socketPath} (${(error as Error).message})`,
        );
        return;
      }
      await sleep(JOIN_RETRY_MS);
    }
    if (!this.closed) {
      this.enterFallback(
        `could not reach or start the machine-wide host slot broker at ${this.paths.socketPath}`,
      );
    }
  }

  private async tryBecomeHost(): Promise<boolean> {
    const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    fs.mkdirSync(path.dirname(this.paths.lockPath), { recursive: true, mode: 0o700 });
    if (!tryCreateLock(this.paths.lockPath, { pid: process.pid, token })) {
      const lock = readLock(this.paths.lockPath);
      if (lock && isStaleLock(lock)) breakStaleLock(this.paths.lockPath, lock.raw);
      return false;
    }
    const limiter = grantingAfterTakeoverGrace(
      new HostConcurrencyLimiter(DEFAULT_PER_HOST_CONCURRENCY),
    );
    let broker: HostSlotBroker;
    try {
      broker = await HostSlotBroker.listen(this.paths.socketPath, limiter, { detached: true });
    } catch (error) {
      this.releaseLockIfOurs(token);
      throw error;
    }
    this.link = { kind: 'host', broker, limiter, token };
    this.installExitHook();
    this.reattach();
    return true;
  }

  private adoptClientLink(socket: net.Socket): void {
    const pinger = setInterval(() => this.checkLiveness(), PING_INTERVAL_MS);
    pinger.unref();
    const link: Joined = { kind: 'client', socket, pinger };
    this.link = link;
    socket.on(
      'data',
      lineReader((raw) => {
        link.awaitingPongSince = undefined;
        const message = raw as BrokerMessage;
        if (message?.t !== 'grant') return;
        this.onGrant(link, message.id);
      }),
    );
    socket.on('error', () => socket.destroy());
    socket.on('close', () => this.onClientLinkClosed(link));
    this.reattach();
  }

  private onGrant(link: Joined, id: number): void {
    const waiter = this.pending.get(id);
    if (!waiter) {
      send(link.socket, { t: 'release', id });
      return;
    }
    this.pending.delete(id);
    clearTimeout(waiter.timer);
    waiter.resolve(this.trackLease(id, waiter.host, () => send(link.socket, { t: 'release', id })));
  }

  private trackLease(id: number, host: string, release: HostSlotRelease): HostSlotRelease {
    const lease: Lease = { id, host, release };
    this.leases.set(id, lease);
    this.holdEventLoopWhileBusy();
    return () => {
      if (!this.leases.delete(id)) return;
      lease.release();
      this.holdEventLoopWhileBusy();
    };
  }

  private dispatch(waiter: PendingAcquire): void {
    const link = this.link;
    if (!link) {
      this.pending.delete(waiter.id);
      clearTimeout(waiter.timer);
      waiter.resolve(() => {});
      return;
    }
    if (link.kind === 'host') {
      void link.limiter.acquire(waiter.host).then((release) => {
        if (this.link !== link || !this.pending.delete(waiter.id)) {
          release();
          return;
        }
        clearTimeout(waiter.timer);
        waiter.resolve(this.trackLease(waiter.id, waiter.host, release));
      });
      return;
    }
    send(link.socket, { t: 'acquire', id: waiter.id, host: waiter.host });
    this.holdEventLoopWhileBusy();
  }

  // After a takeover the new broker starts from zero, so every request still in flight is
  // re-registered; the hosted limiter's takeover grace holds new grants until the other
  // clients have done the same.
  private reattach(): void {
    const link = this.link;
    if (!link) return;
    for (const lease of this.leases.values()) {
      if (link.kind === 'host') {
        lease.release = link.limiter.adopt(lease.host);
      } else {
        send(link.socket, { t: 'hold', id: lease.id, host: lease.host });
        lease.release = () => send(link.socket, { t: 'release', id: lease.id });
      }
    }
    for (const waiter of [...this.pending.values()]) this.dispatch(waiter);
  }

  private checkLiveness(): void {
    const link = this.link;
    if (link?.kind !== 'client' || (this.pending.size === 0 && this.leases.size === 0)) return;
    const now = Date.now();
    if (link.awaitingPongSince === undefined) {
      link.awaitingPongSince = now;
      send(link.socket, { t: 'ping' });
      return;
    }
    if (now - link.awaitingPongSince < this.wedgeTimeoutMs) return;
    this.dropLink();
    this.enterFallback(
      `machine-wide host slot broker at ${this.paths.socketPath} has not answered for ${now - link.awaitingPongSince} ms`,
    );
  }

  private onClientLinkClosed(link: Joined): void {
    if (this.link !== link) return;
    clearInterval(link.pinger);
    this.link = undefined;
    if (this.closed) return;
    for (const lease of this.leases.values()) lease.release = () => {};
    if (this.pending.size === 0 && this.leases.size === 0) return;
    void this.ensureLinked().then(() => {
      if (!this.link) this.releaseWaitersToFallback();
    });
  }

  private enterFallback(reason: string): void {
    this.fallbackUntil = Date.now() + this.fallbackCoolOffMs;
    this.warn(reason);
    this.releaseWaitersToFallback();
  }

  private releaseWaitersToFallback(): void {
    for (const lease of this.leases.values()) lease.release = () => {};
    const waiting = [...this.pending.values()];
    this.pending.clear();
    for (const waiter of waiting) {
      clearTimeout(waiter.timer);
      waiter.resolve(() => {});
    }
  }

  private dropLink(): void {
    const link = this.link;
    this.link = undefined;
    if (!link) return;
    if (link.kind === 'client') {
      clearInterval(link.pinger);
      link.socket.destroy();
      return;
    }
    this.closeHosted(link);
  }

  private closeHosted(link: Hosted): void {
    const ours = this.lockIsOurs(link.token);
    link.broker.closeSync({ keepSocketFile: !ours });
    if (ours) this.releaseLockIfOurs(link.token);
  }

  private lockIsOurs(token: string): boolean {
    return readLock(this.paths.lockPath)?.record?.token === token;
  }

  private releaseLockIfOurs(token: string): void {
    if (this.lockIsOurs(token)) fs.rmSync(this.paths.lockPath, { force: true });
  }

  private installExitHook(): void {
    if (this.exitHookInstalled) return;
    this.exitHookInstalled = true;
    process.once('exit', () => {
      if (this.link?.kind === 'host') this.closeHosted(this.link);
    });
  }

  private holdEventLoopWhileBusy(): void {
    const link = this.link;
    if (link?.kind !== 'client') return;
    if (this.pending.size > 0 || this.leases.size > 0) link.socket.ref();
    else link.socket.unref();
  }
}

import { normalizeExcludedHost } from '../../utils/excludedHosts';

export const HOST_BACKOFF_BASE_MS = 30_000;
export const HOST_BACKOFF_CAP_MS = 60 * 60_000;
export const HOST_BACKOFF_QUIET_RESET_MS = 10 * 60_000;
export const HOST_BACKOFF_JITTER_RATIO = 0.1;

export interface HostBackoffState {
  level: number;
  pausedUntil: Date;
  lastStatus: number;
  since: Date;
}

export interface HostBackoffSignal {
  status: number;
  retryAfterMs?: number;
  statedUntil?: Date;
}

interface StoredHostBackoff extends HostBackoffState {
  lastBackoffAt: Date;
}

/**
 * The one per-host pause record every fetch path reads. Process-local here; #6168 replaces this
 * module's body with the machine-wide per-host file, so the signatures are the contract.
 */
const states = new Map<string, StoredHostBackoff>();

let clock: () => Date = () => new Date();
let random: () => number = Math.random;

const keyOf = (host: string): string => normalizeExcludedHost(host);

const jittered = (ms: number): number =>
  Math.round(ms * (1 + (random() * 2 - 1) * HOST_BACKOFF_JITTER_RATIO));

/**
 * How long the host has gone without a refusal, counted from the end of its pause: a paused host
 * is sent nothing, so the time spent paused is not time it answered cleanly.
 */
const quietSince = (known: StoredHostBackoff, now: Date): number =>
  now.getTime() - Math.max(known.lastBackoffAt.getTime(), known.pausedUntil.getTime());

/**
 * Records that a host refused: the pause doubles from 30 s with each refusal, capped at an hour,
 * and runs at least as long as a Retry-After, or to the date the site itself stated, even past
 * the cap. A pause is never shortened, and ten clean minutes after the pause ends start the
 * doubling again from the base.
 */
export function recordHostBackoff(host: string, signal: HostBackoffSignal): HostBackoffState {
  const key = keyOf(host);
  const now = clock();
  const known = states.get(key);
  const quiet = !known || quietSince(known, now) >= HOST_BACKOFF_QUIET_RESET_MS;
  const level = quiet ? 0 : known.level + 1;
  const backoffMs = jittered(Math.min(HOST_BACKOFF_CAP_MS, HOST_BACKOFF_BASE_MS * 2 ** level));
  const candidates = [
    now.getTime() + Math.max(backoffMs, signal.retryAfterMs ?? 0),
    signal.statedUntil?.getTime() ?? 0,
    known?.pausedUntil.getTime() ?? 0,
  ];
  const state: StoredHostBackoff = {
    level,
    pausedUntil: new Date(Math.max(...candidates)),
    lastStatus: signal.status,
    since: quiet ? now : known.since,
    lastBackoffAt: now,
  };
  states.set(key, state);
  return publicState(state);
}

/** A success never ends an active pause; it only lets the doubling restart once the host is quiet. */
export function recordHostSuccess(host: string): void {
  const key = keyOf(host);
  const known = states.get(key);
  if (!known) return;
  const now = clock();
  if (known.pausedUntil > now) return;
  if (quietSince(known, now) >= HOST_BACKOFF_QUIET_RESET_MS) states.delete(key);
}

export function hostPausedUntil(host: string): Date | undefined {
  const known = states.get(keyOf(host));
  return known && known.pausedUntil > clock() ? known.pausedUntil : undefined;
}

export function hostBackoffState(host: string): HostBackoffState | undefined {
  const known = states.get(keyOf(host));
  return known ? publicState(known) : undefined;
}

function publicState({
  level,
  pausedUntil,
  lastStatus,
  since,
}: StoredHostBackoff): HostBackoffState {
  return { level, pausedUntil, lastStatus, since };
}

export function setHostPauseStateForTests(overrides: {
  now?: () => Date;
  random?: () => number;
}): void {
  if (overrides.now) clock = overrides.now;
  if (overrides.random) random = overrides.random;
}

export function resetHostPauseStateForTests(): void {
  states.clear();
  clock = () => new Date();
  random = Math.random;
}

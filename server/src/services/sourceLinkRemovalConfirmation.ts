import {
  CONNECTION_FAILURE_CONFIRMATION_GAP_MS,
  RESOURCE_GONE_HTTP_STATUS_CODES,
  type SourceLinkHealth,
} from './sourceLinkHealth';

export type RemovalBasis = 'gone-status' | 'name-absent' | 'connection-refused';

export type RemovalHoldReason =
  | 'no-stored-verdict'
  | 'stored-not-gone'
  | 'probe-disagrees'
  | 'too-soon'
  | 'private-address'
  | 'class-unknown';

export type RemovalConfirmation =
  { confirmed: true; basis: RemovalBasis } | { confirmed: false; reason: RemovalHoldReason };

export interface StoredRemovalVerdict {
  healthStatus?: unknown;
  httpStatusCode?: unknown;
  privateAddressHost?: unknown;
  confirmingConnectionFailureAt?: unknown;
  connectionLevelFailure?: unknown;
  nameNotFound?: unknown;
  checkedAt?: unknown;
}

type HostLevelClass = 'name-absent' | 'connection-refused';

const instantOf = (value: unknown): number | undefined => {
  if (!value) return undefined;
  const instant = (value instanceof Date ? value : new Date(value as string)).getTime();
  return Number.isFinite(instant) ? instant : undefined;
};

const isGoneStatus = (status: unknown): boolean =>
  typeof status === 'number' && RESOURCE_GONE_HTTP_STATUS_CODES.has(status);

/**
 * A stored status-less `UNAVAILABLE` is one of two host facts, and each is recorded
 * positively: `connectionLevelFailure` (or, on an older verdict, the
 * `confirmingConnectionFailureAt` marker #6116 leaves) for a refused connection, and
 * `nameNotFound` for a DNS record confirmed absent. A verdict written before either field
 * existed carries neither, and #6116 records a refused connection with no marker when the
 * verdict it replaced was not live, so its class cannot be inferred from the absence of a
 * marker; it waits for the next sweep to record one.
 */
function storedHostLevelClass(stored: StoredRemovalVerdict): HostLevelClass | undefined {
  if (stored.connectionLevelFailure === true || stored.confirmingConnectionFailureAt) {
    return 'connection-refused';
  }
  return stored.nameNotFound === true ? 'name-absent' : undefined;
}

function freshHostLevelClass(fresh: SourceLinkHealth): HostLevelClass | undefined {
  if (fresh.connectionLevelFailure) return 'connection-refused';
  return fresh.nameNotFound ? 'name-absent' : undefined;
}

/**
 * Whether a stored verdict and a fresh probe together license removing a value (#6264,
 * docs/decisions.md 2026-11-14). The gone-twice contract (#4729, #4840) needs both to
 * say gone: a `404` or `410` from each, or, for a host-level failure, the same class of
 * failure from each at least `CONNECTION_FAILURE_CONFIRMATION_GAP_MS` apart. A probe that
 * observed nothing classifies `UNKNOWN`, so it never agrees, and a host that resolves
 * only into private address space never counts, because on a campus network that is a
 * fact about where the probe ran rather than about the host (#6123).
 */
export function removalConfirmation(
  stored: StoredRemovalVerdict | undefined,
  fresh: SourceLinkHealth,
  freshAt: Date,
): RemovalConfirmation {
  if (!stored) return { confirmed: false, reason: 'no-stored-verdict' };
  if (stored.healthStatus !== 'UNAVAILABLE') return { confirmed: false, reason: 'stored-not-gone' };
  if (stored.privateAddressHost === true || fresh.privateAddressHost === true) {
    return { confirmed: false, reason: 'private-address' };
  }
  if (fresh.healthStatus !== 'UNAVAILABLE') return { confirmed: false, reason: 'probe-disagrees' };

  if (isGoneStatus(stored.httpStatusCode)) {
    return isGoneStatus(fresh.httpStatusCode)
      ? { confirmed: true, basis: 'gone-status' }
      : { confirmed: false, reason: 'probe-disagrees' };
  }
  if (typeof stored.httpStatusCode === 'number' || typeof fresh.httpStatusCode === 'number') {
    return { confirmed: false, reason: 'probe-disagrees' };
  }

  const storedClass = storedHostLevelClass(stored);
  const freshClass = freshHostLevelClass(fresh);
  if (!storedClass || !freshClass) return { confirmed: false, reason: 'class-unknown' };
  if (storedClass !== freshClass) {
    return { confirmed: false, reason: 'probe-disagrees' };
  }
  const storedAt = instantOf(stored.checkedAt);
  if (
    storedAt === undefined ||
    freshAt.getTime() - storedAt < CONNECTION_FAILURE_CONFIRMATION_GAP_MS
  ) {
    return { confirmed: false, reason: 'too-soon' };
  }
  return { confirmed: true, basis: storedClass };
}

export function removalHost(url: string): string {
  try {
    return new URL(url.trim()).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '(unparsable)';
  }
}

/**
 * Removals counted per host, so a run that retires many values because one domain lapsed
 * reports that domain as one line with its count rather than as many unrelated rows
 * (#6264, manager condition 3).
 */
export class RemovalsByHost<Basis extends string = RemovalBasis> {
  private readonly counts = new Map<string, Map<Basis, number>>();

  record(url: string, basis: Basis): void {
    const host = removalHost(url);
    const byBasis = this.counts.get(host) ?? new Map<Basis, number>();
    byBasis.set(basis, (byBasis.get(basis) ?? 0) + 1);
    this.counts.set(host, byBasis);
  }

  toReport(): Array<{
    host: string;
    count: number;
    byBasis: Partial<Record<Basis, number>>;
  }> {
    return [...this.counts]
      .map(([host, byBasis]) => ({
        host,
        count: [...byBasis.values()].reduce((sum, n) => sum + n, 0),
        byBasis: Object.fromEntries(byBasis) as Partial<Record<Basis, number>>,
      }))
      .sort((a, b) => b.count - a.count || a.host.localeCompare(b.host));
  }
}

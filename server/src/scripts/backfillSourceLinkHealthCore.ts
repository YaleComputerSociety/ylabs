import {
  isStaleSourceLinkHealth,
  sourceLinkHealthAgeDays,
  type DatedSourceLinkHealth,
  type SourceLinkHealthStatus,
} from '../services/sourceLinkHealth';

export interface SourceLinkHealthCandidateEntity {
  websiteUrl?: unknown;
  website?: unknown;
  sourceUrls?: unknown;
  /**
   * Required because `hasLiveSourceCitation` counts every `fieldProvenance.*.sourceUrl`
   * as a citation. This lane rewrites the whole `sourceLinkHealth` array, so any
   * citation it does not probe loses its verdict, and the gate then reads that
   * citation as possibly-live (#2666).
   */
  fieldProvenance?: unknown;
}

/**
 * Whether an entity's stored verdicts still prove anything, so a re-probe run can
 * skip the rows it would only confirm. An entity with no verdicts at all needs
 * probing, and one stale verdict is enough to re-probe the whole row because the
 * lane replaces the array rather than patching one entry.
 */
const storedCheckedAtInstants = (storedHealth: unknown): number[] => {
  if (!Array.isArray(storedHealth)) return [];
  return storedHealth
    .map((entry) => {
      const checkedAt = (entry as { checkedAt?: unknown })?.checkedAt;
      if (!checkedAt) return NaN;
      const parsed = checkedAt instanceof Date ? checkedAt : new Date(checkedAt as string);
      return parsed.getTime();
    })
    .filter((instant) => Number.isFinite(instant));
};

/**
 * Whether a row still needs re-probing given that every verdict written before
 * `cutoff` was decided under superseded rules.
 *
 * The freshness horizon cannot express this. When the rules change, the verdicts
 * that need re-deciding are the ones written before the change, not the ones
 * written long ago, and after the #2473 rule change the whole corpus was only
 * days old - so `--stale-only` reported every row as fresh and would have
 * skipped all of them. This predicate is also what makes an interrupted run
 * resumable: rows the killed run already re-probed carry a `checkedAt` at or
 * after the cutoff and are skipped, so a resume does not redo them.
 */
export function needsRecheckSince(storedHealth: unknown, cutoff: Date): boolean {
  const instants = storedCheckedAtInstants(storedHealth);
  if (instants.length === 0) return true;
  if (!Array.isArray(storedHealth) || instants.length < storedHealth.length) return true;
  return Math.max(...instants) < cutoff.getTime();
}

export function needsSourceLinkHealthRefresh(
  storedHealth: unknown,
  now: Date = new Date(),
): boolean {
  if (!Array.isArray(storedHealth) || storedHealth.length === 0) return true;
  return storedHealth.some((entry) => {
    const record = entry as { healthStatus?: unknown; checkedAt?: unknown };
    if (typeof record?.healthStatus !== 'string') return true;
    return isStaleSourceLinkHealth(
      {
        healthStatus: record.healthStatus as SourceLinkHealthStatus,
        checkedAt: record.checkedAt as DatedSourceLinkHealth['checkedAt'],
      },
      now,
    );
  });
}

const isHttpUrl = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * Unlike `sourceLinkHealthKey`, this keeps the scheme: each spelling is probed and
 * stored on its own, because on a host whose certificate fails `http:` answers while
 * `https:` stops a browser at a warning, and one merged probe let the `http:` result
 * speak for the `https:` link a student is sent to (#4080).
 */
export const sourceLinkCandidateKey = (url: string): string | null => {
  try {
    const parsed = new URL(url.trim());
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${parsed.protocol}//${host}${path}${parsed.search}`;
  } catch {
    return null;
  }
};

/** The plain-HTTP spelling of an `https:` URL, or null for any other URL. */
export const httpSpellingOf = (url: string): string | null => {
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== 'https:') return null;
    parsed.protocol = 'http:';
    return parsed.toString();
  } catch {
    return null;
  }
};

/**
 * The plain-HTTP spellings to probe because their `https:` twin failed certificate
 * verification and neither spelling of the twin is already a candidate. Serve time can
 * only offer a student the working spelling if that spelling carries its own verdict.
 */
export function tlsFallbackCandidates(
  candidates: readonly string[],
  freshHealth: ReadonlyMap<string, { tlsVerificationFailed?: boolean }>,
): string[] {
  const present = new Set(candidates.map((url) => sourceLinkCandidateKey(url)));
  const fallbacks: string[] = [];
  for (const url of candidates) {
    if (freshHealth.get(url)?.tlsVerificationFailed !== true) continue;
    const plain = httpSpellingOf(url);
    const key = plain ? sourceLinkCandidateKey(plain) : null;
    if (!plain || !key || present.has(key)) continue;
    present.add(key);
    fallbacks.push(plain);
  }
  return fallbacks;
}

/**
 * Every `sourceUrl` recorded in `fieldProvenance`. These are citations as far as
 * `hasLiveSourceCitation` is concerned, and a provenance URL can outlive its
 * presence in `sourceUrls`, so without this the lane can never re-probe it and a
 * full-array rewrite discards whatever verdict it once had.
 */
const fieldProvenanceSourceUrls = (fieldProvenance: unknown): unknown[] => {
  if (!fieldProvenance || typeof fieldProvenance !== 'object') return [];
  return Object.values(fieldProvenance as Record<string, unknown>).map((record) =>
    record && typeof record === 'object'
      ? (record as { sourceUrl?: unknown }).sourceUrl
      : undefined,
  );
};

export function collectSourceLinkHealthCandidates(
  entity: SourceLinkHealthCandidateEntity,
  extraUrls: readonly unknown[] = [],
): string[] {
  const rawValues: unknown[] = [
    entity.websiteUrl,
    entity.website,
    ...(Array.isArray(entity.sourceUrls) ? entity.sourceUrls : []),
    ...fieldProvenanceSourceUrls(entity.fieldProvenance),
    ...extraUrls,
  ];

  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const value of rawValues) {
    if (!isHttpUrl(value)) continue;
    const trimmed = value.trim();
    const key = sourceLinkCandidateKey(trimmed);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    candidates.push(trimmed);
  }
  return candidates;
}

export interface StoredSourceLinkHealthEntry {
  url: string;
  healthStatus: SourceLinkHealthStatus;
  httpStatusCode?: number;
  privateAddressHost?: boolean;
  tlsVerificationFailed?: boolean;
  checkedAt?: Date;
  lastAttemptedAt?: Date;
}

/**
 * Whether the stored entry should say this host resolves only into private space.
 *
 * A probe that came back with an HTTP status proves the host was publicly
 * routable at that moment, so the flag is dropped, and so does public DNS mapping
 * the host to public space, which is the only release a split-horizon host can
 * ever earn because our own resolver refuses it before any request (#3903). A probe that learned nothing
 * about addressing - a timeout, a transport error - keeps whatever was stored,
 * because a failed measurement must not release a link a student cannot open.
 * That asymmetry is the whole point: routing is a fact we only ever unlearn from
 * positive evidence (#2556).
 */
function privateAddressHostForEntry(
  fresh: { httpStatusCode?: number; privateAddressHost?: boolean; publicAddressHost?: boolean },
  stored: StoredSourceLinkHealthEntry | undefined,
): boolean | undefined {
  if (fresh.privateAddressHost) return true;
  if (fresh.publicAddressHost) return undefined;
  if (typeof fresh.httpStatusCode === 'number') return undefined;
  return stored?.privateAddressHost ? true : undefined;
}

/**
 * A verdict that asserts something about the resource, as opposed to reporting
 * that we failed to learn anything. `UNKNOWN` is the only status that asserts
 * nothing: it is what a 403, a 429, a 5xx, a timeout and an unconfirmed DNS
 * failure all produce.
 */
export function isDecisiveStoredVerdict(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const status = (entry as { healthStatus?: unknown }).healthStatus;
  return typeof status === 'string' && status !== 'UNKNOWN';
}

export function storedSourceLinkHealthByUrl(
  storedHealth: unknown,
): Map<string, StoredSourceLinkHealthEntry> {
  const index = new Map<string, StoredSourceLinkHealthEntry>();
  if (!Array.isArray(storedHealth)) return index;
  for (const entry of storedHealth) {
    const url = (entry as { url?: unknown })?.url;
    if (typeof url !== 'string' || !url) continue;
    index.set(url, entry as StoredSourceLinkHealthEntry);
  }
  return index;
}

export interface ResolvedSourceLinkHealthEntry {
  entry: StoredSourceLinkHealthEntry;
  preservedDecisiveVerdict: boolean;
}

/**
 * Decides what to store for one URL, given the fresh probe and whatever is
 * already recorded.
 *
 * An inconclusive fresh probe must not erase a decisive stored verdict. A
 * sustained 403 wave from one host downgraded 353 verdicts to `UNKNOWN` in a
 * single pass, 9 of them a correct `UNAVAILABLE` 404 and 2 of those on rows a
 * student can see; because serve-time suppression fires on `UNAVAILABLE`, the
 * pass un-suppressed pages that are genuinely gone (#2762). #2473 established
 * that a 403 must never retire a link, and it must equally never un-retire one.
 *
 * The preserved verdict deliberately keeps its ORIGINAL `checkedAt`. Renewing it
 * would let a host that always throttles us keep a `HEALTHY` verdict alive for
 * ever, which is the stale-HEALTHY hazard `SOURCE_LINK_HEALTH_FRESHNESS_DAYS`
 * exists to bound: an assertion is preserved, its warranty is not. `lastAttemptedAt`
 * records that we did try, so a preserved row is distinguishable from one nobody
 * has probed.
 */
export function resolveSourceLinkHealthEntry(
  url: string,
  fresh: {
    healthStatus: SourceLinkHealthStatus;
    httpStatusCode?: number;
    privateAddressHost?: boolean;
    publicAddressHost?: boolean;
    tlsVerificationFailed?: boolean;
  },
  stored: StoredSourceLinkHealthEntry | undefined,
  now: Date,
): ResolvedSourceLinkHealthEntry {
  const privateAddressHost = privateAddressHostForEntry(fresh, stored);
  const routing = {
    ...(privateAddressHost ? { privateAddressHost: true as const } : {}),
    ...(fresh.tlsVerificationFailed ? { tlsVerificationFailed: true as const } : {}),
  };
  const freshEntry: StoredSourceLinkHealthEntry = {
    url,
    healthStatus: fresh.healthStatus,
    ...(typeof fresh.httpStatusCode === 'number' ? { httpStatusCode: fresh.httpStatusCode } : {}),
    ...routing,
    checkedAt: now,
  };

  if (fresh.healthStatus !== 'UNKNOWN')
    return { entry: freshEntry, preservedDecisiveVerdict: false };
  if (!isDecisiveStoredVerdict(stored))
    return { entry: freshEntry, preservedDecisiveVerdict: false };
  // A certificate that fails verification contradicts a stored HEALTHY for this very
  // URL, so that verdict is not preserved: it was written by a probe that never
  // negotiated this spelling's TLS (#4080). A stored UNAVAILABLE still stands.
  if (fresh.tlsVerificationFailed && stored?.healthStatus === 'HEALTHY')
    return { entry: freshEntry, preservedDecisiveVerdict: false };

  const kept = stored as StoredSourceLinkHealthEntry;
  return {
    entry: {
      url,
      healthStatus: kept.healthStatus,
      ...(typeof kept.httpStatusCode === 'number' ? { httpStatusCode: kept.httpStatusCode } : {}),
      ...routing,
      ...(kept.checkedAt ? { checkedAt: kept.checkedAt } : {}),
      lastAttemptedAt: now,
    },
    preservedDecisiveVerdict: true,
  };
}

/**
 * How old a `HEALTHY` verdict may be before an unattended sweep probes the URL again.
 *
 * It must stay well inside `SOURCE_LINK_HEALTH_FRESHNESS_DAYS`, so a regularly swept
 * verdict never lapses into "unverified", and it is short because the gate and
 * `dead-research-website-clear` act on these verdicts: a site that dies is noticed
 * at most this many days late. Only `HEALTHY` earns the skip; every other verdict,
 * and every URL without one, is probed on every sweep (#3568).
 */
export const SOURCE_LINK_HEALTH_REPROBE_HEALTHY_AFTER_DAYS = 7;

export function storedSourceLinkHealthByCandidateKey(
  storedHealth: unknown,
): Map<string, StoredSourceLinkHealthEntry> {
  const index = new Map<string, StoredSourceLinkHealthEntry>();
  if (!Array.isArray(storedHealth)) return index;
  for (const entry of storedHealth) {
    const url = (entry as { url?: unknown })?.url;
    if (typeof url !== 'string' || !url) continue;
    const key = sourceLinkCandidateKey(url);
    if (key && !index.has(key)) index.set(key, entry as StoredSourceLinkHealthEntry);
  }
  return index;
}

export function isFreshHealthySourceLinkVerdict(
  stored: StoredSourceLinkHealthEntry | undefined,
  reprobeHealthyAfterDays: number,
  now: Date,
): boolean {
  if (stored?.healthStatus !== 'HEALTHY') return false;
  const ageDays = sourceLinkHealthAgeDays(stored, now);
  return ageDays !== undefined && ageDays >= 0 && ageDays <= reprobeHealthyAfterDays;
}

export interface SourceLinkReprobePlan {
  toProbe: string[];
  carried: Map<string, StoredSourceLinkHealthEntry>;
}

export function planSourceLinkReprobe(
  candidates: readonly string[],
  storedHealth: unknown,
  reprobeHealthyAfterDays: number,
  now: Date,
): SourceLinkReprobePlan {
  const storedByKey = storedSourceLinkHealthByCandidateKey(storedHealth);
  const toProbe: string[] = [];
  const carried = new Map<string, StoredSourceLinkHealthEntry>();
  for (const url of candidates) {
    const key = sourceLinkCandidateKey(url);
    const stored = key ? storedByKey.get(key) : undefined;
    if (isFreshHealthySourceLinkVerdict(stored, reprobeHealthyAfterDays, now)) {
      carried.set(url, stored as StoredSourceLinkHealthEntry);
    } else {
      toProbe.push(url);
    }
  }
  return { toProbe, carried };
}

export function carryForwardSourceLinkHealthEntry(
  url: string,
  stored: StoredSourceLinkHealthEntry,
): StoredSourceLinkHealthEntry {
  return {
    url,
    healthStatus: stored.healthStatus,
    ...(typeof stored.httpStatusCode === 'number' ? { httpStatusCode: stored.httpStatusCode } : {}),
    ...(stored.privateAddressHost === true ? { privateAddressHost: true } : {}),
    ...(stored.tlsVerificationFailed === true ? { tlsVerificationFailed: true } : {}),
    ...(stored.checkedAt ? { checkedAt: stored.checkedAt } : {}),
    ...(stored.lastAttemptedAt ? { lastAttemptedAt: stored.lastAttemptedAt } : {}),
  };
}

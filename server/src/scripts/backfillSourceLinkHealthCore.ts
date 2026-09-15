import {
  isStaleSourceLinkHealth,
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

export const sourceLinkCandidateKey = (url: string): string | null => {
  try {
    const parsed = new URL(url.trim());
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${host}${path}${parsed.search}`;
  } catch {
    return null;
  }
};

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
  checkedAt?: Date;
  lastAttemptedAt?: Date;
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
  fresh: { healthStatus: SourceLinkHealthStatus; httpStatusCode?: number },
  stored: StoredSourceLinkHealthEntry | undefined,
  now: Date,
): ResolvedSourceLinkHealthEntry {
  const freshEntry: StoredSourceLinkHealthEntry = {
    url,
    healthStatus: fresh.healthStatus,
    ...(typeof fresh.httpStatusCode === 'number' ? { httpStatusCode: fresh.httpStatusCode } : {}),
    checkedAt: now,
  };

  if (fresh.healthStatus !== 'UNKNOWN')
    return { entry: freshEntry, preservedDecisiveVerdict: false };
  if (!isDecisiveStoredVerdict(stored))
    return { entry: freshEntry, preservedDecisiveVerdict: false };

  const kept = stored as StoredSourceLinkHealthEntry;
  return {
    entry: {
      url,
      healthStatus: kept.healthStatus,
      ...(typeof kept.httpStatusCode === 'number' ? { httpStatusCode: kept.httpStatusCode } : {}),
      ...(kept.checkedAt ? { checkedAt: kept.checkedAt } : {}),
      lastAttemptedAt: now,
    },
    preservedDecisiveVerdict: true,
  };
}

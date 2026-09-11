import {
  isStaleSourceLinkHealth,
  type DatedSourceLinkHealth,
  type SourceLinkHealthStatus,
} from '../services/sourceLinkHealth';

export interface SourceLinkHealthCandidateEntity {
  websiteUrl?: unknown;
  website?: unknown;
  sourceUrls?: unknown;
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

export function collectSourceLinkHealthCandidates(
  entity: SourceLinkHealthCandidateEntity,
  extraUrls: readonly unknown[] = [],
): string[] {
  const rawValues: unknown[] = [
    entity.websiteUrl,
    entity.website,
    ...(Array.isArray(entity.sourceUrls) ? entity.sourceUrls : []),
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

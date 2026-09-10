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

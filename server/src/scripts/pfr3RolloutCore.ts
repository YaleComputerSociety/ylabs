import { isPublicHttpUrl } from '../utils/urlSafety';

export type RolloutEnvironment = 'beta' | 'production';

export interface ContactRouteReviewCandidate {
  routeType?: unknown;
  url?: unknown;
  sourceUrl?: unknown;
  contactPolicy?: unknown;
  sourceEvidenceId?: unknown;
  sourceEvidenceIds?: unknown;
  priority?: unknown;
  review?: { status?: unknown };
  archived?: unknown;
}

export interface ContactRouteReviewQueueItem {
  routeType: string;
  destination: string;
  source: string;
  contactPolicy: string;
  evidenceReferenceCount: number;
  priority: number;
  reviewStatus: string;
}

const safeUrl = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  try {
    return isPublicHttpUrl(value) ? value : null;
  } catch {
    return null;
  }
};

export function buildContactRouteReviewQueue(
  candidates: ContactRouteReviewCandidate[],
): ContactRouteReviewQueueItem[] {
  return candidates
    .flatMap((candidate) => {
      const destination = safeUrl(candidate.url);
      const source = safeUrl(candidate.sourceUrl);
      const contactPolicy =
        typeof candidate.contactPolicy === 'string' ? candidate.contactPolicy : '';
      if (
        candidate.archived === true ||
        !destination ||
        !source ||
        !contactPolicy ||
        ['UNKNOWN', 'NO_DIRECT_CONTACT'].includes(contactPolicy) ||
        candidate.review?.status === 'approved'
      ) {
        return [];
      }
      const evidenceReferenceCount = new Set(
        [
          ...(Array.isArray(candidate.sourceEvidenceIds) ? candidate.sourceEvidenceIds : []),
          ...(candidate.sourceEvidenceId ? [candidate.sourceEvidenceId] : []),
        ]
          .map(String)
          .filter(Boolean),
      ).size;
      if (evidenceReferenceCount === 0) return [];
      return [
        {
          routeType: typeof candidate.routeType === 'string' ? candidate.routeType : 'UNKNOWN',
          destination,
          source,
          contactPolicy,
          evidenceReferenceCount,
          priority: typeof candidate.priority === 'number' ? candidate.priority : 100,
          reviewStatus:
            typeof candidate.review?.status === 'string' ? candidate.review.status : 'unreviewed',
        },
      ];
    })
    .sort(
      (left, right) =>
        (left.routeType === 'OFFICIAL_APPLICATION' ? 0 : 1) -
          (right.routeType === 'OFFICIAL_APPLICATION' ? 0 : 1) ||
        right.evidenceReferenceCount - left.evidenceReferenceCount ||
        left.priority - right.priority ||
        left.source.localeCompare(right.source) ||
        left.destination.localeCompare(right.destination),
    );
}

export interface OutreachCountRow {
  deliveryMethod?: unknown;
  outcome?: unknown;
  outcomeReportedAt?: unknown;
  count?: unknown;
}

export function buildStudentOutreachCountReport(rows: OutreachCountRow[]) {
  const report = {
    totalAttempts: 0,
    officialRouteAttempts: 0,
    confirmedOutcomes: 0,
    selfReportedOutcomes: 0,
    outcomes: {} as Record<string, number>,
  };
  for (const row of rows) {
    const count = typeof row.count === 'number' && row.count > 0 ? Math.floor(row.count) : 0;
    report.totalAttempts += count;
    if (row.deliveryMethod === 'official-route') report.officialRouteAttempts += count;
    if (row.outcomeReportedAt) {
      report.confirmedOutcomes += count;
      if (row.deliveryMethod === 'external-self-reported') report.selfReportedOutcomes += count;
      const outcome = typeof row.outcome === 'string' ? row.outcome : 'unknown';
      report.outcomes[outcome] = (report.outcomes[outcome] || 0) + count;
    }
  }
  return report;
}

export function assertPathwayIndexRolloutTarget(input: {
  environment?: string;
  meiliHost?: string;
  indexPrefix?: string;
  restorePoint?: string;
}): { environment: RolloutEnvironment; indexPrefix: string; restorePoint: string } {
  if (input.environment !== 'beta' && input.environment !== 'production') {
    throw new Error('PFR-3 rebuild requires an explicit beta or production environment');
  }
  let host: URL;
  try {
    host = new URL(input.meiliHost || '');
  } catch {
    throw new Error('PFR-3 rebuild requires an explicit valid MEILISEARCH_HOST');
  }
  if (['localhost', '127.0.0.1', '::1'].includes(host.hostname)) {
    throw new Error('PFR-3 beta/production rebuild refuses a localhost Meilisearch target');
  }
  const prefix = input.indexPrefix?.trim();
  if (!prefix || !prefix.toLowerCase().startsWith(`${input.environment}_`)) {
    throw new Error('MEILISEARCH_INDEX_PREFIX must unambiguously match the target environment');
  }
  const restorePoint = input.restorePoint?.trim();
  if (!restorePoint || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{7,200}$/.test(restorePoint)) {
    throw new Error('PFR3_MEILI_RESTORE_POINT is required before rebuilding');
  }
  return { environment: input.environment, indexPrefix: prefix, restorePoint };
}

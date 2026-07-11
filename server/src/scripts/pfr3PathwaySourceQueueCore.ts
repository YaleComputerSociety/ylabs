import { createHash } from 'crypto';
import { isPublicHttpUrl } from '../utils/urlSafety';

export type PathwaySourceQueueBucket =
  | 'status_recency_review'
  | 'source_repair'
  | 'new_source_acquisition';

export interface PathwaySourceQueueCandidate {
  id: unknown;
  status?: unknown;
  evidenceStrength?: unknown;
  confidence?: unknown;
  sourceUrls?: unknown;
  sourceEvidenceIds?: unknown;
  archived?: unknown;
}

export interface PathwaySourceQueueSample {
  handle: string;
  status: string;
  evidenceStrength: string;
  confidenceBand: 'missing' | 'below_0.70' | 'at_least_0.70';
}

export interface PathwaySourceQueueReport {
  candidateCount: number;
  buckets: Record<PathwaySourceQueueBucket, { count: number; samples: PathwaySourceQueueSample[] }>;
}

const ACTIVE_STATUSES = new Set(['ACTIVE', 'RECURRING']);
const QUALIFYING_EVIDENCE = new Set(['DIRECT', 'STRONG', 'MODERATE']);

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function hasSafePublicSource(candidate: PathwaySourceQueueCandidate): boolean {
  return strings(candidate.sourceUrls).some((url) => {
    try {
      return isPublicHttpUrl(url);
    } catch {
      return false;
    }
  });
}

function confidenceBand(value: unknown): PathwaySourceQueueSample['confidenceBand'] {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'missing';
  return value < 0.7 ? 'below_0.70' : 'at_least_0.70';
}

function handleFor(id: unknown, salt: string): string {
  return `pathway-${createHash('sha256')
    .update(`${salt}:${String(id)}`)
    .digest('hex')
    .slice(0, 12)}`;
}

function bucketFor(candidate: PathwaySourceQueueCandidate): PathwaySourceQueueBucket | null {
  if (candidate.archived === true) return null;
  const status = typeof candidate.status === 'string' ? candidate.status : '';
  const evidence = typeof candidate.evidenceStrength === 'string' ? candidate.evidenceStrength : '';
  const confidence = typeof candidate.confidence === 'number' ? candidate.confidence : undefined;
  const safeSource = hasSafePublicSource(candidate);
  const hasEvidenceReference = strings(candidate.sourceEvidenceIds).length > 0;

  const statusIsOnlyBlocker =
    !ACTIVE_STATUSES.has(status) &&
    QUALIFYING_EVIDENCE.has(evidence) &&
    typeof confidence === 'number' &&
    confidence >= 0.7 &&
    safeSource;
  if (statusIsOnlyBlocker) return 'status_recency_review';
  if (!safeSource || !hasEvidenceReference) return 'source_repair';
  if (evidence === 'WEAK' && (confidence === undefined || confidence < 0.7)) {
    return 'new_source_acquisition';
  }
  return null;
}

export function buildPathwaySourceQueue(
  candidates: PathwaySourceQueueCandidate[],
  options: { sampleLimit?: number; handleSalt: string },
): PathwaySourceQueueReport {
  if (!options.handleSalt.trim()) throw new Error('A non-empty handle salt is required');
  const sampleLimit = options.sampleLimit ?? 0;
  if (!Number.isSafeInteger(sampleLimit) || sampleLimit < 0 || sampleLimit > 100) {
    throw new Error('sampleLimit must be an integer from 0 through 100');
  }
  const buckets: PathwaySourceQueueReport['buckets'] = {
    status_recency_review: { count: 0, samples: [] },
    source_repair: { count: 0, samples: [] },
    new_source_acquisition: { count: 0, samples: [] },
  };
  const sorted = [...candidates].sort((left, right) =>
    handleFor(left.id, options.handleSalt).localeCompare(handleFor(right.id, options.handleSalt)),
  );
  for (const candidate of sorted) {
    const bucket = bucketFor(candidate);
    if (!bucket) continue;
    buckets[bucket].count += 1;
    if (buckets[bucket].samples.length < sampleLimit) {
      buckets[bucket].samples.push({
        handle: handleFor(candidate.id, options.handleSalt),
        status: typeof candidate.status === 'string' ? candidate.status : 'UNKNOWN',
        evidenceStrength:
          typeof candidate.evidenceStrength === 'string' ? candidate.evidenceStrength : 'UNKNOWN',
        confidenceBand: confidenceBand(candidate.confidence),
      });
    }
  }
  return { candidateCount: candidates.length, buckets };
}

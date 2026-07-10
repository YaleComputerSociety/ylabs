/**
 * Trust rules for attaching Yale people to papers.
 *
 * Student-facing publication lists read Paper.yaleAuthorIds for speed, but this
 * denormalized field must only be written from identity-backed authorship
 * evidence. Metadata sources such as arXiv can enrich a paper without proving a
 * Yale faculty author relationship.
 */

export const PAPER_AUTHORSHIP_EVIDENCE_FIELD = 'paperAuthorshipEvidence';

export type PaperAuthorshipMethod =
  | 'openalex-orcid'
  | 'openalex-author-id'
  | 'orcid-record'
  | 'pubmed-orcid'
  | 'europepmc-orcid'
  | 'semantic-scholar-accepted'
  | 'manual-accepted'
  | 'legacy-openalex-identity';

const PAPER_AUTHORSHIP_METHODS = new Set<PaperAuthorshipMethod>([
  'openalex-orcid',
  'openalex-author-id',
  'orcid-record',
  'pubmed-orcid',
  'europepmc-orcid',
  'semantic-scholar-accepted',
  'manual-accepted',
  'legacy-openalex-identity',
]);

export interface PaperAuthorshipEvidence {
  userId: string;
  netid?: string;
  displayName: string;
  sourceName: string;
  method: PaperAuthorshipMethod;
  externalAuthorIds?: Record<string, string>;
  confidence?: number;
  sourceUrl?: string;
  observedAt?: string | Date;
}

export const PAPER_AUTHORSHIP_SOURCE_NAMES = new Set([
  'openalex',
  'orcid',
  'pubmed',
  'europe-pmc',
  'semantic-scholar',
  'manual-admin-edit',
  'manual-pi-edit',
]);

export const PAPER_METADATA_ONLY_SOURCE_NAMES = new Set([
  'arxiv',
  'crossref',
]);

export function isPaperAuthorshipSource(sourceName: string | undefined): boolean {
  return !!sourceName && PAPER_AUTHORSHIP_SOURCE_NAMES.has(sourceName);
}

export function isPaperMetadataOnlySource(sourceName: string | undefined): boolean {
  return !!sourceName && PAPER_METADATA_ONLY_SOURCE_NAMES.has(sourceName);
}

export function isPaperAuthorshipEvidence(value: unknown): value is PaperAuthorshipEvidence {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.userId === 'string' &&
    record.userId.trim().length > 0 &&
    typeof record.displayName === 'string' &&
    record.displayName.trim().length > 0 &&
    typeof record.sourceName === 'string' &&
    isPaperAuthorshipSource(record.sourceName) &&
    typeof record.method === 'string' &&
    PAPER_AUTHORSHIP_METHODS.has(record.method as PaperAuthorshipMethod)
  );
}

export function normalizePaperAuthorshipEvidence(
  value: unknown,
  fallback: {
    sourceName?: string;
    confidence?: number;
    sourceUrl?: string;
    observedAt?: Date;
  } = {},
): PaperAuthorshipEvidence | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const sourceName =
    typeof record.sourceName === 'string' ? record.sourceName : fallback.sourceName;
  const normalized = {
    ...record,
    sourceName,
    confidence:
      typeof record.confidence === 'number'
        ? record.confidence
        : fallback.confidence,
    sourceUrl:
      typeof record.sourceUrl === 'string'
        ? record.sourceUrl
        : fallback.sourceUrl,
    observedAt:
      record.observedAt instanceof Date || typeof record.observedAt === 'string'
        ? record.observedAt
        : fallback.observedAt,
  };

  if (!isPaperAuthorshipEvidence(normalized)) return null;

  return {
    userId: normalized.userId,
    netid: typeof normalized.netid === 'string' ? normalized.netid : undefined,
    displayName: normalized.displayName,
    sourceName: normalized.sourceName,
    method: normalized.method as PaperAuthorshipMethod,
    externalAuthorIds:
      normalized.externalAuthorIds && typeof normalized.externalAuthorIds === 'object'
        ? (normalized.externalAuthorIds as Record<string, string>)
        : undefined,
    confidence: normalized.confidence,
    sourceUrl: normalized.sourceUrl,
    observedAt: normalized.observedAt,
  };
}

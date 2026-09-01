import { createHash } from 'crypto';
import {
  undergraduateLogisticsSignalTypes as undergraduateLogisticsClaimTypes,
  type UndergraduateLogisticsSignalType as UndergraduateLogisticsClaimType,
} from '../models/researchAccessTypes';

export interface LogisticsAuditEntity {
  id: string;
  slug: string;
}

export interface LogisticsAuditClaim {
  id: string;
  researchEntityId: string;
  claimType: UndergraduateLogisticsClaimType;
  status: 'KNOWN' | 'STALE_UNDER_REVIEW' | 'CONFLICTING_WITHHELD';
  value?: Record<string, unknown>;
  sourceName?: string;
  sourceUrl?: string;
  evidenceExcerpt?: string;
  sourceEvidenceIds?: string[];
  observedAt?: Date | string;
  expiresAt?: Date | string;
  archived?: boolean;
}

export interface LogisticsAuditDecision {
  claimHandle: string;
  correct: boolean;
  reason?: string;
}

export interface LogisticsAuditSample {
  claimHandle: string;
  entitySlug: string;
  claimType: UndergraduateLogisticsClaimType;
  value: Record<string, unknown>;
  sourceUrl: string;
  evidenceExcerpt: string;
  observedAt: string;
  expiresAt: string;
}

const dateValue = (value: Date | string | undefined): Date | undefined => {
  const date =
    value instanceof Date ? value : typeof value === 'string' ? new Date(value) : undefined;
  return date && !Number.isNaN(date.getTime()) ? date : undefined;
};

export function logisticsClaimHandle(claim: LogisticsAuditClaim): string {
  const normalizedEvidence = [
    (claim.sourceName || '').trim().toLowerCase(),
    (claim.sourceUrl || '').trim(),
    (claim.evidenceExcerpt || '').replace(/\s+/g, ' ').trim().toLowerCase(),
  ].join('|');
  const evidenceVersion = createHash('sha256').update(normalizedEvidence).digest('hex');
  return createHash('sha256')
    .update(
      [
        claim.researchEntityId,
        claim.claimType,
        JSON.stringify(claim.value || {}),
        evidenceVersion,
      ].join('|'),
    )
    .digest('hex')
    .slice(0, 20);
}

export function buildUndergraduateLogisticsCoverage(
  entities: LogisticsAuditEntity[],
  claims: LogisticsAuditClaim[],
  now: Date = new Date(),
) {
  const activeEntityIds = new Set(entities.map((entity) => entity.id));
  const activeClaims = claims.filter(
    (claim) => claim.archived !== true && activeEntityIds.has(claim.researchEntityId),
  );
  return undergraduateLogisticsClaimTypes.map((claimType) => {
    const rows = activeClaims.filter((claim) => claim.claimType === claimType);
    const entityIds = new Set(rows.map((claim) => claim.researchEntityId));
    const known = rows.filter(
      (claim) =>
        claim.status === 'KNOWN' &&
        Boolean(dateValue(claim.expiresAt)) &&
        (dateValue(claim.expiresAt) as Date) > now,
    ).length;
    const stale = rows.filter(
      (claim) =>
        claim.status === 'STALE_UNDER_REVIEW' ||
        (claim.status === 'KNOWN' &&
          (!dateValue(claim.expiresAt) || (dateValue(claim.expiresAt) as Date) <= now)),
    ).length;
    const conflicting = rows.filter((claim) => claim.status === 'CONFLICTING_WITHHELD').length;
    return {
      claimType,
      entityCount: entities.length,
      known,
      staleUnderReview: stale,
      conflictingWithheld: conflicting,
      unknown: Math.max(0, entities.length - entityIds.size),
      coverageRate: entities.length > 0 ? known / entities.length : 0,
    };
  });
}

export function selectUndergraduateLogisticsAuditSample(
  entities: LogisticsAuditEntity[],
  claims: LogisticsAuditClaim[],
  sampleSize: number,
  now: Date = new Date(),
): LogisticsAuditSample[] {
  const slugById = new Map(entities.map((entity) => [entity.id, entity.slug]));
  const byType = new Map<UndergraduateLogisticsClaimType, LogisticsAuditSample[]>();

  for (const claim of claims) {
    const expiresAt = dateValue(claim.expiresAt);
    const observedAt = dateValue(claim.observedAt);
    if (
      claim.archived === true ||
      claim.status !== 'KNOWN' ||
      !claim.value ||
      !claim.sourceUrl ||
      !claim.evidenceExcerpt ||
      !expiresAt ||
      expiresAt <= now ||
      !observedAt
    ) {
      continue;
    }
    const entitySlug = slugById.get(claim.researchEntityId);
    if (!entitySlug) continue;
    const rows = byType.get(claim.claimType) || [];
    rows.push({
      claimHandle: logisticsClaimHandle(claim),
      entitySlug,
      claimType: claim.claimType,
      value: claim.value,
      sourceUrl: claim.sourceUrl,
      evidenceExcerpt: claim.evidenceExcerpt,
      observedAt: observedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
    byType.set(claim.claimType, rows);
  }

  for (const rows of byType.values()) {
    rows.sort((left, right) => left.claimHandle.localeCompare(right.claimHandle));
  }

  const sample: LogisticsAuditSample[] = [];
  let cursor = 0;
  while (sample.length < sampleSize) {
    let added = false;
    for (const claimType of undergraduateLogisticsClaimTypes) {
      const row = byType.get(claimType)?.[cursor];
      if (!row || sample.length >= sampleSize) continue;
      sample.push(row);
      added = true;
    }
    if (!added) break;
    cursor += 1;
  }
  return sample;
}

export function evaluateUndergraduateLogisticsPrecision(
  sample: LogisticsAuditSample[],
  decisions: LogisticsAuditDecision[],
  minimumPrecision: number,
) {
  const decisionByHandle = new Map(decisions.map((decision) => [decision.claimHandle, decision]));
  const missingHandles = sample
    .filter((row) => !decisionByHandle.has(row.claimHandle))
    .map((row) => row.claimHandle);
  const extraHandles = decisions
    .filter((decision) => !sample.some((row) => row.claimHandle === decision.claimHandle))
    .map((decision) => decision.claimHandle);
  const reviewed = sample.filter((row) => decisionByHandle.has(row.claimHandle));
  const correct = reviewed.filter((row) => decisionByHandle.get(row.claimHandle)?.correct).length;
  const precision = reviewed.length > 0 ? correct / reviewed.length : null;
  const complete = sample.length > 0 && missingHandles.length === 0 && extraHandles.length === 0;

  return {
    state: !complete ? 'review_required' : precision! >= minimumPrecision ? 'passed' : 'failed',
    minimumPrecision,
    sampled: sample.length,
    reviewed: reviewed.length,
    correct,
    falsePositives: reviewed.length - correct,
    precision,
    missingHandles,
    extraHandles,
    releaseReady: complete && precision! >= minimumPrecision,
  } as const;
}

import type { AccessSignalType } from '../../models/researchAccessTypes';

export type ClaimGateStatus = 'accepted' | 'review' | 'rejected';

export type AccessArtifactType = 'AccessSignal';

export interface AccessArtifactCandidate {
  artifactType: AccessArtifactType;
  id?: string;
  researchEntityId?: string;
  derivationKey?: string;
  sourceEvidenceIds?: string[];
  sourceUrls?: string[];
  sourceName?: string;
  sourceUrl?: string;
  signalType?: AccessSignalType | string;
}

export interface ClaimValidationResult {
  status: ClaimGateStatus;
  reasons: string[];
  claim: AccessArtifactCandidate;
}

export interface ClaimValidationBundleResult {
  accepted: ClaimValidationResult[];
  review: ClaimValidationResult[];
  rejected: ClaimValidationResult[];
}

export interface ClaimGateReport {
  generatedAt: string;
  summary: {
    accepted: number;
    review: number;
    rejected: number;
  };
  byArtifactType: Record<string, number>;
  byReason: Record<string, number>;
  samples: {
    accepted: ClaimValidationResult[];
    review: ClaimValidationResult[];
    rejected: ClaimValidationResult[];
  };
}

function compactStrings(values: Array<unknown>): string[] {
  return Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

function hasEvidence(candidate: AccessArtifactCandidate): boolean {
  return compactStrings(candidate.sourceEvidenceIds || []).length > 0;
}

function classifyCandidate(candidate: AccessArtifactCandidate): ClaimValidationResult {
  const reasons: string[] = [];

  if (!hasEvidence(candidate)) reasons.push('missing_source_evidence');

  if (reasons.length > 0) {
    return { status: 'rejected', reasons: Array.from(new Set(reasons)), claim: candidate };
  }
  return { status: 'accepted', reasons: [], claim: candidate };
}

export function validateAccessArtifactBundle(
  artifacts: AccessArtifactCandidate[],
): ClaimValidationBundleResult {
  const results = artifacts.map((artifact) => classifyCandidate(artifact));
  return {
    accepted: results.filter((result) => result.status === 'accepted'),
    review: results.filter((result) => result.status === 'review'),
    rejected: results.filter((result) => result.status === 'rejected'),
  };
}

function increment(target: Record<string, number>, key: string): void {
  target[key] = (target[key] || 0) + 1;
}

function sample<T>(values: T[], limit: number): T[] {
  return values.slice(0, Math.max(0, limit));
}

export function buildClaimGateReport(input: {
  artifacts: AccessArtifactCandidate[];
  includeSamples?: boolean;
  sampleLimit?: number;
}): ClaimGateReport {
  const limit = input.sampleLimit ?? 20;
  const validation = validateAccessArtifactBundle(input.artifacts);
  const allResults = [...validation.accepted, ...validation.review, ...validation.rejected];
  const byArtifactType: Record<string, number> = {};
  const byReason: Record<string, number> = {};

  for (const result of allResults) {
    increment(byArtifactType, result.claim.artifactType);
    for (const reason of result.reasons) increment(byReason, reason);
  }

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      accepted: validation.accepted.length,
      review: validation.review.length,
      rejected: validation.rejected.length,
    },
    byArtifactType,
    byReason,
    samples: input.includeSamples
      ? {
          accepted: sample(validation.accepted, limit),
          review: sample(validation.review, limit),
          rejected: sample(validation.rejected, limit),
        }
      : { accepted: [], review: [], rejected: [] },
  };
}

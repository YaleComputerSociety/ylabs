import type {
  AccessSignalType,
  ContactRouteType,
  EntryPathwayType,
  PostedOpportunityStatus,
} from '../../models/researchAccessTypes';

export type ClaimGateStatus = 'accepted' | 'review' | 'rejected';

export type AccessArtifactType =
  | 'EntryPathway'
  | 'AccessSignal'
  | 'ContactRoute'
  | 'PostedOpportunity';

export interface AccessArtifactCandidate {
  artifactType: AccessArtifactType;
  id?: string;
  researchEntityId?: string;
  entryPathwayId?: string;
  derivationKey?: string;
  sourceEvidenceIds?: string[];
  sourceUrls?: string[];
  sourceName?: string;
  sourceUrl?: string;
  pathwayType?: EntryPathwayType | string;
  signalType?: AccessSignalType | string;
  routeType?: ContactRouteType | string;
  url?: string;
  status?: PostedOpportunityStatus | string;
  title?: string;
  applicationUrl?: string;
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

const FORMALIZATION_ONLY_PATHWAY_TYPES = new Set([
  'COURSE_CREDIT',
  'SENIOR_THESIS',
  'FELLOWSHIP_FUNDED_PROJECT',
]);

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

function hasUrl(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function hasOfficialApplicationPathway(bundle: AccessArtifactCandidate[]): boolean {
  return bundle.some(
    (candidate) =>
      candidate.artifactType === 'EntryPathway' &&
      candidate.derivationKey === 'pathway:OFFICIAL_APPLICATION:JOIN_PAGE' &&
      !FORMALIZATION_ONLY_PATHWAY_TYPES.has(String(candidate.pathwayType || '')),
  );
}

function hasOfficialApplicationSupport(
  candidate: AccessArtifactCandidate,
  bundle: AccessArtifactCandidate[],
): boolean {
  return Boolean(candidate.entryPathwayId) || hasOfficialApplicationPathway(bundle);
}

function classifyCandidate(
  candidate: AccessArtifactCandidate,
  bundle: AccessArtifactCandidate[],
): ClaimValidationResult {
  const reasons: string[] = [];

  if (!hasEvidence(candidate)) reasons.push('missing_source_evidence');

  if (
    candidate.artifactType === 'EntryPathway' &&
    FORMALIZATION_ONLY_PATHWAY_TYPES.has(String(candidate.pathwayType || ''))
  ) {
    return {
      status: 'review',
      reasons: ['formalization_only', ...reasons],
      claim: candidate,
    };
  }

  if (
    candidate.artifactType === 'AccessSignal' &&
    candidate.signalType === 'APPLICATION_FORM_EXISTS' &&
    !hasOfficialApplicationSupport(candidate, bundle)
  ) {
    reasons.push('missing_official_application_pathway');
  }

  if (
    candidate.artifactType === 'ContactRoute' &&
    candidate.routeType === 'OFFICIAL_APPLICATION'
  ) {
    if (!hasOfficialApplicationSupport(candidate, bundle)) {
      reasons.push('missing_official_application_pathway');
    }
    if (!hasUrl(candidate.url)) reasons.push('missing_application_route');
  }

  if (candidate.artifactType === 'PostedOpportunity') {
    if (!candidate.title) reasons.push('missing_title');
    if (!hasUrl(candidate.applicationUrl) && !compactStrings(candidate.sourceUrls || []).some(hasUrl)) {
      reasons.push('missing_application_route');
    }
    if (!['OPEN', 'ROLLING', 'CLOSED', 'ARCHIVED'].includes(String(candidate.status || ''))) {
      reasons.push('missing_status');
    }
  }

  if (reasons.length > 0) {
    return { status: 'rejected', reasons: Array.from(new Set(reasons)), claim: candidate };
  }
  return { status: 'accepted', reasons: [], claim: candidate };
}

export function validateAccessArtifactBundle(
  artifacts: AccessArtifactCandidate[],
): ClaimValidationBundleResult {
  const results = artifacts.map((artifact) => classifyCandidate(artifact, artifacts));
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

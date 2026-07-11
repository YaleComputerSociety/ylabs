import { createHash } from 'crypto';
import { isPublicHttpUrl } from '../utils/urlSafety';

export const PFR3_REVIEW_MAX_BATCH = 25;
export type ReviewKind = 'recency' | 'source_repair' | 'new_source';

export interface ReviewCandidate {
  id: unknown;
  researchEntityId?: unknown;
  status?: unknown;
  evidenceStrength?: unknown;
  confidence?: unknown;
  sourceUrls?: unknown;
  sourceEvidenceIds?: unknown;
  lastObservedAt?: unknown;
}

export interface ReviewDecision {
  handle?: unknown;
  kind?: unknown;
  sourceUrl?: unknown;
  evidence?: unknown;
  rationale?: unknown;
  scraperSource?: unknown;
}

export interface ValidatedDecision {
  handle: string;
  kind: ReviewKind;
  sourceUrl: string;
  evidence: string;
  rationale: string;
  disposition: 'manual_only';
  reason: string;
  scraperSource?: string;
}

export function pathwayReviewHandle(id: unknown, salt: string): string {
  if (salt.trim().length < 16) throw new Error('handle salt must contain at least 16 characters');
  return `pathway-${createHash('sha256').update(`${salt}:${String(id)}`).digest('hex').slice(0, 12)}`;
}

export function resolveReviewCandidates(
  candidates: ReviewCandidate[],
  handles: string[],
  salt: string,
  maxBatch: number,
): ReviewCandidate[] {
  if (!Number.isSafeInteger(maxBatch) || maxBatch < 1 || maxBatch > PFR3_REVIEW_MAX_BATCH) {
    throw new Error(`max batch must be an integer from 1 through ${PFR3_REVIEW_MAX_BATCH}`);
  }
  if (handles.length === 0 || handles.length > maxBatch || new Set(handles).size !== handles.length) {
    throw new Error('handles must be unique, non-empty, and no larger than max batch');
  }
  const byHandle = new Map(candidates.map((candidate) => [pathwayReviewHandle(candidate.id, salt), candidate]));
  const resolved = handles.map((handle) => byHandle.get(handle));
  if (resolved.some((candidate) => !candidate)) throw new Error('one or more handles do not match this salt or queue');
  return resolved as ReviewCandidate[];
}

function requiredText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new Error(`${field} is required and must be at most ${max} characters`);
  }
  return value.trim();
}

export function validateReviewDecisions(
  input: unknown,
  allowedHandles: Set<string>,
): ValidatedDecision[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > PFR3_REVIEW_MAX_BATCH) {
    throw new Error(`decision file must contain 1 through ${PFR3_REVIEW_MAX_BATCH} decisions`);
  }
  const seen = new Set<string>();
  return input.map((raw) => {
    const decision = (raw || {}) as ReviewDecision;
    const handle = requiredText(decision.handle, 'handle', 64);
    if (!allowedHandles.has(handle) || seen.has(handle)) throw new Error('decision handle is unknown or duplicated');
    seen.add(handle);
    if (!['recency', 'source_repair', 'new_source'].includes(String(decision.kind))) {
      throw new Error('kind must be recency, source_repair, or new_source');
    }
    const sourceUrl = requiredText(decision.sourceUrl, 'sourceUrl', 2048);
    if (!isPublicHttpUrl(sourceUrl)) throw new Error('sourceUrl must be a safe public HTTP URL');
    const evidence = requiredText(decision.evidence, 'evidence', 2000);
    const rationale = requiredText(decision.rationale, 'rationale', 1000);
    const scraperSource =
      decision.scraperSource === undefined
        ? undefined
        : requiredText(decision.scraperSource, 'scraperSource', 120);
    return {
      handle,
      kind: decision.kind as ReviewKind,
      sourceUrl,
      evidence,
      rationale,
      scraperSource,
      disposition: 'manual_only',
      reason:
        'Validated evidence must enter through an existing source observation and access materialization; this workflow never edits pathways directly.',
    };
  });
}

export function assertExecutionGuards(options: {
  target: string;
  execute: boolean;
  confirmation?: string;
  restoreToken?: string;
  prodConfirmation?: string;
  runtimeTarget?: string;
}): void {
  if (!['beta', 'prod'].includes(options.target)) throw new Error('target must be beta or prod');
  if (options.runtimeTarget && options.runtimeTarget !== options.target) throw new Error('target does not match runtime environment');
  if (!options.execute) return;
  if (options.confirmation !== `execute-${options.target}`) throw new Error('execute confirmation does not match target');
  if (!options.restoreToken?.trim()) throw new Error('execute requires a backup/restore token');
  if (options.target === 'prod' && options.prodConfirmation !== 'confirm-production-pathway-review') {
    throw new Error('production execute requires the production confirmation');
  }
}

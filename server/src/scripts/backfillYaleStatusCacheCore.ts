import { classifyResearchEntityResearchScope } from '../services/researchEntityResearchScope';
import { isBlockingVisibilityReason } from '../services/studentVisibilityGateService';
import {
  deriveResearchEntityYaleStatus,
  hasEvidencelessInactiveYaleStatus,
  type ResearchEntityYaleStatusReason,
} from '../utils/researchEntityYaleStatus';

export interface YaleStatusCacheDoc extends Record<string, unknown> {
  id: string;
  label: string;
}

export interface YaleStatusCachePlanRow {
  id: string;
  label: string;
  reason: ResearchEntityYaleStatusReason;
  previousActiveAtYaleCache: boolean;
  previousYaleStatusCache: string;
  previousStudentVisibilityTier: string;
  nextStudentVisibilityTier: string;
  nextStudentVisibilityComputedTier: 'suppressed';
  nextStudentVisibilityReasons: string[];
  willFlipToSuppressed: boolean;
  operatorOverridePreserved: boolean;
}

export interface YaleStatusCacheHealRow {
  id: string;
  label: string;
  previousYaleStatusCache: string;
  previousActiveAtYaleCache: boolean;
  previousYaleStatusReasonCache: string;
  previousStudentVisibilityTier: string;
  suppressedOnlyByInactiveAtYale: boolean;
}

export interface YaleStatusCachePlan {
  scanned: number;
  toUpdate: YaleStatusCachePlanRow[];
  toHeal: YaleStatusCacheHealRow[];
  countsByReason: Record<string, number>;
  flipToSuppressedCount: number;
}

const VALID_OVERRIDE_TIERS = new Set(['student_ready', 'limited_but_safe', 'operator_review', 'suppressed']);

function textOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback;
}

function existingReasons(doc: Record<string, unknown>): string[] {
  return Array.isArray(doc.studentVisibilityReasons)
    ? doc.studentVisibilityReasons.filter((reason): reason is string => typeof reason === 'string')
    : [];
}

// activeAtYaleCache === false is an unconditional OR-branch in
// computeResearchEntityStudentVisibility's tier decision, so computedTier is
// always 'suppressed' once the signal is applied, independent of leadMembers
// or access-signal counts we don't have on hand here. The published `tier`
// only differs from computedTier when the entity is in research scope AND
// carries an explicit studentVisibilityOverrideTier (see withOverride in
// studentVisibilityTier.ts) -- that case is preserved rather than clobbered.
export function planYaleStatusCacheBackfill(docs: YaleStatusCacheDoc[]): YaleStatusCachePlan {
  const toUpdate: YaleStatusCachePlanRow[] = [];
  const toHeal: YaleStatusCacheHealRow[] = [];
  const countsByReason: Record<string, number> = {};
  let flipToSuppressedCount = 0;

  for (const doc of docs) {
    const signal = deriveResearchEntityYaleStatus(doc);
    if (!signal) {
      if (hasEvidencelessInactiveYaleStatus(doc)) {
        const reasons = existingReasons(doc);
        toHeal.push({
          id: doc.id,
          label: doc.label,
          previousYaleStatusCache: textOr(doc.yaleStatusCache, 'unknown'),
          previousActiveAtYaleCache: doc.activeAtYaleCache !== false,
          previousYaleStatusReasonCache: textOr(doc.yaleStatusReasonCache, ''),
          previousStudentVisibilityTier: textOr(doc.studentVisibilityTier, 'operator_review'),
          suppressedOnlyByInactiveAtYale:
            reasons.includes('inactive_at_yale') &&
            reasons.filter((reason) => isBlockingVisibilityReason(reason)).length === 1,
        });
      }
      continue;
    }

    const previousActiveAtYaleCache = doc.activeAtYaleCache !== false;
    const previousYaleStatusCache = textOr(doc.yaleStatusCache, 'unknown');
    const previousStudentVisibilityTier = textOr(doc.studentVisibilityTier, 'operator_review');

    const outsideResearchScope = !classifyResearchEntityResearchScope({
      name: doc.name,
      displayName: doc.displayName,
      kind: doc.kind,
      entityType: doc.entityType,
      summary: doc.summary,
      shortDescription: doc.shortDescription,
      fullDescription: doc.fullDescription,
      profileSynthesisDescription: doc.profileSynthesisDescription,
      researchAreas: doc.researchAreas,
      keywords: doc.keywords,
    }).researchHomeEligible;
    const overrideTier = doc.studentVisibilityOverrideTier;
    const hasActiveOverride =
      !outsideResearchScope &&
      typeof overrideTier === 'string' &&
      VALID_OVERRIDE_TIERS.has(overrideTier) &&
      overrideTier !== 'suppressed';

    const nextStudentVisibilityTier = hasActiveOverride ? (overrideTier as string) : 'suppressed';
    const nextStudentVisibilityReasons = Array.from(
      new Set([...existingReasons(doc), 'inactive_at_yale']),
    );
    const willFlipToSuppressed =
      previousStudentVisibilityTier !== 'suppressed' && nextStudentVisibilityTier === 'suppressed';

    countsByReason[signal.reason] = (countsByReason[signal.reason] || 0) + 1;
    if (willFlipToSuppressed) flipToSuppressedCount++;

    toUpdate.push({
      id: doc.id,
      label: doc.label,
      reason: signal.reason,
      previousActiveAtYaleCache,
      previousYaleStatusCache,
      previousStudentVisibilityTier,
      nextStudentVisibilityTier,
      nextStudentVisibilityComputedTier: 'suppressed',
      nextStudentVisibilityReasons,
      willFlipToSuppressed,
      operatorOverridePreserved: hasActiveOverride,
    });
  }

  return { scanned: docs.length, toUpdate, toHeal, countsByReason, flipToSuppressedCount };
}

import { type StudentVisibilityTier } from '../models/studentVisibility';
import { STUDENT_READY_HARD_BLOCKER_REASONS } from '../services/studentVisibilityTier';
import { QUEUE_AUTO_SUPPRESSIBLE_REASONS } from '../services/visibilityRepairQueueService';

/**
 * The verbatim opening of the prose a single pre-#1802 launch-strictness pass wrote
 * into `studentVisibilitySuppressionReason` on 2026-06-11. It is the only evidence
 * that an override came from that pass rather than from a later, considered
 * decision, so a row whose reason does not start with it is left alone: the rows
 * carrying an EMPTY reason cannot be attributed and are excluded for that reason
 * alone (#1898).
 */
export const STALE_LAUNCH_SUPPRESSION_PROSE_PREFIX = 'Suppressed from strict student-ready launch:';

export const STALE_LAUNCH_OVERRIDE_FIELDS = [
  'studentVisibilityOverrideTier',
  'studentVisibilitySuppressionReason',
] as const;

const PUBLIC_COMPUTED_TIERS: ReadonlySet<string> = new Set(['student_ready', 'limited_but_safe']);

/**
 * The reason the gate pushes when it found a way for a student to get in:
 * `hasActionEvidence` in `studentVisibilityTier`, which is true when the row has a
 * posted opportunity, an access signal, or an actionable pathway.
 *
 * This is the whole test for whether an override is stale, and it replaced an
 * earlier split by `entityType` that read `CORE_FACILITY` and `INITIATIVE` as
 * standing product questions (#1721). Type was the wrong axis: it asked what a row
 * IS, and what the override claims is that a student has no way in. A core facility
 * that publishes an access route is reachable and a lab that publishes none is not,
 * so the deciding property is on the row and is measurable.
 *
 * Tested positively rather than by the absence of `missing_action_evidence`, so a
 * row whose reasons were never computed is held rather than released: the override
 * survives until something records a route in, never on a silent array.
 */
const ROUTE_IN_REASON = 'concrete_next_step';

export function recordsARouteIn(entity: StaleLaunchOverrideCandidate): boolean {
  return reasonsOf(entity).includes(ROUTE_IN_REASON);
}

export interface StaleLaunchOverrideCandidate {
  archived?: unknown;
  entityType?: unknown;
  studentVisibilityOverrideTier?: unknown;
  studentVisibilityComputedTier?: unknown;
  studentVisibilityTier?: unknown;
  studentVisibilityReasons?: unknown;
  studentVisibilityComputedReasons?: unknown;
  studentVisibilitySuppressionReason?: unknown;
}

export interface StaleLaunchOverrideRefusal {
  refusedBecause: string;
}

export interface StaleLaunchOverridePlan {
  computedTier: StudentVisibilityTier;
  softReasons: string[];
}

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const reasonsOf = (entity: StaleLaunchOverrideCandidate): string[] => {
  const merge = [
    ...(Array.isArray(entity.studentVisibilityReasons) ? entity.studentVisibilityReasons : []),
    ...(Array.isArray(entity.studentVisibilityComputedReasons)
      ? entity.studentVisibilityComputedReasons
      : []),
  ].map(textValue);
  return [...new Set(merge.filter(Boolean))].sort();
};

/**
 * What a single row needs for its stale launch-pass override to stop hiding a
 * card the gate already computes as public, or the reason it keeps it.
 *
 * Returns a refusal rather than `null` for a row that matches the override shape
 * but fails one of the safety reads, so a caller counts a deliberate keep
 * separately from a row that was never a candidate. `null` means "not this
 * cohort".
 */
export function planStaleLaunchSuppressionOverrideRetirement(
  entity: StaleLaunchOverrideCandidate,
): StaleLaunchOverridePlan | StaleLaunchOverrideRefusal | null {
  if (entity.archived === true) return null;
  if (textValue(entity.studentVisibilityOverrideTier) !== 'suppressed') return null;

  const computedTier = textValue(entity.studentVisibilityComputedTier);
  if (!PUBLIC_COMPUTED_TIERS.has(computedTier)) {
    return { refusedBecause: 'the gate does not compute this row as public' };
  }

  if (
    !textValue(entity.studentVisibilitySuppressionReason).startsWith(
      STALE_LAUNCH_SUPPRESSION_PROSE_PREFIX,
    )
  ) {
    return { refusedBecause: 'the override is not attributable to the pre-#1802 launch pass' };
  }

  const reasons = reasonsOf(entity);
  const hardBlockers = reasons.filter((reason) => STUDENT_READY_HARD_BLOCKER_REASONS.has(reason));
  if (hardBlockers.length > 0) {
    return { refusedBecause: `a hard blocker is recorded: ${hardBlockers.join(', ')}` };
  }

  const queueSuppressible = reasons.filter((reason) => QUEUE_AUTO_SUPPRESSIBLE_REASONS.has(reason));
  if (queueSuppressible.length > 0) {
    return {
      refusedBecause: `the repair queue may suppress this row: ${queueSuppressible.join(', ')}`,
    };
  }

  if (!reasons.includes(ROUTE_IN_REASON)) {
    return {
      refusedBecause:
        'the row records no route in for a student, so the override still states something true',
    };
  }

  return {
    computedTier: computedTier as StudentVisibilityTier,
    softReasons: reasons.filter((reason) => reason !== 'operator_override'),
  };
}

export const isStaleLaunchOverrideRefusal = (
  plan: StaleLaunchOverridePlan | StaleLaunchOverrideRefusal | null,
): plan is StaleLaunchOverrideRefusal =>
  plan !== null && Object.prototype.hasOwnProperty.call(plan, 'refusedBecause');

/**
 * Clearing the document field alone does not retire the claim. Each of these rows
 * carries one live `manual-admin-edit` observation asserting the override, so a
 * later materialization re-asserts it and the repair silently reverts: that is why
 * the per-row repairs recorded on #1898 in August were all back at `suppressed`
 * when this cohort was re-measured. A caller must retire the observation too.
 */
export function isStaleLaunchOverrideObservationField(field: unknown): boolean {
  return (STALE_LAUNCH_OVERRIDE_FIELDS as readonly string[]).includes(textValue(field));
}

import type { StudentVisibilityTier } from '../models/studentVisibility';

export const OPERATOR_APPROVAL_RULE_VERSION = 'operator-approval-rules-v1';

export interface OperatorApprovalInput {
  id: string;
  label: string;
  currentTier?: string;
  computedTier?: string;
  reasons: string[];
}

export interface OperatorApprovalCandidate extends OperatorApprovalInput {
  targetTier: StudentVisibilityTier;
  ruleId: string;
  ruleLabel: string;
  reviewNote: string;
}

const HARD_BLOCKING_REASONS = new Set([
  'inactive_at_yale',
  'duplicate_risk',
  'content_page_risk',
  'missing_description',
  'thin_description',
  'profile_fallback_only',
  'missing_source_url',
]);

const normalizeReasons = (reasons: string[]) =>
  Array.from(new Set(reasons.filter(Boolean))).sort((a, b) => a.localeCompare(b));

const hasReason = (reasons: Set<string>, reason: string) => reasons.has(reason);

function hasHardBlockingReason(reasons: Set<string>) {
  for (const reason of HARD_BLOCKING_REASONS) {
    if (reasons.has(reason)) return true;
  }
  return false;
}

export function evaluateResearchOperatorApproval(
  input: OperatorApprovalInput,
): OperatorApprovalCandidate | null {
  if (input.currentTier && input.currentTier !== 'operator_review') return null;

  const normalizedReasons = normalizeReasons(input.reasons);
  const reasons = new Set(normalizedReasons);

  if (hasHardBlockingReason(reasons)) return null;

  if (
    hasReason(reasons, 'source_backed_description') &&
    hasReason(reasons, 'concrete_next_step') &&
    hasReason(reasons, 'missing_lead')
  ) {
    return {
      ...input,
      reasons: normalizedReasons,
      targetTier: 'limited_but_safe',
      ruleId: 'reviewed_non_person_owner_source_action_v1',
      ruleLabel: 'Reviewed non-person owner exception',
      reviewNote:
        'Approved as limited: source-backed description and concrete next step exist; missing lead is accepted as a reviewed non-person-owner exception.',
    };
  }

  return null;
}

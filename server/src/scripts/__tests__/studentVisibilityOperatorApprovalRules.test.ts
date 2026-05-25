import { describe, expect, it } from 'vitest';

import { evaluateResearchOperatorApproval } from '../studentVisibilityOperatorApprovalRules';

describe('studentVisibilityOperatorApprovalRules', () => {
  it('promotes source-backed operator-review records with a concrete next step and reviewed lead exception', () => {
    const candidate = evaluateResearchOperatorApproval({
      id: 'entity-1',
      label: 'Example Center',
      currentTier: 'operator_review',
      computedTier: 'operator_review',
      reasons: ['missing_lead', 'concrete_next_step', 'source_backed_description'],
    });

    expect(candidate).toMatchObject({
      targetTier: 'limited_but_safe',
      ruleId: 'reviewed_non_person_owner_source_action_v1',
    });
    expect(candidate?.reviewNote).toContain('source-backed description');
  });

  it('keeps records hidden when they are missing source, description, or action evidence', () => {
    const blockedReasonSets = [
      ['missing_source_url', 'source_backed_description', 'concrete_next_step', 'missing_lead'],
      ['missing_description', 'concrete_next_step'],
      ['thin_description', 'concrete_next_step', 'missing_lead'],
      ['source_backed_description', 'missing_lead', 'missing_action_evidence'],
    ];

    for (const reasons of blockedReasonSets) {
      expect(
        evaluateResearchOperatorApproval({
          id: 'entity-1',
          label: 'Example Lab',
          currentTier: 'operator_review',
          computedTier: 'operator_review',
          reasons,
        }),
      ).toBeNull();
    }
  });

  it('does not re-approve records that are already public or suppressed', () => {
    expect(
      evaluateResearchOperatorApproval({
        id: 'entity-1',
        label: 'Example Lab',
        currentTier: 'limited_but_safe',
        computedTier: 'operator_review',
        reasons: ['missing_lead', 'concrete_next_step', 'source_backed_description'],
      }),
    ).toBeNull();
  });
});

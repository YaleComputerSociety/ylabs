/**
 * The stored `repairStage` column has two writers: the gate queues a row with
 * `repairStageForReasons`, and the repair queue overwrites it from the plan built by
 * `classifyVisibilityRepairStage`. #2818 shared one of the five reason sets and left
 * the rest duplicated, and three then drifted, so whichever writer ran last decided
 * the stage. These tests pin one definition rather than two agreeing copies.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  ACTION_EVIDENCE_REPAIR_REASONS,
  PI_IDENTITY_REPAIR_REASONS,
  REVIEW_EXCEPTION_REPAIR_REASONS,
  SOURCE_DESCRIPTION_REPAIR_REASONS,
  SUPPRESSION_REPAIR_REASONS,
} from '../studentVisibilityGateService';
import {
  buildVisibilityRepairPlan,
  classifyVisibilityRepairStage,
  QUEUE_AUTO_SUPPRESSIBLE_REASONS,
} from '../visibilityRepairQueueService';

const EVERY_BLOCKER_REASON = [
  'all_citations_dead',
  'application_source_only',
  'archive_review',
  'blank_public_description',
  'citations_identify_no_person',
  'content_page_risk',
  'duplicate_name_risk',
  'duplicate_risk',
  'exact_url_duplicate_risk',
  'formalization_only',
  'generic_directory_shell',
  'grant_only_no_current_yale_source',
  'inactive_at_yale',
  'lab_name_org_type_mismatch',
  'missing_action_evidence',
  'missing_alternate_access_path',
  'missing_application_route',
  'missing_card_description',
  'missing_description',
  'missing_facet_signal',
  'missing_lead',
  'missing_official_source',
  'missing_source_route',
  'missing_source_url',
  'non_owner_grant_shell',
  'non_research_entity',
  'non_research_program',
  'not_undergraduate_relevant',
  'permanently_closed',
  'profile_biography_shell',
  'profile_fallback_only',
  'profile_identity_risk',
  'public_description_invariant_failed',
  'research_infrastructure_only',
  'thin_description',
  'unusable_name',
];

const REPAIR_ATTEMPTING_STAGES = new Set(['source_description', 'pi_identity', 'action_evidence']);

describe('visibility repair stage has one owner (#2818 follow-through)', () => {
  // Comparing the two entry points would be a tautology now that one delegates to
  // the other, so this pins the mapping itself. A reason that changes lane, or a new
  // reason with no lane, fails here instead of silently reaching `review_exception`.
  it('pins the stage every blocker reason resolves to', () => {
    const expectedStageByReason: Record<string, string> = {
      all_citations_dead: 'review_exception',
      application_source_only: 'source_description',
      archive_review: 'suppression',
      blank_public_description: 'source_description',
      citations_identify_no_person: 'review_exception',
      content_page_risk: 'suppression',
      duplicate_name_risk: 'pi_identity',
      duplicate_risk: 'pi_identity',
      exact_url_duplicate_risk: 'suppression',
      formalization_only: 'review_exception',
      generic_directory_shell: 'suppression',
      grant_only_no_current_yale_source: 'suppression',
      inactive_at_yale: 'suppression',
      lab_name_org_type_mismatch: 'review_exception',
      missing_action_evidence: 'action_evidence',
      missing_alternate_access_path: 'action_evidence',
      missing_application_route: 'action_evidence',
      missing_card_description: 'source_description',
      missing_description: 'source_description',
      missing_facet_signal: 'review_exception',
      missing_lead: 'pi_identity',
      missing_official_source: 'source_description',
      missing_source_route: 'action_evidence',
      missing_source_url: 'source_description',
      non_owner_grant_shell: 'suppression',
      non_research_entity: 'suppression',
      non_research_program: 'suppression',
      not_undergraduate_relevant: 'suppression',
      permanently_closed: 'suppression',
      profile_biography_shell: 'suppression',
      profile_fallback_only: 'source_description',
      profile_identity_risk: 'pi_identity',
      public_description_invariant_failed: 'source_description',
      research_infrastructure_only: 'suppression',
      thin_description: 'source_description',
      unusable_name: 'review_exception',
    };

    expect(Object.keys(expectedStageByReason).sort()).toEqual([...EVERY_BLOCKER_REASON].sort());

    const actualStageByReason = Object.fromEntries(
      EVERY_BLOCKER_REASON.map((reason) => [reason, classifyVisibilityRepairStage([reason])]),
    );

    expect(actualStageByReason).toEqual(expectedStageByReason);
  });

  it('keeps both writers of the stored column on one definition', () => {
    const queueSource = readFileSync(
      new URL('../visibilityRepairQueueService.ts', import.meta.url),
      'utf8',
    );

    expect(queueSource).toContain('repairStageForReasons(reasons)');
    for (const ownReasonSet of [
      'const piReasons',
      'const actionReasons',
      'const suppressionReasons',
    ]) {
      expect(queueSource).not.toContain(ownReasonSet);
    }
  });

  it('routes a row held only by a missing alternate access path to a repair lane', () => {
    const plan = buildVisibilityRepairPlan({
      _id: 'probe',
      collection: 'research',
      recordId: 'probe-row',
      label: 'probe-row',
      blockerReasons: ['missing_alternate_access_path'],
    } as any);

    expect(plan.repairStage).toBe('action_evidence');
    expect(plan.safeToAttempt).toBe(true);
  });

  it('stages an operator suppression marker as suppression rather than a review exception', () => {
    for (const reason of [
      'permanently_closed',
      'non_research_entity',
      'non_research_program',
      'non_owner_grant_shell',
      'grant_only_no_current_yale_source',
      'profile_biography_shell',
    ]) {
      expect(classifyVisibilityRepairStage([reason])).toBe('suppression');
    }
  });

  it('never reports a repair-attempting stage for a reason no lane can act on', () => {
    for (const reason of EVERY_BLOCKER_REASON) {
      const stage = classifyVisibilityRepairStage([reason]);
      if (!REPAIR_ATTEMPTING_STAGES.has(stage)) continue;
      const owned =
        SOURCE_DESCRIPTION_REPAIR_REASONS.has(reason) ||
        PI_IDENTITY_REPAIR_REASONS.has(reason) ||
        ACTION_EVIDENCE_REPAIR_REASONS.has(reason);
      expect(owned, `${reason} staged ${stage} but no repair lane owns it`).toBe(true);
    }
  });

  // The queue may hide a row unattended for only some suppression reasons. That is a
  // narrower question than stage ownership, so the two sets are allowed to differ in
  // size, but never in direction: an auto-suppressible reason that the shared set does
  // not stage as suppression would let the queue hide a row no lane staged for hiding.
  it('permits unattended suppression only for reasons the shared set stages as suppression', () => {
    const notStagedAsSuppression = [...QUEUE_AUTO_SUPPRESSIBLE_REASONS].filter(
      (reason) => !SUPPRESSION_REPAIR_REASONS.has(reason),
    );

    expect(notStagedAsSuppression).toEqual([]);
    expect(QUEUE_AUTO_SUPPRESSIBLE_REASONS.size).toBeLessThanOrEqual(
      SUPPRESSION_REPAIR_REASONS.size,
    );
  });

  it('keeps the reason sets disjoint so stage order cannot hide a reclassification', () => {
    const sets = {
      source_description: SOURCE_DESCRIPTION_REPAIR_REASONS,
      pi_identity: PI_IDENTITY_REPAIR_REASONS,
      action_evidence: ACTION_EVIDENCE_REPAIR_REASONS,
      review_exception: REVIEW_EXCEPTION_REPAIR_REASONS,
    };
    const overlaps: string[] = [];
    for (const [leftName, left] of Object.entries(sets)) {
      for (const [rightName, right] of Object.entries(sets)) {
        if (leftName >= rightName) continue;
        for (const reason of left) {
          if (right.has(reason)) overlaps.push(`${reason}: ${leftName} and ${rightName}`);
        }
      }
    }

    expect(overlaps).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';

import {
  computeProgramStudentVisibility,
  computeResearchEntityStudentVisibility,
} from '../studentVisibilityTier';

describe('computeResearchEntityStudentVisibility', () => {
  it('marks a source-backed research home with a lead and action evidence as student ready', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        shortDescription:
          'Studies causal inference methods for public health research, with projects on clinical decision-making, population health datasets, and policy evaluation.',
        fullDescription:
          'The lab studies causal inference methods for public health research. Current projects examine clinical decision-making, population health datasets, policy evaluation, and statistical tools for estimating treatment effects in complex observational settings.',
        sourceUrls: ['https://medicine.yale.edu/example-lab'],
        activeAtYaleCache: true,
      },
      leadMembers: [{ userId: 'user-1', role: 'pi' }],
      accessSignalCount: 1,
      actionablePathwayCount: 1,
      openPostedOpportunityCount: 0,
    });

    expect(result.tier).toBe('student_ready');
    expect(result.reasons).toContain('source_backed_description');
    expect(result.reasons).toContain('concrete_next_step');
  });

  it('keeps a strong profile without action evidence limited rather than ready', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        shortDescription:
          'Studies archival collections and early modern book history, with projects on manuscripts, material culture, and public humanities methods.',
        fullDescription:
          'The group studies archival collections and early modern book history. Current projects examine manuscripts, material culture, public humanities methods, and the circulation of texts across libraries and collections.',
        sourceUrls: ['https://history.yale.edu/example'],
        activeAtYaleCache: true,
      },
      leadMembers: [{ userId: 'user-1', role: 'pi' }],
      accessSignalCount: 0,
      actionablePathwayCount: 0,
      openPostedOpportunityCount: 0,
    });

    expect(result.tier).toBe('limited_but_safe');
    expect(result.reasons).toContain('missing_action_evidence');
  });

  it('keeps profile fallback rows without action evidence in operator review', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        profileSynthesisDescription:
          'Faculty profile context indicates research in computational biology and translational genomics.',
        sourceUrls: ['https://medicine.yale.edu/example-profile'],
        activeAtYaleCache: true,
      },
      leadMembers: [{ userId: 'user-1', role: 'pi' }],
      accessSignalCount: 0,
      actionablePathwayCount: 0,
      openPostedOpportunityCount: 0,
    });

    expect(result.tier).toBe('operator_review');
    expect(result.reasons).toContain('profile_fallback_only');
    expect(result.reasons).toContain('missing_action_evidence');
  });

  it('keeps profile fallback rows limited when concrete action evidence exists', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        profileSynthesisDescription:
          'Faculty profile context indicates research in computational biology and translational genomics.',
        sourceUrls: ['https://medicine.yale.edu/example-profile'],
        activeAtYaleCache: true,
      },
      leadMembers: [{ userId: 'user-1', role: 'pi' }],
      accessSignalCount: 1,
      actionablePathwayCount: 0,
      openPostedOpportunityCount: 0,
    });

    expect(result.tier).toBe('limited_but_safe');
    expect(result.reasons).toContain('profile_fallback_only');
    expect(result.reasons).toContain('concrete_next_step');
  });

  it('routes missing source or lead records to operator review', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        shortDescription: 'Short profile.',
        sourceUrls: [],
      },
      leadMembers: [],
      accessSignalCount: 0,
      actionablePathwayCount: 0,
      openPostedOpportunityCount: 0,
    });

    expect(result.tier).toBe('operator_review');
    expect(result.reasons).toEqual(
      expect.arrayContaining(['missing_lead', 'missing_source_url']),
    );
  });

  it('lets manual suppression override computed readiness', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        shortDescription:
          'Studies causal inference methods for public health research, with projects on clinical decision-making, population health datasets, and policy evaluation.',
        fullDescription:
          'The lab studies causal inference methods for public health research. Current projects examine clinical decision-making, population health datasets, policy evaluation, and statistical tools for estimating treatment effects in complex observational settings.',
        sourceUrls: ['https://medicine.yale.edu/example-lab'],
        studentVisibilityOverrideTier: 'suppressed',
        studentVisibilitySuppressionReason: 'Duplicate record',
      },
      leadMembers: [{ userId: 'user-1', role: 'pi' }],
      accessSignalCount: 1,
      actionablePathwayCount: 1,
      openPostedOpportunityCount: 0,
    });

    expect(result.tier).toBe('suppressed');
    expect(result.computedTier).toBe('student_ready');
    expect(result.reasons).toContain('operator_override');
  });

  it('does not let a public override promote content-page leaks', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        shortDescription:
          'Studies patient stories, clinical news, and blog updates from a Yale Medicine content page.',
        fullDescription:
          'Studies patient stories, clinical news, and blog updates from a Yale Medicine content page with a source URL that should not be treated as a research home.',
        sourceUrls: ['https://medicine.yale.edu/lab/urology-mens-health-blog/'],
        studentVisibilityOverrideTier: 'limited_but_safe',
        studentVisibilityReviewRuleId: 'reviewed_non_person_owner_source_action_v1',
      },
      leadMembers: [{ userId: 'user-1', role: 'pi' }],
      accessSignalCount: 1,
      contentPageRisk: true,
    });

    expect(result.tier).toBe('suppressed');
    expect(result.computedTier).toBe('suppressed');
    expect(result.reasons).toContain('content_page_risk');
    expect(result.reasons).not.toContain('operator_override');
  });

  it('preserves the operator approval rule reason when an override is present', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        shortDescription:
          'Studies public humanities research questions through community archives, collections, and historical interpretation projects.',
        fullDescription:
          'This research home studies public humanities research questions through community archives, collections, and historical interpretation projects with source-backed student-facing context.',
        sourceUrls: ['https://humanities.yale.edu/example'],
        studentVisibilityOverrideTier: 'limited_but_safe',
        studentVisibilityReviewRuleId: 'reviewed_non_person_owner_source_action_v1',
      },
      leadMembers: [],
      accessSignalCount: 1,
      actionablePathwayCount: 0,
      openPostedOpportunityCount: 0,
    });

    expect(result.tier).toBe('limited_but_safe');
    expect(result.computedTier).toBe('operator_review');
    expect(result.reasons).toContain('operator_override');
    expect(result.reasons).toContain('reviewed_non_person_owner_source_action_v1');
  });
});

describe('computeProgramStudentVisibility', () => {
  it('marks sourced undergraduate programs with an application route as student ready', () => {
    const result = computeProgramStudentVisibility({
      title: 'STARS Summer Research Program',
      studentFacingCategory: 'Structured summer program',
      sourceUrl: 'https://science.yalecollege.yale.edu/stars',
      applicationLink: 'https://apply.yale.edu/stars',
      undergraduateOnly: true,
    });

    expect(result.tier).toBe('student_ready');
    expect(result.reasons).toContain('official_source');
    expect(result.reasons).toContain('application_route');
  });

  it('keeps official but ambiguous program records in review', () => {
    const result = computeProgramStudentVisibility({
      title: 'Research Travel Funding',
      studentFacingCategory: 'Research travel funding',
      sourceUrl: 'https://yalecollege.yale.edu/funding',
      applicationLink: '',
    });

    expect(result.tier).toBe('operator_review');
    expect(result.reasons).toContain('missing_application_route');
  });

  it('keeps official routed programs in review until undergraduate relevance is known', () => {
    const result = computeProgramStudentVisibility({
      title: 'Research Travel Funding',
      studentFacingCategory: 'Research travel funding',
      sourceUrl: 'https://yalecollege.yale.edu/funding',
      applicationLink: 'https://apply.yale.edu/funding',
    });

    expect(result.tier).toBe('operator_review');
    expect(result.reasons).toContain('official_source');
    expect(result.reasons).not.toContain('undergraduate_relevant');
  });

  it('caps application-portal-only undergraduate programs at limited visibility', () => {
    const result = computeProgramStudentVisibility({
      title: 'Senior Research Fellowship',
      studentFacingCategory: 'Senior research funding',
      sourceUrl: 'https://yale.communityforce.com/Funds/FundDetails.aspx?abc123',
      applicationLink: 'https://yale.communityforce.com/Funds/FundDetails.aspx?abc123',
      undergraduateOnly: true,
    });

    expect(result.tier).toBe('limited_but_safe');
    expect(result.reasons).toContain('application_source_only');
  });

  it('suppresses graduate-only programs', () => {
    const result = computeProgramStudentVisibility({
      title: 'Graduate Dissertation Research Fellowship',
      studentFacingCategory: 'Archive / review',
      sourceUrl: 'https://example.yale.edu',
      applicationLink: 'https://apply.example.yale.edu',
      undergraduateOnly: false,
    });

    expect(result.tier).toBe('suppressed');
    expect(result.reasons).toContain('not_undergraduate_relevant');
  });
});

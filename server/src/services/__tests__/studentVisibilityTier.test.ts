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
        entityType: 'LAB',
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

  it('keeps a lab with no PI or lead in review even when it has action evidence', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        entityType: 'LAB',
        shortDescription:
          'Studies efficient systems for artificial intelligence and quantum computing through model serving, operating systems, and quantum error correction methods.',
        fullDescription:
          'The lab studies efficient systems for artificial intelligence and quantum computing through model serving, operating systems, and quantum error correction methods, with source-backed projects and current research directions.',
        sourceUrls: ['https://engineering.yale.edu/example-lab'],
        activeAtYaleCache: true,
      },
      leadMembers: [{ role: 'affiliate', name: 'Unclear Person' }],
      accessSignalCount: 1,
      actionablePathwayCount: 1,
      publicContactRouteCount: 1,
      publicContactRouteTypes: ['FACULTY_PI'],
    });

    expect(result.tier).toBe('operator_review');
    expect(result.reasons).toEqual(
      expect.arrayContaining(['missing_lab_lead', 'concrete_next_step']),
    );
  });

  it('marks an official program with an application route ready without PI-style lead evidence', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        entityType: 'PROGRAM',
        shortDescription:
          'A structured summer research program connecting undergraduates with Yale research mentors, skill-building seminars, and funded project placements.',
        fullDescription:
          'The program connects undergraduates with Yale research mentors through funded summer project placements, public application instructions, skill-building seminars, and source-backed program expectations.',
        sourceUrls: ['https://science.yalecollege.yale.edu/example-program'],
        activeAtYaleCache: true,
      },
      leadMembers: [],
      actionablePathwayCount: 1,
      actionablePathwayTypes: ['RECURRING_PROGRAM'],
      publicContactRouteCount: 1,
      publicContactRouteTypes: ['OFFICIAL_APPLICATION'],
    });

    expect(result.tier).toBe('student_ready');
    expect(result.reasons).toEqual(
      expect.arrayContaining(['program_official_source', 'program_action_route']),
    );
    expect(result.reasons).not.toContain('missing_lab_lead');
    expect(result.reasons).not.toContain('missing_lead');
  });

  it('keeps a thin official program with a public contact route limited but safe', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        entityType: 'PROGRAM',
        shortDescription:
          'Undergraduate research program with a public program contact and annual project matching.',
        sourceUrls: ['https://example.yale.edu/research-program'],
        activeAtYaleCache: true,
      },
      leadMembers: [],
      publicContactRouteCount: 1,
      publicContactRouteTypes: ['PROGRAM_MANAGER'],
    });

    expect(result.tier).toBe('limited_but_safe');
    expect(result.reasons).toEqual(
      expect.arrayContaining(['program_official_source', 'program_action_route']),
    );
    expect(result.reasons).not.toContain('missing_lab_lead');
    expect(result.reasons).not.toContain('missing_lead');
  });

  it('keeps official programs without a public action route in review', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        entityType: 'PROGRAM',
        shortDescription:
          'A structured undergraduate research program with seminars, cohort support, and faculty-connected project work.',
        fullDescription:
          'The program supports undergraduate research through seminars, cohort support, source-backed expectations, and faculty-connected project work across Yale research settings.',
        sourceUrls: ['https://example.yale.edu/program-overview'],
        activeAtYaleCache: true,
      },
      leadMembers: [],
      accessSignalCount: 0,
      actionablePathwayCount: 0,
      publicContactRouteCount: 0,
    });

    expect(result.tier).toBe('operator_review');
    expect(result.reasons).toContain('missing_program_action_route');
    expect(result.reasons).not.toContain('missing_lab_lead');
  });

  it('keeps a faculty research area limited only when exploratory framing exists', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        entityType: 'FACULTY_RESEARCH_AREA',
        shortDescription:
          'Studies computational biology, statistical learning, and translational genomics through faculty-led research projects and student-facing research questions.',
        fullDescription:
          'This faculty research area studies computational biology, statistical learning, and translational genomics through faculty-led research projects, public profile context, and source-backed research descriptions.',
        sourceUrls: ['https://medicine.yale.edu/profile/example-faculty'],
        activeAtYaleCache: true,
      },
      leadMembers: [{ userId: 'user-1', role: 'pi' }],
      actionablePathwayCount: 1,
      actionablePathwayTypes: ['EXPLORATORY_CONTACT'],
      publicContactRouteCount: 1,
      publicContactRouteTypes: ['FACULTY_PI'],
    });

    expect(result.tier).toBe('limited_but_safe');
    expect(result.reasons).toEqual(
      expect.arrayContaining(['faculty_identity_attached', 'exploratory_framing']),
    );
  });

  it('keeps profile-only faculty research areas in review without exploratory framing', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        entityType: 'FACULTY_RESEARCH_AREA',
        shortDescription:
          'Studies computational biology, statistical learning, and translational genomics through faculty-led research projects and source-backed research descriptions.',
        fullDescription:
          'This faculty research area studies computational biology, statistical learning, and translational genomics through faculty-led research projects and public profile context.',
        sourceUrls: ['https://medicine.yale.edu/profile/example-faculty'],
        activeAtYaleCache: true,
      },
      leadMembers: [{ userId: 'user-1', role: 'pi' }],
      accessSignalCount: 0,
      actionablePathwayCount: 0,
      publicContactRouteCount: 0,
    });

    expect(result.tier).toBe('operator_review');
    expect(result.reasons).toContain('missing_exploratory_framing');
  });

  it('allows an official center to be limited as an affiliation index without PI-style lead evidence', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        entityType: 'CENTER',
        shortDescription:
          'The center supports cancer research across immunology, prevention, genomics, clinical trials, and precision medicine through affiliated faculty and programs.',
        fullDescription:
          'The center supports cancer research across immunology, prevention, genomics, clinical trials, and precision medicine through affiliated faculty, member labs, shared programs, and source-backed center activity.',
        sourceUrls: ['https://medicine.yale.edu/cancer/research/membership/directory'],
        activeAtYaleCache: true,
      },
      leadMembers: [],
      accessSignalCount: 0,
      actionablePathwayCount: 0,
      publicContactRouteCount: 0,
    });

    expect(result.tier).toBe('limited_but_safe');
    expect(result.reasons).toEqual(
      expect.arrayContaining(['center_official_source', 'center_affiliation_index']),
    );
    expect(result.reasons).not.toContain('missing_lead');
  });

  it('marks a center ready when it has a public program or contact route', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        entityType: 'CENTER',
        shortDescription:
          'The center supports data science research through seminars, research programs, affiliated faculty, and public student-facing project routes.',
        fullDescription:
          'The center supports data science research through seminars, research programs, affiliated faculty, public student-facing project routes, and source-backed center activity.',
        sourceUrls: ['https://datascience.yale.edu/research'],
        activeAtYaleCache: true,
      },
      leadMembers: [],
      actionablePathwayCount: 1,
      actionablePathwayTypes: ['CENTER_INTERNSHIP'],
      publicContactRouteCount: 1,
      publicContactRouteTypes: ['PROGRAM_MANAGER'],
    });

    expect(result.tier).toBe('student_ready');
    expect(result.reasons).toEqual(
      expect.arrayContaining(['center_official_source', 'center_action_route']),
    );
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

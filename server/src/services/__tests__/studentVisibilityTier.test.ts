import { describe, expect, it } from 'vitest';

import {
  computeProgramStudentVisibility,
  computeResearchEntityStudentVisibility,
  hasProfileAreaShellDuplicateRisk,
} from '../studentVisibilityTier';

describe('computeResearchEntityStudentVisibility', () => {
  it('blocks student-ready visibility for same-person profile-area shell duplicates', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        _id: 'profile-shell',
        name: 'Yongli Zhang Research',
        slug: 'faculty-research-area-yongli-zhang',
        kind: 'individual',
        entityType: 'FACULTY_RESEARCH_AREA',
        shortDescription: 'Source-backed research profile.',
        fullDescription: 'Source-backed research profile with enough detail for student display.',
        sourceUrls: ['https://medicine.yale.edu/profile/yongli-zhang/'],
      },
      leadMembers: [{ userId: 'yz52', role: 'pi' }],
      accessSignalCount: 1,
      actionablePathwayCount: 1,
      duplicateRisk: true,
    });

    expect(result.tier).toBe('operator_review');
    expect(result.reasons).toContain('duplicate_risk');
  });

  it('suppresses exact-url duplicate shells while preserving the duplicate review signal', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        _id: 'duplicate-shell',
        name: 'Aaron Gerow Faculty Research',
        slug: 'dept-eall-aaron-gerow',
        shortDescription: '',
        fullDescription: '',
        sourceUrls: ['http://www.aarongerow.com/'],
      },
      leadMembers: [],
      accessSignalCount: 0,
      actionablePathwayCount: 0,
      exactUrlDuplicateRisk: true,
    });

    expect(result.tier).toBe('suppressed');
    expect(result.computedTier).toBe('suppressed');
    expect(result.reasons).toEqual(
      expect.arrayContaining(['exact_url_duplicate_risk', 'duplicate_risk']),
    );
  });

  it('does not require a PI lead for source-backed program-like research guidance', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        _id: 'department-undergrad-research-chemistry',
        name: 'Chemistry Undergraduate Research',
        slug: 'department-undergrad-research-chemistry',
        kind: 'program',
        entityType: 'PROGRAM',
        shortDescription:
          'Supports undergraduate research in Chemistry through department guidance on finding faculty research opportunities.',
        fullDescription:
          'Supports undergraduate research in Chemistry. Students interested in research should contact the faculty member directly via email to explore opportunities.',
        sourceUrls: [
          'https://chem.yale.edu/academics/undergraduate-chemistry-at-yale/undergraduate-research',
        ],
      },
      leadMembers: [],
      accessSignalCount: 1,
      actionablePathwayCount: 1,
    });

    expect(result.tier).toBe('student_ready');
    expect(result.reasons).not.toContain('missing_lead');
    expect(result.reasons).toEqual(
      expect.arrayContaining(['source_backed_description', 'concrete_next_step']),
    );
  });

  it('does not require a named director for source-backed organizational research homes (centers/institutes)', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        _id: 'center-industrial-ecology',
        name: 'Center for Industrial Ecology',
        slug: 'yse-industrial-ecology',
        entityType: 'CENTER',
        shortDescription:
          'Advances the study of industrial ecology, material flows, and sustainable systems at Yale.',
        fullDescription:
          'The Center for Industrial Ecology advances research on material and energy flows, life-cycle assessment, and sustainable industrial systems through interdisciplinary collaboration.',
        websiteUrl: 'https://environment.yale.edu/research/centers/industrial-ecology',
      },
      leadMembers: [],
      accessSignalCount: 1,
      actionablePathwayCount: 1,
    });

    expect(result.tier).toBe('student_ready');
    expect(result.reasons).not.toContain('missing_lead');
  });

  it('holds an organizational home that has no action evidence yet as limited_but_safe, not missing_lead', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        _id: 'center-no-action',
        name: 'Yale Center for Example Studies',
        slug: 'center-example',
        entityType: 'INSTITUTE',
        shortDescription: 'Supports interdisciplinary research on example studies across Yale.',
        fullDescription:
          'The Yale Center for Example Studies convenes faculty and students for interdisciplinary research on example studies, hosting seminars and collaborative projects.',
        websiteUrl: 'https://example.yale.edu/center',
      },
      leadMembers: [],
      accessSignalCount: 0,
      actionablePathwayCount: 0,
    });

    expect(result.reasons).not.toContain('missing_lead');
    expect(result.tier).toBe('limited_but_safe');
  });

  it('suppresses generic directory-only faculty-area shells', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        _id: 'directory-shell',
        name: 'Anna Arnal Estape Research',
        slug: 'faculty-research-area-anna-arnal-estape',
        kind: 'individual',
        entityType: 'FACULTY_RESEARCH_AREA',
        websiteUrl: 'https://wti.yale.edu/humans/faculty',
        sourceUrls: ['https://wti.yale.edu/humans/faculty'],
        shortDescription: '',
        fullDescription: '',
        researchAreas: [],
      },
      leadMembers: [],
      accessSignalCount: 0,
      actionablePathwayCount: 0,
      openPostedOpportunityCount: 0,
    });

    expect(result.tier).toBe('suppressed');
    expect(result.computedTier).toBe('suppressed');
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        'generic_directory_shell',
        'missing_description',
        'missing_lead',
        'missing_action_evidence',
      ]),
    );
  });

  it('suppresses grant-only lab shells for matched non-owner research staff', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        _id: 'grant-shell',
        name: 'James Hutchison Lab',
        slug: 'nih-pi-james-hutchison',
        kind: 'lab',
        entityType: 'LAB',
        shortDescription: 'Source-backed grant summary.',
        fullDescription: 'Source-backed grant summary with enough detail for student display.',
        sourceUrls: [
          'https://reporter.nih.gov/project-details/10824067',
          'https://orcid.org/0000-0002-5529-3248',
        ],
      },
      leadMembers: [
        {
          role: 'pi',
          userId: {
            _id: 'user-hutchison',
            title: 'Postdoctoral Associate in Pharmacology',
          },
        },
      ],
      accessSignalCount: 0,
      actionablePathwayCount: 0,
      openPostedOpportunityCount: 0,
    });

    expect(result.tier).toBe('suppressed');
    expect(result.computedTier).toBe('suppressed');
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        'non_owner_grant_shell',
        'missing_action_evidence',
      ]),
    );
  });

  it('keeps sparse faculty-area shells with a specific profile source in operator review', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        _id: 'profile-shell',
        name: 'Anna Arnal Estape Research',
        slug: 'faculty-research-area-anna-arnal-estape',
        kind: 'individual',
        entityType: 'FACULTY_RESEARCH_AREA',
        sourceUrls: ['https://medicine.yale.edu/profile/anna-arnal-estape/'],
        shortDescription: '',
        fullDescription: '',
        researchAreas: [],
      },
      leadMembers: [],
      accessSignalCount: 0,
      actionablePathwayCount: 0,
      openPostedOpportunityCount: 0,
    });

    expect(result.tier).toBe('operator_review');
    expect(result.reasons).not.toContain('generic_directory_shell');
    expect(result.reasons).not.toContain('profile_biography_shell');
  });

  it('suppresses profile-only biography faculty-area shells', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        _id: 'profile-biography-shell',
        name: 'Harry Sanchez Research',
        slug: 'faculty-research-area-harry-sanchez',
        kind: 'individual',
        entityType: 'FACULTY_RESEARCH_AREA',
        websiteUrl: 'https://medicine.yale.edu/cancer/profile/harold-sanchez/',
        sourceUrls: [
          'https://medicine.yale.edu/cancer/research/membership/directory',
          'https://medicine.yale.edu/cancer/profile/harold-sanchez/',
        ],
        shortDescription:
          'Dr. Sanchez received his undergraduate degree at Fairfield University, his medical degree at SUNY Stony Brook, and did his residency in anatomic and clinical pathology at Yale New Haven Hospital.',
        fullDescription:
          'Dr. Sanchez received his undergraduate degree at Fairfield University, his medical degree at SUNY Stony Brook, and did his residency in anatomic and clinical pathology at Yale New Haven Hospital. He worked as a community pathologist before joining Yale School of Medicine.',
        researchAreas: [],
      },
      leadMembers: [],
      accessSignalCount: 0,
      actionablePathwayCount: 0,
      openPostedOpportunityCount: 0,
    });

    expect(result.tier).toBe('suppressed');
    expect(result.computedTier).toBe('suppressed');
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        'profile_biography_shell',
        'thin_description',
        'missing_lead',
        'missing_action_evidence',
      ]),
    );
  });

  it('keeps source-backed profile research areas in operator review instead of suppressing them', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        _id: 'profile-research-area',
        name: 'James Hansen Research',
        slug: 'faculty-research-area-james-e-hansen',
        kind: 'individual',
        entityType: 'FACULTY_RESEARCH_AREA',
        websiteUrl: 'https://medicine.yale.edu/cancer/profile/james-e-hansen/',
        sourceUrls: [
          'https://medicine.yale.edu/cancer/research/membership/directory',
          'https://medicine.yale.edu/profile/james-e-hansen/',
        ],
        shortDescription:
          'Studies neoplasms, parathyroid disorders and treatments, and immunotherapy and immune responses.',
        fullDescription:
          'Research fields include neoplasms, parathyroid disorders and treatments, and immunotherapy and immune responses.',
        researchAreas: [],
      },
      leadMembers: [],
      accessSignalCount: 0,
      actionablePathwayCount: 0,
      openPostedOpportunityCount: 0,
    });

    expect(result.tier).toBe('operator_review');
    expect(result.reasons).toContain('source_backed_description');
    expect(result.reasons).not.toContain('profile_biography_shell');
  });

  it('recognizes a person-name faculty profile area as duplicate risk when a concrete home exists', () => {
    expect(
      hasProfileAreaShellDuplicateRisk({
        entity: {
          name: 'Yongli Zhang Research',
          slug: 'faculty-research-area-yongli-zhang',
          kind: 'individual',
          entityType: 'FACULTY_RESEARCH_AREA',
        },
        leadMembers: [{ userId: 'yz52' }],
        concreteLeadEntityUserIds: new Set(['yz52']),
      }),
    ).toBe(true);

    expect(
      hasProfileAreaShellDuplicateRisk({
        entity: {
          name: 'Ada Lovelace Research',
          slug: 'faculty-research-area-ada-lovelace',
          kind: 'individual',
          entityType: 'FACULTY_RESEARCH_AREA',
        },
        leadMembers: [{ userId: 'ada' }],
        concreteLeadEntityUserIds: new Set(),
      }),
    ).toBe(false);
  });

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
          'Studies causal inference methods for public health research, with projects on clinical decision-making, population health datasets, and policy evaluation.',
        fullDescription:
          'The lab studies causal inference methods for public health research. Its research examines clinical decision-making, population health datasets, policy evaluation, and statistical tools for estimating treatment effects in complex observational settings.',
        sourceUrls: ['https://medicine.yale.edu/example-lab'],
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

  it('keeps source-backed records in operator review until the student-facing card description is usable', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        shortDescription: '',
        fullDescription:
          'The lab studies quantum simulation, ultracold atoms, optical lattices, and topology in many-body physics. Current projects examine how unusual lattice geometries shape quantum behavior.',
        sourceUrls: ['https://physics.yale.edu/example-lab'],
        activeAtYaleCache: true,
      },
      leadMembers: [{ userId: 'user-1', role: 'pi' }],
      accessSignalCount: 1,
      actionablePathwayCount: 1,
      openPostedOpportunityCount: 0,
    });

    expect(result.tier).toBe('operator_review');
    expect(result.computedTier).toBe('operator_review');
    expect(result.reasons).toContain('missing_card_description');
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

  it('keeps profile fallback rows in operator review even when concrete action evidence exists', () => {
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

    expect(result.tier).toBe('operator_review');
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

  it('keeps records with conflicting PI identity out of public tiers', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        shortDescription:
          'Studies film and media theory, communication history, cultural technique, and humanities approaches to transmission.',
        fullDescription:
          'The research examines film and media theory, communication history, cultural technique, and humanities approaches to transmission, infrastructure, and materiality.',
        sourceUrls: ['https://filmstudies.yale.edu/people/john-durham-peters'],
      },
      leadMembers: [
        {
          role: 'pi',
          userId: 'wrong-user',
          facultyMemberId: 'correct-faculty',
          user: { facultyMemberId: 'wrong-faculty' },
        },
      ],
      accessSignalCount: 1,
      actionablePathwayCount: 1,
    });

    expect(result.tier).toBe('operator_review');
    expect(result.reasons).toContain('pi_identity_conflict');
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

  it('suppresses records with explicit infrastructure-only review reasons', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        shortDescription: '',
        fullDescription: '',
        sourceUrls: ['https://research.yale.edu/cores'],
        studentVisibilitySuppressionReason: 'research_infrastructure_only',
      },
      leadMembers: [],
      accessSignalCount: 0,
      actionablePathwayCount: 0,
      openPostedOpportunityCount: 0,
    });

    expect(result.tier).toBe('suppressed');
    expect(result.computedTier).toBe('suppressed');
    expect(result.reasons).toContain('research_infrastructure_only');
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

  it('caps enriched fellowship funding programs at limited visibility', () => {
    const result = computeProgramStudentVisibility({
      title: 'Senior Research Fellowship',
      studentFacingCategory: 'Senior research funding',
      programKind: 'FELLOWSHIP_FUNDING',
      sourceUrl: 'https://yalecollege.yale.edu/funding/senior-research-fellowship',
      applicationLink: 'https://yale.communityforce.com/Funds/FundDetails.aspx?abc123',
      undergraduateOnly: true,
    });

    expect(result.tier).toBe('limited_but_safe');
    expect(result.reasons).toContain('formalization_only');
    expect(result.reasons).toContain('official_source');
    expect(result.reasons).toContain('application_route');
  });

  it('caps travel and thesis funding programs at limited visibility', () => {
    const travel = computeProgramStudentVisibility({
      title: 'Research Travel Grant',
      studentFacingCategory: 'Research travel funding',
      programKind: 'TRAVEL_RESEARCH_GRANT',
      sourceUrl: 'https://yalecollege.yale.edu/travel-research',
      applicationLink: 'https://apply.yale.edu/travel-research',
      undergraduateOnly: true,
    });
    const thesis = computeProgramStudentVisibility({
      title: 'Senior Thesis Funding',
      studentFacingCategory: 'Senior research funding',
      programKind: 'SENIOR_THESIS_FUNDING',
      sourceUrl: 'https://yalecollege.yale.edu/senior-thesis-funding',
      applicationLink: 'https://apply.yale.edu/senior-thesis',
      undergraduateOnly: true,
    });

    expect(travel.tier).toBe('limited_but_safe');
    expect(travel.reasons).toContain('formalization_only');
    expect(thesis.tier).toBe('limited_but_safe');
    expect(thesis.reasons).toContain('formalization_only');
  });

  it('keeps structured and mentor-matching programs eligible for student-ready', () => {
    const structured = computeProgramStudentVisibility({
      title: 'STARS Summer Research Program',
      studentFacingCategory: 'Structured summer program',
      programKind: 'STRUCTURED_PROGRAM',
      entryMode: 'SECURE_MENTOR_THEN_APPLY',
      sourceUrl: 'https://science.yalecollege.yale.edu/stars',
      applicationLink: 'https://apply.yale.edu/stars',
      undergraduateOnly: true,
    });
    const mentorMatching = computeProgramStudentVisibility({
      title: 'Mentor Matching Fellowship',
      studentFacingCategory: 'Structured fellowship program',
      programKind: 'MENTOR_MATCHING',
      entryMode: 'DIRECT_FACULTY_MATCHING',
      mentorMatching: true,
      sourceUrl: 'https://science.yalecollege.yale.edu/mentor-match',
      applicationLink: 'https://apply.yale.edu/mentor-match',
      undergraduateOnly: true,
    });

    expect(structured.tier).toBe('student_ready');
    expect(structured.reasons).not.toContain('formalization_only');
    expect(mentorMatching.tier).toBe('student_ready');
    expect(mentorMatching.reasons).not.toContain('formalization_only');
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

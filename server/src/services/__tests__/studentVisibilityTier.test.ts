import { describe, expect, it } from 'vitest';

import {
  BLANK_PUBLIC_DESCRIPTION_REASON,
  computeProgramStudentVisibility,
  computeResearchEntityStudentVisibility,
  enforceStudentReadyDescriptionInvariant,
  hasProfileAreaShellDuplicateRisk,
  recordHasNoUsablePublicDescription,
} from '../studentVisibilityTier';

describe('computeResearchEntityStudentVisibility', () => {
  it('blocks raw descriptions that become empty after lead-aware public sanitization', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        _id: 'public-empty-fixture',
        name: 'Correct Person Faculty Research',
        slug: 'correct-person-research',
        kind: 'individual',
        entityType: 'FACULTY_RESEARCH_AREA',
        descriptionSource: 'PI_PROFILE_SYNTHESIS',
        shortDescription:
          "Wrong Person's expertise lies in molecular dynamics, protein folding, and cellular signaling.",
        fullDescription:
          "Wrong Person's expertise lies in molecular dynamics, protein folding, and cellular signaling across complex biological systems.",
        sourceUrls: ['https://example.yale.edu/profile/correct-person'],
      },
      leadMembers: [
        {
          role: 'pi',
          userId: 'correct-person',
          user: { fname: 'Correct', lname: 'Person' },
        },
      ],
      accessSignalCount: 1,
      actionablePathwayCount: 1,
    });

    expect(result.tier).toBe('operator_review');
    expect(result.computedTier).toBe('operator_review');
    expect(result.reasons).toEqual(
      expect.arrayContaining(['missing_description', 'missing_card_description']),
    );
  });

  it('does not let a student-ready override bypass the public description invariant', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        _id: 'overridden-public-empty-fixture',
        name: 'Correct Person Faculty Research',
        slug: 'correct-person-research',
        kind: 'individual',
        entityType: 'FACULTY_RESEARCH_AREA',
        descriptionSource: 'PI_PROFILE_SYNTHESIS',
        studentVisibilityOverrideTier: 'student_ready',
        shortDescription:
          "Wrong Person's expertise lies in molecular dynamics, protein folding, and cellular signaling.",
        fullDescription:
          "Wrong Person's expertise lies in molecular dynamics, protein folding, and cellular signaling across complex biological systems.",
        sourceUrls: ['https://example.yale.edu/profile/correct-person'],
      },
      leadMembers: [
        {
          role: 'pi',
          user: { fname: 'Correct', lname: 'Person' },
        },
      ],
      accessSignalCount: 1,
    });

    expect(result.tier).toBe('operator_review');
    expect(result.reasons).toEqual(
      expect.arrayContaining(['operator_override', 'public_description_invariant_failed']),
    );
  });

  it('requires a useful full description for student-ready visibility', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        _id: 'missing-public-full-description',
        name: 'Correct Person Faculty Research',
        kind: 'individual',
        entityType: 'FACULTY_RESEARCH_AREA',
        shortDescription: 'Studies molecular dynamics, protein folding, and cellular signaling.',
        fullDescription: '',
        sourceUrls: ['https://example.yale.edu/profile/correct-person'],
      },
      leadMembers: [{ role: 'pi', name: 'Correct Person' }],
      accessSignalCount: 1,
    });

    expect(result.tier).not.toBe('student_ready');
    expect(result.computedTier).not.toBe('student_ready');
  });

  it('blocks student-ready visibility for same-person profile-area shell duplicates', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        _id: 'profile-shell',
        name: 'Yongli Zhang Research',
        slug: 'faculty-research-area-fixture-access-lead',
        kind: 'individual',
        entityType: 'FACULTY_RESEARCH_AREA',
        shortDescription: 'Source-backed research profile.',
        fullDescription: 'Source-backed research profile with enough detail for student display.',
        sourceUrls: ['https://medicine.yale.edu/profile/fixture-access-lead/'],
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

  it('does not require a named director for a source-backed organizational research home with a linked related entity', () => {
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
      relatedEntityAccessPathCount: 1,
    });

    expect(result.tier).toBe('student_ready');
    expect(result.reasons).not.toContain('missing_lead');
    expect(result.reasons).not.toContain('missing_alternate_access_path');
  });

  it('does not require a named director for an organizational research home that surfaces a get-involved page', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        _id: 'center-get-involved',
        name: 'Center for Industrial Ecology',
        slug: 'yse-industrial-ecology-get-involved',
        entityType: 'CENTER',
        shortDescription:
          'Advances the study of industrial ecology, material flows, and sustainable systems at Yale.',
        fullDescription:
          'The Center for Industrial Ecology advances research on material and energy flows, life-cycle assessment, and sustainable industrial systems through interdisciplinary collaboration.',
        websiteUrl: 'https://environment.yale.edu/research/centers/industrial-ecology',
        sourceUrls: ['https://environment.yale.edu/centers/industrial-ecology/get-involved'],
      },
      leadMembers: [],
      accessSignalCount: 1,
      actionablePathwayCount: 1,
    });

    expect(result.tier).toBe('student_ready');
    expect(result.reasons).not.toContain('missing_alternate_access_path');
  });

  it('treats a collections initiative as an organizational home needing no named lead (#1360)', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        _id: 'yul-exhibit-prospectsofempire',
        name: 'Prospects of Empire: Slavery and Ecology in Eighteenth-Century Atlantic Britain',
        slug: 'yul-exhibit-prospectsofempire',
        entityType: 'COLLECTIONS_INITIATIVE',
        shortDescription:
          'A Yale University Library exhibition on the ecologies and economies of eighteenth-century Atlantic empire.',
        fullDescription:
          'Prospects of Empire is a Yale University Library online exhibition drawing on collections across Yale to examine slavery, ecology, and the economies of empire in the eighteenth-century Atlantic world.',
        websiteUrl: 'https://onlineexhibits.library.yale.edu/s/prospectsofempire',
      },
      leadMembers: [],
      accessSignalCount: 1,
      actionablePathwayCount: 0,
    });

    expect(result.reasons).not.toContain('missing_lead');
  });

  it('publishes a collections initiative that surfaces a get-involved / people access path (#1360)', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        _id: 'yul-exhibit-with-path',
        name: 'Prospects of Empire: Slavery and Ecology in Eighteenth-Century Atlantic Britain',
        slug: 'yul-exhibit-with-path',
        entityType: 'COLLECTIONS_INITIATIVE',
        shortDescription:
          'A Yale University Library exhibition on the ecologies and economies of eighteenth-century Atlantic empire.',
        fullDescription:
          'Prospects of Empire is a Yale University Library online exhibition drawing on collections across Yale to examine slavery, ecology, and the economies of empire in the eighteenth-century Atlantic world.',
        websiteUrl: 'https://onlineexhibits.library.yale.edu/s/prospectsofempire',
        sourceUrls: [
          'https://onlineexhibits.library.yale.edu/s/prospectsofempire',
          'https://onlineexhibits.library.yale.edu/s/prospectsofempire/page/people',
        ],
      },
      leadMembers: [],
      accessSignalCount: 1,
      actionablePathwayCount: 1,
    });

    expect(result.tier).toBe('student_ready');
    expect(result.reasons).not.toContain('missing_lead');
    expect(result.reasons).not.toContain('missing_alternate_access_path');
  });

  it('holds an organizational home with a real access path but no action evidence yet as limited_but_safe, not missing_lead', () => {
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
      relatedEntityAccessPathCount: 1,
    });

    expect(result.reasons).not.toContain('missing_lead');
    expect(result.reasons).not.toContain('missing_alternate_access_path');
    expect(result.tier).toBe('limited_but_safe');
  });

  it('holds a dead-end organizational home (no lead, no related entity, no engagement page) for review', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        _id: 'center-dead-end',
        name: 'Yale Forests',
        slug: 'yse-yale-forests',
        entityType: 'CENTER',
        shortDescription:
          'Studies forest ecosystems, carbon dynamics, and sustainable land management across Yale-owned forests.',
        fullDescription:
          'Yale Forests supports research on forest ecosystems, carbon dynamics, and sustainable land management. Faculty and students conduct field studies across the school-owned forest properties.',
        websiteUrl: 'https://environment.yale.edu/yale-forests',
        sourceUrls: ['https://environment.yale.edu/yale-forests'],
      },
      leadMembers: [],
      accessSignalCount: 1,
      actionablePathwayCount: 1,
      relatedEntityAccessPathCount: 0,
    });

    expect(result.tier).toBe('operator_review');
    expect(result.computedTier).toBe('operator_review');
    expect(result.reasons).toContain('missing_alternate_access_path');
    expect(result.reasons).not.toContain('missing_lead');
  });

  it('holds a dead-end program entity (no lead, no related entity, no engagement page) for review', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        _id: 'program-dead-end',
        name: 'Example Research Program',
        slug: 'example-research-program',
        kind: 'program',
        entityType: 'PROGRAM',
        shortDescription:
          'Coordinates undergraduate participation in faculty-led research across the division.',
        fullDescription:
          'The program coordinates undergraduate participation in faculty-led research across the division, connecting students with ongoing projects and mentors.',
        sourceUrls: ['https://example.yale.edu/research-program'],
      },
      leadMembers: [],
      accessSignalCount: 1,
      actionablePathwayCount: 1,
      relatedEntityAccessPathCount: 0,
    });

    expect(result.tier).toBe('operator_review');
    expect(result.reasons).toContain('missing_alternate_access_path');
    expect(result.reasons).not.toContain('missing_lead');
  });

  it('lets an operator override still publish a dead-end organizational home the operator vouches for', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        _id: 'center-dead-end-override',
        name: 'Yale Forests',
        slug: 'yse-yale-forests-override',
        entityType: 'CENTER',
        shortDescription:
          'Studies forest ecosystems, carbon dynamics, and sustainable land management across Yale-owned forests.',
        fullDescription:
          'Yale Forests supports research on forest ecosystems, carbon dynamics, and sustainable land management. Faculty and students conduct field studies across the school-owned forest properties.',
        websiteUrl: 'https://environment.yale.edu/yale-forests',
        sourceUrls: ['https://environment.yale.edu/yale-forests'],
        studentVisibilityOverrideTier: 'student_ready',
      },
      leadMembers: [],
      accessSignalCount: 1,
      actionablePathwayCount: 1,
      relatedEntityAccessPathCount: 0,
    });

    expect(result.tier).toBe('student_ready');
    expect(result.computedTier).toBe('operator_review');
    expect(result.reasons).toContain('missing_alternate_access_path');
    expect(result.reasons).toContain('operator_override');
  });

  it('treats a lead-less COURSE_SEQUENCE as lead-exempt: held via missing_alternate_access_path, never missing_lead', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        _id: 'course-based-research-psychology-directed-research',
        name: 'Psychology Directed Research Courses',
        slug: 'course-based-research-psychology-directed-research',
        kind: 'group',
        entityType: 'COURSE_SEQUENCE',
        shortDescription:
          'A for-credit Psychology research pathway through directed research, independent study, and senior-essay or senior-thesis courses.',
        fullDescription:
          'A for-credit, course-based research pathway in Psychology. The department offers directed research and senior essay courses for credit under faculty supervision.',
        websiteUrl: 'https://psychology.yale.edu/what-directed-research-course',
        sourceUrls: ['https://psychology.yale.edu/what-directed-research-course'],
      },
      leadMembers: [],
      accessSignalCount: 1,
      actionablePathwayCount: 1,
      relatedEntityAccessPathCount: 0,
    });

    expect(result.reasons).not.toContain('missing_lead');
    expect(result.reasons).toContain('missing_alternate_access_path');
    expect(result.tier).toBe('operator_review');
  });

  it('publishes a lead-less COURSE_SEQUENCE as limited_but_safe once it has a reachable access path', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        _id: 'course-based-research-psychology-directed-research-path',
        name: 'Psychology Directed Research Courses',
        slug: 'course-based-research-psychology-directed-research-path',
        kind: 'group',
        entityType: 'COURSE_SEQUENCE',
        shortDescription:
          'A for-credit Psychology research pathway through directed research, independent study, and senior-essay or senior-thesis courses.',
        fullDescription:
          'A for-credit, course-based research pathway in Psychology. The department offers directed research and senior essay courses for credit under faculty supervision.',
        websiteUrl: 'https://psychology.yale.edu/what-directed-research-course',
        sourceUrls: ['https://psychology.yale.edu/what-directed-research-course'],
      },
      leadMembers: [],
      accessSignalCount: 0,
      actionablePathwayCount: 0,
      relatedEntityAccessPathCount: 1,
    });

    expect(result.reasons).not.toContain('missing_lead');
    expect(result.reasons).not.toContain('missing_alternate_access_path');
    expect(result.tier).toBe('limited_but_safe');
  });

  it('suppresses generic directory-only faculty-area shells', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        _id: 'directory-shell',
        name: 'Anna Arnal Estape Research',
        slug: 'faculty-research-area-fixture-thesis-mentor',
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
        name: 'Robin Hutchison Lab',
        slug: 'nih-pi-james-hutchison',
        kind: 'lab',
        entityType: 'LAB',
        shortDescription: 'Source-backed grant summary.',
        fullDescription: 'Source-backed grant summary with enough detail for student display.',
        sourceUrls: [
          'https://reporter.nih.gov/project-details/10824067',
          'https://orcid.org/0000-0000-0000-0002',
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
      expect.arrayContaining(['non_owner_grant_shell', 'missing_action_evidence']),
    );
  });

  it('keeps sparse faculty-area shells with a specific profile source in operator review', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        _id: 'profile-shell',
        name: 'Anna Arnal Estape Research',
        slug: 'faculty-research-area-fixture-thesis-mentor',
        kind: 'individual',
        entityType: 'FACULTY_RESEARCH_AREA',
        sourceUrls: ['https://medicine.yale.edu/profile/fixture-thesis-mentor/'],
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
        websiteUrl: 'https://medicine.yale.edu/cancer/profile/harper-sanchez/',
        sourceUrls: [
          'https://medicine.yale.edu/cancer/research/membership/directory',
          'https://medicine.yale.edu/cancer/profile/harper-sanchez/',
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
        name: 'Robin Hansen Research',
        slug: 'faculty-research-area-fixture-climate-mentor',
        kind: 'individual',
        entityType: 'FACULTY_RESEARCH_AREA',
        websiteUrl: 'https://medicine.yale.edu/cancer/profile/fixture-climate-mentor/',
        sourceUrls: [
          'https://medicine.yale.edu/cancer/research/membership/directory',
          'https://medicine.yale.edu/profile/fixture-climate-mentor/',
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
          slug: 'faculty-research-area-fixture-access-lead',
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
    expect(result.reasons).toEqual(expect.arrayContaining(['missing_lead', 'missing_source_url']));
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

  it('suppresses an instructional-support center without positive research evidence', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        name: 'Poorvu Center for Teaching and Learning',
        entityType: 'CENTER',
        shortDescription:
          'Supports teaching and learning across Yale through consultations, programs, and educational resources for instructors and students.',
        fullDescription:
          'The Poorvu Center supports teaching and learning across Yale through consultations, programs, workshops, and educational resources for instructors and students.',
        studentVisibilityOverrideTier: 'student_ready',
      },
      accessSignalCount: 1,
      actionablePathwayCount: 1,
    });

    expect(result.tier).toBe('suppressed');
    expect(result.computedTier).toBe('suppressed');
    expect(result.reasons).toContain('non_research_entity');
    expect(result.reasons).toContain('service_or_instructional_support');
    expect(result.reasons).toContain('missing_positive_research_evidence');
    expect(result.reasons).not.toContain('operator_override');
  });

  it('suppresses an instructional-support center whose only service language is in the profile synthesis', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        name: 'Center for Academic Excellence',
        entityType: 'CENTER',
        profileSynthesisDescription:
          'Provides instructional support and faculty development, coordinating course design consultations and teaching support workshops for Yale instructors.',
      },
      accessSignalCount: 1,
      actionablePathwayCount: 1,
    });

    expect(result.tier).toBe('suppressed');
    expect(result.computedTier).toBe('suppressed');
    expect(result.reasons).toContain('non_research_entity');
    expect(result.reasons).toContain('service_or_instructional_support');
    expect(result.reasons).toContain('missing_positive_research_evidence');
  });

  it('keeps a center that conducts research on teaching in research scope', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        name: 'Center for Research on Teaching and Learning',
        entityType: 'CENTER',
        shortDescription:
          'Conducts empirical research on university teaching and learning through faculty-led research projects and data collection.',
        fullDescription:
          'The center conducts empirical research on university teaching and learning. Its investigators lead research projects, collect data, and publish findings about effective instruction.',
        sourceUrls: ['https://example.yale.edu/teaching-research'],
      },
      accessSignalCount: 1,
      actionablePathwayCount: 1,
      relatedEntityAccessPathCount: 1,
    });

    expect(result.tier).toBe('student_ready');
    expect(result.reasons).not.toContain('non_research_entity');
  });

  it('suppresses an administrative or service center without positive research evidence', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        name: 'Center for Student Services',
        entityType: 'CENTER',
        shortDescription:
          'Coordinates academic advising, career services, and financial aid support for enrolled students.',
        fullDescription:
          'The center manages student affairs, registrar operations, and event planning for the college community.',
        studentVisibilityOverrideTier: 'student_ready',
        sourceUrls: ['https://example.yale.edu/student-services'],
      },
      accessSignalCount: 1,
      actionablePathwayCount: 1,
    });

    expect(result.tier).toBe('suppressed');
    expect(result.computedTier).toBe('suppressed');
    expect(result.reasons).toContain('non_research_entity');
    expect(result.reasons).toContain('administrative_or_service_organization');
    expect(result.reasons).toContain('missing_positive_research_evidence');
    expect(result.reasons).not.toContain('operator_override');
  });

  it('keeps an administrative-sounding center that conducts research eligible', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        name: 'Center for Human Resources Research',
        entityType: 'CENTER',
        shortDescription:
          'Conducts empirical research on human resources and organizational behavior.',
        fullDescription:
          'The center conducts empirical research on human resources and organizational behavior. Its investigators lead research projects and data collection on workforce outcomes.',
        sourceUrls: ['https://example.yale.edu/hr-research'],
      },
      accessSignalCount: 1,
      actionablePathwayCount: 1,
      relatedEntityAccessPathCount: 1,
    });

    expect(result.tier).toBe('student_ready');
    expect(result.reasons).not.toContain('non_research_entity');
    expect(result.reasons).not.toContain('administrative_or_service_organization');
  });

  it('suppresses a person-derived entity whose attached lead profile does not match the entity identity', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        _id: 'person-derived-contested',
        name: 'Jane Doe Lab',
        slug: 'jane-doe-lab',
        kind: 'lab',
        entityType: 'LAB',
        websiteUrl: 'https://medicine.yale.edu/profile/jane-doe/',
        sourceUrls: ['https://medicine.yale.edu/profile/jane-doe/'],
        shortDescription:
          'Studies causal inference methods for public health research, with projects on clinical decision-making and policy evaluation.',
        fullDescription:
          'The lab studies causal inference methods for public health research. Current projects examine clinical decision-making, population health datasets, and statistical tools for estimating treatment effects in complex observational settings.',
        activeAtYaleCache: true,
      },
      leadMembers: [
        {
          role: 'pi',
          userId: 'john-smith',
          user: {
            fname: 'John',
            lname: 'Smith',
            profileUrls: { official: 'https://medicine.yale.edu/profile/john-smith/' },
          },
        },
      ],
      accessSignalCount: 1,
      actionablePathwayCount: 1,
    });

    expect(result.tier).toBe('operator_review');
    expect(result.computedTier).toBe('operator_review');
    expect(result.reasons).toContain('profile_identity_risk');
  });

  it('keeps a person-derived entity student-ready when the attached lead profile matches its identity', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        _id: 'person-derived-consistent',
        name: 'Jane Doe Lab',
        slug: 'jane-doe-lab-consistent',
        kind: 'lab',
        entityType: 'LAB',
        websiteUrl: 'https://medicine.yale.edu/profile/jane-doe/',
        sourceUrls: ['https://medicine.yale.edu/profile/jane-doe/'],
        shortDescription:
          'Studies causal inference methods for public health research, with projects on clinical decision-making and policy evaluation.',
        fullDescription:
          'The lab studies causal inference methods for public health research. Current projects examine clinical decision-making, population health datasets, and statistical tools for estimating treatment effects in complex observational settings.',
        activeAtYaleCache: true,
      },
      leadMembers: [
        {
          role: 'pi',
          userId: 'jane-doe',
          user: {
            fname: 'Jane',
            lname: 'Doe',
            profileUrls: { official: 'https://medicine.yale.edu/profile/jane-doe/' },
          },
        },
      ],
      accessSignalCount: 1,
      actionablePathwayCount: 1,
    });

    expect(result.tier).toBe('student_ready');
    expect(result.reasons).not.toContain('profile_identity_risk');
  });

  it('does not flag profile identity risk for a person-derived entity when no lead profile evidence exists', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        _id: 'person-derived-no-lead-profile',
        name: 'Jane Doe Lab',
        slug: 'jane-doe-lab-no-profile',
        kind: 'lab',
        entityType: 'LAB',
        websiteUrl: 'https://medicine.yale.edu/profile/jane-doe/',
        sourceUrls: ['https://medicine.yale.edu/profile/jane-doe/'],
        shortDescription:
          'Studies causal inference methods for public health research, with projects on clinical decision-making and policy evaluation.',
        fullDescription:
          'The lab studies causal inference methods for public health research. Current projects examine clinical decision-making, population health datasets, and statistical tools for estimating treatment effects in complex observational settings.',
        activeAtYaleCache: true,
      },
      leadMembers: [{ role: 'pi', userId: 'jane-doe', user: { fname: 'Jane', lname: 'Doe' } }],
      accessSignalCount: 1,
      actionablePathwayCount: 1,
    });

    expect(result.reasons).not.toContain('profile_identity_risk');
    expect(result.tier).toBe('student_ready');
  });

  it('holds a contested person-derived entity for review even under a student-ready override (issue #468)', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        _id: 'nsf-pi-6990e3ff500496cc8ac60925',
        name: 'Casey Harper Lab',
        slug: 'nsf-pi-6990e3ff500496cc8ac60925',
        kind: 'lab',
        entityType: 'LAB',
        websiteUrl: 'https://medicine.yale.edu/profile/qz990/',
        sourceUrls: ['https://medicine.yale.edu/profile/qz990/'],
        shortDescription:
          'Studies causal inference methods for public health research, with projects on clinical decision-making and policy evaluation.',
        fullDescription:
          'The lab studies causal inference methods for public health research. Current projects examine clinical decision-making, population health datasets, and statistical tools for estimating treatment effects in complex observational settings.',
        activeAtYaleCache: true,
        studentVisibilityOverrideTier: 'student_ready',
      },
      leadMembers: [
        { role: 'pi', userId: 'ch51', user: { netid: 'ch51', fname: 'Casey', lname: 'Harper' } },
      ],
      accessSignalCount: 1,
      actionablePathwayCount: 1,
    });

    expect(result.tier).toBe('operator_review');
    expect(result.computedTier).not.toBe('student_ready');
    expect(result.reasons).toContain('profile_identity_risk');
    expect(result.reasons).toContain('operator_override');
  });

  it('clears the identity hold when the lead full name corroborates despite a variant profile slug', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        _id: 'person-derived-variant-slug',
        name: 'Jane Doe Lab',
        slug: 'jane-doe-lab-variant',
        kind: 'lab',
        entityType: 'LAB',
        websiteUrl: 'https://medicine.yale.edu/profile/jane-doe/',
        sourceUrls: ['https://medicine.yale.edu/profile/jane-doe/'],
        shortDescription:
          'Studies causal inference methods for public health research, with projects on clinical decision-making and policy evaluation.',
        fullDescription:
          'The lab studies causal inference methods for public health research. Current projects examine clinical decision-making, population health datasets, and statistical tools for estimating treatment effects in complex observational settings.',
        activeAtYaleCache: true,
      },
      leadMembers: [
        {
          role: 'pi',
          userId: 'jane-doe',
          user: {
            netid: 'jd88',
            fname: 'Jane',
            lname: 'Doe',
            profileUrls: { official: 'https://chem.yale.edu/profile/jane-e-doe' },
          },
        },
      ],
      accessSignalCount: 1,
      actionablePathwayCount: 1,
    });

    expect(result.reasons).not.toContain('profile_identity_risk');
    expect(result.tier).toBe('student_ready');
  });

  it('keeps a surname-only contested lead gated even under a student-ready override', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        _id: 'person-derived-surname-collision',
        name: 'John Smith Lab',
        slug: 'john-smith-lab-collision',
        kind: 'lab',
        entityType: 'LAB',
        websiteUrl: 'https://medicine.yale.edu/profile/john-smith/',
        sourceUrls: ['https://medicine.yale.edu/profile/john-smith/'],
        shortDescription:
          'Studies causal inference methods for public health research, with projects on clinical decision-making and policy evaluation.',
        fullDescription:
          'The lab studies causal inference methods for public health research. Current projects examine clinical decision-making, population health datasets, and statistical tools for estimating treatment effects in complex observational settings.',
        activeAtYaleCache: true,
        studentVisibilityOverrideTier: 'student_ready',
      },
      leadMembers: [{ role: 'pi', userId: 'jane-smith', user: { fname: 'Jane', lname: 'Smith' } }],
      accessSignalCount: 1,
      actionablePathwayCount: 1,
    });

    expect(result.tier).toBe('operator_review');
    expect(result.computedTier).not.toBe('student_ready');
    expect(result.reasons).toContain('profile_identity_risk');
    expect(result.reasons).toContain('operator_override');
  });

  it('holds a lead-requiring entity with no attached PI for review even under a student-ready override', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        _id: 'person-derived-no-lead',
        name: 'Cognitive Neuroscience Lab',
        slug: 'cognitive-neuroscience-lab-no-lead',
        kind: 'lab',
        entityType: 'LAB',
        websiteUrl: 'https://example.yale.edu/labs/cognitive-neuroscience',
        sourceUrls: ['https://example.yale.edu/labs/cognitive-neuroscience'],
        shortDescription:
          'Studies causal inference methods for public health research, with projects on clinical decision-making and policy evaluation.',
        fullDescription:
          'The lab studies causal inference methods for public health research. Current projects examine clinical decision-making, population health datasets, and statistical tools for estimating treatment effects in complex observational settings.',
        activeAtYaleCache: true,
        studentVisibilityOverrideTier: 'student_ready',
      },
      leadMembers: [],
      accessSignalCount: 1,
      actionablePathwayCount: 1,
    });

    expect(result.tier).toBe('operator_review');
    expect(result.computedTier).not.toBe('student_ready');
    expect(result.reasons).toContain('missing_lead');
    expect(result.reasons).toContain('operator_override');
  });

  it('holds an organizational home with no link-out target for review even under a student-ready override', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        _id: 'institute-no-linkout',
        name: 'Yale Quantum Institute',
        slug: 'center-yale-quantum-institute',
        kind: 'institute',
        entityType: 'INSTITUTE',
        websiteUrl: '',
        website: '',
        sourceUrls: [],
        shortDescription:
          'Advances quantum science and engineering across Yale, connecting physics, applied physics, and computer science research groups.',
        fullDescription:
          'The institute advances quantum science and engineering across Yale. It connects physics, applied physics, electrical engineering, and computer science groups working on superconducting qubits, quantum error correction, and quantum materials.',
        activeAtYaleCache: true,
        studentVisibilityOverrideTier: 'student_ready',
      },
      leadMembers: [],
      accessSignalCount: 1,
      actionablePathwayCount: 1,
    });

    expect(result.tier).toBe('operator_review');
    expect(result.computedTier).not.toBe('student_ready');
    expect(result.reasons).toContain('missing_source_url');
    expect(result.reasons).toContain('operator_override');
  });
});

describe('computeProgramStudentVisibility', () => {
  it('marks sourced undergraduate programs with an application route as student ready', () => {
    const result = computeProgramStudentVisibility({
      title: 'STARS Summer Research Program',
      studentFacingCategory: 'Structured summer program',
      summary:
        'A summer research program placing undergraduates in Yale STEM labs with a stipend and faculty mentor.',
      sourceUrl: 'https://science.yalecollege.yale.edu/stars',
      applicationLink: 'https://apply.yale.edu/stars',
      undergraduateOnly: true,
    });

    expect(result.tier).toBe('student_ready');
    expect(result.reasons).toContain('official_source');
    expect(result.reasons).toContain('application_route');
    expect(result.reasons).not.toContain('missing_description');
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

  it('caps fellowship funding to limited when its only source is the application portal', () => {
    const result = computeProgramStudentVisibility({
      title: 'Senior Research Fellowship',
      studentFacingCategory: 'Senior research funding',
      programKind: 'FELLOWSHIP_FUNDING',
      sourceUrl: 'https://yale.communityforce.com/Funds/FundDetails.aspx?abc123',
      applicationLink: 'https://yale.communityforce.com/Funds/FundDetails.aspx?abc123',
      undergraduateOnly: true,
    });

    expect(result.tier).toBe('limited_but_safe');
    expect(result.reasons).toContain('application_source_only');
  });

  it('promotes undergraduate research funding with a real source + application route to student-ready', () => {
    const fellowship = computeProgramStudentVisibility({
      title: 'Senior Research Fellowship',
      studentFacingCategory: 'Senior research funding',
      programKind: 'FELLOWSHIP_FUNDING',
      summary:
        'Funds senior undergraduates conducting independent research toward a thesis at Yale.',
      sourceUrl: 'https://yalecollege.yale.edu/funding/senior-research-fellowship',
      applicationLink: 'https://apply.yale.edu/senior-research-fellowship',
      undergraduateOnly: true,
    });
    const travel = computeProgramStudentVisibility({
      title: 'Research Travel Grant',
      studentFacingCategory: 'Research travel funding',
      programKind: 'TRAVEL_RESEARCH_GRANT',
      summary:
        'Supports undergraduate travel for research, fieldwork, and archival study away from campus.',
      sourceUrl: 'https://yalecollege.yale.edu/travel-research',
      applicationLink: 'https://apply.yale.edu/travel-research',
      undergraduateOnly: true,
    });
    const thesis = computeProgramStudentVisibility({
      title: 'Senior Thesis Funding',
      studentFacingCategory: 'Senior research funding',
      programKind: 'SENIOR_THESIS_FUNDING',
      summary:
        'Provides funding for materials and travel supporting a senior thesis research project.',
      sourceUrl: 'https://yalecollege.yale.edu/senior-thesis-funding',
      applicationLink: 'https://apply.yale.edu/senior-thesis',
      undergraduateOnly: true,
    });

    expect(fellowship.tier).toBe('student_ready');
    expect(travel.tier).toBe('student_ready');
    expect(thesis.tier).toBe('student_ready');
    // The formalization reason is still recorded for transparency, but no longer caps the tier.
    expect(thesis.reasons).toContain('formalization_only');
  });

  it('keeps structured and mentor-matching programs eligible for student-ready', () => {
    const structured = computeProgramStudentVisibility({
      title: 'STARS Summer Research Program',
      studentFacingCategory: 'Structured summer program',
      programKind: 'STRUCTURED_PROGRAM',
      entryMode: 'SECURE_MENTOR_THEN_APPLY',
      summary:
        'A structured summer program pairing undergraduates with Yale research mentors and a stipend.',
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
      summary:
        'Matches undergraduates with faculty mentors for a funded research experience during the year.',
      sourceUrl: 'https://science.yalecollege.yale.edu/mentor-match',
      applicationLink: 'https://apply.yale.edu/mentor-match',
      undergraduateOnly: true,
    });

    expect(structured.tier).toBe('student_ready');
    expect(structured.reasons).not.toContain('formalization_only');
    expect(mentorMatching.tier).toBe('student_ready');
    expect(mentorMatching.reasons).not.toContain('formalization_only');
  });

  it('surfaces graduate-only research programs with a source and route as student-ready, labeled graduate', () => {
    const result = computeProgramStudentVisibility({
      title: 'Graduate Dissertation Research Fellowship',
      studentFacingCategory: 'Fellowship funding',
      programKind: 'FELLOWSHIP_FUNDING',
      summary:
        'Funds doctoral candidates conducting dissertation research, including fieldwork and archival study.',
      sourceUrl: 'https://gsas.yale.edu/funding/dissertation-research-fellowship',
      applicationLink: 'https://apply.yale.edu/dissertation-research-fellowship',
      undergraduateOnly: false,
    });

    expect(result.tier).toBe('student_ready');
    expect(result.reasons).toContain('graduate_relevant');
    expect(result.reasons).not.toContain('not_undergraduate_relevant');
  });

  it('does not suppress graduate-only programs; archive/review still holds them out', () => {
    const result = computeProgramStudentVisibility({
      title: 'Graduate Dissertation Research Fellowship',
      studentFacingCategory: 'Archive / review',
      sourceUrl: 'https://example.yale.edu',
      applicationLink: 'https://apply.example.yale.edu',
      undergraduateOnly: false,
    });

    expect(result.tier).toBe('operator_review');
    expect(result.reasons).not.toContain('not_undergraduate_relevant');
    expect(result.reasons).toContain('graduate_relevant');
  });

  it('still suppresses catalog and administrative program pages', () => {
    const result = computeProgramStudentVisibility({
      title: 'Find Funding: Student Grants Database',
      studentFacingCategory: 'Research travel funding',
      sourceUrl: 'https://yalecollege.yale.edu/find-funding',
      applicationLink: 'https://apply.yale.edu/find-funding',
      undergraduateOnly: true,
    });

    expect(result.tier).toBe('suppressed');
    expect(result.reasons).toContain('not_undergraduate_relevant');
  });

  it('caps a sourced routed program with no description or summary at limited_but_safe', () => {
    const result = computeProgramStudentVisibility({
      title: 'Class of 1960 Summer Traveling Fellowship',
      studentFacingCategory: 'Research travel funding',
      programKind: 'TRAVEL_RESEARCH_GRANT',
      sourceUrl: 'https://yalecollege.yale.edu/funding/class-of-1960-fellowship',
      applicationLink: 'https://apply.yale.edu/class-of-1960-fellowship',
      undergraduateOnly: true,
    });

    expect(result.tier).toBe('limited_but_safe');
    expect(result.reasons).toContain('missing_description');
    expect(result.reasons).not.toContain('thin_description');
  });

  it('caps a sourced routed program with only a thin description at limited_but_safe', () => {
    const result = computeProgramStudentVisibility({
      title: 'Research Internship Program',
      studentFacingCategory: 'Structured summer program',
      programKind: 'STRUCTURED_PROGRAM',
      summary: 'Summer research internship.',
      sourceUrl: 'https://yalecollege.yale.edu/funding/research-internship',
      applicationLink: 'https://apply.yale.edu/research-internship',
      undergraduateOnly: true,
    });

    expect(result.tier).toBe('limited_but_safe');
    expect(result.reasons).toContain('thin_description');
    expect(result.reasons).not.toContain('missing_description');
  });

  it('promotes a sourced routed program to student_ready once a real description is present', () => {
    const result = computeProgramStudentVisibility({
      title: 'Research Internship Program',
      studentFacingCategory: 'Structured summer program',
      programKind: 'STRUCTURED_PROGRAM',
      description:
        'A ten-week summer internship placing undergraduates in Yale research labs with a stipend, weekly seminars, and a faculty mentor.',
      sourceUrl: 'https://yalecollege.yale.edu/funding/research-internship',
      applicationLink: 'https://apply.yale.edu/research-internship',
      undergraduateOnly: true,
    });

    expect(result.tier).toBe('student_ready');
    expect(result.reasons).not.toContain('missing_description');
    expect(result.reasons).not.toContain('thin_description');
  });

  it('blocks a blank-description program from student_ready even under an operator override (issue #1425)', () => {
    const result = computeProgramStudentVisibility({
      title: 'Research Internship Program',
      studentFacingCategory: 'Structured summer program',
      programKind: 'STRUCTURED_PROGRAM',
      sourceUrl: 'https://yalecollege.yale.edu/funding/research-internship',
      applicationLink: 'https://apply.yale.edu/research-internship',
      undergraduateOnly: true,
      studentVisibilityOverrideTier: 'student_ready',
    });

    expect(result.tier).toBe('operator_review');
    expect(result.reasons).toContain('operator_override');
    expect(result.reasons).toContain(BLANK_PUBLIC_DESCRIPTION_REASON);
  });

  it('lets an operator override still publish a described program the operator vouches for', () => {
    const result = computeProgramStudentVisibility({
      title: 'Research Travel Grant',
      studentFacingCategory: 'Research travel funding',
      programKind: 'TRAVEL_RESEARCH_GRANT',
      description:
        'Supports undergraduate travel for research, fieldwork, and archival study away from campus over the summer.',
      sourceUrl: 'https://yalecollege.yale.edu/travel-research',
      applicationLink: 'https://apply.yale.edu/travel-research',
      undergraduateOnly: true,
      studentVisibilityOverrideTier: 'student_ready',
    });

    expect(result.tier).toBe('student_ready');
    expect(result.reasons).not.toContain(BLANK_PUBLIC_DESCRIPTION_REASON);
  });

  it('does not treat a contact-only summary as a student-facing description', () => {
    const result = computeProgramStudentVisibility({
      title: 'Robert C. Bates Summer Fellowship',
      studentFacingCategory: 'Research travel funding',
      programKind: 'TRAVEL_RESEARCH_GRANT',
      summary: 'Contact prose-office@example.edu for details.',
      sourceUrl: 'https://yalecollege.yale.edu/funding/bates-fellowship',
      applicationLink: 'https://apply.yale.edu/bates-fellowship',
      undergraduateOnly: true,
    });

    expect(result.tier).not.toBe('student_ready');
  });

  it('holds a lead-requiring lab with no attached PI for review even under a student-ready override', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        name: 'Example Lab',
        shortDescription:
          'Studies causal inference methods for public health research, with projects on clinical decision-making, population health datasets, and policy evaluation.',
        fullDescription:
          'The lab studies causal inference methods for public health research. Current projects examine clinical decision-making, population health datasets, policy evaluation, and statistical tools for estimating treatment effects in complex observational settings.',
        sourceUrls: ['https://medicine.yale.edu/example-lab'],
        studentVisibilityOverrideTier: 'student_ready',
      },
      leadMembers: [],
      accessSignalCount: 1,
      actionablePathwayCount: 1,
    });

    expect(result.tier).toBe('operator_review');
    expect(result.computedTier).not.toBe('student_ready');
    expect(result.reasons).toContain('missing_lead');
    expect(result.reasons).toContain('operator_override');
  });

  it('holds a lead-requiring lab with a weak (unresolved) lead for review even under a limited_but_safe override', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        name: 'Example Lab',
        shortDescription:
          'Studies causal inference methods for public health research, with projects on clinical decision-making, population health datasets, and policy evaluation.',
        fullDescription:
          'The lab studies causal inference methods for public health research. Current projects examine clinical decision-making, population health datasets, policy evaluation, and statistical tools for estimating treatment effects in complex observational settings.',
        sourceUrls: ['https://medicine.yale.edu/example-lab'],
        studentVisibilityOverrideTier: 'limited_but_safe',
      },
      leadMembers: [{ role: 'pi' }],
      accessSignalCount: 1,
      actionablePathwayCount: 1,
    });

    expect(result.tier).toBe('operator_review');
    expect(result.reasons).toContain('missing_lead');
  });

  it('keeps the organizational-home exemption: a research center with no named lead but a real access path can still be student-ready', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        name: 'Center for Research on Teaching and Learning',
        entityType: 'CENTER',
        shortDescription:
          'Conducts empirical research on university teaching and learning through faculty-led research projects and data collection.',
        fullDescription:
          'The center conducts empirical research on university teaching and learning. Its investigators lead research projects, collect data, and publish findings about effective instruction.',
        sourceUrls: ['https://example.yale.edu/teaching-research'],
      },
      leadMembers: [],
      accessSignalCount: 1,
      actionablePathwayCount: 1,
      relatedEntityAccessPathCount: 1,
    });

    expect(result.tier).toBe('student_ready');
    expect(result.reasons).not.toContain('missing_lead');
    expect(result.reasons).not.toContain('missing_alternate_access_path');
  });

  it('blocks a blank-description research entity from student_ready even under an operator override', () => {
    const result = computeResearchEntityStudentVisibility({
      entity: {
        _id: 'blank-research-override',
        name: 'Example Lab',
        slug: 'example-lab-blank-override',
        kind: 'lab',
        entityType: 'LAB',
        shortDescription: '',
        fullDescription: '',
        sourceUrls: ['https://medicine.yale.edu/example-lab'],
        activeAtYaleCache: true,
        studentVisibilityOverrideTier: 'student_ready',
      },
      leadMembers: [{ userId: 'user-1', role: 'pi' }],
      accessSignalCount: 1,
      actionablePathwayCount: 1,
    });

    expect(result.tier).toBe('operator_review');
    expect(result.computedTier).not.toBe('student_ready');
    expect(result.reasons).toContain('operator_override');
  });
});

describe('enforceStudentReadyDescriptionInvariant', () => {
  const blankRecord = { fullDescription: '   ', shortDescription: '', description: '', summary: '' };
  const describedRecord = {
    fullDescription: 'The lab studies causal inference methods for public health research.',
  };

  it('downgrades a student_ready result with no usable description to operator_review', () => {
    const result = enforceStudentReadyDescriptionInvariant(
      { tier: 'student_ready', computedTier: 'student_ready', reasons: ['operator_override'] },
      blankRecord,
    );

    expect(result.tier).toBe('operator_review');
    expect(result.computedTier).toBe('student_ready');
    expect(result.reasons).toContain('operator_override');
    expect(result.reasons).toContain(BLANK_PUBLIC_DESCRIPTION_REASON);
  });

  it('leaves a student_ready result with a usable description unchanged', () => {
    const input = {
      tier: 'student_ready' as const,
      computedTier: 'student_ready' as const,
      reasons: ['source_backed_description'],
    };
    const result = enforceStudentReadyDescriptionInvariant(input, describedRecord);

    expect(result.tier).toBe('student_ready');
    expect(result.reasons).not.toContain(BLANK_PUBLIC_DESCRIPTION_REASON);
  });

  it('does not touch non-student_ready tiers even when the description is blank', () => {
    for (const tier of ['limited_but_safe', 'operator_review', 'suppressed'] as const) {
      const result = enforceStudentReadyDescriptionInvariant(
        { tier, computedTier: tier, reasons: [] },
        blankRecord,
      );
      expect(result.tier).toBe(tier);
      expect(result.reasons).not.toContain(BLANK_PUBLIC_DESCRIPTION_REASON);
    }
  });

  it('treats a contact-only or boilerplate-only field as no usable description', () => {
    expect(recordHasNoUsablePublicDescription(blankRecord)).toBe(true);
    expect(recordHasNoUsablePublicDescription(describedRecord)).toBe(false);
  });
});

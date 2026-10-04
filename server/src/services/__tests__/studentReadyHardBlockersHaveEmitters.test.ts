import { describe, expect, it } from 'vitest';
import {
  computeProgramStudentVisibility,
  computeResearchEntityStudentVisibility,
  STUDENT_READY_HARD_BLOCKER_REASONS,
  type ResearchEntityStudentVisibilityInput,
} from '../studentVisibilityTier';
import { isBlockingVisibilityReason } from '../studentVisibilityGateService';

const RETIRED_REASONS = ['content_page_risk', 'duplicate_name_risk', 'pi_identity_conflict'];
const NOW = new Date('2026-10-03T12:00:00.000Z');

const servableLab = {
  slug: 'fixture-example-lab',
  name: 'Example Lab',
  kind: 'lab',
  entityType: 'LAB',
  websiteUrl: 'https://example.yale.edu/labs/example/',
  sourceUrls: ['https://example.yale.edu/labs/example/'],
  researchAreas: ['Exoplanets'],
  shortDescription: 'Studies exoplanet detection and atmospheric characterization.',
  fullDescription:
    'The lab studies exoplanet detection and atmospheric characterization, combining radial-velocity surveys with high-resolution spectroscopy of transiting planets.',
  activeAtYaleCache: true,
};
const exampleLead = [{ userId: 'user-example-lead', role: 'pi' }];

const servableProgram = {
  title: 'Fixture Summer Research Fellowship',
  studentFacingCategory: 'Structured summer program',
  summary:
    'Supports undergraduates who spend ten summer weeks on a research project with a faculty mentor.',
  description:
    'A ten-week summer fellowship placing undergraduates in Yale research labs with a stipend, weekly seminars, and a faculty mentor.',
  sourceUrl: 'https://fixture.yale.edu/funding/summer-research',
  applicationLink: 'https://apply.example.org/fixture-summer-research',
  undergraduateOnly: true,
  purpose: ['Research'],
};

const researchReasons = (input: Partial<ResearchEntityStudentVisibilityInput>): string[] =>
  computeResearchEntityStudentVisibility({
    leadMembers: exampleLead,
    accessSignalCount: 1,
    actionablePathwayCount: 1,
    ...input,
    entity: { ...servableLab, ...input.entity },
  }).reasons;

const programReasons = (overrides: Record<string, unknown>, duplicateOfServedCopy = false) =>
  computeProgramStudentVisibility(
    { ...servableProgram, ...overrides },
    { now: NOW, duplicateOfServedCopy },
  ).reasons;

const HARD_BLOCKER_EMITTERS: Record<string, () => string[]> = {
  missing_description: () => programReasons({ summary: '', description: '' }),
  missing_card_description: () =>
    researchReasons({
      entity: {
        name: 'Yale Example Coastal Systems Summer Fellowship',
        slug: 'program-example-coastal-exclusion',
        kind: 'program',
        entityType: 'PROGRAM',
        fullDescription:
          'The Yale Example Coastal Systems Summer Fellowship places Yale College students with faculty mentors for ten weeks of paid summer research on shoreline erosion, sediment transport, and community adaptation planning.',
        shortDescription:
          'Applications from students who have already received overlapping grant awards will not be considered.',
      },
    }),
  thin_description: () => programReasons({ summary: '', description: 'A summer fellowship.' }),
  blank_public_description: () =>
    programReasons({
      summary: '',
      description: '',
      studentVisibilityOverrideTier: 'student_ready',
    }),
  public_description_invariant_failed: () =>
    researchReasons({
      entity: {
        name: 'Yale Example Coastal Systems Summer Fellowship',
        slug: 'program-example-coastal',
        kind: 'program',
        entityType: 'PROGRAM',
        fullDescription: 'April 3, 2024 | News | Read more about the new director announcement.',
        shortDescription:
          'The fellowship supports undergraduates spending a summer on coastal-systems fieldwork with a faculty mentor.',
      },
    }),
  missing_lead: () => researchReasons({ leadMembers: [] }),
  unusable_name: () => researchReasons({ entity: { name: 'n/a' } }),
  duplicate_risk: () => researchReasons({ duplicateRisk: true }),
  exact_url_duplicate_risk: () => researchReasons({ exactUrlDuplicateRisk: true }),
  profile_identity_risk: () =>
    researchReasons({
      entity: {
        name: 'Jane Doe Lab',
        slug: 'jane-doe-lab',
        websiteUrl: 'https://medicine.yale.edu/profile/jane-doe/',
        sourceUrls: ['https://medicine.yale.edu/profile/jane-doe/'],
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
    }),
  generic_directory_shell: () =>
    researchReasons({
      entity: {
        name: 'Example Person Research',
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
    }),
  profile_biography_shell: () =>
    researchReasons({
      entity: {
        name: 'Example Person Research',
        slug: 'faculty-research-area-example-person',
        kind: 'individual',
        entityType: 'FACULTY_RESEARCH_AREA',
        websiteUrl: 'https://medicine.yale.edu/cancer/profile/example-person/',
        sourceUrls: [
          'https://medicine.yale.edu/cancer/research/membership/directory',
          'https://medicine.yale.edu/cancer/profile/example-person/',
        ],
        shortDescription:
          'Dr. Person received an undergraduate degree at Fairfield University, a medical degree at SUNY Stony Brook, and did a residency in anatomic and clinical pathology at Yale New Haven Hospital.',
        fullDescription:
          'Dr. Person received an undergraduate degree at Fairfield University, a medical degree at SUNY Stony Brook, and did a residency in anatomic and clinical pathology at Yale New Haven Hospital. Dr. Person worked as a community pathologist before joining Yale School of Medicine.',
        researchAreas: [],
      },
      leadMembers: [],
      accessSignalCount: 0,
      actionablePathwayCount: 0,
    }),
  non_research_entity: () =>
    researchReasons({
      entity: {
        name: 'Poorvu Center for Teaching and Learning',
        entityType: 'CENTER',
        kind: 'center',
        shortDescription:
          'Supports teaching and learning across Yale through consultations, programs, and educational resources for instructors and students.',
        fullDescription:
          'The Poorvu Center supports teaching and learning across Yale through consultations, programs, workshops, and educational resources for instructors and students.',
      },
    }),
  non_research_program: () =>
    programReasons({
      title: 'Fixture Commencement Reception',
      summary: 'An evening reception for graduating seniors and their families.',
      description:
        'An evening reception with dinner and music for graduating seniors and their families.',
      purpose: [],
    }),
  duplicate_program: () => programReasons({}, true),
  common_application_container: () => programReasons({ title: 'Fixture Common Application' }),
  external_award_cycle_stale: () =>
    programReasons({
      sourceUrl: 'https://funding.yale.edu/external-award/fixture-summer-research',
      deadline: new Date('2022-02-01T04:59:59.999Z'),
    }),
  award_suspended: () =>
    programReasons({
      description:
        'IMPORTANT UPDATE As of April 2nd 2026, the trustees have decided to suspend the awarding of Fixture Global Scholarships with immediate effect. Graduating seniors may apply for endorsement.',
    }),
  prize_for_completed_work: () =>
    programReasons({
      title: 'Fixture Essay Prizes for Yale College Undergraduates',
      summary:
        'The fixture prize competitions are open to all graduating students enrolled for a degree during the current academic year.',
      description: undefined,
      sourceUrl: 'https://fixture.yale.edu/prizes/essay',
    }),
  program_listing_page: () =>
    programReasons({
      title: 'Grants to Students',
      summary:
        'The fixture council provides funding to students for research and study abroad through two grant programs below.',
      sourceUrl: 'https://council.fixture.yale.edu/grants-students',
      applicationLink: 'https://council.fixture.yale.edu/node/1/fixture-council-grant',
      links: [
        { url: 'https://council.fixture.yale.edu/node/1/fixture-council-grant' },
        { url: 'https://council.fixture.yale.edu/node/2/fixture-field-fellowship' },
      ],
    }),
  research_infrastructure_only: () =>
    researchReasons({
      entity: { studentVisibilitySuppressionReason: 'research_infrastructure_only' },
    }),
  non_owner_grant_shell: () =>
    researchReasons({
      entity: {
        name: 'Example Person Lab',
        slug: 'nih-pi-example-person',
        websiteUrl: '',
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
          userId: { _id: 'user-example', title: 'Postdoctoral Associate in Pharmacology' },
        },
      ],
      accessSignalCount: 0,
      actionablePathwayCount: 0,
    }),
  grant_only_no_current_yale_source: () =>
    researchReasons({
      entity: {
        slug: 'nih-pi-example-lead',
        name: 'Example Lead Lab',
        websiteUrl: '',
        sourceUrls: ['https://reporter.nih.gov/project-details/10899610'],
      },
    }),
  permanently_closed: () =>
    researchReasons({ entity: { studentVisibilitySuppressionReason: 'permanently_closed' } }),
  lab_name_org_type_mismatch: () =>
    researchReasons({
      entity: {
        name: 'Example Person Lab',
        slug: 'nih-pi-example-person',
        entityType: 'CENTER',
        shortDescription: 'The Yale Liver Center supports digestive-disease research.',
        fullDescription:
          'The Yale Liver Center is one of 17 Digestive Diseases Research Core Centers, with 43 independent principal investigators and 52 Associate Members from 30 departments.',
        websiteUrl: 'https://medicine.yale.edu/intmed/digestive/liver/',
        sourceUrls: ['https://medicine.yale.edu/intmed/digestive/liver/get-involved'],
      },
      leadMembers: [],
      relatedEntityAccessPathCount: 1,
    }),
  lead_title_pending_policy: () =>
    researchReasons({
      leadMembers: [{ userId: 'user-example-lead', role: 'pi', title: 'Clinical Fellow' }],
    }),
  unbacked_lab_name: () =>
    researchReasons({
      entity: {
        name: 'Fixture Lab',
        slug: 'unbacked-lab-name-fixture',
        websiteUrl: '',
        shortDescription:
          'The Fixture Lab investigates the molecular mechanisms of metabolic disease.',
        fullDescription:
          'The Fixture Lab studies how metabolic pathways are regulated and how their regulation contributes to disease, using molecular biology and biochemistry.',
        sourceUrls: [
          'https://example.edu/profile/example-person/',
          'https://example.edu/people-department?page=4',
        ],
        fieldProvenance: {
          fullDescription: { sourceUrl: 'https://example.edu/profile/example-person/' },
        },
      },
      leadMembers: [{ user: { fname: 'Example', lname: 'Person' }, role: 'pi' }],
    }),
  inactive_at_yale: () => researchReasons({ entity: { activeAtYaleCache: false } }),
  archive_review: () => programReasons({ studentFacingCategory: 'Archive / review' }),
  not_undergraduate_relevant: () => programReasons({ title: 'Find Funding' }),
  all_citations_dead: () =>
    researchReasons({
      entity: {
        sourceLinkHealth: [
          { url: 'https://example.yale.edu/labs/example/', healthStatus: 'UNAVAILABLE' },
        ],
      },
    }),
  citations_identify_no_person: () => researchReasons({ citationsSharedAcrossPersonRows: true }),
};

describe('student_ready hard blockers', () => {
  it('has a production emitter scenario for every hard blocker reason', () => {
    expect(Object.keys(HARD_BLOCKER_EMITTERS).sort()).toEqual(
      [...STUDENT_READY_HARD_BLOCKER_REASONS].sort(),
    );
  });

  it.each(Object.entries(HARD_BLOCKER_EMITTERS))(
    'emits %s from the gate when its condition holds',
    (reason, emit) => {
      expect(emit()).toContain(reason);
    },
  );

  it('emits none of the hard blockers for a servable lab and a servable program', () => {
    const blockers = [...researchReasons({}), ...programReasons({})].filter((reason) =>
      STUDENT_READY_HARD_BLOCKER_REASONS.has(reason),
    );
    expect(blockers).toEqual([]);
  });

  it.each(RETIRED_REASONS)('keeps the never-emitted %s reason retired', (reason) => {
    expect(STUDENT_READY_HARD_BLOCKER_REASONS.has(reason)).toBe(false);
    expect(isBlockingVisibilityReason(reason)).toBe(false);
    for (const emit of Object.values(HARD_BLOCKER_EMITTERS)) {
      expect(emit()).not.toContain(reason);
    }
  });

  it('ignores a content-page flag on the research entity visibility input', () => {
    const baseline = computeResearchEntityStudentVisibility({
      entity: servableLab,
      leadMembers: exampleLead,
      accessSignalCount: 1,
      actionablePathwayCount: 1,
    });
    const flagged = computeResearchEntityStudentVisibility({
      entity: servableLab,
      leadMembers: exampleLead,
      accessSignalCount: 1,
      actionablePathwayCount: 1,
      contentPageRisk: true,
    } as ResearchEntityStudentVisibilityInput);
    expect(flagged).toEqual(baseline);
  });
});

import { describe, expect, it } from 'vitest';

import {
  computeProgramStudentVisibility,
  PROGRAM_STUDENT_VISIBILITY_INPUT_FIELDS,
  type ProgramStudentVisibilityInput,
} from '../studentVisibilityTier';

const LISTED: ReadonlySet<string> = new Set(PROGRAM_STUDENT_VISIBILITY_INPUT_FIELDS);
const NOW = new Date('2026-11-18T12:00:00Z');
const LONG_DESCRIPTION =
  'Undergraduates join a faculty research group for ten weeks, design an original project with a mentor, and present their findings at a closing symposium for the summer cohort.';

const FIXTURES: Record<string, ProgramStudentVisibilityInput> = {
  empty: {},
  studentReady: {
    title: 'Fixture Summer Research Fellowship',
    studentFacingCategory: 'Research program',
    sourceUrl: 'https://fixture.yale.edu/fellowship/',
    applicationLink: 'https://fixture.yale.edu/fellowship/apply/',
    links: [{ url: 'https://fixture.yale.edu/fellowship/faq/' }],
    undergraduateOnly: true,
    yaleCollegeOnly: true,
    yearOfStudy: ['Junior'],
    programKind: 'research_fellowship',
    entryMode: 'apply',
    mentorMatching: true,
    requiresMentorBeforeApply: true,
    purpose: ['research'],
    summary: LONG_DESCRIPTION,
    description: LONG_DESCRIPTION,
    eligibility: 'Open to Yale College juniors.',
    deadline: '2027-02-01',
    applicationOpenDate: '2026-12-01',
    isAcceptingApplications: true,
  },
  infoPageRoute: {
    title: 'Fixture Senior Essay',
    sourceUrl: 'https://fixture.yale.edu/senior-essay/',
    applicationLink: 'https://fixture.yale.edu/senior-essay/',
    undergraduateOnly: true,
    description: LONG_DESCRIPTION,
  },
  departmentGuidance: {
    title: 'Undergraduate Research in Fixture Studies',
    sourcePageTitle: 'Research Opportunities for Undergraduates',
    sourceUrl: 'https://fixture.yale.edu/undergraduate/research/',
    description:
      'Students interested in research should contact faculty directly to discuss opportunities in their labs.',
  },
  staleExternalAward: {
    title: 'Fixture External Scholarship',
    sourceName: 'external-award-fixture',
    sourceUrl: 'https://fixture.example.org/scholarship/',
    applicationLink: 'https://fixture.example.org/scholarship/apply/',
    deadline: '2024-01-15',
    upcomingDuplicateWindow: { start: '2024-01-01', end: '2024-02-01' },
    applicationInformation: 'Applications are due in January each year.',
    additionalInformation: 'The award recurs annually.',
    restrictionsToUseOfAward: 'Funds support research expenses only.',
    fullSourceDescription: LONG_DESCRIPTION,
    description: LONG_DESCRIPTION,
  },
  suspendedAward: {
    title: 'Fixture Travel Grant',
    sourceUrl: 'https://fixture.yale.edu/travel-grant/',
    applicationLink: 'https://fixture.yale.edu/travel-grant/apply/',
    description: 'This award is suspended for the current academic year and will not be offered.',
  },
  prizeForCompletedWork: {
    title: 'Fixture Prize for the Best Senior Essay',
    sourceUrl: 'https://fixture.yale.edu/prizes/',
    description: 'Awarded for the best senior essay completed in fixture studies.',
  },
  commonApplication: {
    title: 'Fixture Common Application',
    sourceUrl: 'https://fixture.yale.edu/common-application/',
    applicationLink: 'https://fixture.yale.edu/common-application/apply/',
    description: LONG_DESCRIPTION,
  },
  operatorOverride: {
    title: 'Fixture Overridden Program',
    sourceUrl: 'https://fixture.yale.edu/overridden/',
    studentVisibilityOverrideTier: 'suppressed',
    description: LONG_DESCRIPTION,
  },
  researchAreaEchoBody: {
    title: 'Fixture Program With Research Copy',
    sourceUrl: 'https://fixture.yale.edu/program-copy/',
    applicationLink: 'https://fixture.yale.edu/program-copy/apply/',
    undergraduateOnly: true,
    fullDescription: 'Studies fixture ecology, fixture genomics, and fixture modeling.',
    shortDescription: 'Studies fixture ecology and fixture genomics.',
    profileSynthesisDescription: 'A synthesized body for the fixture program.',
    researchAreas: ['fixture ecology', 'fixture genomics', 'fixture modeling'],
    profileResearchAreas: ['fixture ecology'],
    description: LONG_DESCRIPTION,
  },
  profileTopicEchoBody: {
    title: 'Fixture Program With Profile Topics',
    sourceUrl: 'https://fixture.yale.edu/program-topics/',
    applicationLink: 'https://fixture.yale.edu/program-topics/apply/',
    undergraduateOnly: true,
    fullDescription: 'Studies fixture ecology and fixture genomics.',
    profileSynthesisDescription: 'A synthesized body for the fixture program.',
    researchAreas: ['unrelated fixture topic'],
    profileResearchAreas: ['fixture ecology', 'fixture genomics'],
    description: LONG_DESCRIPTION,
  },
  graduateOnly: {
    title: 'Fixture Graduate Research Fellowship',
    sourceUrl: 'https://fixture.yale.edu/graduate-fellowship/',
    applicationLink: 'https://fixture.yale.edu/graduate-fellowship/apply/',
    yearOfStudy: ['Graduate'],
    description: LONG_DESCRIPTION,
  },
};

function readsOf(program: ProgramStudentVisibilityInput): Set<string> {
  const reads = new Set<string>();
  const recorded = new Proxy(program, {
    get(target, key, receiver) {
      if (typeof key === 'string') reads.add(key);
      return Reflect.get(target, key, receiver);
    },
    has(target, key) {
      if (typeof key === 'string') reads.add(key);
      return Reflect.has(target, key);
    },
  });
  computeProgramStudentVisibility(recorded, { now: NOW });
  return reads;
}

describe('the program visibility gate reads only its listed inputs (#6473)', () => {
  it.each(Object.entries(FIXTURES))('%s reads no field outside the list', (_name, program) => {
    const unlisted = [...readsOf(program)].filter((field) => !LISTED.has(field));
    expect(unlisted).toEqual([]);
  });

  it('flags a field the gate reads but the list leaves out', () => {
    const reads = readsOf(FIXTURES.studentReady);
    const withoutTitle = new Set([...LISTED].filter((field) => field !== 'title'));
    expect([...reads].filter((field) => !withoutTitle.has(field))).toEqual(['title']);
  });

  it('exercises the branch-only description fields the static trace found', () => {
    const reads = new Set(
      [FIXTURES.researchAreaEchoBody, FIXTURES.profileTopicEchoBody].flatMap((program) => [
        ...readsOf(program),
      ]),
    );
    expect(
      ['profileSynthesisDescription', 'researchAreas', 'profileResearchAreas'].filter(
        (field) => !reads.has(field),
      ),
    ).toEqual([]);
  });

  it('lists each field once', () => {
    expect(new Set(PROGRAM_STUDENT_VISIBILITY_INPUT_FIELDS).size).toBe(
      PROGRAM_STUDENT_VISIBILITY_INPUT_FIELDS.length,
    );
  });
});

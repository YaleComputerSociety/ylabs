import { describe, expect, it } from 'vitest';
import {
  namesASelfDeclaredLaboratory,
  namesAnOrganizationalResearchHome,
  researchEntityTypeNameContradiction,
} from '../../utils/researchHomeNameIdentityAuthority';
import {
  summarizeResearchEntityKindTyping,
  type KindTypingEntityInput,
} from '../researchEntityKindTypingAuditCore';
import { parseResearchEntityKindTypingAuditArgs } from '../researchEntityKindTypingAudit';

describe('namesAnOrganizationalResearchHome', () => {
  it('reads a lab, a research group and an umbrella organization as organizational', () => {
    for (const name of [
      'Peccia Lab',
      'The Breaker Laboratory',
      'A. Douglas Stone Research Group',
      'Yale Center for Customer Insights',
      'Wu Tsai Institute',
      'Magnetic Resonance Research Center',
    ]) {
      expect(namesAnOrganizationalResearchHome(name), name).toBe(true);
    }
  });

  it('reads a topical faculty-research name as not organizational', () => {
    for (const name of [
      'Jordan Example Faculty Research',
      'Asynchronous VLSI Design',
      'Early Modern Political Thought',
      '',
    ]) {
      expect(namesAnOrganizationalResearchHome(name), name).toBe(false);
    }
  });

  it('reads a lab name written as one closed compound as organizational', () => {
    // A site that brands itself this way carries no word boundary before "Lab", so
    // the word regex alone read five served `LAB` rows as contradicting their own
    // name when nothing was wrong with either field (#3252).
    for (const name of ['PittLab', 'BraunLab', 'JaneTaylorLab', 'QuLab', 'iLaboratory']) {
      expect(namesAnOrganizationalResearchHome(name), name).toBe(true);
    }
  });

  it('does not read an ordinary word that merely contains the letters as a lab', () => {
    // The capital is what keeps the compound rule narrow. "Collaboratory" is a
    // centre, and a name must not become organizational because a lowercase
    // substring happens to spell one.
    for (const name of ['a collab', 'Concrete slab', 'MATLAB']) {
      expect(namesAnOrganizationalResearchHome(name), name).toBe(false);
    }
    // A Collaboratory is organizational, as an umbrella rather than as a lab, and
    // the compound rule must not promote it to one: this is the case the existing
    // note beside the umbrella vocabulary already protects.
    expect(namesASelfDeclaredLaboratory('The Education Collaboratory at Yale')).toBe(false);
  });

  it('does not read an umbrella name as topical merely because it is an umbrella', () => {
    // `isUmbrellaOrganizationName` draws a different line for a different question,
    // and this predicate must not inherit it.
    expect(namesAnOrganizationalResearchHome('Yale Center for Customer Insights')).toBe(true);
  });
});

describe('researchEntityTypeNameContradiction', () => {
  it('flags a LAB whose name names a topic rather than an organization', () => {
    expect(
      researchEntityTypeNameContradiction({
        entityType: 'LAB',
        name: 'Early Modern Political Thought',
      }),
    ).toBe('lab_named_as_a_topic');
  });

  it('flags a FACULTY_RESEARCH_AREA whose name names an organization', () => {
    expect(
      researchEntityTypeNameContradiction({
        entityType: 'FACULTY_RESEARCH_AREA',
        name: 'Magnetic Resonance Research Center',
      }),
    ).toBe('faculty_research_area_named_as_an_organization');
  });

  it('agrees with the rule on a well-typed row of either kind', () => {
    expect(researchEntityTypeNameContradiction({ entityType: 'LAB', name: 'Peccia Lab' })).toBe('');
    expect(
      researchEntityTypeNameContradiction({
        entityType: 'FACULTY_RESEARCH_AREA',
        name: 'Jordan Example Faculty Research',
      }),
    ).toBe('');
  });

  it('falls back to displayName and stays silent on a nameless row', () => {
    expect(
      researchEntityTypeNameContradiction({ entityType: 'LAB', displayName: 'Peccia Lab' }),
    ).toBe('');
    expect(researchEntityTypeNameContradiction({ entityType: 'LAB' })).toBe('');
  });

  it('judges the heading the route serves when displayName and name disagree', () => {
    // `researchEntityDisplayName` prefers `displayName`, so a row whose stored `name`
    // is topical serves an organizational heading and contradicts nothing, while a row
    // whose `displayName` is topical serves that topic above a lab kind label.
    expect(
      researchEntityTypeNameContradiction({
        entityType: 'LAB',
        name: 'Early Modern Political Thought',
        displayName: 'Peccia Lab',
      }),
    ).toBe('');
    expect(
      researchEntityTypeNameContradiction({
        entityType: 'LAB',
        name: 'Peccia Lab',
        displayName: 'Early Modern Political Thought',
      }),
    ).toBe('lab_named_as_a_topic');
  });

  it('keeps the graft guard, so a person-scoped row is judged on the name it serves', () => {
    // A `displayName` claiming a lab on a person-scoped row whose `name` does not is a
    // graft the route refuses, so the row serves `name` and asserts no organization.
    expect(
      researchEntityTypeNameContradiction({
        entityType: 'FACULTY_RESEARCH_AREA',
        name: 'Jordan Example Faculty Research',
        displayName: 'Peccia Lab',
      }),
    ).toBe('');
  });

  it('judges no other entity type, because the rule is this one axis', () => {
    for (const entityType of ['CENTER', 'INSTITUTE', 'CORE_FACILITY', 'GROUP']) {
      expect(
        researchEntityTypeNameContradiction({ entityType, name: 'Early Modern Political Thought' }),
        entityType,
      ).toBe('');
    }
  });
});

const entity = (over: Record<string, unknown>): KindTypingEntityInput => ({
  id: String(over.id ?? over.slug),
  studentVisibilityTier: 'student_ready',
  ...over,
});

describe('summarizeResearchEntityKindTyping', () => {
  const entities = [
    entity({ slug: 'a', entityType: 'LAB', name: 'Peccia Lab', websiteUrl: 'https://e.example' }),
    entity({ slug: 'b', entityType: 'LAB', name: 'Early Modern Political Thought' }),
    entity({
      slug: 'c',
      entityType: 'LAB',
      name: 'Asynchronous Design',
      studentVisibilityTier: 'operator_review',
    }),
    entity({
      slug: 'd',
      entityType: 'FACULTY_RESEARCH_AREA',
      name: 'Jordan Example Faculty Research',
    }),
    entity({ slug: 'e', entityType: 'FACULTY_RESEARCH_AREA', name: 'Wu Tsai Institute' }),
    entity({ slug: 'f', entityType: 'CENTER', name: 'Not On This Axis' }),
  ];

  it('counts each contradiction once and keeps the served flag per row', () => {
    const report = summarizeResearchEntityKindTyping({ entities, leadEdges: [] });
    expect(report.contradictionCounts).toEqual({
      lab_named_as_a_topic: 2,
      faculty_research_area_named_as_an_organization: 1,
    });
    expect(report.contradictions.map((row) => [row.slug, row.served])).toEqual([
      ['b', true],
      ['c', false],
      ['e', true],
    ]);
    expect(report.contradictions[0].hasOwnWebsiteUrl).toBe(false);
  });

  it('measures the discriminator the typing rule is keyed on', () => {
    const report = summarizeResearchEntityKindTyping({ entities, leadEdges: [] });
    expect(report.servedLabRows).toBe(2);
    expect(report.servedLabNamesOrganizational).toBe(1);
    expect(report.servedFacultyResearchAreaRows).toBe(2);
    expect(report.servedFacultyResearchAreaNamesOrganizational).toBe(1);
  });

  it('groups a person who leads both kinds, and ignores a member role', () => {
    const report = summarizeResearchEntityKindTyping({
      entities,
      leadEdges: [
        { personId: 'p1', role: 'PI', entityId: 'a' },
        { personId: 'p1', role: 'PI', entityId: 'd' },
        { personId: 'p2', role: 'PI', entityId: 'a' },
        { personId: 'p3', role: 'GRADUATE_STUDENT', entityId: 'a' },
        { personId: 'p3', role: 'GRADUATE_STUDENT', entityId: 'd' },
        { personId: 'p4', role: 'DIRECTOR', entityId: 'c' },
        { personId: 'p4', role: 'PI', entityId: 'd' },
      ],
    });
    expect(report.dualLeadPeople).toBe(2);
    expect(report.dualLeadPeopleWithBothServed).toBe(1);
    expect(report.dualLeadGroups[0]).toEqual({
      labEntitySlugs: ['a'],
      facultyResearchAreaEntitySlugs: ['d'],
      servedLabs: 1,
      servedFacultyResearchAreas: 1,
    });
  });

  it('goes clean only when no contradiction and no dual lead stands', () => {
    expect(summarizeResearchEntityKindTyping({ entities, leadEdges: [] }).status).toBe(
      'contradictions',
    );
    const coherent = entities.filter((row) => !['b', 'c', 'e'].includes(String(row.slug)));
    expect(summarizeResearchEntityKindTyping({ entities: coherent, leadEdges: [] }).status).toBe(
      'clean',
    );
    expect(
      summarizeResearchEntityKindTyping({
        entities: coherent,
        leadEdges: [
          { personId: 'p1', role: 'PI', entityId: 'a' },
          { personId: 'p1', role: 'PI', entityId: 'd' },
        ],
      }).status,
    ).toBe('contradictions');
  });
});

describe('parseResearchEntityKindTypingAuditArgs', () => {
  it('accepts the served-only scope and refuses an unknown flag', () => {
    expect(parseResearchEntityKindTypingAuditArgs([])).toEqual({ servedOnly: false });
    expect(parseResearchEntityKindTypingAuditArgs(['--served-only'])).toEqual({ servedOnly: true });
    expect(() => parseResearchEntityKindTypingAuditArgs(['--apply'])).toThrow(/Unknown/);
  });
});

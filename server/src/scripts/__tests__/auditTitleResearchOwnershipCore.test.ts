import { describe, it, expect } from 'vitest';
import {
  auditTitleResearchOwnership,
  type TitleOwnershipRow,
} from '../auditTitleResearchOwnershipCore';

const row = (over: Partial<TitleOwnershipRow> = {}): TitleOwnershipRow => ({
  id: 'a'.repeat(24),
  entityType: 'FACULTY_RESEARCH_AREA',
  tier: 'student_ready',
  identityProfileUrl: 'https://medicine.example.edu/profile/a-person/',
  storedTitles: ['Postdoctoral Associate'],
  leadEdgesElsewhere: 0,
  ...over,
});

describe('auditTitleResearchOwnership', () => {
  it('buckets a row by what its titles claim, and counts the served split', () => {
    const audit = auditTitleResearchOwnership([
      row(),
      row({ id: 'b'.repeat(24), storedTitles: ['Professor of Neurology'] }),
      row({
        id: 'c'.repeat(24),
        storedTitles: ['Laboratory Assistant 3'],
        tier: 'operator_review',
      }),
      row({ id: 'd'.repeat(24), identityProfileUrl: null }),
      row({ id: 'e'.repeat(24), storedTitles: [] }),
    ]);
    expect(audit.scanned).toBe(5);
    expect(audit.byBucket.works_in_another_group).toBe(1);
    expect(audit.byBucket.owns_research).toBe(1);
    expect(audit.byBucket.states_no_rank).toBe(1);
    expect(audit.byBucket.no_identity_profile).toBe(1);
    expect(audit.byBucket.no_stored_title).toBe(1);
    expect(audit.servedByBucket.works_in_another_group).toBe(1);
    expect(audit.servedByBucket.states_no_rank).toBe(0);
  });

  // Unanimity, as in the retirement pass: several lanes write a title against one profile
  // URL and none of them owns the question.
  it('gives a row whose titles disagree its own bucket rather than resolving it', () => {
    const audit = auditTitleResearchOwnership([
      row({ storedTitles: ['Postdoctoral Associate', 'Professor of Neurology'] }),
    ]);
    expect(audit.byBucket.titles_disagree).toBe(1);
    expect(audit.byBucket.works_in_another_group).toBe(0);
    expect(audit.findings).toEqual([]);
  });

  it("reports the predicate's known limit alongside the population it sizes", () => {
    const audit = auditTitleResearchOwnership([
      row(),
      row({
        id: 'f'.repeat(24),
        storedTitles: ['Associate Director, PhD Graduate Student Affairs'],
      }),
    ]);
    expect(audit.worksInAnotherGroup.rows).toBe(2);
    expect(audit.worksInAnotherGroup.namingARankTheyServe).toBe(1);
  });

  it('counts the second witness without acting on it', () => {
    const audit = auditTitleResearchOwnership([
      row({ leadEdgesElsewhere: 2 }),
      row({ id: 'g'.repeat(24) }),
    ]);
    expect(audit.worksInAnotherGroup.corroboratedByALeadEdgeElsewhere).toBe(1);
    expect(audit.findings.map((f) => f.corroboratedByALeadEdgeElsewhere)).toEqual([true, false]);
  });

  it('names the ranks behind each finding so a verdict can be explained', () => {
    const audit = auditTitleResearchOwnership([
      row({ storedTitles: ['Associate Research Scientist in Neurology'] }),
    ]);
    expect(audit.findings[0].ranksNamed).toEqual(['associate research scientist']);
  });
});

/**
 * The panel is the instrument the team answers "is the corpus getting better" with,
 * so a metric that counts stored values while students read served ones makes the
 * operator's own measurement wrong (#3379). This pins the topic count to the served
 * chip list, and pins that the withholding itself is left alone: the unsourced
 * domain-coherence guard is doing its job, and the defect was the count.
 */
import { describe, expect, it } from 'vitest';

import { servedRowFacts } from '../corpusQualityReport';
import { toPublicResearchEntityDto } from '../researchEntityDto';

const rowWithAnAlienChip = {
  _id: 'fixture-id',
  slug: 'dept-fictional-studies-robin-roster',
  name: 'Robin Roster Faculty Research',
  kind: 'individual',
  entityType: 'FACULTY_RESEARCH_AREA',
  studentVisibilityTier: 'student_ready',
  departments: ['Fictional Studies'],
  fullDescription:
    'Studies medieval manuscript transmission and scribal practice across fictional archives, with attention to marginalia.',
  shortDescription: 'Studies medieval manuscript transmission in fictional archives.',
  researchAreas: ['Medieval Manuscripts', 'Quantum Chromodynamics'],
};

describe('servedRowFacts topic count', () => {
  it('counts the chips a student is served, not the chips the row stores', () => {
    const facts = servedRowFacts({ ...rowWithAnAlienChip }, ['Robin Roster']);
    const served = toPublicResearchEntityDto(
      { ...rowWithAnAlienChip },
      {
        leadMemberNames: ['Robin Roster'],
      },
    ).researchAreas;

    expect(rowWithAnAlienChip.researchAreas).toHaveLength(2);
    expect(served).toEqual(['Medieval Manuscripts']);
    expect(facts.topicCount).toBe(served.length);
    expect(facts.hasTopic).toBe(true);
  });

  it('reports no topic when every stored chip is withheld', () => {
    const row = { ...rowWithAnAlienChip, researchAreas: ['Quantum Chromodynamics'] };
    const facts = servedRowFacts(row, ['Robin Roster']);

    expect(row.researchAreas).toHaveLength(1);
    expect(
      toPublicResearchEntityDto({ ...row }, { leadMemberNames: ['Robin Roster'] }).researchAreas,
    ).toEqual([]);
    expect(facts.topicCount).toBe(0);
    expect(facts.hasTopic).toBe(false);
  });
});

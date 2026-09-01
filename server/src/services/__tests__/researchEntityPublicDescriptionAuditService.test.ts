import { describe, expect, it } from 'vitest';

import { buildPublicDescriptionAuditReport } from '../researchEntityPublicDescriptionAuditService';

const validEntity = {
  _id: 'entity-valid',
  slug: 'valid-research',
  name: 'Valid Research',
  kind: 'lab',
  shortDescription:
    'Studies molecular dynamics, protein folding, and cellular signaling in biological systems.',
  fullDescription:
    'This research studies molecular dynamics, protein folding, and cellular signaling across complex biological systems.',
  sourceUrls: ['https://example.yale.edu/research/valid'],
};

describe('buildPublicDescriptionAuditReport', () => {
  it('reports post-sanitization violations without exposing description text', () => {
    const report = buildPublicDescriptionAuditReport({
      entities: [
        validEntity,
        {
          _id: 'entity-invalid',
          slug: 'correct-person-research',
          name: 'Correct Person Faculty Research',
          kind: 'individual',
          entityType: 'FACULTY_RESEARCH_AREA',
          descriptionSource: 'PI_PROFILE_SYNTHESIS',
          shortDescription:
            "Wrong Person's expertise lies in molecular dynamics, protein folding, and cellular signaling.",
          fullDescription:
            "Wrong Person's expertise lies in molecular dynamics, protein folding, and cellular signaling across complex biological systems.",
          sourceUrls: ['https://example.yale.edu/profile/correct-person'],
        },
      ],
      leadMembersByEntityId: new Map([
        ['entity-invalid', [{ role: 'pi', user: { fname: 'Correct', lname: 'Person' } }]],
      ]),
      includeSamples: true,
    });

    expect(report.pass).toBe(false);
    expect(report.counts).toEqual({
      scanned: 2,
      violations: 1,
      missingPublicFullDescription: 1,
      missingPublicCardDescription: 1,
    });
    expect(report.samples).toEqual([
      expect.objectContaining({
        recordId: 'entity-invalid',
        leadMemberNames: ['Correct Person'],
        reasons: [
          'missing_public_full_description',
          'missing_public_card_description',
          'blank_served_public_description',
        ],
      }),
    ]);
    expect(JSON.stringify(report)).not.toContain("Wrong Person's expertise");
  });

  it('omits samples by default and passes a valid corpus', () => {
    const report = buildPublicDescriptionAuditReport({
      entities: [validEntity],
      leadMembersByEntityId: new Map(),
    });

    expect(report.pass).toBe(true);
    expect(report.counts.violations).toBe(0);
    expect(report).not.toHaveProperty('samples');
  });
});

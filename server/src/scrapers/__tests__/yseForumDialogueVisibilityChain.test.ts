import { describe, it, expect } from 'vitest';
import { inferKind } from '../sources/yseCentersScraper';
import { mapResearchGroupKindToEntityType } from '../../models/researchAccessTypes';
import { computeResearchEntityStudentVisibility } from '../../services/studentVisibilityTier';

function forumEntityFromScrapedKind(name: string, url: string) {
  const kind = inferKind(name, url);
  return {
    entity: {
      _id: 'yse-yale-forest-forum',
      name,
      slug: 'yse-yale-forest-forum',
      entityType: mapResearchGroupKindToEntityType(kind),
      shortDescription:
        'A Yale School of the Environment convening body linking forest research, policy, and practice.',
      fullDescription:
        'The Yale Forest Forum convenes researchers, students, and practitioners across the Yale School of the Environment to advance dialogue on forest science, management, and policy.',
      websiteUrl: url,
      sourceUrls: [url, `${url}/get-involved`],
    },
    leadMembers: [] as Array<Record<string, unknown>>,
    accessSignalCount: 1,
    actionablePathwayCount: 1,
    relatedEntityAccessPathCount: 1,
  };
}

describe('YSE forum/dialogue organizational homes reach students end-to-end', () => {
  const name = 'Yale Forest Forum (YFF)';
  const url = 'https://environment.yale.edu/yale-forest-forum';

  it('routes a scraped forum through inferKind -> entityType -> visibility gate without stranding on missing_lead', () => {
    const kind = inferKind(name, url);
    expect(kind).toBe('initiative');
    expect(mapResearchGroupKindToEntityType(kind)).toBe('INITIATIVE');

    const result = computeResearchEntityStudentVisibility(forumEntityFromScrapedKind(name, url));

    expect(result.reasons).not.toContain('missing_lead');
    expect(result.tier).toBe('student_ready');
  });

  it('reproduces the pre-fix strand: the same leadless forum typed as GROUP is held on missing_lead and never student_ready', () => {
    const scraped = forumEntityFromScrapedKind(name, url);
    const strandedAsGroup = {
      ...scraped,
      entity: { ...scraped.entity, entityType: mapResearchGroupKindToEntityType('group') },
    };
    expect(strandedAsGroup.entity.entityType).toBe('GROUP');

    const result = computeResearchEntityStudentVisibility(strandedAsGroup);

    expect(result.reasons).toContain('missing_lead');
    expect(result.tier).not.toBe('student_ready');
  });
});

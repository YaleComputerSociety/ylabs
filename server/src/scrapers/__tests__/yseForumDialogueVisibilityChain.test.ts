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

  // The original strand was a leadless forum typed GROUP, which was not
  // lead-exempt and so was floored on missing_lead. GROUP was retired (#2202)
  // and the legacy `group` kind now maps to the organizational INITIATIVE, so
  // the strand is unreachable by construction rather than merely fixed.
  it('leaves the legacy group kind no way back to a lead-stranded entity type', () => {
    const scraped = forumEntityFromScrapedKind(name, url);
    const remappedFromGroupKind = {
      ...scraped,
      entity: { ...scraped.entity, entityType: mapResearchGroupKindToEntityType('group') },
    };
    expect(remappedFromGroupKind.entity.entityType).toBe('INITIATIVE');

    const result = computeResearchEntityStudentVisibility(remappedFromGroupKind);

    expect(result.reasons).not.toContain('missing_lead');
    expect(result.tier).toBe('student_ready');
  });
});

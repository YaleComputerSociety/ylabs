import { describe, expect, it, vi } from 'vitest';
import {
  listAffiliatedResearchEntitiesForDetail,
  listRelatedResearchEntitiesForDetail,
  relationshipLabel,
} from '../researchEntityRelationshipService';

const makeLeanQuery = <T>(value: T) => ({
  sort: vi.fn().mockReturnThis(),
  lean: vi.fn().mockResolvedValue(value),
});

describe('researchEntityRelationshipService', () => {
  it('hydrates outgoing relationships into public related research entity cards', async () => {
    const sourceResearchEntityId = 'source-entity';
    const targetResearchEntityId = 'target-entity';
    const relationshipModel = {
      find: vi.fn().mockReturnValue(
        makeLeanQuery([
          {
            _id: 'rel-1',
            sourceResearchEntityId,
            targetResearchEntityId,
            relationshipType: 'MEMBER_RESEARCH_AREA',
            evidenceStrength: 'MODERATE',
            sourceUrl: 'https://example.edu/research/members',
            confidence: 0.75,
          },
        ]),
      ),
    };
    const researchEntityModel = {
      find: vi.fn().mockReturnValue(
        makeLeanQuery([
          {
            _id: targetResearchEntityId,
            slug: 'example-faculty-research',
            name: 'Example Faculty Research',
            kind: 'individual',
            researchAreas: ['applied methods'],
            sourceUrls: ['https://example.edu/research/example-faculty'],
          },
        ]),
      ),
    };

    const result = await listRelatedResearchEntitiesForDetail(sourceResearchEntityId, {
      relationshipModel,
      researchEntityModel,
    });

    expect(relationshipModel.find).toHaveBeenCalledWith({
      sourceResearchEntityId,
      archived: { $ne: true },
    });
    expect(result.relationships).toHaveLength(1);
    expect(result.relationships[0]).toMatchObject({
      relationshipType: 'MEMBER_RESEARCH_AREA',
      label: 'Faculty research area',
      targetResearchEntityId,
    });
    expect(result.relatedResearchEntities).toHaveLength(1);
    expect(result.relatedResearchEntities[0]).toMatchObject({
      _id: targetResearchEntityId,
      id: targetResearchEntityId,
      slug: 'example-faculty-research',
      name: 'Example Faculty Research',
      kind: 'individual',
    });
  });

  it('hydrates inbound relationships into public affiliated umbrella cards', async () => {
    const sourceResearchEntityId = 'source-entity';
    const targetResearchEntityId = 'target-entity';
    const relationshipModel = {
      find: vi.fn().mockReturnValue(
        makeLeanQuery([
          {
            _id: 'rel-2',
            sourceResearchEntityId,
            targetResearchEntityId,
            relationshipType: 'MEMBER_RESEARCH_AREA',
            evidenceStrength: 'MODERATE',
            sourceUrl: 'https://example.edu/research/faculty',
            confidence: 0.72,
          },
        ]),
      ),
    };
    const researchEntityModel = {
      find: vi.fn().mockReturnValue(
        makeLeanQuery([
          {
            _id: sourceResearchEntityId,
            slug: 'example-research-institute',
            name: 'Example Research Institute',
            kind: 'institute',
            researchAreas: ['Interdisciplinary methods'],
            sourceUrls: ['https://example.edu/research/faculty'],
          },
        ]),
      ),
    };

    const result = await listAffiliatedResearchEntitiesForDetail(targetResearchEntityId, {
      relationshipModel,
      researchEntityModel,
    });

    expect(relationshipModel.find).toHaveBeenCalledWith({
      targetResearchEntityId,
      archived: { $ne: true },
    });
    expect(result.relationships).toHaveLength(1);
    expect(result.relationships[0]).toMatchObject({
      relationshipType: 'MEMBER_RESEARCH_AREA',
      label: 'Faculty research area',
      sourceResearchEntityId,
    });
    expect(result.relatedResearchEntities).toHaveLength(1);
    expect(result.relatedResearchEntities[0]).toMatchObject({
      _id: sourceResearchEntityId,
      id: sourceResearchEntityId,
      slug: 'example-research-institute',
      name: 'Example Research Institute',
      kind: 'institute',
    });
  });

  it('uses student-facing labels for relationship types', () => {
    expect(relationshipLabel('AFFILIATED_LAB')).toBe('Affiliated lab');
    expect(relationshipLabel('AFFILIATED_RESEARCH_GROUP')).toBe('Related research group');
    expect(relationshipLabel('MEMBER_RESEARCH_AREA')).toBe('Faculty research area');
    expect(relationshipLabel('HOSTED_PROGRAM')).toBe('Hosted program');
  });
});

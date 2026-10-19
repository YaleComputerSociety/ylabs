import { describe, expect, it } from 'vitest';
import { BETA_SCORECARD_REFERENCE_EDGES } from '../betaDataQuality';

describe('Beta data quality references after slim tombstones (#5208)', () => {
  it('fails loudly on a role assignment or relationship whose research entity is missing', () => {
    const byName = new Map(BETA_SCORECARD_REFERENCE_EDGES.map((edge) => [edge.name, edge]));
    expect(byName.get('role_assignments.target.id')).toMatchObject({
      localField: 'target.id',
      targetCollectionName: 'research_entities',
      required: true,
      ownerFilter: { 'target.kind': 'RESEARCH_ENTITY' },
    });
    for (const field of ['sourceResearchEntityId', 'targetResearchEntityId']) {
      expect(byName.get(`research_entity_relationships.${field}`)).toMatchObject({
        localField: field,
        targetCollectionName: 'research_entities',
        required: true,
      });
    }
    expect(byName.get('signals.researchEntityId')).toMatchObject({ required: true });
  });
});

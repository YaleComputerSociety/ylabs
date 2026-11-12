import { describe, expect, it } from 'vitest';
import {
  researchFacetFieldsForIndex,
  withoutUnavailableResearchTypes,
} from '../researchGroupService';

const everyField = () => true;
const withoutResearchType = (field: string) =>
  field !== 'researchType' && field !== 'creativePractice';

describe('the Type facet axis follows the live index (#5141)', () => {
  it('facets on the research type once the index declares it, and never on both axes', () => {
    const fields = researchFacetFieldsForIndex(everyField);

    expect(fields).toContain('researchType');
    expect(fields).not.toContain('entityType');
  });

  it('facets on the entity type while the index does not declare the research type', () => {
    const fields = researchFacetFieldsForIndex(withoutResearchType);

    expect(fields).toContain('entityType');
    expect(fields).not.toContain('researchType');
  });

  it('reports a creative practice filter an older index cannot apply as dropped', () => {
    expect(
      withoutUnavailableResearchTypes({ entityType: ['CREATIVE_PRACTICE'] }, withoutResearchType),
    ).toEqual({ filters: { entityType: [] }, dropped: { entityType: [] } });
    expect(
      withoutUnavailableResearchTypes(
        { entityType: ['CREATIVE_PRACTICE', 'LAB'] },
        withoutResearchType,
      ),
    ).toEqual({ filters: { entityType: ['LAB'] }, dropped: { entityType: ['LAB'] } });
  });

  it('drops nothing when the index can apply the value', () => {
    const filters = { entityType: ['CREATIVE_PRACTICE'] };

    expect(withoutUnavailableResearchTypes(filters, everyField)).toEqual({ filters });
    expect(withoutUnavailableResearchTypes({ entityType: ['LAB'] }, withoutResearchType)).toEqual({
      filters: { entityType: ['LAB'] },
    });
  });
});

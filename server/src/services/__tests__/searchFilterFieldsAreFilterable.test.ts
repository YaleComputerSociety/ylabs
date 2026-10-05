import { describe, expect, it } from 'vitest';
import { getResearchEntitySearchIndexSettings } from '../researchEntitySearchIndexService';
import {
  buildResearchGroupFilterString,
  type ResearchGroupFilterInput,
} from '../researchGroupFilters';
import {
  DISJUNCTIVE_RESEARCH_FACETS,
  RESEARCH_ENTITY_SEARCH_FACET_FIELDS,
} from '../researchGroupService';

const everyFilterSet: Required<ResearchGroupFilterInput> = {
  kind: ['kind-value'],
  entityType: ['entity-type-value'],
  school: ['school-value'],
  departments: ['department-value'],
  researchAreas: ['topic-value'],
  hostsUndergrads: true,
  studentVisibilityTier: ['tier-value'],
};

const fieldsEmittedByFilterBuilder = (): string[] => {
  const filter = buildResearchGroupFilterString(everyFilterSet);
  const fields = [...filter.matchAll(/([A-Za-z_][A-Za-z0-9_.]*)\s*(?:=|!=|>=|<=|>|<)/g)].map(
    (match) => match[1],
  );
  return [...new Set(fields)];
};

describe('search filter fields against the index settings', () => {
  const filterable = getResearchEntitySearchIndexSettings().filterableAttributes;

  it('emits a clause for every filter input field', () => {
    const fields = fieldsEmittedByFilterBuilder();
    expect(fields).toEqual(
      expect.arrayContaining([
        'archived',
        'kind',
        'entityType',
        'schools',
        'departments',
        'researchAreas',
        'hasUndergradHostingEvidence',
        'studentVisibilityTier',
      ]),
    );
    expect(fields.length).toBeGreaterThanOrEqual(Object.keys(everyFilterSet).length + 1);
  });

  it.each(fieldsEmittedByFilterBuilder())(
    'declares the emitted filter field %s filterable',
    (field) => {
      expect(filterable).toContain(field);
    },
  );

  it.each([...RESEARCH_ENTITY_SEARCH_FACET_FIELDS])(
    'declares the facet field %s filterable',
    (field) => {
      expect(filterable).toContain(field);
    },
  );

  it.each(DISJUNCTIVE_RESEARCH_FACETS.map((facet) => facet.meiliField))(
    'declares the disjunctive facet field %s filterable',
    (field) => {
      expect(filterable).toContain(field);
    },
  );
});

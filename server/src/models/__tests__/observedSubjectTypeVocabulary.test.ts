import { describe, expect, it } from 'vitest';
import { observedEntityTypes } from '../observation';
import { asResearchEntityType, researchEntityTypes } from '../researchAccessTypes';

describe('the observation subject vocabulary and the product entity-type vocabulary (#210)', () => {
  it('share the name entityType and no values', () => {
    const shared = observedEntityTypes.filter((subject) =>
      (researchEntityTypes as readonly string[]).includes(subject),
    );
    expect(shared).toEqual([]);
  });

  it('refuses every subject value at the product narrowing door', () => {
    for (const subject of observedEntityTypes) {
      expect(asResearchEntityType(subject)).toBeUndefined();
    }
  });

  it('admits every product value at the same door, so the refusal above is not a blanket no', () => {
    for (const productType of researchEntityTypes) {
      expect(asResearchEntityType(productType)).toBe(productType);
    }
  });

  it('refuses a value in neither vocabulary rather than passing it through', () => {
    expect(asResearchEntityType('lab')).toBeUndefined();
    expect(asResearchEntityType('')).toBeUndefined();
    expect(asResearchEntityType(undefined)).toBeUndefined();
    expect(asResearchEntityType(7)).toBeUndefined();
  });

  it('keeps the schema enum and the type derived from one list', () => {
    expect([...observedEntityTypes]).toEqual([
      'user',
      'researchEntity',
      'researchEntityRelationship',
      'researchGroupMember',
      'fellowship',
      'departmentRosterHealth',
      'ysmLabIndexHealth',
      'orgUnit',
    ]);
  });
});

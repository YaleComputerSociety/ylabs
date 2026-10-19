import { describe, expect, it } from 'vitest';

import { buildWayInBadgesFromEntity } from '../researchDiscoveryAdapters';
import type { ResearchEntity } from '../../types/researchGroup';

const entity = (fields: Partial<ResearchEntity>): ResearchEntity =>
  ({ ...fields }) as ResearchEntity;

describe('buildWayInBadgesFromEntity', () => {
  it('finds no signal in an entity carrying no evidence', () => {
    expect(buildWayInBadgesFromEntity(entity({}))).toEqual([]);
  });

  it('finds no signal in a missing entity', () => {
    expect(buildWayInBadgesFromEntity(undefined)).toEqual([]);
  });

  it('reads undergraduate evidence from the served hosted flag (#3593)', () => {
    expect(buildWayInBadgesFromEntity(entity({ hasUndergradHostingEvidence: true }))).toEqual([
      'Undergrad evidence',
    ]);
  });

  /**
   * The badge must not re-derive hosting from raw fields: the server owns the one
   * predicate the browse filter and saved plans also read, so a field the server
   * does not count, such as a roster count it holds out, must not light the badge.
   */
  it('does not re-derive hosting from a current undergraduate count', () => {
    expect(buildWayInBadgesFromEntity(entity({ currentUndergradCount: 3 }))).toEqual([]);
  });

  it.each([
    ['an independent-study flag', { offersIndependentStudy: true }],
    ['a listed course', { independentStudyCourses: [{ code: 'ABCD 4900' }] }],
    ['typical roles', { typicalUndergradRoles: ['Data analysis'] }],
  ])('reads nothing from %s, a field the API no longer serves (#3579)', (_label, fields) => {
    const legacyPayload = { ...fields } as unknown as ResearchEntity;
    expect(buildWayInBadgesFromEntity(legacyPayload)).toEqual([]);
  });

  /**
   * `Contact route` is derivable only from a pathway hit, and the browse payload
   * carries no contact field, so it must never be invented here. Claiming a
   * contact route the product cannot honour is the clickbait failure that costs
   * the next click too.
   */
  it('never claims a contact route', () => {
    const everything = entity({
      hasUndergradHostingEvidence: true,
      currentUndergradCount: 3,
    });

    expect(buildWayInBadgesFromEntity(everything)).toEqual(['Undergrad evidence']);
  });
});

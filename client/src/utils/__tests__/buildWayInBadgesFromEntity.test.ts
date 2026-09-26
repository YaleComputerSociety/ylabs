import { describe, expect, it } from 'vitest';

import { buildWayInBadgesFromEntity } from '../researchDiscoveryAdapters';
import type { ResearchEntity } from '../../types/researchGroup';

const entity = (fields: Partial<ResearchEntity>): ResearchEntity =>
  ({ typicalUndergradRoles: [], ...fields }) as ResearchEntity;

describe('buildWayInBadgesFromEntity', () => {
  it('finds no signal in an entity carrying no evidence', () => {
    expect(buildWayInBadgesFromEntity(entity({}))).toEqual([]);
  });

  it('finds no signal in a missing entity', () => {
    expect(buildWayInBadgesFromEntity(undefined)).toEqual([]);
  });

  it.each([
    ['a quote', { undergradEvidenceQuote: 'Two undergraduates joined in 2025.' }],
    ['past advisees', { pastUndergradAdvisees: [{}] as ResearchEntity['pastUndergradAdvisees'] }],
    ['typical roles', { typicalUndergradRoles: ['Data analysis'] }],
  ])('reads undergraduate evidence from %s', (_label, fields) => {
    expect(buildWayInBadgesFromEntity(entity(fields))).toEqual(['Undergrad evidence']);
  });

  it.each([
    ['the independent-study flag', { offersIndependentStudy: true }],
    [
      'a listed course',
      { independentStudyCourses: [{}] as ResearchEntity['independentStudyCourses'] },
    ],
  ])('reads student-project evidence from %s', (_label, fields) => {
    expect(buildWayInBadgesFromEntity(entity(fields))).toEqual(['Student project evidence']);
  });

  /** A whitespace-only quote is absence of evidence, not evidence. */
  it('treats a blank quote as no evidence', () => {
    expect(buildWayInBadgesFromEntity(entity({ undergradEvidenceQuote: '   ' }))).toEqual([]);
  });

  it('treats a false independent-study flag as no evidence', () => {
    expect(buildWayInBadgesFromEntity(entity({ offersIndependentStudy: false }))).toEqual([]);
  });

  /**
   * `Contact route` is derivable only from a pathway hit, and the browse payload
   * carries no contact field, so it must never be invented here. Claiming a
   * contact route the product cannot honour is the clickbait failure that costs
   * the next click too.
   */
  it('never claims a contact route', () => {
    const everything = entity({
      undergradEvidenceQuote: 'Undergraduates contribute each term.',
      offersIndependentStudy: true,
      typicalUndergradRoles: ['Field work'],
    });

    expect(buildWayInBadgesFromEntity(everything)).toEqual([
      'Undergrad evidence',
      'Student project evidence',
    ]);
  });
});

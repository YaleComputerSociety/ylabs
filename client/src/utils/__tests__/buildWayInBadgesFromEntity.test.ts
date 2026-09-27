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
    ['past advisees', { pastUndergradAdvisees: [{}] as ResearchEntity['pastUndergradAdvisees'] }],
    ['typical roles', { typicalUndergradRoles: ['Data analysis'] }],
  ])('reads undergraduate evidence from %s', (_label, fields) => {
    expect(buildWayInBadgesFromEntity(entity(fields))).toEqual(['Undergrad evidence']);
  });

  /**
   * The load-bearing assertion of this file. #3569 measured badge precision for
   * the dominant source of `undergradEvidenceQuote` at 0.36, Wilson 95% upper
   * bound 0.50, and found that 19 of 50 sampled quotes were the model's own
   * absence commentary, which switched the badge on where the lane had found
   * nothing. A quote alone must never assert undergraduate access.
   */
  it('never claims undergraduate access from a quote alone', () => {
    const quoteOnly = entity({
      undergradEvidenceQuote: 'No explicit mention of undergraduates on the provided pages.',
    });

    expect(buildWayInBadgesFromEntity(quoteOnly)).toEqual([]);
  });

  it('never claims undergraduate access from a plausible-looking quote either', () => {
    const plausible = entity({
      undergradEvidenceQuote: 'Undergraduates have contributed to this work every term.',
    });

    expect(buildWayInBadgesFromEntity(plausible)).toEqual([]);
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
      offersIndependentStudy: true,
      typicalUndergradRoles: ['Field work'],
    });

    expect(buildWayInBadgesFromEntity(everything)).toEqual([
      'Undergrad evidence',
      'Student project evidence',
    ]);
  });
});

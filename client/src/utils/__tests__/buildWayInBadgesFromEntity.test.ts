import { describe, expect, it } from 'vitest';

import { buildWayInBadges, buildWayInBadgesFromEntity } from '../researchDiscoveryAdapters';
import type { PathwaySearchHit } from '../../types/pathway';
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
  it.each([
    ['a current undergraduate count', { currentUndergradCount: 3 }],
    ['typical roles', { typicalUndergradRoles: ['Data analysis'] }],
  ])('does not re-derive hosting from %s', (_label, fields) => {
    expect(buildWayInBadgesFromEntity(entity(fields))).toEqual([]);
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
      hasUndergradHostingEvidence: true,
    });

    expect(buildWayInBadgesFromEntity(everything)).toEqual([
      'Undergrad evidence',
      'Student project evidence',
    ]);
  });
});

describe('buildWayInBadges hosting signals (#3593)', () => {
  const pathwayWith = (signalType: string) =>
    ({ evidence: [{ signalType }], bestNextStepCategory: '' }) as unknown as PathwaySearchHit;

  it('reads undergraduate evidence from past undergraduates only', () => {
    expect(buildWayInBadges(undefined, [pathwayWith('PAST_UNDERGRADS')])).toContain(
      'Undergrad evidence',
    );
    for (const held of ['CURRENT_UNDERGRADS', 'FACULTY_SUPERVISION']) {
      expect(buildWayInBadges(undefined, [pathwayWith(held)])).not.toContain('Undergrad evidence');
    }
  });

  it('keeps supervised student projects as their own badge', () => {
    expect(
      buildWayInBadges(undefined, [pathwayWith('FACULTY_SUPERVISES_STUDENT_PROJECTS')]),
    ).toEqual(['Student project evidence']);
  });
});

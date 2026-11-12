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

  it('shows the welcomes badge from the served flag when no page invitation is served (#5362)', () => {
    expect(buildWayInBadgesFromEntity(entity({ welcomesUndergrads: true }))).toEqual([
      'Taking undergrads now',
    ]);
  });

  it('reads undergraduate evidence from the served hosted flag (#3593)', () => {
    expect(buildWayInBadgesFromEntity(entity({ hasUndergradHostingEvidence: true }))).toEqual([
      'Undergrad evidence',
    ]);
  });

  it('shows the mentors badge from served mentors list evidence, not hosted or welcomes lists (#5362)', () => {
    const listEntry = (signal: 'hosted' | 'welcomes' | 'mentors') => ({
      source: 'example-list',
      signal,
      kind: 'advised' as const,
      sourceUrl: 'https://example.edu/list',
    });
    expect(
      buildWayInBadgesFromEntity(entity({ undergradListEvidence: [listEntry('mentors')] })),
    ).toEqual(['Advises undergrad research']);
    expect(
      buildWayInBadgesFromEntity(
        entity({ undergradListEvidence: [listEntry('hosted'), listEntry('welcomes')] }),
      ),
    ).toEqual([]);
  });

  /**
   * The badge must not re-derive hosting from raw fields: the server owns the one
   * predicate the browse filter and saved plans also read, so a field the server
   * does not count, such as a roster count it holds out, must not light the badge.
   */
  it('leads with the invitation the lab page states, ahead of hosting', () => {
    expect(
      buildWayInBadgesFromEntity(
        entity({
          hasUndergradHostingEvidence: true,
          undergradInvitation: {
            level: 'actively_hiring',
            quote: 'We are actively recruiting undergraduate researchers.',
            sourceUrl: 'https://lab.example.edu/join',
          },
        }),
      ),
    ).toEqual(['Taking undergrads now, recruiting', 'Undergrad evidence']);
    expect(
      buildWayInBadgesFromEntity(
        entity({
          undergradInvitation: {
            level: 'welcomes_undergrads',
            quote: 'We welcome undergraduate students.',
            sourceUrl: 'https://lab.example.edu/',
          },
        }),
      ),
    ).toEqual(['Taking undergrads now']);
  });

  it('shows no invitation badge without a citable page', () => {
    expect(
      buildWayInBadgesFromEntity(
        entity({
          undergradInvitation: {
            level: 'actively_hiring',
            quote: 'We are hiring undergraduates.',
            sourceUrl: 'javascript:alert(1)',
          },
        }),
      ),
    ).toEqual([]);
  });

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

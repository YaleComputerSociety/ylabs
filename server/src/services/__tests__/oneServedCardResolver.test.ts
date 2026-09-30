import { describe, expect, it } from 'vitest';

import { buildResearchEntityPublicDescriptionRepresentation } from '../researchEntityPublicDescription';
import { addResearchEntitySearchAliases, toPublicResearchEntityDto } from '../researchEntityDto';
import {
  servedResearchEntityCardDescription,
  servedResearchEntityCardWithoutLastResort,
  servedResearchEntityCopy,
} from '../servedResearchEntityCard';

/**
 * One resolver owns the card line a student reads, on every surface that renders one
 * (#3747). Before this, the browse card was resolved from the stored short and body,
 * the gate judged a third expression, and the detail card was the resolver, so a row
 * could be cleared on one line while browse showed a second and the related, similar
 * and compare cards showed a third.
 *
 * The one difference left is documented and asserted here: the gate does not read the
 * last-resort whole-body card, because that resort only runs on a row the card
 * invariant has already passed.
 */
const ungroundedStoredCard =
  'Studies medieval calligraphy, liturgical manuscript illumination, and monastic scriptoria of the Latin West.';

const twoSentenceBody =
  'The group measures how coral larvae settle on reef substrates under changing temperature. Undergraduates run the settlement assays, score the recruits weekly, and help build the survival models.';

const oneSentenceBody =
  'The group measures how coral larvae settle on reef substrates under changing temperature, and tracks the survival of the resulting colonies across seasons.';

const facultyResearchRow = (overrides: Record<string, any>): Record<string, any> => ({
  slug: 'fixture-one-card-resolver',
  name: 'Fixture Reef Settlement Research',
  kind: 'individual',
  entityType: 'FACULTY_RESEARCH_AREA',
  researchAreas: [],
  sourceUrls: ['https://example.edu/fixture-one-card-resolver'],
  ...overrides,
});

const servedCardFor = (entity: Record<string, any>): string =>
  String(toPublicResearchEntityDto(entity, {}).shortDescription || '');

describe('the gate judges the card the row serves (#3747)', () => {
  it('judges the line the detail page renders when the resolver surrenders an ungrounded stored card', () => {
    const entity = facultyResearchRow({
      shortDescription: ungroundedStoredCard,
      fullDescription: twoSentenceBody,
    });
    const representation = buildResearchEntityPublicDescriptionRepresentation({ entity });

    expect(representation.cardDescription).toBe(servedCardFor(representation.entity));
    expect(representation.cardDescription).not.toBe(ungroundedStoredCard);
    expect(representation.cardDescription).not.toBe('');
    expect(representation.invariant.reasons).not.toContain('missing_public_card_description');
  });

  it('records a missing card when the only card left is the last-resort whole body', () => {
    const entity = facultyResearchRow({
      shortDescription: ungroundedStoredCard,
      fullDescription: oneSentenceBody,
    });
    const representation = buildResearchEntityPublicDescriptionRepresentation({ entity });
    const served = servedResearchEntityCopy(representation.entity, []);

    expect(representation.cardDescription).toBe('');
    expect(representation.invariant.reasons).toContain('missing_public_card_description');
    expect(servedResearchEntityCardWithoutLastResort(served)).toBe('');
    expect(servedResearchEntityCardDescription(served)).not.toBe('');
  });

  it('differs from the served card only where the last-resort step fired', () => {
    for (const fullDescription of [twoSentenceBody, oneSentenceBody]) {
      for (const shortDescription of [ungroundedStoredCard, undefined]) {
        const entity = facultyResearchRow({ shortDescription, fullDescription });
        const representation = buildResearchEntityPublicDescriptionRepresentation({ entity });
        const served = servedResearchEntityCopy(representation.entity, []);
        const lastResortFired = servedResearchEntityCardWithoutLastResort(served) === '';

        if (lastResortFired) {
          expect(representation.cardDescription).toBe('');
        } else {
          expect(representation.cardDescription).toBe(servedCardFor(representation.entity));
        }
      }
    }
  });
});

describe('a browse card is the served card or the named limited state (#3747)', () => {
  const browseCardFor = (entity: Record<string, any>) => {
    const dto = toPublicResearchEntityDto(entity, { forList: true });
    return {
      card: dto.cardDescription,
      shortDescription: String(dto.shortDescription || ''),
    };
  };

  it('serves the derived card rather than the whole body when no stored card survives', () => {
    const { card, shortDescription } = browseCardFor(
      facultyResearchRow({ fullDescription: twoSentenceBody }),
    );

    expect(card?.state).toBe('complete');
    expect(card?.text).toBe(shortDescription);
    expect(card?.text).not.toBe(twoSentenceBody);
  });

  it.each([
    ['an ungrounded stored card over a two-sentence body', ungroundedStoredCard, twoSentenceBody],
    ['an ungrounded stored card over a one-sentence body', ungroundedStoredCard, oneSentenceBody],
    ['no stored card over a two-sentence body', undefined, twoSentenceBody],
    ['no stored card over a one-sentence body', undefined, oneSentenceBody],
    ['no description at all', undefined, undefined],
  ])('holds for %s', (_shape, shortDescription, fullDescription) => {
    const { card, shortDescription: servedShort } = browseCardFor(
      facultyResearchRow({ shortDescription, fullDescription }),
    );

    expect(card).toBeDefined();
    if (card?.state === 'sparse') {
      expect(servedShort).toBe('');
      expect(card.text).toContain('Limited public description');
    } else {
      expect(card?.text).toBe(servedShort);
    }
  });

  it('names the limited state rather than a body-derived line when a row resolves no card', () => {
    const { card } = browseCardFor(
      facultyResearchRow({ departments: ['Ecology'], fullDescription: undefined }),
    );

    expect(card?.state).toBe('sparse');
    expect(card?.label).toBe('Summary limited');
  });
});

describe('a browse card is the detail card of the same row', () => {
  const detailCardFor = (entity: Record<string, any>, leadMemberNames: string[]): string => {
    const representation = buildResearchEntityPublicDescriptionRepresentation({
      entity,
      leadMemberNames,
    });
    return String(
      toPublicResearchEntityDto(representation.entity, { leadMemberNames }).shortDescription || '',
    );
  };

  const browseCardFor = (entity: Record<string, any>, leadMemberNames: string[]) => {
    const [row] = addResearchEntitySearchAliases(
      { hits: [{ ...entity, _id: entity.slug }] },
      { leadMemberNamesByEntityId: new Map([[entity.slug, leadMemberNames]]) },
    ).researchEntities;
    return row.cardDescription;
  };

  const labRow = {
    slug: 'fixture-ridge-lab',
    name: 'Fixture Ridge Lab',
    kind: 'lab',
    entityType: 'LAB',
    researchAreas: [
      'Tectonic and geomorphic evolution of convergent plate boundaries',
      'Low-temperature deformational processes',
      'Exhumation processes',
    ],
    sourceUrls: ['https://example.edu/fixture-ridge-lab'],
    shortDescription:
      'Research on tectonic and geomorphic evolution of convergent plate boundaries and low-temperature deformational processes.',
    fullDescription:
      'The Fixture Ridge Lab focuses on the tectonic and geomorphic evolution of convergent plate boundaries, investigating low-temperature deformational processes such as faulting and pressure solution. The lab also studies exhumation processes, including erosion and tectonic thinning, across several mountain belts.',
  };

  it('serves the detail card when the stored card is refused in favour of a line from the body', () => {
    const card = browseCardFor(labRow, []);

    expect(card?.state).toBe('complete');
    expect(card?.text).toBe(detailCardFor(labRow, []));
  });
});

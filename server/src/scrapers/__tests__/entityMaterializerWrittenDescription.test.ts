import { describe, expect, it } from 'vitest';
import {
  NO_RESEARCH_ENTITY_NAME_IDENTITY_AUTHORITY,
  projectFromLog,
  writtenBodyCardBasis,
  type ProjectFromLogInput,
} from '../entityMaterializer';
import { resolveAllFields, type ResolverObservation } from '../confidenceResolver';

const FIXED_NOW = new Date('2026-10-04T00:00:00.000Z');
const WRITER = 'coverage-synthesis-llm';
const COPIED_SOURCE = 'lab-microsite-description-llm';

const COPIED_BODY =
  'Welcome to the Synthetic Marsh Lab. We are a friendly team of ecologists, and our group has worked on coastal wetlands, carbon, tidal flooding and marsh grasses for many years with partners across the region.';
const COPIED_CARD = 'A friendly team of ecologists working on coastal wetlands.';
const WRITTEN_BODY =
  'The lab studies how coastal salt marshes store carbon and how tidal flooding shapes the roots of marsh grasses. It measures how sea level rise drowns low marsh platforms along the Atlantic coast.';

const entityId = 'd'.repeat(24);

const observation = (
  field: string,
  value: string,
  sourceName: string,
  confidence: number,
  id: string,
) => ({
  _id: id,
  field,
  value,
  sourceName,
  confidence,
  observedAt: FIXED_NOW,
  sourceUrl: `https://example.edu/${id}`,
});

const materializationObs = [
  observation('fullDescription', COPIED_BODY, COPIED_SOURCE, 0.82, 'a'.repeat(24)),
  observation('shortDescription', COPIED_CARD, COPIED_SOURCE, 0.82, 'b'.repeat(24)),
  observation('fullDescription', WRITTEN_BODY, WRITER, 0.5, 'c'.repeat(24)),
];
const resolverObs: ResolverObservation[] = materializationObs.map(
  ({ field, value, sourceName, confidence, observedAt }) => ({
    field,
    value,
    sourceName,
    confidence,
    observedAt,
  }),
);

const baseEntityDoc = {
  _id: entityId,
  slug: 'synthetic-marsh-lab',
  name: 'Synthetic Marsh Lab',
  displayName: 'Synthetic Marsh Lab',
  entityType: 'LAB',
  kind: 'lab',
  fullDescription: COPIED_BODY,
  shortDescription: COPIED_CARD,
};

const noop = (async () => undefined) as unknown;

const input = (entityDoc: Record<string, unknown>): ProjectFromLogInput => ({
  resolved: resolveAllFields(resolverObs, { now: FIXED_NOW }),
  nameIdentityAuthority: NO_RESEARCH_ENTITY_NAME_IDENTITY_AUTHORITY,
  manuallyLockedFields: [],
  manualValues: {},
  entityDoc,
  materializationObs: materializationObs as unknown as ProjectFromLogInput['materializationObs'],
  resolverObs,
  fullDescriptionShellGated: false,
  now: FIXED_NOW,
  synthesizeCardDescription: async () => '',
  applyDescriptionResearchAreaDerivation:
    noop as ProjectFromLogInput['applyDescriptionResearchAreaDerivation'],
  applyResearchEntityOrgUnitCanonicalization:
    noop as ProjectFromLogInput['applyResearchEntityOrgUnitCanonicalization'],
  applyResearchEntityResearchAreaCanonicalization:
    noop as ProjectFromLogInput['applyResearchEntityResearchAreaCanonicalization'],
});

describe('a written description serves with a card derived from it (#4788)', () => {
  it('serves the written body over the copied one', async () => {
    const result = await projectFromLog('researchEntity', input(baseEntityDoc));
    expect(result.set.fullDescription).toBe(WRITTEN_BODY);
    expect((result.set['fieldProvenance.fullDescription'] as any)?.sourceName).toBe(WRITER);
  });

  it('derives the card from the written body rather than keeping the copied card', async () => {
    const result = await projectFromLog('researchEntity', input(baseEntityDoc));
    const card = String(result.set.shortDescription ?? '');
    expect(card).not.toBe(COPIED_CARD);
    expect(WRITTEN_BODY.toLowerCase()).toContain(
      card.replace(/\.$/, '').toLowerCase().slice(0, 30),
    );
    expect((result.set['fieldProvenance.shortDescription'] as any)?.sourceName).toBe(WRITER);
  });

  it('keeps a card already derived from the same written body on the next pass', async () => {
    const first = await projectFromLog('researchEntity', input(baseEntityDoc));
    const second = await projectFromLog(
      'researchEntity',
      input({
        ...baseEntityDoc,
        fullDescription: first.set.fullDescription,
        shortDescription: first.set.shortDescription,
        fieldProvenance: {
          fullDescription: first.set['fieldProvenance.fullDescription'],
          shortDescription: first.set['fieldProvenance.shortDescription'],
        },
      }),
    );
    expect(second.set.shortDescription ?? first.set.shortDescription).toBe(
      first.set.shortDescription,
    );
  });
});

describe('writtenBodyCardBasis', () => {
  const writtenProvenance = { sourceName: WRITER };

  it('does nothing when the body served is not the written one', () => {
    expect(
      writtenBodyCardBasis({
        set: {
          fullDescription: COPIED_BODY,
          'fieldProvenance.fullDescription': { sourceName: COPIED_SOURCE },
        },
        entityDoc: baseEntityDoc,
        fullDescription: COPIED_BODY,
        cardLocked: false,
      }),
    ).toEqual({ followsWrittenBody: false });
  });

  it('does nothing when the card is locked', () => {
    expect(
      writtenBodyCardBasis({
        set: {
          fullDescription: WRITTEN_BODY,
          'fieldProvenance.fullDescription': writtenProvenance,
        },
        entityDoc: baseEntityDoc,
        fullDescription: WRITTEN_BODY,
        cardLocked: true,
      }),
    ).toEqual({ followsWrittenBody: false });
  });

  it('re-derives when the stored card came from somewhere else', () => {
    expect(
      writtenBodyCardBasis({
        set: {
          fullDescription: WRITTEN_BODY,
          'fieldProvenance.fullDescription': writtenProvenance,
        },
        entityDoc: baseEntityDoc,
        fullDescription: WRITTEN_BODY,
        cardLocked: false,
      }),
    ).toEqual({ followsWrittenBody: true, currentCard: undefined });
  });

  it('keeps the stored card when it was derived from this written body', () => {
    expect(
      writtenBodyCardBasis({
        set: {},
        entityDoc: {
          ...baseEntityDoc,
          fullDescription: WRITTEN_BODY,
          shortDescription: 'Studies how coastal salt marshes store carbon.',
          fieldProvenance: {
            fullDescription: writtenProvenance,
            shortDescription: writtenProvenance,
          },
        },
        fullDescription: WRITTEN_BODY,
        cardLocked: false,
      }),
    ).toEqual({
      followsWrittenBody: true,
      currentCard: 'Studies how coastal salt marshes store carbon.',
    });
  });
});

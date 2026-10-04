import { describe, expect, it } from 'vitest';
import {
  NO_RESEARCH_ENTITY_NAME_IDENTITY_AUTHORITY,
  projectFromLog,
  isRefusedWrittenBodyCard,
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

  it('follows the written body when it is the body served', () => {
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
    ).toEqual({ followsWrittenBody: true });
  });
});

describe('a written body never serves a chip echo or itself as its card (#4788 follow-up)', () => {
  const TOPICS = ['Wetlands', 'Carbon Sequestration', 'Tidal Flooding'];
  const ONE_SENTENCE_BODY =
    'Studies how coastal salt marshes store carbon in sediment and how tidal flooding shapes the roots of marsh grasses along the Atlantic coast, using field plots, sediment cores and remote sensing of marsh loss.';
  const LONG_ONE_SENTENCE_BODY =
    'Studies how coastal salt marshes store carbon in sediment, how tidal flooding and sea level rise reshape the roots and stems of cordgrass and other marsh grasses, how grazing crabs and snails thin marsh platforms, and how nitrogen from upstream farms changes sediment microbes, using field plots, sediment cores, warming experiments and decades of remote sensing along the Atlantic coast.';
  const CHIP_ECHO = 'Studies Wetlands, Carbon Sequestration, and Tidal Flooding.';
  const GOOD_COPIED_CARD = 'Studies how coastal salt marshes store carbon in sediment.';
  const SYNTHESIZED_CARD =
    'Studies how coastal salt marshes store carbon and how tidal flooding shapes marsh grasses.';

  const rowWith = (opts: {
    body?: string;
    storedCard: string;
    copiedCard?: string;
    synthesize: () => Promise<string>;
  }): ProjectFromLogInput => {
    const obs = [
      observation('fullDescription', COPIED_BODY, COPIED_SOURCE, 0.82, 'a'.repeat(24)),
      observation('fullDescription', opts.body ?? ONE_SENTENCE_BODY, WRITER, 0.5, 'c'.repeat(24)),
      ...(opts.copiedCard
        ? [observation('shortDescription', opts.copiedCard, COPIED_SOURCE, 0.82, 'b'.repeat(24))]
        : []),
    ];
    const resolverRows: ResolverObservation[] = obs.map(
      ({ field, value, sourceName, confidence, observedAt }) => ({
        field,
        value,
        sourceName,
        confidence,
        observedAt,
      }),
    );
    const entityDoc = {
      ...baseEntityDoc,
      researchAreas: TOPICS,
      fullDescription: opts.body ?? ONE_SENTENCE_BODY,
      shortDescription: opts.storedCard,
      fieldProvenance: { fullDescription: { sourceName: WRITER } },
    };
    return {
      ...input(entityDoc),
      resolved: resolveAllFields(resolverRows, { now: FIXED_NOW }),
      materializationObs: obs as unknown as ProjectFromLogInput['materializationObs'],
      resolverObs: resolverRows,
      synthesizeCardDescription: opts.synthesize,
    };
  };

  it('replaces a stored chip echo with the grounded copied card', async () => {
    const result = await projectFromLog(
      'researchEntity',
      rowWith({
        storedCard: CHIP_ECHO,
        copiedCard: GOOD_COPIED_CARD,
        synthesize: async () => '',
      }),
    );
    expect(result.set.shortDescription).toBe(GOOD_COPIED_CARD);
  });

  it('never writes a chip echo when nothing else is available', async () => {
    const result = await projectFromLog(
      'researchEntity',
      rowWith({ body: LONG_ONE_SENTENCE_BODY, storedCard: '', synthesize: async () => '' }),
    );
    expect(result.set.shortDescription).not.toBe(CHIP_ECHO);
    expect(String(result.set.shortDescription ?? '')).not.toMatch(/^Studies Wetlands/);
  });

  it('replaces a body-as-card with a card synthesized from the written body', async () => {
    const result = await projectFromLog(
      'researchEntity',
      rowWith({ storedCard: ONE_SENTENCE_BODY, synthesize: async () => SYNTHESIZED_CARD }),
    );
    expect(result.set.fullDescription).toBe(ONE_SENTENCE_BODY);
    expect(result.set.shortDescription).toBe(SYNTHESIZED_CARD);
    expect((result.set['fieldProvenance.shortDescription'] as any)?.sourceName).toBe(WRITER);
  });

  it('never writes the body itself as the card', async () => {
    const result = await projectFromLog(
      'researchEntity',
      rowWith({ storedCard: '', synthesize: async () => '' }),
    );
    expect(result.set.shortDescription).not.toBe(ONE_SENTENCE_BODY);
  });

  it.each([
    ['a stored chip echo', LONG_ONE_SENTENCE_BODY, CHIP_ECHO],
    ['a stored body-as-card', ONE_SENTENCE_BODY, ONE_SENTENCE_BODY],
  ])('clears %s when every fallback and both syntheses fail', async (_label, body, storedCard) => {
    let calls = 0;
    const result = await projectFromLog(
      'researchEntity',
      rowWith({
        body,
        storedCard,
        synthesize: async () => {
          calls += 1;
          return calls === 1 ? CHIP_ECHO : body;
        },
      }),
    );
    expect(calls).toBe(2);
    expect(result.set.shortDescription).toBeUndefined();
    expect(result.unset.shortDescription).toBe('');
  });

  it('spends no synthesis on a second pass over an unchanged written body with no card', async () => {
    let calls = 0;
    const synthesize = async () => {
      calls += 1;
      return '';
    };
    const first = await projectFromLog(
      'researchEntity',
      rowWith({ body: LONG_ONE_SENTENCE_BODY, storedCard: CHIP_ECHO, synthesize }),
    );
    expect(first.unset.shortDescription).toBe('');
    calls = 0;
    const second = await projectFromLog(
      'researchEntity',
      rowWith({ body: LONG_ONE_SENTENCE_BODY, storedCard: '', synthesize }),
    );
    expect(calls).toBe(0);
    expect(second.set.shortDescription).toBeUndefined();
  });

  it('clears an ungrounded stored card after one synthesis pass and then settles', async () => {
    expect(isRefusedWrittenBodyCard(COPIED_CARD, LONG_ONE_SENTENCE_BODY, TOPICS)).toBe(false);
    let calls = 0;
    const synthesize = async () => {
      calls += 1;
      return '';
    };
    const first = await projectFromLog(
      'researchEntity',
      rowWith({ body: LONG_ONE_SENTENCE_BODY, storedCard: COPIED_CARD, synthesize }),
    );
    expect(calls).toBe(2);
    expect(first.set.shortDescription).toBeUndefined();
    expect(first.unset.shortDescription).toBe('');
    calls = 0;
    await projectFromLog(
      'researchEntity',
      rowWith({ body: LONG_ONE_SENTENCE_BODY, storedCard: '', synthesize }),
    );
    expect(calls).toBe(0);
  });

  it('synthesizes when the written body changed since the last pass', async () => {
    let calls = 0;
    const row = rowWith({
      body: LONG_ONE_SENTENCE_BODY,
      storedCard: '',
      synthesize: async () => {
        calls += 1;
        return SYNTHESIZED_CARD;
      },
    });
    const result = await projectFromLog('researchEntity', {
      ...row,
      entityDoc: { ...row.entityDoc, fullDescription: COPIED_BODY },
    });
    expect(calls).toBe(1);
    expect(result.set.shortDescription).toBe(SYNTHESIZED_CARD);
  });

  it('keeps a stored card already grounded in the written body without synthesizing', async () => {
    let calls = 0;
    const result = await projectFromLog(
      'researchEntity',
      rowWith({
        storedCard: GOOD_COPIED_CARD,
        synthesize: async () => {
          calls += 1;
          return SYNTHESIZED_CARD;
        },
      }),
    );
    expect(result.set.shortDescription ?? GOOD_COPIED_CARD).toBe(GOOD_COPIED_CARD);
    expect(calls).toBe(0);
  });
});

describe('isRefusedWrittenBodyCard', () => {
  it('refuses a chip echo and the body, and keeps a real card', () => {
    const body = 'Studies how coastal salt marshes store carbon in sediment.';
    const areas = ['Wetlands', 'Carbon Sequestration'];
    expect(
      isRefusedWrittenBodyCard('Studies Wetlands and Carbon Sequestration.', body, areas),
    ).toBe(true);
    expect(isRefusedWrittenBodyCard(body, body, areas)).toBe(true);
    expect(isRefusedWrittenBodyCard('Studies carbon storage in salt marshes.', body, areas)).toBe(
      false,
    );
  });
});

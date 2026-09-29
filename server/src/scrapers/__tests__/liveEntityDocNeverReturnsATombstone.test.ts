import { describe, expect, it } from 'vitest';

import {
  MaterializationChunkPrefetch,
  type MaterializationReadSource,
} from '../materializationChunkPrefetch';
import { FrozenMaterializationInput } from '../frozenMaterializationInput';

/**
 * The regression this answer exists to prevent.
 *
 * `entityDocForKey` answers "the row with this key, archived or not", which is what
 * `findEntityDocByIdentifier` wants: it resolves a slug without an archived filter on purpose and
 * handles the tombstone itself. Six reads in the materializer instead ask for
 * `archived: { $ne: true }`, and the candidate lookup is the sharp one: handed a tombstone it
 * would adopt an archived shell as a mint candidate (#3863).
 *
 * So the contract is that a hit carrying `null` means "no live row", which is an answer, and a
 * miss means the source cannot say. Both implementations of the interface are held to it here,
 * because a benchmark replay uses the frozen one and a sweep uses the chunk one, and a divergence
 * between them would show up as a fingerprint change nobody could attribute.
 */
const ARCHIVED_SHELL = {
  _id: '6a0f9da1cf23c0b70f1ab87d',
  slug: 'fixture-archived-shell',
  name: 'Archived Shell',
  archived: true,
};

const LIVE_ROW = {
  _id: '6a0f9da1cf23c0b70f1ab999',
  slug: 'fixture-live-row',
  name: 'Live Row',
  archived: false,
};

const frozenSourceHolding = (docs: Array<Record<string, unknown>>): MaterializationReadSource =>
  new FrozenMaterializationInput(
    'researchEntity',
    docs.map((doc) => ({
      entityKey: String(doc.slug),
      entityId: String(doc._id),
      entityDoc: doc,
      observations: [],
      hasMergedInRows: false,
    })),
  );

describe('a live entity answer never returns a tombstone (#3863)', () => {
  describe('the frozen input', () => {
    it('answers null for an archived row rather than handing it over', () => {
      const source = frozenSourceHolding([ARCHIVED_SHELL]);

      const answer = source.liveEntityDocForKey('researchEntity', ARCHIVED_SHELL.slug);

      expect(answer).toEqual({ hit: true, value: null });
    });

    it('still hands over the same archived row through the archived-or-not answer', () => {
      const source = frozenSourceHolding([ARCHIVED_SHELL]);

      const answer = source.entityDocForKey('researchEntity', ARCHIVED_SHELL.slug);

      expect(answer.hit && (answer.value as { slug?: string })?.slug).toBe(ARCHIVED_SHELL.slug);
    });

    it('hands over a live row unchanged', () => {
      const source = frozenSourceHolding([LIVE_ROW]);

      const answer = source.liveEntityDocForKey('researchEntity', LIVE_ROW.slug);

      expect(answer.hit && (answer.value as { slug?: string })?.slug).toBe(LIVE_ROW.slug);
    });

    it('answers null by id too, not only by key', () => {
      const source = frozenSourceHolding([ARCHIVED_SHELL]);

      expect(source.liveEntityDocForId('researchEntity', ARCHIVED_SHELL._id)).toEqual({
        hit: true,
        value: null,
      });
    });

    /**
     * A miss and a live-null are different answers and must stay different: a miss says the source
     * cannot speak, which a benchmark counts as incomplete input, while a null is a real answer.
     */
    it('misses rather than answering null for a key it does not hold', () => {
      const source = frozenSourceHolding([LIVE_ROW]);

      expect(source.liveEntityDocForKey('researchEntity', 'fixture-not-captured')).toEqual({
        hit: false,
      });
    });
  });

  describe('the chunk prefetch', () => {
    /**
     * Held to the same contract through its public surface. Its loader reads the corpus, so the
     * documents are placed the way a load would leave them rather than by calling `load`.
     */
    const prefetchHolding = (docs: Array<Record<string, unknown>>): MaterializationReadSource => {
      const prefetch = new MaterializationChunkPrefetch('researchEntity');
      const byKey = (prefetch as unknown as { entityDocsByKey: Map<string, unknown> })
        .entityDocsByKey;
      const byId = (prefetch as unknown as { entityDocsById: Map<string, unknown> }).entityDocsById;
      for (const doc of docs) {
        byKey.set(String(doc.slug), doc);
        byId.set(String(doc._id), doc);
      }
      return prefetch;
    };

    it('answers null for an archived row', () => {
      expect(
        prefetchHolding([ARCHIVED_SHELL]).liveEntityDocForKey(
          'researchEntity',
          ARCHIVED_SHELL.slug,
        ),
      ).toEqual({ hit: true, value: null });
    });

    it('hands over a live row', () => {
      const answer = prefetchHolding([LIVE_ROW]).liveEntityDocForKey(
        'researchEntity',
        LIVE_ROW.slug,
      );

      expect(answer.hit && (answer.value as { slug?: string })?.slug).toBe(LIVE_ROW.slug);
    });

    it('answers null for an archived row by id', () => {
      expect(
        prefetchHolding([ARCHIVED_SHELL]).liveEntityDocForId('researchEntity', ARCHIVED_SHELL._id),
      ).toEqual({ hit: true, value: null });
    });
  });
});

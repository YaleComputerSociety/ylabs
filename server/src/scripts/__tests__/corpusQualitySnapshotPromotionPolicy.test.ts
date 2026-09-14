import { describe, expect, it } from 'vitest';
import { NEVER_COPY_COLLECTIONS, assertNoNeverCopyCollections } from '../mirrorCollectionPolicy';
import { CORPUS_QUALITY_SNAPSHOT_COLLECTION } from '../../models/corpusQualitySnapshot';

describe('corpus quality snapshots are environment-local', () => {
  it('lists the snapshot collection as never copied', () => {
    expect(NEVER_COPY_COLLECTIONS).toContain(CORPUS_QUALITY_SNAPSHOT_COLLECTION);
  });

  it('refuses a mirror that would carry the snapshot collection', () => {
    expect(() =>
      assertNoNeverCopyCollections(['research_entities', CORPUS_QUALITY_SNAPSHOT_COLLECTION]),
    ).toThrow(/corpus_quality_snapshots/);
  });

  it('is absent from the promotion copy set, which replaces whole collections', async () => {
    const promotionSource = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../promoteAcceptedBetaCopy.ts', import.meta.url).pathname, 'utf8'),
    );
    const copyBlock = promotionSource.slice(
      promotionSource.indexOf('const COPY_COLLECTIONS'),
      promotionSource.indexOf('export interface PromotionOptions'),
    );

    expect(copyBlock.length).toBeGreaterThan(0);
    expect(copyBlock).not.toContain(CORPUS_QUALITY_SNAPSHOT_COLLECTION);
  });
});

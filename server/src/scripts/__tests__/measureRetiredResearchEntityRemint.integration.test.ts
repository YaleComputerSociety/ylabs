import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { materializeEntity } from '../../scrapers/entityMaterializer';
import {
  measureRetiredResearchEntityRemint,
  parseMeasureRetiredRemintArgs,
  summarizeRetiredRemint,
} from '../measureRetiredResearchEntityRemint';

describe('measuring whether a deleted retired row would be minted again (#5189)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    for (const name of ['research_entities', 'observations']) {
      await mongoose.connection.db!.collection(name).deleteMany({});
    }
  });

  const observe = (entityKey: string, field: string, value: unknown) =>
    Observation.create({
      entityType: 'researchEntity',
      entityKey,
      field,
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'synthetic-source',
      sourceUrl: 'https://example.org/synthetic',
      confidence: 0.9,
      observedAt: new Date('2026-10-01T00:00:00Z'),
      superseded: false,
    });

  it('reports a retired row whose stored evidence still names it as one that would be minted', async () => {
    const retired = await ResearchEntity.create({
      slug: 'synthetic-retired-lab',
      name: 'Synthetic Retired Lab',
      entityType: 'LAB',
      archived: true,
      archivedReason: 'synthetic:retire',
    });
    await observe('synthetic-retired-lab', 'name', 'Synthetic Retired Lab');
    await observe('synthetic-retired-lab', 'entityType', 'LAB');
    const before = await ResearchEntity.countDocuments({});

    const verdicts = await measureRetiredResearchEntityRemint();

    expect(verdicts).toEqual([
      expect.objectContaining({ entityId: String(retired._id), outcome: 'would-mint' }),
    ]);
    expect(await ResearchEntity.countDocuments({})).toBe(before);
    expect((await ResearchEntity.findById(retired._id).lean())?.archived).toBe(true);
  });

  it('ignores a merged row, which its survivor answers for', async () => {
    const survivor = await ResearchEntity.create({ slug: 'synthetic-survivor', name: 'Survivor' });
    await ResearchEntity.create({
      slug: 'synthetic-merged',
      name: 'Merged',
      archived: true,
      canonicalGroupId: survivor._id,
    });

    expect(await measureRetiredResearchEntityRemint()).toEqual([]);
  });

  it('summarizes by archive reason and refuses --apply', () => {
    expect(
      summarizeRetiredRemint([
        {
          entityId: 'a',
          entityKey: 'a',
          archivedReason: 'synthetic:retire',
          outcome: 'would-mint',
        },
        {
          entityId: 'b',
          entityKey: 'b',
          archivedReason: '',
          outcome: 'would-not-mint',
          skipped: 'synthetic-skip',
        },
      ]),
    ).toEqual({
      retiredRows: 2,
      wouldMint: 1,
      byReason: {
        'synthetic:retire': { rows: 1, wouldMint: 1 },
        '(none)': { rows: 1, wouldMint: 0 },
      },
      skippedReasons: { 'synthetic-skip': 1 },
    });
    expect(() => parseMeasureRetiredRemintArgs(['--apply'])).toThrow(/read-only/);
  });

  it('refuses to plan against an absent row outside a dry run', async () => {
    await expect(
      materializeEntity(
        'researchEntity',
        { entityKey: 'synthetic-retired-lab' },
        { treatArchivedResearchEntitiesAsAbsent: new Set(['000000000000000000000000']) },
      ),
    ).rejects.toThrow(/requires dryRun/);
  });
});

import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ResearchEntity } from '../../models/researchEntity';
import { resolveArchivedResearchEntityCanonicalSlug } from '../researchGroupService';

type SeedEntity = {
  _id: mongoose.Types.ObjectId;
  slug: string;
  archived: boolean;
  studentVisibilityTier: string;
  canonicalGroupId?: mongoose.Types.ObjectId | null;
};

const seed = async (entities: SeedEntity[]) => {
  await ResearchEntity.insertMany(
    entities.map((entity) => ({
      _id: entity._id,
      slug: entity.slug,
      name: entity.slug,
      archived: entity.archived,
      studentVisibilityTier: entity.studentVisibilityTier,
      canonicalGroupId: entity.canonicalGroupId ?? null,
    })),
  );
};

describe('resolveArchivedResearchEntityCanonicalSlug canonical chain (integration)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  afterEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    await db.collection('researchentities').deleteMany({});
  });

  it('chains an archived shell through a dead intermediate to a live public canonical', async () => {
    const shellId = new mongoose.Types.ObjectId();
    const midId = new mongoose.Types.ObjectId();
    const liveId = new mongoose.Types.ObjectId();

    await seed([
      {
        _id: shellId,
        slug: 'nsf-pi-yongshan-ding',
        archived: true,
        studentVisibilityTier: 'suppressed',
        canonicalGroupId: midId,
      },
      {
        _id: midId,
        slug: 'orphan-drift-shell',
        archived: true,
        studentVisibilityTier: 'suppressed',
        canonicalGroupId: liveId,
      },
      {
        _id: liveId,
        slug: 'dept-cs-yongshan-ding',
        archived: false,
        studentVisibilityTier: 'student_ready',
      },
    ]);

    await expect(resolveArchivedResearchEntityCanonicalSlug('nsf-pi-yongshan-ding')).resolves.toBe(
      'dept-cs-yongshan-ding',
    );
  });

  it('resolves a single live public hop directly', async () => {
    const shellId = new mongoose.Types.ObjectId();
    const liveId = new mongoose.Types.ObjectId();

    await seed([
      {
        _id: shellId,
        slug: 'nsf-pi-abhishek-bhattacharjee',
        archived: true,
        studentVisibilityTier: 'suppressed',
        canonicalGroupId: liveId,
      },
      {
        _id: liveId,
        slug: 'dept-cs-abhishek-bhattacharjee',
        archived: false,
        studentVisibilityTier: 'student_ready',
      },
    ]);

    await expect(
      resolveArchivedResearchEntityCanonicalSlug('nsf-pi-abhishek-bhattacharjee'),
    ).resolves.toBe('dept-cs-abhishek-bhattacharjee');
  });

  it('returns null when the chain dead-ends at a suppressed shell with no further canonical', async () => {
    const shellId = new mongoose.Types.ObjectId();
    const deadId = new mongoose.Types.ObjectId();

    await seed([
      {
        _id: shellId,
        slug: 'nih-pi-insoo-kang',
        archived: true,
        studentVisibilityTier: 'suppressed',
        canonicalGroupId: deadId,
      },
      {
        _id: deadId,
        slug: 'nih-pi-insoo-kang-orphan',
        archived: true,
        studentVisibilityTier: 'suppressed',
        canonicalGroupId: null,
      },
    ]);

    await expect(
      resolveArchivedResearchEntityCanonicalSlug('nih-pi-insoo-kang'),
    ).resolves.toBeNull();
  });

  it('returns null when the chain terminates at an archived (non-public) node', async () => {
    const shellId = new mongoose.Types.ObjectId();
    const archivedTargetId = new mongoose.Types.ObjectId();

    await seed([
      {
        _id: shellId,
        slug: 'nsf-pi-tassiulas',
        archived: true,
        studentVisibilityTier: 'suppressed',
        canonicalGroupId: archivedTargetId,
      },
      {
        _id: archivedTargetId,
        slug: 'archived-canonical',
        archived: true,
        studentVisibilityTier: 'student_ready',
        canonicalGroupId: null,
      },
    ]);

    await expect(
      resolveArchivedResearchEntityCanonicalSlug('nsf-pi-tassiulas'),
    ).resolves.toBeNull();
  });

  it('terminates safely on a cycle instead of looping forever', async () => {
    const aId = new mongoose.Types.ObjectId();
    const bId = new mongoose.Types.ObjectId();

    await seed([
      {
        _id: aId,
        slug: 'cycle-a',
        archived: true,
        studentVisibilityTier: 'suppressed',
        canonicalGroupId: bId,
      },
      {
        _id: bId,
        slug: 'cycle-b',
        archived: true,
        studentVisibilityTier: 'suppressed',
        canonicalGroupId: aId,
      },
    ]);

    await expect(resolveArchivedResearchEntityCanonicalSlug('cycle-a')).resolves.toBeNull();
  });

  it('stops at the hop cap and returns null even when a live target sits beyond it', async () => {
    const shellId = new mongoose.Types.ObjectId();
    const liveId = new mongoose.Types.ObjectId();
    const deadIds = Array.from({ length: 11 }, () => new mongoose.Types.ObjectId());

    const chain: SeedEntity[] = [
      {
        _id: shellId,
        slug: 'deep-shell',
        archived: true,
        studentVisibilityTier: 'suppressed',
        canonicalGroupId: deadIds[0],
      },
    ];
    deadIds.forEach((id, index) => {
      chain.push({
        _id: id,
        slug: `deep-dead-${index}`,
        archived: true,
        studentVisibilityTier: 'suppressed',
        canonicalGroupId: index + 1 < deadIds.length ? deadIds[index + 1] : liveId,
      });
    });
    chain.push({
      _id: liveId,
      slug: 'deep-live-canonical',
      archived: false,
      studentVisibilityTier: 'student_ready',
    });

    await seed(chain);

    await expect(resolveArchivedResearchEntityCanonicalSlug('deep-shell')).resolves.toBeNull();
  });
});

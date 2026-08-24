import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ResearchEntity } from '../../models/researchEntity';
import { ResearchEntityRelationship } from '../../models/researchEntityRelationship';
import { Signal } from '../../models/signal';
import { recomputeBrowseRankForEntities } from '../researchEntityBrowseRankService';
import { __testing } from '../researchEntityBrowseRank';

const { ENTITY_TYPE_RANK_ADJUSTMENT } = __testing;

describe('recomputeBrowseRankForEntities umbrella-aware demotion', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    await db.collection('research_entities').deleteMany({});
    await db.collection('research_entity_relationships').deleteMany({});
    await db.collection('signals').deleteMany({});
  });

  const createEntity = async (slug: string, entityType: string) =>
    ResearchEntity.create({
      slug,
      name: `Entity ${slug}`,
      entityType,
      fullDescription: 'A complete, source-backed description of the research work.',
      status: 'ACTIVE',
      archived: false,
    });

  const hostAffiliatedLab = async (sourceId: mongoose.Types.ObjectId, targetId: mongoose.Types.ObjectId, archived = false) =>
    ResearchEntityRelationship.create({
      sourceResearchEntityId: sourceId,
      targetResearchEntityId: targetId,
      relationshipType: 'AFFILIATED_LAB',
      archived,
    });

  const scoreOf = async (id: mongoose.Types.ObjectId): Promise<number> => {
    const doc = await ResearchEntity.findById(id).lean<{ browseRankScore?: number }>();
    return doc?.browseRankScore ?? 0;
  };

  it('persists a leaf center at the same score as a comparable lab, while an umbrella center is demoted', async () => {
    const lab = await createEntity('lab-a', 'LAB');
    const leafCenter = await createEntity('center-leaf', 'CENTER');
    const umbrellaCenter = await createEntity('center-umbrella', 'CENTER');
    const hostedLab = await createEntity('hosted-lab', 'LAB');

    await hostAffiliatedLab(umbrellaCenter._id, hostedLab._id);

    const ids = [lab._id, leafCenter._id, umbrellaCenter._id, hostedLab._id];
    await recomputeBrowseRankForEntities(ids, { sync: false });

    const labScore = await scoreOf(lab._id);
    expect(await scoreOf(leafCenter._id)).toBe(labScore);
    expect(await scoreOf(umbrellaCenter._id)).toBe(labScore + ENTITY_TYPE_RANK_ADJUSTMENT.CENTER!);
    expect(ENTITY_TYPE_RANK_ADJUSTMENT.CENTER!).toBeLessThan(0);
  });

  it('ignores archived hosting relationships when gating the demotion', async () => {
    const lab = await createEntity('lab-b', 'LAB');
    const archivedOnlyCenter = await createEntity('center-archived', 'CENTER');
    const hostedLab = await createEntity('hosted-lab-b', 'LAB');

    await hostAffiliatedLab(archivedOnlyCenter._id, hostedLab._id, true);

    const ids = [lab._id, archivedOnlyCenter._id, hostedLab._id];
    await recomputeBrowseRankForEntities(ids, { sync: false });

    expect(await scoreOf(archivedOnlyCenter._id)).toBe(await scoreOf(lab._id));
  });

  it('demotes a program that hosts nothing because the program demotion is unconditional', async () => {
    const lab = await createEntity('lab-c', 'LAB');
    const program = await createEntity('program-leaf', 'PROGRAM');

    const ids = [lab._id, program._id];
    await recomputeBrowseRankForEntities(ids, { sync: false });

    const labScore = await scoreOf(lab._id);
    expect(await scoreOf(program._id)).toBe(labScore + ENTITY_TYPE_RANK_ADJUSTMENT.PROGRAM!);
    expect(ENTITY_TYPE_RANK_ADJUSTMENT.PROGRAM!).toBeLessThan(0);
  });

  it('persists hasUndergradHostingEvidence only for undergrad-specific signals, not generic outreach (#1054)', async () => {
    const hosting = await createEntity('lab-hosting', 'LAB');
    const outreachOnly = await createEntity('lab-outreach-only', 'LAB');
    const notAvailableWithOutreach = await createEntity('lab-not-available', 'LAB');

    await Signal.create({ researchEntityId: hosting._id, type: 'PAST_UNDERGRADS' });
    await Signal.create({ researchEntityId: outreachOnly._id, type: 'REACH_OUT_PLAUSIBLE' });
    await Signal.create({
      researchEntityId: notAvailableWithOutreach._id,
      type: 'REACH_OUT_PLAUSIBLE',
    });
    await Signal.create({
      researchEntityId: notAvailableWithOutreach._id,
      type: 'NOT_CURRENTLY_AVAILABLE',
    });

    await recomputeBrowseRankForEntities(
      [hosting._id, outreachOnly._id, notAvailableWithOutreach._id],
      { sync: false },
    );

    const evidenceOf = async (id: mongoose.Types.ObjectId): Promise<boolean> => {
      const doc = await ResearchEntity.findById(id).lean<{ hasUndergradHostingEvidence?: boolean }>();
      return doc?.hasUndergradHostingEvidence ?? false;
    };

    expect(await evidenceOf(hosting._id)).toBe(true);
    expect(await evidenceOf(outreachOnly._id)).toBe(false);
    expect(await evidenceOf(notAvailableWithOutreach._id)).toBe(false);
  });

  it('persists undergraduateCurrentAvailability from a fresh KNOWN signal and fails closed otherwise (#1285)', async () => {
    const now = new Date('2026-08-23T12:00:00.000Z');
    const freshExpiry = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const staleExpiry = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const open = await createEntity('lab-open', 'LAB');
    const stale = await createEntity('lab-stale', 'LAB');
    const noSignal = await createEntity('lab-no-signal', 'LAB');

    await Signal.create({
      researchEntityId: open._id,
      type: 'CURRENT_AVAILABILITY',
      status: 'KNOWN',
      value: { status: 'OPEN' },
      expiresAt: freshExpiry,
    });
    await Signal.create({
      researchEntityId: stale._id,
      type: 'CURRENT_AVAILABILITY',
      status: 'KNOWN',
      value: { status: 'OPEN' },
      expiresAt: staleExpiry,
    });

    await recomputeBrowseRankForEntities([open._id, stale._id, noSignal._id], {
      sync: false,
      now,
    });

    const availabilityOf = async (id: mongoose.Types.ObjectId): Promise<string> => {
      const doc = await ResearchEntity.findById(id).lean<{
        undergraduateCurrentAvailability?: string;
      }>();
      return doc?.undergraduateCurrentAvailability ?? 'UNKNOWN';
    };

    expect(await availabilityOf(open._id)).toBe('OPEN');
    expect(await availabilityOf(stale._id)).toBe('UNKNOWN');
    expect(await availabilityOf(noSignal._id)).toBe('UNKNOWN');
  });
});

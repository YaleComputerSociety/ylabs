import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResearchEntity } from '../../models/researchEntity';
import { ResearchEntityRelationship } from '../../models/researchEntityRelationship';
import { Signal } from '../../models/signal';
import { recomputeBrowseRankForEntities } from '../researchEntityBrowseRankService';
import { __testing, BROWSE_RANK_SCORER_VERSION } from '../researchEntityBrowseRank';

const { ENTITY_TYPE_RANK_ADJUSTMENT } = __testing;

describe('recomputeBrowseRankForEntities umbrella-aware demotion', () => {
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

  const hostAffiliatedLab = async (
    sourceId: mongoose.Types.ObjectId,
    targetId: mongoose.Types.ObjectId,
    archived = false,
  ) =>
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

  it('does not read a relationship from a center to itself as hosting affiliated research', async () => {
    const lab = await createEntity('lab-self', 'LAB');
    const selfLinkedCenter = await createEntity('center-self-linked', 'CENTER');

    await hostAffiliatedLab(selfLinkedCenter._id, selfLinkedCenter._id);

    await recomputeBrowseRankForEntities([lab._id, selfLinkedCenter._id], { sync: false });

    expect(await scoreOf(selfLinkedCenter._id)).toBe(await scoreOf(lab._id));
  });

  it('does not demote a leaf initiative that hosts nothing', async () => {
    const lab = await createEntity('lab-c', 'LAB');
    const initiative = await createEntity('initiative-leaf', 'INITIATIVE');

    const ids = [lab._id, initiative._id];
    await recomputeBrowseRankForEntities(ids, { sync: false });

    expect(await scoreOf(initiative._id)).toBe(await scoreOf(lab._id));
  });

  it('persists hasUndergradHostingEvidence from the row the card reads, not from lingering signals (#3593)', async () => {
    const hosting = await createEntity('lab-hosting', 'LAB');
    const staleSignalOnly = await createEntity('lab-stale-signal', 'LAB');
    const outreachOnly = await createEntity('lab-outreach-only', 'LAB');

    await ResearchEntity.updateOne(
      { _id: hosting._id },
      { $set: { pastUndergradAdvisees: [{ name: 'Synthetic Advisee', count: 1 }] } },
    );
    await Signal.create({ researchEntityId: staleSignalOnly._id, type: 'PAST_UNDERGRADS' });
    await Signal.create({ researchEntityId: outreachOnly._id, type: 'APPLICATION_FORM_EXISTS' });
    await ResearchEntity.updateOne(
      { _id: staleSignalOnly._id },
      { $set: { hasUndergradHostingEvidence: true } },
    );

    await recomputeBrowseRankForEntities([hosting._id, staleSignalOnly._id, outreachOnly._id], {
      sync: false,
    });

    const evidenceOf = async (id: mongoose.Types.ObjectId): Promise<boolean> => {
      const doc = await ResearchEntity.findById(id).lean<{
        hasUndergradHostingEvidence?: boolean;
      }>();
      return doc?.hasUndergradHostingEvidence ?? false;
    };

    expect(await evidenceOf(hosting._id)).toBe(true);
    expect(await evidenceOf(staleSignalOnly._id)).toBe(false);
    expect(await evidenceOf(outreachOnly._id)).toBe(false);
  });

  const stampOf = async (id: mongoose.Types.ObjectId) =>
    (await ResearchEntity.findById(id).lean<{ browseRankScorerVersion?: number }>())
      ?.browseRankScorerVersion;

  it('stamps every score it writes with the scorer version that computed it', async () => {
    const lab = await createEntity('lab-stamped', 'LAB');

    await recomputeBrowseRankForEntities([lab._id], { sync: false });

    expect(await stampOf(lab._id)).toBe(BROWSE_RANK_SCORER_VERSION);
  });

  it('leaves a score stamped by a newer scorer alone when an older checkout recomputes it', async () => {
    const lab = await createEntity('lab-newer-stamp', 'LAB');
    await ResearchEntity.updateOne(
      { _id: lab._id },
      { $set: { browseRankScore: 41, browseRankScorerVersion: BROWSE_RANK_SCORER_VERSION } },
    );

    const result = await recomputeBrowseRankForEntities([lab._id], {
      sync: false,
      scorerVersion: BROWSE_RANK_SCORER_VERSION - 1,
    });

    expect(result.refusedNewerScorer).toBe(1);
    expect(result.updated).toBe(0);
    expect(await scoreOf(lab._id)).toBe(41);
    expect(await stampOf(lab._id)).toBe(BROWSE_RANK_SCORER_VERSION);
  });

  it('rescores a row an older scorer wrote and counts its score as drifted', async () => {
    const lab = await createEntity('lab-older-stamp', 'LAB');
    await recomputeBrowseRankForEntities([lab._id], { sync: false });
    const current = await scoreOf(lab._id);
    await ResearchEntity.updateOne(
      { _id: lab._id },
      { $set: { browseRankScore: current + 5, browseRankScorerVersion: 1 } },
    );

    const check = await recomputeBrowseRankForEntities([lab._id], { sync: false, dryRun: true });
    expect(check.scoreDrifted).toBe(1);
    expect(await scoreOf(lab._id)).toBe(current + 5);

    const repair = await recomputeBrowseRankForEntities([lab._id], { sync: false });
    expect(repair.scoreDrifted).toBe(1);
    expect(await scoreOf(lab._id)).toBe(current);
    expect(await stampOf(lab._id)).toBe(BROWSE_RANK_SCORER_VERSION);
  });

  it('refuses the write when a newer scorer stamps the row after this one read it', async () => {
    const lab = await createEntity('lab-raced-stamp', 'LAB');
    const originalFind = ResearchEntity.find.bind(ResearchEntity);
    const find = vi.spyOn(ResearchEntity, 'find').mockImplementationOnce(((...args: any[]) => {
      const query = (originalFind as any)(...args);
      const exec = query.exec.bind(query);
      query.exec = async () => {
        const rows = await exec();
        await ResearchEntity.collection.updateOne(
          { _id: lab._id },
          {
            $set: { browseRankScore: 41, browseRankScorerVersion: BROWSE_RANK_SCORER_VERSION + 1 },
          },
        );
        return rows;
      };
      return query;
    }) as any);

    const result = await recomputeBrowseRankForEntities([lab._id], { sync: false });
    find.mockRestore();

    expect(result.refusedNewerScorer).toBe(1);
    expect(await scoreOf(lab._id)).toBe(41);
  });
});

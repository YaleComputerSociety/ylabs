import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ResearchEntity } from '../../models/researchEntity';
import { ResearchEntityRelationship } from '../../models/researchEntityRelationship';
import {
  planRelationshipEdgeSettlements,
  settleRelationshipEdgesOfArchivedResearchEntities,
} from '../archivedResearchEntityRelationships';
import { archiveResearchEntities } from '../archivedResearchEntityRoleEdges';

describe('archiving a research entity settles its live relationship edges (#5122)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    await ResearchEntityRelationship.syncIndexes();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of [
      'research_entities',
      'research_entity_relationships',
      'role_assignments',
      'signals',
    ]) {
      await db.collection(name).deleteMany({});
    }
  });

  const entity = async (slug: string, overrides: Record<string, unknown> = {}) =>
    ResearchEntity.create({ slug, name: `Synthetic ${slug}`, archived: false, ...overrides });

  const edge = async (
    source: mongoose.Types.ObjectId,
    target: mongoose.Types.ObjectId,
    overrides: Record<string, unknown> = {},
  ) =>
    ResearchEntityRelationship.create({
      sourceResearchEntityId: source,
      targetResearchEntityId: target,
      relationshipType: 'MEMBER_RESEARCH_AREA',
      archived: false,
      ...overrides,
    });

  const stored = async (id: unknown) =>
    ResearchEntityRelationship.findById(id).lean<{
      sourceResearchEntityId: mongoose.Types.ObjectId;
      targetResearchEntityId: mongoose.Types.ObjectId;
      archived: boolean;
      archivedReason?: string;
    }>();

  it('repoints a link to the survivor so the survivor carries it', async () => {
    const member = await entity('synthetic-member-profile');
    const center = await entity('synthetic-center');
    const survivor = await entity('synthetic-survivor-lab');
    const shell = await entity('synthetic-shell-lab');
    const incoming = await edge(member._id, shell._id);
    const outgoing = await edge(shell._id, center._id, { relationshipType: 'AFFILIATED_LAB' });

    const result = await archiveResearchEntities({
      ids: [shell._id],
      archivedReason: 'synthetic:fold',
      set: { canonicalGroupId: survivor._id },
      survivorId: survivor._id,
    });

    expect(result.relationships).toEqual({
      repointed: 2,
      archivedRedundant: 0,
      archivedSelfLoop: 0,
      leftWithoutLiveEndpoint: 0,
      refusedSurvivorNotLive: 0,
    });
    expect(await stored(incoming._id)).toMatchObject({ archived: false });
    expect(String((await stored(incoming._id))?.targetResearchEntityId)).toBe(String(survivor._id));
    expect(String((await stored(outgoing._id))?.sourceResearchEntityId)).toBe(String(survivor._id));
  });

  it('archives a link the survivor already carries, even an archived one, and a self-loop', async () => {
    const member = await entity('synthetic-member-profile');
    const retracted = await entity('synthetic-retracted-member');
    const survivor = await entity('synthetic-survivor-lab');
    const shell = await entity('synthetic-shell-lab');
    await edge(member._id, survivor._id);
    await edge(retracted._id, survivor._id, {
      archived: true,
      archivedReason: 'synthetic:retract',
    });
    const duplicate = await edge(member._id, shell._id);
    const retractedDuplicate = await edge(retracted._id, shell._id);
    const selfLoop = await edge(survivor._id, shell._id);

    const result = await archiveResearchEntities({
      ids: [shell._id],
      archivedReason: 'synthetic:fold',
      set: { canonicalGroupId: survivor._id },
      survivorId: survivor._id,
    });

    expect(result.relationships).toMatchObject({
      repointed: 0,
      archivedRedundant: 2,
      archivedSelfLoop: 1,
    });
    for (const id of [duplicate._id, retractedDuplicate._id, selfLoop._id]) {
      expect(await stored(id)).toMatchObject({ archived: true, archivedReason: 'synthetic:fold' });
    }
    expect(
      await ResearchEntityRelationship.countDocuments({
        sourceResearchEntityId: retracted._id,
        targetResearchEntityId: survivor._id,
        archived: { $ne: true },
      }),
    ).toBe(0);
  });

  it('follows the other endpoint to its own survivor when it was archived earlier', async () => {
    const memberSurvivor = await entity('synthetic-member-survivor');
    const memberShell = await entity('synthetic-member-shell', {
      archived: true,
      canonicalGroupId: memberSurvivor._id,
    });
    const labSurvivor = await entity('synthetic-survivor-lab');
    const labShell = await entity('synthetic-shell-lab');
    const stranded = await edge(memberShell._id, labShell._id);

    await archiveResearchEntities({
      ids: [labShell._id],
      archivedReason: 'synthetic:fold',
      set: { canonicalGroupId: labSurvivor._id },
      survivorId: labSurvivor._id,
    });

    const repointed = await stored(stranded._id);
    expect(String(repointed?.sourceResearchEntityId)).toBe(String(memberSurvivor._id));
    expect(String(repointed?.targetResearchEntityId)).toBe(String(labSurvivor._id));
  });

  it('leaves a link alone when the archived row has no survivor', async () => {
    const member = await entity('synthetic-member-profile');
    const retired = await entity('synthetic-retired-lab');
    const link = await edge(member._id, retired._id);

    const result = await archiveResearchEntities({
      ids: [retired._id],
      archivedReason: 'synthetic:retire',
    });

    expect(result.relationships.leftWithoutLiveEndpoint).toBe(1);
    expect(await stored(link._id)).toMatchObject({ archived: false });
    expect(String((await stored(link._id))?.targetResearchEntityId)).toBe(String(retired._id));
  });

  it('refuses to move links onto a survivor that is not live', async () => {
    const member = await entity('synthetic-member-profile');
    const archivedSurvivor = await entity('synthetic-archived-survivor', { archived: true });
    const shell = await entity('synthetic-shell-lab', {
      archived: true,
      canonicalGroupId: archivedSurvivor._id,
    });
    const link = await edge(member._id, shell._id);

    const result = await settleRelationshipEdgesOfArchivedResearchEntities({
      archivedEntityIds: [shell._id],
      archivedReason: 'synthetic:fold',
      survivorId: archivedSurvivor._id,
    });

    expect(result.refusedSurvivorNotLive).toBe(1);
    expect(String((await stored(link._id))?.targetResearchEntityId)).toBe(String(shell._id));
  });

  it('never moves the links of a row the archive write did not archive', async () => {
    const member = await entity('synthetic-member-profile');
    const survivor = await entity('synthetic-survivor-lab');
    const live = await entity('synthetic-live-lab');
    const link = await edge(member._id, live._id);

    const result = await settleRelationshipEdgesOfArchivedResearchEntities({
      archivedEntityIds: [live._id],
      archivedReason: 'synthetic:fold',
      survivorId: survivor._id,
    });

    expect(result.repointed).toBe(0);
    expect(String((await stored(link._id))?.targetResearchEntityId)).toBe(String(live._id));
  });

  it('hands the survivor one link when two archived rows carry the same one', () => {
    const settlements = planRelationshipEdgeSettlements({
      edges: [
        {
          id: 'edge-a',
          sourceId: 'member',
          targetId: 'shell-a',
          relationshipType: 'MEMBER_RESEARCH_AREA',
          liveSourceId: 'member',
          liveTargetId: 'survivor',
        },
        {
          id: 'edge-b',
          sourceId: 'member',
          targetId: 'shell-b',
          relationshipType: 'MEMBER_RESEARCH_AREA',
          liveSourceId: 'member',
          liveTargetId: 'survivor',
        },
      ],
      heldEdges: [],
    });

    expect(settlements.map((settlement) => settlement.action)).toEqual([
      'repoint',
      'archive-redundant',
    ]);
  });

  it('archives a moved link when the survivor already links the same rows under another type', async () => {
    const center = await entity('synthetic-center');
    const survivor = await entity('synthetic-survivor-lab');
    const shell = await entity('synthetic-shell-area');
    const held = await edge(center._id, survivor._id, { relationshipType: 'AFFILIATED_LAB' });
    const moved = await edge(center._id, shell._id);

    const result = await archiveResearchEntities({
      ids: [shell._id],
      archivedReason: 'synthetic:fold',
      set: { canonicalGroupId: survivor._id },
      survivorId: survivor._id,
    });

    expect(result.relationships).toMatchObject({ repointed: 0, archivedRedundant: 1 });
    expect((await stored(held._id))?.archived).toBe(false);
    const movedRow = await stored(moved._id);
    expect(movedRow?.archived).toBe(true);
    expect(String(movedRow?.targetResearchEntityId)).toBe(String(shell._id));
    expect(
      await ResearchEntityRelationship.countDocuments({
        sourceResearchEntityId: center._id,
        targetResearchEntityId: survivor._id,
        archived: { $ne: true },
      }),
    ).toBe(1);
  });
});

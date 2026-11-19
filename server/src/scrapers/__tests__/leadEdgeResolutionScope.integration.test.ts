import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const browseRank = vi.hoisted(() => ({
  recompute: vi.fn().mockResolvedValue({ updated: 0, indexSyncFailures: 0 }),
}));

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return { ...actual, syncEntity: vi.fn().mockResolvedValue(undefined) };
});

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return { ...actual, recomputeBrowseRankForEntities: browseRank.recompute };
});

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import { materializeEntity } from '../entityMaterializer';

const PROFILE_HOST = 'https://medicine.yale.edu/profile';
const SITE = 'https://medicine.yale.edu/lab/synthetic-imaging/';
const GRANT = 'https://reporter.example.gov/project-details/';

const seedResearcher = async (displayName: string, profileSlug: string) =>
  Researcher.create({
    displayName,
    profileLinks: [
      {
        kind: 'YALE_OFFICIAL',
        purpose: 'PRIMARY_IDENTITY',
        url: `${PROFILE_HOST}/${profileSlug}/`,
        verifiedAt: new Date('2026-01-01T00:00:00Z'),
      },
    ],
    archived: false,
  });

const observe = (entityKey: string, field: string, value: unknown, extra: object = {}) =>
  Observation.create({
    entityType: 'researchEntity',
    entityKey,
    field,
    value,
    sourceId: new mongoose.Types.ObjectId(),
    sourceName: 'synthetic-lab-directory',
    sourceUrl: SITE,
    confidence: 0.9,
    observedAt: new Date('2026-06-01T00:00:00Z'),
    superseded: false,
    ...extra,
  });

const seedRow = async (slug: string, name: string, entityType: string) => {
  const row = await ResearchEntity.create({
    slug,
    name,
    entityType,
    websiteUrl: SITE,
    sourceUrls: [SITE],
    studentVisibilityTier: 'student_ready',
    archived: false,
  });
  await observe(slug, 'name', `${name} Renamed`);
  return row;
};

const seedEdge = (
  personId: mongoose.Types.ObjectId,
  rowId: mongoose.Types.ObjectId,
  provenance?: { sourceName: string; sourceUrl: string },
) =>
  RoleAssignment.collection.insertOne({
    personId,
    target: { kind: 'RESEARCH_ENTITY', id: rowId },
    role: 'PI',
    state: 'CURRENT',
    archived: false,
    confidence: 0.9,
    ...(provenance ? { rosterProvenance: provenance } : {}),
  });

const edgeStates = async (rowId: mongoose.Types.ObjectId) => {
  const edges = await RoleAssignment.find({ 'target.id': rowId })
    .select('personId state')
    .lean<Array<{ personId: unknown; state?: string }>>();
  return new Map(
    edges.map((edge) => [String(edge.personId), edge.state === 'HISTORICAL' ? 'ended' : 'live']),
  );
};

const seedForeignGrantRow = async () => {
  const owner = await seedResearcher('Ada Quill', 'ada-quill');
  const colead = await seedResearcher('Bo Nimbus', 'bo-nimbus');
  const row = await seedRow(
    'ysm-faculty-ada-quill',
    'Ada Quill Faculty Research',
    'FACULTY_RESEARCH_AREA',
  );
  await observe(row.slug, 'inferredPiUserId', owner._id.toString(), {
    sourceName: 'nih-reporter',
    sourceUrl: `${GRANT}1001`,
  });
  await observe(row.slug, 'inferredPiUserId', colead._id.toString(), {
    sourceName: 'nih-reporter',
    sourceUrl: `${GRANT}1002`,
    superseded: true,
    rollback: { rolledBackAt: new Date('2026-07-01T00:00:00Z'), reason: 'synthetic' },
  });
  await seedEdge(owner._id, row._id, { sourceName: 'nih-reporter', sourceUrl: `${GRANT}1001` });
  await seedEdge(colead._id, row._id, { sourceName: 'nih-reporter', sourceUrl: `${GRANT}1002` });
  return { owner, colead, row };
};

const seedTraineeLab = async () => {
  const owner = await seedResearcher('Cy Tarn', 'cy-tarn');
  const trainee = await seedResearcher('Di Orrel', 'di-orrel');
  const row = await seedRow('ysm-faculty-cy-tarn', 'Synthetic Imaging Lab', 'LAB');
  await seedEdge(owner._id, row._id, { sourceName: 'ysm-faculty-directory', sourceUrl: SITE });
  await seedEdge(trainee._id, row._id);
  await ResearchEntity.collection.updateOne(
    { _id: row._id },
    {
      $set: {
        leadVerification: {
          state: 'verified',
          checkedUrl: SITE,
          pagesRead: 1,
          confirmedCount: 2,
          contradictedCount: 0,
          unstatedCount: 0,
          leads: [
            {
              personId: owner._id,
              role: 'PI',
              verdict: 'CONFIRMED',
              matchedBy: 'OFFICIAL_PROFILE_LINK',
              evidenceUrl: SITE,
            },
            {
              personId: trainee._id,
              role: 'PI',
              verdict: 'CONFIRMED',
              matchedBy: 'NAMED_ON_PAGE',
              evidenceUrl: SITE,
            },
          ],
          observedAt: new Date('2026-06-01T00:00:00Z'),
        },
      },
    },
  );
  return { owner, trainee, row };
};

describe('lead-edge resolution under a scope (#5992, #6001)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'research_entities', 'role_assignments', 'researchers']) {
      await db.collection(name).deleteMany({});
    }
  });

  it('ends the foreign grant edge and the trainee edge on a normal resolve', async () => {
    const foreign = await seedForeignGrantRow();
    const trainee = await seedTraineeLab();
    await materializeEntity('researchEntity', { entityKey: foreign.row.slug }, {});
    await materializeEntity('researchEntity', { entityKey: trainee.row.slug }, {});

    expect(await edgeStates(foreign.row._id)).toEqual(
      new Map([
        [String(foreign.owner._id), 'live'],
        [String(foreign.colead._id), 'ended'],
      ]),
    );
    expect(await edgeStates(trainee.row._id)).toEqual(
      new Map([
        [String(trainee.owner._id), 'live'],
        [String(trainee.trainee._id), 'ended'],
      ]),
    );
    const stored = await ResearchEntity.findById(foreign.row._id).lean<{ name?: string }>();
    expect(stored?.name).toBe('Ada Quill Faculty Research Renamed');
  });

  it('ends both edges under the leadEdges scope, projecting no field', async () => {
    const foreign = await seedForeignGrantRow();
    const trainee = await seedTraineeLab();
    const results = [];
    for (const row of [foreign.row, trainee.row]) {
      results.push(
        await materializeEntity('researchEntity', { entityKey: row.slug }, { leadEdgesOnly: true }),
      );
    }

    expect((await edgeStates(foreign.row._id)).get(String(foreign.colead._id))).toBe('ended');
    expect((await edgeStates(foreign.row._id)).get(String(foreign.owner._id))).toBe('live');
    expect((await edgeStates(trainee.row._id)).get(String(trainee.trainee._id))).toBe('ended');
    expect((await edgeStates(trainee.row._id)).get(String(trainee.owner._id))).toBe('live');
    expect(
      results.map((result) => result.leadEdgeResolution?.ended.map((edge) => edge.reason)),
    ).toEqual([['retired-evidence'], ['contradicted-sourceless']]);
    expect(results.every((result) => result.fieldsWritten === 0)).toBe(true);
    const stored = await ResearchEntity.findById(foreign.row._id).lean<{ name?: string }>();
    expect(stored?.name).toBe('Ada Quill Faculty Research');
    expect(browseRank.recompute.mock.calls).toEqual([
      [[String(foreign.row._id)]],
      [[String(trainee.row._id)]],
    ]);
  });

  it('plans the same edge ends in a dry run and writes nothing', async () => {
    const foreign = await seedForeignGrantRow();
    const trainee = await seedTraineeLab();
    const plans = [];
    for (const row of [foreign.row, trainee.row]) {
      plans.push(
        (
          await materializeEntity(
            'researchEntity',
            { entityKey: row.slug },
            { leadEdgesOnly: true, dryRun: true },
          )
        ).leadEdgeResolution,
      );
    }

    expect(plans.map((plan) => plan?.ended.map((edge) => edge.personId))).toEqual([
      [String(foreign.colead._id)],
      [String(trainee.trainee._id)],
    ]);
    expect(plans.flatMap((plan) => plan?.asserted ?? []).some((edge) => edge.isNewEdge)).toBe(
      false,
    );
    expect([...(await edgeStates(foreign.row._id)).values()]).toEqual(['live', 'live']);
    expect([...(await edgeStates(trainee.row._id)).values()]).toEqual(['live', 'live']);
    expect(browseRank.recompute).not.toHaveBeenCalled();
  });

  it('still skips lead edges under any other field scope (#3874)', async () => {
    const foreign = await seedForeignGrantRow();
    const trainee = await seedTraineeLab();
    for (const row of [foreign.row, trainee.row]) {
      await materializeEntity(
        'researchEntity',
        { entityKey: row.slug },
        { writeOnlyFields: ['name'] },
      );
    }

    expect([...(await edgeStates(foreign.row._id)).values()]).toEqual(['live', 'live']);
    expect([...(await edgeStates(trainee.row._id)).values()]).toEqual(['live', 'live']);
    const stored = await ResearchEntity.findById(foreign.row._id).lean<{ name?: string }>();
    expect(stored?.name).toBe('Ada Quill Faculty Research Renamed');
  });

  it('is a no-op the second time the leadEdges scope runs', async () => {
    const foreign = await seedForeignGrantRow();
    await materializeEntity(
      'researchEntity',
      { entityKey: foreign.row.slug },
      { leadEdgesOnly: true },
    );
    const first = await RoleAssignment.find({ 'target.id': foreign.row._id })
      .sort({ _id: 1 })
      .lean<Array<{ state?: string; endedAt?: Date }>>();
    const second = await materializeEntity(
      'researchEntity',
      { entityKey: foreign.row.slug },
      { leadEdgesOnly: true },
    );
    const after = await RoleAssignment.find({ 'target.id': foreign.row._id })
      .sort({ _id: 1 })
      .lean<Array<{ state?: string; endedAt?: Date }>>();

    expect(second.leadEdgeResolution?.ended).toEqual([]);
    expect(after.map((edge) => [edge.state, edge.endedAt?.getTime()])).toEqual(
      first.map((edge) => [edge.state, edge.endedAt?.getTime()]),
    );
  });

  it('reports a new lead edge in a dry run without creating it', async () => {
    const foreign = await seedForeignGrantRow();
    await RoleAssignment.deleteMany({ personId: foreign.owner._id });
    const plan = (
      await materializeEntity(
        'researchEntity',
        { entityKey: foreign.row.slug },
        { leadEdgesOnly: true, dryRun: true },
      )
    ).leadEdgeResolution;

    expect(plan?.asserted).toEqual([
      expect.objectContaining({ personId: String(foreign.owner._id), isNewEdge: true }),
    ]);
    expect(await RoleAssignment.countDocuments({ personId: foreign.owner._id })).toBe(0);
  });

  it('plans in a dry run the end an apply makes once a planned lead edge gains its source', async () => {
    const owner = await seedResearcher('Ez Morrow', 'ez-morrow');
    const other = await seedResearcher('Fi Lantern', 'fi-lantern');
    const row = await seedRow(
      'ysm-faculty-ez-morrow',
      'Ez Morrow Faculty Research',
      'FACULTY_RESEARCH_AREA',
    );
    await observe(row.slug, 'inferredPiUserId', owner._id.toString(), {
      sourceName: 'nih-reporter',
      sourceUrl: `${GRANT}2001`,
    });
    await seedEdge(owner._id, row._id);
    await seedEdge(other._id, row._id);

    const plan = (
      await materializeEntity(
        'researchEntity',
        { entityKey: row.slug },
        { leadEdgesOnly: true, dryRun: true },
      )
    ).leadEdgeResolution;
    expect([...(await edgeStates(row._id)).values()]).toEqual(['live', 'live']);
    const applied = (
      await materializeEntity('researchEntity', { entityKey: row.slug }, { leadEdgesOnly: true })
    ).leadEdgeResolution;

    expect(applied?.ended).toEqual([
      expect.objectContaining({ personId: String(other._id), reason: 'contradicted-sourceless' }),
    ]);
    expect(plan?.ended).toEqual(applied?.ended);
    expect((await edgeStates(row._id)).get(String(other._id))).toBe('ended');
  });

  it('keeps the edge report and flags the index when the browse-rank recompute throws', async () => {
    const foreign = await seedForeignGrantRow();
    browseRank.recompute.mockRejectedValueOnce(new Error('synthetic recompute failure'));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await materializeEntity(
      'researchEntity',
      { entityKey: foreign.row.slug },
      { leadEdgesOnly: true },
    );
    errorLog.mockRestore();

    expect(result.leadEdgeResolution?.ended.map((edge) => edge.personId)).toEqual([
      String(foreign.colead._id),
    ]);
    expect(result.indexSyncFailed).toBe(true);
    expect((await edgeStates(foreign.row._id)).get(String(foreign.colead._id))).toBe('ended');
  });
});

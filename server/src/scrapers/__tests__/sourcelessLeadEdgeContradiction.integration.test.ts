import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
  return { ...actual, recomputeBrowseRankForEntities: vi.fn().mockResolvedValue(undefined) };
});

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import { materializeEntity, materializeInferredPiMembership } from '../entityMaterializer';

const PROFILE_HOST = 'https://medicine.yale.edu/profile';
const SITE = 'https://medicine.yale.edu/lab/synthetic-habits/';

type Verdict = { verdict: string; matchedBy: string };

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

const seedRow = async (input: {
  slug: string;
  name: string;
  entityType: string;
  website?: string;
}) => {
  const row = await ResearchEntity.create({
    slug: input.slug,
    name: input.name,
    entityType: input.entityType,
    ...(input.website ? { website: input.website } : {}),
    websiteUrl: SITE,
    sourceUrls: [SITE],
    studentVisibilityTier: 'student_ready',
    archived: false,
  });
  await Observation.create({
    entityType: 'researchEntity',
    entityKey: input.slug,
    field: 'name',
    value: input.name,
    sourceId: new mongoose.Types.ObjectId(),
    sourceName: 'synthetic-lab-directory',
    sourceUrl: SITE,
    confidence: 0.9,
    observedAt: new Date('2026-06-01T00:00:00Z'),
    superseded: false,
  });
  return row;
};

const setVerdicts = async (
  rowId: mongoose.Types.ObjectId,
  judgements: Array<{ personId: mongoose.Types.ObjectId; role: string } & Verdict>,
) =>
  ResearchEntity.collection.updateOne(
    { _id: rowId },
    {
      $set: {
        leadVerification: {
          state: 'verified',
          checkedUrl: SITE,
          pagesRead: 1,
          confirmedCount: 0,
          contradictedCount: 0,
          unstatedCount: 0,
          leads: judgements.map((judgement) => ({ ...judgement, evidenceUrl: SITE })),
          observedAt: new Date('2026-06-01T00:00:00Z'),
        },
      },
    },
  );

const seedLeadEdge = async (
  personId: mongoose.Types.ObjectId,
  rowId: mongoose.Types.ObjectId,
  role: string,
  sourceName?: string,
) =>
  RoleAssignment.collection.insertOne({
    personId,
    target: { kind: 'RESEARCH_ENTITY', id: rowId },
    role,
    state: 'CURRENT',
    archived: false,
    confidence: 0,
    ...(sourceName ? { rosterProvenance: { sourceName, sourceUrl: `${SITE}people/` } } : {}),
  });

const edgeStates = async (rowId: mongoose.Types.ObjectId) => {
  const edges = await RoleAssignment.find({ 'target.id': rowId })
    .select('personId state endedAt')
    .lean<Array<{ personId: unknown; state?: string; endedAt?: Date }>>();
  return new Map(
    edges.map((edge) => [String(edge.personId), edge.state === 'HISTORICAL' ? 'ended' : 'live']),
  );
};

describe('a lead edge with no recorded source ends only when a current lane contradicts it (#5979 C4)', () => {
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

  const seedOwnedLab = async (
    sourcelessVerdict: Verdict,
    rowNaming: { name?: string; website?: string } = {},
  ) => {
    const owner = await seedResearcher('Ada Quill', 'ada-quill');
    const listed = await seedResearcher('Bo Nimbus', 'bo-nimbus');
    const row = await seedRow({
      slug: 'ysm-faculty-ada-quill',
      name: rowNaming.name ?? 'Synthetic Habits Lab',
      entityType: 'LAB',
      website: rowNaming.website,
    });
    await seedLeadEdge(owner._id, row._id, 'PI', 'ysm-faculty-directory');
    await seedLeadEdge(listed._id, row._id, 'PI');
    await setVerdicts(row._id, [
      { personId: owner._id, role: 'PI', verdict: 'CONFIRMED', matchedBy: 'OFFICIAL_PROFILE_LINK' },
      { personId: listed._id, role: 'PI', ...sourcelessVerdict },
    ]);
    return { owner, listed, row };
  };

  it('ends a sourceless edge on a row named for another lead when the site only mentions the person', async () => {
    const { owner, listed, row } = await seedOwnedLab({
      verdict: 'CONFIRMED',
      matchedBy: 'NAMED_ON_PAGE',
    });
    await materializeEntity('researchEntity', { entityKey: row.slug }, {});

    expect(await edgeStates(row._id)).toEqual(
      new Map([
        [String(owner._id), 'live'],
        [String(listed._id), 'ended'],
      ]),
    );
  });

  it("ends a sourceless edge the row's site contradicts", async () => {
    const listed = await seedResearcher('Bo Nimbus', 'bo-nimbus');
    const row = await seedRow({
      slug: 'synthetic-habits-lab',
      name: 'Synthetic Habits Lab',
      entityType: 'LAB',
    });
    await seedLeadEdge(listed._id, row._id, 'PI');
    await setVerdicts(row._id, [
      { personId: listed._id, role: 'PI', verdict: 'CONTRADICTED', matchedBy: 'NONE' },
    ]);
    await materializeEntity('researchEntity', { entityKey: row.slug }, {});

    expect((await edgeStates(row._id)).get(String(listed._id))).toBe('ended');
  });

  it('keeps an uncontradicted sourceless edge, even as the only lead', async () => {
    const listed = await seedResearcher('Bo Nimbus', 'bo-nimbus');
    const row = await seedRow({
      slug: 'synthetic-habits-lab',
      name: 'Synthetic Habits Lab',
      entityType: 'LAB',
    });
    await seedLeadEdge(listed._id, row._id, 'PI');
    await setVerdicts(row._id, [
      { personId: listed._id, role: 'PI', verdict: 'UNSTATED', matchedBy: 'NONE' },
    ]);
    await materializeEntity('researchEntity', { entityKey: row.slug }, {});

    expect((await edgeStates(row._id)).get(String(listed._id))).toBe('live');
  });

  it('keeps a co-lead the site confirms by their own profile link', async () => {
    const { owner, listed, row } = await seedOwnedLab({
      verdict: 'CONFIRMED',
      matchedBy: 'OFFICIAL_PROFILE_LINK',
    });
    await materializeEntity('researchEntity', { entityKey: row.slug }, {});

    expect(await edgeStates(row._id)).toEqual(
      new Map([
        [String(owner._id), 'live'],
        [String(listed._id), 'live'],
      ]),
    );
  });

  it('keeps a sourceless edge a live lead read still names', async () => {
    const { listed, row } = await seedOwnedLab({ verdict: 'UNSTATED', matchedBy: 'NONE' });
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: row.slug,
      field: 'inferredPiUserId',
      value: listed._id.toString(),
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'nih-reporter',
      sourceUrl: 'https://reporter.example.gov/project-details/2001',
      confidence: 0.9,
      observedAt: new Date('2026-06-01T00:00:00Z'),
      superseded: false,
    });
    await materializeEntity('researchEntity', { entityKey: row.slug }, {});

    expect((await edgeStates(row._id)).get(String(listed._id))).toBe('live');
  });

  it('keeps a sourceless edge on a row whose title also names that person', async () => {
    const { owner, listed, row } = await seedOwnedLab(
      { verdict: 'CONFIRMED', matchedBy: 'NAMED_ON_PAGE' },
      { name: 'Bo Nimbus Lab' },
    );
    await materializeEntity('researchEntity', { entityKey: row.slug }, {});

    expect(await edgeStates(row._id)).toEqual(
      new Map([
        [String(owner._id), 'live'],
        [String(listed._id), 'live'],
      ]),
    );
  });

  it("keeps a sourceless edge on a row whose stored website cites that person's profile", async () => {
    const { owner, listed, row } = await seedOwnedLab(
      { verdict: 'CONFIRMED', matchedBy: 'NAMED_ON_PAGE' },
      { website: `${PROFILE_HOST}/bo-nimbus/` },
    );
    await materializeEntity('researchEntity', { entityKey: row.slug }, {});

    expect(await edgeStates(row._id)).toEqual(
      new Map([
        [String(owner._id), 'live'],
        [String(listed._id), 'live'],
      ]),
    );
  });

  it('keeps the sourceless edge of a person who also holds a recorded lead edge the row is named for', async () => {
    const owner = await seedResearcher('Ada Quill', 'ada-quill');
    const row = await seedRow({
      slug: 'ysm-faculty-ada-quill',
      name: 'Synthetic Habits Lab',
      entityType: 'LAB',
    });
    await seedLeadEdge(owner._id, row._id, 'PI', 'ysm-faculty-directory');
    await seedLeadEdge(owner._id, row._id, 'DIRECTOR');
    await setVerdicts(row._id, [
      { personId: owner._id, role: 'PI', verdict: 'CONTRADICTED', matchedBy: 'NONE' },
    ]);
    await materializeEntity('researchEntity', { entityKey: row.slug }, {});

    const edges = await RoleAssignment.find({ 'target.id': row._id })
      .select('role state')
      .lean<Array<{ role: string; state?: string }>>();
    expect(edges.map((edge) => [edge.role, edge.state]).sort()).toEqual([
      ['DIRECTOR', 'CURRENT'],
      ['PI', 'CURRENT'],
    ]);
  });

  it('keeps a sourceless edge a live director read names, when only the PI lane runs', async () => {
    const listed = await seedResearcher('Bo Nimbus', 'bo-nimbus');
    const row = await seedRow({
      slug: 'center-synthetic-leadership',
      name: 'Synthetic Leadership Center',
      entityType: 'CENTER',
    });
    await seedLeadEdge(listed._id, row._id, 'DIRECTOR');
    await setVerdicts(row._id, [
      { personId: listed._id, role: 'DIRECTOR', verdict: 'CONTRADICTED', matchedBy: 'NONE' },
    ]);
    await materializeInferredPiMembership(String(row._id), [
      {
        field: 'inferredDirectorUserName',
        value: { fname: 'Bo', lname: 'Nimbus' },
        sourceName: 'center-director',
        sourceUrl: SITE,
        confidence: 0.9,
        observedAt: new Date('2026-06-01T00:00:00Z'),
      },
    ]);

    expect((await edgeStates(row._id)).get(String(listed._id))).toBe('live');
  });

  it('keeps a center PI who is not its director', async () => {
    const director = await seedResearcher('Cy Tarn', 'cy-tarn');
    const listed = await seedResearcher('Bo Nimbus', 'bo-nimbus');
    const row = await seedRow({
      slug: 'center-synthetic-leadership',
      name: 'Synthetic Leadership Center',
      entityType: 'CENTER',
    });
    await seedLeadEdge(director._id, row._id, 'DIRECTOR', 'center-director');
    await seedLeadEdge(listed._id, row._id, 'PI');
    await setVerdicts(row._id, [
      {
        personId: director._id,
        role: 'DIRECTOR',
        verdict: 'CONFIRMED',
        matchedBy: 'NAMED_ON_PAGE',
      },
      { personId: listed._id, role: 'PI', verdict: 'UNSTATED', matchedBy: 'NONE' },
    ]);
    await materializeEntity('researchEntity', { entityKey: row.slug }, {});

    expect(await edgeStates(row._id)).toEqual(
      new Map([
        [String(director._id), 'live'],
        [String(listed._id), 'live'],
      ]),
    );
  });

  it('is a no-op on a second resolve', async () => {
    const { owner, listed, row } = await seedOwnedLab({
      verdict: 'CONFIRMED',
      matchedBy: 'NAMED_ON_PAGE',
    });
    await materializeEntity('researchEntity', { entityKey: row.slug }, {});
    const first = await RoleAssignment.find({ 'target.id': row._id })
      .sort({ _id: 1 })
      .lean<Array<{ state?: string; endedAt?: Date; updatedAt?: Date }>>();
    await materializeEntity('researchEntity', { entityKey: row.slug }, {});
    const second = await RoleAssignment.find({ 'target.id': row._id })
      .sort({ _id: 1 })
      .lean<Array<{ state?: string; endedAt?: Date; updatedAt?: Date }>>();

    expect(second.map((edge) => [edge.state, edge.endedAt?.getTime()])).toEqual(
      first.map((edge) => [edge.state, edge.endedAt?.getTime()]),
    );
    expect(await edgeStates(row._id)).toEqual(
      new Map([
        [String(owner._id), 'live'],
        [String(listed._id), 'ended'],
      ]),
    );
  });
});

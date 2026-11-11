import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return {
    ...actual,
    syncEntity: vi.fn().mockResolvedValue(undefined),
    deleteFromIndex: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return { ...actual, recomputeBrowseRankForEntities: vi.fn().mockResolvedValue(undefined) };
});

import { Observation } from '../../models/observation';
import { Researcher } from '../../models/researcher';
import { ResearchEntity } from '../../models/researchEntity';
import { RoleAssignment } from '../../models/roleAssignment';
import { materializeEntity, withDerivedMaterializerFields } from '../entityMaterializer';
import { resetInvalidatedScrapeRunCache } from '../invalidatedScrapeRuns';
import { PROFILE_IN_MEMORIAM_FIELD } from '../personPageDeparture';
import { parseRematerializeResearchEntitiesArgs } from '../../scripts/rematerializeResearchEntitiesCore';

const ROW_KEY = 'yale-status-scope-fixture';
const LEAD_NETID = 'lead321';
const YALE_STATUS_FIELDS = ['yaleStatusCache', 'activeAtYaleCache', 'yaleStatusReasonCache'];

describe('a scoped rematerialize writes the Yale-status closure and nothing else (#5721)', () => {
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
    for (const name of ['observations', 'researchers', 'research_entities', 'role_assignments']) {
      await db.collection(name).deleteMany({});
    }
    resetInvalidatedScrapeRunCache();
  });

  const rowObservation = (field: string, value: unknown) =>
    Observation.create({
      entityType: 'researchEntity',
      entityKey: ROW_KEY,
      field,
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'department-directory',
      sourceUrl: 'https://chemistry.yale.edu/people/ada-fixture',
      confidence: 0.9,
      observedAt: new Date('2026-01-01T00:00:00Z'),
      superseded: false,
    });

  const seed = async (rowExtra: Record<string, unknown> = {}) => {
    const lead = await Researcher.create({
      displayName: 'Ada Fixture',
      identifiers: { netid: LEAD_NETID },
    });
    const row = await ResearchEntity.create({
      slug: ROW_KEY,
      name: 'Ada Fixture Research',
      kind: 'individual',
      studentVisibilityTier: 'student_ready',
      researchAreas: ['Catalysis'],
      fullDescription:
        'The group studies reaction kinetics and catalysis with undergraduate projects.',
      archived: false,
      ...rowExtra,
    });
    await RoleAssignment.create({
      personId: lead._id,
      target: { kind: 'RESEARCH_ENTITY', id: row._id },
      role: 'PI',
      state: 'CURRENT',
      confidence: 0.9,
    });
    await rowObservation(
      'fullDescription',
      'The group studies reaction kinetics and catalysis with undergraduate projects.',
    );
    await rowObservation('researchAreas', ['Organic Synthesis', 'Spectroscopy']);
    await Observation.create({
      entityType: 'user',
      entityKey: `netid:${LEAD_NETID}`,
      field: PROFILE_IN_MEMORIAM_FIELD,
      value: true,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'official-profile-pi-backfill',
      sourceUrl: 'https://chemistry.yale.edu/people/ada-fixture',
      confidence: 0.95,
      observedAt: new Date('2026-11-01T00:00:00Z'),
      superseded: false,
    });
    return row;
  };

  const raw = async (id: unknown) =>
    mongoose.connection.db!.collection('research_entities').findOne({ _id: id as any });

  const withoutClosure = (doc: Record<string, unknown> | null) => {
    const copy: Record<string, unknown> = { ...(doc ?? {}) };
    for (const field of [...YALE_STATUS_FIELDS, 'updatedAt']) delete copy[field];
    return JSON.stringify(copy);
  };

  const scoped = (field = 'activeAtYaleCache') =>
    materializeEntity('researchEntity', { entityKey: ROW_KEY }, { writeOnlyFields: [field] });

  it('accepts a Yale-status field as an --only-fields scope', () => {
    expect(
      parseRematerializeResearchEntitiesArgs([
        `--slugs=${ROW_KEY}`,
        '--only-fields=activeAtYaleCache',
      ]).onlyFields,
    ).toEqual(['activeAtYaleCache']);
  });

  it('names one Yale-status field and gets the whole closure', () => {
    expect(withDerivedMaterializerFields(['activeAtYaleCache']).sort()).toEqual(
      [...YALE_STATUS_FIELDS].sort(),
    );
  });

  it('sets the hide status and leaves every other byte of the row, research areas included', async () => {
    const row = await seed();
    const before = await raw(row._id);

    await scoped();
    const after = await raw(row._id);

    expect(after).toMatchObject({
      activeAtYaleCache: false,
      yaleStatusCache: 'departed',
      yaleStatusReasonCache: 'deceased',
    });
    expect(after?.researchAreas).toEqual(['Catalysis']);
    expect(withoutClosure(after)).toEqual(withoutClosure(before));
  });

  it('writes nothing on a second scoped pass', async () => {
    const row = await seed();
    await scoped();
    const first = await raw(row._id);

    await scoped('yaleStatusReasonCache');

    expect(JSON.stringify(await raw(row._id))).toEqual(JSON.stringify(first));
  });

  it('leaves a row whose Yale status is locked untouched', async () => {
    const row = await seed({ manuallyLockedFields: ['activeAtYaleCache'] });
    const before = await raw(row._id);

    await scoped();

    expect(JSON.stringify(await raw(row._id))).toEqual(JSON.stringify(before));
  });
});

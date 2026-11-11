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
import { ResearchEntity } from '../../models/researchEntity';
import { RoleAssignment } from '../../models/roleAssignment';
import { Researcher } from '../../models/researcher';
import { materializeEntity } from '../entityMaterializer';

const ENTITY_KEY = 'synthetic-grant-role-lab';

describe('a materialized row labels each grant with its lead role (#5779)', () => {
  let replSet: MongoMemoryReplSet;
  const lead = new mongoose.Types.ObjectId();
  const other = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  const award = (id: string, investigators?: unknown[]) => ({
    id,
    agency: 'NIGMS',
    title: `Synthetic award ${id}`,
    abstract: '',
    startDate: new Date('2025-01-01T00:00:00Z'),
    endDate: new Date('2999-01-01T00:00:00Z'),
    dollarAmount: 1,
    url: `https://reporter.nih.gov/project-details/${id}`,
    role: 'pi',
    ...(investigators ? { investigators } : {}),
  });

  const awards = () => [
    award('R01GM000001', [{ contact: true, researcherId: String(lead), profileId: 1 }]),
    award('R01GM000002', [{ contact: true, researcherId: String(other), profileId: 2 }]),
    award('R01GM000003', [
      { contact: true, researcherId: String(other), profileId: 2 },
      { contact: false, researcherId: String(lead), profileId: 1 },
    ]),
    award('R01GM000004'),
  ];

  const seed = async (field: string, value: unknown) => {
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: ENTITY_KEY,
      field,
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'nih-reporter',
      sourceUrl: 'https://reporter.nih.gov/',
      confidence: 0.9,
      observedAt: new Date('2026-02-01T00:00:00Z'),
      superseded: false,
    });
  };

  beforeEach(async () => {
    await Observation.deleteMany({});
    await ResearchEntity.deleteMany({});
    await RoleAssignment.deleteMany({});
    await Researcher.deleteMany({});
    await Researcher.create({
      _id: lead,
      displayName: 'Avery Leadperson',
      identifiers: { netid: 'synlead1' },
    });
    await Researcher.create({
      _id: other,
      displayName: 'Blair Otherperson',
      identifiers: { netid: 'synother2' },
    });
    const row = await ResearchEntity.create({
      slug: ENTITY_KEY,
      name: 'Synthetic Grant Role Lab',
      kind: 'lab',
      archived: false,
    });
    await RoleAssignment.create({
      personId: lead,
      target: { kind: 'RESEARCH_ENTITY', id: row._id },
      role: 'PI',
      state: 'CURRENT',
      confidence: 0.9,
      reviewStatus: 'UNREVIEWED',
      archived: false,
    });
    await seed('recentGrants', awards());
    await seed('recentGrantPeriods', awards());
    await seed('recentGrantCount', 4);
    await seed('fundingAgencies', ['NIH']);
  });

  const storedGrants = async () => {
    const stored = await ResearchEntity.findOne({ slug: ENTITY_KEY }).lean<Record<string, any>>();
    return {
      grants: Object.fromEntries(
        (stored?.recentGrants ?? []).map((entry: any) => [entry.id, entry.role ?? null]),
      ),
      count: stored?.recentGrantCount,
      periods: (stored?.recentGrantPeriods ?? []).map((entry: any) => entry.id).sort(),
    };
  };

  it('stores pi, copi and a held legacy entry, and never another person sole-PI award', async () => {
    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });
    expect(await storedGrants()).toEqual({
      grants: { R01GM000001: 'pi', R01GM000003: 'copi', R01GM000004: null },
      count: 3,
      periods: ['R01GM000001', 'R01GM000003', 'R01GM000004'],
    });
  });

  it('holds another person award when that person is a duplicate record of the lead', async () => {
    await Researcher.updateOne({ _id: other }, { $set: { displayName: 'Avery Leadperson' } });
    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });
    expect((await storedGrants()).grants).toEqual({
      R01GM000001: 'pi',
      R01GM000002: null,
      R01GM000003: 'copi',
      R01GM000004: null,
    });
  });

  it('stores the same grants after a second materialize', async () => {
    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });
    const first = await storedGrants();
    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });
    expect(await storedGrants()).toEqual(first);
  });
});

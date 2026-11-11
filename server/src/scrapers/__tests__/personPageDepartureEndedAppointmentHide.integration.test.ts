import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/endedAppointmentLeadMode', () => ({ ENDED_APPOINTMENT_LEAD_MODE: 'hide' }));

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
import { materializeEntity } from '../entityMaterializer';
import { resetInvalidatedScrapeRunCache } from '../invalidatedScrapeRuns';
import { PROFILE_APPOINTMENT_ENDED_FIELD } from '../personPageDeparture';

const ROW_KEY = 'ended-appointment-fixture';
const LEAD_NETID = 'lead789';

describe('an ended sole appointment, once its mode hides, follows its evidence both ways (#5721)', () => {
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

  const seed = async (endedOn: string, title = 'Visiting Professor of Chemistry') => {
    const lead = await Researcher.create({
      displayName: 'Ada Fixture',
      identifiers: { netid: LEAD_NETID },
      profile: { title },
    });
    const row = await ResearchEntity.create({
      slug: ROW_KEY,
      name: 'Ada Fixture Research',
      kind: 'individual',
      studentVisibilityTier: 'operator_review',
      archived: false,
    });
    await RoleAssignment.create({
      personId: lead._id,
      target: { kind: 'RESEARCH_ENTITY', id: row._id },
      role: 'PI',
      state: 'CURRENT',
      confidence: 0.9,
    });
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: ROW_KEY,
      field: 'fullDescription',
      value: 'The group studies reaction kinetics and catalysis with undergraduate projects.',
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'department-directory',
      sourceUrl: 'https://chemistry.yale.edu/people/ada-fixture',
      confidence: 0.9,
      observedAt: new Date('2026-01-01T00:00:00Z'),
      superseded: false,
    });
    return Observation.create({
      entityType: 'user',
      entityKey: `netid:${LEAD_NETID}`,
      field: PROFILE_APPOINTMENT_ENDED_FIELD,
      value: endedOn,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'official-profile-pi-backfill',
      sourceUrl: 'https://medicine.yale.edu/profile/ada-fixture/',
      confidence: 0.95,
      observedAt: new Date('2026-11-01T00:00:00Z'),
      superseded: false,
    });
  };

  const storedRow = () =>
    ResearchEntity.findOne({ slug: ROW_KEY }).lean<{
      activeAtYaleCache?: boolean;
      yaleStatusReasonCache?: string;
    }>();

  it('marks the row departed under its own reason', async () => {
    await seed('2025-05-31');

    await materializeEntity('researchEntity', { entityKey: ROW_KEY });

    expect(await storedRow()).toMatchObject({
      activeAtYaleCache: false,
      yaleStatusReasonCache: 'lead_departed',
    });
  });

  it('brings the row back current once the ended-appointment evidence goes', async () => {
    const evidence = await seed('2025-05-31');
    await materializeEntity('researchEntity', { entityKey: ROW_KEY });
    expect((await storedRow())?.activeAtYaleCache).toBe(false);

    await Observation.updateOne({ _id: evidence._id }, { $set: { superseded: true } });
    await materializeEntity('researchEntity', { entityKey: ROW_KEY });

    expect((await storedRow())?.activeAtYaleCache).not.toBe(false);
  });

  it('keeps an emeritus-led row served whatever appointment ended', async () => {
    await seed('2025-05-31', 'Professor Emeritus of Chemistry');

    await materializeEntity('researchEntity', { entityKey: ROW_KEY });

    expect((await storedRow())?.activeAtYaleCache).not.toBe(false);
  });

  it('leaves a row current when the stated end date is still ahead', async () => {
    await seed('2099-05-31');

    await materializeEntity('researchEntity', { entityKey: ROW_KEY });

    expect((await storedRow())?.activeAtYaleCache).not.toBe(false);
  });
});

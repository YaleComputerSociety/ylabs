import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { resetDirectoryNetidsByAddressCache } from '../directoryContradictedProfileNetid';
import { resetInvalidatedScrapeRunCache } from '../invalidatedScrapeRuns';
import {
  PROFILE_APPOINTMENT_ENDED_FIELD,
  PROFILE_IN_MEMORIAM_FIELD,
  loadPersonPageDepartures,
  personPageDepartureFrom,
} from '../personPageDeparture';
import { servedRoster } from '../../services/directoryRemovalServing';
import { leadMembersByEntityId } from '../../services/researchEntityBrowseRankService';
import { optionalPublicLeadMemberNames } from '../../services/researchGroupService';
import { fetchResearchEntitySearchMemberNames } from '../../services/researchEntitySearchIndexService';
import { studentVisibilityGateLeadRows } from '../../services/studentVisibilityGateService';
import { rostersWithDepartedLeadsRetired } from '../../services/departedLeadServing';
import { getResearchEntityRosterByEntityId } from '../../services/researchEntityMembershipAccessor';
import { deriveResearchEntityYaleStatus } from '../../utils/researchEntityYaleStatus';

const ROW_KEY = 'person-page-departure-fixture';
const LEAD_NETID = 'lead123';
const OTHER_NETID = 'lead456';
const LEAD_PAGE = 'https://medicine.yale.edu/profile/ada-fixture/';
const DIRECTORY_EMAIL = 'ada.fixture@yale.edu';

describe("a lead's own official page marks them deceased or departed (#5721)", () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    await Observation.createIndexes();
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
    for (const name of [
      'observations',
      'researchers',
      'research_entities',
      'role_assignments',
      'scrape_runs',
    ]) {
      await db.collection(name).deleteMany({});
    }
    resetDirectoryNetidsByAddressCache();
    resetInvalidatedScrapeRunCache();
  });

  const userObservation = (netid: string, field: string, value: unknown, sourceName: string) =>
    Observation.create({
      entityType: 'user',
      entityKey: `netid:${netid}`,
      field,
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName,
      sourceUrl: LEAD_PAGE,
      confidence: 0.95,
      observedAt: new Date('2026-11-01T00:00:00Z'),
      superseded: false,
    });

  const markInMemoriam = (netid: string, sourceName = 'official-profile-pi-backfill') =>
    userObservation(netid, PROFILE_IN_MEMORIAM_FIELD, 'In Memoriam', sourceName);

  const seedLead = (netid: string, displayName: string, extra: Record<string, unknown> = {}) =>
    Researcher.create({ displayName, identifiers: { netid }, ...extra });

  const seedRow = async (leads: Array<{ _id: unknown }>) => {
    const row = await ResearchEntity.create({
      slug: ROW_KEY,
      name: 'Ada Fixture Research',
      kind: 'individual',
      studentVisibilityTier: 'operator_review',
      archived: false,
    });
    for (const lead of leads) {
      await RoleAssignment.create({
        personId: lead._id,
        target: { kind: 'RESEARCH_ENTITY', id: row._id },
        role: 'PI',
        state: 'CURRENT',
        confidence: 0.9,
      });
    }
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
    return row;
  };

  const storedRow = () =>
    ResearchEntity.findOne({ slug: ROW_KEY }).lean<{
      activeAtYaleCache?: boolean;
      yaleStatusCache?: string;
      yaleStatusReasonCache?: string;
    }>();

  it('hides a row whose sole lead is marked deceased by their own page', async () => {
    const lead = await seedLead(LEAD_NETID, 'Ada Fixture');
    await seedRow([lead]);
    await markInMemoriam(LEAD_NETID);

    await materializeEntity('researchEntity', { entityKey: ROW_KEY });

    expect(await storedRow()).toMatchObject({
      activeAtYaleCache: false,
      yaleStatusCache: 'departed',
      yaleStatusReasonCache: 'deceased',
    });
  });

  it('re-derives the same status on a second resolve and plans no further write', async () => {
    const lead = await seedLead(LEAD_NETID, 'Ada Fixture');
    await seedRow([lead]);
    await markInMemoriam(LEAD_NETID);

    await materializeEntity('researchEntity', { entityKey: ROW_KEY });
    const before = await storedRow();
    await materializeEntity('researchEntity', { entityKey: ROW_KEY });

    expect(await storedRow()).toMatchObject({
      activeAtYaleCache: before?.activeAtYaleCache,
      yaleStatusCache: before?.yaleStatusCache,
      yaleStatusReasonCache: before?.yaleStatusReasonCache,
    });
  });

  it('agrees with an operator override that already holds the row inactive', async () => {
    const lead = await seedLead(LEAD_NETID, 'Ada Fixture');
    const row = await seedRow([lead]);
    await ResearchEntity.updateOne(
      { _id: row._id },
      {
        $set: {
          activeAtYaleCache: false,
          yaleStatusCache: 'departed',
          studentVisibilityOverrideTier: 'suppressed',
        },
      },
    );
    await markInMemoriam(LEAD_NETID);

    await materializeEntity('researchEntity', { entityKey: ROW_KEY });

    expect(await storedRow()).toMatchObject({
      activeAtYaleCache: false,
      yaleStatusCache: 'departed',
    });
  });

  it('only observes an ended appointment by default, leaving the row served', async () => {
    const lead = await seedLead(LEAD_NETID, 'Ada Fixture');
    await seedRow([lead]);
    await userObservation(
      LEAD_NETID,
      PROFILE_APPOINTMENT_ENDED_FIELD,
      '2025-05-31',
      'official-profile-pi-backfill',
    );

    await materializeEntity('researchEntity', { entityKey: ROW_KEY });

    expect((await storedRow())?.activeAtYaleCache).not.toBe(false);
    expect((await loadPersonPageDepartures([String(lead._id)], new Date())).size).toBe(0);
  });

  it('never reads an ended appointment as a departure for an emeritus title', () => {
    const observations = [
      {
        entityKey: `netid:${LEAD_NETID}`,
        sourceName: 'official-profile-pi-backfill',
        field: PROFILE_APPOINTMENT_ENDED_FIELD,
        value: '2025-05-31',
      },
    ];
    const now = new Date('2026-11-11T00:00:00Z');

    expect(
      personPageDepartureFrom(LEAD_NETID, observations, now, {
        title: 'Professor Emeritus of Chemistry',
        endedAppointmentMode: 'hide',
      }),
    ).toBeUndefined();
    expect(
      personPageDepartureFrom(LEAD_NETID, observations, now, {
        title: 'Visiting Professor',
        endedAppointmentMode: 'hide',
      }),
    ).toBe('departed');
  });

  it('leaves a row current when the stated end date is still ahead', async () => {
    const lead = await seedLead(LEAD_NETID, 'Ada Fixture');
    await seedRow([lead]);
    await userObservation(
      LEAD_NETID,
      PROFILE_APPOINTMENT_ENDED_FIELD,
      '2099-05-31',
      'official-profile-pi-backfill',
    );

    await materializeEntity('researchEntity', { entityKey: ROW_KEY });

    expect((await storedRow())?.activeAtYaleCache).not.toBe(false);
  });

  it('ignores a marker another lane recorded', async () => {
    const lead = await seedLead(LEAD_NETID, 'Ada Fixture');
    await seedRow([lead]);
    await markInMemoriam(LEAD_NETID, 'dept-faculty-roster');

    await materializeEntity('researchEntity', { entityKey: ROW_KEY });

    expect((await storedRow())?.activeAtYaleCache).not.toBe(false);
  });

  it('keeps a row served when another current lead continues it, and serves that lead', async () => {
    const gone = await seedLead(LEAD_NETID, 'Ada Fixture');
    const current = await seedLead(OTHER_NETID, 'Ari Fixture');
    const row = await seedRow([gone, current]);
    await markInMemoriam(LEAD_NETID);

    await materializeEntity('researchEntity', { entityKey: ROW_KEY });
    expect((await storedRow())?.activeAtYaleCache).not.toBe(false);

    const served = await servedRoster(row._id);
    const currentLeadIds = served
      .filter((entry: any) => entry.state !== 'HISTORICAL')
      .map((entry: any) => String(entry.personId));
    expect(currentLeadIds).toEqual([String(current._id)]);
  });

  it('names only the continuing lead on the card, the search document, the gate and browse rank', async () => {
    const gone = await seedLead(LEAD_NETID, 'Ada Fixture');
    const current = await seedLead(OTHER_NETID, 'Ari Fixture');
    const row = await seedRow([gone, current]);
    await markInMemoriam(LEAD_NETID);
    const entity = await ResearchEntity.findById(row._id).lean<Record<string, any>>();

    const cards = await optionalPublicLeadMemberNames([entity!]);
    expect(cards.byEntityId.get(String(row._id))).toEqual(['Ari Fixture']);

    const search = await fetchResearchEntitySearchMemberNames([entity]);
    expect(search.get(String(row._id))?.leadProfessorNames).toEqual(['Ari Fixture']);

    const gateRoster = await rostersWithDepartedLeadsRetired(
      await getResearchEntityRosterByEntityId([row._id]),
    );
    expect(
      studentVisibilityGateLeadRows(gateRoster.get(String(row._id)) ?? []).map((lead) => lead.name),
    ).toEqual(['Ari Fixture']);

    const browse = await leadMembersByEntityId([row._id]);
    expect((browse.get(String(row._id)) ?? []).map((lead: any) => lead.name)).toEqual([
      'Ari Fixture',
    ]);
  });

  it('presents a deceased-lead row by the single switch: hidden by default, served when labelled', () => {
    const entity = { leadPageDeparture: 'deceased' };

    expect(deriveResearchEntityYaleStatus(entity)).toMatchObject({ reason: 'deceased' });
    expect(deriveResearchEntityYaleStatus(entity, 'hide')).toMatchObject({ reason: 'deceased' });
    expect(deriveResearchEntityYaleStatus(entity, 'label')).toBeNull();
    expect(
      deriveResearchEntityYaleStatus({ leadPageDeparture: 'departed' }, 'label'),
    ).toMatchObject({ reason: 'lead_departed' });
  });

  it('gives a person their own page marks deceased no email fill', async () => {
    const lead = await seedLead(LEAD_NETID, 'Ada Fixture');
    for (const [field, value] of [
      ['netid', LEAD_NETID],
      ['email', DIRECTORY_EMAIL],
    ] as const) {
      await Observation.create({
        entityType: 'user',
        entityKey: LEAD_NETID,
        field,
        value,
        sourceId: new mongoose.Types.ObjectId(),
        sourceName: 'yale-directory',
        sourceUrl: `https://directory.yale.edu/${LEAD_NETID}`,
        confidence: 0.9,
        observedAt: new Date('2026-11-01T00:00:00Z'),
        superseded: false,
      });
    }
    await markInMemoriam(LEAD_NETID);

    expect((await loadPersonPageDepartures([String(lead._id)], new Date())).size).toBe(1);
    await materializeEntity('user', { entityKey: LEAD_NETID }, {});

    const after = await Researcher.findById(lead._id).lean<{ identifiers?: { email?: string } }>();
    expect(after?.identifiers?.email).toBeUndefined();
  });
});

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

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import {
  materializeEntity,
  materializeInferredPiMembership,
  planInferredPiMembership,
  planScreenedPageWithdrawal,
} from '../entityMaterializer';
import { resetDirectoryNetidsByAddressCache } from '../directoryContradictedProfileNetid';

const SCHOOL_PAGE = 'https://publichealth.yale.edu/profile/sam-fixture/';
const MEDICINE_PAGE = 'https://medicine.yale.edu/profile/sam-fixture/';
const OWNER_ADDRESS = 'sam.fixture5693@yale.edu';
const OWNER_NETID = 'sf5693';
const NAMESAKE_NETID = 'sz5693';
const OWNER_ORCID = '9999-9000-9999-9005';
const BACKFILL = 'official-profile-pi-backfill';

const observe = (
  entityType: 'user' | 'researchEntity',
  identity: { entityKey?: string; entityId?: mongoose.Types.ObjectId },
  sourceName: string,
  sourceUrl: string,
  fields: Record<string, unknown>,
) =>
  Observation.insertMany(
    Object.entries(fields).map(([field, value]) => ({
      entityType,
      ...identity,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName,
      sourceUrl,
      confidence: 0.9,
      observedAt: new Date('2026-10-16T00:00:00Z'),
      superseded: false,
      field,
      value,
    })),
  );

describe('a page the directory gives to another netid stops speaking for the namesake (#5693)', () => {
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
    resetDirectoryNetidsByAddressCache();
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'researchers', 'role_assignments', 'research_entities']) {
      await db.collection(name).deleteMany({});
    }
  });

  const seedCorpus = async () => {
    await observe('user', { entityKey: OWNER_NETID }, 'yale-directory', 'https://dir.test/', {
      netid: OWNER_NETID,
      email: OWNER_ADDRESS,
    });
    await observe('user', { entityKey: NAMESAKE_NETID }, 'yale-directory', 'https://dir.test/', {
      netid: NAMESAKE_NETID,
      email: 'samira.ross5693@yale.edu',
    });
    await observe('user', { entityKey: `netid:${NAMESAKE_NETID}` }, BACKFILL, SCHOOL_PAGE, {
      netid: NAMESAKE_NETID,
      email: OWNER_ADDRESS,
    });
    await observe(
      'user',
      { entityKey: 'netid:sam.fixture5693' },
      'ysm-faculty-directory',
      MEDICINE_PAGE,
      { email: OWNER_ADDRESS, orcid: OWNER_ORCID },
    );
    const owner = await Researcher.create({
      displayName: 'Sam Fixture',
      identifiers: { netid: OWNER_NETID },
    });
    const namesake = await Researcher.create({
      displayName: 'Samira Fixture-Ross',
      identifiers: { netid: NAMESAKE_NETID, orcid: OWNER_ORCID },
      profileLinks: [
        {
          kind: 'YALE_OFFICIAL',
          purpose: 'PRIMARY_IDENTITY',
          url: MEDICINE_PAGE,
          verifiedAt: new Date('2026-10-01T00:00:00Z'),
        },
        {
          kind: 'ORCID',
          purpose: 'SCHOLARLY',
          url: `https://orcid.org/${OWNER_ORCID}`,
          verifiedAt: new Date('2026-10-01T00:00:00Z'),
        },
      ],
    });
    return { owner, namesake };
  };

  const seedRowLeadEvidence = async (ownerId: unknown, namesakeId: unknown) => {
    const entityId = new mongoose.Types.ObjectId();
    await observe('researchEntity', { entityId }, BACKFILL, SCHOOL_PAGE, {
      inferredPiUserId: String(namesakeId),
    });
    await observe('researchEntity', { entityId }, BACKFILL, SCHOOL_PAGE, {
      inferredPiUserId: String(ownerId),
    });
    await RoleAssignment.create({
      personId: namesakeId,
      target: { kind: 'RESEARCH_ENTITY', id: entityId },
      role: 'PI',
      confidence: 0.88,
      rosterProvenance: { sourceName: BACKFILL, sourceUrl: SCHOOL_PAGE },
    });
    return entityId;
  };

  const rowObservations = (entityId: mongoose.Types.ObjectId) =>
    Observation.find({ entityType: 'researchEntity', entityId }).lean();

  const leadEdges = async (entityId: mongoose.Types.ObjectId) =>
    (
      (await RoleAssignment.find({ 'target.id': entityId, role: 'PI' }).lean()) as Array<{
        personId: unknown;
        state?: string;
      }>
    )
      .map((edge) => `${String(edge.personId)}:${edge.state === 'HISTORICAL' ? 'ended' : 'live'}`)
      .sort();

  it('ends the namesake lead edge the page gave, keeps the owner, and it stays ended on every later pass', async () => {
    const { owner, namesake } = await seedCorpus();
    const entityId = await seedRowLeadEvidence(owner._id, namesake._id);
    const observations = await rowObservations(entityId);

    const planned = await planInferredPiMembership(String(entityId), observations as any[]);
    expect(planned.map((lead) => lead.personId)).toEqual([String(owner._id)]);

    for (let pass = 0; pass < 2; pass += 1) {
      await materializeInferredPiMembership(String(entityId), observations as any[]);
      expect(await leadEdges(entityId)).toEqual(
        [`${String(namesake._id)}:ended`, `${String(owner._id)}:live`].sort(),
      );
    }
  });

  it('does not bring the ended edge back when the whole row is materialized again', async () => {
    const { owner, namesake } = await seedCorpus();
    const row = await ResearchEntity.create({
      slug: 'synthetic-fixture-research',
      name: 'Synthetic Fixture Research',
    });
    const entityId = row._id as mongoose.Types.ObjectId;
    await observe('researchEntity', { entityId }, BACKFILL, SCHOOL_PAGE, {
      name: 'Synthetic Fixture Research',
      inferredPiUserId: String(namesake._id),
    });
    await observe('researchEntity', { entityId }, BACKFILL, SCHOOL_PAGE, {
      inferredPiUserId: String(owner._id),
    });
    await RoleAssignment.create({
      personId: namesake._id,
      target: { kind: 'RESEARCH_ENTITY', id: entityId },
      role: 'PI',
      confidence: 0.88,
      rosterProvenance: { sourceName: BACKFILL, sourceUrl: SCHOOL_PAGE },
    });

    for (let pass = 0; pass < 2; pass += 1) {
      await materializeEntity('researchEntity', { entityId: String(entityId) });
      expect(await leadEdges(entityId)).toEqual(
        [`${String(namesake._id)}:ended`, `${String(owner._id)}:live`].sort(),
      );
    }
  });

  it('withdraws the host-variant link and the copied ORCID from the namesake, on every run', async () => {
    const { namesake } = await seedCorpus();

    const plan = await planScreenedPageWithdrawal(`netid:${NAMESAKE_NETID}`, [SCHOOL_PAGE]);
    expect(plan).toEqual({
      researcherId: String(namesake._id),
      officialLinkUrls: [MEDICINE_PAGE],
      orcid: OWNER_ORCID,
    });

    for (let pass = 0; pass < 2; pass += 1) {
      const result = await materializeEntity('user', { entityKey: `netid:${NAMESAKE_NETID}` });
      expect(result.skipped).toBe('directory-contradicts-profile-netid');
      const after = (await Researcher.findById(namesake._id).lean()) as any;
      expect(after.profileLinks).toEqual([]);
      expect(after.identifiers.orcid).toBeUndefined();
      expect(after.identifiers.netid).toBe(NAMESAKE_NETID);
    }
  });

  it('keeps an ORCID the namesake own page also asserts, and a link the directory places with them', async () => {
    const { namesake } = await seedCorpus();
    const ownPage = 'https://medicine.yale.edu/profile/samira-fixture-ross/';
    await observe(
      'user',
      { entityKey: 'netid:samira.ross5693' },
      'ysm-faculty-directory',
      ownPage,
      {
        email: 'samira.ross5693@yale.edu',
        orcid: OWNER_ORCID,
      },
    );
    await Researcher.updateOne(
      { _id: namesake._id },
      {
        $push: {
          profileLinks: {
            kind: 'YALE_OFFICIAL',
            purpose: 'PRIMARY_IDENTITY',
            url: ownPage,
            verifiedAt: new Date('2026-10-01T00:00:00Z'),
          },
        },
      },
    );

    expect(await planScreenedPageWithdrawal(`netid:${NAMESAKE_NETID}`, [SCHOOL_PAGE])).toEqual({
      researcherId: String(namesake._id),
      officialLinkUrls: [MEDICINE_PAGE],
    });
  });

  it('never screens the page owner stored under an email alias as their netid', async () => {
    const { namesake } = await seedCorpus();
    const aliasTwin = await Researcher.create({
      displayName: 'Sam Fixture',
      identifiers: { netid: 'sam.fixture5693' },
    });
    const entityId = new mongoose.Types.ObjectId();
    await observe('researchEntity', { entityId }, BACKFILL, SCHOOL_PAGE, {
      inferredPiUserId: String(aliasTwin._id),
    });
    await observe('researchEntity', { entityId }, BACKFILL, SCHOOL_PAGE, {
      inferredPiUserId: String(namesake._id),
    });

    const planned = await planInferredPiMembership(
      String(entityId),
      (await rowObservations(entityId)) as any[],
    );
    expect(planned.map((lead) => lead.personId)).toEqual([String(aliasTwin._id)]);
  });

  it('withdraws nothing on a dry run', async () => {
    const { namesake } = await seedCorpus();

    const result = await materializeEntity(
      'user',
      { entityKey: `netid:${NAMESAKE_NETID}` },
      { dryRun: true },
    );

    expect(result).toMatchObject({ skipped: 'directory-contradicts-profile-netid' });
    const after = (await Researcher.findById(namesake._id).lean()) as any;
    expect(after.identifiers.orcid).toBe(OWNER_ORCID);
    expect(after.profileLinks).toHaveLength(2);
  });
});

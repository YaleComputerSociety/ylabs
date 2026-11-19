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
import { Researcher } from '../../models/researcher';
import { syntheticPersonOrcid, withOrcidCheckDigit } from '../../test/syntheticOrcid';
import { resolveOrCreateResearcherIdForIdentity } from '../canonicalMembershipMaterializer';
import { materializeEntity } from '../entityMaterializer';
import { resetOverSharedPersonWebsiteKeysCache } from '../overSharedPersonWebsite';

const YEAR_RUN = '2025-2024-2023-2022';
const ISSN_SHAPED = withOrcidCheckDigit('104973150123456');
const REAL_ORCID = syntheticPersonOrcid(201);

describe('an implausible ORCID derives as absent on every resolve (#5991)', () => {
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
    for (const name of ['observations', 'researchers', 'accounts']) {
      await db.collection(name).deleteMany({});
    }
    resetOverSharedPersonWebsiteKeysCache();
  });

  const ownPage = (slug: string) => `https://medicine.yale.edu/profile/${slug}/`;

  const observation = (
    entityKey: string,
    field: string,
    value: unknown,
    sourceName = 'dept-faculty-roster',
  ) => ({
    entityType: 'user',
    entityKey,
    sourceId: new mongoose.Types.ObjectId(),
    sourceName,
    sourceUrl: ownPage(entityKey.split(':').pop() || 'fixture'),
    confidence: sourceName === 'dept-faculty-roster' ? 0.7 : 0.6,
    observedAt: new Date('2026-11-11T00:00:00Z'),
    superseded: false,
    field,
    value,
  });

  const seedPerson = (entityKey: string, first: string, last: string, extra: object[] = []) =>
    Observation.insertMany([
      observation(entityKey, 'fname', first),
      observation(entityKey, 'lname', last),
      observation(entityKey, 'profileUrls', {
        departmental: ownPage(entityKey.split(':').pop() || ''),
      }),
      ...extra,
    ]);

  const personRecord = (displayName: string, slug: string, orcid?: string) =>
    Researcher.create({
      displayName,
      profile: { title: 'Professor of Fixtures' },
      ...(orcid ? { identifiers: { orcid } } : {}),
      profileLinks: [
        {
          kind: 'YALE_OFFICIAL',
          purpose: 'PRIMARY_IDENTITY',
          url: ownPage(slug),
          verifiedAt: new Date('2026-01-01T00:00:00Z'),
          healthStatus: 'UNKNOWN',
        },
        ...(orcid
          ? [
              {
                kind: 'ORCID',
                purpose: 'SCHOLARLY',
                url: `https://orcid.org/${orcid}`,
                verifiedAt: new Date('2026-01-01T00:00:00Z'),
                healthStatus: 'UNKNOWN',
              },
            ]
          : []),
      ],
      status: 'UNKNOWN',
      archived: false,
    });

  const stored = async (id: unknown) => Researcher.findById(id).lean<any>();
  const orcidLinks = (record: any) =>
    (record?.profileLinks ?? []).filter((link: { kind: string }) => link.kind === 'ORCID');

  it.each([YEAR_RUN, ISSN_SHAPED])(
    'clears a stored %s and its orcid.org link on the next resolve, then writes nothing',
    async (bogus) => {
      const key = 'dept:fixture:avery-quillsby';
      await seedPerson(key, 'Avery', 'Quillsby', [observation(key, 'orcid', bogus)]);
      const holder = await personRecord('Avery Quillsby', 'avery-quillsby', bogus);
      expect((await stored(holder._id)).identifiers.orcid).toBe(bogus);

      const first = await materializeEntity('user', { entityKey: key }, {});
      expect(String(first.entityId)).toBe(String(holder._id));
      const afterFirst = await stored(holder._id);
      expect(afterFirst.identifiers?.orcid).toBeUndefined();
      expect(orcidLinks(afterFirst)).toEqual([]);

      const second = await materializeEntity('user', { entityKey: key }, {});
      expect(second.fieldsWritten).toBe(0);
      expect((await stored(holder._id)).identifiers?.orcid).toBeUndefined();
      expect(afterFirst.manuallyLockedFields).toBeUndefined();
    },
  );

  it('lets a lower-confidence plausible ORCID win over a refused one', async () => {
    const key = 'dept:fixture:blair-quillsby';
    await seedPerson(key, 'Blair', 'Quillsby', [
      observation(key, 'orcid', YEAR_RUN),
      observation(key, 'orcid', REAL_ORCID, 'official-profile-pi-backfill'),
    ]);
    const holder = await personRecord('Blair Quillsby', 'blair-quillsby');

    await materializeEntity('user', { entityKey: key }, {});
    const record = await stored(holder._id);
    expect(record.identifiers?.orcid).toBe(REAL_ORCID);
    expect(orcidLinks(record).map((link: { url: string }) => link.url)).toEqual([
      `https://orcid.org/${REAL_ORCID}`,
    ]);
  });

  it('gives two different people who carry the same year run no shared ORCID', async () => {
    const left = await personRecord('Casey Quillsby', 'casey-quillsby');
    const right = await personRecord('Drew Marchetti', 'drew-marchetti');
    await seedPerson('dept:fixture:casey-quillsby', 'Casey', 'Quillsby', [
      observation('dept:fixture:casey-quillsby', 'orcid', YEAR_RUN),
    ]);
    await seedPerson('dept:fixture:drew-marchetti', 'Drew', 'Marchetti', [
      observation('dept:fixture:drew-marchetti', 'orcid', YEAR_RUN),
    ]);

    const leftResult = await materializeEntity(
      'user',
      { entityKey: 'dept:fixture:casey-quillsby' },
      {},
    );
    const rightResult = await materializeEntity(
      'user',
      { entityKey: 'dept:fixture:drew-marchetti' },
      {},
    );
    expect(String(leftResult.entityId)).toBe(String(left._id));
    expect(String(rightResult.entityId)).toBe(String(right._id));
    expect(await Researcher.countDocuments({ 'identifiers.orcid': YEAR_RUN })).toBe(0);
  });

  it('never resolves two different people to one record through the year run', async () => {
    const first = await resolveOrCreateResearcherIdForIdentity({
      displayName: 'Emery Quillsby',
      orcid: YEAR_RUN,
    });
    const second = await resolveOrCreateResearcherIdForIdentity({
      displayName: 'Finley Marchetti',
      orcid: YEAR_RUN,
    });
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(String(first)).not.toBe(String(second));
    expect(await Researcher.countDocuments({ 'identifiers.orcid': YEAR_RUN })).toBe(0);
  });
});

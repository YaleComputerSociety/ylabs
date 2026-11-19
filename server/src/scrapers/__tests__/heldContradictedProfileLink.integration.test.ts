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
import { materializeEntity } from '../entityMaterializer';
import { resetDirectoryNetidsByAddressCache } from '../directoryContradictedProfileNetid';

const PAGE = 'https://publichealth.yale.edu/profile/sam-fixture/';
const PAGE_EMAIL = 'sam.fixture5737@yale.edu';
const PAGE_PHOTO = 'https://images.example.test/sam-fixture-5737.jpg';
const PAGE_ORCID = '9999-9000-9999-9005';
const OWNER_NETID = 'sf5737';
const HOLDER_NETID = 'hz5737';
const HOLDER_KEY = `netid:${HOLDER_NETID}`;
const OWNER_ALIAS_KEY = 'netid:sam.fixture5737';

const observe = (entityKey: string, sourceName: string, sourceUrl: string, fields: object) =>
  Observation.insertMany(
    Object.entries(fields).map(([field, value]) => ({
      entityType: 'user',
      entityKey,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName,
      sourceUrl,
      confidence: 0.7,
      observedAt: new Date('2026-03-01T00:00:00Z'),
      superseded: false,
      field,
      value,
    })),
  );

describe('a held official link to another netid person page is withdrawn on any resolve (#5737)', () => {
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

  beforeEach(async () => {
    resetDirectoryNetidsByAddressCache();
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'researchers', 'accounts']) {
      await db.collection(name).deleteMany({});
    }
  });

  const seed = async (holderNetid = HOLDER_NETID) => {
    await observe(OWNER_NETID, 'yale-directory', 'https://dir.test/', {
      netid: OWNER_NETID,
      email: PAGE_EMAIL,
    });
    await observe(HOLDER_NETID, 'yale-directory', 'https://dir.test/', {
      netid: HOLDER_NETID,
      email: 'holder.synthetic5737@yale.edu',
    });
    await observe(OWNER_ALIAS_KEY, 'ysm-faculty-directory', PAGE, {
      displayName: 'Sam Fixture',
      email: PAGE_EMAIL,
      orcid: PAGE_ORCID,
      imageUrl: PAGE_PHOTO,
      profileUrls: { official: PAGE },
    });
    await observe(`netid:${holderNetid}`, 'dept-faculty-roster', 'https://dept.test/people/', {
      displayName: 'Sam Fixture',
      netid: holderNetid,
    });
    return Researcher.create({
      displayName: 'Sam Fixture',
      identifiers: { netid: holderNetid, orcid: PAGE_ORCID },
      profile: { imageUrl: PAGE_PHOTO },
      profileLinks: [
        {
          kind: 'YALE_OFFICIAL',
          purpose: 'PRIMARY_IDENTITY',
          url: PAGE,
          verifiedAt: new Date('2026-01-01T00:00:00Z'),
        },
        {
          kind: 'ORCID',
          purpose: 'SCHOLARLY',
          url: `https://orcid.org/${PAGE_ORCID}`,
          verifiedAt: new Date('2026-01-01T00:00:00Z'),
        },
      ],
    });
  };

  const stored = async (id: unknown) =>
    (await Researcher.findById(id).lean()) as {
      identifiers?: { orcid?: string; netid?: string };
      profile?: { imageUrl?: string };
      profileLinks?: Array<{ kind: string; url: string }>;
    } | null;

  it('withdraws the link and what the page alone carried, and a second pass writes nothing', async () => {
    const holder = await seed();

    const first = await materializeEntity('user', { entityKey: HOLDER_KEY });
    expect(first.fieldsWritten).toBeGreaterThan(0);
    const after = await stored(holder._id);
    expect(after?.profileLinks ?? []).toEqual([]);
    expect(after?.identifiers?.orcid).toBeUndefined();
    expect(after?.profile?.imageUrl).toBeUndefined();
    expect(after?.identifiers?.netid).toBe(HOLDER_NETID);

    const second = await materializeEntity('user', { entityKey: HOLDER_KEY });
    expect(second.fieldsWritten).toBe(0);
    expect((await stored(holder._id))?.profileLinks ?? []).toEqual([]);
  });

  it('never lets the page owner key re-stamp the withdrawn values onto the holder', async () => {
    const holder = await seed();

    for (let pass = 0; pass < 2; pass += 1) {
      await materializeEntity('user', { entityKey: HOLDER_KEY });
      await materializeEntity('user', { entityKey: OWNER_ALIAS_KEY });
      const after = await stored(holder._id);
      expect(after?.profileLinks ?? []).toEqual([]);
      expect(after?.identifiers?.orcid).toBeUndefined();
      expect(after?.profile?.imageUrl).toBeUndefined();
    }
  });

  it('does not re-stamp the withdrawn link from a roster that points at the page', async () => {
    const holder = await seed();
    await observe(HOLDER_KEY, 'dept-faculty-roster', 'https://dept.test/people/', {
      profileUrls: { official: PAGE },
    });

    const first = await materializeEntity('user', { entityKey: HOLDER_KEY });
    expect(first.fieldsWritten).toBeGreaterThan(0);
    expect((await stored(holder._id))?.profileLinks ?? []).toEqual([]);

    const second = await materializeEntity('user', { entityKey: HOLDER_KEY });
    expect(second.fieldsWritten).toBe(0);
    expect((await stored(holder._id))?.profileLinks ?? []).toEqual([]);
  });

  it('serves the stored-value lookup from an index rather than a field-wide scan', async () => {
    await seed();
    await Observation.syncIndexes();

    for (const [field, value] of [
      ['orcid', PAGE_ORCID],
      ['imageUrl', PAGE_PHOTO],
    ] as const) {
      const plan = (await Observation.find({
        entityType: 'user',
        field,
        superseded: false,
        value: { $in: [value] },
      }).explain('queryPlanner')) as any;
      const winning = JSON.stringify(plan.queryPlanner?.winningPlan ?? plan[0]?.queryPlanner);
      expect(winning).toContain('field_1_value_1_superseded_1');
    }
  });

  it('withdraws nothing on a dry run', async () => {
    const holder = await seed();

    await materializeEntity('user', { entityKey: HOLDER_KEY }, { dryRun: true });
    const after = await stored(holder._id);
    expect(after?.profileLinks?.map((link) => link.kind).sort()).toEqual([
      'ORCID',
      'YALE_OFFICIAL',
    ]);
    expect(after?.profile?.imageUrl).toBe(PAGE_PHOTO);
  });

  it('keeps the page on a holder whose stored netid the directory does not hold', async () => {
    const holder = await seed('sam.fixture5737');

    await materializeEntity('user', { entityKey: 'netid:sam.fixture5737' });
    const after = await stored(holder._id);
    expect(after?.profileLinks?.some((link) => link.url === PAGE)).toBe(true);
    expect(after?.profile?.imageUrl).toBe(PAGE_PHOTO);
  });
});

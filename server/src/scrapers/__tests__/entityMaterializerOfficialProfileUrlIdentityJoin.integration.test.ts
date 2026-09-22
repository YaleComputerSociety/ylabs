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
import { Account } from '../../models/account';
import { materializeEntity } from '../entityMaterializer';

const PROFILE_PAGE = 'https://medicine.yale.edu/profile/the-observed-person/';

describe('materializeEntity joins a user key on the official profile page it cites (#2325)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'researchers', 'accounts']) {
      await db.collection(name).deleteMany({});
    }
  });

  const observationBase = (entityKey: string) => ({
    entityType: 'user' as const,
    entityKey,
    sourceId: new mongoose.Types.ObjectId(),
    sourceName: 'dept-faculty-roster',
    sourceUrl: 'https://medicine.yale.edu/people/',
    confidence: 0.7,
    observedAt: new Date('2026-03-01T00:00:00Z'),
    superseded: false,
  });

  const seedRosterIdentity = async (
    entityKey: string,
    displayName: string,
    fields: Record<string, unknown> = {},
  ) => {
    const base = observationBase(entityKey);
    for (const [field, value] of Object.entries({ displayName, ...fields })) {
      await Observation.create({ ...base, field, value });
    }
  };

  const yaleOfficialLink = (url: string) => ({
    kind: 'YALE_OFFICIAL' as const,
    purpose: 'PRIMARY_IDENTITY' as const,
    url,
    verifiedAt: new Date('2026-01-01T00:00:00Z'),
    healthStatus: 'UNKNOWN' as const,
  });

  const storedProfile = async (id: unknown) =>
    Researcher.findById(id).lean<{
      displayName?: string;
      profile?: { title?: string; primaryDepartment?: string };
    }>();

  it('resolves a key the name resolver calls ambiguous, by the page only one researcher carries', async () => {
    // Two live researchers share the name, so the name resolver must refuse. Only one
    // carries the page the observation cites.
    const owner = await Researcher.create({
      displayName: 'Jane Smith',
      profileLinks: [yaleOfficialLink(PROFILE_PAGE)],
      status: 'UNKNOWN',
      archived: false,
    });
    const namesake = await Researcher.create({
      displayName: 'Jane Smith',
      profileLinks: [],
      status: 'UNKNOWN',
      archived: false,
    });
    await seedRosterIdentity('dept:internal-medicine:jane-smith', 'Jane Smith', {
      title: 'Associate Professor of Medicine',
      primaryDepartment: 'Internal Medicine',
      profileUrls: { official: PROFILE_PAGE },
    });

    const result = await materializeEntity(
      'user',
      { entityKey: 'dept:internal-medicine:jane-smith' },
      {},
    );

    expect(result.skipped).toBeUndefined();
    expect(String(result.entityId)).toBe(String(owner._id));
    const enriched = await storedProfile(owner._id);
    expect(enriched?.profile?.title).toBe('Associate Professor of Medicine');
    expect(enriched?.profile?.primaryDepartment).toBe('Internal Medicine');
    const untouched = await storedProfile(namesake._id);
    expect(untouched?.profile?.title).toBeUndefined();
  });

  it('matches the page across scheme, www, trailing slash and a tracking query', async () => {
    const owner = await Researcher.create({
      displayName: 'Ada Lovelace',
      profileLinks: [yaleOfficialLink('https://www.medicine.yale.edu/Profile/Ada-Lovelace')],
      status: 'UNKNOWN',
      archived: false,
    });
    await Researcher.create({
      displayName: 'Ada Lovelace',
      profileLinks: [],
      status: 'UNKNOWN',
      archived: false,
    });
    await seedRosterIdentity('dept:computing:ada-lovelace', 'Ada Lovelace', {
      title: 'Professor of Computing',
      profileUrls: { official: 'http://medicine.yale.edu/profile/ada-lovelace/?utm_source=roster' },
    });

    await materializeEntity('user', { entityKey: 'dept:computing:ada-lovelace' }, {});

    expect((await storedProfile(owner._id))?.profile?.title).toBe('Professor of Computing');
  });

  it('refuses when two live researchers carry the same page, rather than picking one', async () => {
    const first = await Researcher.create({
      displayName: 'Chris Taylor',
      profileLinks: [yaleOfficialLink(PROFILE_PAGE)],
      status: 'UNKNOWN',
      archived: false,
    });
    const second = await Researcher.create({
      displayName: 'Chris Taylor',
      profileLinks: [yaleOfficialLink(PROFILE_PAGE)],
      status: 'UNKNOWN',
      archived: false,
    });
    await seedRosterIdentity('dept:surgery:chris-taylor', 'Chris Taylor', {
      title: 'Professor of Surgery',
      profileUrls: { official: PROFILE_PAGE },
    });

    const result = await materializeEntity('user', { entityKey: 'dept:surgery:chris-taylor' }, {});

    expect(result.skipped).toBe('directory-identity-without-research-signal');
    expect((await storedProfile(first._id))?.profile?.title).toBeUndefined();
    expect((await storedProfile(second._id))?.profile?.title).toBeUndefined();
  });

  it('refuses when the observed name contradicts the page owner, so a borrowed page cannot graft', async () => {
    const pageOwner = await Researcher.create({
      displayName: 'Robert Green',
      profileLinks: [yaleOfficialLink(PROFILE_PAGE)],
      status: 'UNKNOWN',
      archived: false,
    });
    await seedRosterIdentity('dept:history:alice-brown', 'Alice Brown', {
      title: 'Professor of History',
      profileUrls: { official: PROFILE_PAGE },
    });

    const result = await materializeEntity('user', { entityKey: 'dept:history:alice-brown' }, {});

    expect(result.skipped).toBe('directory-identity-without-research-signal');
    expect((await storedProfile(pageOwner._id))?.profile?.title).toBeUndefined();
  });

  it('ignores a lab page a group shares, because only YALE_OFFICIAL identifies a person', async () => {
    const owner = await Researcher.create({
      displayName: 'Mary Shelley',
      profileLinks: [
        {
          kind: 'LAB_ABOUT' as const,
          purpose: 'PRIMARY_IDENTITY' as const,
          url: PROFILE_PAGE,
          verifiedAt: new Date('2026-01-01T00:00:00Z'),
          healthStatus: 'UNKNOWN' as const,
        },
      ],
      status: 'UNKNOWN',
      archived: false,
    });
    await Researcher.create({
      displayName: 'Mary Shelley',
      profileLinks: [],
      status: 'UNKNOWN',
      archived: false,
    });
    await seedRosterIdentity('dept:english:mary-shelley', 'Mary Shelley', {
      title: 'Professor of English',
      profileUrls: { official: PROFILE_PAGE },
    });

    const result = await materializeEntity('user', { entityKey: 'dept:english:mary-shelley' }, {});

    expect(result.skipped).toBe('directory-identity-without-research-signal');
    expect((await storedProfile(owner._id))?.profile?.title).toBeUndefined();
  });

  it('never renames the researcher: the page vouched for who, not for the spelling', async () => {
    // A roster that shouts the name is a real corpus shape and it agrees with the stored
    // name, so without the rename guard the join would overwrite a clean displayName.
    const owner = await Researcher.create({
      displayName: 'Nathan Wood',
      profileLinks: [yaleOfficialLink(PROFILE_PAGE)],
      status: 'UNKNOWN',
      archived: false,
    });
    await Researcher.create({
      displayName: 'Nathan Wood',
      profileLinks: [],
      status: 'UNKNOWN',
      archived: false,
    });
    await seedRosterIdentity('dept:medicine:nathan-wood', 'NATHAN WOOD', {
      title: 'Professor of Medicine',
      profileUrls: { official: PROFILE_PAGE },
    });

    await materializeEntity('user', { entityKey: 'dept:medicine:nathan-wood' }, {});

    const stored = await storedProfile(owner._id);
    expect(stored?.displayName).toBe('Nathan Wood');
    expect(stored?.profile?.title).toBe('Professor of Medicine');
  });

  it('refuses a nickname the name comparator does not accept, rather than guessing', async () => {
    const owner = await Researcher.create({
      displayName: 'Nathaniel Fielding',
      profileLinks: [yaleOfficialLink(PROFILE_PAGE)],
      status: 'UNKNOWN',
      archived: false,
    });
    await seedRosterIdentity('dept:medicine:nate-fielding', 'Nate Fielding', {
      title: 'Professor of Medicine',
      profileUrls: { official: PROFILE_PAGE },
    });

    const result = await materializeEntity(
      'user',
      { entityKey: 'dept:medicine:nate-fielding' },
      {},
    );

    expect(result.skipped).toBe('directory-identity-without-research-signal');
    expect((await storedProfile(owner._id))?.profile?.title).toBeUndefined();
  });

  it('does not reach the page join when the netid already resolved the person', async () => {
    const account = await Account.create({
      netid: 'ab123',
      email: 'ab123@yale.edu',
      status: 'ACTIVE',
    });
    const real = await Researcher.create({
      displayName: 'Grace Hopper',
      accountId: account._id,
      profileLinks: [],
      status: 'UNKNOWN',
      archived: false,
    });
    const pageOwner = await Researcher.create({
      displayName: 'Grace Hopper',
      profileLinks: [yaleOfficialLink(PROFILE_PAGE)],
      status: 'UNKNOWN',
      archived: false,
    });
    await seedRosterIdentity('netid:ab123', 'Grace Hopper', {
      title: 'Professor of Computing',
      profileUrls: { official: PROFILE_PAGE },
    });

    const result = await materializeEntity('user', { entityKey: 'netid:ab123' }, {});

    expect(String(result.entityId)).toBe(String(real._id));
    expect((await storedProfile(pageOwner._id))?.profile?.title).toBeUndefined();
  });

  it('writes nothing on a dry run, while still reporting what it would write', async () => {
    const account = await Account.create({
      netid: 'cd456',
      email: 'cd456@yale.edu',
      status: 'ACTIVE',
    });
    const researcher = await Researcher.create({
      displayName: 'Alan Turing',
      accountId: account._id,
      profileLinks: [],
      status: 'UNKNOWN',
      archived: false,
    });
    await seedRosterIdentity('netid:cd456', 'Alan Turing', {
      title: 'Professor of Mathematics',
      primaryDepartment: 'Mathematics',
    });

    const result = await materializeEntity('user', { entityKey: 'netid:cd456' }, { dryRun: true });

    expect(result.skipped).toBeUndefined();
    expect(result.fieldsWritten).toBeGreaterThan(0);
    const stored = await storedProfile(researcher._id);
    expect(stored?.profile?.title).toBeUndefined();
    expect(stored?.profile?.primaryDepartment).toBeUndefined();
  });
});

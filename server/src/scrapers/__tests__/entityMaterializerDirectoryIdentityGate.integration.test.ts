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
import { Account } from '../../models/account';
import { materializeEntity } from '../entityMaterializer';

describe('materializeEntity gates directory identity: enrich-only, never mints Account or Researcher', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'researchers', 'accounts']) {
      await db.collection(name).deleteMany({});
    }
  });

  const seedDirectoryIdentity = async (netid: string, fname: string, lname: string) => {
    const base = {
      entityType: 'user' as const,
      entityKey: netid,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'yale-directory',
      sourceUrl: `https://directory.yale.edu/${netid}`,
      confidence: 0.7,
      observedAt: new Date('2026-02-01T00:00:00Z'),
      superseded: false,
    };
    for (const [field, value] of [
      ['netid', netid],
      ['fname', fname],
      ['lname', lname],
      ['email', `${netid}@example.invalid`],
      ['title', 'Professor of Physics'],
    ] as const) {
      await Observation.create({ ...base, field, value });
    }
  };

  it('skips and creates neither Account nor Researcher for a directory-only identity', async () => {
    await seedDirectoryIdentity('phantom1', 'Pat', 'Phantom');

    const result = await materializeEntity('user', { entityKey: 'phantom1' }, {});

    expect(result.created).toBe(false);
    expect(result.skipped).toBe('directory-identity-without-research-signal');
    expect(await Researcher.countDocuments({})).toBe(0);
    expect(await Account.countDocuments({})).toBe(0);
  });

  it('enriches an already-attached researcher and links its existing account without minting', async () => {
    const account = await Account.create({
      netid: 'realpi1',
      email: 'realpi1@yale.edu',
      status: 'ACTIVE',
    });
    const researcher = await Researcher.create({
      displayName: 'Robin Investigator',
      accountId: account._id,
    });

    await seedDirectoryIdentity('realpi1', 'Robin', 'Investigator');

    const result = await materializeEntity('user', { entityKey: 'realpi1' }, {});

    expect(result.created).toBe(false);
    expect(await Researcher.countDocuments({})).toBe(1);
    expect(await Account.countDocuments({})).toBe(1);

    const enriched = await Researcher.findById(researcher._id).lean<{
      profile?: { title?: string };
      accountId?: mongoose.Types.ObjectId;
      identifiers?: { netid?: string };
    }>();
    expect(enriched?.profile?.title).toBe('Professor of Physics');
    expect(String(enriched?.accountId)).toBe(String(account._id));
    expect(enriched?.identifiers?.netid).toBe('realpi1');
  });

  it('does not mint a researcher when an account exists but no researcher backs it', async () => {
    await Account.create({ netid: 'loginonly1', email: 'loginonly1@yale.edu', status: 'ACTIVE' });

    await seedDirectoryIdentity('loginonly1', 'Lee', 'Loginonly');

    const result = await materializeEntity('user', { entityKey: 'loginonly1' }, {});

    expect(result.created).toBe(false);
    expect(result.skipped).toBe('directory-identity-without-research-signal');
    expect(await Researcher.countDocuments({})).toBe(0);
    expect(await Account.countDocuments({})).toBe(1);
  });

  it('yields a colliding ORCID to its existing holder instead of crashing the source', async () => {
    await Researcher.init();
    const sharedOrcid = '9999-9999-9999-9994';

    const holder = await Researcher.create({
      displayName: 'Original Holder',
      identifiers: { orcid: sharedOrcid },
    });

    const account = await Account.create({
      netid: 'collide1',
      email: 'collide1@yale.edu',
      status: 'ACTIVE',
    });
    const enrichTarget = await Researcher.create({
      displayName: 'Collide Investigator',
      accountId: account._id,
    });

    await seedDirectoryIdentity('collide1', 'Collide', 'Investigator');
    await Observation.create({
      entityType: 'user',
      entityKey: 'collide1',
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'yale-directory',
      sourceUrl: 'https://directory.yale.edu/collide1',
      confidence: 0.7,
      observedAt: new Date('2026-02-01T00:00:00Z'),
      superseded: false,
      field: 'orcid',
      value: sharedOrcid,
    });

    await expect(materializeEntity('user', { entityKey: 'collide1' }, {})).resolves.toBeDefined();

    const enriched = await Researcher.findById(enrichTarget._id).lean<{
      profile?: { title?: string };
      identifiers?: { netid?: string; orcid?: string };
      profileLinks?: Array<{ kind: string }>;
    }>();
    expect(enriched?.profile?.title).toBe('Professor of Physics');
    expect(enriched?.identifiers?.netid).toBe('collide1');
    expect(enriched?.identifiers?.orcid).toBeUndefined();
    expect((enriched?.profileLinks || []).some((link) => link.kind === 'ORCID')).toBe(false);

    const stillHeld = await Researcher.findById(holder._id).lean<{
      identifiers?: { orcid?: string };
    }>();
    expect(stillHeld?.identifiers?.orcid).toBe(sharedOrcid);
    expect(await Researcher.countDocuments({ 'identifiers.orcid': sharedOrcid })).toBe(1);
  });
});

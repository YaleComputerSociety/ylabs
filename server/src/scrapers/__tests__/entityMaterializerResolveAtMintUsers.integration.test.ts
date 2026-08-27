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

import { Observation } from '../../models/observation';
import { User } from '../../models/user';
import { CanonicalAlias } from '../../models/canonicalAlias';
import { materializeEntity } from '../entityMaterializer';

const SHARED_ORCID = '1111-2222-3333-4444';

async function seedUser(entityKey: string, netid: string, email: string): Promise<void> {
  const sourceId = new mongoose.Types.ObjectId();
  const fields: Array<[string, string]> = [
    ['netid', netid],
    ['email', email],
    ['fname', 'Jayne'],
    ['lname', 'Testerson'],
    ['orcid', SHARED_ORCID],
  ];
  for (const [field, value] of fields) {
    await Observation.create({
      entityType: 'user',
      entityKey,
      field,
      value,
      sourceId,
      sourceName: 'synthetic-directory',
      confidence: 0.9,
      observedAt: new Date(),
      superseded: false,
    });
  }
}

describe('resolve-at-mint for users (C4_RESOLVE_AT_MINT_USERS)', () => {
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
    delete process.env.C4_RESOLVE_AT_MINT_USERS;
    vi.clearAllMocks();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'users', 'canonical_aliases']) {
      await db.collection(name).deleteMany({});
    }
  });

  // Distinct netids AND distinct emails, shared ORCID only: findEntityDocByIdentifier
  // already dedupes on netid and on a single email match, so ORCID is the one key
  // that isolates the resolver's new contribution from existing behavior.
  it('flag OFF: users sharing only an ORCID mint two rows (unchanged behavior)', async () => {
    delete process.env.C4_RESOLVE_AT_MINT_USERS;
    await seedUser('user-a', 'jtest1', 'jayne.a@example.edu');
    await materializeEntity('user', { entityKey: 'user-a' });
    await seedUser('user-b', 'jtest2', 'jayne.b@example.edu');
    await materializeEntity('user', { entityKey: 'user-b' });

    expect(await User.countDocuments({})).toBe(2);
    expect(await CanonicalAlias.countDocuments({})).toBe(0);
  });

  it('flag ON: a user sharing only an ORCID resolves to the canonical instead of minting a second', async () => {
    process.env.C4_RESOLVE_AT_MINT_USERS = 'true';
    await seedUser('user-a', 'jtest1', 'jayne.a@example.edu');
    const first = await materializeEntity('user', { entityKey: 'user-a' });

    await seedUser('user-b', 'jtest2', 'jayne.b@example.edu');
    const second = await materializeEntity('user', { entityKey: 'user-b' });

    expect(await User.countDocuments({})).toBe(1);
    expect(second.created).toBe(false);
    expect(second.entityId).toBe(first.entityId);

    const orcidAlias = await CanonicalAlias.findOne({ type: 'user', aliasNs: 'orcid' }).lean();
    expect(orcidAlias).not.toBeNull();
    expect(String((orcidAlias as { canonicalId: unknown }).canonicalId)).toBe(first.entityId);
  });
});

import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { CanonicalAlias } from '../../models/canonicalAlias';
import { recordCanonicalAlias, resolveCanonicalAlias } from '../canonicalAliasService';

describe('canonical-alias resolve-at-mint against a real store', () => {
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
    for (const name of ['research_entities', 'users', 'canonical_aliases']) {
      await db.collection(name).deleteMany({});
    }
  });

  afterEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['research_entities', 'users', 'canonical_aliases']) {
      await db.collection(name).deleteMany({});
    }
  });

  const insertEntity = async (doc: Record<string, unknown>) => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    await db.collection('research_entities').insertOne(doc);
  };

  it('resolves an alias to its live canonical record before minting a duplicate', async () => {
    const canonicalId = new mongoose.Types.ObjectId();
    await insertEntity({ _id: canonicalId, slug: 'roe-lab', archived: false });

    await recordCanonicalAlias({
      type: 'researchEntity',
      aliasNs: 'slug',
      aliasValue: 'old-roe-lab-slug',
      canonicalType: 'researchEntity',
      canonicalId,
      reason: 'backfill_research_entity_redirect',
    });

    const resolved = await resolveCanonicalAlias('researchEntity', 'slug', 'old-roe-lab-slug');
    expect(resolved?.toHexString()).toBe(canonicalId.toHexString());
  });

  it('still resolves after the merged loser record is deleted (delete-safe)', async () => {
    const canonicalId = new mongoose.Types.ObjectId();
    const loserId = new mongoose.Types.ObjectId();
    await insertEntity({ _id: canonicalId, slug: 'survivor', archived: false });

    await recordCanonicalAlias({
      type: 'researchEntity',
      aliasNs: 'id',
      aliasValue: loserId.toHexString(),
      canonicalType: 'researchEntity',
      canonicalId,
    });

    const resolvedWhilePresent = await resolveCanonicalAlias(
      'researchEntity',
      'id',
      loserId.toHexString(),
    );
    expect(resolvedWhilePresent?.toHexString()).toBe(canonicalId.toHexString());

    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    await db.collection('research_entities').deleteOne({ _id: loserId });

    const resolvedAfterDelete = await resolveCanonicalAlias(
      'researchEntity',
      'id',
      loserId.toHexString(),
    );
    expect(resolvedAfterDelete?.toHexString()).toBe(canonicalId.toHexString());
  });

  it('follows a re-key chain off an archived canonical to the live survivor', async () => {
    const archivedId = new mongoose.Types.ObjectId();
    const survivorId = new mongoose.Types.ObjectId();
    await insertEntity({
      _id: archivedId,
      slug: 'archived-lab',
      archived: true,
      canonicalGroupId: survivorId,
    });
    await insertEntity({ _id: survivorId, slug: 'survivor-lab', archived: false });

    await recordCanonicalAlias({
      type: 'researchEntity',
      aliasNs: 'slug',
      aliasValue: 'legacy-slug',
      canonicalType: 'researchEntity',
      canonicalId: archivedId,
    });

    const resolved = await resolveCanonicalAlias('researchEntity', 'slug', 'legacy-slug');
    expect(resolved?.toHexString()).toBe(survivorId.toHexString());
  });

  it('returns null (never a dangling id) when the canonical is archived with no survivor', async () => {
    const archivedId = new mongoose.Types.ObjectId();
    await insertEntity({ _id: archivedId, slug: 'dead-end', archived: true });

    await recordCanonicalAlias({
      type: 'researchEntity',
      aliasNs: 'slug',
      aliasValue: 'dead-end-alias',
      canonicalType: 'researchEntity',
      canonicalId: archivedId,
    });

    const resolved = await resolveCanonicalAlias('researchEntity', 'slug', 'dead-end-alias');
    expect(resolved).toBeNull();
  });

  it('normalizes orcid on write and read so a differently-cased lookup still hits', async () => {
    const canonicalId = new mongoose.Types.ObjectId();
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    await db
      .collection('researchers')
      .insertOne({ _id: canonicalId, displayName: 'Jane Researcher', archived: false });

    await recordCanonicalAlias({
      type: 'researcher',
      aliasNs: 'orcid',
      aliasValue: '0000-0002-1825-009x',
      canonicalType: 'researcher',
      canonicalId,
    });

    const storedValue = await CanonicalAlias.findOne({ type: 'researcher', aliasNs: 'orcid' })
      .select('aliasValue')
      .lean<{ aliasValue?: string }>();
    expect(storedValue?.aliasValue).toBe('0000-0002-1825-009X');

    const resolved = await resolveCanonicalAlias('researcher', 'orcid', '  0000-0002-1825-009X  ');
    expect(resolved?.toHexString()).toBe(canonicalId.toHexString());
  });

  it('is idempotent: re-recording the same alias updates in place without a duplicate row', async () => {
    const first = new mongoose.Types.ObjectId();
    const second = new mongoose.Types.ObjectId();
    await insertEntity({ _id: first, slug: 'a', archived: false });
    await insertEntity({ _id: second, slug: 'b', archived: false });

    await recordCanonicalAlias({
      type: 'researchEntity',
      aliasNs: 'id',
      aliasValue: 'shared-loser',
      canonicalType: 'researchEntity',
      canonicalId: first,
    });
    await recordCanonicalAlias({
      type: 'researchEntity',
      aliasNs: 'id',
      aliasValue: 'shared-loser',
      canonicalType: 'researchEntity',
      canonicalId: second,
    });

    expect(
      await CanonicalAlias.countDocuments({
        type: 'researchEntity',
        aliasNs: 'id',
        aliasValue: 'shared-loser',
      }),
    ).toBe(1);
    const resolved = await resolveCanonicalAlias('researchEntity', 'id', 'shared-loser');
    expect(resolved?.toHexString()).toBe(second.toHexString());
  });
});

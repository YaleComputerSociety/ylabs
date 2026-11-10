import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Account, PRODUCT_ANALYTICS_ID_PATTERN } from '../../models/account';
import {
  ensureProductAnalyticsId,
  findNetidForProductAnalyticsId,
} from '../productAnalyticsIdentityService';

describe('product analytics identity (integration)', () => {
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
    await mongoose.connection.db!.collection('accounts').deleteMany({});
  });

  it('assigns a random version 4 UUID once and returns the same one on every later check', async () => {
    await Account.create({ netid: 'test123', email: 'test123@yale.edu' });

    const first = await ensureProductAnalyticsId('test123');
    const second = await ensureProductAnalyticsId('TEST123');

    expect(first).toMatch(PRODUCT_ANALYTICS_ID_PATTERN);
    expect(second).toBe(first);
    expect(first).not.toContain('test123');
  });

  it('gives two parallel first checks one id', async () => {
    await Account.create({ netid: 'test123', email: 'test123@yale.edu' });

    const ids = await Promise.all(
      Array.from({ length: 6 }, () => ensureProductAnalyticsId('test123')),
    );
    const stored = await Account.findOne({ netid: 'test123' }).lean();

    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toBe((stored as { productAnalyticsId?: string }).productAnalyticsId);
  });

  it('gives different accounts different ids and resolves each id back to its own netid', async () => {
    await Account.create({ netid: 'test123', email: 'test123@yale.edu' });
    await Account.create({ netid: 'test456', email: 'test456@yale.edu' });

    const one = await ensureProductAnalyticsId('test123');
    const two = await ensureProductAnalyticsId('test456');

    expect(one).not.toBe(two);
    expect(await findNetidForProductAnalyticsId(one!)).toBe('test123');
    expect(await findNetidForProductAnalyticsId(two!)).toBe('test456');
    expect(await findNetidForProductAnalyticsId('3f2b6c1e-8d4a-4f0b-9c7e-2a1d5e6f7a8b')).toBeNull();
  });

  it('assigns no id for a missing or archived account', async () => {
    await Account.create({ netid: 'test456', email: 'test456@yale.edu', archived: true });

    expect(await ensureProductAnalyticsId('test123')).toBeNull();
    expect(await ensureProductAnalyticsId('test456')).toBeNull();
    expect(await Account.countDocuments({ productAnalyticsId: { $exists: true } })).toBe(0);
  });
});

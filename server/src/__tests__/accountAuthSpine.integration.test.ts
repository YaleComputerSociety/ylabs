import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Account } from '../models/account';
import { recordAccountLogin, validateAccount } from '../services/accountService';
import passport from '../passport';

const deserializePrincipal = async (stored: unknown) => {
  const deserializer = (passport as any)._deserializers[0];
  return new Promise<{ error: unknown; user: any }>((resolve) => {
    deserializer(stored, (error: unknown, user: any) => resolve({ error, user }));
  });
};

describe('Account-backed auth spine (integration)', () => {
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
    await db.collection('accounts').deleteMany({});
    await db.collection('admin_grants').deleteMany({});
  });

  afterEach(() => {
    delete process.env.LOCAL_AUTH_BYPASS;
  });

  it('creates a lowercased ACTIVE Account and stamps lastLoginAt on first login', async () => {
    const before = Date.now();
    const account = await recordAccountLogin({ netid: 'AbC123' });

    expect(account).toMatchObject({
      netid: 'abc123',
      email: 'abc123@yale.edu',
      status: 'ACTIVE',
      archived: false,
    });
    expect(account.lastLoginAt).toBeInstanceOf(Date);
    expect(account.lastLoginAt!.getTime()).toBeGreaterThanOrEqual(before);

    const stored = await Account.countDocuments({ netid: 'abc123' });
    expect(stored).toBe(1);
  });

  it('is idempotent across logins: one row, refreshed lastLoginAt, original email kept', async () => {
    const first = await recordAccountLogin({ netid: 'planner1', email: 'planner1@example.invalid' });
    const second = await recordAccountLogin({ netid: 'planner1', email: 'ignored@example.invalid' });

    expect(await Account.countDocuments({ netid: 'planner1' })).toBe(1);
    expect(second.email).toBe('planner1@example.invalid');
    expect(second.lastLoginAt!.getTime()).toBeGreaterThanOrEqual(first.lastLoginAt!.getTime());
  });

  it('validateAccount resolves a known account and returns null for an unknown netid', async () => {
    await recordAccountLogin({ netid: 'known1' });

    expect(await validateAccount('KNOWN1')).toMatchObject({ netid: 'known1', archived: false });
    expect(await validateAccount('missing1')).toBeNull();
  });

  it('deserializes a live Account session principal and preserves its classified type', async () => {
    await recordAccountLogin({ netid: 'grad1' });

    const { error, user } = await deserializePrincipal({
      netId: 'grad1',
      userType: 'graduate',
      userConfirmed: true,
      profileVerified: false,
    });

    expect(error).toBeNull();
    expect(user).toMatchObject({
      netId: 'grad1',
      userType: 'graduate',
      userConfirmed: true,
      profileVerified: false,
    });
  });

  it('deserializes an archived Account session to unauthenticated', async () => {
    await recordAccountLogin({ netid: 'gone1' });
    await Account.updateOne({ netid: 'gone1' }, { $set: { archived: true } });

    const { error, user } = await deserializePrincipal({
      netId: 'gone1',
      userType: 'graduate',
      userConfirmed: true,
      profileVerified: false,
    });

    expect(error).toBeNull();
    expect(user).toBeNull();
  });

  it('deserializes a session with no backing Account to unauthenticated', async () => {
    const { error, user } = await deserializePrincipal({
      netId: 'neverlogged',
      userType: 'graduate',
      userConfirmed: true,
      profileVerified: false,
    });

    expect(error).toBeNull();
    expect(user).toBeNull();
  });
});

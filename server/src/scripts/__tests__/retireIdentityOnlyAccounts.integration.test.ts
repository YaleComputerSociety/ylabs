import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  RETIRE_CONFIRM_FLAG,
  assertDevelopmentTarget,
  parseRetireIdentityOnlyAccountsArgs,
} from '../retireIdentityOnlyAccounts';
import {
  applyIdentityOnlyAccountRetirement,
  planIdentityOnlyAccountRetirement,
} from '../retireIdentityOnlyAccountsCore';

describe('accounts:retire-identity-only', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  const db = () => {
    const handle = mongoose.connection.db;
    if (!handle) throw new Error('no db');
    return handle;
  };

  beforeEach(async () => {
    for (const name of [
      'accounts',
      'researchers',
      'research_plans',
      'research_entities',
      'fellowships',
      'admin_grants',
    ])
      await db().collection(name).deleteMany({});
  });

  const account = async (fields: Record<string, unknown>) => {
    const _id = new mongoose.Types.ObjectId();
    await db()
      .collection('accounts')
      .insertOne({ _id, archived: false, ...fields });
    return _id;
  };

  const researcher = async (fields: Record<string, unknown>) => {
    const _id = new mongoose.Types.ObjectId();
    await db()
      .collection('researchers')
      .insertOne({ _id, displayName: 'Synthetic', archived: false, ...fields });
    return _id;
  };

  const retire = async () => {
    const plan = await planIdentityOnlyAccountRetirement(db());
    return { plan, result: await applyIdentityOnlyAccountRetirement(db(), plan) };
  };

  it('needs --apply and the confirmation flag together, and Development as the target', () => {
    expect(parseRetireIdentityOnlyAccountsArgs([])).toEqual({ apply: false, confirm: false });
    expect(() => parseRetireIdentityOnlyAccountsArgs(['--apply'])).toThrow(RETIRE_CONFIRM_FLAG);
    expect(parseRetireIdentityOnlyAccountsArgs(['--apply', RETIRE_CONFIRM_FLAG]).apply).toBe(true);
    expect(() => assertDevelopmentTarget('cluster.example/Prod')).toThrow();
    expect(() => assertDevelopmentTarget('cluster.example/Development')).not.toThrow();
  });

  it('deletes a never-signed-in account, unlinks its researcher, and keeps the identity on it', async () => {
    const accountId = await account({
      netid: 'qq801',
      email: 'qq801@example.test',
      status: 'UNKNOWN',
    });
    const researcherId = await researcher({ accountId });

    const { result } = await retire();

    expect(result.accountsDeleted).toBe(1);
    expect(await db().collection('accounts').countDocuments({})).toBe(0);
    const stored = await db().collection('researchers').findOne({ _id: researcherId });
    expect(stored?.accountId).toBeUndefined();
    expect(stored?.identifiers).toEqual({ netid: 'qq801', email: 'qq801@example.test' });
  });

  it('keeps every login account and its link', async () => {
    const accountId = await account({
      netid: 'qq802',
      email: 'qq802@example.test',
      lastLoginAt: new Date(),
    });
    const researcherId = await researcher({ accountId });

    const { plan } = await retire();

    expect(plan.loginAccountsKept).toBe(1);
    expect(await db().collection('accounts').countDocuments({ _id: accountId })).toBe(1);
    expect(
      (await db().collection('researchers').findOne({ _id: researcherId }))?.accountId,
    ).toEqual(accountId);
  });

  it('holds an account a plan, a reviewer stamp or an admin grant names', async () => {
    const planned = await account({ netid: 'qq803' });
    await db().collection('research_plans').insertOne({ accountId: planned });
    const reviewer = await account({ netid: 'qq804' });
    await db()
      .collection('research_entities')
      .insertOne({ studentVisibilityReviewedByAccountId: reviewer });
    await account({ netid: 'qq805' });
    await db().collection('admin_grants').insertOne({ netid: 'qq805', status: 'ACTIVE' });

    const { plan, result } = await retire();

    expect(plan.held).toMatchObject({ 'research-plan': 1, 'reviewer-stamp': 1, 'admin-grant': 1 });
    expect(result.accountsDeleted).toBe(0);
    expect(await db().collection('accounts').countDocuments({})).toBe(3);
  });

  it('holds an account whose researcher holds a different netid, or whose netid another researcher holds', async () => {
    const mismatched = await account({ netid: 'qq806' });
    await researcher({ accountId: mismatched, identifiers: { netid: 'qq899' } });
    const contested = await account({ netid: 'qq807' });
    await researcher({ accountId: contested });
    await researcher({ identifiers: { netid: 'qq807' } });

    const { plan } = await retire();

    expect(plan.held['researcher-holds-another-netid']).toBe(1);
    expect(plan.held['netid-held-by-another-researcher']).toBe(1);
    expect(await db().collection('accounts').countDocuments({})).toBe(2);
  });

  it('copies identity onto an archived linked researcher and skips a placeholder email', async () => {
    const accountId = await account({ netid: 'qq808', email: 'qq808@example.invalid' });
    const researcherId = await researcher({ accountId, archived: true });

    await retire();

    const stored = await db().collection('researchers').findOne({ _id: researcherId });
    expect(stored?.identifiers).toEqual({ netid: 'qq808' });
    expect(stored?.accountId).toBeUndefined();
  });
});

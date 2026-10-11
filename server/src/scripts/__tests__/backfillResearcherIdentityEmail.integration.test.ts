import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  applyResearcherIdentityEmailBackfill,
  copyableAccountEmail,
  parseBackfillResearcherIdentityEmailArgs,
  planResearcherIdentityEmailBackfill,
} from '../backfillResearcherIdentityEmail';

describe('researchers:backfill-identity-email', () => {
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
    for (const name of ['accounts', 'researchers']) await db().collection(name).deleteMany({});
  });

  const seed = async (
    accountEmail: string | undefined,
    researcher: Record<string, unknown> = {},
  ) => {
    const accountId = new mongoose.Types.ObjectId();
    await db()
      .collection('accounts')
      .insertOne({
        _id: accountId,
        netid: 'zz1',
        ...(accountEmail ? { email: accountEmail } : {}),
      });
    const researcherId = new mongoose.Types.ObjectId();
    await db()
      .collection('researchers')
      .insertOne({
        _id: researcherId,
        displayName: 'Synthetic',
        accountId,
        archived: false,
        ...researcher,
      });
    return researcherId;
  };

  const storedEmail = async (researcherId: mongoose.Types.ObjectId) =>
    (await db().collection('researchers').findOne({ _id: researcherId }))?.identifiers?.email;

  it('is a dry run unless --apply is passed', () => {
    expect(parseBackfillResearcherIdentityEmailArgs([])).toEqual({ apply: false });
    expect(parseBackfillResearcherIdentityEmailArgs(['--apply'])).toEqual({ apply: true });
    expect(() => parseBackfillResearcherIdentityEmailArgs(['--force'])).toThrow();
  });

  it('copies a linked account email onto the researcher, normalized', async () => {
    const researcherId = await seed('  Synthetic.Person@Example.TEST ');

    const plan = await planResearcherIdentityEmailBackfill(db());
    expect(plan.updates).toHaveLength(1);
    expect(await applyResearcherIdentityEmailBackfill(db(), plan)).toBe(1);

    expect(await storedEmail(researcherId)).toBe('synthetic.person@example.test');
  });

  it('never overwrites an email the researcher already holds', async () => {
    const researcherId = await seed('account@example.test', {
      identifiers: { email: 'kept@example.test' },
    });

    const plan = await planResearcherIdentityEmailBackfill(db());
    await applyResearcherIdentityEmailBackfill(db(), plan);

    expect(plan.alreadyHoldEmail).toBe(1);
    expect(await storedEmail(researcherId)).toBe('kept@example.test');
  });

  it('skips placeholder, missing and dangling account emails, and archived researchers', async () => {
    await seed('zz1@example.invalid');
    await seed(undefined);
    await seed('archived@example.test', { archived: true });
    await db().collection('researchers').insertOne({
      displayName: 'Dangling',
      accountId: new mongoose.Types.ObjectId(),
      archived: false,
    });

    const plan = await planResearcherIdentityEmailBackfill(db());

    expect(plan.updates).toEqual([]);
    expect(plan.accountEmailNotCopyable).toBe(2);
    expect(plan.accountMissing).toBe(1);
    expect(plan.researchersLinkingAnAccount).toBe(3);
  });

  it('is idempotent: a second run plans nothing', async () => {
    await seed('once@example.test');
    await applyResearcherIdentityEmailBackfill(
      db(),
      await planResearcherIdentityEmailBackfill(db()),
    );

    const second = await planResearcherIdentityEmailBackfill(db());

    expect(second.updates).toEqual([]);
    expect(second.alreadyHoldEmail).toBe(1);
  });

  it('refuses a value that is not an email', () => {
    expect(copyableAccountEmail('not-an-email')).toBeNull();
    expect(copyableAccountEmail(42)).toBeNull();
  });
});

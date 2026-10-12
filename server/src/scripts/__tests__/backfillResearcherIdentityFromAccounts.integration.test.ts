import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  applyResearcherIdentityBackfill,
  copyableAccountEmail,
  parseBackfillResearcherIdentityArgs,
  planResearcherIdentityBackfill,
} from '../backfillResearcherIdentityFromAccounts';

describe('researchers:backfill-identity-from-accounts', () => {
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
    account: Record<string, unknown>,
    researcher: Record<string, unknown> = {},
  ) => {
    const accountId = new mongoose.Types.ObjectId();
    await db()
      .collection('accounts')
      .insertOne({ _id: accountId, ...account });
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

  const storedIdentifiers = async (researcherId: mongoose.Types.ObjectId) =>
    (await db().collection('researchers').findOne({ _id: researcherId }))?.identifiers;

  const backfill = async () => {
    const plan = await planResearcherIdentityBackfill(db());
    await applyResearcherIdentityBackfill(db(), plan);
    return plan;
  };

  it('is a dry run unless --apply is passed', () => {
    expect(parseBackfillResearcherIdentityArgs([])).toEqual({ apply: false });
    expect(parseBackfillResearcherIdentityArgs(['--apply'])).toEqual({ apply: true });
    expect(() => parseBackfillResearcherIdentityArgs(['--force'])).toThrow();
  });

  it('copies a linked account netid and email onto the researcher, normalized', async () => {
    const researcherId = await seed({ netid: ' QQ901 ', email: ' Synthetic.Person@Example.TEST ' });

    const plan = await backfill();

    expect(plan.email.planned).toBe(1);
    expect(plan.netid.planned).toBe(1);
    expect(await storedIdentifiers(researcherId)).toEqual({
      netid: 'qq901',
      email: 'synthetic.person@example.test',
    });
  });

  it('never overwrites a value the researcher already holds', async () => {
    const researcherId = await seed(
      { netid: 'qq902', email: 'account@example.test' },
      { identifiers: { netid: 'kept', email: 'kept@example.test' } },
    );

    const plan = await backfill();

    expect(plan.email.alreadyHeld).toBe(1);
    expect(plan.netid.alreadyHeld).toBe(1);
    expect(await storedIdentifiers(researcherId)).toEqual({
      netid: 'kept',
      email: 'kept@example.test',
    });
  });

  it('skips a netid another researcher already holds but still copies the email', async () => {
    await db()
      .collection('researchers')
      .insertOne({ displayName: 'Holder', identifiers: { netid: 'qq903' }, archived: false });
    const researcherId = await seed({ netid: 'qq903', email: 'second@example.test' });

    const plan = await backfill();

    expect(plan.netid.heldByAnotherResearcher).toBe(1);
    expect(await storedIdentifiers(researcherId)).toEqual({ email: 'second@example.test' });
  });

  it('skips placeholder and missing values, dangling accounts, and archived researchers', async () => {
    await seed({ netid: 'qq904', email: 'qq904@example.invalid' });
    await seed({});
    await seed({ netid: 'qq905', email: 'archived@example.test' }, { archived: true });
    await db().collection('researchers').insertOne({
      displayName: 'Dangling',
      accountId: new mongoose.Types.ObjectId(),
      archived: false,
    });

    const plan = await planResearcherIdentityBackfill(db());

    expect(plan.researchersLinkingAnAccount).toBe(3);
    expect(plan.accountMissing).toBe(1);
    expect(plan.email.notCopyable).toBe(2);
    expect(plan.netid.notCopyable).toBe(1);
    expect(plan.netid.planned).toBe(1);
    expect(plan.email.planned).toBe(0);
  });

  it('is idempotent: a second run plans nothing', async () => {
    await seed({ netid: 'qq906', email: 'once@example.test' });
    await backfill();

    const second = await planResearcherIdentityBackfill(db());

    expect(second.updates).toEqual([]);
    expect(second.email.alreadyHeld).toBe(1);
    expect(second.netid.alreadyHeld).toBe(1);
  });

  it('refuses a value that is not an email', () => {
    expect(copyableAccountEmail('not-an-email')).toBeNull();
    expect(copyableAccountEmail(42)).toBeNull();
  });
});

import { MongoClient, ObjectId, type Db } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applySync,
  buildPlan,
  collectionsForOptions,
  researchPersonAccountIds,
  syncCountMismatches,
  type BetaToDevelopmentOptions,
} from '../syncBetaToDevelopment';

const researcherAccountId = new ObjectId('68f2000000000000000000a1');
const roundTrippedLoginId = new ObjectId('68f2000000000000000000a2');
const targetOnlyLoginId = new ObjectId('68f2000000000000000000a3');
const researcherId = new ObjectId('68f2000000000000000000b1');
const lastLoginAt = new Date('2026-09-20T12:00:00Z');
const pseudonym = `mirrored-${roundTrippedLoginId.toHexString()}`;

async function seedSource(sourceDb: Db): Promise<void> {
  await sourceDb.collection('accounts').insertMany([
    {
      _id: researcherAccountId,
      schemaVersion: 1,
      netid: 'fixture-researcher',
      email: 'fixture-researcher@yale.edu',
      status: 'ACTIVE',
      archived: false,
    },
    {
      _id: roundTrippedLoginId,
      schemaVersion: 1,
      netid: pseudonym,
      email: `${pseudonym}@example.invalid`,
      status: 'ACTIVE',
      archived: false,
    },
  ]);
  await sourceDb.collection('researchers').insertOne({
    _id: researcherId,
    schemaVersion: 1,
    displayName: 'Synthetic Researcher',
    accountId: researcherAccountId,
    status: 'ACTIVE',
    archived: false,
  });
}

async function seedTarget(targetDb: Db): Promise<void> {
  await targetDb.collection('accounts').insertMany([
    {
      _id: roundTrippedLoginId,
      schemaVersion: 1,
      netid: 'fixture-login-holder',
      email: 'fixture-login-holder@yale.edu',
      status: 'ACTIVE',
      archived: false,
      lastLoginAt,
    },
    {
      _id: targetOnlyLoginId,
      schemaVersion: 1,
      netid: 'fixture-plan-owner',
      email: 'fixture-plan-owner@yale.edu',
      status: 'ACTIVE',
      archived: false,
    },
  ]);
  await targetDb.collection('research_plans').insertMany([
    { accountId: roundTrippedLoginId, target: { kind: 'RESEARCH_ENTITY', id: new ObjectId() } },
    { accountId: targetOnlyLoginId, target: { kind: 'RESEARCH_ENTITY', id: new ObjectId() } },
  ]);
}

describe('a Development/Beta sync carries the target environment login accounts', () => {
  let memoryServer: MongoMemoryServer | undefined;
  let client: MongoClient | undefined;
  let targetDb: Db;
  let verifiedMismatches: unknown[] = [];

  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create({ binary: { version: '8.0.12' } });
    client = new MongoClient(memoryServer.getUri());
    await client.connect();
    const sourceDb = client.db('Beta_sync_carry_source');
    targetDb = client.db('Development_sync_carry_target');
    await seedSource(sourceDb);
    await seedTarget(targetDb);
    const collections = collectionsForOptions(
      { includeObservations: false } as BetaToDevelopmentOptions,
      await researchPersonAccountIds(sourceDb),
    );
    await applySync(sourceDb, targetDb, collections, [], async (carry) => {
      verifiedMismatches = syncCountMismatches(
        await buildPlan(sourceDb, targetDb, collections),
        carry,
      );
    });
  });

  afterAll(async () => {
    await client?.close();
    await memoryServer?.stop();
  });

  it('leaves every research plan owned by an existing account', async () => {
    const accountIds = new Set((await targetDb.collection('accounts').distinct('_id')).map(String));
    const plans = await targetDb.collection('research_plans').find({}).toArray();

    expect(plans).toHaveLength(2);
    expect(plans.filter((plan) => !accountIds.has(String(plan.accountId)))).toEqual([]);
  });

  it('restores a round-tripped login account instead of keeping its pseudonym', async () => {
    const accounts = targetDb.collection('accounts');

    expect(await accounts.findOne({ _id: roundTrippedLoginId })).toMatchObject({
      netid: 'fixture-login-holder',
      lastLoginAt,
    });
    expect(await accounts.countDocuments({ netid: pseudonym })).toBe(0);
  });

  it('keeps a target-only plan owner and verifies the counts it carried', async () => {
    expect(await targetDb.collection('accounts').findOne({ _id: targetOnlyLoginId })).toMatchObject(
      {
        netid: 'fixture-plan-owner',
      },
    );
    expect(verifiedMismatches).toEqual([]);
  });
});

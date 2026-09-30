import { MongoClient, ObjectId, type Db } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyCopy, type PromotionOptions } from '../promoteAcceptedBetaCopy';

const researcherAccountId = new ObjectId('68f1000000000000000000a1');
const productionTwinAccountId = new ObjectId('68f1000000000000000000a2');
const studentAccountId = new ObjectId('68f1000000000000000000a3');
const planOnlyAccountId = new ObjectId('68f1000000000000000000a4');
const staleAccountId = new ObjectId('68f1000000000000000000a5');
const researcherId = new ObjectId('68f1000000000000000000b1');
const lastLoginAt = new Date('2026-09-20T12:00:00Z');

async function seedBeta(betaDb: Db): Promise<void> {
  await betaDb.collection('accounts').insertOne({
    _id: researcherAccountId,
    schemaVersion: 1,
    netid: 'rs111',
    email: 'rs111@yale.edu',
    status: 'ACTIVE',
    archived: false,
  });
  await betaDb.collection('researchers').insertOne({
    _id: researcherId,
    schemaVersion: 1,
    displayName: 'Synthetic Researcher',
    accountId: researcherAccountId,
    status: 'ACTIVE',
    archived: false,
  });
  for (const name of [
    'research_entities',
    'research_entity_relationships',
    'role_assignments',
    'signals',
    'sources',
    'departments',
    'org_units',
    'research_areas',
    'taxonomy_terms',
    'fellowships',
  ]) {
    await betaDb.collection(name).insertOne({ name: `synthetic-${name}` });
  }
}

async function seedProduction(productionDb: Db): Promise<void> {
  await productionDb.collection('accounts').insertMany([
    {
      _id: productionTwinAccountId,
      schemaVersion: 1,
      netid: 'rs111',
      email: 'rs111@yale.edu',
      status: 'ACTIVE',
      archived: false,
      lastLoginAt,
    },
    {
      _id: studentAccountId,
      schemaVersion: 1,
      netid: 'st222',
      email: 'st222@yale.edu',
      status: 'ACTIVE',
      archived: false,
      lastLoginAt,
    },
    {
      _id: planOnlyAccountId,
      schemaVersion: 1,
      netid: 'st333',
      email: 'st333@yale.edu',
      status: 'ACTIVE',
      archived: false,
    },
    {
      _id: staleAccountId,
      schemaVersion: 1,
      netid: 'st444',
      email: 'st444@yale.edu',
      status: 'ACTIVE',
      archived: false,
    },
  ]);
  await productionDb.collection('research_plans').insertMany([
    { accountId: studentAccountId, target: { kind: 'RESEARCH_ENTITY', id: new ObjectId() } },
    { accountId: planOnlyAccountId, target: { kind: 'RESEARCH_ENTITY', id: new ObjectId() } },
    {
      accountId: productionTwinAccountId,
      target: { kind: 'RESEARCH_ENTITY', id: new ObjectId() },
    },
  ]);
}

function promotionOptions(): PromotionOptions {
  return {
    mode: 'apply',
    datasetVersion: 'prod-promote-2026-09-30-lane-a-beta-copy',
    betaUrl: 'mongodb+srv://user:pass@beta.example.test/Beta',
    productionUrl: 'mongodb+srv://user:pass@production.example.test/Prod',
    confirmLane: true,
    confirmProd: true,
    includeObservations: false,
    includeScrapeRuns: false,
    retireScrapeRunsActor: '',
  };
}

describe('Beta to Production promotion carries Production login accounts', () => {
  let memoryServer: MongoMemoryServer | undefined;
  let client: MongoClient | undefined;
  let productionDb: Db;

  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create({ binary: { version: '8.0.12' } });
    client = new MongoClient(memoryServer.getUri());
    await client.connect();
    const betaDb = client.db('Beta_account_carry_source');
    productionDb = client.db('Prod_account_carry_target');
    await seedBeta(betaDb);
    await seedProduction(productionDb);
    await applyCopy(betaDb, productionDb, promotionOptions());
  });

  afterAll(async () => {
    await client?.close();
    await memoryServer?.stop();
  });

  it('leaves every research plan owned by an existing account', async () => {
    const accountIds = new Set(
      (await productionDb.collection('accounts').distinct('_id')).map(String),
    );
    const plans = await productionDb.collection('research_plans').find({}).toArray();

    expect(plans).toHaveLength(3);
    expect(plans.filter((plan) => !accountIds.has(String(plan.accountId)))).toEqual([]);
  });

  it('keeps login and plan-owning accounts under their Production _id', async () => {
    const accounts = productionDb.collection('accounts');

    expect(await accounts.findOne({ _id: studentAccountId })).toMatchObject({
      netid: 'st222',
      lastLoginAt,
    });
    expect(await accounts.findOne({ _id: planOnlyAccountId })).toMatchObject({ netid: 'st333' });
  });

  it('drops a Production account with no login evidence', async () => {
    expect(await productionDb.collection('accounts').findOne({ _id: staleAccountId })).toBeNull();
  });

  it('re-keys a same-netid Beta account to the Production _id and follows its researcher', async () => {
    const accounts = productionDb.collection('accounts');

    expect(await accounts.findOne({ _id: researcherAccountId })).toBeNull();
    expect(await accounts.countDocuments({ netid: 'rs111' })).toBe(1);
    expect(await accounts.findOne({ _id: productionTwinAccountId })).toMatchObject({
      netid: 'rs111',
      lastLoginAt,
    });
    expect(
      await productionDb.collection('researchers').findOne({ _id: researcherId }),
    ).toMatchObject({ accountId: productionTwinAccountId });
  });
});

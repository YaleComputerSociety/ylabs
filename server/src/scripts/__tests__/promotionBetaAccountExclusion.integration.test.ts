import { MongoClient, ObjectId, type Db } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyCopy, type PromotionOptions } from '../promoteAcceptedBetaCopy';

const spineResearcherAccountId = new ObjectId('68f2000000000000000000a1');
const betaLoginAccountId = new ObjectId('68f2000000000000000000a2');
const betaPlanOwnerAccountId = new ObjectId('68f2000000000000000000a3');
const mirrorAccountId = new ObjectId('68f2000000000000000000a4');
const productionLoginAccountId = new ObjectId('68f2000000000000000000a5');
const researcherId = new ObjectId('68f2000000000000000000b1');

const betaLoginAt = new Date('2026-09-28T09:00:00Z');
const productionLoginAt = new Date('2026-09-20T12:00:00Z');

const studentProfile = {
  firstName: 'Fixture',
  lastName: 'Person',
  userType: 'student',
  title: 'Fixture Title',
  department: 'Fixture Department',
  college: 'Fixture College',
  year: '2027',
  major: ['Fixture Major'],
};

const OTHER_PROMOTED_COLLECTIONS = [
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
];

async function seedBeta(betaDb: Db): Promise<void> {
  await betaDb.collection('accounts').insertMany([
    {
      _id: spineResearcherAccountId,
      schemaVersion: 1,
      netid: 'fixture-spine',
      email: 'fixture-spine@yale.edu',
      status: 'ACTIVE',
      archived: false,
      lastLoginAt: betaLoginAt,
      profile: { ...studentProfile },
    },
    {
      _id: betaLoginAccountId,
      schemaVersion: 1,
      netid: 'fixture-beta-login',
      email: 'fixture-beta-login@yale.edu',
      status: 'ACTIVE',
      archived: false,
      lastLoginAt: betaLoginAt,
      profile: { ...studentProfile },
    },
    {
      _id: betaPlanOwnerAccountId,
      schemaVersion: 1,
      netid: 'fixture-beta-plan-owner',
      email: 'fixture-beta-plan-owner@yale.edu',
      status: 'ACTIVE',
      archived: false,
      profile: { ...studentProfile },
    },
    {
      _id: mirrorAccountId,
      schemaVersion: 1,
      netid: 'fixture-mirror',
      email: 'fixture-mirror@yale.edu',
      status: 'ACTIVE',
      archived: false,
    },
  ]);
  await betaDb.collection('researchers').insertOne({
    _id: researcherId,
    schemaVersion: 1,
    displayName: 'Fixture Researcher',
    accountId: spineResearcherAccountId,
    status: 'ACTIVE',
    archived: false,
  });
  await betaDb.collection('research_plans').insertOne({
    accountId: betaPlanOwnerAccountId,
    target: { kind: 'RESEARCH_ENTITY', id: new ObjectId() },
  });
  for (const name of OTHER_PROMOTED_COLLECTIONS) {
    await betaDb.collection(name).insertOne({ name: `fixture-${name}` });
  }
}

async function seedProduction(productionDb: Db): Promise<void> {
  await productionDb.collection('accounts').insertOne({
    _id: productionLoginAccountId,
    schemaVersion: 1,
    netid: 'fixture-production-login',
    email: 'fixture-production-login@yale.edu',
    status: 'ACTIVE',
    archived: false,
    lastLoginAt: productionLoginAt,
    profile: { ...studentProfile },
  });
  await productionDb.collection('research_plans').insertOne({
    accountId: productionLoginAccountId,
    target: { kind: 'RESEARCH_ENTITY', id: new ObjectId() },
  });
}

function promotionOptions(): PromotionOptions {
  return {
    mode: 'apply',
    datasetVersion: 'prod-promote-2026-10-01-lane-a-beta-copy',
    betaUrl: 'mongodb+srv://user:pass@beta.example.test/Beta',
    productionUrl: 'mongodb+srv://user:pass@production.example.test/Prod',
    confirmLane: true,
    confirmProd: true,
    includeObservations: false,
    includeScrapeRuns: false,
    retireScrapeRunsActor: '',
  };
}

describe('Beta to Production promotion leaves Beta logins in Beta', () => {
  let memoryServer: MongoMemoryServer | undefined;
  let client: MongoClient | undefined;
  let productionDb: Db;

  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create({ binary: { version: '8.0.12' } });
    client = new MongoClient(memoryServer.getUri());
    await client.connect();
    const betaDb = client.db('Beta_account_exclusion_source');
    productionDb = client.db('Prod_account_exclusion_target');
    await seedBeta(betaDb);
    await seedProduction(productionDb);
    await applyCopy(betaDb, productionDb, promotionOptions());
  }, 120_000);

  afterAll(async () => {
    await client?.close();
    await memoryServer?.stop();
  });

  it('promotes no account that carries a Beta login timestamp', async () => {
    expect(
      await productionDb.collection('accounts').countDocuments({
        _id: { $ne: productionLoginAccountId },
        lastLoginAt: { $ne: null },
      }),
    ).toBe(0);
  });

  it('promotes no student profile field that Production did not already hold', async () => {
    const leaked = await productionDb.collection('accounts').countDocuments({
      _id: { $ne: productionLoginAccountId },
      $or: [
        { 'profile.college': { $exists: true } },
        { 'profile.year': { $exists: true } },
        { 'profile.major': { $exists: true } },
      ],
    });

    expect(leaked).toBe(0);
  });

  it('excludes a Beta-only login account that no promoted row reaches', async () => {
    expect(
      await productionDb.collection('accounts').findOne({ _id: betaLoginAccountId }),
    ).toBeNull();
  });

  it('excludes a Beta account whose only evidence is a Beta research plan', async () => {
    expect(
      await productionDb.collection('accounts').findOne({ _id: betaPlanOwnerAccountId }),
    ).toBeNull();
  });

  it('keeps the Production login account with its own timestamp and profile', async () => {
    expect(
      await productionDb.collection('accounts').findOne({ _id: productionLoginAccountId }),
    ).toMatchObject({
      netid: 'fixture-production-login',
      lastLoginAt: productionLoginAt,
      profile: { college: studentProfile.college, year: studentProfile.year },
    });
  });

  it('leaves the Production plan owned by an account that still exists', async () => {
    const accountIds = new Set(
      (await productionDb.collection('accounts').distinct('_id')).map(String),
    );
    const plans = await productionDb.collection('research_plans').find({}).toArray();

    expect(plans).toHaveLength(1);
    expect(plans.filter((plan) => !accountIds.has(String(plan.accountId)))).toEqual([]);
  });

  it('promotes the identity spine account a researcher reaches, without its login state', async () => {
    const promoted = await productionDb
      .collection('accounts')
      .findOne({ _id: spineResearcherAccountId });

    expect(promoted).toMatchObject({
      netid: 'fixture-spine',
      profile: { firstName: studentProfile.firstName, department: studentProfile.department },
    });
    expect(promoted?.lastLoginAt).toBeUndefined();
    expect(promoted?.profile?.college).toBeUndefined();
    expect(promoted?.profile?.major).toBeUndefined();
  });

  it('promotes a Beta mirror account that carries no login evidence', async () => {
    expect(
      await productionDb.collection('accounts').findOne({ _id: mirrorAccountId }),
    ).toMatchObject({ netid: 'fixture-mirror' });
  });
});

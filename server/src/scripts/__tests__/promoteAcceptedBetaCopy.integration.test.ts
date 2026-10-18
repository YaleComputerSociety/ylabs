import { MongoClient, ObjectId, type Db, type Document } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CANONICAL_MONGO_VALIDATORS } from '../canonicalMongoValidatorRegistry';
import { applyCopy, type PromotionOptions } from '../promoteAcceptedBetaCopy';

const betaLoginAccountId = new ObjectId('68e0000000000000000000a1');
const productionLoginAccountId = new ObjectId('68e0000000000000000000a2');
const productionPlanId = new ObjectId('68e0000000000000000000a3');
const researcherId = new ObjectId('68e0000000000000000000b1');
const researchEntityId = new ObjectId('68e0000000000000000000c1');
const orgUnitId = new ObjectId('68e0000000000000000000d1');

const researchersValidator = CANONICAL_MONGO_VALIDATORS.find(
  (candidate) => candidate.collectionName === 'researchers',
)!;

async function seedBeta(betaDb: Db): Promise<void> {
  await betaDb.collection('accounts').insertOne({
    _id: betaLoginAccountId,
    schemaVersion: 1,
    netid: 'abc123',
    email: 'beta.login@example.test',
    status: 'ACTIVE',
    archived: false,
    lastLoginAt: new Date('2026-10-01T12:00:00Z'),
  });

  await betaDb.createCollection('researchers', {
    validator: researchersValidator.validator,
    validationLevel: researchersValidator.validationLevel,
    validationAction: researchersValidator.validationAction,
  });
  await betaDb.collection('researchers').insertOne({
    _id: researcherId,
    schemaVersion: 1,
    displayName: 'Faculty Person',
    identifiers: { netid: 'abc123' },
    profileLinks: [],
    status: 'ACTIVE',
    archived: false,
  });
  await betaDb.collection('role_assignments').insertOne({
    schemaVersion: 1,
    personId: researcherId,
    target: { kind: 'RESEARCH_ENTITY', id: researchEntityId },
    role: 'PI',
    state: 'CURRENT',
    confidence: 0.9,
    reviewStatus: 'UNREVIEWED',
    archived: false,
  });
  await betaDb.collection('research_entities').insertOne({
    _id: researchEntityId,
    name: 'Example Person Lab',
    slug: 'example-person-lab',
    entityType: 'FACULTY_RESEARCH_AREA',
  });
  await betaDb.collection('research_entity_relationships').insertOne({
    fromEntityId: researchEntityId,
    toEntityId: new ObjectId(),
    relationshipType: 'AFFILIATED_WITH',
  });
  await betaDb
    .collection('research_entity_redirects')
    .insertOne({ fromSlug: 'person-lab', toEntityId: researchEntityId });
  await betaDb.collection('signals').insertOne({
    subject: { kind: 'RESEARCH_ENTITY', id: researchEntityId },
    field: 'fullDescription',
  });
  await betaDb.collection('sources').insertOne({ name: 'example-directory' });
  await betaDb.collection('departments').insertOne({ name: 'Example Department' });
  await betaDb.collection('org_units').insertOne({
    _id: orgUnitId,
    schemaVersion: 1,
    name: 'Example Department',
    kind: 'DEPARTMENT',
  });
  await betaDb.collection('research_areas').insertOne({ name: 'Chemistry' });
  await betaDb
    .collection('taxonomy_terms')
    .insertOne({ schemaVersion: 1, label: 'Chemistry', kind: 'RESEARCH_AREA' });
  await betaDb.collection('fellowships').insertOne({ name: 'Example Fellowship' });
}

const productionLogin = {
  _id: productionLoginAccountId,
  schemaVersion: 1,
  netid: 'xyz789',
  email: 'production.login@example.test',
  status: 'ACTIVE',
  archived: false,
  lastLoginAt: new Date('2026-10-02T12:00:00Z'),
};

async function seedProduction(productionDb: Db): Promise<void> {
  await productionDb.collection('accounts').insertOne(productionLogin);
  await productionDb
    .collection('research_plans')
    .insertOne({ _id: productionPlanId, accountId: productionLoginAccountId, items: [] });
  await productionDb
    .collection('research_entities')
    .insertOne({ name: 'Stale Production Entity', slug: 'stale-production-entity' });
}

function promotionOptions(): PromotionOptions {
  return {
    mode: 'apply',
    datasetVersion: 'prod-promote-2026-09-22-lane-a-beta-copy',
    betaUrl: 'mongodb+srv://user:pass@beta.example.test/Beta',
    productionUrl: 'mongodb+srv://user:pass@production.example.test/Prod',
    confirmLane: true,
    confirmProd: true,
    includeObservations: false,
    includeScrapeRuns: false,
    retireScrapeRunsActor: '',
  };
}

describe('Beta to Production promotion against MongoDB', () => {
  let memoryServer: MongoMemoryServer | undefined;
  let client: MongoClient | undefined;
  let betaDb: Db;
  let productionDb: Db;

  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create({ binary: { version: '8.0.12' } });
    client = new MongoClient(memoryServer.getUri());
    await client.connect();
    betaDb = client.db('Beta_promotion_source');
    productionDb = client.db('Prod_promotion_target');
    await seedBeta(betaDb);
    await seedProduction(productionDb);
    await applyCopy(betaDb, productionDb, promotionOptions());
  });

  afterAll(async () => {
    await client?.close();
    await memoryServer?.stop();
  });

  it('leaves Production accounts and their plans exactly as they were', async () => {
    expect(await productionDb.collection('accounts').find({}).toArray()).toEqual([productionLogin]);
    expect(await productionDb.collection('research_plans').findOne({})).toMatchObject({
      _id: productionPlanId,
      accountId: productionLoginAccountId,
    });
  });

  it('replaces the promoted corpus with what Beta offered', async () => {
    expect(
      await productionDb
        .collection('research_entities')
        .findOne({ slug: 'stale-production-entity' }),
    ).toBeNull();
    expect(await productionDb.collection('research_entities').findOne({})).toMatchObject({
      slug: 'example-person-lab',
    });
  });

  it('carries the canonical researchers validator onto Production so a strict flip survives', async () => {
    const [promotedResearchers] = (await productionDb
      .listCollections({ name: 'researchers' })
      .toArray()) as Array<{ options?: Document }>;

    expect(promotedResearchers.options).toMatchObject({
      validator: researchersValidator.validator,
      validationLevel: researchersValidator.validationLevel,
      validationAction: researchersValidator.validationAction,
    });
  });

  it('creates no Production collection the promotion manifest excludes', async () => {
    expect(await productionDb.listCollections({ name: 'observations' }).hasNext()).toBe(false);
    expect(await productionDb.listCollections({ name: 'scrape_runs' }).hasNext()).toBe(false);
  });
});

describe('Beta to Production promotion with a corpus account reference', () => {
  let memoryServer: MongoMemoryServer | undefined;
  let client: MongoClient | undefined;
  let betaDb: Db;
  let productionDb: Db;

  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create({ binary: { version: '8.0.12' } });
    client = new MongoClient(memoryServer.getUri());
    await client.connect();
    betaDb = client.db('Beta_promotion_blocked_source');
    productionDb = client.db('Prod_promotion_blocked_target');
    await seedBeta(betaDb);
    await betaDb
      .collection('researchers')
      .updateOne({ _id: researcherId }, { $set: { accountId: betaLoginAccountId } });
    await seedProduction(productionDb);
  });

  afterAll(async () => {
    await client?.close();
    await memoryServer?.stop();
  });

  it('refuses the copy and leaves Production untouched', async () => {
    await expect(applyCopy(betaDb, productionDb, promotionOptions())).rejects.toThrow(
      '1 researchers row carries an account _id in accountId',
    );
    expect(
      await productionDb
        .collection('research_entities')
        .findOne({ slug: 'stale-production-entity' }),
    ).not.toBeNull();
    expect(await productionDb.collection('accounts').find({}).toArray()).toEqual([productionLogin]);
  });
});

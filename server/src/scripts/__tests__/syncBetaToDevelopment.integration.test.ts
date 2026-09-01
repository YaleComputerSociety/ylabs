import { MongoClient, ObjectId, type Db, type Document } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CANONICAL_MONGO_VALIDATORS } from '../canonicalMongoValidatorRegistry';
import {
  applySync,
  assertNoUnclassifiedBetaCollections,
  betaToDevelopmentCollectionNames,
  buildBetaToDevelopmentSummary,
  buildPlan,
  collectionsForOptions,
  parseBetaToDevelopmentOptions,
  researchPersonAccountIds,
  unclassifiedBetaCollectionNames,
  type BetaToDevelopmentOptions,
} from '../syncBetaToDevelopment';

const facultyAccountId = new ObjectId('68d0000000000000000000a1');
const studentAccountId = new ObjectId('68d0000000000000000000a2');
const researcherId = new ObjectId('68d0000000000000000000b1');
const researchEntityId = new ObjectId('68d0000000000000000000c1');
const orgUnitId = new ObjectId('68d0000000000000000000d1');
const observationId = new ObjectId('68d0000000000000000000e1');

const accountsValidator = CANONICAL_MONGO_VALIDATORS.find(
  (candidate) => candidate.collectionName === 'accounts',
)!;

async function seedSource(sourceDb: Db): Promise<void> {
  await sourceDb.createCollection('accounts', {
    validator: accountsValidator.validator,
    validationLevel: accountsValidator.validationLevel,
    validationAction: accountsValidator.validationAction,
  });
  await sourceDb.collection('accounts').insertMany([
    {
      _id: facultyAccountId,
      schemaVersion: 1,
      netid: 'abc123',
      email: 'faculty.person@yale.edu',
      status: 'ACTIVE',
      lastLoginAt: new Date('2026-08-01T12:00:00Z'),
      profile: {
        firstName: 'Faculty',
        lastName: 'Person',
        userType: 'professor',
        title: 'Professor of Example Studies',
        department: 'Example Department',
        college: 'Example College',
        year: '1998',
        major: ['Chemistry'],
      },
      archived: false,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-08-01T12:00:00Z'),
    },
    {
      _id: studentAccountId,
      schemaVersion: 1,
      netid: 'xyz789',
      email: 'student.person@yale.edu',
      status: 'ACTIVE',
      lastLoginAt: new Date('2026-08-20T12:00:00Z'),
      profile: {
        firstName: 'Student',
        lastName: 'Person',
        userType: 'undergraduate',
        college: 'Example College',
        year: '2028',
        major: ['Molecular Biology'],
      },
      archived: false,
      createdAt: new Date('2026-02-01T00:00:00Z'),
      updatedAt: new Date('2026-08-20T12:00:00Z'),
    },
  ]);

  await sourceDb.collection('researchers').insertOne({
    _id: researcherId,
    schemaVersion: 1,
    displayName: 'Faculty Person',
    accountId: facultyAccountId,
    profileLinks: [],
    status: 'ACTIVE',
    archived: false,
  });
  await sourceDb.collection('role_assignments').insertMany([
    {
      schemaVersion: 1,
      personId: researcherId,
      target: { kind: 'RESEARCH_ENTITY', id: researchEntityId },
      role: 'PI',
      state: 'CURRENT',
      evidenceClaimIds: [],
      confidence: 0.9,
      reviewStatus: 'UNREVIEWED',
      archived: false,
    },
    {
      schemaVersion: 1,
      personId: researcherId,
      target: { kind: 'ORG_UNIT', id: orgUnitId },
      role: 'CORE_FACULTY',
      state: 'CURRENT',
      evidenceClaimIds: [],
      confidence: 0.8,
      reviewStatus: 'UNREVIEWED',
      archived: false,
    },
  ]);
  await sourceDb.collection('research_entities').insertOne({
    _id: researchEntityId,
    name: 'Example Person Lab',
    slug: 'example-person-lab',
    entityType: 'FACULTY_RESEARCH_AREA',
  });
  await sourceDb.collection('research_entity_relationships').insertOne({
    fromEntityId: researchEntityId,
    toEntityId: new ObjectId(),
    relationshipType: 'AFFILIATED_WITH',
  });
  await sourceDb
    .collection('research_entity_redirects')
    .insertOne({ fromSlug: 'person-lab', toEntityId: researchEntityId });
  await sourceDb
    .collection('canonical_aliases')
    .insertOne({ scope: 'RESEARCHER', key: 'netid:abc123', targetId: researcherId });
  await sourceDb.collection('signals').insertOne({
    subject: { kind: 'RESEARCH_ENTITY', id: researchEntityId },
    field: 'fullDescription',
    source: { evidenceIds: [observationId] },
  });
  await sourceDb.collection('sources').insertOne({ name: 'example-directory' });
  await sourceDb.collection('scrape_runs').insertOne({ sourceName: 'example-directory' });
  await sourceDb
    .collection('observations')
    .insertMany([{ _id: observationId, field: 'fullDescription' }, { field: 'websiteUrl' }]);
  await sourceDb.collection('departments').insertOne({ name: 'Example Department' });
  await sourceDb.collection('org_units').insertOne({
    _id: orgUnitId,
    schemaVersion: 1,
    name: 'Example Department',
    kind: 'DEPARTMENT',
  });
  await sourceDb.collection('research_areas').insertOne({ name: 'Chemistry' });
  await sourceDb
    .collection('taxonomy_terms')
    .insertOne({ schemaVersion: 1, label: 'Chemistry', kind: 'RESEARCH_AREA' });
  await sourceDb.collection('fellowships').insertOne({ name: 'Example Fellowship' });

  await sourceDb
    .collection('analytics_events')
    .insertOne({ event: 'beta_student_search', netid: 'xyz789' });
  await sourceDb.collection('scrape_job_locks').insertOne({ sourceName: 'example-directory' });
  await sourceDb.collection('student_profiles').insertOne({ accountId: studentAccountId });
  await sourceDb.collection('evidence_claims').insertOne({ schemaVersion: 1 });
}

async function seedTarget(targetDb: Db): Promise<void> {
  await targetDb
    .collection('research_entities')
    .insertOne({ name: 'Stale Development Entity', slug: 'stale-development-entity' });
  await targetDb.collection('accounts').insertOne({
    schemaVersion: 1,
    netid: 'stale001',
    email: 'stale.person@yale.edu',
    status: 'ACTIVE',
    archived: false,
  });
  await targetDb
    .collection('analytics_events')
    .insertOne({ event: 'development_student_search', netid: 'local001' });
}

describe('Beta to Development mirror against MongoDB', () => {
  let memoryServer: MongoMemoryServer | undefined;
  let client: MongoClient | undefined;
  let sourceDb: Db;
  let targetDb: Db;
  let options: BetaToDevelopmentOptions;

  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create({ binary: { version: '8.0.12' } });
    client = new MongoClient(memoryServer.getUri());
    await client.connect();
    sourceDb = client.db('Beta_mirror_source');
    targetDb = client.db('Development_mirror_target');
    await seedSource(sourceDb);
    await seedTarget(targetDb);

    options = parseBetaToDevelopmentOptions([], {
      BETA_MONGODBURL: 'mongodb+srv://user:pass@beta.example.test/Beta',
      MONGODBURL: 'mongodb+srv://user:pass@development.example.test/Development',
    });

    const researchAccountIds = await researchPersonAccountIds(sourceDb);
    const collections = collectionsForOptions(options, researchAccountIds);
    const sourceCollectionNames = (await sourceDb.listCollections({}, { nameOnly: true }).toArray())
      .map((row) => row.name)
      .sort();
    const unclassified = unclassifiedBetaCollectionNames(
      sourceCollectionNames,
      betaToDevelopmentCollectionNames(true),
    );
    expect(unclassified).toEqual([]);
    assertNoUnclassifiedBetaCollections(unclassified);

    const plan = await buildPlan(sourceDb, targetDb, collections);
    const summary = buildBetaToDevelopmentSummary(options, plan, unclassified, []);
    expect(summary.includesObservations).toBe(false);

    await applySync(sourceDb, targetDb, collections, [], async () => {
      const after = await buildPlan(sourceDb, targetDb, collections);
      const mismatches = after.filter((row) => row.sourceCopyCount !== row.targetCount);
      expect(mismatches).toEqual([]);
    });
  }, 180_000);

  afterAll(async () => {
    await client?.close();
    await memoryServer?.stop();
  });

  it('mirrors the reviewable corpus and the identity spine onto the target', async () => {
    const mirrored = (await targetDb.listCollections({}, { nameOnly: true }).toArray()).map(
      (row) => row.name,
    );

    for (const expected of [
      'research_entities',
      'research_entity_relationships',
      'research_entity_redirects',
      'canonical_aliases',
      'signals',
      'researchers',
      'role_assignments',
      'accounts',
      'sources',
      'scrape_runs',
      'departments',
      'org_units',
      'research_areas',
      'taxonomy_terms',
      'fellowships',
    ]) {
      expect(mirrored).toContain(expected);
    }

    expect(await targetDb.collection('researchers').countDocuments()).toBe(1);
    expect(await targetDb.collection('role_assignments').countDocuments()).toBe(2);
    expect(await targetDb.collection('canonical_aliases').countDocuments()).toBe(1);
    expect(await targetDb.collection('org_units').countDocuments()).toBe(1);
    expect(await targetDb.collection('taxonomy_terms').countDocuments()).toBe(1);
    expect(
      await targetDb.collection('research_entities').findOne({ slug: 'stale-development-entity' }),
    ).toBeNull();
    expect(
      await targetDb.collection('research_entities').findOne({ _id: researchEntityId }),
    ).toMatchObject({ slug: 'example-person-lab' });
  });

  it('leaves observations in the source and never copies environment-local collections', async () => {
    expect(await targetDb.listCollections({ name: 'observations' }).hasNext()).toBe(false);
    expect(await sourceDb.collection('observations').countDocuments()).toBe(2);

    expect(await targetDb.collection('analytics_events').countDocuments()).toBe(1);
    expect(await targetDb.collection('analytics_events').findOne({})).toMatchObject({
      event: 'development_student_search',
    });
    expect(await targetDb.listCollections({ name: 'scrape_job_locks' }).hasNext()).toBe(false);
    expect(await targetDb.listCollections({ name: 'student_profiles' }).hasNext()).toBe(false);
    expect(await targetDb.listCollections({ name: 'evidence_claims' }).hasNext()).toBe(false);
  });

  it('keeps the researcher-backed account resolvable without mirroring its student PII', async () => {
    const facultyAccount = await targetDb.collection('accounts').findOne({ _id: facultyAccountId });

    expect(facultyAccount).toMatchObject({
      netid: 'abc123',
      email: 'faculty.person@yale.edu',
      status: 'ACTIVE',
      archived: false,
      profile: {
        firstName: 'Faculty',
        lastName: 'Person',
        userType: 'professor',
        title: 'Professor of Example Studies',
        department: 'Example Department',
      },
    });
    expect(facultyAccount?.profile).not.toHaveProperty('college');
    expect(facultyAccount?.profile).not.toHaveProperty('year');
    expect(facultyAccount?.profile).not.toHaveProperty('major');
    expect(facultyAccount).not.toHaveProperty('lastLoginAt');

    const researcher = await targetDb.collection('researchers').findOne({ _id: researcherId });
    expect(researcher?.accountId).toEqual(facultyAccount?._id);
  });

  it('pseudonymizes every account no researcher references', async () => {
    const studentAccount = await targetDb.collection('accounts').findOne({ _id: studentAccountId });

    expect(studentAccount).toMatchObject({
      netid: `mirrored-${studentAccountId.toHexString()}`,
      email: `mirrored-${studentAccountId.toHexString()}@example.invalid`,
      status: 'ACTIVE',
      archived: false,
    });
    expect(studentAccount).not.toHaveProperty('profile');
    expect(studentAccount).not.toHaveProperty('lastLoginAt');
    expect(await targetDb.collection('accounts').findOne({ netid: 'xyz789' })).toBeNull();
    expect(await targetDb.collection('accounts').findOne({ netid: 'stale001' })).toBeNull();
  });

  it('carries the canonical accounts validator onto the mirrored collection', async () => {
    const [mirroredAccounts] = (await targetDb
      .listCollections({ name: 'accounts' })
      .toArray()) as Array<{ options?: Document }>;

    expect(mirroredAccounts.options).toMatchObject({
      validator: accountsValidator.validator,
      validationLevel: accountsValidator.validationLevel,
      validationAction: accountsValidator.validationAction,
    });

    await expect(
      targetDb.collection('accounts').insertOne({ email: 'no.netid@yale.edu' }),
    ).rejects.toThrow(/[Dd]ocument failed validation/);
  });
});

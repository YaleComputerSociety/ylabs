import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const meiliMocks = vi.hoisted(() => ({
  syncEntities: vi.fn(async () => {}),
  syncEntity: vi.fn(async () => {}),
  deleteFromIndex: vi.fn(async () => {}),
}));

vi.mock('../meiliSyncService', () => ({
  syncEntities: meiliMocks.syncEntities,
  syncEntity: meiliMocks.syncEntity,
  deleteFromIndex: meiliMocks.deleteFromIndex,
}));

import { getResearchGroupDetail } from '../researchGroupService';

const SLUG = 'example-join-claim-lab';
const WEBSITE = 'https://examplelab.yale.edu/';
const JOIN_EXCERPT = 'A join, opportunities, or application page was found.';
const COUNT_EXCERPT = '2 current undergraduate(s) listed';
const MEMBERS_PAGE = `${WEBSITE}members/`;
const JOIN_PAGE = `${WEBSITE}join-us`;
const OWN_OPPORTUNITIES_PAGE = `${WEBSITE}job-opportunities/research-opportunities`;

interface SeedOptions {
  entityType?: string;
  kind?: string;
  websiteUrl?: string;
  joinCitation?: string;
  joinPageUrl?: string;
  accessQuote?: string;
  countCitation?: string;
  sourceLinkHealth?: unknown[];
  withLead?: boolean;
}

const observation = (field: string, value: unknown, sourceUrl: string) => ({
  _id: new mongoose.Types.ObjectId(),
  entityType: 'researchEntity',
  entityKey: SLUG,
  field,
  value,
  sourceId: new mongoose.Types.ObjectId(),
  sourceName: 'lab-microsite-undergrad-llm',
  sourceUrl,
  confidence: 0.5,
  observedAt: new Date('2026-09-01T00:00:00Z'),
  superseded: false,
});

const seed = async ({
  entityType = 'LAB',
  kind = 'lab',
  websiteUrl = WEBSITE,
  joinCitation = JOIN_PAGE,
  joinPageUrl = joinCitation,
  accessQuote = 'Undergraduates are welcome to apply.',
  countCitation = MEMBERS_PAGE,
  sourceLinkHealth = [],
  withLead = false,
}: SeedOptions = {}) => {
  const db = mongoose.connection.db;
  if (!db) throw new Error('no db');
  const entityId = new mongoose.Types.ObjectId();
  await db.collection('research_entities').insertOne({
    _id: entityId,
    slug: SLUG,
    name: withLead ? 'Example Person - Research' : 'Example Join Claim Lab',
    departments: ['Molecular, Cellular & Developmental Biology'],
    shortDescription: 'Studies how example tissues repair after injury.',
    kind,
    entityType,
    schemaVersion: 1,
    archived: false,
    studentVisibilityTier: 'student_ready',
    studentVisibilityReasons: ['source_backed_description'],
    fullDescription:
      'The lab studies how example tissues repair after injury, combining imaging, genetics and computational modelling of cell behaviour.',
    websiteUrl,
    sourceUrls: [websiteUrl],
    sourceLinkHealth,
  });
  if (withLead) {
    const personId = new mongoose.Types.ObjectId();
    await db.collection('researchers').insertOne({
      _id: personId,
      displayName: 'Example Person',
      firstName: 'Example',
      lastName: 'Person',
      netid: 'fixturejoinclaim1',
      archived: false,
    });
    await db.collection('role_assignments').insertOne({
      personId,
      target: { kind: 'RESEARCH_ENTITY', id: entityId },
      role: 'PI',
      state: 'CURRENT',
      archived: false,
      verifiedAt: new Date(),
      source: { name: 'fixture-faculty', url: websiteUrl },
    });
  }
  const access = observation(
    'undergradAccessEvidence',
    { openToUndergrads: 'yes', evidenceQuote: accessQuote, quoteSourceUrl: joinPageUrl },
    joinCitation,
  );
  const join = observation('joinPageUrl', joinPageUrl, joinCitation);
  const count = observation('currentUndergradCount', 2, countCitation);
  await db.collection('observations').insertMany([access, join, count]);
  const signal = (
    type: string,
    derivationKey: string,
    excerpt: string,
    url: string,
    evidenceId: unknown,
  ) => ({
    _id: new mongoose.Types.ObjectId(),
    researchEntityId: entityId,
    type,
    derivationKey,
    archived: false,
    confidence: 'MEDIUM',
    observedAt: new Date('2026-09-01T00:00:00Z'),
    source: { url, excerpt, evidenceIds: [evidenceId] },
  });
  await db
    .collection('signals')
    .insertMany([
      signal(
        'APPLICATION_FORM_EXISTS',
        'signal:APPLICATION_FORM_EXISTS:JOIN_PAGE',
        JOIN_EXCERPT,
        joinCitation,
        join._id,
      ),
      signal(
        'CURRENT_UNDERGRADS',
        'signal:CURRENT_UNDERGRADS',
        COUNT_EXCERPT,
        countCitation,
        count._id,
      ),
    ]);
  return entityId;
};

const servedSignals = async () =>
  ((await getResearchGroupDetail(SLUG))?.accessSignals ?? []).map((signal: any) => ({
    excerpt: signal.excerpt,
    sourceUrl: signal.sourceUrl,
  }));

const servedJoinClaims = async () =>
  (await servedSignals()).filter((signal) => signal.excerpt === JOIN_EXCERPT);

describe('a join-page claim is served only with the page it names (#4430)', () => {
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
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of [
      'research_entities',
      'signals',
      'observations',
      'researchers',
      'role_assignments',
    ]) {
      await db.collection(name).deleteMany({});
    }
  });

  it('serves the claim and its page together when the page is servable', async () => {
    await seed();

    expect(await servedJoinClaims()).toEqual([{ excerpt: JOIN_EXCERPT, sourceUrl: JOIN_PAGE }]);
  });

  it('withholds the claim when its page is a members page the detail route refuses to cite', async () => {
    await seed({ joinCitation: MEMBERS_PAGE });

    expect(await servedJoinClaims()).toEqual([]);
  });

  it('keeps a claim of another type whose link is withheld, because its excerpt says something', async () => {
    await seed({ joinCitation: MEMBERS_PAGE });

    expect((await servedSignals()).map((signal) => signal.excerpt)).toEqual([COUNT_EXCERPT]);
  });

  it('withholds the claim when its page is known to be gone', async () => {
    await seed({
      sourceLinkHealth: [{ url: JOIN_PAGE, healthStatus: 'UNAVAILABLE', httpStatusCode: 404 }],
    });

    expect(await servedJoinClaims()).toEqual([]);
  });

  it("serves a person row's own research-opportunities page with its claim", async () => {
    await seed({
      entityType: 'FACULTY_RESEARCH_AREA',
      kind: 'individual',
      joinCitation: OWN_OPPORTUNITIES_PAGE,
      withLead: true,
    });

    expect(await servedJoinClaims()).toEqual([
      { excerpt: JOIN_EXCERPT, sourceUrl: OWN_OPPORTUNITIES_PAGE },
    ]);
  });

  it('still withholds a claim its evidence no longer derives', async () => {
    await seed();
    await mongoose.connection
      .db!.collection('observations')
      .updateMany({ field: 'joinPageUrl' }, { $set: { superseded: true } });

    expect(await servedJoinClaims()).toEqual([]);
  });

  it('serves the join page the lane found when the claim was stored with the page it read (#4543)', async () => {
    await seed({ joinCitation: WEBSITE, joinPageUrl: JOIN_PAGE });

    expect(await servedJoinClaims()).toEqual([{ excerpt: JOIN_EXCERPT, sourceUrl: JOIN_PAGE }]);
  });

  it('serves an older backfilled copy of the claim once it cites the same join page (#4543)', async () => {
    const entityId = await seed({ joinCitation: WEBSITE, joinPageUrl: JOIN_PAGE });
    await mongoose.connection.db!.collection('signals').insertOne({
      _id: new mongoose.Types.ObjectId(),
      researchEntityId: entityId,
      type: 'APPLICATION_FORM_EXISTS',
      derivationKey: 'application-route-backfill:fixture:APPLICATION_FORM_EXISTS',
      archived: false,
      confidence: 'MEDIUM',
      observedAt: new Date('2026-08-01T00:00:00Z'),
      source: { url: WEBSITE, excerpt: JOIN_EXCERPT, evidenceIds: [] },
    });

    expect(await servedJoinClaims()).toEqual([{ excerpt: JOIN_EXCERPT, sourceUrl: JOIN_PAGE }]);
  });

  it('withholds the claim when the join page recruits no undergraduate audience (#4543)', async () => {
    await seed({
      accessQuote: 'We are always looking for enthusiastic individuals to join our group!',
    });

    expect(await servedJoinClaims()).toEqual([]);
  });

  it('keeps the withheld claim stored, because it is history', async () => {
    const entityId = await seed({ joinCitation: MEMBERS_PAGE });
    await getResearchGroupDetail(SLUG);

    const stored = await mongoose.connection.db!.collection('signals').countDocuments({
      researchEntityId: entityId,
      type: 'APPLICATION_FORM_EXISTS',
      archived: false,
    });
    expect(stored).toBe(1);
  });
});

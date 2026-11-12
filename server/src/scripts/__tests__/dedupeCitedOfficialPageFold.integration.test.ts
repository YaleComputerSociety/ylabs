import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDirectoryNetidsByAddressCache } from '../../scrapers/directoryContradictedProfileNetid';
import { dedupeAccountlessResearcherShells } from '../dedupeAccountlessResearcherShells';

const PAGE = 'https://medicine.yale.edu/profile/avery-synth/';
const SITE_COPY = 'https://medicine.yale.edu/fixturecenter/profile/avery-synth/';
const LISTING_PAGE = 'https://medicine.yale.edu/fixturecenter/people/';
const LISTING_KEY = 'centers:fixture-center:avery-synth';

const db = () => mongoose.connection.db!;

const runTwice = async () => {
  const first = await dedupeAccountlessResearcherShells({ apply: true });
  resetDirectoryNetidsByAddressCache();
  const second = await dedupeAccountlessResearcherShells({ apply: true });
  return { first, second };
};

describe('dedupeAccountlessResearcherShells cited official page arm (#5990, #6002)', () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    await mongoose.connect(server.getUri(), { autoIndex: false });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await server?.stop();
  });

  beforeEach(async () => {
    resetDirectoryNetidsByAddressCache();
    for (const name of [
      'researchers',
      'role_assignments',
      'research_entities',
      'observations',
      'accounts',
    ]) {
      await db().collection(name).deleteMany({});
    }
  });

  const seedRow = async () => {
    const row = new mongoose.Types.ObjectId();
    await db()
      .collection('research_entities')
      .insertOne({ _id: row, slug: `fixture-row-${row}`, archived: false });
    return row;
  };

  const seedResearcher = async (doc: Record<string, unknown>) => {
    const id = new mongoose.Types.ObjectId();
    await db()
      .collection('researchers')
      .insertOne({ _id: id, archived: false, ...doc });
    return id;
  };

  const officialLink = (url = PAGE) => ({
    kind: 'YALE_OFFICIAL',
    purpose: 'PRIMARY_IDENTITY',
    url,
    healthStatus: 'UNKNOWN',
  });

  const seedPageHeading = async (fname: string, lname: string) => {
    await db()
      .collection('observations')
      .insertMany(
        [
          ['fname', fname],
          ['lname', lname],
        ].map(([field, value]) => ({
          entityType: 'user',
          entityKey: 'fixture-page-subject',
          field,
          value,
          sourceName: 'ysm-faculty-directory',
          sourceUrl: PAGE,
          superseded: false,
        })),
      );
  };

  const seedCitingListing = async (
    citer: mongoose.Types.ObjectId,
    provenance: Record<string, unknown> = {},
  ) => {
    const row = await seedRow();
    await db()
      .collection('role_assignments')
      .insertOne({
        personId: citer,
        target: { kind: 'RESEARCH_ENTITY', id: row },
        role: 'CORE_FACULTY',
        state: 'UNKNOWN',
        reviewStatus: 'UNREVIEWED',
        archived: false,
        rosterProvenance: {
          sourceName: 'centers-institutes-index',
          sourceUrl: LISTING_PAGE,
          profileUrl: SITE_COPY,
          membershipKey: LISTING_KEY,
          ...provenance,
        },
      });
    await db()
      .collection('observations')
      .insertMany([
        {
          entityType: 'researchGroupMember',
          entityKey: LISTING_KEY,
          field: 'profileUrl',
          value: SITE_COPY,
          sourceName: 'centers-institutes-index',
          superseded: false,
        },
        {
          entityType: 'researchGroupMember',
          entityKey: LISTING_KEY,
          field: 'inferredUserName',
          value: { fname: 'Avery Q.', lname: 'Synth' },
          sourceName: 'centers-institutes-index',
          superseded: false,
        },
      ]);
  };

  const seedPair = async () => {
    const holder = await seedResearcher({
      displayName: 'Avery Synth',
      profileLinks: [officialLink()],
    });
    await db()
      .collection('role_assignments')
      .insertOne({
        personId: holder,
        target: { kind: 'RESEARCH_ENTITY', id: await seedRow() },
        role: 'PI',
        state: 'CURRENT',
        reviewStatus: 'UNREVIEWED',
        archived: false,
      });
    const citer = await seedResearcher({ displayName: 'Avery Q. Synth' });
    return { holder, citer };
  };

  it('folds the citing record into the page holder, once', async () => {
    const { holder, citer } = await seedPair();
    await seedPageHeading('Avery', 'Synth');
    await seedCitingListing(citer);

    const { first, second } = await runTwice();

    expect(first.foldsByMatchedIdentity['cited-official-page']).toBe(1);
    const folded = await db().collection('researchers').findOne({ _id: citer });
    expect(String(folded!.dedupedIntoResearcherId)).toBe(String(holder));
    expect(second.shellsMerged).toBe(0);
    expect(second.citedOfficialPage.witnessedPairs).toBe(0);
  });

  it("does not fold on a roster that links a colleague's page", async () => {
    const { citer } = await seedPair();
    await seedPageHeading('Blair', 'Other');
    await seedCitingListing(citer);

    const result = await dedupeAccountlessResearcherShells({ apply: false });

    expect(result.merges).toEqual([]);
    expect(result.citedOfficialPage.refusals['listing-name-not-page-subject']).toBe(1);
  });

  it.each([
    [{ membershipKey: '' }, 'not-a-roster-listing'],
    [{ sourceUrl: 'https://fixture.example.org/people/' }, 'not-yale-hosted'],
    [{ freshnessExpiresAt: new Date('2000-01-01T00:00:00Z') }, 'stale-listing'],
  ])('does not fold on a citing listing %o', async (provenance, refusal) => {
    const { citer } = await seedPair();
    await seedPageHeading('Avery', 'Synth');
    await seedCitingListing(citer, provenance);

    const result = await dedupeAccountlessResearcherShells({ apply: false });

    expect(result.merges).toEqual([]);
    expect(result.citedOfficialPage.refusals[refusal as 'stale-listing']).toBe(1);
  });

  it('does not fold on a listing whose observations were superseded', async () => {
    const { citer } = await seedPair();
    await seedPageHeading('Avery', 'Synth');
    await seedCitingListing(citer);
    await db()
      .collection('observations')
      .updateMany({ entityType: 'researchGroupMember' }, { $set: { superseded: true } });

    const result = await dedupeAccountlessResearcherShells({ apply: false });

    expect(result.merges).toEqual([]);
    expect(result.citedOfficialPage.refusals['no-live-listing']).toBe(1);
  });

  it('does not fold when a third record holds the page', async () => {
    const { citer } = await seedPair();
    await seedResearcher({ displayName: 'Casey Third', profileLinks: [officialLink()] });
    await seedPageHeading('Avery', 'Synth');
    await seedCitingListing(citer);

    const result = await dedupeAccountlessResearcherShells({ apply: false });

    expect(result.merges).toEqual([]);
    expect(result.citedOfficialPage.refusals['third-page-holder']).toBe(1);
  });
});

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDirectoryNetidsByAddressCache } from '../../scrapers/directoryContradictedProfileNetid';
import { dedupeAccountlessResearcherShells } from '../dedupeAccountlessResearcherShells';
import { syntheticPersonOrcid } from '../../test/syntheticOrcid';

const SYNTHETIC_ORCID = syntheticPersonOrcid(611);
const PROFILE_URL = 'https://medicine.example.edu/profile/avery-synth/';

const db = () => mongoose.connection.db!;

const officialLink = (url = PROFILE_URL) => ({
  kind: 'YALE_OFFICIAL',
  purpose: 'PRIMARY_IDENTITY',
  url,
  healthStatus: 'UNKNOWN',
});

const runTwice = async () => {
  const first = await dedupeAccountlessResearcherShells({ apply: true });
  resetDirectoryNetidsByAddressCache();
  const second = await dedupeAccountlessResearcherShells({ apply: true });
  return { first, second };
};

describe('dedupeAccountlessResearcherShells shared official profile arm (#5990, #6002)', () => {
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
      .insertOne({ _id: row, slug: `faculty-research-area-fixture-${row}`, archived: false });
    return row;
  };

  const seedLead = async (row: mongoose.Types.ObjectId, personId: mongoose.Types.ObjectId) => {
    const edge = new mongoose.Types.ObjectId();
    await db()
      .collection('role_assignments')
      .insertOne({
        _id: edge,
        personId,
        target: { kind: 'RESEARCH_ENTITY', id: row },
        role: 'PI',
        state: 'CURRENT',
        reviewStatus: 'UNREVIEWED',
        archived: false,
      });
    return edge;
  };

  const seedResearcher = async (doc: Record<string, unknown>) => {
    const id = new mongoose.Types.ObjectId();
    await db()
      .collection('researchers')
      .insertOne({ _id: id, archived: false, ...doc });
    return id;
  };

  it('folds two lead records of one person into the directory record, once', async () => {
    const row = await seedRow();
    const otherRow = await seedRow();
    const directory = await seedResearcher({
      displayName: 'Avery Q. Synth',
      identifiers: { email: 'directory.holder@example.test' },
      profileLinks: [officialLink()],
    });
    const shell = await seedResearcher({
      displayName: 'Avery Synth',
      identifiers: { orcid: SYNTHETIC_ORCID },
      profileLinks: [
        officialLink('http://www.medicine.example.edu/profile/avery-synth'),
        {
          kind: 'ORCID',
          purpose: 'SCHOLARLY',
          url: `https://orcid.org/${SYNTHETIC_ORCID}`,
          healthStatus: 'UNKNOWN',
        },
      ],
    });
    await seedLead(row, directory);
    const shellEdge = await seedLead(otherRow, shell);

    const { first, second } = await runTwice();

    expect(first.foldsByMatchedIdentity['shared-official-profile']).toBe(1);
    expect(first.shellsMerged).toBe(1);
    const folded = await db().collection('researchers').findOne({ _id: shell });
    expect(String(folded!.dedupedIntoResearcherId)).toBe(String(directory));
    expect(
      String((await db().collection('role_assignments').findOne({ _id: shellEdge }))!.personId),
    ).toBe(String(directory));
    expect(second.shellsMerged).toBe(0);
    expect(second.foldsByMatchedIdentity['shared-official-profile']).toBe(0);
  });

  it('folds two name-only records holding one official page into the survivor, once', async () => {
    const row = await seedRow();
    const survivor = await seedResearcher({
      displayName: 'Avery Synth',
      profileLinks: [officialLink()],
    });
    const twin = await seedResearcher({
      displayName: 'Avery Q. Synth',
      profileLinks: [officialLink()],
    });
    await seedLead(row, survivor);
    await seedLead(await seedRow(), survivor);
    await seedLead(await seedRow(), twin);

    const { first, second } = await runTwice();

    expect(first.foldsByMatchedIdentity['shared-official-profile']).toBe(1);
    const folded = await db().collection('researchers').findOne({ _id: twin });
    expect(String(folded!.dedupedIntoResearcherId)).toBe(String(survivor));
    expect(second.shellsMerged).toBe(0);
  });

  it('leaves two records of one name on two different official pages apart', async () => {
    const row = await seedRow();
    const directory = await seedResearcher({
      displayName: 'Avery Q. Synth',
      identifiers: { email: 'directory.holder@example.test' },
      profileLinks: [officialLink()],
    });
    const shell = await seedResearcher({
      displayName: 'Avery Synth',
      identifiers: { orcid: SYNTHETIC_ORCID },
      profileLinks: [officialLink('https://medicine.example.edu/profile/avery-synth-2/')],
    });
    await seedLead(row, directory);
    await seedLead(await seedRow(), shell);

    const result = await dedupeAccountlessResearcherShells({ apply: false });

    expect(result.merges).toEqual([]);
  });
});

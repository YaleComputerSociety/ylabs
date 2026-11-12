import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { labUrlIsCoLedGroupSiteOf, loadCoLedSiteIndex } from '../utils/coLedGroupSites';

const GROUP_SITE = 'https://medicine.example.edu/lab/fixture-group/';
const SOLO_SITE = 'https://medicine.example.edu/lab/fixture-solo/';

describe('loadCoLedSiteIndex', () => {
  let server: MongoMemoryServer;
  const oid = () => new mongoose.Types.ObjectId();
  const db = () => mongoose.connection.db!;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    await mongoose.connect(server.getUri(), { autoIndex: false });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await server?.stop();
  });

  beforeEach(async () => {
    for (const name of ['research_entities', 'role_assignments', 'researchers']) {
      await db().collection(name).deleteMany({});
    }
  });

  const person = async (email: string) => {
    const _id = oid();
    await db()
      .collection('researchers')
      .insertOne({ _id, displayName: email, identifiers: { email }, profileLinks: [] });
    return _id;
  };
  const row = async (slug: string, websiteUrl: string, archived = false) => {
    const _id = oid();
    await db().collection('research_entities').insertOne({ _id, slug, websiteUrl, archived });
    return _id;
  };
  const leadEdge = async (personId: unknown, rowId: unknown, state = 'CURRENT') => {
    await db()
      .collection('role_assignments')
      .insertOne({
        personId,
        role: 'PI',
        state,
        archived: false,
        target: { kind: 'RESEARCH_ENTITY', id: rowId },
      });
  };

  it('indexes a live co-led row by its website and reads the person among its leads', async () => {
    const rivers = await person('jordan.rivers@yale.edu');
    const sloan = await person('avery.sloan@yale.edu');
    const group = await row('fixture-group', GROUP_SITE);
    await leadEdge(rivers, group);
    await leadEdge(sloan, group);

    const index = await loadCoLedSiteIndex();

    expect(
      labUrlIsCoLedGroupSiteOf(index, GROUP_SITE, 'ysm-faculty-jordan-rivers', {
        email: 'jordan.rivers@yale.edu',
      }),
    ).toBe(true);
  });

  it('does not count a historical edge, so a row with one current lead is not co-led', async () => {
    const rivers = await person('jordan.rivers@yale.edu');
    const sloan = await person('avery.sloan@yale.edu');
    const solo = await row('fixture-solo', SOLO_SITE);
    await leadEdge(rivers, solo);
    await leadEdge(sloan, solo, 'HISTORICAL');

    const index = await loadCoLedSiteIndex();

    expect(
      labUrlIsCoLedGroupSiteOf(index, SOLO_SITE, 'ysm-faculty-jordan-rivers', {
        email: 'jordan.rivers@yale.edu',
      }),
    ).toBe(false);
  });

  it('does not index an archived row', async () => {
    const rivers = await person('jordan.rivers@yale.edu');
    const sloan = await person('avery.sloan@yale.edu');
    const group = await row('fixture-group', GROUP_SITE, true);
    await leadEdge(rivers, group);
    await leadEdge(sloan, group);

    expect((await loadCoLedSiteIndex()).size).toBe(0);
  });
});

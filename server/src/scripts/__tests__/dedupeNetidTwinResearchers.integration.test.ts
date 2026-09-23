import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { dedupeAccountlessResearcherShells } from '../dedupeAccountlessResearcherShells';

const accountId = new mongoose.Types.ObjectId();
const holderId = new mongoose.Types.ObjectId();
const twinId = new mongoose.Types.ObjectId();
const holderEntityId = new mongoose.Types.ObjectId();
const twinEntityId = new mongoose.Types.ObjectId();
const NETID = 'ab1234';

const db = () => {
  const connection = mongoose.connection.db;
  if (!connection) throw new Error('no db');
  return connection;
};

/**
 * The shape the pre-#3164 resolver produced: the holder owns the netid at
 * `identifiers.netid` with no account, and the twin is keyed on an account
 * carrying the same netid while holding no `identifiers.netid` of its own. The
 * two display names deliberately disagree, because on Development 0 of the 5
 * pairs share a normalized name and that is exactly why the name index misses
 * them.
 */
describe('a netid twin is folded even though no name links it (#3166)', () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    await mongoose.connect(server.getUri(), { autoIndex: false });
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await server.stop();
  });

  beforeEach(async () => {
    for (const name of ['researchers', 'role_assignments', 'accounts', 'research_entities']) {
      await db().collection(name).deleteMany({});
    }

    await db()
      .collection('accounts')
      .insertOne({ _id: accountId, netid: NETID, email: `${NETID}@example.invalid` });

    await db()
      .collection('researchers')
      .insertMany([
        {
          _id: holderId,
          displayName: 'Rowan Holder',
          identifiers: { netid: NETID },
          profileLinks: [],
          profile: { title: 'Associate Professor' },
          archived: false,
        },
        {
          _id: twinId,
          displayName: 'R Holder-Marchetti',
          accountId,
          profileLinks: [],
          archived: false,
        },
      ]);

    await db()
      .collection('role_assignments')
      .insertMany([
        {
          personId: holderId,
          target: { kind: 'RESEARCH_ENTITY', id: holderEntityId },
          role: 'PI',
          state: 'CURRENT',
          confidence: 0.7,
          reviewStatus: 'UNREVIEWED',
          archived: false,
        },
        {
          personId: twinId,
          target: { kind: 'RESEARCH_ENTITY', id: twinEntityId },
          role: 'PI',
          state: 'CURRENT',
          confidence: 0.9,
          reviewStatus: 'UNREVIEWED',
          archived: false,
        },
      ]);
  });

  it('plans the fold and attributes it to the netid, not the name', async () => {
    const result = await dedupeAccountlessResearcherShells({ apply: false });

    expect(result.netidBackedAccountlessResearchers).toBe(1);
    expect(result.shellsMerged).toBe(1);
    expect(result.foldsByMatchedIdentity).toEqual({ netid: 1, name: 0 });
    expect(result.merges[0]).toMatchObject({
      shellId: String(holderId),
      canonicalId: String(twinId),
    });
  }, 60000);

  it('writes nothing on a dry run', async () => {
    await dedupeAccountlessResearcherShells({ apply: false });

    const holder = await db().collection('researchers').findOne({ _id: holderId });
    expect(holder?.archived).toBe(false);
    const edge = await db().collection('role_assignments').findOne({ personId: holderId });
    expect(edge).toBeTruthy();
  }, 60000);

  it('repoints the edge, transfers the netid, and retires the holder', async () => {
    await dedupeAccountlessResearcherShells({ apply: true });

    const holder = await db().collection('researchers').findOne({ _id: holderId });
    expect(holder).toMatchObject({ archived: true, dedupedIntoResearcherId: twinId });
    expect(holder?.identifiers?.netid).toBeUndefined();

    const twin = await db().collection('researchers').findOne({ _id: twinId });
    expect(twin?.identifiers?.netid).toBe(NETID);

    const repointed = await db()
      .collection('role_assignments')
      .findOne({ 'target.id': holderEntityId });
    expect(String(repointed?.personId)).toBe(String(twinId));
    expect(repointed?.archived).not.toBe(true);
  }, 60000);

  it('leaves a holder whose netid is not bare alone, so a malformed key decides nothing', async () => {
    await db()
      .collection('researchers')
      .updateOne(
        { _id: holderId },
        { $set: { 'identifiers.netid': `https://example.invalid/people/${NETID}` } },
      );

    const result = await dedupeAccountlessResearcherShells({ apply: false });

    expect(result.shellsMerged).toBe(0);
    expect(result.foldsByMatchedIdentity).toEqual({ netid: 0, name: 0 });
  }, 60000);
});

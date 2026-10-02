import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resolveCanonicalResearchHomeForResearcher } from '../canonicalResearchHomeResolver';

const db = () => {
  const connection = mongoose.connection.db;
  if (!connection) throw new Error('no db');
  return connection;
};

const seedPerson = async () => {
  const personId = new mongoose.Types.ObjectId();
  await db().collection('researchers').insertOne({ _id: personId, archived: false });
  return personId;
};

const seedRow = async (input: { slug: string; archived: boolean }) => {
  const rowId = new mongoose.Types.ObjectId();
  await db()
    .collection('research_entities')
    .insertOne({
      _id: rowId,
      slug: input.slug,
      websiteUrl: `https://example.yale.edu/${input.slug}/`,
      archived: input.archived,
    });
  return rowId;
};

const seedLeadEdge = async (input: {
  personId: mongoose.Types.ObjectId;
  rowId: mongoose.Types.ObjectId;
  archived: boolean;
  state?: 'CURRENT' | 'HISTORICAL';
}) =>
  db()
    .collection('role_assignments')
    .insertOne({
      personId: input.personId,
      target: { kind: 'RESEARCH_ENTITY', id: input.rowId },
      role: 'PI',
      state: input.state ?? 'CURRENT',
      archived: input.archived,
    });

describe('resolveCanonicalResearchHomeForResearcher over merge and retirement residue (#3929)', () => {
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
    for (const name of ['researchers', 'research_entities', 'role_assignments']) {
      await db().collection(name).deleteMany({});
    }
  });

  it('names the live row when every other lead edge sits on an archived merge loser', async () => {
    const personId = await seedPerson();
    const survivor = await seedRow({ slug: 'synthetic-survivor-lab', archived: false });
    await seedLeadEdge({ personId, rowId: survivor, archived: false });
    for (const slug of ['synthetic-merged-loser', 'synthetic-retired-shell']) {
      const loser = await seedRow({ slug, archived: true });
      await seedLeadEdge({ personId, rowId: loser, archived: true });
    }
    const historicalLoser = await seedRow({ slug: 'synthetic-historical-loser', archived: true });
    await seedLeadEdge({ personId, rowId: historicalLoser, archived: false, state: 'HISTORICAL' });

    await expect(resolveCanonicalResearchHomeForResearcher(String(personId))).resolves.toEqual({
      status: 'canonical',
      slug: 'synthetic-survivor-lab',
    });
  });

  it('stays ambiguous when two live rows compete, whatever residue sits beside them', async () => {
    const personId = await seedPerson();
    for (const slug of ['synthetic-first-home', 'synthetic-second-home']) {
      await seedLeadEdge({
        personId,
        rowId: await seedRow({ slug, archived: false }),
        archived: false,
      });
    }
    const loser = await seedRow({ slug: 'synthetic-merged-loser', archived: true });
    await seedLeadEdge({ personId, rowId: loser, archived: true });

    await expect(resolveCanonicalResearchHomeForResearcher(String(personId))).resolves.toEqual({
      status: 'ambiguous',
    });
  });

  it('stays ineligible when an archived or historical lead edge sits on a live row', async () => {
    const detached = await seedPerson();
    const home = await seedRow({ slug: 'synthetic-home', archived: false });
    await seedLeadEdge({ personId: detached, rowId: home, archived: false });
    const otherLive = await seedRow({ slug: 'synthetic-other-live', archived: false });
    await seedLeadEdge({ personId: detached, rowId: otherLive, archived: true });

    const former = await seedPerson();
    await seedLeadEdge({ personId: former, rowId: home, archived: false });
    await seedLeadEdge({ personId: former, rowId: otherLive, archived: false, state: 'HISTORICAL' });

    await expect(resolveCanonicalResearchHomeForResearcher(String(detached))).resolves.toEqual({
      status: 'ineligible',
    });
    await expect(resolveCanonicalResearchHomeForResearcher(String(former))).resolves.toEqual({
      status: 'ineligible',
    });
  });

  it('stays ineligible when every lead edge sits on an archived row', async () => {
    const personId = await seedPerson();
    const loser = await seedRow({ slug: 'synthetic-merged-loser', archived: true });
    await seedLeadEdge({ personId, rowId: loser, archived: true });

    await expect(resolveCanonicalResearchHomeForResearcher(String(personId))).resolves.toEqual({
      status: 'ineligible',
    });
  });
});

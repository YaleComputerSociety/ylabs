import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadRosterOwnerKeyRows } from '../rosterOwnerKeyRows';

const OWNER_KEY = 'netid:ada.alpha';
const PREFIX = 'dept-synthetic-alpha-';
const prefixFor = (slug: string) =>
  slug.startsWith('dept-synthetic-') ? slug.split('-').slice(0, 3).join('-') + '-' : '';

describe('the owner key reaches the live row its folded roster rows survive in (#6536)', () => {
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
    const db = mongoose.connection.db!;
    for (const name of ['observations', 'researchentities', 'research_entities']) {
      await db.collection(name).deleteMany({});
    }
  });

  const entities = () => mongoose.connection.db!.collection('research_entities');
  const row = async (slug: string, fields: Record<string, unknown>) => {
    const _id = new mongoose.Types.ObjectId();
    await entities().insertOne({
      _id,
      slug,
      name: slug,
      entityType: 'FACULTY_RESEARCH_AREA',
      ...fields,
    });
    return _id;
  };
  const ownerKeyOn = (slug: string, ownerKey = OWNER_KEY) =>
    mongoose.connection.db!.collection('observations').insertOne({
      entityType: 'researchEntity',
      entityKey: slug,
      field: 'inferredPiUserKey',
      value: ownerKey,
      sourceName: 'dept-faculty-roster',
      superseded: false,
    });
  const survivorsFor = async (ownerKey = OWNER_KEY) =>
    ((await loadRosterOwnerKeyRows(prefixFor, () => '')).get(ownerKey) ?? [])
      .filter((candidate) => candidate.foldSurvivor)
      .map((candidate) => candidate.slug);

  it('follows a fold of a fold to the final live row', async () => {
    const final = await row('synthetic-canonical-lab', { archived: false });
    const middle = await row('synthetic-middle-row', { archived: true, canonicalGroupId: final });
    await row(`${PREFIX}ada-alpha`, { archived: true, canonicalGroupId: middle });
    await ownerKeyOn(`${PREFIX}ada-alpha`);

    expect(await survivorsFor()).toEqual(['synthetic-canonical-lab']);
  });

  it('lists no survivor when the owner key reaches two distinct live rows', async () => {
    const first = await row('synthetic-first-lab', { archived: false });
    const second = await row('synthetic-second-lab', { archived: false });
    await row(`${PREFIX}ada-alpha`, { archived: true, canonicalGroupId: first });
    await row('dept-synthetic-beta-ada-alpha', { archived: true, canonicalGroupId: second });
    await ownerKeyOn(`${PREFIX}ada-alpha`);
    await ownerKeyOn('dept-synthetic-beta-ada-alpha');

    expect(await survivorsFor()).toEqual([]);
  });

  it('lists no survivor that is not a person-scoped row', async () => {
    const center = await row('synthetic-center', { archived: false, entityType: 'CENTER' });
    await row(`${PREFIX}ada-alpha`, { archived: true, canonicalGroupId: center });
    await ownerKeyOn(`${PREFIX}ada-alpha`);

    expect(await survivorsFor()).toEqual([]);
  });

  it('lists no survivor for a fold chain that loops', async () => {
    const a = new mongoose.Types.ObjectId();
    const b = new mongoose.Types.ObjectId();
    await entities().insertMany([
      {
        _id: a,
        slug: 'synthetic-loop-a',
        entityType: 'FACULTY_RESEARCH_AREA',
        archived: true,
        canonicalGroupId: b,
      },
      {
        _id: b,
        slug: 'synthetic-loop-b',
        entityType: 'FACULTY_RESEARCH_AREA',
        archived: true,
        canonicalGroupId: a,
      },
    ]);
    await row(`${PREFIX}ada-alpha`, { archived: true, canonicalGroupId: a });
    await ownerKeyOn(`${PREFIX}ada-alpha`);

    expect(await survivorsFor()).toEqual([]);
  });

  it('never lists a survivor under a name-only key', async () => {
    const final = await row('synthetic-canonical-lab', { archived: false });
    await row(`${PREFIX}ada-alpha`, { archived: true, canonicalGroupId: final });
    await ownerKeyOn(`${PREFIX}ada-alpha`, 'dept:synthetic-alpha:ada-alpha');

    expect(await survivorsFor('dept:synthetic-alpha:ada-alpha')).toEqual([]);
  });
});

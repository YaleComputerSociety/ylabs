import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { defaultEmeritusLeadResolver } from '../sources/departmentEmeritusListingScraper';

const PAGE = { department: 'Physics', url: 'https://physics.example.edu/people/emeriti' };
const PROFILE = 'https://physics.example.edu/profile/avery-synthetic';

describe('defaultEmeritusLeadResolver (#5835)', () => {
  let replSet: MongoMemoryReplSet;
  const ids = { avery: new mongoose.Types.ObjectId(), row: new mongoose.Types.ObjectId() };

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
    for (const name of ['researchers', 'research_entities', 'role_assignments', 'observations']) {
      await db.collection(name).deleteMany({});
    }
    await db.collection('researchers').insertOne({
      _id: ids.avery,
      displayName: 'Avery Synthetic',
      profile: { title: 'Professor of Physics' },
      profileLinks: [{ kind: 'YALE_OFFICIAL', url: PROFILE }],
      archived: false,
    });
    await db.collection('research_entities').insertOne({
      _id: ids.row,
      slug: 'avery-row',
      entityType: 'FACULTY_RESEARCH_AREA',
      departments: ['Physics'],
      archived: false,
    });
    await db.collection('role_assignments').insertOne({
      personId: ids.avery,
      target: { kind: 'RESEARCH_ENTITY', id: ids.row },
      role: 'PI',
      state: 'CURRENT',
      archived: false,
    });
  });

  const counts = async () => {
    const db = mongoose.connection.db!;
    return Promise.all(
      ['researchers', 'research_entities', 'role_assignments'].map((name) =>
        db.collection(name).countDocuments({}),
      ),
    );
  };

  it('records a listed lead whose stored title nothing still asserts', async () => {
    await expect(
      defaultEmeritusLeadResolver({ name: 'Avery Synthetic', profileUrl: PROFILE }, PAGE),
    ).resolves.toEqual({ researcherId: String(ids.avery), slug: 'avery-row' });
  });

  it('leaves a listed lead to a current title a live lane still asserts', async () => {
    await mongoose.connection.db!.collection('observations').insertOne({
      entityType: 'user',
      entityKey: 'netid:fx1',
      field: 'title',
      value: 'Professor of Physics',
      sourceName: 'dept-faculty-roster',
      superseded: false,
      observedAt: new Date('2026-11-01T00:00:00Z'),
    });
    await expect(
      defaultEmeritusLeadResolver({ name: 'Avery Synthetic', profileUrl: PROFILE }, PAGE),
    ).resolves.toBeNull();
  });

  it('lets the listing outrank a title only the Yale directory still asserts', async () => {
    await mongoose.connection.db!.collection('observations').insertOne({
      entityType: 'user',
      entityKey: 'fx1',
      field: 'title',
      value: 'Professor of Physics',
      sourceName: 'yale-directory',
      superseded: false,
      observedAt: new Date('2026-11-01T00:00:00Z'),
    });
    await expect(
      defaultEmeritusLeadResolver({ name: 'Avery Synthetic', profileUrl: PROFILE }, PAGE),
    ).resolves.toEqual({ researcherId: String(ids.avery), slug: 'avery-row' });
  });

  it('creates no row, edge or person for someone listed only on an emeritus page', async () => {
    const before = await counts();
    await expect(
      defaultEmeritusLeadResolver({ name: 'Nobody Fixture-Listed' }, PAGE),
    ).resolves.toBeNull();
    expect(await counts()).toEqual(before);
  });
});

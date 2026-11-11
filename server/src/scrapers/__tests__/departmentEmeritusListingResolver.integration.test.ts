import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { defaultEmeritusLeadResolver } from '../sources/departmentEmeritusListingScraper';

const PAGE = { department: 'Physics', url: 'https://physics.example.edu/people/emeriti' };
const PROFILE = 'https://physics.example.edu/profile/avery-synthetic';

describe('defaultEmeritusLeadResolver (#5835)', () => {
  let replSet: MongoMemoryReplSet;
  const ids = {
    avery: new mongoose.Types.ObjectId(),
    row: new mongoose.Types.ObjectId(),
    center: new mongoose.Types.ObjectId(),
  };

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
      identifiers: { netid: 'fx1' },
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

  const titleObservation = (entityKey: string, sourceName = 'dept-faculty-roster') =>
    mongoose.connection.db!.collection('observations').insertOne({
      entityType: 'user',
      entityKey,
      field: 'title',
      value: 'Professor of Physics',
      sourceName,
      superseded: false,
      observedAt: new Date('2026-11-01T00:00:00Z'),
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
    ).resolves.toEqual({ researcherId: String(ids.avery), slugs: ['avery-row'] });
  });

  it('records the listing on every row the lead still leads', async () => {
    const db = mongoose.connection.db!;
    await db.collection('research_entities').insertOne({
      _id: ids.center,
      slug: 'avery-center',
      entityType: 'CENTER',
      departments: ['Physics'],
      archived: false,
    });
    await db.collection('role_assignments').insertOne({
      personId: ids.avery,
      target: { kind: 'RESEARCH_ENTITY', id: ids.center },
      role: 'DIRECTOR',
      state: 'CURRENT',
      archived: false,
    });
    await expect(
      defaultEmeritusLeadResolver({ name: 'Avery Synthetic', profileUrl: PROFILE }, PAGE),
    ).resolves.toEqual({ researcherId: String(ids.avery), slugs: ['avery-center', 'avery-row'] });
  });

  it('leaves a listed lead to a current title a live lane still asserts about them', async () => {
    await titleObservation('netid:fx1');
    await expect(
      defaultEmeritusLeadResolver({ name: 'Avery Synthetic', profileUrl: PROFILE }, PAGE),
    ).resolves.toBeNull();
  });

  it('does not let another person asserting the same title hold the listing back', async () => {
    await titleObservation('netid:other9');
    await expect(
      defaultEmeritusLeadResolver({ name: 'Avery Synthetic', profileUrl: PROFILE }, PAGE),
    ).resolves.toEqual({ researcherId: String(ids.avery), slugs: ['avery-row'] });
  });

  it('lets the listing outrank a title only the Yale directory still asserts', async () => {
    await titleObservation('netid:fx1', 'yale-directory');
    await expect(
      defaultEmeritusLeadResolver({ name: 'Avery Synthetic', profileUrl: PROFILE }, PAGE),
    ).resolves.toEqual({ researcherId: String(ids.avery), slugs: ['avery-row'] });
  });

  it('creates no row, edge or person for someone listed only on an emeritus page', async () => {
    const before = await counts();
    await expect(
      defaultEmeritusLeadResolver({ name: 'Nobody Fixture-Listed' }, PAGE),
    ).resolves.toBeNull();
    expect(await counts()).toEqual(before);
  });
});

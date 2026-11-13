import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { defaultOwnProfileEmeritusLeadFinder } from '../sources/departmentEmeritusListingScraper';

const CENTER_PAGE = 'https://center.example.edu/people';
const profile = (name: string) => `https://fixtures.example.edu/profile/${name}`;

describe('defaultOwnProfileEmeritusLeadFinder (#6081)', () => {
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
    for (const name of ['researchers', 'research_entities', 'role_assignments', 'observations']) {
      await db.collection(name).deleteMany({});
    }
  });

  const lead = async (name: string, identifiers: Record<string, string> = {}) => {
    const db = mongoose.connection.db!;
    const personId = new mongoose.Types.ObjectId();
    const rowId = new mongoose.Types.ObjectId();
    await db.collection('researchers').insertOne({
      _id: personId,
      displayName: `Synthetic ${name}`,
      profile: { title: 'Professor of Fixture Studies' },
      identifiers,
      profileLinks: [{ kind: 'YALE_OFFICIAL', url: profile(name) }],
      archived: false,
    });
    await db.collection('research_entities').insertOne({
      _id: rowId,
      slug: `${name}-row`,
      entityType: 'FACULTY_RESEARCH_AREA',
      archived: false,
    });
    await db.collection('role_assignments').insertOne({
      personId,
      target: { kind: 'RESEARCH_ENTITY', id: rowId },
      role: 'PI',
      state: 'CURRENT',
      archived: false,
    });
    return String(personId);
  };

  const titleRead = (fields: Record<string, unknown>) =>
    mongoose.connection.db!.collection('observations').insertOne({
      superseded: false,
      observedAt: new Date('2026-11-11T00:00:00Z'),
      ...fields,
    });

  const memberStatesProfile = (entityKey: string, url: string) =>
    titleRead({
      entityType: 'researchGroupMember',
      entityKey,
      field: 'profileUrl',
      value: url,
      sourceName: 'centers-institutes-index',
      sourceUrl: CENTER_PAGE,
    });

  it('records a lead whose own profile page the center lane read as emeritus only', async () => {
    const id = await lead('avery');
    await memberStatesProfile('center-fixture:avery', profile('avery'));
    await titleRead({
      entityType: 'researchGroupMember',
      entityKey: 'center-fixture:avery',
      field: 'profileTitle',
      value: 'Professor Emeritus of Fixture Studies',
      sourceName: 'centers-institutes-index',
      sourceUrl: profile('avery'),
    });

    await expect(defaultOwnProfileEmeritusLeadFinder()).resolves.toEqual([
      { researcherId: id, slugs: ['avery-row'] },
    ]);
  });

  it('weighs only reads of the person own page, not a fresher current title on another page', async () => {
    const id = await lead('erin');
    await memberStatesProfile('center-fixture:erin', profile('erin'));
    await titleRead({
      entityType: 'researchGroupMember',
      entityKey: 'center-fixture:erin',
      field: 'profileTitle',
      value: 'Professor Emeritus of Fixture Studies',
      sourceName: 'centers-institutes-index',
      sourceUrl: profile('erin'),
      observedAt: new Date('2026-06-05T00:00:00Z'),
    });
    await titleRead({
      entityType: 'researchGroupMember',
      entityKey: 'center-fixture:someone-else',
      field: 'title',
      value: 'Professor of Fixture Studies',
      sourceName: 'centers-institutes-index',
      sourceUrl: CENTER_PAGE,
    });

    await expect(defaultOwnProfileEmeritusLeadFinder()).resolves.toEqual([
      { researcherId: id, slugs: ['erin-row'] },
    ]);
  });

  it('counts a roster read whose row states the page in its keyed profile URLs', async () => {
    const id = await lead('indigo');
    await titleRead({
      entityType: 'user',
      entityKey: 'dept:fixture:indigo',
      field: 'title',
      value: 'Professor Emeritus of Fixture Studies',
      sourceName: 'dept-faculty-roster',
      sourceUrl: profile('indigo'),
    });
    await titleRead({
      entityType: 'user',
      entityKey: 'dept:fixture:indigo',
      field: 'profileUrls',
      value: { departmental: profile('indigo') },
      sourceName: 'dept-faculty-roster',
      sourceUrl: CENTER_PAGE,
    });

    await expect(defaultOwnProfileEmeritusLeadFinder()).resolves.toEqual([
      { researcherId: id, slugs: ['indigo-row'] },
    ]);
  });

  it('never counts a colleague card title on a shared page in the person profile links', async () => {
    const db = mongoose.connection.db!;
    const shared = 'https://lab.example.edu/people';
    await lead('harper');
    await db
      .collection('researchers')
      .updateOne(
        { displayName: 'Synthetic harper' },
        { $push: { profileLinks: { kind: 'LAB_SITE', url: shared } } as never },
      );
    await titleRead({
      entityType: 'researchGroupMember',
      entityKey: 'lab-fixture:colleague',
      field: 'title',
      value: 'Professor Emeritus of Fixture Studies',
      sourceName: 'official-research-home-roster',
      sourceUrl: shared,
    });
    await titleRead({
      entityType: 'researchGroupMember',
      entityKey: 'lab-fixture:colleague',
      field: 'profileUrl',
      value: 'https://fixtures.example.edu/profile/colleague',
      sourceName: 'official-research-home-roster',
      sourceUrl: shared,
    });

    await expect(defaultOwnProfileEmeritusLeadFinder()).resolves.toEqual([]);
  });

  it('ignores an emeritus title read from a center page rather than the person own page', async () => {
    await lead('blair');
    await titleRead({
      entityType: 'researchGroupMember',
      entityKey: 'center-fixture:blair',
      field: 'title',
      value: 'Professor Emeritus of Fixture Studies',
      sourceName: 'centers-institutes-index',
      sourceUrl: CENTER_PAGE,
    });

    await expect(defaultOwnProfileEmeritusLeadFinder()).resolves.toEqual([]);
  });

  it('never records a lead from a captured navigation menu in the profile lane', async () => {
    await lead('casey', { netid: 'fx3' });
    await titleRead({
      entityType: 'user',
      entityKey: 'netid:fx3',
      field: 'title',
      value: 'Faculty Directory Emeritus Faculty Part Time Lecturers Staff Directory',
      sourceName: 'official-profile-pi-backfill',
      sourceUrl: profile('casey'),
    });

    await expect(defaultOwnProfileEmeritusLeadFinder()).resolves.toEqual([]);
  });

  it('lets a fresher current appointment on the own page win over an older emeritus read', async () => {
    await lead('drew', { netid: 'fx4' });
    await memberStatesProfile('center-fixture:drew', profile('drew'));
    await titleRead({
      entityType: 'researchGroupMember',
      entityKey: 'center-fixture:drew',
      field: 'profileTitle',
      value: 'Professor Emeritus of Fixture Studies',
      sourceName: 'centers-institutes-index',
      sourceUrl: profile('drew'),
      observedAt: new Date('2026-06-05T00:00:00Z'),
    });
    await titleRead({
      entityType: 'user',
      entityKey: 'netid:fx4',
      field: 'title',
      value: 'Professor of Fixture Studies',
      sourceName: 'official-profile-pi-backfill',
      sourceUrl: profile('drew'),
    });

    await expect(defaultOwnProfileEmeritusLeadFinder()).resolves.toEqual([]);
  });

  const rosterMember = async (
    entityKey: string,
    listedName: { fname: string; lname: string },
    evidence: Record<string, unknown>,
  ) => {
    await titleRead({
      entityType: 'researchGroupMember',
      entityKey,
      field: 'profileTitle',
      value: 'Professor Emeritus of Fixture Studies',
      sourceName: 'centers-institutes-index',
      sourceUrl: `${CENTER_PAGE}/${entityKey}`,
    });
    await titleRead({
      entityType: 'researchGroupMember',
      entityKey,
      field: 'inferredUserName',
      value: listedName,
      sourceName: 'centers-institutes-index',
      sourceUrl: CENTER_PAGE,
    });
    await titleRead({
      entityType: 'researchGroupMember',
      entityKey,
      field: 'profileIdentityEvidence',
      value: { pageUrl: `${CENTER_PAGE}/${entityKey}`, linkedProfileUrls: [], ...evidence },
      sourceName: 'centers-institutes-index',
      sourceUrl: CENTER_PAGE,
    });
  };

  it('records a lead whose roster profile page states their netid and an agreeing name', async () => {
    const id = await lead('frankie', { netid: 'fx5' });
    await rosterMember(
      'center-fixture:frankie',
      { fname: 'Synthetic', lname: 'Frankie' },
      {
        netids: ['fx5'],
        emails: [],
      },
    );

    await expect(defaultOwnProfileEmeritusLeadFinder()).resolves.toEqual([
      { researcherId: id, slugs: ['frankie-row'] },
    ]);
  });

  it('records a lead whose roster profile page states their Yale email and an agreeing name', async () => {
    const id = await lead('gale', { email: 'fixture.gale@yale.edu' });
    await rosterMember(
      'center-fixture:gale',
      { fname: 'Synthetic', lname: 'Gale' },
      {
        netids: [],
        emails: ['fixture.gale@yale.edu'],
      },
    );

    await expect(defaultOwnProfileEmeritusLeadFinder()).resolves.toEqual([
      { researcherId: id, slugs: ['gale-row'] },
    ]);
  });

  it('ignores a roster profile page whose listed name disagrees with the netid holder', async () => {
    await lead('harper', { netid: 'fx6' });
    await rosterMember(
      'center-fixture:harper',
      { fname: 'Unrelated', lname: 'Person' },
      {
        netids: ['fx6'],
        emails: [],
      },
    );

    await expect(defaultOwnProfileEmeritusLeadFinder()).resolves.toEqual([]);
  });

  it('ignores a roster profile page whose netid two live researchers hold', async () => {
    await lead('indy', { netid: 'fx7' });
    await lead('indy-twin', { netid: 'fx7' });
    await rosterMember(
      'center-fixture:indy',
      { fname: 'Synthetic', lname: 'Indy' },
      {
        netids: ['fx7'],
        emails: [],
      },
    );

    await expect(defaultOwnProfileEmeritusLeadFinder()).resolves.toEqual([]);
  });
});

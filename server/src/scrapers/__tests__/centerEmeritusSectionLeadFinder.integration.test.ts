import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DepartmentEmeritusListingScraper,
  defaultCenterEmeritusSectionLeadFinder,
} from '../sources/departmentEmeritusListingScraper';
import type { ObservationInput, ScraperContext } from '../types';

const CENTER_PAGE = 'https://fixturecenter.yale.edu/people';
const OFF_YALE_CENTER_PAGE = 'https://fixture-center.example.org/people';
const profile = (name: string) => `https://fixtures.yale.edu/profile/${name}`;

describe('defaultCenterEmeritusSectionLeadFinder (#6162)', () => {
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

  const person = async (
    name: string,
    { leads = true, title = 'Professor of Fixture Studies' } = {},
  ) => {
    const db = mongoose.connection.db!;
    const personId = new mongoose.Types.ObjectId();
    await db.collection('researchers').insertOne({
      _id: personId,
      displayName: `Synthetic ${name}`,
      profile: { title },
      identifiers: { netid: `zz${name.length}${name}` },
      profileLinks: [{ kind: 'YALE_OFFICIAL', url: profile(name) }],
      archived: false,
    });
    if (leads) {
      const rowId = new mongoose.Types.ObjectId();
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
    }
    return String(personId);
  };

  const observe = (fields: Record<string, unknown>) =>
    mongoose.connection.db!.collection('observations').insertOne({
      superseded: false,
      observedAt: new Date('2026-11-14T00:00:00Z'),
      ...fields,
    });

  const centerListing = async (
    name: string,
    {
      status = 'emeritus',
      label = 'Emeritus Faculty' as string | null,
      sourceUrl = CENTER_PAGE,
      bindBy = 'evidence' as 'evidence' | 'profileLink',
      listedLast = name,
      sourceName = 'centers-institutes-index',
    } = {},
  ) => {
    const entityKey = `center-fixture:synthetic-${name}`;
    const member = { entityType: 'researchGroupMember', entityKey, sourceName, sourceUrl };
    await observe({
      ...member,
      field: 'inferredUserName',
      value: { fname: 'Synthetic', lname: listedLast },
    });
    await observe({ ...member, field: 'currentStatus', value: status });
    if (label) await observe({ ...member, field: 'sectionLabel', value: label });
    if (bindBy === 'evidence') {
      await observe({
        ...member,
        field: 'profileIdentityEvidence',
        value: { pageUrl: profile(name), netids: [`zz${name.length}${name}`] },
      });
    } else {
      await observe({ ...member, field: 'profileUrl', value: profile(name) });
    }
    return entityKey;
  };

  it('marks a lead an official center lists in its Emeritus section, on the row they lead', async () => {
    const id = await person('avery');
    await centerListing('avery');

    await expect(defaultCenterEmeritusSectionLeadFinder()).resolves.toEqual([
      { researcherId: id, slugs: ['avery-row'] },
    ]);
  });

  it('binds a member by a profile link exactly one researcher holds under the listed name', async () => {
    const id = await person('blake');
    await centerListing('blake', { bindBy: 'profileLink' });
    await person('casey');
    await centerListing('casey', { bindBy: 'profileLink', listedLast: 'Someone Else' });

    await expect(defaultCenterEmeritusSectionLeadFinder()).resolves.toEqual([
      { researcherId: id, slugs: ['blake-row'] },
    ]);
  });

  it('leaves a lead whose own page the roster lane read as a current appointment', async () => {
    await person('dana');
    await centerListing('dana', { status: 'current' });

    await expect(defaultCenterEmeritusSectionLeadFinder()).resolves.toEqual([]);
  });

  it('leaves a lead the roster lane read as current beside an earlier live emeritus reading', async () => {
    await person('drew');
    const entityKey = await centerListing('drew');
    await observe({
      entityType: 'researchGroupMember',
      entityKey,
      sourceName: 'centers-institutes-index',
      sourceUrl: CENTER_PAGE,
      field: 'currentStatus',
      value: 'current',
      observedAt: new Date('2026-11-15T00:00:00Z'),
    });

    await expect(defaultCenterEmeritusSectionLeadFinder()).resolves.toEqual([]);
  });

  it('leaves a lead whose current title a live lane other than the directory asserts', async () => {
    const title = 'Professor of Fixture Studies';
    await person('ellis', { title });
    await centerListing('ellis');
    await observe({
      entityType: 'user',
      entityKey: 'netid:zz5ellis',
      field: 'title',
      value: title,
      sourceName: 'official-profile',
      sourceUrl: profile('ellis'),
    });

    await expect(defaultCenterEmeritusSectionLeadFinder()).resolves.toEqual([]);
  });

  it('still marks a lead whose only asserted title is the directory HR record', async () => {
    const title = 'Professor of Fixture Studies';
    const id = await person('flynn', { title });
    await centerListing('flynn');
    await observe({
      entityType: 'user',
      entityKey: 'netid:zz5flynn',
      field: 'title',
      value: title,
      sourceName: 'yale-directory',
      sourceUrl: profile('flynn'),
    });

    await expect(defaultCenterEmeritusSectionLeadFinder()).resolves.toEqual([
      { researcherId: id, slugs: ['flynn-row'] },
    ]);
  });

  it('ignores an emeritus status that was withdrawn and rolled back', async () => {
    await person('morgan');
    const entityKey = await centerListing('morgan');
    await mongoose.connection
      .db!.collection('observations')
      .updateMany(
        { entityKey, field: 'currentStatus' },
        {
          $set: { superseded: true, rollback: { rolledBackAt: new Date('2026-11-15T00:00:00Z') } },
        },
      );

    await expect(defaultCenterEmeritusSectionLeadFinder()).resolves.toEqual([]);
  });

  it('never mints: a listed person who leads no row is recorded nowhere', async () => {
    await person('gray', { leads: false });
    await centerListing('gray');

    await expect(defaultCenterEmeritusSectionLeadFinder()).resolves.toEqual([]);
  });

  it('ignores a center page that is not an official Yale page', async () => {
    await person('harper');
    await centerListing('harper', { sourceUrl: OFF_YALE_CENTER_PAGE });

    await expect(defaultCenterEmeritusSectionLeadFinder()).resolves.toEqual([]);
  });

  it('ignores an emeritus status with no or a blank section label, and one from another lane', async () => {
    await person('indigo');
    await centerListing('indigo', { label: null });
    await person('iris');
    await centerListing('iris', { label: '   ' });
    await person('jules');
    await centerListing('jules', { sourceName: 'center-affiliation-roster' });

    await expect(defaultCenterEmeritusSectionLeadFinder()).resolves.toEqual([]);
  });

  it('ignores a member-page title that holds only emeritus appointments without a section (#6084 Q6)', async () => {
    await person('kai');
    const entityKey = await centerListing('kai', { status: 'current', label: null });
    await observe({
      entityType: 'researchGroupMember',
      entityKey,
      field: 'profileTitle',
      value: 'Professor Emeritus of Fixture Studies',
      sourceName: 'centers-institutes-index',
      sourceUrl: CENTER_PAGE,
    });

    await expect(defaultCenterEmeritusSectionLeadFinder()).resolves.toEqual([]);
  });

  it('records the center listing as emeritusListedLeadIds on the lead row and nothing else', async () => {
    const id = await person('lane');
    await centerListing('lane');
    const emitted: ObservationInput[] = [];
    const scraper = new DepartmentEmeritusListingScraper({
      pages: [],
      ownProfileLeadFinder: async () => [],
      storedListingFinder: async () => new Map(),
    });

    await scraper.run({
      options: {},
      emit: async (observation: ObservationInput) => {
        emitted.push(observation);
      },
      log: () => undefined,
    } as unknown as ScraperContext);

    expect(emitted).toEqual([
      {
        entityType: 'researchEntity',
        entityKey: 'lane-row',
        field: 'emeritusListedLeadIds',
        value: [id],
      },
    ]);
  });
});

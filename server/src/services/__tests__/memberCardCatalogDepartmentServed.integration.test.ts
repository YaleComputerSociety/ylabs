import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const meiliMocks = vi.hoisted(() => ({
  syncEntities: vi.fn(async () => {}),
  syncEntity: vi.fn(async () => {}),
  deleteFromIndex: vi.fn(async () => {}),
}));

vi.mock('../meiliSyncService', () => ({
  syncEntities: meiliMocks.syncEntities,
  syncEntity: meiliMocks.syncEntity,
  deleteFromIndex: meiliMocks.deleteFromIndex,
}));

import { getResearchGroupDetail } from '../researchGroupService';
import { resetOrgUnitCanonicalizerCache } from '../../scrapers/orgUnitCanonicalization';

const SLUG = 'fixture-member-card-catalog-department';
const CATALOG_NAME = 'English Language & Literature';

const servedMembers = async () => {
  resetOrgUnitCanonicalizerCache();
  const detail = await getResearchGroupDetail(SLUG);
  return (detail?.members ?? []) as Array<{ role: string; user: Record<string, any> }>;
};

describe('a member card serves its department under the catalog name (#6380)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    resetOrgUnitCanonicalizerCache();
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['research_entities', 'role_assignments', 'researchers', 'signals', 'org_units']) {
      await db.collection(name).deleteMany({});
    }
    const sourceUrl = 'https://english.example.edu/research/fixture-lab/';
    const entityId = new mongoose.Types.ObjectId();
    await db.collection('research_entities').insertOne({
      _id: entityId,
      slug: SLUG,
      name: 'Fixture Narrative Lab',
      kind: 'lab',
      entityType: 'LAB',
      archived: false,
      departments: [CATALOG_NAME],
      researchAreas: ['Narrative Theory'],
      studentVisibilityTier: 'student_ready',
      studentVisibilityReasons: ['source_backed_description'],
      shortDescription: 'Studies how narrative form shapes reading.',
      fullDescription: 'The lab studies how narrative form shapes reading across periods and media.',
      websiteUrl: sourceUrl,
      sourceUrls: [sourceUrl],
      fieldProvenance: {
        shortDescription: { sourceName: 'fixture-faculty', sourceUrl },
        fullDescription: { sourceName: 'fixture-faculty', sourceUrl },
      },
    });
    const members = [
      { name: 'Avery Fixture', netid: 'fixturecard1', role: 'PI', department: 'English' },
      {
        name: 'Blair Fixture',
        netid: 'fixturecard2',
        role: 'CO_PI',
        department: 'Synthetic Unlisted Program',
      },
    ];
    for (const member of members) {
      const personId = new mongoose.Types.ObjectId();
      const [firstName, lastName] = member.name.split(' ');
      await db.collection('researchers').insertOne({
        _id: personId,
        displayName: member.name,
        firstName,
        lastName,
        identifiers: { netid: member.netid },
        profile: { primaryDepartment: member.department },
        archived: false,
      });
      await db.collection('role_assignments').insertOne({
        personId,
        target: { kind: 'RESEARCH_ENTITY', id: entityId },
        role: member.role,
        state: 'CURRENT',
        archived: false,
        verifiedAt: new Date(),
        source: { name: 'fixture-faculty', url: sourceUrl },
      });
    }
  });

  const seedCatalog = async () => {
    await mongoose.connection.db!.collection('org_units').insertOne({
      slug: 'english',
      name: CATALOG_NAME,
      kind: 'DEPARTMENT',
      aliases: ['English'],
      status: 'ACTIVE',
      archived: false,
    });
  };

  it('serves the catalog name for a resolving spelling and passes an unknown value through', async () => {
    await seedCatalog();
    const members = await servedMembers();
    const departments = Object.fromEntries(
      members.map((member) => [member.user.displayName, member.user.primaryDepartment]),
    );

    expect(departments['Avery Fixture']).toBe(CATALOG_NAME);
    expect(departments['Blair Fixture']).toBe('Synthetic Unlisted Program');
    const avery = members.find((member) => member.user.displayName === 'Avery Fixture');
    expect(avery?.user.primary_department).toBe(CATALOG_NAME);
  }, 30000);

  it('leaves member order and same-person dedupe as they are without the catalog', async () => {
    const withoutCatalog = (await servedMembers()).map(
      (member) => `${member.role}:${member.user.displayName}`,
    );
    await seedCatalog();
    const withCatalog = (await servedMembers()).map(
      (member) => `${member.role}:${member.user.displayName}`,
    );

    expect(withoutCatalog.length).toBe(2);
    expect(withCatalog).toEqual(withoutCatalog);
  }, 30000);
});

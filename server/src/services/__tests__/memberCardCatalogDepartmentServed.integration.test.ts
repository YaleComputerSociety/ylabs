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

const CATALOG_NAME = 'German';
const ALIAS = 'Germanic Languages & Literatures';
const SOURCE_URL = 'https://german.example.edu/research/fixture-lab/';

interface FixtureMember {
  name: string;
  netid: string;
  role: string;
  department: string;
  title?: string;
  imageUrl?: string;
  rosterSourceUrl?: string;
}

const seedEntity = async (slug: string, departments: string[], members: FixtureMember[]) => {
  const db = mongoose.connection.db!;
  const entityId = new mongoose.Types.ObjectId();
  await db.collection('research_entities').insertOne({
    _id: entityId,
    slug,
    name: 'Fixture Philology Lab',
    kind: 'lab',
    entityType: 'LAB',
    archived: false,
    departments,
    researchAreas: ['Historical Linguistics'],
    studentVisibilityTier: 'student_ready',
    studentVisibilityReasons: ['source_backed_description'],
    shortDescription: 'Studies how sound change spreads through a language.',
    fullDescription: 'The lab studies how sound change spreads through a language over centuries.',
    websiteUrl: SOURCE_URL,
    sourceUrls: [SOURCE_URL],
    fieldProvenance: {
      shortDescription: { sourceName: 'fixture-faculty', sourceUrl: SOURCE_URL },
      fullDescription: { sourceName: 'fixture-faculty', sourceUrl: SOURCE_URL },
    },
  });
  for (const member of members) {
    const personId = new mongoose.Types.ObjectId();
    const [firstName, lastName] = member.name.split(' ');
    await db.collection('researchers').insertOne({
      _id: personId,
      displayName: member.name,
      firstName,
      lastName,
      identifiers: { netid: member.netid },
      profile: {
        primaryDepartment: member.department,
        ...(member.title ? { title: member.title } : {}),
        ...(member.imageUrl ? { imageUrl: member.imageUrl } : {}),
      },
      archived: false,
    });
    await db.collection('role_assignments').insertOne({
      personId,
      target: { kind: 'RESEARCH_ENTITY', id: entityId },
      role: member.role,
      state: 'CURRENT',
      archived: false,
      confidence: 0.5,
      verifiedAt: new Date(),
      source: { name: 'fixture-faculty', url: SOURCE_URL },
      ...(member.rosterSourceUrl
        ? { rosterProvenance: { sourceName: 'fixture-faculty', sourceUrl: member.rosterSourceUrl } }
        : {}),
    });
  }
};

const seedCatalog = async () => {
  await mongoose.connection.db!.collection('org_units').insertOne({
    slug: 'german',
    name: CATALOG_NAME,
    kind: 'DEPARTMENT',
    aliases: [ALIAS],
    status: 'ACTIVE',
    archived: false,
  });
};

const servedMembers = async (slug: string) => {
  resetOrgUnitCanonicalizerCache();
  const detail = await getResearchGroupDetail(slug);
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
    for (const name of [
      'research_entities',
      'role_assignments',
      'researchers',
      'signals',
      'org_units',
    ]) {
      await db.collection(name).deleteMany({});
    }
    await seedCatalog();
  });

  it('serves the catalog name for a resolving spelling and passes an unknown value through', async () => {
    await seedEntity(
      'fixture-card-catalog-name',
      [CATALOG_NAME],
      [
        { name: 'Avery Fixture', netid: 'fixturecard1', role: 'PI', department: ALIAS },
        {
          name: 'Blair Fixture',
          netid: 'fixturecard2',
          role: 'CO_PI',
          department: 'Synthetic Unlisted Program',
        },
      ],
    );
    const members = await servedMembers('fixture-card-catalog-name');
    const byName = Object.fromEntries(
      members.map((member) => [member.user.displayName, member.user]),
    );

    expect(byName['Avery Fixture'].primaryDepartment).toBe(CATALOG_NAME);
    expect(byName['Avery Fixture'].primary_department).toBe(CATALOG_NAME);
    expect(byName['Blair Fixture'].primaryDepartment).toBe('Synthetic Unlisted Program');
  }, 30000);

  it('keeps the same-name copy the stored spelling earns, not the one the catalog name would', async () => {
    await seedEntity(
      'fixture-card-dedupe-score',
      [CATALOG_NAME],
      [
        {
          name: 'Casey Fixture',
          netid: 'fixturecard3',
          role: 'PI',
          department: ALIAS,
          title: 'Synthetic Title Stored As Alias',
        },
        {
          name: 'Casey Fixture',
          netid: 'fixturecard4',
          role: 'PI',
          department: 'Synthetic Unlisted Program',
          title: 'Synthetic Title With Source Evidence',
          rosterSourceUrl: SOURCE_URL,
        },
      ],
    );
    const leads = (await servedMembers('fixture-card-dedupe-score')).filter(
      (member) => member.user.displayName === 'Casey Fixture',
    );

    expect(leads).toHaveLength(1);
    expect(leads[0].user.title).toBe('Synthetic Title With Source Evidence');
  }, 30000);

  it('keeps a PI and a director apart when only the catalog name would make their keys equal', async () => {
    const shared = {
      title: 'Synthetic Professor',
      imageUrl: 'https://german.example.edu/fixture.jpg',
    };
    await seedEntity(
      'fixture-card-same-person',
      [CATALOG_NAME],
      [
        { name: 'Drew Fixture', netid: 'fixturecard5', role: 'PI', department: ALIAS, ...shared },
        {
          name: 'Drew Fixture',
          netid: 'fixturecard6',
          role: 'DIRECTOR',
          department: CATALOG_NAME,
          ...shared,
        },
      ],
    );
    const drew = (await servedMembers('fixture-card-same-person')).filter(
      (member) => member.user.displayName === 'Drew Fixture',
    );

    expect(drew.map((member) => member.role).sort()).toEqual(['director', 'pi']);
    expect(drew.every((member) => member.user.primaryDepartment === CATALOG_NAME)).toBe(true);
  }, 30000);
});

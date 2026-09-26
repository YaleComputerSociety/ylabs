import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const meiliMocks = vi.hoisted(() => ({
  syncEntities: vi.fn(async () => {}),
  syncEntity: vi.fn(async () => {}),
  deleteFromIndex: vi.fn(async () => {}),
}));

vi.mock('../../services/meiliSyncService', () => ({
  syncEntities: meiliMocks.syncEntities,
  syncEntity: meiliMocks.syncEntity,
  deleteFromIndex: meiliMocks.deleteFromIndex,
}));

import { getResearchGroupDetail, PUBLIC_LEAD_ROLES } from '../../services/researchGroupService';
import { repointWrongPersonOfficialProfileLinks } from '../repointWrongPersonOfficialProfileLinks';

const SLUG = 'ysm-faculty-rosalind-quimby';
const OWN_PAGE = 'https://ysph.yale.edu/profile/rosalind-quimby/';
const STRANGER_PAGE = 'https://medicine.yale.edu/profile/desmond-quimby/';
const ROSTER_PAGE = 'https://medicine.yale.edu/profile/quimby/';
const SHORT_DESCRIPTION =
  'Studies neonatal care quality improvement across community hospital nurseries in Connecticut.';
const FULL_DESCRIPTION =
  'The lab studies neonatal care quality improvement across community hospital nurseries, combining bedside outcome audits, staffing and transfer pattern analysis, and implementation trials of standardized resuscitation protocols to reduce avoidable transfers to tertiary intensive care.';

const servedLeadProfileUrls = async (): Promise<Array<string | undefined>> => {
  const detail = await getResearchGroupDetail(SLUG);
  return (detail?.members || [])
    .filter((member) => PUBLIC_LEAD_ROLES.has(member.role))
    .map((member) => member.user?.profileUrls?.official as string | undefined);
};

const storedOfficialUrl = async (displayName: string): Promise<string | undefined> => {
  const db = mongoose.connection.db;
  if (!db) throw new Error('no db');
  const person = await db.collection('researchers').findOne({ displayName });
  return (person?.profileLinks || []).find(
    (link: Record<string, unknown>) => link.kind === 'YALE_OFFICIAL',
  )?.url;
};

describe("a record bound to another person's official profile stops serving it (#2989)", () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  const seedPerson = async (input: {
    displayName: string;
    officialUrl: string;
    netid?: string;
  }): Promise<mongoose.Types.ObjectId> => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    const personId = new mongoose.Types.ObjectId();
    await db.collection('researchers').insertOne({
      _id: personId,
      schemaVersion: 1,
      displayName: input.displayName,
      ...(input.netid ? { identifiers: { netid: input.netid } } : {}),
      profile: { title: 'Associate Professor' },
      status: 'ACTIVE',
      profileLinks: [
        {
          kind: 'YALE_OFFICIAL',
          purpose: 'PRIMARY_IDENTITY',
          url: input.officialUrl,
          verifiedAt: new Date('2026-08-31T17:22:00.000Z'),
          healthStatus: 'HEALTHY',
        },
      ],
      archived: false,
    });
    return personId;
  };

  const seedLeadEdge = async (input: {
    personId: mongoose.Types.ObjectId;
    entityId: mongoose.Types.ObjectId;
    profileUrl?: string;
  }) => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    await db.collection('role_assignments').insertOne({
      personId: input.personId,
      schemaVersion: 1,
      target: { kind: 'RESEARCH_ENTITY', id: input.entityId },
      role: 'PI',
      state: 'CURRENT',
      confidence: 0.9,
      reviewStatus: 'UNREVIEWED',
      archived: false,
      rosterProvenance: {
        sourceName: 'ysm-faculty',
        sourceUrl: ROSTER_PAGE,
        ...(input.profileUrl ? { profileUrl: input.profileUrl } : {}),
        observedAt: new Date(),
      },
    });
  };

  const seedEntity = async (input: {
    slug: string;
    name: string;
    rosterPage: string;
  }): Promise<mongoose.Types.ObjectId> => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    const entityId = new mongoose.Types.ObjectId();
    await db.collection('research_entities').insertOne({
      _id: entityId,
      slug: input.slug,
      name: input.name,
      displayName: input.name,
      kind: 'lab',
      entityType: 'LAB',
      archived: false,
      departments: ['Pediatrics'],
      researchAreas: ['Neonatology'],
      studentVisibilityTier: 'student_ready',
      studentVisibilityReasons: ['source_backed_description', 'concrete_next_step'],
      shortDescription: SHORT_DESCRIPTION,
      fullDescription: FULL_DESCRIPTION,
      websiteUrl: input.rosterPage,
      sourceUrls: [input.rosterPage],
      fieldProvenance: {
        shortDescription: { sourceName: 'ysm-faculty', sourceUrl: input.rosterPage },
        fullDescription: { sourceName: 'ysm-faculty', sourceUrl: input.rosterPage },
        displayName: { sourceName: 'ysm-faculty', sourceUrl: input.rosterPage },
      },
    });
    return entityId;
  };

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of [
      'research_entities',
      'role_assignments',
      'researchers',
      'visibility_release_queue_items',
      'signals',
      'observations',
    ]) {
      await db.collection(name).deleteMany({});
    }

    const entityId = await seedEntity({
      slug: SLUG,
      name: 'Quimby Neonatal Outcomes Lab',
      rosterPage: ROSTER_PAGE,
    });
    const graftedPersonId = await seedPerson({
      displayName: 'Rosalind Quimby',
      officialUrl: STRANGER_PAGE,
      netid: 'rq111',
    });
    await seedLeadEdge({ personId: graftedPersonId, entityId, profileUrl: OWN_PAGE });

    // The page's own person, who already cites it. Their own row is what proves the
    // page keeps an owner when the grafted record leaves it.
    const strangerEntityId = await seedEntity({
      slug: 'ysm-faculty-desmond-quimby',
      name: 'Pemberton Airway Remodeling Lab',
      rosterPage: 'https://medicine.yale.edu/profile/pemberton/',
    });
    const strangerPersonId = await seedPerson({
      displayName: 'Desmond Quimby',
      officialUrl: STRANGER_PAGE,
      netid: 'dq222',
    });
    await seedLeadEdge({
      personId: strangerPersonId,
      entityId: strangerEntityId,
      profileUrl: STRANGER_PAGE,
    });
  });

  it("serves the stranger's profile page as the way in to the lead before the operation runs", async () => {
    expect(await servedLeadProfileUrls()).toEqual([STRANGER_PAGE]);
  }, 60000);

  it("serves the lead's own profile page once the operation has run", async () => {
    const report = await repointWrongPersonOfficialProfileLinks({ dryRun: false });
    expect(report).toMatchObject({ plannedRepoints: 1, repointed: 1, regatedEntities: 1 });
    expect(await servedLeadProfileUrls()).toEqual([OWN_PAGE]);
  }, 60000);

  it('leaves the page attached to the record it names, so no row loses its way in', async () => {
    await repointWrongPersonOfficialProfileLinks({ dryRun: false });
    expect(await storedOfficialUrl('Desmond Quimby')).toBe(STRANGER_PAGE);
    expect(await storedOfficialUrl('Rosalind Quimby')).toBe(OWN_PAGE);
  }, 60000);

  it('changes nothing in a dry run', async () => {
    const report = await repointWrongPersonOfficialProfileLinks({ dryRun: true });
    expect(report).toMatchObject({ plannedRepoints: 1, repointed: 0, regatedEntities: 0 });
    expect(await servedLeadProfileUrls()).toEqual([STRANGER_PAGE]);
  }, 60000);

  it('is a no-op on a second run', async () => {
    await repointWrongPersonOfficialProfileLinks({ dryRun: false });
    const second = await repointWrongPersonOfficialProfileLinks({ dryRun: false });
    expect(second).toMatchObject({ plannedRepoints: 0, repointed: 0 });
    expect(await servedLeadProfileUrls()).toEqual([OWN_PAGE]);
  }, 60000);

  it('leaves a duplicate pair alone, where the page names one spelling of one person', async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    await db.collection('researchers').deleteMany({});
    await db.collection('role_assignments').deleteMany({});

    const entityId = await seedEntity({
      slug: 'ysm-faculty-shirin-quimby',
      name: 'Quimby Airway Remodeling Lab',
      rosterPage: ROSTER_PAGE,
    });
    const shellId = await seedPerson({
      displayName: 'Shirin Quimby',
      officialUrl: 'https://medicine.yale.edu/profile/seyed-quimby/',
    });
    await seedLeadEdge({
      personId: shellId,
      entityId,
      profileUrl: 'https://medicine.yale.edu/cancer/profile/seyed-quimby/',
    });
    await seedPerson({
      displayName: 'Seyed Quimby',
      officialUrl: 'https://medicine.yale.edu/profile/seyed-quimby/',
      netid: 'sq333',
    });

    const report = await repointWrongPersonOfficialProfileLinks({ dryRun: false });
    expect(report).toMatchObject({ plannedRepoints: 0, repointed: 0 });
    expect(report.refusedByReason).toMatchObject({
      'record-has-no-person-page-of-its-own': 1,
    });
    expect(await storedOfficialUrl('Shirin Quimby')).toBe(
      'https://medicine.yale.edu/profile/seyed-quimby/',
    );
  }, 60000);
});

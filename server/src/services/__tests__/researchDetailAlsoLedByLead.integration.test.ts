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

const READY_SHORT =
  'Studies coastal sediment transport and marsh resilience under rising tides in New England.';
const READY_FULL =
  'This research measures coastal sediment transport, models marsh resilience under rising tides, and pairs field surveys with laboratory flume experiments to forecast shoreline change.';

type RowOptions = {
  slug: string;
  name: string;
  kind?: string;
  entityType?: string;
  studentVisibilityTier?: string;
  archived?: boolean;
};

type EdgeOptions = {
  role?: string;
  state?: string;
  reviewStatus?: string;
  archived?: boolean;
};

const db = () => {
  const database = mongoose.connection.db;
  if (!database) throw new Error('no db');
  return database;
};

const insertRow = async ({
  slug,
  name,
  kind = 'lab',
  entityType = 'LAB',
  studentVisibilityTier = 'student_ready',
  archived = false,
}: RowOptions): Promise<mongoose.Types.ObjectId> => {
  const entityId = new mongoose.Types.ObjectId();
  const sourceUrl = `https://research.example.edu/${slug}/`;
  await db()
    .collection('research_entities')
    .insertOne({
      _id: entityId,
      slug,
      name,
      kind,
      entityType,
      archived,
      departments: ['Earth and Planetary Sciences'],
      researchAreas: ['Coastal geomorphology'],
      studentVisibilityTier,
      studentVisibilityReasons: ['source_backed_description', 'concrete_next_step'],
      shortDescription: READY_SHORT,
      fullDescription: READY_FULL,
      websiteUrl: sourceUrl,
      sourceUrls: [sourceUrl],
      fieldProvenance: {
        shortDescription: { sourceName: 'fixture-site', sourceUrl },
        fullDescription: { sourceName: 'fixture-site', sourceUrl },
      },
    });
  return entityId;
};

const insertPerson = async (firstName: string, lastName: string) => {
  const personId = new mongoose.Types.ObjectId();
  await db()
    .collection('researchers')
    .insertOne({
      _id: personId,
      displayName: `${firstName} ${lastName}`,
      firstName,
      lastName,
      archived: false,
    });
  return personId;
};

const assign = async (
  personId: mongoose.Types.ObjectId,
  entityId: mongoose.Types.ObjectId,
  { role = 'PI', state = 'CURRENT', reviewStatus = 'APPROVED', archived = false }: EdgeOptions = {},
) => {
  await db()
    .collection('role_assignments')
    .insertOne({
      personId,
      target: { kind: 'RESEARCH_ENTITY', id: entityId },
      role,
      state,
      reviewStatus,
      confidence: 0.9,
      archived,
    });
};

const alsoLedSlugs = (detail: Awaited<ReturnType<typeof getResearchGroupDetail>>) =>
  (detail?.alsoLedResearchEntitiesByLead ?? []).map((group) => ({
    leadName: group.leadName,
    slugs: group.researchEntities.map((entity) => entity.slug),
  }));

describe("a research detail page links its lead's other research (#5165)", () => {
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
    await Promise.all(
      ['research_entities', 'role_assignments', 'researchers', 'research_entity_relationships'].map(
        (collection) => db().collection(collection).deleteMany({}),
      ),
    );
  });

  it('cross-links a faculty research profile and its lab in both directions, keeping both rows', async () => {
    const lead = await insertPerson('Ada', 'Fixture');
    const lab = await insertRow({ slug: 'fixture-coastal-lab', name: 'Fixture Coastal Lab' });
    const profile = await insertRow({
      slug: 'ada-fixture-faculty-research',
      name: 'Ada Fixture Faculty Research',
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
    });
    await assign(lead, lab);
    await assign(lead, profile);

    const labDetail = await getResearchGroupDetail('fixture-coastal-lab');
    const profileDetail = await getResearchGroupDetail('ada-fixture-faculty-research');

    expect(alsoLedSlugs(labDetail)).toEqual([
      { leadName: 'Ada Fixture', slugs: ['ada-fixture-faculty-research'] },
    ]);
    expect(alsoLedSlugs(profileDetail)).toEqual([
      { leadName: 'Ada Fixture', slugs: ['fixture-coastal-lab'] },
    ]);
    expect(labDetail?.researchEntity.slug).toBe('fixture-coastal-lab');
    expect(profileDetail?.researchEntity.slug).toBe('ada-fixture-faculty-research');
  });

  it('includes a co-director role and leaves out member roles that are not lead roles', async () => {
    const lead = await insertPerson('Devon', 'Fixture');
    const lab = await insertRow({ slug: 'fixture-tide-lab', name: 'Fixture Tide Lab' });
    const codirected = await insertRow({
      slug: 'fixture-shoreline-center',
      name: 'Fixture Shoreline Center',
      kind: 'center',
      entityType: 'CENTER',
    });
    const coreFaculty = await insertRow({
      slug: 'fixture-estuary-institute',
      name: 'Fixture Estuary Institute',
      kind: 'institute',
      entityType: 'INSTITUTE',
    });
    const affiliate = await insertRow({ slug: 'fixture-marsh-lab', name: 'Fixture Marsh Lab' });
    await assign(lead, lab);
    await assign(lead, codirected, { role: 'CO_DIRECTOR' });
    await assign(lead, coreFaculty, { role: 'CORE_FACULTY' });
    await assign(lead, affiliate, { role: 'AFFILIATED' });

    const detail = await getResearchGroupDetail('fixture-tide-lab');

    expect(alsoLedSlugs(detail)).toEqual([
      { leadName: 'Devon Fixture', slugs: ['fixture-shoreline-center'] },
    ]);
  });

  it('never links, names, or leaks a row a student cannot see', async () => {
    const lead = await insertPerson('Hadley', 'Fixture');
    const lab = await insertRow({ slug: 'fixture-dune-lab', name: 'Fixture Dune Lab' });
    const served = await insertRow({ slug: 'fixture-reef-lab', name: 'Fixture Reef Lab' });
    const held = await insertRow({
      slug: 'fixture-held-lab',
      name: 'Fixture Held Lab',
      studentVisibilityTier: 'operator_review',
    });
    const suppressed = await insertRow({
      slug: 'fixture-suppressed-lab',
      name: 'Fixture Suppressed Lab',
      studentVisibilityTier: 'suppressed',
    });
    const archived = await insertRow({
      slug: 'fixture-archived-lab',
      name: 'Fixture Archived Lab',
      archived: true,
    });
    const departedFrom = await insertRow({
      slug: 'fixture-former-lab',
      name: 'Fixture Former Lab',
    });
    const disputed = await insertRow({
      slug: 'fixture-disputed-lab',
      name: 'Fixture Disputed Lab',
    });
    await assign(lead, lab);
    await assign(lead, served);
    await assign(lead, held);
    await assign(lead, suppressed);
    await assign(lead, archived);
    await assign(lead, departedFrom, { state: 'HISTORICAL' });
    await assign(lead, disputed, { reviewStatus: 'DISPUTED' });

    const detail = await getResearchGroupDetail('fixture-dune-lab');

    expect(alsoLedSlugs(detail)).toEqual([
      { leadName: 'Hadley Fixture', slugs: ['fixture-reef-lab'] },
    ]);
    const payload = JSON.stringify(detail);
    for (const hidden of ['held', 'suppressed', 'archived', 'former', 'disputed']) {
      expect(payload).not.toContain(`fixture-${hidden}-lab`);
      expect(payload.toLowerCase()).not.toContain(`fixture ${hidden} lab`);
    }
  });

  it('caps the list at six rows, sharing the cap across two leads and listing a shared row once', async () => {
    const firstLead = await insertPerson('Harper', 'Fixture');
    const secondLead = await insertPerson('Jordan', 'Fixture');
    const lab = await insertRow({ slug: 'fixture-joint-lab', name: 'Fixture Joint Lab' });
    await assign(firstLead, lab);
    await assign(secondLead, lab, { role: 'CO_PI' });
    const shared = await insertRow({ slug: 'fixture-shared-lab', name: 'Fixture Aa Shared Lab' });
    await assign(firstLead, shared);
    await assign(secondLead, shared);
    for (const letter of ['b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      const own = await insertRow({
        slug: `fixture-first-${letter}-lab`,
        name: `Fixture First ${letter.toUpperCase()} Lab`,
      });
      await assign(firstLead, own);
    }
    for (const letter of ['b', 'c']) {
      const own = await insertRow({
        slug: `fixture-second-${letter}-lab`,
        name: `Fixture Second ${letter.toUpperCase()} Lab`,
      });
      await assign(secondLead, own, { role: 'DIRECTOR' });
    }

    const detail = await getResearchGroupDetail('fixture-joint-lab');
    const groups = alsoLedSlugs(detail);

    expect(groups.flatMap((group) => group.slugs)).toHaveLength(6);
    expect(groups).toEqual([
      {
        leadName: 'Harper Fixture',
        slugs: [
          'fixture-shared-lab',
          'fixture-first-b-lab',
          'fixture-first-c-lab',
          'fixture-first-d-lab',
        ],
      },
      { leadName: 'Jordan Fixture', slugs: ['fixture-second-b-lab', 'fixture-second-c-lab'] },
    ]);
  });

  it('shows nothing while the page lead is under review', async () => {
    const lead = await insertPerson('Kai', 'Fixture');
    const lab = await insertRow({ slug: 'fixture-review-lab', name: 'Fixture Review Lab' });
    const other = await insertRow({ slug: 'fixture-other-lab', name: 'Fixture Other Lab' });
    await assign(lead, lab, { reviewStatus: 'DISPUTED' });
    await assign(lead, other);

    const detail = await getResearchGroupDetail('fixture-review-lab');

    expect(detail?.researchEntity.leadIdentityStatus).toBe('under_review');
    expect(detail?.alsoLedResearchEntitiesByLead).toEqual([]);
  });

  it('leaves a row already listed as an affiliation in that section rather than repeating it', async () => {
    const lead = await insertPerson('Jules', 'Fixture');
    const lab = await insertRow({ slug: 'fixture-delta-lab', name: 'Fixture Delta Lab' });
    const center = await insertRow({
      slug: 'fixture-delta-center',
      name: 'Fixture Delta Center',
      kind: 'center',
      entityType: 'CENTER',
    });
    const profile = await insertRow({
      slug: 'jules-fixture-faculty-research',
      name: 'Jules Fixture Faculty Research',
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
    });
    await assign(lead, lab);
    await assign(lead, center, { role: 'DIRECTOR' });
    await assign(lead, profile);
    await db().collection('research_entity_relationships').insertOne({
      sourceResearchEntityId: lab,
      targetResearchEntityId: center,
      relationshipType: 'AFFILIATED_LAB',
      confidence: 0.9,
      archived: false,
    });

    const detail = await getResearchGroupDetail('fixture-delta-lab');

    expect(detail?.relatedResearchEntities.map((entity) => entity.slug)).toEqual([
      'fixture-delta-center',
    ]);
    expect(alsoLedSlugs(detail)).toEqual([
      { leadName: 'Jules Fixture', slugs: ['jules-fixture-faculty-research'] },
    ]);
  });
});

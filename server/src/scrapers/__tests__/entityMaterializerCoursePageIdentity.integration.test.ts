import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return { ...actual, syncEntity: vi.fn().mockResolvedValue(undefined) };
});

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return { ...actual, recomputeBrowseRankForEntities: vi.fn().mockResolvedValue(undefined) };
});

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import { resetKnownPersonSurnameRosterCache } from '../../utils/researchHomeNameIdentityRoster';
import { materializeEntity } from '../entityMaterializer';

const ENTITY_KEY = 'dept-fixture-biology-tamsin-oakhurst';
const OWN_NAME = 'Tamsin Oakhurst Faculty Research';
const OWN_DESCRIPTION =
  'Studies the functional morphology of fixture vertebrates and how body form shapes ecology.';
const PROFILE_PAGE = 'https://fixturebio.yale.edu/people/faculty-lecturer/tamsin-oakhurst';
const ROSTER_PAGE = 'https://fixturebio.yale.edu/people/faculty';
const COURSE_PAGE = 'https://fixturebio.yale.edu/courses/laboratory-fixture-anatomy';
const COURSE_NAME = 'Laboratory for Fixture Anatomy';
const COURSE_DESCRIPTION =
  'Dissection of selected fixture species in weekly laboratory sections. To be taken with FIX 2290.';

type PersistedEntity = {
  name?: string;
  displayName?: string;
  entityType?: string;
  kind?: string;
  websiteUrl?: string;
  fullDescription?: string;
  sourceUrls?: string[];
  researchAreas?: string[];
  manuallyLockedFields?: string[];
};

const courseProvenance = () => ({
  sourceName: 'lab-microsite-description-llm',
  sourceUrl: COURSE_PAGE,
  observationId: new mongoose.Types.ObjectId(),
});

const persisted = () =>
  ResearchEntity.findOne({ slug: ENTITY_KEY }).lean<PersistedEntity>() as Promise<PersistedEntity>;

describe('materializeEntity never lets a course page name, type or describe a row', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'research_entities', 'role_assignments', 'researchers']) {
      await db.collection(name).deleteMany({});
    }
    resetKnownPersonSurnameRosterCache();
  });

  const seedObservation = (overrides: Record<string, unknown>) =>
    Observation.create({
      entityType: 'researchEntity',
      entityKey: ENTITY_KEY,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'dept-faculty-roster',
      sourceUrl: ROSTER_PAGE,
      confidence: 0.7,
      observedAt: new Date('2026-01-01T00:00:00Z'),
      superseded: false,
      ...overrides,
    });

  const seedLead = async () => {
    const entity = await ResearchEntity.findOne({ slug: ENTITY_KEY }).lean<{ _id: unknown }>();
    if (!entity) throw new Error('seed the row before its lead');
    const researcher = await Researcher.create({ displayName: 'Tamsin Oakhurst', archived: false });
    await RoleAssignment.create({
      personId: researcher._id,
      target: { kind: 'RESEARCH_ENTITY', id: entity._id },
      role: 'PI',
      state: 'CURRENT',
      confidence: 0.9,
      archived: false,
    });
  };

  const seedRosterEvidence = async () => {
    await seedObservation({ field: 'slug', value: ENTITY_KEY });
    await seedObservation({ field: 'name', value: OWN_NAME });
    await seedObservation({ field: 'entityType', value: 'FACULTY_RESEARCH_AREA' });
    await seedObservation({ field: 'kind', value: 'individual' });
    await seedObservation({ field: 'fullDescription', value: OWN_DESCRIPTION });
    await seedObservation({ field: 'websiteUrl', value: COURSE_PAGE });
    await seedObservation({ field: 'sourceUrls', value: [PROFILE_PAGE, ROSTER_PAGE, COURSE_PAGE] });
  };

  const seedCoursePageReading = async () => {
    const fromCoursePage = {
      sourceName: 'lab-microsite-description-llm',
      sourceUrl: COURSE_PAGE,
      confidence: 0.95,
      observedAt: new Date('2026-02-01T00:00:00Z'),
    };
    for (const [field, value] of [
      ['name', COURSE_NAME],
      ['displayName', COURSE_NAME],
      ['entityType', 'LAB'],
      ['kind', 'lab'],
      ['fullDescription', COURSE_DESCRIPTION],
      ['researchAreas', ['fixture dissection']],
    ] as const) {
      await seedObservation({ field, value, ...fromCoursePage });
    }
  };

  const expectRowStatesItsOwnEvidence = (entity: PersistedEntity) => {
    expect(entity.name).toBe(OWN_NAME);
    expect(entity.displayName ?? '').not.toBe(COURSE_NAME);
    expect(entity.entityType).toBe('FACULTY_RESEARCH_AREA');
    expect(entity.kind).toBe('individual');
    expect(entity.fullDescription ?? '').not.toContain('Dissection');
    expect(entity.websiteUrl ?? '').not.toBe(COURSE_PAGE);
    expect(entity.sourceUrls ?? []).not.toContain(COURSE_PAGE);
    expect(entity.researchAreas ?? []).not.toContain('fixture dissection');
    expect(entity.manuallyLockedFields ?? []).toEqual([]);
  };

  it('repairs a stored row a course page named and typed, back to its own evidence', async () => {
    await ResearchEntity.create({
      slug: ENTITY_KEY,
      name: COURSE_NAME,
      displayName: COURSE_NAME,
      kind: 'lab',
      entityType: 'LAB',
      fullDescription: COURSE_DESCRIPTION,
      sourceUrls: [COURSE_PAGE],
      fieldProvenance: {
        name: courseProvenance(),
        displayName: courseProvenance(),
        entityType: courseProvenance(),
        kind: courseProvenance(),
        fullDescription: courseProvenance(),
      },
      studentVisibilityTier: 'student_ready',
      archived: false,
    });
    await seedLead();
    await seedRosterEvidence();
    await seedCoursePageReading();

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });
    expectRowStatesItsOwnEvidence(await persisted());

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });
    expectRowStatesItsOwnEvidence(await persisted());
  });

  it('resolves fresh evidence without ever taking the course', async () => {
    await ResearchEntity.create({
      slug: ENTITY_KEY,
      name: OWN_NAME,
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
      studentVisibilityTier: 'operator_review',
      archived: false,
    });
    await seedLead();
    await seedRosterEvidence();
    await seedCoursePageReading();

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });
    expectRowStatesItsOwnEvidence(await persisted());
  });
});

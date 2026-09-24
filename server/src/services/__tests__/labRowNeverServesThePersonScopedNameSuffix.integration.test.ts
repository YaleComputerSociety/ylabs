import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const meiliMocks = vi.hoisted(() => ({
  syncEntities: vi.fn(async () => {}),
  syncEntity: vi.fn(async () => {}),
  deleteFromIndex: vi.fn(async () => {}),
}));

vi.mock('../meiliSyncService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../meiliSyncService')>()),
  syncEntities: meiliMocks.syncEntities,
  syncEntity: meiliMocks.syncEntity,
  deleteFromIndex: meiliMocks.deleteFromIndex,
}));

vi.mock('../researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<typeof import('../researchEntityBrowseRankService')>(
    '../researchEntityBrowseRankService',
  );
  return { ...actual, recomputeBrowseRankForEntities: vi.fn().mockResolvedValue(undefined) };
});

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { materializeEntity } from '../../scrapers/entityMaterializer';
import { getResearchGroupDetail } from '../researchGroupService';

const LAB_TYPED_SLUG = 'ysm-faculty-marlowe-fenwick';
const BRANDED_SLUG = 'ysm-faculty-rosalind-ashgrove';
const PERSON_SCOPED_SUFFIX_NAME = 'Marlowe Fenwick Faculty Research';
const LAB_SUFFIX_NAME = 'Marlowe Fenwick Lab';
const HARVESTED_BRAND = 'Rosalind Ashgrove Lab';

const FACULTY_RESEARCH_SUFFIX_RE = /\s+faculty\s+research$/i;

const SHORT_DESCRIPTION =
  'Studies vascular remodelling after ischaemic injury using intravital imaging in mice.';
const FULL_DESCRIPTION =
  'The group studies vascular remodelling after ischaemic injury, combining intravital imaging of hindlimb collateral growth in mice, single-cell profiling of endothelial and mural populations, and perfusion measurements in genetic models to work out which signals decide whether a new vessel network stabilises.';

const seedRow = async (overrides: Record<string, unknown>) =>
  ResearchEntity.create({
    slug: LAB_TYPED_SLUG,
    name: PERSON_SCOPED_SUFFIX_NAME,
    kind: 'lab',
    entityType: 'LAB',
    studentVisibilityTier: 'student_ready',
    archived: false,
    shortDescription: SHORT_DESCRIPTION,
    fullDescription: FULL_DESCRIPTION,
    ...overrides,
  });

const seedObservation = async (entityKey: string, overrides: Record<string, unknown>) =>
  Observation.create({
    entityType: 'researchEntity',
    entityKey,
    sourceId: new mongoose.Types.ObjectId(),
    sourceName: 'ysm-faculty-directory',
    sourceUrl: 'https://medicine.example.edu/profile/marlowe-fenwick/',
    confidence: 0.8,
    observedAt: new Date('2026-01-01T00:00:00Z'),
    superseded: false,
    ...overrides,
  });

const servedEntity = async (slug: string) =>
  (await getResearchGroupDetail(slug))?.researchEntity as Record<string, unknown> | undefined;

describe('a row typed LAB never serves the person-scoped name suffix (#3252)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'research_entities', 'role_assignments', 'researchers']) {
      await db.collection(name).deleteMany({});
    }
    vi.clearAllMocks();
  });

  it('re-derives the suffix from the row own type, so the served heading and kind agree', async () => {
    await seedRow({});
    await seedObservation(LAB_TYPED_SLUG, { field: 'departments', value: ['Internal Medicine'] });

    await materializeEntity('researchEntity', { entityKey: LAB_TYPED_SLUG });

    const entity = await servedEntity(LAB_TYPED_SLUG);
    expect(entity?.entityType).toBe('LAB');
    expect(entity?.name).toBe(LAB_SUFFIX_NAME);
    expect(FACULTY_RESEARCH_SUFFIX_RE.test(String(entity?.name ?? ''))).toBe(false);
  });

  it('leaves a person-scoped row whose name a page asserted alone, because the type is the field in doubt', async () => {
    await ResearchEntity.create({
      slug: BRANDED_SLUG,
      name: HARVESTED_BRAND,
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
      studentVisibilityTier: 'student_ready',
      archived: false,
      websiteUrl: 'https://ashgrovelab.example.edu/',
      shortDescription: SHORT_DESCRIPTION,
      fullDescription: FULL_DESCRIPTION,
    });
    await seedObservation(BRANDED_SLUG, {
      field: 'name',
      value: HARVESTED_BRAND,
      sourceName: 'lab-microsite-description-llm',
      sourceUrl: 'https://ashgrovelab.example.edu/',
      confidence: 0.95,
    });

    await materializeEntity('researchEntity', { entityKey: BRANDED_SLUG });

    const entity = await servedEntity(BRANDED_SLUG);
    expect(entity?.entityType).toBe('FACULTY_RESEARCH_AREA');
    expect(entity?.name).toBe(HARVESTED_BRAND);
  });
});

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
import { materializeEntity } from '../entityMaterializer';

const ORG_CENTER_MISSION =
  'The Riverbend Neuropsychiatry Research Center conducts neuroscience research on psychiatric illnesses and aims to translate findings into effective treatments.';

const PI_STUDY_ABSTRACT =
  'Neuroscience of impaired vehicle driving: this federally supported research examines the acute effects of an inhaled compound on simulated driving performance.';

type PersistedEntity = {
  fullDescription?: string;
  researchAreas?: string[];
  confidenceByField?: Record<string, number>;
};

describe('materializeEntity guards named multi-PI orgs from a single-PI/grant shell (#1595)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'research_entities', 'role_assignments']) {
      await db.collection(name).deleteMany({});
    }
  });

  const seedObservation = async (overrides: Record<string, unknown>) =>
    Observation.create({
      entityType: 'researchEntity',
      entityKey: 'faculty-research-area-morgan-ellery',
      sourceId: new mongoose.Types.ObjectId(),
      confidence: 0.82,
      observedAt: new Date('2026-01-01T00:00:00Z'),
      superseded: false,
      ...overrides,
    });

  it('never materializes a CENTER description from its founding PI shell profile page when no org-page evidence exists', async () => {
    await ResearchEntity.create({
      slug: 'faculty-research-area-morgan-ellery',
      name: 'Riverbend Research Center',
      kind: 'center',
      studentVisibilityTier: 'student_ready',
      archived: false,
    });
    await seedObservation({
      field: 'fullDescription',
      value: PI_STUDY_ABSTRACT,
      sourceName: 'lab-microsite-description-llm',
      sourceUrl: 'https://medicine.yale.edu/profile/morgan-ellery/',
    });

    await materializeEntity('researchEntity', {
      entityKey: 'faculty-research-area-morgan-ellery',
    });

    const persisted = await ResearchEntity.findOne({
      slug: 'faculty-research-area-morgan-ellery',
    }).lean<PersistedEntity>();

    expect(persisted?.fullDescription ?? '').toBe('');
    expect(persisted?.confidenceByField?.fullDescription).toBeUndefined();
  });

  it('preserves an existing org-scoped description rather than regressing it to a fresher PI-profile re-scrape', async () => {
    await ResearchEntity.create({
      slug: 'faculty-research-area-morgan-ellery',
      name: 'Riverbend Research Center',
      kind: 'center',
      studentVisibilityTier: 'student_ready',
      archived: false,
      fullDescription: ORG_CENTER_MISSION,
      confidenceByField: { fullDescription: 1 },
    });
    // The only currently-recorded observation is a fresher re-scrape of the
    // founding PI's own profile page - exactly the regression risk flagged on
    // #1595/#1606 once the org-page observation that produced the good value
    // above ages out or is superseded.
    await seedObservation({
      field: 'fullDescription',
      value: PI_STUDY_ABSTRACT,
      sourceName: 'lab-microsite-description-llm',
      sourceUrl: 'https://medicine.yale.edu/profile/morgan-ellery/',
      observedAt: new Date('2026-06-01T00:00:00Z'),
    });

    await materializeEntity('researchEntity', {
      entityKey: 'faculty-research-area-morgan-ellery',
    });

    const persisted = await ResearchEntity.findOne({
      slug: 'faculty-research-area-morgan-ellery',
    }).lean<PersistedEntity>();

    expect(persisted?.fullDescription).toBe(ORG_CENTER_MISSION);
  });

  it('materializes the description normally once a genuine org-page observation contributes', async () => {
    await ResearchEntity.create({
      slug: 'faculty-research-area-morgan-ellery',
      name: 'Riverbend Research Center',
      kind: 'center',
      studentVisibilityTier: 'student_ready',
      archived: false,
    });
    await seedObservation({
      field: 'fullDescription',
      value: ORG_CENTER_MISSION,
      sourceName: 'lab-microsite-description-llm',
      sourceUrl: 'https://riverbend-research.example/health-professionals/neuropsychiatry-research-center/',
    });

    await materializeEntity('researchEntity', {
      entityKey: 'faculty-research-area-morgan-ellery',
    });

    const persisted = await ResearchEntity.findOne({
      slug: 'faculty-research-area-morgan-ellery',
    }).lean<PersistedEntity>();

    expect(persisted?.fullDescription).toBe(ORG_CENTER_MISSION);
  });

  it('does not gate a genuine single-PI lab from its own profile page (kind=lab is not a multi-PI org)', async () => {
    await ResearchEntity.create({
      slug: 'faculty-research-area-morgan-ellery',
      name: 'Ellery Lab',
      kind: 'lab',
      studentVisibilityTier: 'student_ready',
      archived: false,
    });
    await seedObservation({
      field: 'fullDescription',
      value: PI_STUDY_ABSTRACT,
      sourceName: 'lab-microsite-description-llm',
      sourceUrl: 'https://medicine.yale.edu/profile/morgan-ellery/',
    });

    await materializeEntity('researchEntity', {
      entityKey: 'faculty-research-area-morgan-ellery',
    });

    const persisted = await ResearchEntity.findOne({
      slug: 'faculty-research-area-morgan-ellery',
    }).lean<PersistedEntity>();

    expect(persisted?.fullDescription).toBe(PI_STUDY_ABSTRACT);
  });

  it('does not gate a CENTER whose slug is its own organizational identity, not a person/grant shell', async () => {
    await ResearchEntity.create({
      slug: 'harbor-brain-institute',
      name: 'Harbor Brain Institute',
      kind: 'institute',
      studentVisibilityTier: 'student_ready',
      archived: false,
    });
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: 'harbor-brain-institute',
      field: 'fullDescription',
      value: PI_STUDY_ABSTRACT,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'lab-microsite-description-llm',
      sourceUrl: 'https://medicine.yale.edu/profile/morgan-ellery/',
      confidence: 0.82,
      observedAt: new Date('2026-01-01T00:00:00Z'),
      superseded: false,
    });

    await materializeEntity('researchEntity', { entityKey: 'harbor-brain-institute' });

    const persisted = await ResearchEntity.findOne({ slug: 'harbor-brain-institute' }).lean<PersistedEntity>();

    expect(persisted?.fullDescription).toBe(PI_STUDY_ABSTRACT);
  });

  it('guards researchAreas the same way it guards fullDescription', async () => {
    await ResearchEntity.create({
      slug: 'nih-pi-casey-lindqvist',
      name: 'Center for Disease Modeling',
      kind: 'center',
      studentVisibilityTier: 'student_ready',
      archived: false,
      researchAreas: ['Infectious Diseases'],
      confidenceByField: { researchAreas: 1 },
    });
    await seedObservation({
      entityKey: 'nih-pi-casey-lindqvist',
      field: 'researchAreas',
      value: ['Mental Health'],
      sourceName: 'research-area-source-extractor',
      sourceUrl: 'https://medicine.yale.edu/profile/casey-lindqvist/',
    });

    await materializeEntity('researchEntity', { entityKey: 'nih-pi-casey-lindqvist' });

    const persisted = await ResearchEntity.findOne({
      slug: 'nih-pi-casey-lindqvist',
    }).lean<PersistedEntity>();

    expect(persisted?.researchAreas).toEqual(['Infectious Diseases']);
  });
});

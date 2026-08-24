import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ResearchEntity } from '../../models/researchEntity';
import { ResearchArea, ResearchField } from '../../models/researchArea';
import {
  getAreaResearchPage,
  getFieldResearchPage,
} from '../areaResearchPageService';

const baseEntity = (overrides: Record<string, unknown>) => ({
  slug: 'entity',
  name: 'Entity',
  kind: 'lab',
  entityType: 'LAB',
  departments: ['Neuroscience'],
  researchAreas: ['Neuroscience'],
  sourceUrls: ['https://neuro.example.edu/lab'],
  shortDescription: 'Investigates how neural circuits encode memory and perception.',
  fullDescription:
    'The lab investigates how neural circuits encode memory and perception, combining electrophysiology, two-photon imaging, and computational modeling in behaving animals to map the dynamics of learning.',
  studentVisibilityTier: 'student_ready',
  archived: false,
  ...overrides,
});

describe('areaResearchPageService (issue #1696)', () => {
  let mongo: MongoMemoryServer;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongo) await mongo.stop();
  });

  beforeEach(async () => {
    await ResearchEntity.deleteMany({});
    await ResearchArea.deleteMany({});
    await ResearchArea.create([
      { name: 'Neuroscience', field: ResearchField.LIFE_SCIENCES, colorKey: 'green' },
      { name: 'Genomics', field: ResearchField.LIFE_SCIENCES, colorKey: 'green' },
    ]);
  });

  afterEach(async () => {
    await ResearchEntity.deleteMany({});
    await ResearchArea.deleteMany({});
  });

  it('resolves an area slug and groups the servable footprint into buckets', async () => {
    await ResearchEntity.create([
      baseEntity({ slug: 'memory-lab', name: 'Memory Lab', entityType: 'LAB' }),
      baseEntity({
        slug: 'brain-institute',
        name: 'Brain Institute',
        kind: 'center',
        entityType: 'INSTITUTE',
      }),
      baseEntity({
        slug: 'neuro-fellowship',
        name: 'Neuro Fellowship',
        kind: 'program',
        entityType: 'FELLOWSHIP_PROGRAM',
      }),
      baseEntity({ slug: 'archived-lab', name: 'Archived Lab', archived: true }),
      baseEntity({
        slug: 'hidden-lab',
        name: 'Hidden Lab',
        studentVisibilityTier: 'operator_review',
      }),
      baseEntity({
        slug: 'other-area-lab',
        name: 'Other Area Lab',
        researchAreas: ['Genomics'],
      }),
    ]);

    const page = await getAreaResearchPage('neuroscience');
    expect(page).not.toBeNull();
    expect(page?.scope.kind).toBe('area');
    expect(page?.scope.name).toBe('Neuroscience');
    expect(page?.scope.field).toBe(ResearchField.LIFE_SCIENCES);
    expect(page?.totalCount).toBe(3);
    expect(page?.buckets.map((bucket) => bucket.key)).toEqual(['labs', 'centers', 'programs']);
  });

  it('reconciles the area total with a facet-style servable count', async () => {
    await ResearchEntity.create([
      baseEntity({ slug: 'lab-1', name: 'Lab One' }),
      baseEntity({ slug: 'lab-2', name: 'Lab Two' }),
      baseEntity({ slug: 'lab-3', name: 'Lab Three', researchAreas: ['Neuroscience', 'Genomics'] }),
      baseEntity({ slug: 'archived', name: 'Archived', archived: true }),
    ]);

    const page = await getAreaResearchPage('neuroscience');
    const facetStyleCount = await ResearchEntity.countDocuments({
      archived: { $ne: true },
      studentVisibilityTier: 'student_ready',
      researchAreas: 'Neuroscience',
    });
    expect(page?.totalCount).toBe(facetStyleCount);
    expect(page?.totalCount).toBe(3);
  });

  it('returns an honest empty page for a resolved area with no coverage', async () => {
    const page = await getAreaResearchPage('genomics');
    expect(page).not.toBeNull();
    expect(page?.totalCount).toBe(0);
    expect(page?.buckets).toEqual([]);
  });

  it('returns null for a slug that resolves to no canonical area', async () => {
    expect(await getAreaResearchPage('not-a-real-area')).toBeNull();
    expect(await getAreaResearchPage('..')).toBeNull();
  });

  it('rolls a field slug up across every area in the field', async () => {
    await ResearchEntity.create([
      baseEntity({ slug: 'neuro-lab', name: 'Neuro Lab', researchAreas: ['Neuroscience'] }),
      baseEntity({ slug: 'genome-lab', name: 'Genome Lab', researchAreas: ['Genomics'] }),
      baseEntity({
        slug: 'both-lab',
        name: 'Both Lab',
        researchAreas: ['Neuroscience', 'Genomics'],
      }),
    ]);

    const page = await getFieldResearchPage('life-sciences-and-biology');
    expect(page).not.toBeNull();
    expect(page?.scope.kind).toBe('field');
    expect(page?.scope.name).toBe(ResearchField.LIFE_SCIENCES);
    expect(page?.totalCount).toBe(3);
  });

  it('returns null for a slug that resolves to no research field', async () => {
    expect(await getFieldResearchPage('not-a-real-field')).toBeNull();
  });
});

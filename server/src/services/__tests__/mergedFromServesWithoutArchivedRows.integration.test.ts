import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ResearchEntity } from '../../models/researchEntity';
import { resolveArchivedResearchEntityCanonicalSlug } from '../researchGroupService';

// Beta and Production hold live rows only (#5148), so these cases seed a survivor with
// `mergedFrom` and no archived row at all.
describe('an old merged slug redirects with no archived row present (#5148)', () => {
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
    await mongoose.connection.db?.collection('research_entities').deleteMany({});
  });

  const survivor = (slug: string, overrides: Record<string, unknown> = {}) =>
    ResearchEntity.create({
      slug,
      name: `Synthetic ${slug}`,
      archived: false,
      studentVisibilityTier: 'student_ready',
      mergedFrom: [{ slug: 'synthetic-old-slug', entityId: new mongoose.Types.ObjectId() }],
      ...overrides,
    });

  it('redirects an old merged slug to the survivor that lists it', async () => {
    await survivor('synthetic-survivor');

    await expect(resolveArchivedResearchEntityCanonicalSlug('synthetic-old-slug')).resolves.toBe(
      'synthetic-survivor',
    );
    await expect(
      resolveArchivedResearchEntityCanonicalSlug('synthetic-never-merged'),
    ).resolves.toBeNull();
  });

  it('does not redirect to a survivor a student cannot be served', async () => {
    await survivor('synthetic-held-survivor', { studentVisibilityTier: 'operator_review' });

    await expect(
      resolveArchivedResearchEntityCanonicalSlug('synthetic-old-slug'),
    ).resolves.toBeNull();
  });

  it('prefers the tombstone where one exists, as on Development', async () => {
    const live = await survivor('synthetic-survivor');
    await ResearchEntity.create({
      slug: 'synthetic-old-slug',
      name: 'Synthetic old',
      archived: true,
      canonicalGroupId: live._id,
    });

    await expect(resolveArchivedResearchEntityCanonicalSlug('synthetic-old-slug')).resolves.toBe(
      'synthetic-survivor',
    );
  });
});

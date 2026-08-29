import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/meiliClient', () => ({
  getMeiliIndex: vi.fn(async () => ({
    search: vi.fn(async () => ({ hits: [] })),
    searchSimilarDocuments: vi.fn(async () => ({ hits: [] })),
    getEmbedders: vi.fn(async () => ({})),
  })),
}));

import { ResearchEntity } from '../../models/researchEntity';
import { ResearchEntityRedirect } from '../../models/researchEntityRedirect';
import { getResearchGroupBySlug } from '../researchGroupController';

const BASE_URL = '/api/research-groups';

type SeedEntity = {
  _id: mongoose.Types.ObjectId;
  slug: string;
  name?: string;
  archived: boolean;
  studentVisibilityTier: string;
  canonicalGroupId?: mongoose.Types.ObjectId | null;
};

const seedEntities = async (entities: SeedEntity[]) => {
  await ResearchEntity.insertMany(
    entities.map((entity) => ({
      _id: entity._id,
      slug: entity.slug,
      name: entity.name ?? entity.slug,
      archived: entity.archived,
      studentVisibilityTier: entity.studentVisibilityTier,
      canonicalGroupId: entity.canonicalGroupId ?? null,
    })),
  );
};

const seedRedirect = async (
  mergedSlug: string,
  mergedEntityId: mongoose.Types.ObjectId,
  canonicalEntityId: mongoose.Types.ObjectId,
) => {
  await ResearchEntityRedirect.create({
    mergedSlug,
    mergedEntityId,
    canonicalEntityId,
    canonicalGroupId: canonicalEntityId,
    mergedAt: new Date(),
    reason: 'research_entity_dedupe_merge',
  });
};

const callRoute = async (slug: string) => {
  const response = {
    redirect: vi.fn(),
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
  } as any;
  await getResearchGroupBySlug({ params: { slug }, baseUrl: BASE_URL } as any, response);
  return response;
};

const expectRedirectTo = (response: any, canonicalSlug: string) => {
  expect(response.redirect).toHaveBeenCalledWith(302, `${BASE_URL}/${canonicalSlug}`);
  expect(response.status).not.toHaveBeenCalledWith(404);
};

const expectNotFound = (response: any) => {
  expect(response.redirect).not.toHaveBeenCalled();
  expect(response.status).toHaveBeenCalledWith(404);
  expect(response.json).toHaveBeenCalledWith({ error: 'Research entity not found' });
};

describe('public research detail route after the merged shell row is deleted (integration)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  afterEach(async () => {
    await ResearchEntity.deleteMany({});
    await ResearchEntityRedirect.deleteMany({});
  });

  it('redirects a merged slug whose shell row was deleted by cleanup-archived', async () => {
    const deletedShellId = new mongoose.Types.ObjectId();
    const liveId = new mongoose.Types.ObjectId();

    await seedEntities([
      {
        _id: liveId,
        slug: 'ysm-faculty-example-lead',
        archived: false,
        studentVisibilityTier: 'student_ready',
      },
    ]);
    await seedRedirect('faculty-research-area-example-lead', deletedShellId, liveId);

    expectRedirectTo(
      await callRoute('faculty-research-area-example-lead'),
      'ysm-faculty-example-lead',
    );
  });

  it('follows a redirect chain across a deleted intermediate shell', async () => {
    const deletedShellId = new mongoose.Types.ObjectId();
    const deletedMidId = new mongoose.Types.ObjectId();
    const liveId = new mongoose.Types.ObjectId();

    await seedEntities([
      {
        _id: liveId,
        slug: 'dept-cs-live-lead',
        archived: false,
        studentVisibilityTier: 'student_ready',
      },
    ]);
    await seedRedirect('nsf-pi-example-lead', deletedShellId, deletedMidId);
    await seedRedirect('nsf-pi-example-lead-mid', deletedMidId, liveId);

    expectRedirectTo(await callRoute('nsf-pi-example-lead'), 'dept-cs-live-lead');
  });

  it('follows a surviving archived intermediate on to the live canonical', async () => {
    const deletedShellId = new mongoose.Types.ObjectId();
    const archivedMidId = new mongoose.Types.ObjectId();
    const liveId = new mongoose.Types.ObjectId();

    await seedEntities([
      {
        _id: archivedMidId,
        slug: 'dept-eeb-example-lead',
        archived: true,
        studentVisibilityTier: 'suppressed',
        canonicalGroupId: liveId,
      },
      {
        _id: liveId,
        slug: 'ysm-example-lead',
        archived: false,
        studentVisibilityTier: 'student_ready',
      },
    ]);
    await seedRedirect('faculty-research-area-chained-lead', deletedShellId, archivedMidId);

    expectRedirectTo(await callRoute('faculty-research-area-chained-lead'), 'ysm-example-lead');
  });

  it('404s instead of redirecting to a target that is itself not publicly servable', async () => {
    const deletedShellId = new mongoose.Types.ObjectId();
    const gatedId = new mongoose.Types.ObjectId();

    await seedEntities([
      {
        _id: gatedId,
        slug: 'ysm-gated-example-lead',
        archived: false,
        studentVisibilityTier: 'operator_review',
      },
    ]);
    await seedRedirect('faculty-research-area-gated-lead', deletedShellId, gatedId);

    expectNotFound(await callRoute('faculty-research-area-gated-lead'));
  });

  it('404s when the redirect target is archived with no onward canonical', async () => {
    const deletedShellId = new mongoose.Types.ObjectId();
    const archivedId = new mongoose.Types.ObjectId();

    await seedEntities([
      {
        _id: archivedId,
        slug: 'ysm-archived-example-lead',
        archived: true,
        studentVisibilityTier: 'student_ready',
      },
    ]);
    await seedRedirect('faculty-research-area-archived-lead', deletedShellId, archivedId);

    expectNotFound(await callRoute('faculty-research-area-archived-lead'));
  });

  it('404s rather than redirecting to a canonical whose lead is deceased', async () => {
    const deletedShellId = new mongoose.Types.ObjectId();
    const liveId = new mongoose.Types.ObjectId();

    await seedEntities([
      {
        _id: liveId,
        slug: 'ysm-memorial-example-lead',
        name: 'Example Emeritus Lead (1921-1998)',
        archived: false,
        studentVisibilityTier: 'student_ready',
      },
    ]);
    await seedRedirect('faculty-research-area-memorial-lead', deletedShellId, liveId);

    expectNotFound(await callRoute('faculty-research-area-memorial-lead'));
  });

  it('404s from a surviving shell row when its canonical lead is deceased', async () => {
    const shellId = new mongoose.Types.ObjectId();
    const liveId = new mongoose.Types.ObjectId();

    await seedEntities([
      {
        _id: shellId,
        slug: 'faculty-research-area-surviving-memorial-lead',
        archived: true,
        studentVisibilityTier: 'suppressed',
        canonicalGroupId: liveId,
      },
      {
        _id: liveId,
        slug: 'ysm-surviving-memorial-lead',
        name: 'Example Retired Lead (1930-2004)',
        archived: false,
        studentVisibilityTier: 'student_ready',
      },
    ]);

    expectNotFound(await callRoute('faculty-research-area-surviving-memorial-lead'));
  });

  it('terminates on a redirect-table cycle instead of looping forever', async () => {
    const aId = new mongoose.Types.ObjectId();
    const bId = new mongoose.Types.ObjectId();

    await seedRedirect('redirect-cycle-a', aId, bId);
    await seedRedirect('redirect-cycle-b', bId, aId);

    expectNotFound(await callRoute('redirect-cycle-a'));
  });

  it('terminates when a gated canonical points its canonicalGroupId at itself', async () => {
    const deletedShellId = new mongoose.Types.ObjectId();
    const selfCanonicalId = new mongoose.Types.ObjectId();

    await seedEntities([
      {
        _id: selfCanonicalId,
        slug: 'ysm-self-canonical-lead',
        archived: false,
        studentVisibilityTier: 'operator_review',
        canonicalGroupId: selfCanonicalId,
      },
    ]);
    await seedRedirect(
      'faculty-research-area-self-canonical-lead',
      deletedShellId,
      selfCanonicalId,
    );

    expectNotFound(await callRoute('faculty-research-area-self-canonical-lead'));
  });

  it('404s when neither a shell row nor a redirect row exists for the slug', async () => {
    expectNotFound(await callRoute('never-existed-example-lead'));
  });
});

import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ResearchEntity } from '../../models/researchEntity';
import { ResearchEntityRedirect } from '../../models/researchEntityRedirect';
import {
  recordResearchEntityMergeRedirects,
  resolveResearchEntityMergeRedirectCanonical,
} from '../researchEntityMergeRedirectService';

describe('researchEntityMergeRedirectService', () => {
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
    for (const name of ['research_entities', 'research_entity_redirects']) {
      await db.collection(name).deleteMany({});
    }
  });

  it('records a redirect keyed on the shell slug and id, then resolves to the live canonical', async () => {
    const canonicalId = new mongoose.Types.ObjectId();
    const shellId = new mongoose.Types.ObjectId();
    await ResearchEntity.create({
      _id: canonicalId,
      slug: 'ysm-roe-lab',
      name: 'Roe Laboratory',
      kind: 'lab',
    });

    const recorded = await recordResearchEntityMergeRedirects({
      canonicalEntityId: canonicalId,
      mergedShells: [{ entityId: shellId, slug: 'faculty-research-area-jane-roe' }],
      reason: 'eponymous_fra_lab_merge',
    });
    expect(recorded).toBe(1);

    const doc = await ResearchEntityRedirect.findOne({ mergedEntityId: shellId }).lean<{
      mergedSlug?: string;
      canonicalEntityId?: mongoose.Types.ObjectId;
      canonicalGroupId?: mongoose.Types.ObjectId;
      reason?: string;
    }>();
    expect(doc?.mergedSlug).toBe('faculty-research-area-jane-roe');
    expect(String(doc?.canonicalEntityId)).toBe(canonicalId.toHexString());
    expect(String(doc?.canonicalGroupId)).toBe(canonicalId.toHexString());
    expect(doc?.reason).toBe('eponymous_fra_lab_merge');

    const bySlug = await resolveResearchEntityMergeRedirectCanonical({
      slug: 'faculty-research-area-jane-roe',
    });
    expect(String(bySlug?._id)).toBe(canonicalId.toHexString());

    const byId = await resolveResearchEntityMergeRedirectCanonical({ entityId: shellId });
    expect(String(byId?._id)).toBe(canonicalId.toHexString());
  });

  it('is idempotent: re-recording the same merge upserts a single redirect', async () => {
    const canonicalId = new mongoose.Types.ObjectId();
    const shellId = new mongoose.Types.ObjectId();
    const shell = { entityId: shellId, slug: 'faculty-research-area-jane-roe' };
    await recordResearchEntityMergeRedirects({ canonicalEntityId: canonicalId, mergedShells: [shell] });
    await recordResearchEntityMergeRedirects({ canonicalEntityId: canonicalId, mergedShells: [shell] });
    expect(await ResearchEntityRedirect.countDocuments({ mergedEntityId: shellId })).toBe(1);
  });

  it('follows a canonicalGroupId chain when the canonical was itself later merged', async () => {
    const finalCanonicalId = new mongoose.Types.ObjectId();
    const intermediateId = new mongoose.Types.ObjectId();
    const shellId = new mongoose.Types.ObjectId();
    await ResearchEntity.create({
      _id: finalCanonicalId,
      slug: 'ysm-roe-lab',
      name: 'Roe Laboratory',
      kind: 'lab',
    });
    await ResearchEntity.create({
      _id: intermediateId,
      slug: 'ysm-roe-lab-old',
      name: 'Roe Lab Old',
      kind: 'lab',
      archived: true,
      canonicalGroupId: finalCanonicalId,
    });
    await recordResearchEntityMergeRedirects({
      canonicalEntityId: intermediateId,
      mergedShells: [{ entityId: shellId, slug: 'faculty-research-area-jane-roe' }],
    });

    const resolved = await resolveResearchEntityMergeRedirectCanonical({
      slug: 'faculty-research-area-jane-roe',
    });
    expect(String(resolved?._id)).toBe(finalCanonicalId.toHexString());
  });

  it('returns null when the source identifier has no redirect', async () => {
    const resolved = await resolveResearchEntityMergeRedirectCanonical({
      slug: 'faculty-research-area-nobody',
    });
    expect(resolved).toBeNull();
  });
});

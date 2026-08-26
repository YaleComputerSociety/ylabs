import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const meiliMocks = vi.hoisted(() => ({
  syncEntity: vi.fn().mockResolvedValue(undefined),
  deleteFromIndex: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return {
    ...actual,
    syncEntity: meiliMocks.syncEntity,
    deleteFromIndex: meiliMocks.deleteFromIndex,
  };
});

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return { ...actual, recomputeBrowseRankForEntities: vi.fn().mockResolvedValue(undefined) };
});

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { ResearchEntityRedirect } from '../../models/researchEntityRedirect';
import { materializeEntity } from '../entityMaterializer';

const SHELL_SLUG = 'faculty-research-area-jane-roe';
const CANONICAL_SLUG = 'ysm-roe-lab';

describe('materializeEntity routes a redirected merged source into the canonical', () => {
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
    for (const name of [
      'observations',
      'research_entities',
      'research_entity_redirects',
      'role_assignments',
    ]) {
      await db.collection(name).deleteMany({});
    }
  });

  const seedNameObservation = async (value: string) => {
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: SHELL_SLUG,
      field: 'name',
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'ysm-faculty-directory',
      sourceUrl: 'https://medicine.yale.edu/profile/jane-roe/',
      confidence: 0.9,
      observedAt: new Date('2026-02-01T00:00:00Z'),
      superseded: false,
    });
  };

  const seedCanonicalAndRedirect = async (shellId: mongoose.Types.ObjectId) => {
    const canonicalId = new mongoose.Types.ObjectId();
    await ResearchEntity.create({
      _id: canonicalId,
      slug: CANONICAL_SLUG,
      name: 'Roe Laboratory',
      kind: 'lab',
      entityType: 'LAB',
    });
    await ResearchEntityRedirect.create({
      mergedSlug: SHELL_SLUG,
      mergedEntityId: shellId,
      canonicalEntityId: canonicalId,
      canonicalGroupId: canonicalId,
      mergedAt: new Date('2026-08-01T00:00:00Z'),
      reason: 'eponymous_fra_lab_merge',
    });
    return canonicalId;
  };

  it('resolves to the canonical and mints no new shell when the archived shell row still exists', async () => {
    const shellId = new mongoose.Types.ObjectId();
    const canonicalId = await seedCanonicalAndRedirect(shellId);
    await ResearchEntity.create({
      _id: shellId,
      slug: SHELL_SLUG,
      name: 'Jane Roe Research',
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
      archived: true,
      canonicalGroupId: canonicalId,
    });
    await seedNameObservation('Jane Roe Research Renamed');

    const result = await materializeEntity('researchEntity', { entityKey: SHELL_SLUG });

    expect(result.skipped).not.toBe('merged-into-canonical');
    expect(result.created).toBe(false);
    expect(String(result.entityId)).toBe(canonicalId.toHexString());

    const liveShellCount = await ResearchEntity.countDocuments({
      slug: SHELL_SLUG,
      archived: { $ne: true },
    });
    expect(liveShellCount).toBe(0);
    expect(await ResearchEntity.countDocuments({})).toBe(2);
  });

  it('resolves to the canonical and mints no new shell after the shell row is deleted (delete-safe)', async () => {
    const shellId = new mongoose.Types.ObjectId();
    const canonicalId = await seedCanonicalAndRedirect(shellId);
    await seedNameObservation('Jane Roe Research Renamed');

    const result = await materializeEntity('researchEntity', { entityKey: SHELL_SLUG });

    expect(result.skipped).not.toBe('merged-into-canonical');
    expect(result.created).toBe(false);
    expect(String(result.entityId)).toBe(canonicalId.toHexString());

    expect(await ResearchEntity.countDocuments({ slug: SHELL_SLUG })).toBe(0);
    expect(await ResearchEntity.countDocuments({})).toBe(1);
  });
});

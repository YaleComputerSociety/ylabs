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
import { CanonicalAlias } from '../../models/canonicalAlias';
import { materializeEntity } from '../entityMaterializer';
import { resolveCanonical, type CanonicalKey } from '../resolveCanonical';

const LAB_URL = 'https://smithlab.example.edu';

async function seedResearchEntity(slug: string, name: string, websiteUrl: string): Promise<void> {
  const sourceId = new mongoose.Types.ObjectId();
  const fields: Array<[string, string]> = [
    ['name', name],
    ['websiteUrl', websiteUrl],
  ];
  for (const [field, value] of fields) {
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: slug,
      field,
      value,
      sourceId,
      sourceName: 'synthetic-lab-directory',
      sourceUrl: websiteUrl,
      confidence: 0.9,
      observedAt: new Date('2026-03-01T00:00:00Z'),
      superseded: false,
    });
  }
}

describe('resolve-at-mint for entities (C4_RESOLVE_AT_MINT_ENTITIES)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    await ResearchEntity.createIndexes();
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  afterEach(() => {
    delete process.env.C4_RESOLVE_AT_MINT_ENTITIES;
    vi.clearAllMocks();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'research_entities', 'canonical_aliases']) {
      await db.collection(name).deleteMany({});
    }
  });

  it('flag OFF: two labs sharing a website URL mint two rows (unchanged behavior)', async () => {
    await seedResearchEntity('smith-lab-a', 'Smith Lab', LAB_URL);
    await materializeEntity('researchEntity', { entityKey: 'smith-lab-a' });
    await seedResearchEntity('smith-lab-b', 'Smith Lab', LAB_URL);
    await materializeEntity('researchEntity', { entityKey: 'smith-lab-b' });

    expect(await ResearchEntity.countDocuments({})).toBe(2);
    expect(await CanonicalAlias.countDocuments({})).toBe(0);
  });

  it('flag ON: a lab sharing a website URL resolves to the canonical instead of minting a second', async () => {
    process.env.C4_RESOLVE_AT_MINT_ENTITIES = 'true';
    await seedResearchEntity('smith-lab-a', 'Smith Lab', LAB_URL);
    const first = await materializeEntity('researchEntity', { entityKey: 'smith-lab-a' });

    await seedResearchEntity('smith-lab-b', 'Smith Lab', LAB_URL);
    const second = await materializeEntity('researchEntity', { entityKey: 'smith-lab-b' });

    expect(await ResearchEntity.countDocuments({})).toBe(1);
    expect(second.created).toBe(false);
    expect(String(second.entityId)).toBe(String(first.entityId));

    const urlAlias = await CanonicalAlias.findOne({
      type: 'researchEntity',
      aliasNs: 'website-url',
    }).lean();
    expect(urlAlias).not.toBeNull();
    expect(String((urlAlias as unknown as { canonicalId: unknown }).canonicalId)).toBe(
      String(first.entityId),
    );
  });
});

describe('resolveCanonical guards (pure)', () => {
  const strongUrlKey: CanonicalKey = {
    ns: 'website-url',
    value: 'smithlab.example.edu',
    strength: 'strong',
  };
  const noAlias = { resolveAlias: async () => null };

  it('returns ambiguous when a strong key selects more than one candidate', async () => {
    const resolution = await resolveCanonical(
      { type: 'researchEntity', keys: [strongUrlKey], self: { id: '', name: 'Smith Lab' } },
      {
        ...noAlias,
        findCandidatesByKey: async () => [
          { id: 'a', name: 'Smith Lab' },
          { id: 'b', name: 'Smith Lab' },
        ],
      },
    );
    expect(resolution.status).toBe('ambiguous');
  });

  it('defers to mint when resolving to the candidate would demote the tier (non-demoting invariant)', async () => {
    const resolution = await resolveCanonical(
      {
        type: 'researchEntity',
        keys: [strongUrlKey],
        self: { id: '', name: 'Smith Lab', tier: 'student_ready' },
      },
      {
        ...noAlias,
        findCandidatesByKey: async () => [{ id: 'a', name: 'Smith Lab', tier: 'suppressed' }],
      },
    );
    expect(resolution.status).toBe('mint');
  });
});

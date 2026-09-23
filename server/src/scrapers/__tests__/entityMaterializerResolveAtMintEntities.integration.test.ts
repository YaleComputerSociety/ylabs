import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearC4Flags } from './c4FlagTestEnv';

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
import { materializeEntity } from '../entityMaterializer';
import { resolveCanonical, type CanonicalKey } from '../resolveCanonical';

// Each test states its own C4 flag position; none inherits one from the
// ambient environment (#2063).
beforeEach(clearC4Flags);

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

async function seedSourceUrlObservation(slug: string, sourceUrl: string): Promise<void> {
  await Observation.create({
    entityType: 'researchEntity',
    entityKey: slug,
    field: 'sourceUrl',
    value: sourceUrl,
    sourceId: new mongoose.Types.ObjectId(),
    sourceName: 'synthetic-lab-directory',
    sourceUrl,
    confidence: 0.9,
    observedAt: new Date('2026-03-01T00:00:00Z'),
    superseded: false,
  });
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
    for (const name of ['observations', 'research_entities']) {
      await db.collection(name).deleteMany({});
    }
  });

  it('flag OFF: two labs sharing a website URL mint two rows (unchanged behavior)', async () => {
    await seedResearchEntity('smith-lab-a', 'Smith Lab', LAB_URL);
    await materializeEntity('researchEntity', { entityKey: 'smith-lab-a' });
    await seedResearchEntity('smith-lab-b', 'Smith Lab', LAB_URL);
    await materializeEntity('researchEntity', { entityKey: 'smith-lab-b' });

    expect(await ResearchEntity.countDocuments({})).toBe(2);
  });

  it('flag ON: a second lab sharing a website URL resolves to the canonical instead of minting', async () => {
    process.env.C4_RESOLVE_AT_MINT_ENTITIES = 'true';
    await seedResearchEntity('smith-lab-a', 'Smith Lab', LAB_URL);
    const first = await materializeEntity('researchEntity', { entityKey: 'smith-lab-a' });

    await seedResearchEntity('smith-lab-b', 'Smith Lab', LAB_URL);
    const second = await materializeEntity('researchEntity', { entityKey: 'smith-lab-b' });

    expect(await ResearchEntity.countDocuments({})).toBe(1);
    expect(second.created).toBe(false);
    expect(String(second.entityId)).toBe(String(first.entityId));
  });

  // The key is normalized and the stored URL is not, so the arm has to recognise the
  // spellings the key folds together rather than only the one the first row stored.
  it('flag ON: the arm resolves across scheme, www and trailing-slash spellings', async () => {
    process.env.C4_RESOLVE_AT_MINT_ENTITIES = 'true';
    await seedResearchEntity('smith-lab-a', 'Smith Lab', 'http://www.smithlab.example.edu/');
    const first = await materializeEntity('researchEntity', { entityKey: 'smith-lab-a' });

    await seedResearchEntity('smith-lab-b', 'Smith Lab', 'https://smithlab.example.edu');
    const second = await materializeEntity('researchEntity', { entityKey: 'smith-lab-b' });

    expect(await ResearchEntity.countDocuments({})).toBe(1);
    expect(String(second.entityId)).toBe(String(first.entityId));
  });

  it('flag ON: a website URL two live rows already share is ambiguous, so it still mints', async () => {
    process.env.C4_RESOLVE_AT_MINT_ENTITIES = 'true';
    await seedResearchEntity('smith-lab-a', 'Smith Lab', LAB_URL);
    await materializeEntity('researchEntity', { entityKey: 'smith-lab-a' });
    await ResearchEntity.create({
      slug: 'smith-lab-rival',
      name: 'Smith Lab',
      websiteUrl: LAB_URL,
    });

    await seedResearchEntity('smith-lab-b', 'Smith Lab', LAB_URL);
    const second = await materializeEntity('researchEntity', { entityKey: 'smith-lab-b' });

    expect(second.created).toBe(true);
    expect(await ResearchEntity.countDocuments({})).toBe(3);
  });

  it('flag ON: a conflicting lead first name vetoes the fold', async () => {
    process.env.C4_RESOLVE_AT_MINT_ENTITIES = 'true';
    await seedResearchEntity('smith-lab-a', 'Alice Smith Lab', LAB_URL);
    await materializeEntity('researchEntity', { entityKey: 'smith-lab-a' });

    await seedResearchEntity('smith-lab-b', 'Bernard Smith Lab', LAB_URL);
    const second = await materializeEntity('researchEntity', { entityKey: 'smith-lab-b' });

    expect(second.created).toBe(true);
    expect(await ResearchEntity.countDocuments({})).toBe(2);
  });

  // #2572: the reachability gap that remains for the two namespaces whose keys have no
  // enumerable inverse. `profile-lab-url` lower-cases its path segments and `org-name`
  // the whole name, so neither can be looked up against the un-normalized stored value
  // the way `website-url` can. They are a pair rather than one case because
  // `profile-lab-url` is a `strong` key and `org-name` a `weak` one, so they fail at
  // different arms of `resolveCanonical`.
  it('flag ON: two labs sharing only a specific profile URL still mint two rows', async () => {
    process.env.C4_RESOLVE_AT_MINT_ENTITIES = 'true';
    const profileUrl = 'https://medicine.yale.edu/lab/smith';
    await seedResearchEntity('smith-lab-a', 'Smith Lab', 'https://a.example.edu');
    await seedSourceUrlObservation('smith-lab-a', profileUrl);
    await materializeEntity('researchEntity', { entityKey: 'smith-lab-a' });
    await seedResearchEntity('smith-lab-b', 'Smith Lab', 'https://b.example.edu');
    await seedSourceUrlObservation('smith-lab-b', profileUrl);
    const second = await materializeEntity('researchEntity', { entityKey: 'smith-lab-b' });

    expect(await ResearchEntity.countDocuments({})).toBe(2);
    expect(second.created).toBe(true);
  });

  it('flag ON: two entities sharing a normalized org name still mint two rows', async () => {
    process.env.C4_RESOLVE_AT_MINT_ENTITIES = 'true';
    await seedResearchEntity('smith-lab-a', 'Smith Laboratory', 'https://a.example.edu');
    await materializeEntity('researchEntity', { entityKey: 'smith-lab-a' });
    await seedResearchEntity('smith-lab-b', 'Smith Laboratory', 'https://b.example.edu');
    const second = await materializeEntity('researchEntity', { entityKey: 'smith-lab-b' });

    expect(await ResearchEntity.countDocuments({})).toBe(2);
    expect(second.created).toBe(true);
  });

  it('flag ON: a re-scrape of the SAME slug still resolves to its existing row', async () => {
    process.env.C4_RESOLVE_AT_MINT_ENTITIES = 'true';
    await seedResearchEntity('smith-lab-a', 'Smith Lab', LAB_URL);
    const first = await materializeEntity('researchEntity', { entityKey: 'smith-lab-a' });
    const second = await materializeEntity('researchEntity', { entityKey: 'smith-lab-a' });

    expect(await ResearchEntity.countDocuments({})).toBe(1);
    expect(String(second.entityId)).toBe(String(first.entityId));
  });
});

describe('resolveCanonical guards (pure)', () => {
  const strongUrlKey: CanonicalKey = {
    ns: 'website-url',
    value: 'smithlab.example.edu',
    strength: 'strong',
  };

  it('returns ambiguous when a strong key selects more than one candidate', async () => {
    const resolution = await resolveCanonical(
      { type: 'researchEntity', keys: [strongUrlKey], self: { id: '', name: 'Smith Lab' } },
      {
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
        findCandidatesByKey: async () => [{ id: 'a', name: 'Smith Lab', tier: 'suppressed' }],
      },
    );
    expect(resolution.status).toBe('mint');
  });
});

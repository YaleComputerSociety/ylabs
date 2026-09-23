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
import { deriveCanonicalKeys, resolveCanonical, type CanonicalKey } from '../resolveCanonical';

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

  // The rollback path. `off` has to be stated now that the default is on, which is
  // the whole point of the flip: absence no longer means off anywhere.
  it('flag explicitly OFF: two labs sharing a website URL mint two rows', async () => {
    process.env.C4_RESOLVE_AT_MINT_ENTITIES = 'false';
    await seedResearchEntity('smith-lab-a', 'Smith Lab', LAB_URL);
    await materializeEntity('researchEntity', { entityKey: 'smith-lab-a' });
    await seedResearchEntity('smith-lab-b', 'Smith Lab', LAB_URL);
    await materializeEntity('researchEntity', { entityKey: 'smith-lab-b' });

    expect(await ResearchEntity.countDocuments({})).toBe(2);
  });

  it('flag ABSENT: the fold is on by default, so the second lab does not mint', async () => {
    expect(process.env.C4_RESOLVE_AT_MINT_ENTITIES).toBeUndefined();
    await seedResearchEntity('smith-lab-a', 'Smith Lab', LAB_URL);
    const first = await materializeEntity('researchEntity', { entityKey: 'smith-lab-a' });

    await seedResearchEntity('smith-lab-b', 'Smith Lab', LAB_URL);
    const second = await materializeEntity('researchEntity', { entityKey: 'smith-lab-b' });

    expect(await ResearchEntity.countDocuments({})).toBe(1);
    expect(second.created).toBe(false);
    expect(String(second.entityId)).toBe(String(first.entityId));
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

  /**
   * A 302 counts as identity only if the chain ends on a public page, and the mint
   * resolver never fetches, so it must never fold a redirect pair. The key encoder
   * drops only the scheme, a leading `www.` and a trailing slash, so two paths that a
   * redirect would join stay distinct keys and both rows mint. Default-on does not
   * change this: it is the encoder's reach, not the flag, that bounds the fold.
   */
  it('default ON: two URLs that only a redirect would join are not folded', async () => {
    await seedResearchEntity('smith-lab-a', 'Smith Lab', 'https://smithlab.example.edu/old-home');
    await materializeEntity('researchEntity', { entityKey: 'smith-lab-a' });
    await seedResearchEntity('smith-lab-b', 'Smith Lab', 'https://smithlab.example.edu/new-home');
    const second = await materializeEntity('researchEntity', { entityKey: 'smith-lab-b' });

    expect(await ResearchEntity.countDocuments({})).toBe(2);
    expect(second.created).toBe(true);
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

  /**
   * A lab URL is not a person key. The refusal is structural rather than a check:
   * the `researcher` branch of `deriveCanonicalKeys` derives netid, orcid and a
   * person-specific email only, so a shared `websiteUrl` cannot even become a key
   * that would select a person. Turning the entity fold on by default must not
   * change that, so it is pinned at the encoder.
   */
  it('a researcher derives no website-url key, so a shared lab URL cannot select a person', () => {
    const keys = deriveCanonicalKeys('researcher', [
      { field: 'websiteUrl', value: 'https://smithlab.example.edu' },
      { field: 'sourceUrl', value: 'https://smithlab.example.edu' },
      { field: 'name', value: 'Smith Lab' },
    ]);
    expect(keys.map((key) => key.ns)).not.toContain('website-url');
    expect(keys).toHaveLength(0);
  });

  // Defense in depth for the same trap: even if a website-url key were somehow
  // supplied for a person, the person veto fails closed on a candidate whose name is
  // not a variant of the same person, so a lab row is refused rather than merged.
  it('a person veto refuses a lab candidate reached by a URL key', async () => {
    const resolution = await resolveCanonical(
      { type: 'researcher', keys: [strongUrlKey], self: { id: '', name: 'Ada Smith' } },
      { findCandidatesByKey: async () => [{ id: 'lab', name: 'Smith Lab' }] },
    );
    expect(resolution.status).not.toBe('existing');
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

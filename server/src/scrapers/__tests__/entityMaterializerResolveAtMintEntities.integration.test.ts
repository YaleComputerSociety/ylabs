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
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
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
   * resolver never fetches, so it folds a redirect pair only on a verdict link health
   * recorded (#5638). With none recorded, two paths a redirect would join stay distinct
   * keys and both rows mint.
   */
  it('default ON: two URLs that only a redirect would join are not folded', async () => {
    await seedResearchEntity('smith-lab-a', 'Smith Lab', 'https://smithlab.example.edu/old-home');
    await materializeEntity('researchEntity', { entityKey: 'smith-lab-a' });
    await seedResearchEntity('smith-lab-b', 'Smith Lab', 'https://smithlab.example.edu/new-home');
    const second = await materializeEntity('researchEntity', { entityKey: 'smith-lab-b' });

    expect(await ResearchEntity.countDocuments({})).toBe(2);
    expect(second.created).toBe(true);
  });

  it('default ON: a trailing default document is the directory it sits in', async () => {
    await seedResearchEntity('smith-lab-a', 'Smith Lab', 'https://med.example.edu/lab/smith/');
    const first = await materializeEntity('researchEntity', { entityKey: 'smith-lab-a' });
    await seedResearchEntity(
      'smith-lab-b',
      'Smith Lab',
      'https://med.example.edu/lab/smith/index.aspx',
    );
    const second = await materializeEntity('researchEntity', { entityKey: 'smith-lab-b' });
    const again = await materializeEntity('researchEntity', { entityKey: 'smith-lab-b' });

    expect(await ResearchEntity.countDocuments({})).toBe(1);
    expect(String(second.entityId)).toBe(String(first.entityId));
    expect(String(again.entityId)).toBe(String(first.entityId));
  });

  it('default ON: a redirect link health recorded folds a lab that moved to its own host', async () => {
    await seedResearchEntity('smith-lab-a', 'Smith Lab', 'https://smithlab.example.edu/');
    const first = await materializeEntity('researchEntity', { entityKey: 'smith-lab-a' });
    await ResearchEntity.updateOne(
      { _id: first.entityId },
      {
        $set: {
          sourceLinkHealth: [
            {
              url: 'http://www.example.edu/smithlab/',
              healthStatus: 'HEALTHY',
              httpStatusCode: 200,
              redirectLandingUrl: 'https://smithlab.example.edu/',
              checkedAt: new Date('2026-03-02T00:00:00Z'),
            },
          ],
        },
      },
    );

    await seedResearchEntity('smith-lab-b', 'Smith Lab', 'http://www.example.edu/smithlab/');
    const second = await materializeEntity('researchEntity', { entityKey: 'smith-lab-b' });
    const again = await materializeEntity('researchEntity', { entityKey: 'smith-lab-b' });

    expect(await ResearchEntity.countDocuments({})).toBe(1);
    expect(String(second.entityId)).toBe(String(first.entityId));
    expect(String(again.entityId)).toBe(String(first.entityId));
  });

  it('default ON: a mint whose own URL is a recorded redirect target folds into the alias row', async () => {
    await seedResearchEntity('smith-lab-a', 'Smith Lab', 'http://www.example.edu/smithlab/');
    const first = await materializeEntity('researchEntity', { entityKey: 'smith-lab-a' });
    await ResearchEntity.updateOne(
      { _id: first.entityId },
      {
        $set: {
          sourceLinkHealth: [
            {
              url: 'http://www.example.edu/smithlab/',
              healthStatus: 'HEALTHY',
              httpStatusCode: 200,
              redirectLandingUrl: 'https://smithlab.example.edu/',
            },
          ],
        },
      },
    );

    await seedResearchEntity('smith-lab-b', 'Smith Lab', 'https://smithlab.example.edu/');
    const second = await materializeEntity('researchEntity', { entityKey: 'smith-lab-b' });

    expect(await ResearchEntity.countDocuments({})).toBe(1);
    expect(String(second.entityId)).toBe(String(first.entityId));
  });

  it('default ON: a redirect to a row naming another lab does not fold the mint', async () => {
    await seedResearchEntity('vale-lab', 'Vale Lab', 'https://valelab.example.edu/');
    const first = await materializeEntity('researchEntity', { entityKey: 'vale-lab' });
    await ResearchEntity.updateOne(
      { _id: first.entityId },
      {
        $set: {
          sourceLinkHealth: [
            {
              url: 'http://www.example.edu/retired-lab/',
              healthStatus: 'HEALTHY',
              redirectLandingUrl: 'https://valelab.example.edu/',
            },
          ],
        },
      },
    );

    await seedResearchEntity('orr-lab', 'Orr Lab', 'http://www.example.edu/retired-lab/');
    const second = await materializeEntity('researchEntity', { entityKey: 'orr-lab' });

    expect(await ResearchEntity.countDocuments({})).toBe(2);
    expect(second.created).toBe(true);
  });

  it('default ON: two labs at different paths of one host still mint two rows', async () => {
    await seedResearchEntity('lee-lab-a', 'Lee Lab', 'https://med.example.edu/lab/lee-a/');
    const first = await materializeEntity('researchEntity', { entityKey: 'lee-lab-a' });
    await ResearchEntity.updateOne(
      { _id: first.entityId },
      {
        $set: {
          sourceLinkHealth: [
            {
              url: 'https://med.example.edu/lab/lee-a/old/',
              healthStatus: 'HEALTHY',
              redirectLandingUrl: 'https://med.example.edu/lab/lee-a/',
            },
          ],
        },
      },
    );
    await seedResearchEntity('lee-lab-b', 'Lee Lab', 'https://med.example.edu/lab/lee-b/');
    const second = await materializeEntity('researchEntity', { entityKey: 'lee-lab-b' });

    expect(await ResearchEntity.countDocuments({})).toBe(2);
    expect(second.created).toBe(true);
  });

  const recordMove = (from: string, to: string) => ({
    sourceLinkHealth: [
      { url: from, healthStatus: 'HEALTHY', httpStatusCode: 200, redirectLandingUrl: to },
    ],
  });

  it('default ON: a redirect recorded only on an archived row folds nothing', async () => {
    await seedResearchEntity('smith-lab-a', 'Smith Lab', 'https://smithlab.example.edu/');
    await materializeEntity('researchEntity', { entityKey: 'smith-lab-a' });
    await seedResearchEntity('smith-lab-old', 'Smith Lab', 'https://old.example.edu/smith/');
    const merged = await materializeEntity('researchEntity', { entityKey: 'smith-lab-old' });
    await ResearchEntity.updateOne(
      { _id: merged.entityId },
      {
        $set: {
          archived: true,
          ...recordMove('http://www.example.edu/smithlab/', 'https://smithlab.example.edu/'),
        },
      },
    );

    await seedResearchEntity('smith-lab-b', 'Smith Lab', 'http://www.example.edu/smithlab/');
    const second = await materializeEntity('researchEntity', { entityKey: 'smith-lab-b' });

    expect(second.created).toBe(true);
    expect(await ResearchEntity.countDocuments({ archived: { $ne: true } })).toBe(2);
  });

  it('default ON: a recorded redirect never folds a mint into an organization row', async () => {
    await seedResearchEntity('imaging-center', 'Imaging Center', 'https://imaging.example.edu/');
    const center = await materializeEntity('researchEntity', { entityKey: 'imaging-center' });
    await ResearchEntity.updateOne(
      { _id: center.entityId },
      {
        $set: {
          entityType: 'CENTER',
          ...recordMove('https://www.example.edu/smithlab/', 'https://imaging.example.edu/'),
        },
      },
    );

    await seedResearchEntity('smith-lab-b', 'Smith Lab', 'https://www.example.edu/smithlab/');
    const second = await materializeEntity('researchEntity', { entityKey: 'smith-lab-b' });

    expect(second.created).toBe(true);
    expect(await ResearchEntity.countDocuments({})).toBe(2);
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

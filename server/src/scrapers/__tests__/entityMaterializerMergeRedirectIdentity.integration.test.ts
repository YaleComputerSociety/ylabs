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
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import { materializeEntity } from '../entityMaterializer';

const SURVIVOR_SLUG = 'faculty-research-area-ada-example';
const LISTED_AREAS = ['Immunology'];

describe('a merge redirect carries lane evidence onto a person row only for its named lead (#5771)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'research_entities', 'researchers', 'role_assignments']) {
      await db.collection(name).deleteMany({});
    }
  });

  const seedObservation = async (entityKey: string, field: string, value: unknown) => {
    await Observation.create({
      entityType: 'researchEntity',
      entityKey,
      field,
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'dept-faculty-roster',
      sourceUrl: `https://dept.yale.edu/people/${entityKey}`,
      confidence: 0.9,
      observedAt: new Date('2026-02-01T00:00:00Z'),
      superseded: false,
    });
  };

  const seedLead = async (
    rowId: mongoose.Types.ObjectId,
    displayName: string,
    netid: string,
    profileUrl?: string,
  ) => {
    const researcher = await Researcher.create({
      displayName,
      identifiers: { netid },
      profileLinks: profileUrl
        ? [
            {
              kind: 'YALE_OFFICIAL',
              purpose: 'PRIMARY_IDENTITY',
              url: profileUrl,
              verifiedAt: new Date('2026-02-01T00:00:00Z'),
            },
          ]
        : [],
      archived: false,
    });
    await RoleAssignment.create({
      personId: researcher._id,
      target: { kind: 'RESEARCH_ENTITY', id: rowId },
      role: 'PI',
      state: 'CURRENT',
      confidence: 0.9,
      reviewStatus: 'UNREVIEWED',
      archived: false,
    });
  };

  const seedSurvivor = async () => {
    const survivor = await ResearchEntity.create({
      slug: SURVIVOR_SLUG,
      name: 'Ada Example Faculty Research',
      entityType: 'FACULTY_RESEARCH_AREA',
      kind: 'individual',
      archived: false,
    });
    await seedObservation(SURVIVOR_SLUG, 'name', 'Ada Example Faculty Research');
    await seedObservation(SURVIVOR_SLUG, 'entityType', 'FACULTY_RESEARCH_AREA');
    await seedLead(survivor._id, 'Ada Example', 'ae11');
    return survivor;
  };

  const seedListing = async (
    survivorId: mongoose.Types.ObjectId,
    slug: string,
    listedName: string,
  ) => {
    await ResearchEntity.create({
      slug,
      name: `${listedName} Faculty Research`,
      entityType: 'FACULTY_RESEARCH_AREA',
      kind: 'individual',
      archived: true,
      canonicalGroupId: survivorId,
    });
    await seedObservation(slug, 'name', `${listedName} Faculty Research`);
    await seedObservation(slug, 'researchAreas', LISTED_AREAS);
  };

  const survivorAreas = async (id: mongoose.Types.ObjectId) => [
    ...((await ResearchEntity.findById(id).lean<{ researchAreas?: string[] }>())?.researchAreas ??
      []),
  ];

  it('refuses the evidence of a given-name prefix pair redirected onto the row', async () => {
    const survivor = await seedSurvivor();
    await seedListing(survivor._id, 'dept-roster-adaline-example', 'Adaline Example');

    const viaListing = await materializeEntity('researchEntity', {
      entityKey: 'dept-roster-adaline-example',
    });
    await materializeEntity('researchEntity', { entityKey: SURVIVOR_SLUG });

    expect(viaListing.skipped).toBe('merge-redirect-identity-refused');
    expect(await survivorAreas(survivor._id)).toEqual([]);
    expect(
      await Observation.countDocuments({ entityKey: 'dept-roster-adaline-example' }),
    ).toBeGreaterThan(0);
  });

  it('admits a genuine same-person redirect under a curated nickname', async () => {
    const survivor = await seedSurvivor();
    await seedListing(survivor._id, 'dept-roster-adaline-example', 'Ada Example');

    const viaListing = await materializeEntity('researchEntity', {
      entityKey: 'dept-roster-adaline-example',
    });

    expect(viaListing.skipped).toBeUndefined();
    expect(String(viaListing.entityId)).toBe(survivor._id.toHexString());
    expect(await survivorAreas(survivor._id)).toEqual(LISTED_AREAS);
  });

  it('admits a prefix-shaped listing whose netid is the named lead', async () => {
    const survivor = await seedSurvivor();
    await seedListing(survivor._id, 'dept-roster-adaline-example', 'Adaline Example');
    await seedObservation('dept-roster-adaline-example', 'inferredPiUserKey', 'netid:ae11');

    await materializeEntity('researchEntity', { entityKey: SURVIVOR_SLUG });

    expect(await survivorAreas(survivor._id)).toEqual(LISTED_AREAS);
  });

  it('refuses a listing whose only witness is another lead on the row', async () => {
    const survivor = await seedSurvivor();
    await seedLead(survivor._id, 'Mia Sample', 'ms22', 'https://dept.yale.edu/people/mia-sample');
    await seedListing(survivor._id, 'dept-roster-mia-sample', 'Mia Sample');
    await seedObservation('dept-roster-mia-sample', 'inferredPiUserKey', 'netid:ms22');
    await seedObservation('dept-roster-mia-sample', 'sourceUrls', [
      'https://dept.yale.edu/people/mia-sample',
    ]);

    const viaListing = await materializeEntity('researchEntity', {
      entityKey: 'dept-roster-mia-sample',
    });
    await materializeEntity('researchEntity', { entityKey: SURVIVOR_SLUG });

    expect(viaListing.skipped).toBe('merge-redirect-identity-refused');
    expect(await survivorAreas(survivor._id)).toEqual([]);
  });

  it('derives the same refusal on a second run without writing a field', async () => {
    const survivor = await seedSurvivor();
    await seedListing(survivor._id, 'dept-roster-adaline-example', 'Adaline Example');

    await materializeEntity('researchEntity', { entityKey: SURVIVOR_SLUG });
    const first = await ResearchEntity.findById(survivor._id).lean();
    const second = await materializeEntity('researchEntity', { entityKey: SURVIVOR_SLUG });
    const after = await ResearchEntity.findById(survivor._id).lean();

    expect(await survivorAreas(survivor._id)).toEqual([]);
    expect(second.fieldsWritten).toBe(0);
    expect({ ...after, updatedAt: undefined }).toEqual({ ...first, updatedAt: undefined });
  });
});

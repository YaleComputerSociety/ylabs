import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return {
    ...actual,
    syncEntities: vi.fn(async () => {}),
    syncEntity: vi.fn(async () => true),
    deleteFromIndex: vi.fn(async () => {}),
  };
});

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { ResearchEntityRelationship } from '../../models/researchEntityRelationship';
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import { materializeEntity } from '../entityMaterializer';
import { appendObservations } from '../observationStore';
import type { ObservationInput } from '../types';
import { clearC4Flags } from './c4FlagTestEnv';

const SOURCE_NAME = 'centers-institutes-index';
const SOURCE_ID = new mongoose.Types.ObjectId();
const CENTER_SLUG = 'center-synthetic-citation';
const LAB_SLUG = 'synthetic-cited-lab';
const ENTITY_KEY = `${CENTER_SLUG}:${LAB_SLUG}:MEMBER_RESEARCH_AREA`;
const ROSTER_URL = 'https://fixture-center.example.edu/people';

const FACULTY_AREA_SLUG = 'faculty-research-area-synthetic-cited-person';
const FACULTY_AREA_ENTITY_KEY = `${CENTER_SLUG}:${FACULTY_AREA_SLUG}:MEMBER_RESEARCH_AREA`;

const relationshipObservations = (
  sourceUrl: string,
  targetSlug = LAB_SLUG,
  entityKey = ENTITY_KEY,
): ObservationInput[] => {
  const base = {
    entityType: 'researchEntityRelationship' as const,
    entityKey,
    sourceUrl,
  };
  return [
    { ...base, field: 'sourceEntityKey', value: CENTER_SLUG },
    { ...base, field: 'targetEntityKey', value: targetSlug },
    { ...base, field: 'relationshipType', value: 'MEMBER_RESEARCH_AREA' },
    { ...base, field: 'evidenceStrength', value: 'MODERATE' },
    { ...base, field: 'confidence', value: 0.72 },
  ];
};

const observeAndMaterialize = async (observations: ObservationInput[], entityKey = ENTITY_KEY) => {
  await appendObservations(observations, {
    scrapeRunId: String(new mongoose.Types.ObjectId()),
    sourceId: String(SOURCE_ID),
    sourceName: SOURCE_NAME,
    sourceWeight: 0.8,
    dryRun: false,
  });
  return materializeEntity('researchEntityRelationship', { entityKey });
};

const storedEdge = async () =>
  (await ResearchEntityRelationship.findOne({ archived: { $ne: true } }).lean()) as {
    sourceUrl?: string;
    evidenceQuote?: string;
  } | null;

describe('a relationship cites the page its observation read (#4024)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    await Observation.syncIndexes();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    clearC4Flags();
    const db = mongoose.connection.db!;
    for (const name of [
      'observations',
      'research_entities',
      'research_entity_relationships',
      'researchers',
      'role_assignments',
    ]) {
      await db.collection(name).deleteMany({});
    }
    await ResearchEntity.create([
      {
        slug: CENTER_SLUG,
        name: 'Synthetic Citation Center',
        kind: 'center',
        entityType: 'CENTER',
        archived: false,
      },
      {
        slug: LAB_SLUG,
        name: 'Synthetic Cited Lab',
        kind: 'lab',
        entityType: 'LAB',
        archived: false,
      },
    ]);
  });

  it('stores the top-level sourceUrl of the observations when no lane emits a sourceUrl field', async () => {
    const result = await observeAndMaterialize(relationshipObservations(ROSTER_URL));

    expect(result.skipped).toBeUndefined();
    expect((await storedEdge())?.sourceUrl).toBe(ROSTER_URL);
  });

  it('keeps a stored citation when a later observation carries no page', async () => {
    await observeAndMaterialize(relationshipObservations(ROSTER_URL));
    await Observation.updateMany({}, { $set: { superseded: true } });

    const result = await observeAndMaterialize(relationshipObservations(''));

    expect(result.skipped).toBeUndefined();
    expect(result.entityId).toBeDefined();
    expect(await Observation.countDocuments({ superseded: { $ne: true } })).toBeGreaterThan(0);
    expect((await storedEdge())?.sourceUrl).toBe(ROSTER_URL);
  });

  it('cites the page on the PI membership of a faculty research area it links', async () => {
    const area = await ResearchEntity.create({
      slug: FACULTY_AREA_SLUG,
      name: 'Synthetic Cited Person Research',
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
      archived: false,
    });
    const researcher = await Researcher.create({
      displayName: 'Synthetic Cited Person',
      profileLinks: [],
      archived: false,
    });

    const result = await observeAndMaterialize(
      relationshipObservations(ROSTER_URL, FACULTY_AREA_SLUG, FACULTY_AREA_ENTITY_KEY),
      FACULTY_AREA_ENTITY_KEY,
    );

    expect(result.skipped).toBeUndefined();
    const membership = (await RoleAssignment.findOne({
      personId: researcher._id,
      'target.id': area._id,
    }).lean()) as { rosterProvenance?: { sourceUrl?: string } } | null;
    expect(membership?.rosterProvenance?.sourceUrl).toBe(ROSTER_URL);
    expect(membership?.rosterProvenance).toMatchObject({ sourceName: SOURCE_NAME });
  });

  it("keeps another lane's provenance on the lead edge a faculty research area already holds (#4020)", async () => {
    const area = await ResearchEntity.create({
      slug: FACULTY_AREA_SLUG,
      name: 'Synthetic Cited Person Research',
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
      archived: false,
    });
    const researcher = await Researcher.create({
      displayName: 'Synthetic Cited Person',
      profileLinks: [],
      archived: false,
    });
    const owningProvenance = {
      sourceName: 'official-profile-pi-backfill',
      sourceUrl: 'https://fixture-profile.example.edu/person',
      observedAt: new Date('2026-09-01T00:00:00Z'),
    };
    await RoleAssignment.create({
      personId: researcher._id,
      target: { kind: 'RESEARCH_ENTITY', id: area._id },
      role: 'PI',
      state: 'CURRENT',
      confidence: 0.9,
      archived: false,
      reviewStatus: 'UNREVIEWED',
      rosterProvenance: owningProvenance,
    });

    const result = await observeAndMaterialize(
      relationshipObservations(ROSTER_URL, FACULTY_AREA_SLUG, FACULTY_AREA_ENTITY_KEY),
      FACULTY_AREA_ENTITY_KEY,
    );

    expect(result.skipped).toBeUndefined();
    const leads = (await RoleAssignment.find({
      'target.id': area._id,
      role: 'PI',
    }).lean()) as Array<{
      rosterProvenance?: Record<string, unknown>;
    }>;
    expect(leads).toHaveLength(1);
    expect(leads[0].rosterProvenance).toEqual(owningProvenance);
  });
});

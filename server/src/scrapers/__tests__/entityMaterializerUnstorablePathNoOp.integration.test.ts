import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return { ...actual, syncEntity: vi.fn().mockResolvedValue(undefined) };
});

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return { ...actual, recomputeBrowseRankForEntities: vi.fn().mockResolvedValue(undefined) };
});

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { materializeEntity, materializerProjectionPathIsStorable } from '../entityMaterializer';
import { syncEntity } from '../../services/meiliSyncService';

const SLUG = 'unstorable-path-fixture';
const SOURCE_URL = 'https://example.edu/lab/';

/**
 * Observation fields the projection plans by name while a sibling derivation, not
 * the entity row, consumes them. Measured on Development over a 300-row sample of
 * real dry-run projections (#3869); `docs/research-data-pipeline.md` records the
 * same set as the census's `unstorable` class. Each entry states what consumes it,
 * because that is what makes the plan legitimate rather than a defect to repair.
 */
const REVIEWED_DERIVATION_ONLY_PATHS: Record<string, string> = {
  inferredPiUserId: 'materializeInferredPiMembership builds the lead role edge from it',
  inferredPiUserKey: 'resolveInferredPiKeyIdentity resolves it to a researcher, then the lead edge',
  contactInstructionsQuote: 'the contact-route upsert, and the served payload withholds contacts',
  inferredDirectorName: 'the inferred-director lead edge',
  inferredDirectorUserName: 'the inferred-director lead edge',
  inferredDirectorRole: 'the inferred-director lead edge',
  inferredDirectorTitle: 'the inferred-director lead edge',
  inferredDirectorProfileUrl: 'the inferred-director lead edge',
  undergradAccessEvidence: 'the undergrad access-signal upsert',
  undergradRoleEvidenceQuote: 'the undergrad access-signal upsert',
  undergradConstraintQuote: 'the undergrad access-signal upsert',
  joinPageUrl: 'the contact-route upsert',
  studentDecisionExplanation: 'legacy stored value on rows no schema path declares',
  description: 'legacy stored value on rows no schema path declares; the schema declares no path',
  sourceCategory: 'resolved for the merge and identity arms rather than stored on the row',
};

/**
 * What the fixture seeds, written out rather than derived from the reviewed map:
 * driving the seed from the map under test makes the guard self-fulfilling, since
 * removing an entry also stops the fixture exercising it.
 */
const FIXTURE_SEEDED_FIELDS = [
  'inferredPiUserId',
  'inferredPiUserKey',
  'inferredDirectorName',
  'inferredDirectorUserName',
  'inferredDirectorRole',
  'inferredDirectorTitle',
  'inferredDirectorProfileUrl',
  'undergradAccessEvidence',
  'undergradRoleEvidenceQuote',
  'undergradConstraintQuote',
  'contactInstructionsQuote',
  'joinPageUrl',
  'studentDecisionExplanation',
  'description',
  'sourceCategory',
];

/**
 * What the engine actually plans from that fixture, also written out, so a path
 * entering or leaving the class fails here instead of being absorbed.
 */
const FIXTURE_PLANS_UNSTORABLE = [
  'contactInstructionsQuote',
  'description',
  'inferredDirectorName',
  'inferredDirectorProfileUrl',
  'inferredDirectorRole',
  'inferredDirectorTitle',
  'inferredDirectorUserName',
  'inferredPiUserId',
  'inferredPiUserKey',
  'joinPageUrl',
  'sourceCategory',
  'studentDecisionExplanation',
  'undergradAccessEvidence',
  'undergradConstraintQuote',
  'undergradRoleEvidenceQuote',
];

describe('#3869 a projection path the schema cannot store does not hold a row open', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

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
    for (const name of ['observations', 'research_entities', 'role_assignments', 'researchers']) {
      await db.collection(name).deleteMany({});
    }
    await ResearchEntity.create({
      slug: SLUG,
      name: 'Unstorable Fixture Lab',
      kind: 'lab',
      studentVisibilityTier: 'operator_review',
      archived: false,
      // Every observation carries a sourceUrl the projection also plans as
      // websiteUrl, so the row has to store it or that storable field is a second
      // difference and the fixture cannot isolate the unstorable one.
      websiteUrl: SOURCE_URL,
    });
  });

  const seedObservation = async (field: string, value: unknown) => {
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: SLUG,
      field,
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'lab-microsite-description-llm',
      sourceUrl: SOURCE_URL,
      confidence: 0.9,
      observedAt: new Date('2026-01-01T00:00:00Z'),
      superseded: false,
    });
  };

  const materialize = () => materializeEntity('researchEntity', { entityKey: SLUG });
  const storedUpdatedAt = async () => {
    const doc = await ResearchEntity.findOne({ slug: SLUG })
      .select('updatedAt')
      .lean<{ updatedAt?: Date }>();
    return doc?.updatedAt?.toISOString();
  };

  it('skips the write, the updatedAt bump and the index re-sync once the storable fields agree', async () => {
    await seedObservation('name', 'Unstorable Fixture Lab');
    await seedObservation('inferredPiUserId', '0123456789abcdef01234567');
    await seedObservation('contactInstructionsQuote', 'Email the lab to ask about openings.');

    await materialize();
    const converged = await storedUpdatedAt();
    vi.clearAllMocks();

    const second = await materialize();

    expect(second.skipped).toBe('unchanged');
    expect(second.fieldsWritten).toBe(0);
    expect(await storedUpdatedAt()).toBe(converged);
    expect(vi.mocked(syncEntity)).not.toHaveBeenCalled();
  });

  it('still writes when one storable field differs alongside the unstorable ones', async () => {
    await seedObservation('name', 'Unstorable Fixture Lab');
    await seedObservation('inferredPiUserId', '0123456789abcdef01234567');

    await materialize();
    await Observation.updateMany(
      { entityKey: SLUG, field: 'name' },
      { $set: { superseded: true } },
    );
    await seedObservation('name', 'Renamed Fixture Lab');

    const second = await materialize();

    expect(second.skipped).toBeUndefined();
    expect(second.fieldsWritten).toBeGreaterThan(0);
    const doc = await ResearchEntity.findOne({ slug: SLUG }).lean<{ name?: string }>();
    expect(doc?.name).toBe('Renamed Fixture Lab');
  });

  it('never stores the unstorable path, so skipping its comparison changes no stored value', async () => {
    await seedObservation('name', 'Unstorable Fixture Lab');
    await seedObservation('inferredPiUserId', '0123456789abcdef01234567');

    await materialize();

    const raw = await mongoose.connection
      .db!.collection('research_entities')
      .findOne({ slug: SLUG });
    expect(raw).toBeTruthy();
    expect(Object.prototype.hasOwnProperty.call(raw!, 'inferredPiUserId')).toBe(false);
  });

  it('plans no unstorable path that is not a reviewed derivation-only entry', async () => {
    await seedObservation('name', 'Unstorable Fixture Lab');
    for (const field of FIXTURE_SEEDED_FIELDS) {
      await seedObservation(field, field === 'inferredPiUserId' ? '0123456789abcdef01234567' : 'x');
    }

    const plan = await materializeEntity('researchEntity', { entityKey: SLUG }, { dryRun: true });
    const planned = Object.keys(plan.plannedSet ?? {});
    expect(planned.length).toBeGreaterThan(0);

    const schemaPaths = Object.keys(ResearchEntity.schema.paths);
    const unreviewed = planned.filter(
      (path) =>
        !materializerProjectionPathIsStorable(schemaPaths, path) &&
        !Object.prototype.hasOwnProperty.call(REVIEWED_DERIVATION_ONLY_PATHS, path),
    );
    expect(unreviewed).toEqual([]);

    // The reverse direction, so the list cannot accumulate dead entries and a
    // reviewed path dropping out of the plan fails here too. Without it this
    // assertion passes with any entry removed from the list, which is a test that
    // cannot fail.
    const plannedUnstorable = planned
      .filter((path) => !materializerProjectionPathIsStorable(schemaPaths, path))
      .sort();
    expect(plannedUnstorable).toEqual([...FIXTURE_PLANS_UNSTORABLE].sort());
  });

  it('keeps the reviewed list honest: every entry is a path the schema really cannot store', () => {
    const schemaPaths = Object.keys(ResearchEntity.schema.paths);
    const nowStorable = Object.keys(REVIEWED_DERIVATION_ONLY_PATHS).filter((path) =>
      materializerProjectionPathIsStorable(schemaPaths, path),
    );
    expect(nowStorable).toEqual([]);
  });
});

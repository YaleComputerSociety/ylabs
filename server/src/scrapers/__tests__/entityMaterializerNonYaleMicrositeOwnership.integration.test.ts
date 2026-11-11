import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return { ...actual, syncEntity: vi.fn().mockResolvedValue(undefined) };
});

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import { materializeEntity } from '../entityMaterializer';

const SLUG = 'estuary-microsite-ownership-fixture';
const RESEARCH =
  'The research examines how estuarine sediment moves during storm surges, combining field cores from tidal marshes with numerical models of channel erosion and deposition.';

describe('a non-Yale microsite description resolves only when the page confirms the lead (#5777)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'research_entities', 'researchers', 'role_assignments'])
      await db.collection(name).deleteMany({});
    const entity = await ResearchEntity.create({
      slug: SLUG,
      name: 'Estuary Microsite Fixture',
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
      studentVisibilityTier: 'operator_review',
      archived: false,
    });
    const person = await Researcher.create({ displayName: 'Quillon Varnadore', archived: false });
    await RoleAssignment.create({
      personId: person._id,
      target: { kind: 'RESEARCH_ENTITY', id: entity._id },
      role: 'PI',
      evidenceClaimIds: [],
      confidence: 0.9,
      reviewStatus: 'UNREVIEWED',
      archived: false,
      state: 'CURRENT',
    });
  });

  const seed = (sourceUrl: string) =>
    Observation.create({
      entityType: 'researchEntity',
      entityKey: SLUG,
      field: 'fullDescription',
      value: RESEARCH,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'lab-microsite-description-llm',
      sourceUrl,
      confidence: 0.9,
      observedAt: new Date(),
      superseded: false,
    });

  const plannedFullDescription = async () =>
    (await materializeEntity('researchEntity', { entityKey: SLUG }, { dryRun: true })).plannedSet
      ?.fullDescription;

  it('drops a description from a non-Yale page that does not confirm the lead, writing nothing', async () => {
    await seed('https://coastal-foundation.example.org/about');
    const before = await Observation.find().lean();
    expect(await plannedFullDescription()).toBeUndefined();
    await materializeEntity('researchEntity', { entityKey: SLUG }, { dryRun: false });
    const row = (await ResearchEntity.findOne({ slug: SLUG }).lean()) as Record<string, any>;
    expect(row.fullDescription ?? '').not.toContain('estuarine sediment');
    expect(row.manuallyLockedFields ?? []).not.toContain('fullDescription');
    const after = await Observation.find().lean();
    expect(after.map((obs) => [String(obs._id), obs.superseded, String(obs.value)])).toEqual(
      before.map((obs) => [String(obs._id), obs.superseded, String(obs.value)]),
    );
  });

  it('keeps a description whose non-Yale page carries the lead surname in its address', async () => {
    await seed('https://varnadorelab.example.org/research');
    expect(await plannedFullDescription()).toBe(RESEARCH);
  });

  it('keeps a description whose stored page text names the lead', async () => {
    const pageUrl = 'https://tidewater-collaborative.example.org/team';
    await seed(pageUrl);
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: SLUG,
      field: 'researchPageText',
      value: [{ url: pageUrl, text: `Principal investigator: Quillon Varnadore. ${RESEARCH}` }],
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'research-page-text',
      sourceUrl: pageUrl,
      confidence: 0.9,
      observedAt: new Date(),
      superseded: false,
    });
    expect(await plannedFullDescription()).toBe(RESEARCH);
  });

  it('keeps a description from a Yale-hosted page', async () => {
    await seed('https://medicine.yale.edu/lab/estuary/');
    expect(await plannedFullDescription()).toBe(RESEARCH);
  });

  it('leaves a lab row unaffected', async () => {
    await ResearchEntity.updateOne({ slug: SLUG }, { $set: { entityType: 'LAB', kind: 'lab' } });
    await seed('https://coastal-foundation.example.org/about');
    expect(await plannedFullDescription()).toBe(RESEARCH);
  });
});

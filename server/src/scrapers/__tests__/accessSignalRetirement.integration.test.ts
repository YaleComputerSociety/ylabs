import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return {
    ...actual,
    syncEntity: vi.fn().mockResolvedValue(undefined),
    syncEntities: vi.fn().mockResolvedValue(undefined),
    deleteFromIndex: vi.fn().mockResolvedValue(undefined),
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
import { Signal } from '../../models/signal';
import { ACCESS_SIGNAL_EVIDENCE_WITHDRAWN_REASON } from '../accessMaterializer';
import { materializeEntity } from '../entityMaterializer';

const LANE = 'lab-microsite-undergrad-llm';
const PAGE = 'https://syntheticlab.example.org/join';
const ROSTER = 'https://syntheticlab.example.org/people';

const seed = (
  entityKey: string,
  field: string,
  value: unknown,
  observedAt = '2026-09-01',
  sourceUrl = PAGE,
) =>
  Observation.create({
    entityType: 'researchEntity',
    entityKey,
    field,
    value,
    sourceId: new mongoose.Types.ObjectId(),
    sourceName: LANE,
    sourceUrl,
    confidence: 0.8,
    observedAt: new Date(`${observedAt}T00:00:00Z`),
    superseded: false,
  });

async function seedLab(entityKey: string) {
  await seed(entityKey, 'slug', entityKey);
  await seed(entityKey, 'name', 'Synthetic Tidepool Lab');
  await seed(entityKey, 'entityType', 'LAB');
  await seed(entityKey, 'kind', 'lab');
  await seed(entityKey, 'sourceUrls', [PAGE]);
  const access = await seed(entityKey, 'undergradAccessEvidence', {
    openToUndergrads: 'yes',
    evidenceSource: 'explicit_text',
    evidenceQuote: 'Undergraduates are welcome to join the lab.',
  });
  await seed(entityKey, 'currentUndergradCount', 2, '2026-09-01', ROSTER);
  const advisees = await seed(entityKey, 'pastUndergradAdvisees', [
    { name: 'Synthetic Advisee', year: 2024 },
  ]);
  return { access, advisees };
}

const resolve = (entityKey: string) => materializeEntity('researchEntity', { entityKey }, {});

async function liveKeys(entityKey: string): Promise<string[]> {
  const row = await ResearchEntity.findOne({ slug: entityKey }).lean<{
    _id: mongoose.Types.ObjectId;
  }>();
  const signals = await Signal.find({ researchEntityId: row?._id, archived: { $ne: true } }).lean();
  return signals.map((signal: any) => String(signal.derivationKey)).sort();
}

describe('the access materializer retires a signal it no longer derives (#3920)', () => {
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
    for (const name of ['observations', 'research_entities', 'role_assignments', 'signals']) {
      await db.collection(name).deleteMany({});
    }
  });

  it('archives a signal whose evidence was withdrawn, keeps the rest, and plans nothing on a second pass', async () => {
    const { access, advisees } = await seedLab('synthetic-tidepool-lab');
    await seedLab('synthetic-kelp-lab');
    await resolve('synthetic-tidepool-lab');
    await resolve('synthetic-kelp-lab');
    const full = await liveKeys('synthetic-tidepool-lab');
    expect(full).toEqual(expect.arrayContaining(['signal:PAST_UNDERGRADS']));

    await Observation.updateMany(
      { _id: { $in: [access._id, advisees._id] } },
      { $set: { superseded: true } },
    );
    await resolve('synthetic-tidepool-lab');
    const remaining = await liveKeys('synthetic-tidepool-lab');
    expect(remaining).toContain('signal:CURRENT_UNDERGRADS');
    expect(remaining).not.toContain('signal:PAST_UNDERGRADS');
    const archived = await Signal.findOne({
      derivationKey: 'signal:PAST_UNDERGRADS',
      archived: true,
    }).lean<any>();
    expect(archived?.archivedReason).toBe(ACCESS_SIGNAL_EVIDENCE_WITHDRAWN_REASON);

    const before = await Signal.find({}).lean();
    await resolve('synthetic-tidepool-lab');
    const after = await Signal.find({}).lean();
    expect(after.map((signal: any) => [String(signal._id), signal.archived])).toEqual(
      before.map((signal: any) => [String(signal._id), signal.archived]),
    );
    expect(await liveKeys('synthetic-kelp-lab')).toEqual(full);
  }, 120000);

  it('restores a retired signal once the evidence derives it again', async () => {
    const { advisees } = await seedLab('synthetic-tidepool-lab');
    await resolve('synthetic-tidepool-lab');
    const full = await liveKeys('synthetic-tidepool-lab');
    await Observation.updateOne({ _id: advisees._id }, { $set: { superseded: true } });
    await resolve('synthetic-tidepool-lab');
    expect(await liveKeys('synthetic-tidepool-lab')).not.toContain('signal:PAST_UNDERGRADS');
    await Observation.updateOne({ _id: advisees._id }, { $set: { superseded: false } });
    await resolve('synthetic-tidepool-lab');
    expect(await liveKeys('synthetic-tidepool-lab')).toEqual(full);
  }, 120000);

  it('keeps a signal whose cited evidence is live under a key this pass did not read', async () => {
    await seedLab('synthetic-tidepool-lab');
    await resolve('synthetic-tidepool-lab');
    const pastUndergrads = await Signal.findOne({
      derivationKey: 'signal:PAST_UNDERGRADS',
    }).lean<any>();
    const foreign = await seed('synthetic-unminted-key', 'pastUndergradAdvisees', [
      { name: 'Synthetic Advisee', year: 2024 },
    ]);
    await Signal.updateOne(
      { _id: pastUndergrads._id },
      { $set: { 'source.evidenceIds': [foreign._id] } },
    );
    await Observation.updateMany(
      { entityKey: 'synthetic-tidepool-lab', field: 'pastUndergradAdvisees' },
      { $set: { superseded: true } },
    );
    await seed('synthetic-tidepool-lab', 'pastUndergradAdvisees', [], '2026-09-15');
    await resolve('synthetic-tidepool-lab');
    expect(await liveKeys('synthetic-tidepool-lab')).toContain('signal:PAST_UNDERGRADS');
  }, 120000);

  it('retires the current-undergraduates signal once a later read counts zero, and restores it on a positive one (#4580)', async () => {
    await seedLab('synthetic-tidepool-lab');
    await resolve('synthetic-tidepool-lab');
    expect(await liveKeys('synthetic-tidepool-lab')).toContain('signal:CURRENT_UNDERGRADS');

    await seed('synthetic-tidepool-lab', 'currentUndergradCount', 0, '2026-09-15', ROSTER);
    await resolve('synthetic-tidepool-lab');
    expect(await liveKeys('synthetic-tidepool-lab')).not.toContain('signal:CURRENT_UNDERGRADS');
    const retired = await Signal.findOne({
      derivationKey: 'signal:CURRENT_UNDERGRADS',
    }).lean<any>();
    expect(retired.archivedReason).toBe(ACCESS_SIGNAL_EVIDENCE_WITHDRAWN_REASON);

    await seed('synthetic-tidepool-lab', 'currentUndergradCount', 3, '2026-09-20', ROSTER);
    await resolve('synthetic-tidepool-lab');
    expect(await liveKeys('synthetic-tidepool-lab')).toContain('signal:CURRENT_UNDERGRADS');
  }, 120000);

  it('retires the current-undergraduates signal when its only count is from the retired cache backfill (#4580)', async () => {
    await seedLab('synthetic-tidepool-lab');
    await resolve('synthetic-tidepool-lab');
    await Observation.updateMany(
      { entityKey: 'synthetic-tidepool-lab', field: 'currentUndergradCount' },
      { $set: { sourceName: 'research-entity-cache-backfill' } },
    );
    await resolve('synthetic-tidepool-lab');
    expect(await liveKeys('synthetic-tidepool-lab')).not.toContain('signal:CURRENT_UNDERGRADS');
  }, 120000);

  it('keeps the current-undergraduates signal a merged-in row count still derives (#4580)', async () => {
    await seedLab('synthetic-tidepool-lab');
    await resolve('synthetic-tidepool-lab');
    const row = await ResearchEntity.findOne({ slug: 'synthetic-tidepool-lab' }).lean<any>();
    await mongoose.connection.db!.collection('research_entities').insertOne({
      _id: new mongoose.Types.ObjectId(),
      slug: 'synthetic-tidepool-lab-merged',
      name: 'Synthetic Tidepool Lab Merged',
      archived: true,
      canonicalGroupId: row._id,
    });
    await Observation.updateMany(
      { entityKey: 'synthetic-tidepool-lab', field: 'currentUndergradCount' },
      { $set: { sourceName: 'research-entity-cache-backfill' } },
    );
    await seed('synthetic-tidepool-lab-merged', 'currentUndergradCount', 4, '2026-09-20', ROSTER);
    await resolve('synthetic-tidepool-lab');
    expect(await liveKeys('synthetic-tidepool-lab')).toContain('signal:CURRENT_UNDERGRADS');
  }, 120000);

  it('leaves the join-page signal live even when no longer derived', async () => {
    await seedLab('synthetic-tidepool-lab');
    await resolve('synthetic-tidepool-lab');
    const row = await ResearchEntity.findOne({ slug: 'synthetic-tidepool-lab' }).lean<any>();
    await Signal.create({
      researchEntityId: row._id,
      type: 'APPLICATION_FORM_EXISTS',
      derivationKey: 'signal:APPLICATION_FORM_EXISTS:JOIN_PAGE',
      confidence: 'MEDIUM',
      archived: false,
      observedAt: new Date('2026-09-01T00:00:00Z'),
      source: { name: LANE, url: PAGE },
    });
    await resolve('synthetic-tidepool-lab');
    expect(await liveKeys('synthetic-tidepool-lab')).toContain(
      'signal:APPLICATION_FORM_EXISTS:JOIN_PAGE',
    );
  }, 120000);
});

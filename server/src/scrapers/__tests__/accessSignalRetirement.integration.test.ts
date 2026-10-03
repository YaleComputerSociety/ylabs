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

const seed = (entityKey: string, field: string, value: unknown, observedAt = '2026-09-01') =>
  Observation.create({
    entityType: 'researchEntity',
    entityKey,
    field,
    value,
    sourceId: new mongoose.Types.ObjectId(),
    sourceName: LANE,
    sourceUrl: PAGE,
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
  await seed(entityKey, 'currentUndergradCount', 2);
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
    expect(full).toEqual(
      expect.arrayContaining(['signal:PAST_UNDERGRADS', 'signal:REACH_OUT_PLAUSIBLE']),
    );

    await Observation.updateMany(
      { _id: { $in: [access._id, advisees._id] } },
      { $set: { superseded: true } },
    );
    await resolve('synthetic-tidepool-lab');
    const remaining = await liveKeys('synthetic-tidepool-lab');
    expect(remaining).toContain('signal:CURRENT_UNDERGRADS');
    expect(remaining).not.toContain('signal:REACH_OUT_PLAUSIBLE');
    expect(remaining).not.toContain('signal:PAST_UNDERGRADS');
    expect(remaining).not.toContain('signal:FELLOWSHIP_COMPATIBLE');
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
    const reachOut = await Signal.findOne({
      derivationKey: 'signal:REACH_OUT_PLAUSIBLE',
    }).lean<any>();
    const foreign = await seed('synthetic-unminted-key', 'undergradAccessEvidence', {
      openToUndergrads: 'yes',
      evidenceSource: 'explicit_text',
      evidenceQuote: 'Undergraduates are welcome to join the lab.',
    });
    await Signal.updateOne(
      { _id: reachOut._id },
      { $set: { 'source.evidenceIds': [foreign._id] } },
    );
    await Observation.updateMany(
      { entityKey: 'synthetic-tidepool-lab', field: 'undergradAccessEvidence' },
      { $set: { superseded: true } },
    );
    await resolve('synthetic-tidepool-lab');
    expect(await liveKeys('synthetic-tidepool-lab')).toContain('signal:REACH_OUT_PLAUSIBLE');
  }, 120000);

  it('leaves the two types another change owns live even when no longer derived', async () => {
    await seedLab('synthetic-tidepool-lab');
    await resolve('synthetic-tidepool-lab');
    await Observation.updateMany(
      { entityKey: 'synthetic-tidepool-lab', field: 'currentUndergradCount' },
      { $set: { superseded: true } },
    );
    await resolve('synthetic-tidepool-lab');
    expect(await liveKeys('synthetic-tidepool-lab')).toContain('signal:CURRENT_UNDERGRADS');
  }, 120000);
});

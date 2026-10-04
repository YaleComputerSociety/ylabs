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
import { Signal } from '../../models/signal';
import { materializeEntity } from '../entityMaterializer';

const SURVIVOR = 'example-survivor-lab';
const LOSER = 'ysm-example-merged-loser';
const CONTACT = {
  contactEmail: 'coordinator@example.edu',
  contactName: 'Example Coordinator',
  contactRole: 'Lab Manager',
};
const CONTACT_KEYS = Object.keys(CONTACT);

describe('a contact reaches a row only from evidence keyed to that row (#3609)', () => {
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
    for (const name of ['observations', 'research_entities', 'role_assignments']) {
      await db.collection(name).deleteMany({});
    }
    await Signal.deleteMany({});
  });

  const seedObservation = async (
    entityKey: string,
    field: string,
    value: unknown,
    sourceName: string,
  ) =>
    Observation.create({
      entityType: 'researchEntity',
      entityKey,
      field,
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName,
      sourceUrl: `https://example.yale.edu/${entityKey}/`,
      confidence: 0.9,
      observedAt: new Date('2026-02-01T00:00:00Z'),
      superseded: false,
    });

  const seedContact = async (entityKey: string) => {
    for (const [field, value] of Object.entries(CONTACT)) {
      await seedObservation(entityKey, field, value, 'ysm-atoz-index');
    }
  };

  const seedMerge = async (storedContact: boolean) => {
    const survivor = await ResearchEntity.create({
      slug: SURVIVOR,
      name: 'Example Survivor Lab',
      kind: 'lab',
      archived: false,
      ...(storedContact ? CONTACT : {}),
    });
    await ResearchEntity.create({
      slug: LOSER,
      name: 'Example Merged Loser',
      kind: 'lab',
      archived: true,
      canonicalGroupId: survivor._id,
    });
    await seedObservation(SURVIVOR, 'name', 'Example Survivor Lab', 'ysm-faculty-directory');
    await seedObservation(LOSER, 'departments', ['Example Medicine'], 'ysm-atoz-index');
    return survivor;
  };

  const storedContactOf = async (id: mongoose.Types.ObjectId) => {
    const doc = await ResearchEntity.findById(id).lean<Record<string, unknown>>();
    return Object.fromEntries(CONTACT_KEYS.map((key) => [key, doc?.[key] ?? '']));
  };

  const contactSignalsOf = (id: mongoose.Types.ObjectId) =>
    Signal.find({
      researchEntityId: id,
      derivationKey: 'signal:CONTACT_INSTRUCTIONS_EXIST:CONTACT_FIELDS',
    }).lean();

  it.each([SURVIVOR, LOSER])(
    'never resolves a merged-in loser contact onto the survivor, entered through %s',
    async (entryKey) => {
      const survivor = await seedMerge(false);
      await seedContact(LOSER);

      await materializeEntity('researchEntity', { entityKey: entryKey });

      expect(await storedContactOf(survivor._id)).toEqual({
        contactEmail: '',
        contactName: '',
        contactRole: '',
      });
      expect(await contactSignalsOf(survivor._id)).toHaveLength(0);
    },
  );

  it('clears a carried loser contact and keeps the loser evidence as history', async () => {
    const survivor = await seedMerge(true);
    await seedContact(LOSER);

    await materializeEntity('researchEntity', { entityKey: SURVIVOR });

    expect(await storedContactOf(survivor._id)).toEqual({
      contactEmail: '',
      contactName: '',
      contactRole: '',
    });
    const loserContact = await Observation.find({
      entityKey: LOSER,
      field: { $in: CONTACT_KEYS },
    }).lean();
    expect(loserContact).toHaveLength(3);
    expect(loserContact.every((observation) => observation.superseded === false)).toBe(true);
  });

  it('plans nothing for contact on a second pass', async () => {
    const survivor = await seedMerge(true);
    await seedContact(LOSER);
    await materializeEntity('researchEntity', { entityKey: SURVIVOR });

    const second = await materializeEntity(
      'researchEntity',
      { entityId: survivor._id.toHexString() },
      { dryRun: true },
    );

    const planned = [
      ...Object.keys(second.plannedSet ?? {}),
      ...Object.keys(second.plannedUnset ?? {}),
    ];
    expect(planned.filter((key) => CONTACT_KEYS.includes(key))).toEqual([]);
  });

  it.each([SURVIVOR, LOSER])(
    "keeps the survivor's own contact and mints no contact signal from it, entered through %s",
    async (entryKey) => {
      const survivor = await seedMerge(false);
      await seedContact(SURVIVOR);
      await seedContact(LOSER);

      await materializeEntity('researchEntity', { entityKey: entryKey });

      expect(await storedContactOf(survivor._id)).toEqual(CONTACT);
      expect(await contactSignalsOf(survivor._id)).toHaveLength(0);
    },
  );
});

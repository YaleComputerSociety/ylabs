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

import { Account } from '../../models/account';
import { Observation } from '../../models/observation';
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import { dedupeAccountlessResearcherShells } from '../../scripts/dedupeAccountlessResearcherShells';
import { joinUserIdentityToExistingResearcher } from '../entityMaterializer';
import { clearC4Flags } from './c4FlagTestEnv';

const REAL_NETID = 'sy123';
const LOCAL_PART = 'sam.synthetic';
const EMAIL = `${LOCAL_PART}@yale.edu`;

const userObservation = (field: string, value: unknown) => ({
  entityType: 'user',
  entityKey: `netid:${LOCAL_PART}`,
  field,
  value,
  sourceName: 'dept-faculty-roster',
  sourceUrl: 'https://fixture-dept.yale.edu/people/',
  confidence: 0.8,
  observedAt: new Date('2026-09-01T00:00:00Z'),
});

describe('a user keyed by an email local part that has a twin account (#4988)', () => {
  let replSet: MongoMemoryReplSet;
  let realResearcherId: mongoose.Types.ObjectId;
  let twinResearcherId: mongoose.Types.ObjectId;
  let twinAccountId: mongoose.Types.ObjectId;

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
    for (const name of ['accounts', 'researchers', 'observations', 'role_assignments']) {
      await db.collection(name).deleteMany({});
    }
    const real = await Account.create({ netid: REAL_NETID, email: EMAIL, status: 'ACTIVE' });
    twinAccountId = new mongoose.Types.ObjectId();
    await db.collection('accounts').insertOne({
      _id: twinAccountId,
      netid: LOCAL_PART,
      email: EMAIL,
      status: 'ACTIVE',
      archived: false,
    });
    realResearcherId = (
      await Researcher.create({
        displayName: 'Sam Synthetic',
        accountId: real._id,
        identifiers: { netid: real.netid },
      })
    )._id;
    twinResearcherId = (
      await Researcher.create({
        displayName: 'Sam R. Synthetic',
        accountId: twinAccountId,
        identifiers: { netid: LOCAL_PART },
      })
    )._id;
    await Observation.create({
      entityType: 'user',
      entityKey: `netid:${REAL_NETID}`,
      field: 'email',
      value: EMAIL,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'directory-alias-resolution',
      confidence: 0.9,
      observedAt: new Date('2026-09-01T00:00:00Z'),
      superseded: false,
    });
    await RoleAssignment.create({
      personId: twinResearcherId,
      target: { kind: 'RESEARCH_ENTITY', id: new mongoose.Types.ObjectId() },
      role: 'PI',
      state: 'UNKNOWN',
      confidence: 0.9,
    });
  });

  const join = () =>
    joinUserIdentityToExistingResearcher({ entityKey: `netid:${LOCAL_PART}` }, [
      userObservation('displayName', 'Sam Synthetic'),
      userObservation('email', EMAIL),
    ]);

  it('reaches the real account rather than the twin the bare netid names', async () => {
    const result = await join();
    expect(String(result.researcher?._id)).toBe(String(realResearcherId));
  });

  it('folds the twin researcher into the real one, so the alias key still reaches a live record', async () => {
    const report = await dedupeAccountlessResearcherShells({ apply: true });
    expect(report.aliasTwinFolds.folded).toBe(1);

    const twin = await Researcher.findById(twinResearcherId).lean();
    expect(twin?.archived).toBe(true);
    expect(twin?.accountId).toBeUndefined();
    expect(twin?.identifiers?.netid).toBeUndefined();
    const edges = await RoleAssignment.find({ archived: { $ne: true } }).lean();
    expect(edges.map((edge) => String(edge.personId))).toEqual([String(realResearcherId)]);

    await Account.updateOne({ _id: twinAccountId }, { $set: { archived: true } });
    const result = await join();
    expect(String(result.researcher?._id)).toBe(String(realResearcherId));
  });

  it('does not hand the local part to a real researcher that has no netid of its own', async () => {
    await dedupeAccountlessResearcherShells({ apply: true });
    const real = await Researcher.findById(realResearcherId).lean();
    expect(real?.identifiers?.netid).not.toBe(LOCAL_PART);
  });

  it('leaves a twin alone when the alias map does not resolve', async () => {
    await Observation.deleteMany({ entityKey: `netid:${REAL_NETID}` });
    const report = await dedupeAccountlessResearcherShells({ apply: false });
    expect(report.aliasTwinFolds.folded).toBe(0);
    expect(report.aliasTwinFolds.refusals['alias-unresolved']).toBe(1);
    const result = await join();
    expect(String(result.researcher?._id)).toBe(String(twinResearcherId));
  });
});

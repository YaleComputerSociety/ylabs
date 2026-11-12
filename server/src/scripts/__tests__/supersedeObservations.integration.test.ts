import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminAuditEvent } from '../../models/adminAuditEvent';
import {
  assertSupersedeObservationsWriteAllowed,
  parseSupersedeObservationsArgs,
  supersedeObservations,
} from '../supersedeObservations';

const ACTOR = 'agent:ylabs-fixture';
const REASON = 'states the other person of a split record';

let server: MongoMemoryServer;
const db = () => mongoose.connection.db!;
const oid = () => new mongoose.Types.ObjectId();

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri(), { autoIndex: false });
});

afterAll(async () => {
  await mongoose.disconnect();
  await server?.stop();
});

beforeEach(async () => {
  await Promise.all(
    ['observations', 'research_entities', 'admin_audit_events'].map((name) =>
      db().collection(name).deleteMany({}),
    ),
  );
});

const seedObservation = async (over: Record<string, unknown> = {}) => {
  const _id = oid();
  await db()
    .collection('observations')
    .insertOne({
      _id,
      entityType: 'user',
      entityKey: 'netid:zz9991',
      field: 'orcidWorksSyncedAt',
      value: '2026-07-25',
      sourceId: oid(),
      sourceName: 'orcid-works',
      confidence: 0.8,
      observedAt: new Date('2026-07-25T00:00:00Z'),
      superseded: false,
      ...over,
    });
  return String(_id);
};

const observation = async (id: string) =>
  (await db()
    .collection('observations')
    .findOne({ _id: new mongoose.Types.ObjectId(id) })) as any;

const applyArgs = (ids: string[]) => ({ ids, reason: REASON, actor: ACTOR, apply: true });

const expectUntouched = async (ids: string[]) => {
  for (const id of ids) {
    const stored = await observation(id);
    if (stored) {
      expect(stored.superseded).toBe(false);
      expect(stored.rollback).toBeUndefined();
    }
  }
  expect(await AdminAuditEvent.countDocuments()).toBe(0);
};

describe('observations:supersede (#6018)', () => {
  it('plans without writing on a dry run', async () => {
    const id = await seedObservation();
    const result = await supersedeObservations({ ...applyArgs([id]), apply: false });
    expect(result).toMatchObject({ refused: false, superseded: 0 });
    expect(result.entries).toEqual([{ id, status: 'supersede' }]);
    await expectUntouched([id]);
  });

  it('supersedes the named ids with the reason and audits each pre-image', async () => {
    const ids = [await seedObservation(), await seedObservation({ field: 'email' })];
    const result = await supersedeObservations(applyArgs(ids));
    expect(result).toMatchObject({ refused: false, superseded: 2 });
    for (const id of ids) {
      const stored = await observation(id);
      expect(stored.superseded).toBe(true);
      expect(stored.rollback.reason).toBe(REASON);
      expect(stored.rollback.rolledBackAt).toBeInstanceOf(Date);
    }
    const audits = (await AdminAuditEvent.find().lean()) as any[];
    expect(audits.map((audit) => audit.targetId).sort()).toEqual([...ids].sort());
    expect(audits[0]).toMatchObject({
      actorNetid: ACTOR,
      action: 'observation.supersede',
      targetType: 'observation',
      summary: { note: REASON, status: 'applied' },
    });
    expect(audits[0].metadata.before.superseded).toBe(false);
    expect(audits[0].metadata.runObservationIds).toEqual(ids);
  });

  it('restores the observation when its audit record cannot be written, so a rerun audits it', async () => {
    const id = await seedObservation();
    const createAudit = vi
      .spyOn(AdminAuditEvent, 'create')
      .mockRejectedValueOnce(new Error('audit store unavailable'));
    await expect(supersedeObservations(applyArgs([id]))).rejects.toThrow(/audit store unavailable/);
    createAudit.mockRestore();
    await expectUntouched([id]);
    const rerun = await supersedeObservations(applyArgs([id]));
    expect(rerun).toMatchObject({ refused: false, superseded: 1 });
    expect(await AdminAuditEvent.countDocuments({ targetId: id })).toBe(1);
  });

  it('is a no-op on a second run', async () => {
    const id = await seedObservation();
    await supersedeObservations(applyArgs([id]));
    const second = await supersedeObservations(applyArgs([id]));
    expect(second).toMatchObject({ refused: false, superseded: 0 });
    expect(second.entries).toEqual([{ id, status: 'already-superseded' }]);
    expect(await AdminAuditEvent.countDocuments()).toBe(1);
  });

  it('refuses the whole run when an id does not exist', async () => {
    const id = await seedObservation();
    const missing = String(oid());
    const result = await supersedeObservations(applyArgs([id, missing]));
    expect(result).toMatchObject({ refused: true, superseded: 0 });
    expect(result.entries).toContainEqual({ id: missing, status: 'not-found' });
    await expectUntouched([id]);
  });

  it.each(['manual-admin-edit', 'manual-pi-edit', 'operator-led-group-verdict'])(
    'refuses the whole run when an id comes from the operator-authored source %s',
    async (sourceName) => {
      const ordinary = await seedObservation();
      const decided = await seedObservation({ sourceName });
      const result = await supersedeObservations(applyArgs([ordinary, decided]));
      expect(result.refused).toBe(true);
      expect(result.entries).toContainEqual({
        id: decided,
        status: 'owner-decided',
        backing: 'operator-authored-source',
      });
      await expectUntouched([ordinary, decided]);
    },
  );

  it('refuses an id that is the provenance of a locked field', async () => {
    const backing = await seedObservation({ entityType: 'researchEntity', field: 'name' });
    await db()
      .collection('research_entities')
      .insertOne({
        _id: oid(),
        slug: 'fixture-row',
        manuallyLockedFields: ['name'],
        fieldProvenance: {
          name: { sourceName: 'orcid-works', observationId: new mongoose.Types.ObjectId(backing) },
        },
      });
    const result = await supersedeObservations(applyArgs([backing]));
    expect(result.entries).toEqual([
      { id: backing, status: 'owner-decided', backing: 'backs-a-locked-field' },
    ]);
    await expectUntouched([backing]);
  });

  it('supersedes an id that backs only an unlocked field', async () => {
    const backing = await seedObservation({ entityType: 'researchEntity', field: 'name' });
    await db()
      .collection('research_entities')
      .insertOne({
        _id: oid(),
        slug: 'fixture-row',
        manuallyLockedFields: ['description'],
        fieldProvenance: {
          name: { sourceName: 'orcid-works', observationId: new mongoose.Types.ObjectId(backing) },
        },
      });
    expect(await supersedeObservations(applyArgs([backing]))).toMatchObject({ superseded: 1 });
  });
});

describe('observations:supersede arguments (#6018)', () => {
  const ids = (count: number) => Array.from({ length: count }, () => String(oid()));

  it('refuses more than 25 ids per run', () => {
    expect(() =>
      parseSupersedeObservationsArgs([`--ids=${ids(26).join(',')}`, `--reason=${REASON}`], {}),
    ).toThrow(/more than 25 ids/);
    expect(
      parseSupersedeObservationsArgs([`--ids=${ids(25).join(',')}`, `--reason=${REASON}`], {}).ids,
    ).toHaveLength(25);
  });

  it('requires a reason, valid unique ids, and an actor on apply', () => {
    const [one] = ids(1);
    expect(() => parseSupersedeObservationsArgs([`--ids=${one}`], {})).toThrow(/--reason/);
    expect(() => parseSupersedeObservationsArgs(['--reason=x'], {})).toThrow(/--ids/);
    expect(() => parseSupersedeObservationsArgs(['--ids=nope', '--reason=x'], {})).toThrow(
      /24-character/,
    );
    expect(() => parseSupersedeObservationsArgs([`--ids=${one},${one}`, '--reason=x'], {})).toThrow(
      /twice/,
    );
    expect(() =>
      parseSupersedeObservationsArgs([`--ids=${one}`, '--reason=x', '--apply'], {}),
    ).toThrow(/actor/);
    expect(() => parseSupersedeObservationsArgs(['--all'], {})).toThrow(/Unknown/);
  });

  it('lets a dry run ignore a bare session label in DEV_WRITE_OWNER but refuses it on apply', () => {
    const [one] = ids(1);
    const env = { DEV_WRITE_OWNER: 'ylabs-fixture-session' };
    expect(
      parseSupersedeObservationsArgs([`--ids=${one}`, '--reason=x'], env).actor,
    ).toBeUndefined();
    expect(() =>
      parseSupersedeObservationsArgs([`--ids=${one}`, '--reason=x', '--apply'], env),
    ).toThrow(/--actor/);
  });

  it('says it is an operator tool for one-row judgements in its help', () => {
    expect(() => parseSupersedeObservationsArgs(['--help'], {})).toThrow(
      /operator tool for one-row judgements, not a bulk repair path/,
    );
  });

  it('needs the confirm flag and ALLOW_NON_PROD_SCRAPER_WRITES before an apply', () => {
    const args = parseSupersedeObservationsArgs(
      [`--ids=${ids(1)[0]}`, '--reason=x', '--apply', `--actor=${ACTOR}`],
      {},
    );
    expect(() =>
      assertSupersedeObservationsWriteAllowed(args, { ALLOW_NON_PROD_SCRAPER_WRITES: 'true' }),
    ).toThrow(/--confirm-supersede-observations/);
    const confirmed = { ...args, confirmed: true };
    expect(() => assertSupersedeObservationsWriteAllowed(confirmed, {})).toThrow(
      /ALLOW_NON_PROD_SCRAPER_WRITES=true/,
    );
    expect(() =>
      assertSupersedeObservationsWriteAllowed(confirmed, { ALLOW_NON_PROD_SCRAPER_WRITES: 'true' }),
    ).not.toThrow();
  });
});

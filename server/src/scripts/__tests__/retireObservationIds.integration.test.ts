import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AdminAuditEvent } from '../../models/adminAuditEvent';
import {
  assertRetireObservationIdsWriteAllowed,
  parseRetireObservationIdsArgs,
  readIdsFile,
  retireObservationIds,
} from '../retireObservationIds';
import { RETIRE_AUDIT_BATCH_SIZE } from '../retireObservationIdsCore';
import { OPERATOR_AUTHORED_SOURCE_NAMES } from '../../scrapers/seedSources';

const ACTOR = 'agent:ylabs-fixture';
const REASON = 'pre-floor run wrote first-on-page values';
const FLOOR = 'f1f1f1f1';
const ABOVE = 'a2a2a2a2';
const BELOW = 'b3b3b3b3';
const floorCheck = (runSha: string) => runSha === ABOVE;

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
    ['observations', 'research_entities', 'admin_audit_events', 'scrape_runs'].map((name) =>
      db().collection(name).deleteMany({}),
    ),
  );
});

const seedRun = async (gitSha?: string) => {
  const _id = oid();
  await db()
    .collection('scrape_runs')
    .insertOne({
      _id,
      sourceName: 'dept-faculty-roster',
      status: 'completed',
      ...(gitSha ? { launch: { gitSha } } : {}),
    });
  return _id;
};

const seedObservation = async (
  runId: mongoose.Types.ObjectId,
  over: Record<string, unknown> = {},
) => {
  const _id = oid();
  await db()
    .collection('observations')
    .insertOne({
      _id,
      scrapeRunId: runId,
      entityType: 'user',
      entityKey: 'netid:zz9992',
      field: 'orcid',
      value: '0000-0000-0000-0000',
      sourceId: oid(),
      sourceName: 'dept-faculty-roster',
      confidence: 0.8,
      observedAt: new Date('2026-11-01T00:00:00Z'),
      superseded: false,
      ...over,
    });
  return _id;
};

const supersede = async (predecessor: mongoose.Types.ObjectId, by: mongoose.Types.ObjectId) =>
  db()
    .collection('observations')
    .updateOne({ _id: predecessor }, { $set: { superseded: true, supersededBy: by } });

const stored = async (id: mongoose.Types.ObjectId) =>
  (await db().collection('observations').findOne({ _id: id })) as any;

const args = (runId: mongoose.Types.ObjectId, ids: mongoose.Types.ObjectId[], over = {}) => ({
  runId: String(runId),
  ids: ids.map(String),
  reason: REASON,
  actor: ACTOR,
  apply: true,
  restoreSuperseded: false,
  ...over,
});

describe('observations:retire-ids (#6029)', () => {
  it('plans without writing on a dry run and counts superseded predecessors', async () => {
    const run = await seedRun(BELOW);
    const older = await seedObservation(await seedRun(ABOVE));
    const target = await seedObservation(run);
    await supersede(older, target);

    const result = await retireObservationIds(args(run, [target], { apply: false }), {
      floorCheck,
    });

    expect(result).toMatchObject({ refused: false, toRetire: 1, retired: 0, predecessors: 1 });
    expect(result.retiredWithSupersededPredecessor).toBe(1);
    expect((await stored(target)).superseded).toBe(false);
    expect(await AdminAuditEvent.countDocuments()).toBe(0);
  });

  it('retires the named live observations with one audit record per batch and restores nothing by default', async () => {
    const run = await seedRun(BELOW);
    const older = await seedObservation(await seedRun(ABOVE));
    const ids = await Promise.all(
      Array.from({ length: RETIRE_AUDIT_BATCH_SIZE + 1 }, () => seedObservation(run)),
    );
    await supersede(older, ids[0]);

    const result = await retireObservationIds(args(run, ids), { floorCheck });

    expect(result).toMatchObject({ retired: ids.length, restored: 0 });
    const target = await stored(ids[0]);
    expect(target.superseded).toBe(true);
    expect(target.rollback.reason).toContain(REASON);
    expect((await stored(older)).superseded).toBe(true);
    const audits = (await AdminAuditEvent.find().lean()) as any[];
    expect(audits).toHaveLength(2);
    expect(audits.every((audit) => audit.summary.status === 'applied')).toBe(true);
    expect(audits[0].metadata.before.length).toBeGreaterThan(0);
  });

  it('is a no-op when run twice', async () => {
    const run = await seedRun(BELOW);
    const target = await seedObservation(run);
    await retireObservationIds(args(run, [target]), { floorCheck });
    const firstRolledBackAt = (await stored(target)).rollback.rolledBackAt;

    const second = await retireObservationIds(args(run, [target]), { floorCheck });

    expect(second).toMatchObject({ refused: false, retired: 0, alreadyRetired: 1 });
    expect((await stored(target)).rollback.rolledBackAt).toEqual(firstRolledBackAt);
    expect(await AdminAuditEvent.countDocuments()).toBe(1);
  });

  it('restores only predecessors whose run is at or above the floor when asked', async () => {
    const run = await seedRun(BELOW);
    const aboveFloor = await seedObservation(await seedRun(ABOVE));
    const belowFloor = await seedObservation(await seedRun(BELOW));
    const unknownSha = await seedObservation(await seedRun());
    const target = await seedObservation(run);
    for (const predecessor of [aboveFloor, belowFloor, unknownSha])
      await supersede(predecessor, target);

    const result = await retireObservationIds(
      args(run, [target], { restoreSuperseded: true, floorSha: FLOOR }),
      { floorCheck },
    );

    expect(result).toMatchObject({
      restored: 1,
      predecessorsAtOrAboveFloor: 1,
      predecessorsBelowFloorOrUnknown: 2,
    });
    expect((await stored(aboveFloor)).superseded).toBe(false);
    expect((await stored(aboveFloor)).supersededBy).toBeUndefined();
    expect((await stored(belowFloor)).superseded).toBe(true);
    expect((await stored(unknownSha)).superseded).toBe(true);
  });

  it.each([
    ['an id from another run', 'other-run'],
    ['an id that is not live', 'not-live'],
    ['an operator-authored observation', 'owner-decided'],
    ['an id that does not exist', 'not-found'],
  ])('refuses the whole batch for %s and writes nothing', async (_label, status) => {
    const run = await seedRun(BELOW);
    const good = await seedObservation(run);
    const bad =
      status === 'other-run'
        ? await seedObservation(await seedRun(BELOW))
        : status === 'not-live'
          ? await seedObservation(run, { superseded: true, supersededBy: oid() })
          : status === 'owner-decided'
            ? await seedObservation(run, { sourceName: OPERATOR_AUTHORED_SOURCE_NAMES[0] })
            : oid();

    const result = await retireObservationIds(args(run, [good, bad]), { floorCheck });

    expect(result.refused).toBe(true);
    expect(result.entries.find((entry) => entry.id === String(bad))?.status).toBe(status);
    expect((await stored(good)).superseded).toBe(false);
    expect(await AdminAuditEvent.countDocuments()).toBe(0);
  });

  it('refuses an observation that backs a locked field', async () => {
    const run = await seedRun(BELOW);
    const locked = await seedObservation(run, { entityType: 'researchEntity' });
    await db()
      .collection('research_entities')
      .insertOne({
        slug: 'fixture-locked-row',
        manuallyLockedFields: ['websiteUrl'],
        fieldProvenance: { websiteUrl: { observationId: locked } },
      });

    const result = await retireObservationIds(args(run, [locked]), { floorCheck });

    expect(result.refused).toBe(true);
    expect(result.entries[0]).toMatchObject({
      status: 'owner-decided',
      backing: 'backs-a-locked-field',
    });
    expect((await stored(locked)).superseded).toBe(false);
  });

  it('refuses a scrape run that does not exist', async () => {
    const result = await retireObservationIds(args(oid(), [oid()]), { floorCheck });
    expect(result).toMatchObject({ runFound: false, refused: true, retired: 0 });
  });
});

describe('observations:retire-ids arguments and write gate (#6029)', () => {
  const run = '0123456789abcdef01234567';
  const id = 'abcdef0123456789abcdef01';
  const parse = (argv: string[], env: NodeJS.ProcessEnv = {}) =>
    parseRetireObservationIdsArgs(argv, env, () => JSON.stringify([id]));

  it('reads a JSON array or one id per line', () => {
    expect(readIdsFile(`["${id}"]`)).toEqual([id]);
    expect(readIdsFile(`${id}\n\n`)).toEqual([id]);
  });

  it('requires a floor sha with the restore flag and refuses one without it', () => {
    const base = [`--run=${run}`, '--ids-file=ids.json', `--reason=${REASON}`];
    expect(() => parse([...base, '--restore-superseded'])).toThrow(/--floor-sha/);
    expect(() => parse([...base, `--floor-sha=${FLOOR}`])).toThrow(/only applies/);
    expect(parse([...base, '--restore-superseded', `--floor-sha=${FLOOR}`])).toMatchObject({
      restoreSuperseded: true,
      floorSha: FLOOR,
      apply: false,
    });
  });

  it('requires an actor to apply', () => {
    expect(() =>
      parse([`--run=${run}`, '--ids-file=ids.json', `--reason=${REASON}`, '--apply'], {}),
    ).toThrow(/actor/);
  });

  it('refuses an apply against any database other than Development', () => {
    const allowed = { ALLOW_NON_PROD_SCRAPER_WRITES: 'true' };
    const gate = { apply: true, confirmed: true };
    for (const database of ['Beta', 'Production', 'prod']) {
      expect(() =>
        assertRetireObservationIdsWriteAllowed(gate, {
          ...allowed,
          MONGODBURL: `mongodb://fixture.invalid/${database}`,
        }),
      ).toThrow(/only applies against the Development database/);
    }
    expect(() =>
      assertRetireObservationIdsWriteAllowed(gate, {
        ...allowed,
        MONGODBURL: 'mongodb://fixture.invalid/Development',
      }),
    ).not.toThrow();
    expect(() =>
      assertRetireObservationIdsWriteAllowed(
        { apply: true, confirmed: false },
        { ...allowed, MONGODBURL: 'mongodb://fixture.invalid/Development' },
      ),
    ).toThrow(/--confirm-retire-observation-ids/);
  });
});

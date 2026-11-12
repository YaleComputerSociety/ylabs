import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { MongoClient, type Db } from 'mongodb';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import ts from 'typescript';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  DEV_DRY_LANE_RUN_COLLECTIONS,
  DEV_LANE_RUN_COLLECTIONS,
  DEV_WRITE_GUARD_EXEMPT_COLLECTIONS,
  DevWriteRefusedError,
  UnguardedModelError,
  declareDevDryLaneRun,
  declareRequestServingProcess,
  devWriteGuardPlugin,
  resetDevWriteGuardStateForTests,
  schemaHasDevWriteGuard,
  setDevWriteGuardLeaseStateForTests,
} from '../devWriteGuard';
import {
  DEV_WRITE_LEASE_COLLECTION,
  DEV_WRITE_LEASE_OWNER_ENV,
  DEV_WRITE_LEASE_SWITCH_ENV,
  armDevHostLeases,
  recordDevApplyIntent,
  releaseHeldDevWriteLeases,
  resetDevWriteLeaseStateForTests,
} from '../devWriteLease';
import {
  connectScriptMongo,
  devWriteLeaseDescriptor,
  holdDevApplyLeaseForRun,
} from '../connections';
import * as models from '../../models';
import { SearchRerankCache } from '../../models/searchRerankCache';
import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { ScrapeRun } from '../../models/scrapeRun';
import { WeeklySweepRun } from '../../models/weeklySweepRun';
import { Source } from '../../models/source';
import { ScraperOrchestrator } from '../../scrapers/orchestrator';
import { hermeticChildEnvironment } from '../../test/hermeticEnvironment';

const SERVER_SRC = path.resolve(__dirname, '../..');
const SCRATCH_SCRIPT = path.resolve(__dirname, 'fixtures/scratchModelDelete.ts');
const GUARD_MODULE = '../db/devWriteGuard';

let memoryServer: MongoMemoryServer;
let client: MongoClient;

const database = (name: string): Db => client.db(name);
const uriFor = (name: string) => `${memoryServer.getUri()}${name}`;

const probeSchema = new mongoose.Schema({ name: String, n: Number });
const Probe = mongoose.model('DevWriteGuardProbe', probeSchema, 'dev_write_guard_probes');

async function seed(db: Db, collection: string, count = 2) {
  await db.collection(collection).deleteMany({});
  await db
    .collection(collection)
    .insertMany(Array.from({ length: count }, (_, n) => ({ name: `row-${n}`, n })));
}

const count = (db: Db, collection: string) => db.collection(collection).countDocuments();

const WRITE_COMMANDS = new Set(['insert', 'update', 'delete', 'findAndModify']);
const FIXTURE_LANE = 'dev-write-guard-fixture-lane';

async function collectionsWrittenByLaneRun({ dryRun }: { dryRun: boolean }) {
  await database('Development').collection(Source.collection.collectionName).insertOne({
    name: FIXTURE_LANE,
    displayName: 'Fixture lane',
    defaultWeight: 0.8,
    enabled: true,
  });
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(uriFor('Development'), { monitorCommands: true });
  }
  const written = new Set<string>();
  mongoose.connection.getClient().on('commandStarted', (event) => {
    if (WRITE_COMMANDS.has(event.commandName))
      written.add(String(event.command[event.commandName]));
  });
  const orchestrator = new ScraperOrchestrator();
  orchestrator.register({
    name: FIXTURE_LANE,
    displayName: 'Fixture lane',
    async run(ctx) {
      await ctx.emit({
        entityType: 'researchEntity',
        entityKey: 'fixture-entity',
        field: 'name',
        value: 'Fixture Entity',
        sourceUrl: 'https://example.edu/fixture',
      });
      return { observationCount: 1, entitiesObserved: 1 };
    },
  });
  await orchestrator.run(FIXTURE_LANE, { dryRun, useCache: false, release: false });
  return written;
}

function countingLeaseState() {
  const calls = { holdsApplyLease: 0, hostLeasesArmed: 0 };
  setDevWriteGuardLeaseStateForTests({
    holdsApplyLease: () => {
      calls.holdsApplyLease += 1;
      return false;
    },
    hostLeasesArmed: () => {
      calls.hostLeasesArmed += 1;
      return false;
    },
  });
  return calls;
}

let savedSwitch: string | undefined;

beforeAll(async () => {
  memoryServer = await MongoMemoryServer.create();
  client = await MongoClient.connect(memoryServer.getUri());
});

afterAll(async () => {
  await client?.close();
  await memoryServer?.stop();
});

beforeEach(async () => {
  savedSwitch = process.env[DEV_WRITE_LEASE_SWITCH_ENV];
  delete process.env[DEV_WRITE_LEASE_SWITCH_ENV];
  delete process.env[DEV_WRITE_LEASE_OWNER_ENV];
  process.env.DEV_WRITE_OWNER = 'test-session';
  resetDevWriteLeaseStateForTests();
  resetDevWriteGuardStateForTests();
  await database('Development').dropDatabase();
});

afterEach(async () => {
  await releaseHeldDevWriteLeases();
  await mongoose.disconnect();
  resetDevWriteLeaseStateForTests();
  resetDevWriteGuardStateForTests();
  delete process.env[DEV_WRITE_LEASE_OWNER_ENV];
  delete process.env.DEV_WRITE_OWNER;
  if (savedSwitch === undefined) delete process.env[DEV_WRITE_LEASE_SWITCH_ENV];
  else process.env[DEV_WRITE_LEASE_SWITCH_ENV] = savedSwitch;
});

describe('a scratch script that imports a model and connects on its own', () => {
  it('is refused before deleting anything from Development', async () => {
    const dev = database('Development');
    await seed(dev, SearchRerankCache.collection.collectionName, 3);

    await mongoose.connect(uriFor('Development'));
    const refusal = await SearchRerankCache.deleteMany({}).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(DevWriteRefusedError);
    expect((refusal as Error).message).toContain('SearchRerankCache');
    expect((refusal as Error).message).toContain(SearchRerankCache.collection.collectionName);
    expect((refusal as Error).message).toContain('--apply');
    expect(await count(dev, SearchRerankCache.collection.collectionName)).toBe(3);
  });

  it('is refused for a write issued before the connection opened', async () => {
    const dev = database('Development');
    await seed(dev, SearchRerankCache.collection.collectionName, 2);

    const pending = SearchRerankCache.deleteMany({}).catch((error: unknown) => error);
    await mongoose.connect(uriFor('Development'));

    expect(await pending).toBeInstanceOf(DevWriteRefusedError);
    expect(await count(dev, SearchRerankCache.collection.collectionName)).toBe(2);
  });

  it.each([
    ['save', () => new Probe({ name: 'new' }).save()],
    ['create', () => Probe.create({ name: 'new' })],
    ['insertMany', () => Probe.insertMany([{ name: 'new' }])],
    ['bulkWrite', () => Probe.bulkWrite([{ deleteMany: { filter: {} } }])],
    ['updateOne', () => Probe.updateOne({}, { $set: { name: 'x' } })],
    ['updateMany', () => Probe.updateMany({}, { $set: { name: 'x' } })],
    ['replaceOne', () => Probe.replaceOne({}, { name: 'x' })],
    ['findOneAndUpdate', () => Probe.findOneAndUpdate({}, { $set: { name: 'x' } })],
    [
      'findByIdAndUpdate',
      () => Probe.findByIdAndUpdate(new mongoose.Types.ObjectId(), { name: 'x' }),
    ],
    ['findOneAndReplace', () => Probe.findOneAndReplace({}, { name: 'x' })],
    ['deleteOne', () => Probe.deleteOne({})],
    ['deleteMany', () => Probe.deleteMany({})],
    ['findOneAndDelete', () => Probe.findOneAndDelete({})],
    ['findByIdAndDelete', () => Probe.findByIdAndDelete(new mongoose.Types.ObjectId())],
    ['aggregate $merge', () => Probe.aggregate([{ $merge: { into: 'dev_write_guard_probes' } }])],
    ['aggregate $out', () => Probe.aggregate([{ $out: 'dev_write_guard_probe_copies' }])],
  ])('refuses %s before it writes', async (_operation, write) => {
    const dev = database('Development');
    await seed(dev, 'dev_write_guard_probes', 2);
    await mongoose.connect(uriFor('Development'));

    await expect(write()).rejects.toBeInstanceOf(DevWriteRefusedError);
    const rows = await dev.collection('dev_write_guard_probes').find().sort({ n: 1 }).toArray();
    expect(rows.map(({ name }) => name)).toEqual(['row-0', 'row-1']);
    expect(await count(dev, 'dev_write_guard_probe_copies')).toBe(0);
  });

  it('still reads freely', async () => {
    await seed(database('Development'), 'dev_write_guard_probes', 2);
    await mongoose.connect(uriFor('Development'));
    expect(await Probe.countDocuments()).toBe(2);
    expect(await Probe.aggregate([{ $match: {} }])).toHaveLength(2);
  });
});

describe('a scratch script run as its own process', () => {
  const runScratchScript = (env: NodeJS.ProcessEnv) => {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', SCRATCH_SCRIPT, uriFor('Development')],
      { cwd: path.resolve(SERVER_SRC, '..'), encoding: 'utf8', env: hermeticChildEnvironment(env) },
    );
    expect(result.status, result.stderr).toBe(0);
    return result.stdout.trim();
  };

  it('is refused when it imports one model, connects with mongoose.connect and deletes', async () => {
    const dev = database('Development');
    await seed(dev, SearchRerankCache.collection.collectionName, 3);

    expect(runScratchScript({ [DEV_WRITE_LEASE_SWITCH_ENV]: '' })).toBe(
      'REFUSED DevWriteRefusedError',
    );
    expect(await count(dev, SearchRerankCache.collection.collectionName)).toBe(3);
  });

  it('deletes through the same script once the guard is switched off, so the refusal is the guard', async () => {
    const dev = database('Development');
    await seed(dev, SearchRerankCache.collection.collectionName, 3);

    expect(runScratchScript({ [DEV_WRITE_LEASE_SWITCH_ENV]: 'off' })).toBe('DELETED 3');
    expect(await count(dev, SearchRerankCache.collection.collectionName)).toBe(0);
  });
});

describe('a script that holds the Development write lease', () => {
  it('writes through the same model once its apply guard took the lease', async () => {
    const dev = database('Development');
    await seed(dev, SearchRerankCache.collection.collectionName, 3);

    recordDevApplyIntent('research-search:seed-rerank-cache', ['--apply']);
    await connectScriptMongo(uriFor('Development'));
    await SearchRerankCache.deleteMany({});

    expect(await count(dev, SearchRerankCache.collection.collectionName)).toBe(0);
  });

  it('writes when a run-long lease is held on a dedicated connection, as the sweep runners do', async () => {
    const dev = database('Development');
    await seed(dev, WeeklySweepRun.collection.collectionName, 1);

    const release = await holdDevApplyLeaseForRun(
      'scrape:sweep:weekly-development',
      uriFor('Development'),
    );
    try {
      await connectScriptMongo(uriFor('Development'));
      await WeeklySweepRun.deleteMany({});
      expect(await count(dev, WeeklySweepRun.collection.collectionName)).toBe(0);
      expect(
        await dev
          .collection(DEV_WRITE_LEASE_COLLECTION)
          .countDocuments({ sourceName: '__dev-apply__', locked: true }),
      ).toBe(1);
    } finally {
      await release();
    }
  });

  it('writes from a child that joined the lease its parent passed down', async () => {
    const dev = database('Development');
    await seed(dev, 'dev_write_guard_probes', 1);
    const release = await holdDevApplyLeaseForRun('scrape:sweep', uriFor('Development'));
    try {
      const ownerId = process.env[DEV_WRITE_LEASE_OWNER_ENV];
      expect(ownerId).toBeTruthy();
      resetDevWriteLeaseStateForTests();
      process.env[DEV_WRITE_LEASE_OWNER_ENV] = ownerId;

      recordDevApplyIntent('research-entity:rematerialize', ['--apply']);
      await connectScriptMongo(uriFor('Development'));
      await Probe.deleteMany({});
      expect(await count(dev, 'dev_write_guard_probes')).toBe(0);
    } finally {
      await release();
    }
  });
});

describe('a writing lane run with armed host leases', () => {
  async function armLaneRun() {
    await mongoose.connect(uriFor('Development'));
    armDevHostLeases(
      devWriteLeaseDescriptor(mongoose.connection)!,
      'scrape run --source some-lane --apply',
    );
  }

  it('writes the lane collections without the apply lease', async () => {
    const dev = database('Development');
    await seed(dev, Observation.collection.collectionName, 2);
    await seed(dev, ScrapeRun.collection.collectionName, 2);
    await armLaneRun();

    await Observation.deleteMany({});
    await ScrapeRun.deleteMany({});

    expect(await count(dev, Observation.collection.collectionName)).toBe(0);
    expect(await count(dev, ScrapeRun.collection.collectionName)).toBe(0);
  });

  it('is refused on research_entities, which only an apply may write', async () => {
    const dev = database('Development');
    await seed(dev, ResearchEntity.collection.collectionName, 2);
    await armLaneRun();

    const refusal = await ResearchEntity.updateMany({}, { $set: { name: 'x' } }).catch(
      (error: unknown) => error,
    );

    expect(refusal).toBeInstanceOf(DevWriteRefusedError);
    expect((refusal as Error).message).toContain('research_entities');
    const rows = await dev.collection(ResearchEntity.collection.collectionName).find().toArray();
    expect(rows.map(({ name }) => name).sort()).toEqual(['row-0', 'row-1']);
  });

  it('writes only lane collections during a real writing orchestrator run', async () => {
    process.env[DEV_WRITE_LEASE_SWITCH_ENV] = 'off';
    const written = await collectionsWrittenByLaneRun({ dryRun: false });

    expect(written).toContain(Observation.collection.collectionName);
    expect([...written].filter((name) => !DEV_LANE_RUN_COLLECTIONS.has(name))).toEqual([]);
  });

  it('completes a real writing orchestrator run under armed host leases', async () => {
    await armLaneRun();
    await collectionsWrittenByLaneRun({ dryRun: false });

    const runs = await database('Development')
      .collection(ScrapeRun.collection.collectionName)
      .find()
      .toArray();
    expect(runs.map(({ status }) => status)).toEqual(['success']);
    expect(await count(database('Development'), Observation.collection.collectionName)).toBe(1);
  });
});

describe('a dry lane run', () => {
  it('writes only dry lane collections during a real dry orchestrator run', async () => {
    process.env[DEV_WRITE_LEASE_SWITCH_ENV] = 'off';
    const written = await collectionsWrittenByLaneRun({ dryRun: true });

    expect(written).toContain(ScrapeRun.collection.collectionName);
    expect([...written].filter((name) => !DEV_DRY_LANE_RUN_COLLECTIONS.has(name))).toEqual([]);
  });

  it('completes a real dry orchestrator run with the guard on', async () => {
    const result = await collectionsWrittenByLaneRun({ dryRun: true });

    expect(result).toContain(ScrapeRun.collection.collectionName);
    expect(await count(database('Development'), Observation.collection.collectionName)).toBe(0);
  });

  it('writes its run bookkeeping but nothing a writing run owns', async () => {
    const dev = database('Development');
    await seed(dev, ScrapeRun.collection.collectionName, 1);
    await seed(dev, Observation.collection.collectionName, 1);
    await mongoose.connect(uriFor('Development'));
    declareDevDryLaneRun();

    await ScrapeRun.deleteMany({});
    await expect(Observation.deleteMany({})).rejects.toBeInstanceOf(DevWriteRefusedError);

    expect(await count(dev, ScrapeRun.collection.collectionName)).toBe(0);
    expect(await count(dev, Observation.collection.collectionName)).toBe(1);
  });
});

describe('a process that is not guarded', () => {
  it('writes freely from the request-serving API server and never reads lease state', async () => {
    const dev = database('Development');
    await seed(dev, SearchRerankCache.collection.collectionName, 2);
    const calls = countingLeaseState();
    declareRequestServingProcess();

    await mongoose.connect(uriFor('Development'));
    await SearchRerankCache.deleteMany({});
    await Probe.create({ name: 'served' });

    expect(await count(dev, SearchRerankCache.collection.collectionName)).toBe(0);
    expect(await count(dev, 'dev_write_guard_probes')).toBe(1);
    expect(calls).toEqual({ holdsApplyLease: 0, hostLeasesArmed: 0 });
  });

  it.each(['Beta', 'Prod'])(
    'writes a script process to %s without reading any lease',
    async (name) => {
      const target = database(name);
      await target.dropDatabase();
      await seed(target, 'dev_write_guard_probes', 2);
      const calls = countingLeaseState();
      const commands: string[] = [];

      await mongoose.connect(uriFor(name), { monitorCommands: true });
      mongoose.connection.getClient().on('commandStarted', (event) => {
        commands.push(String(event.command[event.commandName] ?? ''));
      });
      await Probe.deleteMany({});
      await Probe.create({ name: 'copied' });

      expect(await count(target, 'dev_write_guard_probes')).toBe(1);
      expect(calls).toEqual({ holdsApplyLease: 0, hostLeasesArmed: 0 });
      expect(commands).not.toContain(DEV_WRITE_LEASE_COLLECTION);
      expect(await target.listCollections({ name: DEV_WRITE_LEASE_COLLECTION }).toArray()).toEqual(
        [],
      );
    },
  );

  it('writes when the lease is switched off, as the test harness sets it', async () => {
    process.env[DEV_WRITE_LEASE_SWITCH_ENV] = 'off';
    const dev = database('Development');
    await seed(dev, 'dev_write_guard_probes', 2);
    await mongoose.connect(uriFor('Development'));

    await Probe.deleteMany({});

    expect(await count(dev, 'dev_write_guard_probes')).toBe(0);
  });

  it('writes every exempt append-only measurement collection without the lease', async () => {
    const dev = database('Development');
    await mongoose.connect(uriFor('Development'));
    const exemptModels = mongoose
      .modelNames()
      .map((name) => mongoose.model(name))
      .filter((model) => DEV_WRITE_GUARD_EXEMPT_COLLECTIONS.has(model.collection.collectionName));
    expect(new Set(exemptModels.map((model) => model.collection.collectionName))).toEqual(
      DEV_WRITE_GUARD_EXEMPT_COLLECTIONS,
    );

    for (const model of exemptModels) {
      await seed(dev, model.collection.collectionName, 2);
      await model.deleteMany({});
      expect(await count(dev, model.collection.collectionName)).toBe(0);
    }
  });
});

describe('the exempt measurement collections', () => {
  it('are exactly the ones the lease-exempt scripts and model-call accounting append to', () => {
    expect([...DEV_WRITE_GUARD_EXEMPT_COLLECTIONS].sort()).toEqual(
      [
        models.CORPUS_QUALITY_SNAPSHOT_COLLECTION,
        models.ENGINE_BENCHMARK_COLLECTION,
        models.ENGINE_BENCHMARK_ROW_COLLECTION,
        models.ENGINE_BENCHMARK_SNAPSHOT_COLLECTION,
        models.GATE_SCORECARD_SNAPSHOT_COLLECTION,
        models.LANE_BENCHMARK_COLLECTION,
        models.LANE_BENCHMARK_PAGE_COLLECTION,
        models.LANE_SCORECARD_SNAPSHOT_COLLECTION,
        models.MODEL_CALL_USAGE_COLLECTION,
      ].sort(),
    );
    for (const name of [
      'research_entities',
      'researchers',
      'observations',
      'search_rerank_cache',
    ]) {
      expect(DEV_WRITE_GUARD_EXEMPT_COLLECTIONS.has(name)).toBe(false);
    }
  });
});

describe('every model carries the guard', () => {
  it('applies it to every model the barrel registers', () => {
    expect(Object.keys(models).length).toBeGreaterThan(20);
    const unguarded = mongoose
      .modelNames()
      .filter((name) => !schemaHasDevWriteGuard(mongoose.model(name).schema));
    expect(mongoose.modelNames().length).toBeGreaterThan(30);
    expect(unguarded).toEqual([]);
  });

  it('is imported for its side effect before every model compiles, so importing any one model installs it', () => {
    const modelFiles = fs
      .readdirSync(path.join(SERVER_SRC, 'models'))
      .filter((name) => name.endsWith('.ts'))
      .map((name) => path.join(SERVER_SRC, 'models', name));
    const compiling = modelFiles.filter((file) =>
      /mongoose\.model[(<]/.test(fs.readFileSync(file, 'utf8')),
    );
    expect(compiling.length).toBeGreaterThan(30);
    const unguarded = compiling
      .filter((file) => {
        const source = ts.createSourceFile(
          file,
          fs.readFileSync(file, 'utf8'),
          ts.ScriptTarget.Latest,
          true,
        );
        return !source.statements.some(
          (statement) =>
            ts.isImportDeclaration(statement) &&
            !statement.importClause &&
            ts.isStringLiteral(statement.moduleSpecifier) &&
            statement.moduleSpecifier.text === GUARD_MODULE,
        );
      })
      .map((file) => path.relative(SERVER_SRC, file));
    expect(unguarded).toEqual([]);
  });

  it('refuses a script connection to Development when a model was compiled without it', async () => {
    const registered = (mongoose as unknown as { plugins: Array<[unknown, unknown]> }).plugins;
    const index = registered.findIndex(([fn]) => fn === devWriteGuardPlugin);
    expect(index).toBeGreaterThanOrEqual(0);
    const [entry] = registered.splice(index, 1);
    try {
      mongoose.model('DevWriteGuardUnguardedProbe', new mongoose.Schema({ name: String }));
    } finally {
      registered.splice(index, 0, entry);
    }
    try {
      await expect(connectScriptMongo(uriFor('Development'))).rejects.toBeInstanceOf(
        UnguardedModelError,
      );
    } finally {
      mongoose.deleteModel('DevWriteGuardUnguardedProbe');
    }
  });
});

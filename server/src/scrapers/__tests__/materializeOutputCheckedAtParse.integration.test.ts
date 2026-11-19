import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { MongoClient, ObjectId } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { hermeticChildEnvironment } from '../../test/hermeticEnvironment';

const SERVER_ROOT = path.resolve(__dirname, '../../..');
const CLI = path.join(SERVER_ROOT, 'src', 'scrapers', 'cli.ts');
const DATABASE_NAME = 'scrape_output_checked_at_parse_test';
const ROW_SLUG = 'fixture-output-checked-at-parse';
const FIXTURE_SOURCE = 'fixture-output-checked-at-parse';
const CHILD_RUN_CEILING_MS = 60_000;

const liveChildren = new Set<ChildProcess>();
const stopSurvivingChildren = (): void => {
  for (const child of liveChildren) child.kill('SIGKILL');
  liveChildren.clear();
};
process.once('exit', stopSurvivingChildren);

interface ChildRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

// Asynchronous on purpose: the in-memory mongod is this process's child and stalls once its log
// pipe fills, so a parent blocked in spawnSync freezes the database the child script is using.
const runCli = (args: string[], env: NodeJS.ProcessEnv) =>
  new Promise<ChildRun>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', CLI, ...args], {
      cwd: SERVER_ROOT,
      env: hermeticChildEnvironment(env),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    liveChildren.add(child);
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => (stdout += chunk));
    child.stderr?.on('data', (chunk) => (stderr += chunk));
    const ceiling = setTimeout(() => child.kill('SIGKILL'), CHILD_RUN_CEILING_MS);
    child.on('error', reject);
    child.on('close', (status) => {
      clearTimeout(ceiling);
      liveChildren.delete(child);
      resolve({ status, stdout, stderr });
    });
  });

describe(
  'scrape materialize checks --output before it connects or writes (#6366)',
  { timeout: CHILD_RUN_CEILING_MS + 30_000 },
  () => {
    let replSet: MongoMemoryReplSet;
    let client: MongoClient;
    let runId: ObjectId;
    let scratch: string;

    const db = () => client.db(DATABASE_NAME);
    const storedName = async () =>
      (await db().collection('research_entities').findOne({ slug: ROW_SLUG }))?.name;
    const documentCounts = async () =>
      Object.fromEntries(
        await Promise.all(
          (await db().collections()).map(
            async (collection) =>
              [collection.collectionName, await collection.countDocuments()] as const,
          ),
        ),
      );

    const applyWithOutput = (output: string) =>
      runCli(
        [
          'materialize',
          '--run',
          String(runId),
          '--apply',
          '--confirm-materialize',
          '--output',
          output,
        ],
        {
          MONGODBURL: replSet.getUri(DATABASE_NAME),
          SCRAPER_ENV: 'development',
          SCRAPER_DEVELOPMENT_DB_NAME: DATABASE_NAME,
          ALLOW_NON_PROD_SCRAPER_WRITES: 'true',
          DIRECTORY_REMOVAL_KEY: 'synthetic-output-check-key-0123456789',
        },
      );

    beforeAll(async () => {
      replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
      client = await MongoClient.connect(replSet.getUri());
    });

    afterEach(stopSurvivingChildren);

    afterAll(async () => {
      stopSurvivingChildren();
      await client?.close();
      await replSet?.stop();
    });

    beforeEach(async () => {
      for (const collection of await db().collections()) await collection.deleteMany({});
      scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-output-check-')));
      const sourceId = new ObjectId();
      runId = new ObjectId();
      const observedAt = new Date('2026-01-01T00:00:00Z');
      await db().collection('sources').insertOne({
        _id: sourceId,
        name: FIXTURE_SOURCE,
        displayName: 'Fixture output check',
        defaultWeight: 0.8,
        enabled: true,
      });
      await db().collection('scrape_runs').insertOne({
        _id: runId,
        sourceId,
        sourceName: FIXTURE_SOURCE,
        status: 'success',
        triggeredBy: 'cli',
        startedAt: observedAt,
      });
      await db().collection('research_entities').insertOne({
        slug: ROW_SLUG,
        name: 'Fixture Output Center',
        kind: 'center',
        archived: false,
      });
      await db().collection('observations').insertOne({
        entityType: 'researchEntity',
        entityKey: ROW_SLUG,
        field: 'name',
        value: 'Fixture Output Center Renamed',
        sourceId,
        sourceName: FIXTURE_SOURCE,
        scrapeRunId: runId,
        confidence: 0.9,
        observedAt,
        superseded: false,
      });
    });

    afterEach(() => {
      fs.chmodSync(scratch, 0o700);
      for (const entry of fs.readdirSync(scratch)) {
        fs.chmodSync(path.join(scratch, entry), 0o700);
      }
      fs.rmSync(scratch, { recursive: true, force: true });
    });

    it('exits non-zero with 0 writes when the report directory does not exist', async () => {
      const before = await documentCounts();

      const run = await applyWithOutput(path.join(scratch, 'missing', 'report.json'));

      expect(run.status, run.stderr).not.toBe(0);
      expect(run.stderr).toContain('does not exist; create it before the run');
      expect(await storedName()).toBe('Fixture Output Center');
      expect(await documentCounts()).toEqual(before);
    });

    it.skipIf(process.getuid?.() === 0)(
      'exits non-zero with 0 writes when the report directory is not writable',
      async () => {
        const locked = path.join(scratch, 'locked');
        fs.mkdirSync(locked);
        fs.chmodSync(locked, 0o500);
        const before = await documentCounts();

        const run = await applyWithOutput(path.join(locked, 'report.json'));

        expect(run.status, run.stderr).not.toBe(0);
        expect(run.stderr).toContain('is not writable');
        expect(await storedName()).toBe('Fixture Output Center');
        expect(await documentCounts()).toEqual(before);
      },
    );

    it('applies and writes an owner-only report to a good path, with the temp-root warning', async () => {
      const output = path.join(scratch, 'report.json');

      const run = await applyWithOutput(output);

      expect(run.status, run.stderr).toBe(0);
      expect(await storedName()).toBe('Fixture Output Center Renamed');
      expect(JSON.parse(fs.readFileSync(output, 'utf8')).runId).toBe(String(runId));
      expect(fs.statSync(output).mode & 0o777).toBe(0o600);
      expect(run.stderr).toContain('is under a temp directory the system may wipe');
    });
  },
);

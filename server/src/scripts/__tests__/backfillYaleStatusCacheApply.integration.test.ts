import os from 'os';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeEach, beforeAll, describe, expect, it } from 'vitest';

const SCRIPT_PATH = path.resolve(__dirname, '../backfillYaleStatusCache.ts');
const TSX_BIN = path.resolve(__dirname, '../../../node_modules/.bin/tsx');

const LIVE_PROFILE = 'https://example-dept.yale.test/people/synthetic-lead-one';
const MEMORIAM_PROFILE = 'https://example-dept.yale.test/in-memoriam/synthetic-lead-two';

interface StatusCacheReport {
  mode: string;
  scanned: number;
  gainingCacheValue: number;
  manuallyLockedSkipped: number;
  healingStaleInactiveCache: number;
  healingSuppressedOnlyByInactiveAtYale: number;
  nextStep?: string;
  healSample: Array<{ label: string; previousYaleStatusCache: string }>;
}

function seedDocuments() {
  return [
    {
      slug: 'synthetic-stale-departed-home',
      name: 'Synthetic Stale Departed Research Home',
      displayName: 'Synthetic Stale Departed Research Home',
      kind: 'faculty-research-area',
      entityType: 'FACULTY_RESEARCH_AREA',
      archived: false,
      sourceUrls: [LIVE_PROFILE],
      shortDescription: 'Synthetic research home with no in-memoriam evidence behind its cache.',
      activeAtYaleCache: false,
      yaleStatusCache: 'departed',
      yaleStatusReasonCache: '',
      studentVisibilityTier: 'suppressed',
      studentVisibilityComputedTier: 'suppressed',
      studentVisibilityReasons: ['inactive_at_yale'],
    },
    {
      slug: 'synthetic-stale-departed-locked',
      name: 'Synthetic Stale Departed Locked Home',
      displayName: 'Synthetic Stale Departed Locked Home',
      kind: 'faculty-research-area',
      entityType: 'FACULTY_RESEARCH_AREA',
      archived: false,
      sourceUrls: [LIVE_PROFILE],
      shortDescription: 'Operator locked this status cache to departed on purpose.',
      activeAtYaleCache: false,
      yaleStatusCache: 'departed',
      yaleStatusReasonCache: '',
      manuallyLockedFields: ['activeAtYaleCache'],
      studentVisibilityTier: 'suppressed',
      studentVisibilityReasons: ['inactive_at_yale'],
    },
    {
      slug: 'synthetic-roster-departed-home',
      name: 'Synthetic Roster Departed Research Home',
      displayName: 'Synthetic Roster Departed Research Home',
      kind: 'faculty-research-area',
      entityType: 'FACULTY_RESEARCH_AREA',
      archived: false,
      sourceUrls: [LIVE_PROFILE],
      shortDescription: 'The roster reconciler owns this departure.',
      activeAtYaleCache: false,
      yaleStatusCache: 'departed',
      yaleStatusReasonCache: 'departed',
      absentFromRosterSinceRunId: 'synthetic-run-42',
      studentVisibilityTier: 'suppressed',
      studentVisibilityReasons: ['inactive_at_yale'],
    },
    {
      slug: 'synthetic-in-memoriam-home',
      name: 'Synthetic In Memoriam Research Home',
      displayName: 'Synthetic In Memoriam Research Home',
      kind: 'faculty-research-area',
      entityType: 'FACULTY_RESEARCH_AREA',
      archived: false,
      sourceUrls: [MEMORIAM_PROFILE],
      shortDescription: 'Synthetic record whose only surviving source page is an in-memoriam page.',
      activeAtYaleCache: true,
      yaleStatusCache: 'unknown',
      yaleStatusReasonCache: '',
      studentVisibilityTier: 'student_ready',
      studentVisibilityComputedTier: 'student_ready',
      studentVisibilityReasons: [],
    },
    {
      slug: 'synthetic-in-memoriam-locked',
      name: 'Synthetic In Memoriam Locked Home',
      displayName: 'Synthetic In Memoriam Locked Home',
      kind: 'faculty-research-area',
      entityType: 'FACULTY_RESEARCH_AREA',
      archived: false,
      sourceUrls: [MEMORIAM_PROFILE],
      shortDescription: 'Operator pinned this record active despite the in-memoriam page.',
      activeAtYaleCache: true,
      yaleStatusCache: 'unknown',
      yaleStatusReasonCache: '',
      manuallyLockedFields: ['activeAtYaleCache'],
      studentVisibilityTier: 'student_ready',
      studentVisibilityReasons: [],
    },
  ];
}

async function runBackfillCli(mongoUrl: string, args: string[]) {
  return new Promise<{ code: number | null; stderr: string }>((resolve) => {
    const child = spawn(TSX_BIN, [SCRIPT_PATH, ...args], {
      cwd: path.resolve(__dirname, '../../..'),
      env: {
        ...process.env,
        MONGODBURL: mongoUrl,
        SCRAPER_ENV: 'development',
        NODE_ENV: 'development',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('exit', (code) => resolve({ code, stderr }));
  });
}

async function runAndReadReport(mongoUrl: string, args: string[]) {
  const outputPath = path.join(os.tmpdir(), `ylabs-yale-status-cache-${process.pid}.json`);
  fs.rmSync(outputPath, { force: true });
  const { code, stderr } = await runBackfillCli(mongoUrl, [...args, '--output', outputPath]);
  expect(stderr).not.toMatch(/Failed to backfill Yale status cache/);
  expect(code).toBe(0);
  const report = JSON.parse(fs.readFileSync(outputPath, 'utf8')) as StatusCacheReport;
  fs.rmSync(outputPath, { force: true });
  return report;
}

const CACHE_FIELDS = {
  _id: 0,
  slug: 1,
  activeAtYaleCache: 1,
  yaleStatusCache: 1,
  yaleStatusReasonCache: 1,
  studentVisibilityTier: 1,
} as const;

async function statusCacheBySlug() {
  const rows = await mongoose.connection
    .db!.collection('research_entities')
    .find({}, { projection: CACHE_FIELDS })
    .toArray();
  return Object.fromEntries(rows.map((row) => [row.slug as string, row]));
}

describe('research:backfill-yale-status-cache apply is bidirectional (issue #2283)', () => {
  let mongod: MongoMemoryServer;
  let mongoUrl: string;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    mongoUrl = mongod.getUri('Development');
    await mongoose.connect(mongoUrl);
  }, 120_000);

  afterAll(async () => {
    await mongoose.disconnect().catch(() => {});
    await mongod.stop();
  });

  beforeEach(async () => {
    await mongoose.connection.db!.collection('research_entities').deleteMany({});
    await mongoose.connection.db!.collection('research_entities').insertMany(seedDocuments());
  });

  it('reports both directions in a dry run without writing anything', async () => {
    const before = await statusCacheBySlug();

    const report = await runAndReadReport(mongoUrl, []);

    expect(report.mode).toBe('dry-run');
    expect(report.scanned).toBe(5);
    expect(report.gainingCacheValue).toBe(1);
    expect(report.healingStaleInactiveCache).toBe(1);
    expect(report.healingSuppressedOnlyByInactiveAtYale).toBe(1);
    expect(report.manuallyLockedSkipped).toBe(2);
    expect(report.nextStep).toMatch(/student-visibility:gate --apply/);
    expect(report.healSample).toEqual([
      expect.objectContaining({
        label: 'Synthetic Stale Departed Research Home',
        previousYaleStatusCache: 'departed',
      }),
    ]);

    expect(await statusCacheBySlug()).toEqual(before);
  }, 120_000);

  it('heals the stale evidenceless cache and suppresses the in-memoriam record in one run', async () => {
    await runAndReadReport(mongoUrl, [
      '--apply',
      '--confirm-yale-status-cache-backfill',
      '--limit=50',
    ]);

    const after = await statusCacheBySlug();

    expect(after['synthetic-stale-departed-home']).toMatchObject({
      activeAtYaleCache: true,
      yaleStatusCache: 'unknown',
      yaleStatusReasonCache: '',
    });
    expect(after['synthetic-in-memoriam-home']).toMatchObject({
      activeAtYaleCache: false,
      yaleStatusCache: 'departed',
      studentVisibilityTier: 'suppressed',
    });
  }, 120_000);

  it('leaves an operator-locked status cache untouched in both directions', async () => {
    await runAndReadReport(mongoUrl, [
      '--apply',
      '--confirm-yale-status-cache-backfill',
      '--limit=50',
    ]);

    const after = await statusCacheBySlug();

    expect(after['synthetic-stale-departed-locked']).toMatchObject({
      activeAtYaleCache: false,
      yaleStatusCache: 'departed',
    });
    expect(after['synthetic-in-memoriam-locked']).toMatchObject({
      activeAtYaleCache: true,
      yaleStatusCache: 'unknown',
      studentVisibilityTier: 'student_ready',
    });
  }, 120_000);

  it('leaves a roster-owned departure to the reconciler that recorded it', async () => {
    await runAndReadReport(mongoUrl, [
      '--apply',
      '--confirm-yale-status-cache-backfill',
      '--limit=50',
    ]);

    expect((await statusCacheBySlug())['synthetic-roster-departed-home']).toMatchObject({
      activeAtYaleCache: false,
      yaleStatusCache: 'departed',
      yaleStatusReasonCache: 'departed',
    });
  }, 120_000);
});

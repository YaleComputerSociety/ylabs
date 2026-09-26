import path from 'path';
import { spawn } from 'child_process';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { hermeticChildEnvironment } from '../../test/hermeticEnvironment';
import { ResearchEntity } from '../../models/researchEntity';
import { getResearchGroupDetail } from '../../services/researchGroupService';
import { runStudentVisibilityGate } from '../../services/studentVisibilityGateService';

const SCRIPT_PATH = path.resolve(__dirname, '../recordResearchEntityDeparture.ts');
const TSX_BIN = path.resolve(__dirname, '../../../node_modules/.bin/tsx');
const SERVER_ROOT = path.resolve(__dirname, '../../..');

const SLUG = 'ysm-quimby-neonatal-lab';
const NOTE = 'lead relocated to another institution (operator report 2026-09-25)';
const OWNED_ADDRESS = 'https://medicine.yale.edu/lab/quimby/';
const PROFILE_PAGE = 'https://medicine.yale.edu/profile/quimby/';
const SHORT_DESCRIPTION =
  'Studies neonatal care quality improvement across community hospital nurseries in Connecticut.';
const FULL_DESCRIPTION =
  'The lab studies neonatal care quality improvement across community hospital nurseries, pairing implementation trials of standardized resuscitation protocols with chart review of delivery-room outcomes to explain why comparable nurseries reach very different rates of avoidable transfer.';

interface DepartureReport {
  mode: string;
  note: string;
  outcome: {
    slug: string;
    entityId?: string;
    tierBefore?: string;
    decision: { action: string; reason?: string; set?: Record<string, unknown> };
  };
  gateCounts: unknown;
  after: { tier?: string; activeAtYaleCache?: boolean } | null;
  stillServed: boolean;
}

interface CliRun {
  code: number | null;
  stdout: string;
  stderr: string;
}

async function runCli(mongoUrl: string, args: string[]): Promise<CliRun> {
  return new Promise<CliRun>((resolve) => {
    const child = spawn(TSX_BIN, [SCRIPT_PATH, ...args], {
      cwd: SERVER_ROOT,
      env: hermeticChildEnvironment({
        MONGODBURL: mongoUrl,
        SCRAPER_ENV: 'development',
        NODE_ENV: 'development',
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

function reportFrom(run: CliRun): DepartureReport {
  const start = run.stdout.indexOf('{\n  "script"');
  const end = run.stdout.lastIndexOf('}');
  if (start < 0 || end < start) {
    throw new Error(`no report on stdout: ${run.stdout}\n${run.stderr}`);
  }
  return JSON.parse(run.stdout.slice(start, end + 1)) as DepartureReport;
}

const storedRow = () =>
  ResearchEntity.findOne({ slug: SLUG })
    .select(
      'studentVisibilityTier studentVisibilitySuppressionReason activeAtYaleCache yaleStatusCache manuallyLockedFields',
    )
    .lean<Record<string, any>>();

const isServed = async () => Boolean(await getResearchGroupDetail(SLUG));

describe('an operator-reported departure stops the directory serving the row (#3468)', () => {
  let replSet: MongoMemoryReplSet;
  let mongoUrl: string;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    mongoUrl = replSet.getUri();
    await mongoose.connect(mongoUrl);
  }, 120000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  const seedServedLab = async (overrides: Record<string, unknown> = {}) => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    const entityId = new mongoose.Types.ObjectId();
    await db.collection('research_entities').insertOne({
      _id: entityId,
      slug: SLUG,
      name: 'Quimby Neonatal Outcomes Lab',
      displayName: 'Quimby Neonatal Outcomes Lab',
      kind: 'lab',
      entityType: 'LAB',
      archived: false,
      departments: ['Pediatrics'],
      researchAreas: ['Quality improvement'],
      studentVisibilityTier: 'student_ready',
      studentVisibilityReasons: ['source_backed_description'],
      shortDescription: SHORT_DESCRIPTION,
      fullDescription: FULL_DESCRIPTION,
      websiteUrl: OWNED_ADDRESS,
      sourceUrls: [OWNED_ADDRESS],
      activeAtYaleCache: true,
      fieldProvenance: {
        websiteUrl: { sourceName: 'ysm-lab-site', sourceUrl: OWNED_ADDRESS },
        shortDescription: { sourceName: 'ysm-faculty', sourceUrl: PROFILE_PAGE },
        fullDescription: { sourceName: 'ysm-faculty', sourceUrl: PROFILE_PAGE },
        displayName: { sourceName: 'ysm-faculty', sourceUrl: PROFILE_PAGE },
      },
      ...overrides,
    });
    const personId = new mongoose.Types.ObjectId();
    await db.collection('researchers').insertOne({
      _id: personId,
      displayName: 'Robin Quimby',
      firstName: 'Robin',
      lastName: 'Quimby',
      netid: 'fixturequimby',
      archived: false,
    });
    await db.collection('role_assignments').insertOne({
      personId,
      target: { kind: 'RESEARCH_ENTITY', id: entityId },
      role: 'PI',
      state: 'CURRENT',
      archived: false,
      verifiedAt: new Date(),
      source: { name: 'ysm-faculty', url: PROFILE_PAGE },
    });
    await runStudentVisibilityGate({ collection: 'research', mode: 'apply' });
  };

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of [
      'research_entities',
      'role_assignments',
      'researchers',
      'visibility_release_queue_items',
      'signals',
      'observations',
    ]) {
      await db.collection(name).deleteMany({});
    }
  });

  it('serves the row before the report and 404s it afterwards', async () => {
    await seedServedLab();
    expect(await isServed()).toBe(true);
    expect((await storedRow())?.studentVisibilityTier).toBe('student_ready');

    const run = await runCli(mongoUrl, ['--slug', SLUG, '--note', NOTE, '--apply']);
    expect(run.code).toBe(0);
    const report = reportFrom(run);

    expect(report.mode).toBe('apply');
    expect(report.outcome.decision.action).toBe('record');
    expect(report.outcome.tierBefore).toBe('student_ready');
    expect(report.after?.tier).toBe('suppressed');
    expect(report.after?.activeAtYaleCache).toBe(false);
    expect(report.stillServed).toBe(false);

    const stored = await storedRow();
    expect(stored?.studentVisibilitySuppressionReason).toContain(`permanently_closed: ${NOTE}`);
    expect(stored?.yaleStatusCache).toBe('departed');
    expect(await isServed()).toBe(false);
  }, 180000);

  it('changes nothing in the default dry run and leaves the row served', async () => {
    await seedServedLab();

    const run = await runCli(mongoUrl, ['--slug', SLUG, '--note', NOTE]);
    expect(run.code).toBe(0);
    const report = reportFrom(run);

    expect(report.mode).toBe('dry-run');
    expect(report.outcome.decision.action).toBe('record');
    expect(report.gateCounts).toBeNull();
    expect(report.stillServed).toBe(true);

    const stored = await storedRow();
    expect(stored?.studentVisibilitySuppressionReason).toBeUndefined();
    expect(stored?.activeAtYaleCache).toBe(true);
    expect(stored?.studentVisibilityTier).toBe('student_ready');
    expect(await isServed()).toBe(true);
  }, 180000);

  it('finishes a hand-written marker by re-gating the row it already carries', async () => {
    await seedServedLab();
    await ResearchEntity.updateOne(
      { slug: SLUG },
      { $set: { studentVisibilitySuppressionReason: 'permanently_closed: recorded by hand' } },
    );
    expect(await isServed()).toBe(true);

    const run = await runCli(mongoUrl, ['--slug', SLUG, '--note', NOTE, '--apply']);
    expect(run.code).toBe(0);
    const report = reportFrom(run);

    expect(report.outcome.decision).toEqual({ action: 'skip', reason: 'already_recorded' });
    expect(report.stillServed).toBe(false);
    expect(await isServed()).toBe(false);
    expect((await storedRow())?.studentVisibilitySuppressionReason).toBe(
      'permanently_closed: recorded by hand',
    );
  }, 180000);

  it('honours an operator lock on the Yale-status cache instead of overwriting it', async () => {
    await seedServedLab({ manuallyLockedFields: ['activeAtYaleCache'] });

    const run = await runCli(mongoUrl, ['--slug', SLUG, '--note', NOTE, '--apply']);
    expect(run.code).toBe(0);
    const report = reportFrom(run);

    expect(report.outcome.decision).toEqual({ action: 'skip', reason: 'yale_status_cache_locked' });

    const stored = await storedRow();
    expect(stored?.activeAtYaleCache).toBe(true);
    expect(stored?.studentVisibilitySuppressionReason).toBeUndefined();
  }, 180000);

  it('refuses a mistyped flag rather than reading the next flag as the slug', async () => {
    await seedServedLab();

    const run = await runCli(mongoUrl, ['--note', NOTE, '--slug', '--apply']);
    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(/--slug requires a value/);

    const stored = await storedRow();
    expect(stored?.studentVisibilitySuppressionReason).toBeUndefined();
    expect(await isServed()).toBe(true);
  }, 180000);

  it('refuses a comma in the note, which would split the reason list', async () => {
    await seedServedLab();

    const run = await runCli(mongoUrl, [
      '--slug',
      SLUG,
      '--note',
      'relocated, verified today',
      '--apply',
    ]);
    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(/must not contain a comma/);

    expect((await storedRow())?.studentVisibilitySuppressionReason).toBeUndefined();
    expect(await isServed()).toBe(true);
  }, 180000);
});

import os from 'os';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SCRIPT_PATH = path.resolve(__dirname, '../visibilityRecoverabilityAudit.ts');
const TSX_BIN = path.resolve(__dirname, '../../../node_modules/.bin/tsx');

const LAB_PAGE = 'https://labs.example.edu/rivers-neuroimmunology';
const PROFILE_PAGE = 'https://medicine.example.edu/profile/jordan-rivers';

const id = (hex: string) => new mongoose.Types.ObjectId(hex);

const ENTITY_IDS = {
  storedDescription: id('000000000000000000000001'),
  crawlable: id('000000000000000000000002'),
  decisionOnly: id('000000000000000000000003'),
  exhausted: id('000000000000000000000004'),
  neverGated: id('000000000000000000000005'),
  gatedUnmodelled: id('000000000000000000000006'),
  rolledBackEvidence: id('000000000000000000000007'),
  alreadyThin: id('000000000000000000000008'),
  publicRow: id('000000000000000000000009'),
  archivedRow: id('00000000000000000000000a'),
};

function seedEntities() {
  const base = {
    kind: 'faculty-research-area',
    entityType: 'FACULTY_RESEARCH_AREA',
    archived: false,
  };
  return [
    {
      ...base,
      _id: ENTITY_IDS.storedDescription,
      slug: 'synthetic-stored-card-description',
      name: 'Synthetic Stored Card Description Home',
      studentVisibilityTier: 'operator_review',
      studentVisibilityComputedAt: new Date('2026-01-02T00:00:00.000Z'),
      studentVisibilityReasons: ['missing_card_description'],
    },
    {
      ...base,
      _id: ENTITY_IDS.crawlable,
      slug: 'synthetic-crawlable-source',
      name: 'Synthetic Crawlable Source Home',
      sourceUrls: [LAB_PAGE],
      studentVisibilityTier: 'operator_review',
      studentVisibilityComputedAt: new Date('2026-01-02T00:00:00.000Z'),
      studentVisibilityReasons: ['missing_description'],
    },
    {
      ...base,
      _id: ENTITY_IDS.decisionOnly,
      slug: 'synthetic-decision-only',
      name: 'Synthetic Decision Only Home',
      sourceUrls: [LAB_PAGE],
      fullDescription: 'A complete synthetic description that no decision blocker cares about.',
      studentVisibilityTier: 'suppressed',
      studentVisibilityComputedAt: new Date('2026-01-02T00:00:00.000Z'),
      studentVisibilityReasons: ['duplicate_risk', 'permanently_closed'],
    },
    {
      ...base,
      _id: ENTITY_IDS.exhausted,
      slug: 'synthetic-no-evidence-no-source',
      name: 'Synthetic Exhausted Home',
      studentVisibilityTier: 'operator_review',
      studentVisibilityComputedAt: new Date('2026-01-02T00:00:00.000Z'),
      studentVisibilityReasons: ['missing_description'],
    },
    {
      ...base,
      _id: ENTITY_IDS.neverGated,
      slug: 'synthetic-never-gated',
      name: 'Synthetic Never Gated Home',
      sourceUrls: [LAB_PAGE],
      studentVisibilityTier: 'operator_review',
      studentVisibilityReasons: [],
    },
    {
      ...base,
      _id: ENTITY_IDS.gatedUnmodelled,
      slug: 'synthetic-gated-unmodelled-hold',
      name: 'Synthetic Gated Unmodelled Hold Home',
      sourceUrls: [LAB_PAGE],
      fullDescription: 'A synthetic description held by a reason this audit does not model.',
      studentVisibilityTier: 'operator_review',
      studentVisibilityComputedAt: new Date('2026-01-02T00:00:00.000Z'),
      studentVisibilityReasons: ['citations_identify_no_person'],
    },
    {
      ...base,
      _id: ENTITY_IDS.rolledBackEvidence,
      slug: 'synthetic-rolled-back-evidence',
      name: 'Synthetic Rolled Back Evidence Home',
      sourceUrls: [PROFILE_PAGE],
      studentVisibilityTier: 'operator_review',
      studentVisibilityComputedAt: new Date('2026-01-02T00:00:00.000Z'),
      studentVisibilityReasons: ['missing_card_description'],
    },
    {
      ...base,
      _id: ENTITY_IDS.alreadyThin,
      slug: 'synthetic-already-thin-description',
      name: 'Synthetic Already Thin Description Home',
      sourceUrls: [LAB_PAGE],
      fullDescription: 'Immunology research.',
      studentVisibilityTier: 'operator_review',
      studentVisibilityComputedAt: new Date('2026-01-02T00:00:00.000Z'),
      studentVisibilityReasons: ['thin_description'],
    },
    {
      ...base,
      _id: ENTITY_IDS.publicRow,
      slug: 'synthetic-public-row',
      name: 'Synthetic Public Home',
      sourceUrls: [LAB_PAGE],
      fullDescription: 'A synthetic public description that students can already read.',
      studentVisibilityTier: 'student_ready',
      studentVisibilityComputedAt: new Date('2026-01-02T00:00:00.000Z'),
      studentVisibilityReasons: [],
    },
    {
      ...base,
      _id: ENTITY_IDS.archivedRow,
      slug: 'synthetic-archived-row',
      name: 'Synthetic Archived Home',
      archived: true,
      studentVisibilityTier: 'operator_review',
      studentVisibilityComputedAt: new Date('2026-01-02T00:00:00.000Z'),
      studentVisibilityReasons: ['missing_description'],
    },
  ];
}

function seedObservations() {
  const base = {
    entityType: 'researchEntity',
    sourceId: id('0000000000000000000000ff'),
    sourceName: 'synthetic-source',
    confidence: 0.9,
    observedAt: new Date('2026-01-01T00:00:00.000Z'),
    superseded: false,
  };
  return [
    {
      ...base,
      entityId: ENTITY_IDS.storedDescription,
      entityKey: 'synthetic-stored-card-description',
      field: 'shortDescription',
      value: 'A stored one-line summary the document never received.',
    },
    {
      ...base,
      entityId: ENTITY_IDS.rolledBackEvidence,
      entityKey: 'synthetic-rolled-back-evidence',
      field: 'shortDescription',
      value: 'A retired graft a prior repair rolled back.',
      rollback: { rolledBackAt: new Date('2026-01-03T00:00:00.000Z'), reason: 'wrong entity' },
    },
    {
      ...base,
      entityId: ENTITY_IDS.alreadyThin,
      entityKey: 'synthetic-already-thin-description',
      field: 'fullDescription',
      value: 'Immunology research.',
    },
  ];
}

interface RecoverabilityPayload {
  db: string;
  tiers: string[];
  scanned: number;
  withheld: number;
  byBucket: { regate: number; materialize: number; acquire: number; ceiling: number };
  byBlocker: Array<{
    blocker: string;
    rows: number;
    materialize: number;
    acquire: number;
    ceiling: number;
  }>;
  decisionOnlyRows: number;
  examplesByBucket: Record<string, Array<{ slug: string; decidingBlocker: string }>>;
}

function runAuditCli(mongoUrl: string, args: string[]) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(TSX_BIN, [SCRIPT_PATH, ...args], {
      cwd: path.resolve(__dirname, '../../..'),
      env: {
        ...process.env,
        MONGODBURL: mongoUrl,
        SCRAPER_ENV: 'development',
        NODE_ENV: 'development',
      },
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

async function runAndReadReport(mongoUrl: string, args: string[] = []) {
  const outputPath = path.join(os.tmpdir(), `ylabs-recoverability-${process.pid}.json`);
  fs.rmSync(outputPath, { force: true });
  const result = await runAuditCli(mongoUrl, [...args, `--output=${outputPath}`]);
  expect(result.stderr).not.toMatch(/visibility recoverability audit failed/);
  expect(result.code).toBe(0);
  const payload = JSON.parse(fs.readFileSync(outputPath, 'utf8')) as RecoverabilityPayload;
  fs.rmSync(outputPath, { force: true });
  return { ...result, payload };
}

const bucketOf = (payload: RecoverabilityPayload, slug: string): string | undefined => {
  for (const [bucket, examples] of Object.entries(payload.examplesByBucket))
    if (examples.some((example) => example.slug === slug)) return bucket;
  return undefined;
};

const decidingBlockerOf = (payload: RecoverabilityPayload, slug: string): string | undefined => {
  for (const examples of Object.values(payload.examplesByBucket))
    for (const example of examples) if (example.slug === slug) return example.decidingBlocker;
  return undefined;
};

describe('visibility:recoverability audits the withheld corpus end to end (issue #2517)', () => {
  let mongod: MongoMemoryServer;
  let mongoUrl: string;
  let payload: RecoverabilityPayload;
  let stdout: string;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    mongoUrl = mongod.getUri('Development');
    await mongoose.connect(mongoUrl);
    await mongoose.connection.db!.collection('research_entities').insertMany(seedEntities());
    await mongoose.connection.db!.collection('observations').insertMany(seedObservations());
    const run = await runAndReadReport(mongoUrl);
    payload = run.payload;
    stdout = run.stdout;
  }, 180_000);

  afterAll(async () => {
    await mongoose.disconnect().catch(() => {});
    await mongod.stop();
  });

  it('scans only the withheld, non-archived corpus', () => {
    expect(payload.tiers).toEqual(['operator_review', 'suppressed']);
    expect(payload.scanned).toBe(8);
    expect(payload.withheld).toBe(8);
    expect(bucketOf(payload, 'synthetic-public-row')).toBeUndefined();
    expect(bucketOf(payload, 'synthetic-archived-row')).toBeUndefined();
  });

  it('classifies each withheld row by whether the evidence to promote it exists', () => {
    expect(bucketOf(payload, 'synthetic-stored-card-description')).toBe('materialize');
    expect(bucketOf(payload, 'synthetic-crawlable-source')).toBe('acquire');
    expect(bucketOf(payload, 'synthetic-no-evidence-no-source')).toBe('ceiling');
    expect(bucketOf(payload, 'synthetic-never-gated')).toBe('regate');

    expect(bucketOf(payload, 'synthetic-decision-only')).toBe('ceiling');
    expect(decidingBlockerOf(payload, 'synthetic-decision-only')).toMatch(
      /duplicate_risk|permanently_closed/,
    );
    expect(bucketOf(payload, 'synthetic-gated-unmodelled-hold')).toBe('ceiling');
    expect(decidingBlockerOf(payload, 'synthetic-gated-unmodelled-hold')).toBe(
      'held_without_modelled_blocker',
    );
  });

  // A rolled-back observation is exactly what a prior repair retired. Counting it as
  // stored evidence would report retired grafts as recoverable value.
  it('does not count a rolled-back observation as stored evidence', () => {
    expect(bucketOf(payload, 'synthetic-rolled-back-evidence')).toBe('acquire');
  });

  // The document already carries the thin prose the observation would re-write, so
  // materializing it clears no blocker.
  it('does not call a field the document already carries materializable', () => {
    expect(bucketOf(payload, 'synthetic-already-thin-description')).toBe('acquire');
  });

  it('reports a promotion ceiling that is measured rather than assumed', () => {
    expect(payload.byBucket).toEqual({ regate: 1, materialize: 1, acquire: 3, ceiling: 3 });
    expect(payload.decisionOnlyRows).toBe(1);
    expect(payload.byBlocker).toEqual(
      expect.arrayContaining([
        { blocker: 'missing_card_description', rows: 2, materialize: 1, acquire: 1, ceiling: 0 },
        { blocker: 'missing_description', rows: 2, materialize: 0, acquire: 1, ceiling: 1 },
        { blocker: 'thin_description', rows: 1, materialize: 0, acquire: 1, ceiling: 0 },
      ]),
    );
    expect(payload.byBlocker.some((row) => row.blocker === 'citations_identify_no_person')).toBe(
      false,
    );
  });

  it('prints an operator-readable bucket table', () => {
    expect(stdout).toMatch(/Withheld records scanned: 8\b/);
    expect(stdout).toMatch(/REGATE {2,}1\b/);
    expect(stdout).toMatch(/MATERIALIZE {2,}1\b/);
    expect(stdout).toMatch(/ACQUIRE {2,}3\b/);
    expect(stdout).toMatch(/CEILING {2,}3\b/);
    expect(stdout).toMatch(/blocker\s+rows\s+materialize\s+acquire\s+ceiling/);
  });

  it('writes nothing back to the corpus it audits', async () => {
    const entities = await mongoose.connection
      .db!.collection('research_entities')
      .find({}, { projection: { _id: 0, slug: 1, studentVisibilityTier: 1, fullDescription: 1 } })
      .sort({ slug: 1 })
      .toArray();
    expect(entities).toEqual(
      seedEntities()
        .map((entity) => ({
          slug: entity.slug,
          studentVisibilityTier: entity.studentVisibilityTier,
          ...(entity.fullDescription ? { fullDescription: entity.fullDescription } : {}),
        }))
        .sort((left, right) => left.slug.localeCompare(right.slug)),
    );
  });

  it('refuses a tier that is not withheld instead of auditing public rows', async () => {
    const result = await runAuditCli(mongoUrl, ['--tier=student_ready']);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/--tier must be one of operator_review, suppressed/);
    expect(result.stdout).not.toMatch(/Withheld records scanned/);
  }, 60_000);

  it('scans a single requested withheld tier', async () => {
    const { payload: suppressedOnly } = await runAndReadReport(mongoUrl, ['--tier=suppressed']);
    expect(suppressedOnly.tiers).toEqual(['suppressed']);
    expect(suppressedOnly.withheld).toBe(1);
    expect(suppressedOnly.decisionOnlyRows).toBe(1);
  }, 60_000);
});

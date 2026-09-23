import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hermeticChildEnvironment } from '../../test/hermeticEnvironment';

const SCRIPT_PATH = path.resolve(__dirname, '../dedupeResearchEntitiesByPi.ts');
const TSX_BIN = path.resolve(__dirname, '../../../node_modules/.bin/tsx');

const CUSTOM_LAB_DOMAIN = 'https://renwicklab.example.edu/';
const SHARED_FACILITY_URL = 'https://research.example.edu/cores/cryoem';

const labId = new mongoose.Types.ObjectId();
const facetId = new mongoose.Types.ObjectId();
const facilityId = new mongoose.Types.ObjectId();
const facilityNamedPersonRowId = new mongoose.Types.ObjectId();
const labPersonId = new mongoose.Types.ObjectId();
const facilityPersonId = new mongoose.Types.ObjectId();

type LaneReport = {
  candidateGroups: number;
  plannedGroups: number;
  plan: Array<{ canonicalSlug?: string; duplicateSlugs: string[] }>;
  urlIdentityDedupeDelta?: { appliedGroups?: number; archivedEntities?: number };
};

type ServedRow = { slug?: string; archived?: boolean };

function seedEntities() {
  return [
    {
      _id: labId,
      slug: 'ysm-faculty-ada-renwick',
      name: 'Ada Renwick Lab',
      kind: 'lab',
      entityType: 'LAB',
      websiteUrl: CUSTOM_LAB_DOMAIN,
      sourceUrls: [CUSTOM_LAB_DOMAIN, 'https://biology.example.edu/faculty/ada-renwick'],
      researchAreas: ['Membrane Biophysics'],
      fullDescription:
        'The Renwick group studies membrane transport at single-molecule resolution.',
      archived: false,
    },
    {
      _id: facetId,
      slug: 'dept-biology-ada-renwick',
      name: 'Ada Renwick Research',
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
      websiteUrl: CUSTOM_LAB_DOMAIN,
      sourceUrls: [CUSTOM_LAB_DOMAIN],
      researchAreas: ['Ion Channels'],
      archived: false,
    },
    {
      _id: facilityId,
      slug: 'ysm-example-cryoem-resource',
      name: 'Example CryoEM Resource',
      kind: 'center',
      entityType: 'CORE_FACILITY',
      websiteUrl: SHARED_FACILITY_URL,
      sourceUrls: [SHARED_FACILITY_URL],
      researchAreas: ['Structural Biology'],
      fullDescription: 'Shared cryo-electron microscopy instrumentation open to all departments.',
      archived: false,
    },
    {
      _id: facilityNamedPersonRowId,
      slug: 'ysm-faculty-marta-rehn',
      name: 'Example CryoEM Resource Lab',
      kind: 'lab',
      entityType: 'LAB',
      websiteUrl: SHARED_FACILITY_URL,
      sourceUrls: [SHARED_FACILITY_URL],
      researchAreas: ['Structural Biology'],
      archived: false,
    },
  ];
}

function runLane(mongoUrl: string, args: string[]) {
  return new Promise<{ code: number | null }>((resolve) => {
    const child = spawn(TSX_BIN, [SCRIPT_PATH, ...args], {
      cwd: path.resolve(__dirname, '../../..'),
      env: hermeticChildEnvironment({ MONGODBURL: mongoUrl, NODE_ENV: 'test' }),
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    child.on('exit', (code) => resolve({ code }));
  });
}

function readReport(outputPath: string): LaneReport {
  const report = JSON.parse(fs.readFileSync(outputPath, 'utf8')) as LaneReport;
  fs.unlinkSync(outputPath);
  return report;
}

async function servedRowBySlug(): Promise<Map<string, boolean>> {
  const rows = await mongoose.connection
    .db!.collection('research_entities')
    .find({}, { projection: { slug: 1, archived: 1 } })
    .toArray();
  return new Map((rows as ServedRow[]).map((row) => [String(row.slug), Boolean(row.archived)]));
}

describe('website-url identity dedupe lane end to end', () => {
  let mongod: MongoMemoryServer;
  let mongoUrl: string;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    mongoUrl = mongod.getUri('yale_research_dev');
    await mongoose.connect(mongoUrl);
    const db = mongoose.connection.db!;
    await db.collection('research_entities').insertMany(seedEntities());
    await db.collection('researchers').insertMany([
      { _id: labPersonId, displayName: 'Ada Renwick', archived: false },
      { _id: facilityPersonId, displayName: 'Marta Rehn', archived: false },
    ]);
    await db.collection('role_assignments').insertMany([
      {
        personId: labPersonId,
        target: { kind: 'RESEARCH_ENTITY', id: labId },
        role: 'PI',
        state: 'CURRENT',
        archived: false,
      },
      {
        personId: facilityPersonId,
        target: { kind: 'RESEARCH_ENTITY', id: facilityNamedPersonRowId },
        role: 'PI',
        state: 'CURRENT',
        archived: false,
      },
    ]);
  }, 180_000);

  afterAll(async () => {
    await mongoose.disconnect().catch(() => {});
    await mongod.stop();
  });

  it('leaves the custom-domain duplicate pair unreachable for the path-keyed lane', async () => {
    const outputPath = path.join(os.tmpdir(), `path-lane-${process.pid}.json`);
    const { code } = await runLane(mongoUrl, [
      '--profile-lab-url-only',
      '--dry-run',
      '--full-plan',
      '--output',
      outputPath,
    ]);
    expect(code).toBe(0);

    const report = readReport(outputPath);
    expect(report.candidateGroups).toBe(0);
    expect(report.plan).toEqual([]);
  }, 180_000);

  it('collapses the byte-identical custom lab domain and keeps the shared facility served', async () => {
    const outputPath = path.join(os.tmpdir(), `website-url-lane-${process.pid}.json`);
    const { code } = await runLane(mongoUrl, [
      '--website-url-only',
      '--apply',
      '--confirm-research-entity-pi-dedupe',
      '--limit=10000',
      '--max-apply=500',
      '--full-plan',
      '--output',
      outputPath,
    ]);
    expect(code).toBe(0);

    const report = readReport(outputPath);
    expect(report.candidateGroups).toBe(2);
    expect(report.plannedGroups).toBe(1);
    expect(report.plan).toHaveLength(1);
    expect(report.plan[0].canonicalSlug).toBe('ysm-faculty-ada-renwick');
    expect(report.plan[0].duplicateSlugs).toEqual(['dept-biology-ada-renwick']);
    expect(report.urlIdentityDedupeDelta?.appliedGroups).toBe(1);
    expect(report.urlIdentityDedupeDelta?.archivedEntities).toBe(1);

    const archivedBySlug = await servedRowBySlug();
    expect(archivedBySlug.get('dept-biology-ada-renwick')).toBe(true);
    expect(archivedBySlug.get('ysm-faculty-ada-renwick')).toBe(false);
    expect(archivedBySlug.get('ysm-example-cryoem-resource')).toBe(false);
    expect(archivedBySlug.get('ysm-faculty-marta-rehn')).toBe(false);

    // The merge records itself as a tombstone on the collapsed row (#3027): its slug
    // keeps occupying the unique index so a re-scrape cannot re-mint the duplicate,
    // and its canonicalGroupId is what routes that evidence to the survivor.
    const tombstones = await mongoose.connection
      .db!.collection('research_entities')
      .find({ canonicalGroupId: { $ne: null } })
      .toArray();
    expect(
      tombstones.map((row) => ({
        slug: row.slug,
        archived: row.archived === true,
        canonicalGroupId: String(row.canonicalGroupId),
      })),
    ).toEqual([
      {
        slug: 'dept-biology-ada-renwick',
        archived: true,
        canonicalGroupId: labId.toHexString(),
      },
    ]);
  }, 180_000);
});

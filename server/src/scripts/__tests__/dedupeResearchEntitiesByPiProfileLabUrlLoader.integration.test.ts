import os from 'os';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SORT_MEMORY_LIMIT_BYTES = 200_000;
const NOISE_ENTITY_COUNT = 80;
const NOISE_DESCRIPTION = 'x'.repeat(12_000);

const SCRIPT_PATH = path.resolve(__dirname, '../dedupeResearchEntitiesByPi.ts');
const TSX_BIN = path.resolve(__dirname, '../../../node_modules/.bin/tsx');

type DedupeReport = {
  candidateGroups: number;
  plannedGroups: number;
  plan: Array<{
    canonicalSlug: string;
    duplicateSlugs: string[];
    mergedSourceUrls: string[];
  }>;
};

function seedDocuments() {
  const documents: Record<string, unknown>[] = [];
  for (let index = 0; index < NOISE_ENTITY_COUNT; index += 1) {
    documents.push({
      slug: `noise-${index}`,
      name: `Noise Center ${index}`,
      kind: 'center',
      entityType: 'CENTER',
      websiteUrl: `https://external-${index}.example.org/awards/${index}`,
      sourceUrls: [`https://external-${index}.example.org/awards/${index}`],
      fullDescription: NOISE_DESCRIPTION,
      shortDescription: NOISE_DESCRIPTION,
      archived: false,
    });
  }
  documents.push({
    slug: 'pierce-lab',
    name: 'Pierce Lab',
    kind: 'lab',
    entityType: 'LAB',
    websiteUrl: 'https://medicine.yale.edu/lab/pierce/',
    sourceUrls: ['https://medicine.yale.edu/lab/pierce/'],
    archived: false,
  });
  documents.push({
    slug: 'pierce-lab-fra',
    name: 'Pierce Lab',
    kind: 'lab',
    entityType: 'FACULTY_RESEARCH_AREA',
    websiteUrl: 'http://www.medicine.yale.edu/lab/pierce',
    sourceUrls: ['http://www.medicine.yale.edu/lab/pierce'],
    archived: false,
  });
  return documents;
}

async function runDedupeCli(mongoUrl: string, outputPath: string) {
  return new Promise<{ code: number | null; stderr: string }>((resolve) => {
    const child = spawn(
      TSX_BIN,
      [SCRIPT_PATH, '--profile-lab-url-only', '--dry-run', '--full-plan', '--output', outputPath],
      {
        cwd: path.resolve(__dirname, '../../..'),
        env: { ...process.env, MONGODBURL: mongoUrl, NODE_ENV: 'test' },
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('exit', (code) => resolve({ code, stderr }));
  });
}

describe('profile-lab-url dedupe loader aggregation memory bound', () => {
  let mongod: MongoMemoryServer;
  let mongoUrl: string;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create({
      instance: {
        args: [
          '--setParameter',
          `internalQueryMaxBlockingSortMemoryUsageBytes=${SORT_MEMORY_LIMIT_BYTES}`,
          '--setParameter',
          'allowDiskUseByDefault=false',
        ],
      },
    });
    mongoUrl = mongod.getUri('yale_research_dev');
    await mongoose.connect(mongoUrl);
    await mongoose.connection.db!.collection('research_entities').insertMany(seedDocuments());
    await mongoose.disconnect();
  }, 120_000);

  afterAll(async () => {
    await mongoose.disconnect().catch(() => {});
    await mongod.stop();
  });

  it('overflows an unbounded server-side blocking sort over the unwound URL corpus', async () => {
    await mongoose.connect(mongoUrl);
    const unboundedGroupedSort = [
      { $match: { archived: { $ne: true } } },
      {
        $project: {
          entity: { id: { $toString: '$_id' }, fullDescription: '$fullDescription' },
          urls: {
            $setUnion: [
              { $cond: [{ $ne: [{ $type: '$websiteUrl' }, 'missing'] }, ['$websiteUrl'], []] },
              { $ifNull: ['$sourceUrls', []] },
            ],
          },
        },
      },
      { $unwind: '$urls' },
      { $project: { url: '$urls', entity: 1 } },
      { $match: { url: { $type: 'string' } } },
      { $group: { _id: '$url', entities: { $addToSet: '$entity' } } },
      { $sort: { _id: 1 } },
    ];

    await expect(
      mongoose.connection
        .db!.collection('research_entities')
        .aggregate(unboundedGroupedSort)
        .toArray(),
    ).rejects.toMatchObject({ codeName: 'QueryExceededMemoryLimitNoDiskUseAllowed' });

    await mongoose.disconnect();
  }, 120_000);

  it('runs the shipped lane to completion and merges only the shared Yale lab/profile page', async () => {
    const outputPath = path.join(os.tmpdir(), `profile-lab-url-report-${process.pid}.json`);
    try {
      fs.unlinkSync(outputPath);
    } catch {
      // no prior artifact to clean up
    }

    const { code, stderr } = await runDedupeCli(mongoUrl, outputPath);

    expect(stderr).toBe('');
    expect(code).toBe(0);

    const report = JSON.parse(fs.readFileSync(outputPath, 'utf8')) as DedupeReport;
    fs.unlinkSync(outputPath);

    expect(report.candidateGroups).toBe(1);
    expect(report.plannedGroups).toBe(1);
    expect(report.plan).toHaveLength(1);

    const [group] = report.plan;
    expect(group.canonicalSlug).toBe('pierce-lab');
    expect(group.duplicateSlugs).toEqual(['pierce-lab-fra']);
    expect(group.mergedSourceUrls).toEqual(
      expect.arrayContaining([
        'https://medicine.yale.edu/lab/pierce/',
        'http://www.medicine.yale.edu/lab/pierce',
      ]),
    );
  }, 120_000);
});

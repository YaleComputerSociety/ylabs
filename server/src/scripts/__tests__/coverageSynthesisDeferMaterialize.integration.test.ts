import fs from 'fs';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return { ...actual, syncEntity: vi.fn().mockResolvedValue(undefined) };
});

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { Source } from '../../models/source';
import { WRITTEN_DESCRIPTION_SOURCE_NAME } from '../../scrapers/coverageSynthesis';
import { runCoverageSynthesis } from '../coverageSynthesis';
import { parseCoverageSynthesisArgs } from '../coverageSynthesisCore';

const RUN = '6a1b2c3d4e5f60718293a4b5';
const OLD_TEXT = 'An older copied description of the reef recovery program.';
const PAGE_TEXT = [
  'Coral Reef Recovery',
  'The lab studies how coral reefs recover after marine heatwaves and bleaching events.',
  'Field surveys follow coral colonies and reef fish across the Caribbean.',
].join('\n');
const ACCEPTED =
  'Studies how coral reefs recover after marine heatwaves and bleaching events, with field surveys of coral colonies and reef fish across the Caribbean.';
const DEFERRED = 'reef-lab-deferred-fixture';
const PLAIN = 'reef-lab-plain-fixture';
const DRAFTS = '/tmp/ylabs-defer-materialize-drafts.json';
const OUTPUT = '/tmp/ylabs-defer-materialize-output.json';

describe('--defer-materialize-for-runs (#5537)', () => {
  let replSet: MongoMemoryReplSet;
  const env = { ...process.env };

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    process.env.MONGODBURL = replSet.getUri('Development');
    process.env.ALLOW_NON_PROD_SCRAPER_WRITES = 'true';
    delete process.env.OPENAI_API_KEY;
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
    process.env = env;
    for (const file of [DRAFTS, OUTPUT]) fs.rmSync(file, { force: true });
  });

  const connected = async () => {
    if (mongoose.connection.readyState !== 1) await mongoose.connect(process.env.MONGODBURL!);
  };
  const run = async (argv: string[]) => {
    await mongoose.disconnect();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await runCoverageSynthesis(argv);
      const printed = log.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.trim().startsWith('{'));
      return printed.length > 0 ? JSON.parse(printed[printed.length - 1]) : {};
    } finally {
      log.mockRestore();
    }
  };

  const seedRow = async (slug: string) => {
    await ResearchEntity.create({
      slug,
      name: 'Reef Lab',
      kind: 'lab',
      entityType: 'LAB',
      fullDescription: OLD_TEXT,
      studentVisibilityTier: 'operator_review',
      archived: false,
    });
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: slug,
      field: 'researchPageText',
      value: [{ url: `https://${slug}.example.org/research`, text: PAGE_TEXT }],
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'research-page-text',
      sourceUrl: `https://${slug}.example.org/research`,
      confidence: 0.6,
      observedAt: new Date(),
      superseded: false,
    });
  };

  beforeEach(async () => {
    await connected();
    const db = mongoose.connection.db!;
    for (const name of [
      'observations',
      'research_entities',
      'sources',
      'written_description_derivations',
      'scrape_job_locks',
    ]) {
      await db.collection(name).deleteMany({});
    }
    await Source.create({
      name: WRITTEN_DESCRIPTION_SOURCE_NAME,
      displayName: 'Coverage synthesis writer',
      defaultWeight: 0.5,
    });
    await seedRow(DEFERRED);
    await seedRow(PLAIN);
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: DEFERRED,
      field: 'websiteUrl',
      value: `https://${DEFERRED}.example.org/`,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'lab-website-discovery',
      sourceUrl: `https://${DEFERRED}.example.org/`,
      scrapeRunId: new mongoose.Types.ObjectId(RUN),
      confidence: 0.6,
      observedAt: new Date(),
      superseded: false,
    });
    fs.writeFileSync(
      DRAFTS,
      JSON.stringify(
        [DEFERRED, PLAIN].map((slug) => ({
          slug,
          writer: 'claude-agent:defer-fixture',
          fullDescription: ACCEPTED,
          usedSnippetIndexes: [0],
        })),
      ),
    );
    await run(['--import-derivations', DRAFTS, `--slugs=${DEFERRED},${PLAIN}`, '--output', OUTPUT]);
    await connected();
  });

  const bodies = async (slug: string) =>
    Observation.countDocuments({
      entityKey: slug,
      sourceName: WRITTEN_DESCRIPTION_SOURCE_NAME,
      field: 'fullDescription',
    });

  it('writes both bodies, materializes only the row without a listed run, and counts the deferral', async () => {
    const report = await run([
      '--apply',
      '--confirm-coverage-synthesis',
      '--cache-only',
      `--slugs=${DEFERRED},${PLAIN}`,
      `--defer-materialize-for-runs=${RUN}`,
      '--skip-index-sync',
    ]);
    await connected();
    expect(report.materializeDeferred).toBe(1);
    expect(report.llmCalls).toBe(0);
    expect(await bodies(DEFERRED)).toBe(1);
    expect(await bodies(PLAIN)).toBe(1);
    const deferred = (await ResearchEntity.findOne({ slug: DEFERRED }).lean()) as any;
    const plain = (await ResearchEntity.findOne({ slug: PLAIN }).lean()) as any;
    expect(deferred.fullDescription).toBe(OLD_TEXT);
    expect(plain.fullDescription).not.toBe(OLD_TEXT);
  });

  it('counts the deferral in a dry run and writes nothing', async () => {
    const report = await run([
      '--cache-only',
      `--slugs=${DEFERRED},${PLAIN}`,
      `--defer-materialize-for-runs=${RUN}`,
    ]);
    await connected();
    expect(report.materializeDeferred).toBe(1);
    expect(await bodies(DEFERRED)).toBe(0);
    expect(await bodies(PLAIN)).toBe(0);
  });

  it('refuses a run id that is not a 24-hex ObjectId', () => {
    expect(() =>
      parseCoverageSynthesisArgs(['--defer-materialize-for-runs', `${RUN},not-a-run`]),
    ).toThrow('24-hex run ids');
    expect(
      parseCoverageSynthesisArgs(['--defer-materialize-for-runs', RUN.toUpperCase()])
        .deferMaterializeForRuns,
    ).toEqual([RUN]);
  });
});

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
import { coverageSynthesisModeOf, parseCoverageSynthesisArgs } from '../coverageSynthesisCore';
import { mongoWrittenDescriptionDerivationStore } from '../writtenDescriptionDerivationCore';

const PAGE_TEXT = [
  'Coral Reef Recovery',
  'The lab studies how coral reefs recover after marine heatwaves and bleaching events.',
  'Field surveys follow coral colonies and reef fish across the Caribbean.',
].join('\n');
const SERVED_BODY = 'Studies microbial communities around deep-sea hydrothermal vents.';
const STORED_WEBSITE = 'https://old-reef-lab.example.org/';
const ACCEPTED =
  'Studies how coral reefs recover after marine heatwaves and bleaching events, with field surveys of coral colonies and reef fish across the Caribbean.';
const REFUSED_DRAFT =
  'Studies glioblastoma resistance to temozolomide in CRISPR-edited zebrafish xenografts.';
const ACCEPTED_ROW = 'reef-lab-accepted-scope-fixture';
const REFUSED_ROW = 'reef-lab-refused-scope-fixture';
const STORED_DEPARTMENTS = ['Ecology and Evolutionary Biology', 'Earth and Planetary Sciences'];
const DRAFTS = '/tmp/ylabs-writer-apply-scope-drafts.json';
const OUTPUT = '/tmp/ylabs-writer-apply-scope-output.json';
const CARD_REQUESTS = '/tmp/ylabs-writer-apply-scope-card-requests.json';
const CARDS = '/tmp/ylabs-writer-apply-scope-cards.json';
const CARD = 'Studies how coral reefs recover after marine heatwaves and bleaching events.';

describe('the writer apply only adds bodies and writes only description fields (#5537)', () => {
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
    for (const file of [DRAFTS, OUTPUT, CARD_REQUESTS, CARDS]) fs.rmSync(file, { force: true });
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
      fullDescription: SERVED_BODY,
      departments: STORED_DEPARTMENTS,
      websiteUrl: STORED_WEBSITE,
      studentVisibilityTier: 'operator_review',
      archived: false,
    });
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: slug,
      field: 'researchPageText',
      value: [
        { url: `https://${slug}.example.org/research`, text: `${PAGE_TEXT}\nSite: ${slug}.` },
      ],
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'research-page-text',
      sourceUrl: `https://${slug}.example.org/research`,
      confidence: 0.6,
      observedAt: new Date(),
      superseded: false,
    });
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: slug,
      field: 'fullDescription',
      value: SERVED_BODY,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: WRITTEN_DESCRIPTION_SOURCE_NAME,
      sourceUrl: `https://${slug}.example.org/research`,
      confidence: 0.5,
      observedAt: new Date('2026-10-01'),
      superseded: false,
    });
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: slug,
      field: 'websiteUrl',
      value: `https://${slug}.example.org/`,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'lab-website-discovery',
      sourceUrl: `https://${slug}.example.org/`,
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
      'card_synthesis_derivations',
      'scrape_job_locks',
    ]) {
      await db.collection(name).deleteMany({});
    }
    await Source.create({
      name: WRITTEN_DESCRIPTION_SOURCE_NAME,
      displayName: 'Coverage synthesis writer',
      defaultWeight: 0.5,
    });
    await seedRow(ACCEPTED_ROW);
    await seedRow(REFUSED_ROW);
    fs.writeFileSync(
      DRAFTS,
      JSON.stringify([
        {
          slug: ACCEPTED_ROW,
          writer: 'claude-agent:scope-fixture',
          fullDescription: ACCEPTED,
          usedSnippetIndexes: [0],
        },
        {
          slug: REFUSED_ROW,
          writer: 'claude-agent:scope-fixture',
          fullDescription: REFUSED_DRAFT,
          usedSnippetIndexes: [0],
        },
      ]),
    );
    await run([
      '--import-derivations',
      DRAFTS,
      `--slugs=${ACCEPTED_ROW},${REFUSED_ROW}`,
      '--output',
      OUTPUT,
    ]);
    await connected();
  });

  const liveWrittenBodies = async (slug: string) =>
    Observation.find({
      entityKey: slug,
      sourceName: WRITTEN_DESCRIPTION_SOURCE_NAME,
      field: 'fullDescription',
      superseded: false,
    })
      .select('value')
      .lean();

  it('keeps the served body on a refused draft and writes no field outside the description', async () => {
    const report = await run([
      '--apply',
      '--confirm-coverage-synthesis',
      '--cache-only',
      `--slugs=${ACCEPTED_ROW},${REFUSED_ROW}`,
      '--skip-index-sync',
    ]);
    await connected();
    expect(report.llmCalls).toBe(0);

    const refusedBodies = await liveWrittenBodies(REFUSED_ROW);
    expect(refusedBodies.map((entry) => entry.value)).toEqual([SERVED_BODY]);
    const refused = (await ResearchEntity.findOne({ slug: REFUSED_ROW }).lean()) as any;
    expect(refused.fullDescription).toBe(SERVED_BODY);

    const accepted = (await ResearchEntity.findOne({ slug: ACCEPTED_ROW }).lean()) as any;
    expect(accepted.fullDescription).not.toBe(SERVED_BODY);
    expect(accepted.departments).toEqual(STORED_DEPARTMENTS);
    expect(accepted.websiteUrl).toBe(STORED_WEBSITE);
  });

  it('captures a card request for each body it would write, and the apply serves its imported card', async () => {
    const dry = await run([
      '--cache-only',
      `--slugs=${ACCEPTED_ROW},${REFUSED_ROW}`,
      '--capture-card-requests',
      CARD_REQUESTS,
    ]);
    await connected();
    expect(dry.cardRequests).toBe(1);
    const requests = JSON.parse(fs.readFileSync(CARD_REQUESTS, 'utf8'));
    expect(requests.map((request: { slug: string }) => request.slug)).toEqual([ACCEPTED_ROW]);
    expect(await liveWrittenBodies(ACCEPTED_ROW)).toHaveLength(1);

    fs.writeFileSync(
      CARDS,
      JSON.stringify([{ slug: ACCEPTED_ROW, writer: 'claude-agent:scope-fixture', card: CARD }]),
    );
    await run([
      '--synthesize-cards',
      '--import-derivations',
      CARDS,
      '--evidence-file',
      CARD_REQUESTS,
      '--output',
      OUTPUT,
    ]);
    await run([
      '--apply',
      '--confirm-coverage-synthesis',
      '--cache-only',
      `--slugs=${ACCEPTED_ROW}`,
      '--skip-index-sync',
    ]);
    await connected();
    const accepted = (await ResearchEntity.findOne({ slug: ACCEPTED_ROW }).lean()) as any;
    expect(accepted.shortDescription).toBe(CARD);
  });

  it('refuses --capture-card-requests with --apply', () => {
    expect(() =>
      coverageSynthesisModeOf(
        parseCoverageSynthesisArgs(['--apply', '--capture-card-requests', CARD_REQUESTS]),
      ),
    ).toThrow(/refused with --apply/);
  });

  it('counts a cache read the database could not answer as an error, never a miss', async () => {
    const dropped = vi
      .spyOn(mongoWrittenDescriptionDerivationStore, 'find')
      .mockRejectedValue(new Error('Client must be connected before running operations'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const report = await run([
        '--apply',
        '--confirm-coverage-synthesis',
        '--cache-only',
        `--slugs=${ACCEPTED_ROW}`,
        '--skip-index-sync',
      ]);
      expect(report.entityErrors).toBe(1);
      expect(report.cacheMissesNoCall).toBe(0);
      expect(report.written).toBe(0);
      expect(report.connectionDrops).toEqual({ disconnected: 0, reconnected: 0 });
    } finally {
      dropped.mockRestore();
      errors.mockRestore();
    }
    await connected();
    expect(await liveWrittenBodies(ACCEPTED_ROW)).toHaveLength(1);
  });
});

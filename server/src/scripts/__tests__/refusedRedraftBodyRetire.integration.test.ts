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
import { REFUSED_REDRAFT_RETIRE_REASON_PREFIX } from '../refusedRedraftBodyRetire';
import { WRITER_CONTRACT_VERSION } from '../writtenDescriptionDerivationCore';

const SLUG = 'reef-lab-refused-redraft-fixture';
const PAGE_TEXT = [
  'Coral Reef Recovery',
  'The lab studies how coral reefs recover after marine heatwaves and bleaching events.',
  'Field surveys follow coral colonies and reef fish across the Caribbean.',
].join('\n');
const SUPPORTED_BODY =
  'Studies how coral reefs recover after marine heatwaves and bleaching events, with field surveys of coral colonies and reef fish across the Caribbean.';
const UNSUPPORTED_BODY =
  'Studies volcanic seismology and magma chamber dynamics using borehole strainmeters on Pacific island arcs.';
const FALLBACK_BODY =
  'The lab studies how coral reefs recover after marine heatwaves, following coral colonies and reef fish in field surveys across the Caribbean.';
const DRAFTS = '/tmp/ylabs-refused-redraft-drafts.json';
const OUTPUT = '/tmp/ylabs-refused-redraft-output.json';

describe('--retire-unsupported-refused-bodies (#5961)', () => {
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

  const observation = (fields: Record<string, unknown>) =>
    Observation.create({
      entityType: 'researchEntity',
      entityKey: SLUG,
      sourceId: new mongoose.Types.ObjectId(),
      confidence: 0.6,
      observedAt: new Date(),
      superseded: false,
      ...fields,
    });

  const seed = async (adoptedBody: string, withFallback: boolean) => {
    await ResearchEntity.create({
      slug: SLUG,
      name: 'Reef Lab',
      kind: 'lab',
      entityType: 'LAB',
      fullDescription: adoptedBody,
      studentVisibilityTier: 'operator_review',
      archived: false,
    });
    await observation({
      field: 'researchPageText',
      value: [{ url: 'https://reef-lab.example.org/research', text: PAGE_TEXT }],
      sourceName: 'research-page-text',
      sourceUrl: 'https://reef-lab.example.org/research',
    });
    await observation({
      field: 'fullDescription',
      value: adoptedBody,
      sourceName: WRITTEN_DESCRIPTION_SOURCE_NAME,
      sourceUrl: 'https://reef-lab.example.org/research',
      confidence: 0.9,
      observedAt: new Date(Date.now() - 86_400_000),
    });
    if (withFallback) {
      await observation({
        field: 'fullDescription',
        value: FALLBACK_BODY,
        sourceName: 'yale-research-official',
        sourceUrl: 'https://research.yale.edu/reef-lab',
        confidence: 0.5,
      });
    }
    fs.writeFileSync(
      DRAFTS,
      JSON.stringify([
        {
          slug: SLUG,
          writer: 'claude-agent:refused-fixture',
          fullDescription: '',
          usedSnippetIndexes: [],
        },
      ]),
    );
    await run(['--import-derivations', DRAFTS, `--slugs=${SLUG}`, '--output', OUTPUT]);
    await connected();
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
    for (const name of [
      WRITTEN_DESCRIPTION_SOURCE_NAME,
      'research-page-text',
      'yale-research-official',
    ]) {
      await Source.create({ name, displayName: name, defaultWeight: 0.5 });
    }
  });

  const apply = (extra: string[] = ['--retire-unsupported-refused-bodies']) =>
    run([
      '--apply',
      '--confirm-coverage-synthesis',
      '--cache-only',
      `--slugs=${SLUG}`,
      '--skip-index-sync',
      ...extra,
    ]);

  const adoptedObservation = (body: string) =>
    Observation.findOne({
      entityKey: SLUG,
      sourceName: WRITTEN_DESCRIPTION_SOURCE_NAME,
      value: body,
    }).lean() as any;

  it('retires an unsupported adopted body when the redraft is refused and another body serves', async () => {
    await seed(UNSUPPORTED_BODY, true);
    const report = await apply();
    await connected();
    expect(report.refusedRedraftRetire).toEqual({
      keptSupported: 0,
      retiredWithFallback: 1,
      residualNoFallback: 0,
    });
    const retired = await adoptedObservation(UNSUPPORTED_BODY);
    expect(retired.superseded).toBe(true);
    expect(retired.rollback.reason).toBe(
      `${REFUSED_REDRAFT_RETIRE_REASON_PREFIX}:${WRITER_CONTRACT_VERSION}:draft-refused=empty-description:adopted-body-failed-support-check`,
    );
    const row = (await ResearchEntity.findOne({ slug: SLUG }).lean()) as any;
    expect(row.fullDescription).toBe(FALLBACK_BODY);
  });

  it('never retires an adopted body that still passes the support check, even when another body serves', async () => {
    await seed(SUPPORTED_BODY, true);
    const report = await apply();
    await connected();
    expect(report.refusedRedraftRetire).toEqual({
      keptSupported: 1,
      retiredWithFallback: 0,
      residualNoFallback: 0,
    });
    expect((await adoptedObservation(SUPPORTED_BODY)).superseded).toBe(false);
  });

  it('leaves an unsupported body serving and counts it as residual when nothing else would serve', async () => {
    await seed(UNSUPPORTED_BODY, false);
    const report = await apply();
    await connected();
    expect(report.refusedRedraftRetire).toEqual({
      keptSupported: 0,
      retiredWithFallback: 0,
      residualNoFallback: 1,
    });
    expect((await adoptedObservation(UNSUPPORTED_BODY)).superseded).toBe(false);
    const row = (await ResearchEntity.findOne({ slug: SLUG }).lean()) as any;
    expect(row.fullDescription).toBe(UNSUPPORTED_BODY);
  });

  it('plans the retire in a dry run without writing it', async () => {
    await seed(UNSUPPORTED_BODY, true);
    const report = await run([
      '--cache-only',
      `--slugs=${SLUG}`,
      '--retire-unsupported-refused-bodies',
    ]);
    await connected();
    expect(report.refusedRedraftRetire.retiredWithFallback).toBe(1);
    expect((await adoptedObservation(UNSUPPORTED_BODY)).superseded).toBe(false);
  });

  it('retires nothing without the flag', async () => {
    await seed(UNSUPPORTED_BODY, true);
    const report = await apply([]);
    await connected();
    expect(report.refusedRedraftRetire).toEqual({
      keptSupported: 0,
      retiredWithFallback: 0,
      residualNoFallback: 0,
    });
    expect((await adoptedObservation(UNSUPPORTED_BODY)).superseded).toBe(false);
  });
});

import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearC4Flags } from './c4FlagTestEnv';

import { Observation } from '../../models/observation';
import { appendObservations } from '../observationStore';
import {
  YaleResearchOfficialScraper,
  pageHoldsText,
  type YaleResearchDirectoryConfig,
} from '../sources/yaleResearchOfficialScraper';
import type { ObservationInput, ScraperContext } from '../types';

const DIRECTORY_URL = 'https://research.example.edu/cores';
const SECOND_PAGE_URL = `${DIRECTORY_URL}?page=1`;
const ALPHA_RECORD = 'https://research.example.edu/cores/fixture-alpha';
const BETA_RECORD = 'https://research.example.edu/cores/fixture-beta';
const GAMMA_RECORD = 'https://research.example.edu/cores/fixture-gamma';
const DELTA_RECORD = 'https://research.yale.edu/cores/fixture-delta';

const ALPHA_CARD =
  'The alpha core offers cryo-electron microscopy and sample preparation for structural biology groups.';
const BETA_CARD =
  'The beta core provides mass spectrometry for proteomics and metabolomics across campus.';
const GAMMA_CARD = 'The gamma core runs flow cytometry and cell sorting for immunology research.';
const DELTA_CARD = 'A short teaser for the delta core that its own page never repeats.';
const DELTA_ABOUT =
  'The delta core is a university-wide imaging facility with three sites, offering confocal and light-sheet microscopes.';

const card = (href: string, name: string, text: string) =>
  `<article class="card"><h2><a href="${href}">${name}</a></h2><p>${text}</p></article>`;

const FIRST_PAGE = `<main>${card('/cores/fixture-alpha', 'Fixture Alpha Core', ALPHA_CARD)}${card('/cores/fixture-beta', 'Fixture Beta Core', BETA_CARD)}</main>`;
const SECOND_PAGE = `<main>${card('/cores/fixture-gamma', 'Fixture Gamma Core', GAMMA_CARD)}${card(DELTA_RECORD, 'Fixture Delta Core', DELTA_CARD)}</main>`;

const DELTA_RECORD_PAGE = `<html><body><main><section><h2>About the core</h2><div class="wysiwyg"><p>${DELTA_ABOUT}</p><p>See also the map.</p></div></section><section><h2>Contacts</h2><p>A contact paragraph that is long enough to pass the length floor on its own.</p></section></main></body></html>`;

const recordPage = (summary: string) =>
  `<html><body><main><h1>Record</h1><div class="summary">${summary}</div><script>var x = 1;</script></main></body></html>`;

const PAGES: Record<string, string> = {
  [DIRECTORY_URL]: FIRST_PAGE,
  [SECOND_PAGE_URL]: SECOND_PAGE,
  [ALPHA_RECORD]: recordPage(ALPHA_CARD.replace('cryo-electron', 'cryo‑electron')),
  [BETA_RECORD]: recordPage('About the core. Our mission is to support research.'),
  [GAMMA_RECORD]: recordPage(`<p>${GAMMA_CARD}</p>`),
  [DELTA_RECORD]: DELTA_RECORD_PAGE,
};

const CONFIGS: YaleResearchDirectoryConfig[] = [
  {
    key: 'core-facilities',
    url: DIRECTORY_URL,
    paginated: true,
    parser: 'core-facilities',
  } as YaleResearchDirectoryConfig,
];

const runLane = async (emit: (obs: ObservationInput[]) => Promise<void>) => {
  const fetchHtml = vi.fn(async (url: string) => {
    if (url in PAGES) return PAGES[url];
    if (url.startsWith(DIRECTORY_URL) && url.includes('page=')) return '<main></main>';
    throw new Error(`unexpected fetch ${url}`);
  });
  const ctx: ScraperContext = {
    scrapeRunId: String(new mongoose.Types.ObjectId()),
    sourceId: String(new mongoose.Types.ObjectId()),
    sourceName: 'yale-research-official',
    sourceWeight: 0.85,
    options: { dryRun: false, useCache: false, release: false },
    emit: async (obs) => emit(Array.isArray(obs) ? obs : [obs]),
    log: vi.fn(),
  };
  await new YaleResearchOfficialScraper(CONFIGS, fetchHtml).run(ctx);
};

const descriptions = async () => {
  const emitted: ObservationInput[] = [];
  await runLane(async (obs) => {
    emitted.push(...obs);
  });
  return emitted.filter((obs) => obs.field === 'fullDescription');
};

const descriptionCitations = async () =>
  Object.fromEntries((await descriptions()).map((obs) => [obs.entityKey, obs.sourceUrl]));

describe('a research directory card cites its own record (#4031)', () => {
  it('cites the record page only when that page holds the card paragraph', async () => {
    const citations = await descriptionCitations();
    const keys = Object.keys(citations);
    const citationFor = (fragment: string) =>
      citations[keys.find((key) => key.includes(fragment)) as string];

    expect(citationFor('alpha')).toBe(ALPHA_RECORD);
    expect(citationFor('beta')).toBe(DIRECTORY_URL);
    expect(citationFor('gamma')).toBe(GAMMA_RECORD);
  });

  it('describes a research directory record from its own about section and cites that record', async () => {
    const delta = (await descriptions()).find((obs) => String(obs.entityKey).includes('delta'));

    expect(delta?.value).toBe(DELTA_ABOUT);
    expect(delta?.sourceUrl).toBe(DELTA_RECORD);
  });

  it('cites the fetched directory page rather than the first page for every other field', async () => {
    const emitted: ObservationInput[] = [];
    await runLane(async (obs) => {
      emitted.push(...obs);
    });
    const gammaName = emitted.find(
      (obs) => obs.field === 'name' && String(obs.entityKey).includes('gamma'),
    );
    expect(gammaName?.sourceUrl).toBe(SECOND_PAGE_URL);
  });

  it('matches the paragraph across markup, spacing and typographic punctuation only', () => {
    expect(pageHoldsText('<p>The core’s  focus</p>', "The core's focus")).toBe(true);
    expect(pageHoldsText('<p>The core focus</p>', "The core's focus")).toBe(false);
    expect(pageHoldsText('<script>The core focus</script>', 'The core focus')).toBe(false);
  });
});

describe('the store accepts a card cited to its record and still refuses a shared page (#4031)', () => {
  let replSet: MongoMemoryReplSet | undefined;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    clearC4Flags();
    await Observation.deleteMany({});
    await appendObservations(
      ['fixture-unrelated-one', 'fixture-unrelated-two'].map((entityKey) => ({
        entityType: 'researchEntity' as const,
        entityKey,
        field: 'fullDescription',
        value: 'An unrelated paragraph that another lane read from the directory page.',
        sourceUrl: DIRECTORY_URL,
      })),
      {
        scrapeRunId: String(new mongoose.Types.ObjectId()),
        sourceId: String(new mongoose.Types.ObjectId()),
        sourceName: 'fixture-other-lane',
        sourceWeight: 0.5,
        dryRun: false,
      },
    );
  });

  it('stores the descriptions cited to records and refuses the one cited to the directory', async () => {
    await runLane(async (obs) => {
      await appendObservations(obs, {
        scrapeRunId: String(new mongoose.Types.ObjectId()),
        sourceId: String(new mongoose.Types.ObjectId()),
        sourceName: 'yale-research-official',
        sourceWeight: 0.85,
        dryRun: false,
      });
    });
    const stored = await Observation.find({
      sourceName: 'yale-research-official',
      field: 'fullDescription',
    }).lean();
    const storedUrls = stored.map((row: any) => row.sourceUrl).sort();

    expect(storedUrls).toEqual([ALPHA_RECORD, GAMMA_RECORD, DELTA_RECORD].sort());
  });
});

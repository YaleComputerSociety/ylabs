import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return {
    ...actual,
    syncEntities: vi.fn(async () => {}),
    syncEntity: vi.fn(async () => true),
    deleteFromIndex: vi.fn(async () => {}),
  };
});

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return {
    ...actual,
    recomputeBrowseRankForEntities: vi.fn().mockResolvedValue({ updated: 0, indexSyncFailures: 0 }),
  };
});

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import { ScrapeRun } from '../../models/scrapeRun';
import { materializeFromRun } from '../entityMaterializer';
import { appendObservations } from '../observationStore';
import { CenterDirectorLLMExtractor } from '../sources/centerDirectorLLMExtractor';
import { CenterDirectorScraper } from '../sources/centerDirectorScraper';
import type { IScraper, ObservationInput, ScraperContext } from '../types';
import { clearC4Flags } from './c4FlagTestEnv';

const CENTER_SLUG = 'center-fixture-code-director';
const CENTER_NAME = 'Fixture Widget Center';
const CENTER_URL = 'https://widget-fixture.example.edu/';
const FIRST = 'Ada Fixture';
const SECOND = 'Bob Successor';

const afterAMoment = () => new Promise((resolve) => setTimeout(resolve, 5));

async function runLane(scraper: IScraper, sourceName: string): Promise<void> {
  await afterAMoment();
  const scrapeRunId = new mongoose.Types.ObjectId();
  await ScrapeRun.create({
    _id: scrapeRunId,
    sourceId: new mongoose.Types.ObjectId(),
    sourceName,
    status: 'running',
  });
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: String(scrapeRunId),
    sourceId: String(new mongoose.Types.ObjectId()),
    sourceName,
    sourceWeight: 0.6,
    options: { dryRun: false, useCache: false, release: false, exhaustive: true },
    emit: async (obs) => {
      emitted.push(...(Array.isArray(obs) ? obs : [obs]));
    },
    log: () => {},
  };
  await scraper.run(ctx);
  await appendObservations(emitted, {
    scrapeRunId: String(scrapeRunId),
    sourceId: String(new mongoose.Types.ObjectId()),
    sourceName,
    sourceWeight: 0.6,
    dryRun: false,
  });
  await materializeFromRun(String(scrapeRunId));
}

async function llmLaneNames(directorName: string): Promise<void> {
  await runLane(
    new CenterDirectorLLMExtractor({
      apiKey: 'test-key',
      fetchPage: async (url) => ({
        url,
        html: `<html><body>${'The fixture center does widget research. '.repeat(10)}</body></html>`,
      }),
      callLLM: async () => ({
        director: { name: directorName, title: 'Director', role: 'director' },
      }),
    }),
    'center-director-llm',
  );
}

async function codeLaneReads(body: string): Promise<void> {
  await runLane(
    new CenterDirectorScraper({
      fetchPage: async (url) => ({ url, html: `<html><body>${body}</body></html>` }),
      findTargets: async () => [{ slug: CENTER_SLUG, name: CENTER_NAME, websiteUrl: CENTER_URL }],
    }),
    'center-director',
  );
}

const directorCard = (name: string, title = 'Director') =>
  `<div class="card"><h3>${name}</h3><span>${title}</span></div>`;

const centerId = async () =>
  ((await ResearchEntity.findOne({ slug: CENTER_SLUG }).select('_id').lean()) as any)._id;

const leadEdges = async () =>
  (await RoleAssignment.find({
    'target.id': await centerId(),
    role: { $in: ['DIRECTOR', 'CO_DIRECTOR'] },
  }).lean()) as any[];

const currentLeads = async (): Promise<string[]> => {
  const current = (await leadEdges()).filter(
    (edge) => edge.state !== 'HISTORICAL' && edge.archived !== true,
  );
  const people = (await Researcher.find({
    _id: { $in: current.map((edge) => edge.personId) },
  }).lean()) as any[];
  const nameOf = new Map(people.map((person) => [String(person._id), String(person.displayName)]));
  return current
    .map((edge) => `${nameOf.get(String(edge.personId))}|${edge.rosterProvenance?.sourceName}`)
    .sort();
};

const liveLlmDirectorObservations = async () =>
  Observation.countDocuments({
    sourceName: 'center-director-llm',
    entityKey: CENTER_SLUG,
    field: /^inferredDirector/,
    superseded: { $ne: true },
    'rollback.rolledBackAt': { $exists: false },
  });

describe('center-director takes over from center-director-llm (#5296)', { timeout: 120000 }, () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    await Observation.syncIndexes();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    clearC4Flags();
    const db = mongoose.connection.db!;
    for (const name of [
      'observations',
      'research_entities',
      'research_entity_relationships',
      'researchers',
      'role_assignments',
      'scrape_runs',
    ]) {
      await db.collection(name).deleteMany({});
    }
    await ResearchEntity.create({
      slug: CENTER_SLUG,
      name: CENTER_NAME,
      kind: 'center',
      entityType: 'CENTER',
      websiteUrl: CENTER_URL,
      archived: false,
    });
    await Researcher.create([
      { displayName: FIRST, profile: { title: 'Professor of Synthetic Studies' } },
      { displayName: SECOND, profile: { title: 'Professor of Synthetic Studies' } },
    ]);
  });

  it('writes the director the page states as its own lead edge', async () => {
    await codeLaneReads(directorCard(FIRST));
    expect(await currentLeads()).toEqual([`${FIRST}|center-director`]);
  });

  it('ends an LLM edge for a different person once the code lane names a director', async () => {
    await llmLaneNames(FIRST);
    expect(await currentLeads()).toEqual([`${FIRST}|center-director-llm`]);

    await codeLaneReads(directorCard(SECOND));

    expect(await currentLeads()).toEqual([`${SECOND}|center-director`]);
    expect(await liveLlmDirectorObservations()).toBe(0);
  });

  it('ends an LLM edge when the code lane settles on nobody and the page does not state it', async () => {
    await llmLaneNames(FIRST);

    await codeLaneReads('<p>The fixture center studies widgets.</p>');

    expect(await currentLeads()).toEqual([]);
    expect(await liveLlmDirectorObservations()).toBe(0);
  });

  it('keeps an LLM edge the page still states when the code lane refuses a tie', async () => {
    await llmLaneNames(FIRST);

    await codeLaneReads(directorCard(FIRST) + directorCard(SECOND));

    expect(await currentLeads()).toEqual([`${FIRST}|center-director-llm`]);
  });

  it('never judges an LLM edge on a read whose page did not fetch', async () => {
    await llmLaneNames(FIRST);
    await runLane(
      new CenterDirectorScraper({
        fetchPage: async () => {
          throw new Error('503');
        },
        findTargets: async () => [{ slug: CENTER_SLUG, name: CENTER_NAME, websiteUrl: CENTER_URL }],
      }),
      'center-director',
    );

    expect(await currentLeads()).toEqual([`${FIRST}|center-director-llm`]);
  });

  it('ends its own edge only after two reads no longer state that person', async () => {
    await codeLaneReads(directorCard(FIRST));

    await codeLaneReads('<p>The fixture center studies widgets.</p>');
    expect(await currentLeads()).toEqual([`${FIRST}|center-director`]);

    await codeLaneReads('<p>The fixture center studies widgets.</p>');
    expect(await currentLeads()).toEqual([]);
  });

  it('prefers a faculty director over a director on the same page', async () => {
    await codeLaneReads(directorCard(FIRST) + directorCard(SECOND, 'Faculty Director'));
    expect(await currentLeads()).toEqual([`${SECOND}|center-director`]);
  });
});

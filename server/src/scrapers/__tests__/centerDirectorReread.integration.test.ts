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
import type { ObservationInput, ScraperContext } from '../types';
import { clearC4Flags } from './c4FlagTestEnv';

const SOURCE_NAME = 'center-director-llm';
const CENTER_SLUG = 'center-fixture-director-reread';
const CENTER_URL = 'https://fixture-director.example.edu/';
const FIRST = 'Ada Fixture';
const SECOND = 'Bob Successor';

const afterAMoment = () => new Promise((resolve) => setTimeout(resolve, 5));

async function readCenter(directorName: string | null): Promise<string[]> {
  await afterAMoment();
  const scrapeRunId = new mongoose.Types.ObjectId();
  await ScrapeRun.create({
    _id: scrapeRunId,
    sourceId: new mongoose.Types.ObjectId(),
    sourceName: SOURCE_NAME,
    status: 'running',
  });
  const emitted: ObservationInput[] = [];
  const fetched: string[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: String(scrapeRunId),
    sourceId: String(new mongoose.Types.ObjectId()),
    sourceName: SOURCE_NAME,
    sourceWeight: 0.6,
    options: { dryRun: false, useCache: false, release: false, exhaustive: true },
    emit: async (obs) => {
      emitted.push(...(Array.isArray(obs) ? obs : [obs]));
    },
    log: () => {},
  };
  const scraper = new CenterDirectorLLMExtractor({
    apiKey: 'test-key',
    fetchPage: async (url) => {
      fetched.push(url);
      return {
        url,
        html: `<html><body>${`${directorName ?? 'Nobody'} leads the fixture center. `.repeat(10)}</body></html>`,
      };
    },
    callLLM: async () => ({
      director: directorName ? { name: directorName, title: 'Director', role: 'director' } : null,
    }),
  });
  await scraper.run(ctx);
  await appendObservations(emitted, {
    scrapeRunId: String(scrapeRunId),
    sourceId: String(new mongoose.Types.ObjectId()),
    sourceName: SOURCE_NAME,
    sourceWeight: 0.6,
    dryRun: false,
  });
  await materializeFromRun(String(scrapeRunId));
  return fetched;
}

const centerId = async () =>
  ((await ResearchEntity.findOne({ slug: CENTER_SLUG }).select('_id').lean()) as any)._id;

const leadEdges = async () =>
  (await RoleAssignment.find({
    'target.id': await centerId(),
    role: { $in: ['DIRECTOR', 'CO_DIRECTOR'] },
  }).lean()) as any[];

const currentLeadNames = async (): Promise<string[]> => {
  const current = (await leadEdges()).filter(
    (edge) => edge.state !== 'HISTORICAL' && edge.archived !== true,
  );
  const people = (await Researcher.find({
    _id: { $in: current.map((edge) => edge.personId) },
  }).lean()) as any[];
  return people.map((person) => String(person.displayName)).sort();
};

describe(
  'center-director-llm re-reads the centers whose director it supplied (#4023)',
  { timeout: 120000 },
  () => {
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
        name: 'Fixture Director Center',
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

    it('re-reads a center whose only lead it supplied and refreshes that edge', async () => {
      await readCenter(FIRST);
      const [edge] = await leadEdges();
      expect(await currentLeadNames()).toEqual([FIRST]);

      const fetched = await readCenter(FIRST);

      expect(fetched.length).toBeGreaterThan(0);
      const [refreshed] = await leadEdges();
      expect(String(refreshed._id)).toBe(String(edge._id));
      expect(refreshed.rosterProvenance.observedAt.getTime()).toBeGreaterThan(
        edge.rosterProvenance.observedAt.getTime(),
      );
      expect(await currentLeadNames()).toEqual([FIRST]);
    });

    it('holds a different director until a second read agrees, then ends the old edge', async () => {
      await readCenter(FIRST);

      await readCenter(SECOND);
      expect(await currentLeadNames()).toEqual([FIRST]);

      await readCenter(SECOND);
      expect(await currentLeadNames()).toEqual([SECOND]);
      const ended = (await leadEdges()).filter((edge) => edge.state === 'HISTORICAL');
      expect(ended).toHaveLength(1);
    });

    it('changes nothing when a lone read names someone else between reads that agree', async () => {
      await readCenter(FIRST);
      await readCenter(SECOND);
      await readCenter(FIRST);
      await readCenter(SECOND);

      expect(await currentLeadNames()).toEqual([FIRST]);
      expect((await leadEdges()).filter((edge) => edge.state === 'HISTORICAL')).toHaveLength(0);
    });

    it('never ends the supplied edge on reads that name nobody', async () => {
      await readCenter(FIRST);
      await readCenter(null);
      await readCenter(null);

      expect(await currentLeadNames()).toEqual([FIRST]);
    });

    it('still skips a center whose lead another source supplied', async () => {
      await RoleAssignment.create({
        personId: (await Researcher.findOne({ displayName: SECOND }).lean())!._id,
        target: { kind: 'RESEARCH_ENTITY', id: await centerId() },
        role: 'DIRECTOR',
        state: 'CURRENT',
        confidence: 0.9,
        archived: false,
        rosterProvenance: { sourceName: 'centers-institutes-index', observedAt: new Date() },
      });

      expect(await readCenter(FIRST)).toEqual([]);
    });
  },
);

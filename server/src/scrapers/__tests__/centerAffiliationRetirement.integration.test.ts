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
import { ResearchEntityRelationship } from '../../models/researchEntityRelationship';
import { ScrapeRun } from '../../models/scrapeRun';
import { CENTER_AFFILIATION_RETIREMENT_REASON } from '../centerRosterRetirement';
import { materializeFromRun } from '../entityMaterializer';
import { appendObservations } from '../observationStore';
import { CenterAffiliationLLMExtractor } from '../sources/centerAffiliationLLMExtractor';
import { centerMemberRelationshipObservationsForEntityKey } from '../sources/centersInstitutesScraper';
import type { ObservationInput, ScraperContext } from '../types';
import { clearC4Flags } from './c4FlagTestEnv';

const AFFILIATION_SOURCE = 'center-affiliation-llm';
const ROSTER_SOURCE = 'centers-institutes-index';
const CENTER_SLUG = 'center-fixture-affiliation';
const CENTER_URL = 'https://fixture-affiliation.example.edu/';
const PEOPLE = ['Avery', 'Blair', 'Casey', 'Devon'].map((first) => `${first} Synthetic`);

const areaSlug = (name: string) => `faculty-research-area-${name.toLowerCase().replace(' ', '-')}`;

interface Read {
  pageNames: string[];
  modelNames?: string[];
  truncated?: boolean;
  modelFails?: boolean;
}

const pageHtml = (read: Read) => {
  const body = `${read.pageNames.map((name) => `<p>${name} is affiliated with the center.</p>`).join('')}<p>${'The fixture center studies synthetic methods. '.repeat(10)}</p>`;
  return `<html><body>${read.truncated ? body + 'x'.repeat(31_000) : body}</body></html>`;
};

const afterAMoment = () => new Promise((resolve) => setTimeout(resolve, 5));

async function appendAndMaterialize(
  emitted: ObservationInput[],
  sourceName: string,
): Promise<void> {
  const scrapeRunId = new mongoose.Types.ObjectId();
  await ScrapeRun.create({
    _id: scrapeRunId,
    sourceId: new mongoose.Types.ObjectId(),
    sourceName,
    status: 'running',
  });
  await appendObservations(emitted, {
    scrapeRunId: String(scrapeRunId),
    sourceId: String(new mongoose.Types.ObjectId()),
    sourceName,
    sourceWeight: 0.6,
    dryRun: false,
  });
  await materializeFromRun(String(scrapeRunId));
}

async function readCenter(read: Read): Promise<void> {
  await afterAMoment();
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: String(new mongoose.Types.ObjectId()),
    sourceId: String(new mongoose.Types.ObjectId()),
    sourceName: AFFILIATION_SOURCE,
    sourceWeight: 0.6,
    options: { dryRun: false, useCache: false, release: false },
    emit: async (obs) => {
      emitted.push(...(Array.isArray(obs) ? obs : [obs]));
    },
    log: () => {},
  };
  const scraper = new CenterAffiliationLLMExtractor({
    apiKey: 'test-key',
    centerFinder: async () => [
      { slug: CENTER_SLUG, name: 'Fixture Affiliation Center', websiteUrl: CENTER_URL },
    ],
    fetchPage: async (url) => ({ url, html: pageHtml(read) }),
    callLLM: async () => {
      if (read.modelFails) throw new Error('model unavailable');
      return {
        affiliatedPeople: (read.modelNames ?? read.pageNames).map((name) => ({ name })),
      };
    },
  });
  await scraper.run(ctx);
  await appendAndMaterialize(emitted, AFFILIATION_SOURCE);
}

const liveAffiliations = async (): Promise<string[]> => {
  const center = (await ResearchEntity.findOne({ slug: CENTER_SLUG }).lean()) as any;
  const rows = (await ResearchEntityRelationship.find({
    sourceResearchEntityId: center._id,
    archived: { $ne: true },
  }).lean()) as any[];
  const targets = (await ResearchEntity.find({
    _id: { $in: rows.map((row) => row.targetResearchEntityId) },
  }).lean()) as any[];
  return targets.map((target) => String(target.slug)).sort();
};

const without = (name: string) => PEOPLE.filter((person) => person !== name);

describe(
  'center-affiliation-llm retires a claim two complete reads of the page omit (#4022)',
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
      await ResearchEntity.create([
        {
          slug: CENTER_SLUG,
          name: 'Fixture Affiliation Center',
          kind: 'center',
          entityType: 'CENTER',
          websiteUrl: CENTER_URL,
          archived: false,
        },
        ...PEOPLE.map((name) => ({
          slug: areaSlug(name),
          name: `${name} Research`,
          kind: 'individual',
          entityType: 'FACULTY_RESEARCH_AREA',
          archived: false,
        })),
      ]);
    });

    it('keeps a claim one complete read omits and retires it after the second', async () => {
      await readCenter({ pageNames: PEOPLE });
      expect(await liveAffiliations()).toEqual(PEOPLE.map(areaSlug).sort());

      await readCenter({ pageNames: without('Devon Synthetic') });
      expect(await liveAffiliations()).toContain(areaSlug('Devon Synthetic'));

      await readCenter({ pageNames: without('Devon Synthetic') });
      expect(await liveAffiliations()).toEqual(without('Devon Synthetic').map(areaSlug).sort());

      const retired = (await Observation.find({
        sourceName: AFFILIATION_SOURCE,
        entityKey: { $regex: `^${CENTER_SLUG}:${areaSlug('Devon Synthetic')}:` },
      }).lean()) as any[];
      expect(retired.length).toBeGreaterThan(0);
      for (const row of retired) {
        expect(row.superseded).toBe(true);
        expect(row.rollback?.reason).toBe(CENTER_AFFILIATION_RETIREMENT_REASON);
      }
    });

    it('never retires a claim the page still names when the model omits it', async () => {
      await readCenter({ pageNames: PEOPLE });
      await readCenter({ pageNames: PEOPLE, modelNames: without('Devon Synthetic') });
      await readCenter({ pageNames: PEOPLE, modelNames: without('Devon Synthetic') });
      await readCenter({ pageNames: PEOPLE, modelNames: without('Devon Synthetic') });

      expect(await liveAffiliations()).toEqual(PEOPLE.map(areaSlug).sort());
    });

    it('counts neither a truncated page nor a failed model call as a read', async () => {
      await readCenter({ pageNames: PEOPLE });
      await readCenter({ pageNames: without('Devon Synthetic'), truncated: true });
      await readCenter({ pageNames: without('Devon Synthetic'), modelFails: true });
      await readCenter({ pageNames: without('Devon Synthetic') });

      expect(await liveAffiliations()).toContain(areaSlug('Devon Synthetic'));
    });

    it('never writes a name the page does not state', async () => {
      await readCenter({
        pageNames: without('Devon Synthetic'),
        modelNames: PEOPLE,
      });

      expect(await liveAffiliations()).toEqual(without('Devon Synthetic').map(areaSlug).sort());
    });

    it('keeps a relationship another source still asserts', async () => {
      await readCenter({ pageNames: PEOPLE });
      await appendAndMaterialize(
        centerMemberRelationshipObservationsForEntityKey(
          CENTER_SLUG,
          { name: 'Devon Synthetic', role: 'core-faculty' },
          `${CENTER_URL}people`,
        ),
        ROSTER_SOURCE,
      );
      await readCenter({ pageNames: without('Devon Synthetic') });
      await readCenter({ pageNames: without('Devon Synthetic') });

      expect(await liveAffiliations()).toContain(areaSlug('Devon Synthetic'));
      expect(
        await Observation.countDocuments({
          sourceName: AFFILIATION_SOURCE,
          entityKey: { $regex: `^${CENTER_SLUG}:${areaSlug('Devon Synthetic')}:` },
          superseded: { $ne: true },
        }),
      ).toBe(0);
    });

    it('freezes a center when two reads omit more than half of its claims', async () => {
      await readCenter({ pageNames: PEOPLE });
      await readCenter({ pageNames: ['Avery Synthetic'] });
      await readCenter({ pageNames: ['Avery Synthetic'] });

      expect(await liveAffiliations()).toEqual(PEOPLE.map(areaSlug).sort());
    });
  },
);

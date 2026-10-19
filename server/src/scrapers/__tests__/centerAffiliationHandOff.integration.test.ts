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
import { Researcher } from '../../models/researcher';
import { ScrapeRun } from '../../models/scrapeRun';
import { materializeFromRun } from '../entityMaterializer';
import { appendObservations } from '../observationStore';
import { CenterAffiliationLLMExtractor } from '../sources/centerAffiliationLLMExtractor';
import { CenterAffiliationRosterScraper } from '../sources/centerAffiliationRosterScraper';
import { centerMemberRelationshipObservationsForEntityKey } from '../sources/centersInstitutesScraper';
import type { IScraper, ObservationInput, ScraperContext } from '../types';
import { clearC4Flags } from './c4FlagTestEnv';

const CENTER_SLUG = 'center-fixture-affiliation';
const CENTER_NAME = 'Fixture Lattice Center';
const CENTER_URL = 'https://lattice-fixture.example.edu/';
const ROSTER_URL = 'https://lattice-fixture.example.edu/people/';
const LAB_URL = 'https://lattice-fixture.example.edu/prism-lab/';
const KEPT = 'Ada Fixture';
const DROPPED = 'Bob Fixture';
const fraSlug = (name: string) =>
  `faculty-research-area-${name.toLowerCase().replace(/\s+/g, '-')}`;

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

async function llmLaneNames(...names: string[]): Promise<void> {
  await runLane(
    new CenterAffiliationLLMExtractor({
      apiKey: 'test-key',
      fetchPage: async (url) => ({
        url,
        html: `<html><body>${names.join(' and ')} ${'study lattices at the fixture center. '.repeat(8)}</body></html>`,
      }),
      callLLM: async () => ({ affiliatedPeople: names.map((name) => ({ name })) }),
    }),
    'center-affiliation-llm',
  );
}

const profileCard = (name: string) => `
  <article class="profile-grid-item">
    <a class="profile-grid-item__link-details" href="/profile/${name.toLowerCase().replace(/\s+/g, '-')}/">
      <span class="profile-grid-item__name">${name}</span></a>
    <p class="profile-grid-item__title">Professor of Synthetic Studies</p>
  </article>`;

const labCard = `
  <div class="custom-card-collection"><h2 class="custom-card-collection__heading">Our labs</h2>
    <ul><li class="custom-card"><h3 class="custom-card__heading">
      <a class="custom-card__heading-link" href="${LAB_URL}">Prism Lab</a></h3></li></ul>
  </div>`;

const faculty = (...names: string[]) =>
  `<section><h2>Faculty</h2>${names.map(profileCard).join('')}</section>`;

async function codeLaneReads(body: string, fetchFails = false): Promise<void> {
  await runLane(
    new CenterAffiliationRosterScraper({
      fetchPage: async () => {
        if (fetchFails) throw new Error('503');
        return { url: ROSTER_URL, html: `<html><body><main>${body}</main></body></html>` };
      },
      findTargets: async () => [{ slug: CENTER_SLUG, name: CENTER_NAME, websiteUrl: CENTER_URL }],
    }),
    'center-affiliation-roster',
  );
}

const targetSlugById = async (): Promise<Map<string, string>> => {
  const rows = (await ResearchEntity.find({}).select('_id slug').lean()) as any[];
  return new Map(rows.map((row) => [String(row._id), String(row.slug)]));
};

const liveEdges = async (): Promise<string[]> => {
  const center = (await ResearchEntity.findOne({ slug: CENTER_SLUG }).lean()) as any;
  const slugs = await targetSlugById();
  const rows = (await ResearchEntityRelationship.find({
    sourceResearchEntityId: center._id,
    archived: { $ne: true },
  }).lean()) as any[];
  return rows.map((row) => slugs.get(String(row.targetResearchEntityId)) ?? '?').sort();
};

const edgeSourceUrl = async (targetSlug: string): Promise<string> => {
  const center = (await ResearchEntity.findOne({ slug: CENTER_SLUG }).lean()) as any;
  const target = (await ResearchEntity.findOne({ slug: targetSlug }).lean()) as any;
  const row = (await ResearchEntityRelationship.findOne({
    sourceResearchEntityId: center._id,
    targetResearchEntityId: target._id,
  }).lean()) as any;
  return String(row?.sourceUrl ?? '');
};

const liveLlmRelationshipObservations = async () =>
  Observation.countDocuments({
    sourceName: 'center-affiliation-llm',
    entityType: 'researchEntityRelationship',
    superseded: { $ne: true },
    'rollback.rolledBackAt': { $exists: false },
  });

describe(
  'center-affiliation-roster takes over from center-affiliation-llm (#5296)',
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
        name: CENTER_NAME,
        kind: 'center',
        entityType: 'CENTER',
        websiteUrl: CENTER_URL,
        archived: false,
      });
      for (const name of [KEPT, DROPPED]) {
        await Researcher.create({ displayName: name, profileLinks: [], archived: false });
        await ResearchEntity.create({
          slug: fraSlug(name),
          name: `${name} Research`,
          kind: 'individual',
          entityType: 'FACULTY_RESEARCH_AREA',
          archived: false,
        });
      }
      await ResearchEntity.create({
        slug: 'prism-lab-row',
        name: 'Prism Lab',
        kind: 'lab',
        entityType: 'LAB',
        websiteUrl: LAB_URL,
        archived: false,
      });
    });

    it('writes the people and the lab card its read lists, the lab by its site alone', async () => {
      await codeLaneReads(faculty(KEPT) + labCard);
      expect(await liveEdges()).toEqual([fraSlug(KEPT), 'prism-lab-row'].sort());
    });

    it('ends an LLM affiliation its read does not list and retires that lane there', async () => {
      await llmLaneNames(KEPT, DROPPED);
      expect(await liveEdges()).toEqual([fraSlug(DROPPED), fraSlug(KEPT)].sort());

      await codeLaneReads(faculty(KEPT));

      expect(await liveEdges()).toEqual([fraSlug(KEPT)]);
      expect(await liveLlmRelationshipObservations()).toBe(0);
    });

    it('re-attributes a same-target affiliation to the code lane read', async () => {
      await llmLaneNames(KEPT);
      expect(await edgeSourceUrl(fraSlug(KEPT))).toBe(CENTER_URL);

      await codeLaneReads(faculty(KEPT));

      expect(await liveEdges()).toEqual([fraSlug(KEPT)]);
      expect(await edgeSourceUrl(fraSlug(KEPT))).toBe(ROSTER_URL);
      expect(await liveLlmRelationshipObservations()).toBe(0);
    });

    it('keeps an ended LLM affiliation that another lane still asserts', async () => {
      await llmLaneNames(KEPT, DROPPED);
      await appendObservations(
        centerMemberRelationshipObservationsForEntityKey(
          CENTER_SLUG,
          { name: DROPPED, role: 'core-faculty' },
          ROSTER_URL,
        ),
        {
          scrapeRunId: String(new mongoose.Types.ObjectId()),
          sourceId: String(new mongoose.Types.ObjectId()),
          sourceName: 'centers-institutes-index',
          sourceWeight: 0.8,
          dryRun: false,
        },
      );

      await codeLaneReads(faculty(KEPT));

      expect(await liveEdges()).toEqual([fraSlug(DROPPED), fraSlug(KEPT)].sort());
      expect(await liveLlmRelationshipObservations()).toBe(0);
    });

    it('never judges an LLM affiliation on a read that lists nobody', async () => {
      await llmLaneNames(KEPT, DROPPED);

      await codeLaneReads(
        `<p>${'The fixture center studies lattices across many fields. '.repeat(6)}</p>`,
      );

      expect(await liveEdges()).toEqual([fraSlug(DROPPED), fraSlug(KEPT)].sort());
      expect(await liveLlmRelationshipObservations()).toBeGreaterThan(0);
    });

    it('never judges an LLM affiliation on a read whose page did not fetch', async () => {
      await llmLaneNames(KEPT, DROPPED);

      await codeLaneReads('', true);

      expect(await liveEdges()).toEqual([fraSlug(DROPPED), fraSlug(KEPT)].sort());
    });

    it('ends its own affiliation only after two reads no longer list it', async () => {
      const unlinked = ['Cleo Fixture', 'Dov Fixture'];
      await codeLaneReads(faculty(KEPT, DROPPED, ...unlinked));

      await codeLaneReads(faculty(KEPT, ...unlinked));
      expect(await liveEdges()).toEqual([fraSlug(DROPPED), fraSlug(KEPT)].sort());

      await codeLaneReads(faculty(KEPT, ...unlinked));
      expect(await liveEdges()).toEqual([fraSlug(KEPT)]);
    });
  },
);

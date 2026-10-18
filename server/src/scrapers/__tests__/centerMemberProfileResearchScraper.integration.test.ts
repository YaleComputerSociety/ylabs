import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { RoleAssignment } from '../../models/roleAssignment';
import { gatherCoverageSnippets } from '../coverageSynthesis';
import { appendObservations } from '../observationStore';
import {
  CenterMemberProfileResearchScraper,
  type CenterMemberProfileLaneConfig,
} from '../sources/centerMemberProfileResearchScraper';
import { fdsUsersGridExtractor, type CenterConfig } from '../sources/centersInstitutesScraper';
import type { ObservationInput, ScraperContext } from '../types';
import { fdsMemberProfileExtractor } from '../utils/centerMemberProfileResearch';
import { clearC4Flags } from './c4FlagTestEnv';

const SOURCE_NAME = 'center-member-profile-research';
const ROSTER_URL = 'https://fds.yale.edu/people/';
const JOINED = 'https://fds.yale.edu/people/zz0001/';
const NAME_ONLY = 'https://fds.yale.edu/people/zz0002/';
const STATEMENT =
  'The member develops statistical methods for synthetic network data and studies how sampling shapes inference.';
const REVISED =
  'The member builds learning algorithms for synthetic graph data and studies their guarantees under noise.';

const card = (url: string, name: string) =>
  `<div class="grid__user"><a class="grid__user__link" href="${url}"><h3 class="grid__user__title">${name}</h3></a></div>`;
const rosterHtml = `<html><body>${card(JOINED, 'Fixture Joined')}${card(NAME_ONLY, 'Fixture Named')}</body></html>`;
const profileHtml = (statement?: string) => `<html><body><div class="author-description">
  <p>A synthetic member biography that is long enough to be kept as evidence text.</p>
  ${statement ? `<p><strong>What do you do with Data Science?</strong></p><p>${statement}</p>` : ''}
</div></body></html>`;

const centerConfig: CenterConfig = {
  centerKey: 'fds',
  centerName: 'Synthetic Data Science Institute',
  schoolName: '',
  kind: 'institute',
  url: ROSTER_URL,
  homeUrl: 'https://fds.yale.edu/',
  extractor: fdsUsersGridExtractor,
};
const laneConfigs: CenterMemberProfileLaneConfig[] = [
  { centerKey: 'fds', profileExtractor: fdsMemberProfileExtractor },
];

async function runLane(pages: Record<string, string>): Promise<ObservationInput[]> {
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: String(new mongoose.Types.ObjectId()),
    sourceId: String(new mongoose.Types.ObjectId()),
    sourceName: SOURCE_NAME,
    sourceWeight: 0.8,
    options: { dryRun: false, useCache: false, release: false },
    emit: async (obs) => {
      emitted.push(...(Array.isArray(obs) ? obs : [obs]));
    },
    log: () => {},
  };
  const scraper = new CenterMemberProfileResearchScraper(
    laneConfigs,
    [centerConfig],
    async (url) => {
      if (!(url in pages)) throw new Error(`unexpected fetch ${url}`);
      return pages[url];
    },
  );
  await scraper.run(ctx);
  await appendObservations(emitted, { ...ctx, dryRun: false });
  return emitted;
}

describe(
  'center-member-profile-research attaches profile text to the member row',
  { timeout: 120000 },
  () => {
    let replSet: MongoMemoryReplSet;
    let rowId: mongoose.Types.ObjectId;

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
      for (const name of ['observations', 'research_entities', 'role_assignments']) {
        await db.collection(name).deleteMany({});
      }
      const center = await ResearchEntity.create({
        slug: 'synthetic-institute',
        name: 'Synthetic Data Science Institute',
        kind: 'institute',
        entityType: 'INSTITUTE',
        archived: false,
      });
      const row = await ResearchEntity.create({
        slug: 'synthetic-member-row',
        name: 'Synthetic member row',
        kind: 'individual',
        entityType: 'FACULTY_RESEARCH_AREA',
        archived: false,
      });
      rowId = row._id as mongoose.Types.ObjectId;
      const joinedPerson = new mongoose.Types.ObjectId();
      const namedPerson = new mongoose.Types.ObjectId();
      const membership = (
        personId: mongoose.Types.ObjectId,
        profileUrl: string,
        identityBasis?: string,
      ) =>
        RoleAssignment.create({
          personId,
          target: { kind: 'RESEARCH_ENTITY', id: center._id },
          role: 'CORE_FACULTY',
          state: 'CURRENT',
          confidence: 0.8,
          rosterProvenance: {
            sourceName: 'centers-institutes-index',
            sourceUrl: ROSTER_URL,
            profileUrl,
            ...(identityBasis ? { identityBasis } : {}),
          },
        });
      await membership(joinedPerson, JOINED, 'identity-evidence');
      await membership(namedPerson, NAME_ONLY);
      for (const personId of [joinedPerson, namedPerson]) {
        await RoleAssignment.create({
          personId,
          target: { kind: 'RESEARCH_ENTITY', id: personId === joinedPerson ? row._id : center._id },
          role: personId === joinedPerson ? 'PI' : 'DIRECTOR',
          state: 'CURRENT',
          confidence: 0.9,
        });
      }
    });

    const liveTexts = async () =>
      (await Observation.find({
        sourceName: SOURCE_NAME,
        entityId: rowId,
        superseded: false,
      })
        .select('field value sourceUrl sourceName')
        .lean()) as any[];

    it('joins only the identity-proven member and gives the writer the statement as evidence', async () => {
      const emitted = await runLane({
        [ROSTER_URL]: rosterHtml,
        [JOINED]: profileHtml(STATEMENT),
        [NAME_ONLY]: profileHtml(STATEMENT),
      });
      expect(new Set(emitted.map((obs) => obs.entityKey))).toEqual(
        new Set(['synthetic-member-row']),
      );
      const live = await liveTexts();
      expect(live.find((obs) => obs.field === 'researchSummary')?.value).toBe(STATEMENT);
      expect(gatherCoverageSnippets(live).map((snippet) => snippet.text)).toContain(STATEMENT);
    });

    it('keeps one live statement per row when the page changes, and retires it when the page drops it', async () => {
      const pages = { [ROSTER_URL]: rosterHtml, [NAME_ONLY]: profileHtml() };
      await runLane({ ...pages, [JOINED]: profileHtml(STATEMENT) });
      await runLane({ ...pages, [JOINED]: profileHtml(REVISED) });
      let statements = (await liveTexts()).filter((obs) => obs.field === 'researchSummary');
      expect(statements.map((obs) => obs.value)).toEqual([REVISED]);

      await runLane({ ...pages, [JOINED]: profileHtml() });
      statements = (await liveTexts()).filter((obs) => obs.field === 'researchSummary');
      expect(statements.map((obs) => obs.value)).toEqual(['']);
      expect(gatherCoverageSnippets(statements)).toEqual([]);
    });

    it('retracts nothing when a profile page cannot be read', async () => {
      await runLane({
        [ROSTER_URL]: rosterHtml,
        [JOINED]: profileHtml(STATEMENT),
        [NAME_ONLY]: profileHtml(),
      });
      await runLane({ [ROSTER_URL]: rosterHtml, [NAME_ONLY]: profileHtml() });
      const statements = (await liveTexts()).filter((obs) => obs.field === 'researchSummary');
      expect(statements.map((obs) => obs.value)).toEqual([STATEMENT]);
    });
  },
);

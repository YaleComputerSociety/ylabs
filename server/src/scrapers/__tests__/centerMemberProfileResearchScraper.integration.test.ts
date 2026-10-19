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
import type { ObservationInput, ScraperContext } from '../types';
import {
  cowlesPersonProfileExtractor,
  fdsMemberProfileExtractor,
} from '../utils/centerMemberProfileResearch';
import { clearC4Flags } from './c4FlagTestEnv';

const SOURCE_NAME = 'center-member-profile-research';
const ROSTER_URL = 'https://fds.yale.edu/people/';
const JOINED = 'https://fds.yale.edu/people/zz0001/';
const NAME_ONLY = 'https://fds.yale.edu/people/zz0002/';
const UNLED = 'https://fds.yale.edu/people/zz0003/';
const COWLES = 'https://cowles.yale.edu/people/synthetic-member';
const STATEMENT =
  'The member develops statistical methods for synthetic network data and studies how sampling shapes inference.';
const REVISED =
  'The member builds learning algorithms for synthetic graph data and studies their guarantees under noise.';

const profileHtml = (statement?: string) => `<html><body><div class="author-description">
  <p>A synthetic member biography that is long enough to be kept as evidence text.</p>
  ${statement ? `<p><strong>What do you do with Data Science?</strong></p><p>${statement}</p>` : ''}
</div></body></html>`;

const cowlesProfileHtml = (body: string) =>
  `<html><body><article class="node node--person"><div class="node__body"><p>${body}</p></div></article></body></html>`;
const laneConfigs: CenterMemberProfileLaneConfig[] = [
  { profileHost: 'fds.yale.edu', profileExtractor: fdsMemberProfileExtractor },
  { profileHost: 'cowles.yale.edu', profileExtractor: cowlesPersonProfileExtractor },
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
  const scraper = new CenterMemberProfileResearchScraper(laneConfigs, async (url) => {
    if (!(url in pages)) throw new Error(`unexpected fetch ${url}`);
    return pages[url];
  });
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
    let joinedPerson: mongoose.Types.ObjectId;
    let centerId: mongoose.Types.ObjectId;
    const membership = (
      personId: mongoose.Types.ObjectId,
      profileUrl: string,
      identityBasis?: string,
    ) =>
      RoleAssignment.create({
        personId,
        target: { kind: 'RESEARCH_ENTITY', id: centerId },
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
      joinedPerson = new mongoose.Types.ObjectId();
      const namedPerson = new mongoose.Types.ObjectId();
      centerId = center._id as mongoose.Types.ObjectId;
      await membership(joinedPerson, JOINED, 'identity-evidence');
      await membership(namedPerson, NAME_ONLY);
      await membership(new mongoose.Types.ObjectId(), UNLED, 'identity-evidence');
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
      const pages = { [NAME_ONLY]: profileHtml(), [UNLED]: profileHtml() };
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
        [JOINED]: profileHtml(STATEMENT),
        [NAME_ONLY]: profileHtml(),
        [UNLED]: profileHtml(),
      });
      await runLane({ [NAME_ONLY]: profileHtml(), [UNLED]: profileHtml() });
      const statements = (await liveTexts()).filter((obs) => obs.field === 'researchSummary');
      expect(statements.map((obs) => obs.value)).toEqual([STATEMENT]);
    });

    it('retracts nothing when a profile page answers without the profile block', async () => {
      const pages = { [NAME_ONLY]: profileHtml(), [UNLED]: profileHtml() };
      await runLane({ ...pages, [JOINED]: profileHtml(STATEMENT) });
      await runLane({ ...pages, [JOINED]: '<html><body><p>Please wait.</p></body></html>' });
      const statements = (await liveTexts()).filter((obs) => obs.field === 'researchSummary');
      expect(statements.map((obs) => obs.value)).toEqual([STATEMENT]);
    });

    it('retracts a row once its page no longer joins to it by identity', async () => {
      const pages = {
        [JOINED]: profileHtml(STATEMENT),
        [NAME_ONLY]: profileHtml(),
        [UNLED]: profileHtml(),
      };
      await runLane(pages);
      await RoleAssignment.updateMany(
        { personId: joinedPerson, 'rosterProvenance.profileUrl': JOINED },
        { $set: { state: 'HISTORICAL' } },
      );
      await runLane(pages);
      const live = await liveTexts();
      expect(live.map((obs) => obs.value)).toEqual(['', '']);
      expect(gatherCoverageSnippets(live)).toEqual([]);
    });

    it('fails rather than retracting when no identity-proven membership links a profile host', async () => {
      const pages = {
        [JOINED]: profileHtml(STATEMENT),
        [NAME_ONLY]: profileHtml(),
        [UNLED]: profileHtml(),
      };
      await runLane(pages);
      await RoleAssignment.updateMany(
        { 'rosterProvenance.sourceName': 'centers-institutes-index' },
        { $set: { state: 'HISTORICAL' } },
      );
      await expect(runLane(pages)).rejects.toThrow();
      const statements = (await liveTexts()).filter((obs) => obs.field === 'researchSummary');
      expect(statements.map((obs) => obs.value)).toEqual([STATEMENT]);
    });

    it('keeps one profile for a row that two of its member centers both describe', async () => {
      await membership(joinedPerson, COWLES, 'identity-evidence');
      const longer = `${STATEMENT} The member also studies how synthetic panels change estimates of policy effects over long horizons.`;
      await runLane({
        [JOINED]: profileHtml(STATEMENT),
        [NAME_ONLY]: profileHtml(),
        [UNLED]: profileHtml(),
        [COWLES]: cowlesProfileHtml(longer),
      });
      const live = await liveTexts();
      expect(new Set(live.map((obs) => obs.sourceUrl))).toEqual(new Set([COWLES]));
      expect(live.find((obs) => obs.field === 'bio')?.value).toBe(longer);
    });
  },
);

import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DirectoryRemoval } from '../../models/directoryRemoval';
import { Observation } from '../../models/observation';
import { Researcher } from '../../models/researcher';
import { ScrapeRun } from '../../models/scrapeRun';
import { Source } from '../../models/source';
import { DirectoryRemovalUnavailableError } from '../../services/directoryRemovalMatcher';
import {
  DIRECTORY_REMOVAL_KEY_ENV,
  directoryRemovalDigest,
  type DirectoryRemovalKind,
} from '../../utils/directoryRemovalDigest';
import { directoryRemovalObservationRun } from '../directoryRemovalObservationGuard';
import { appendObservations } from '../observationStore';
import { ScraperOrchestrator } from '../orchestrator';
import {
  CentersInstitutesScraper,
  type CenterConfig,
  type CenterMember,
} from '../sources/centersInstitutesScraper';
import type { ObservationInput } from '../types';

const KEY = 'synthetic-directory-removal-key-0123456789';
const SOURCE_NAME = 'centers-institutes-index';

const member = (first: string): CenterMember => ({
  name: `${first} Synthetic`,
  role: 'core-faculty',
  profileUrl: `https://fixture-center.example.edu/people/${first.toLowerCase()}-synthetic`,
});

const REMOVED = member('Casey');
const NAMESAKE_ONLY = member('Emery');
const ROSTER = [
  member('Avery'),
  member('Blair'),
  REMOVED,
  { ...NAMESAKE_ONLY, profileUrl: undefined },
];

const config: CenterConfig = {
  centerKey: 'fixture-synthetic',
  centerName: 'Fixture Synthetic Center',
  schoolName: '',
  kind: 'center',
  url: 'https://fixture-center.example.edu/people',
  homeUrl: 'https://fixture-center.example.edu/',
  paginated: false,
  extractor: (html: string) => ({ members: JSON.parse(html) as CenterMember[] }),
};

const recordRemoval = (kind: DirectoryRemovalKind, value: string) =>
  DirectoryRemoval.create({
    digest: directoryRemovalDigest(KEY, kind, value),
    kind,
    recordedAt: new Date(),
  });

const runLane = async () => {
  const orchestrator = new ScraperOrchestrator();
  orchestrator.register(
    new CentersInstitutesScraper([config], null, async () => JSON.stringify(ROSTER)),
  );
  const { runId } = await orchestrator.run(SOURCE_NAME, {
    dryRun: false,
    useCache: false,
    release: false,
    ignoreWorkPlanner: true,
  });
  return ScrapeRun.findById(runId).lean<{ metrics?: { removedByRequest?: number } }>();
};

const memberObservations = (first: string) =>
  Observation.countDocuments({
    entityType: 'researchGroupMember',
    entityKey: new RegExp(`:${first.toLowerCase()}-synthetic$`),
  });

const appendUnderOneRun = async (batches: ObservationInput[][]) => {
  const run = directoryRemovalObservationRun();
  const results = [];
  for (const batch of batches) {
    results.push(
      await appendObservations(batch, {
        scrapeRunId: String(new mongoose.Types.ObjectId()),
        sourceId: String(new mongoose.Types.ObjectId()),
        sourceName: 'synthetic-lane',
        sourceWeight: 0.8,
        dryRun: false,
        directoryRemovalGuard: run.guard,
      }),
    );
  }
  return { results, removedByRequest: run.removedByRequest() };
};

describe(
  'no lane stores a new observation about a person removed from the directory (#4160)',
  {
    timeout: 120000,
  },
  () => {
    let replSet: MongoMemoryReplSet;

    beforeAll(async () => {
      replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
      await mongoose.connect(replSet.getUri());
      await Observation.syncIndexes();
      await DirectoryRemoval.syncIndexes();
    });

    afterAll(async () => {
      await mongoose.disconnect();
      await replSet?.stop();
    });

    beforeEach(async () => {
      vi.stubEnv(DIRECTORY_REMOVAL_KEY_ENV, KEY);
      const db = mongoose.connection.db;
      if (!db) throw new Error('no db');
      for (const name of [
        'observations',
        'researchers',
        'sources',
        'scrape_runs',
        'directory_removals',
      ]) {
        await db.collection(name).deleteMany({});
      }
      await Source.create({ name: SOURCE_NAME, displayName: 'Centers index', defaultWeight: 0.8 });
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('stores every listed member while the removal list is empty', async () => {
      const run = await runLane();

      expect(run?.metrics?.removedByRequest).toBeUndefined();
      expect(await memberObservations('Casey')).toBeGreaterThan(0);
    });

    it('writes no observation of a removed member on either of two runs, and counts each refusal', async () => {
      await recordRemoval('profile_url', REMOVED.profileUrl!);

      const first = await runLane();
      expect(await memberObservations('Casey')).toBe(0);
      const second = await runLane();

      expect(await memberObservations('Casey')).toBe(0);
      expect(first?.metrics?.removedByRequest).toBeGreaterThan(0);
      expect(second?.metrics?.removedByRequest).toBe(first?.metrics?.removedByRequest);
      expect(await memberObservations('Blair')).toBeGreaterThan(0);
    });

    it('keeps a member matched only by a removed name', async () => {
      await recordRemoval('name', 'Emery Synthetic');

      const run = await runLane();

      expect(await memberObservations('Emery')).toBeGreaterThan(0);
      expect(run?.metrics?.removedByRequest).toBeUndefined();
    });

    it('refuses the run when entries exist and no key is configured', async () => {
      await recordRemoval('profile_url', REMOVED.profileUrl!);
      vi.stubEnv(DIRECTORY_REMOVAL_KEY_ENV, '');

      await expect(runLane()).rejects.toThrow(DirectoryRemovalUnavailableError);
      expect(await Observation.countDocuments({ entityType: 'researchGroupMember' })).toBe(0);
    });

    it('refuses a user subject by its key or a field, in later batches of the same run too', async () => {
      await recordRemoval('netid', 'zz9201');
      const user = (
        field: string,
        value: unknown,
        entityKey = 'netid:zz9201',
      ): ObservationInput => ({
        entityType: 'user',
        entityKey,
        field,
        value,
        sourceUrl: 'https://example.edu/directory/zz9201',
      });

      const deptKey = 'dept:fixture:gray-synthetic';
      const { removedByRequest } = await appendUnderOneRun([
        [user('displayName', 'Gray Synthetic')],
        [user('netid', 'zz9201', deptKey), user('displayName', 'Gray Synthetic', deptKey)],
        [user('title', 'Professor', deptKey)],
        [user('displayName', 'Hollis Synthetic', 'netid:zz9202')],
      ]);

      expect(removedByRequest).toBe(4);
      expect(
        await Observation.countDocuments({ entityType: 'user', entityKey: /zz9201|gray/ }),
      ).toBe(0);
      expect(
        await Observation.countDocuments({ entityType: 'user', entityKey: 'netid:zz9202' }),
      ).toBe(1);
    });

    it('drops only the row fields that point at a removed person', async () => {
      const removed = await Researcher.create({
        displayName: 'Gray Synthetic',
        identifiers: { netid: 'zz9201' },
        profileLinks: [],
      });
      await recordRemoval('netid', 'zz9201');
      await recordRemoval('email', 'gray.synthetic@example.edu');
      await recordRemoval('profile_url', 'https://example.edu/profile/gray-synthetic');
      const row = (field: string, value: unknown): ObservationInput => ({
        entityType: 'researchEntity',
        entityKey: 'synthetic-fixture-lab',
        field,
        value,
        sourceUrl: 'https://example.edu/lab/synthetic-fixture',
      });

      const { removedByRequest } = await appendUnderOneRun([
        [
          row('name', 'Synthetic Fixture Lab'),
          row('inferredPiUserKey', 'netid:zz9201'),
          row('inferredPiUserId', String(removed._id)),
          row('inferredDirectorProfileUrl', 'https://example.edu/profile/gray-synthetic/'),
          row('contactEmail', 'gray.synthetic@example.edu'),
          row('inferredDirectorName', 'Gray Synthetic'),
          row('contactEmail', 'lab.office@example.edu'),
        ],
      ]);

      expect(removedByRequest).toBe(4);
      const stored = await Observation.find({ entityKey: 'synthetic-fixture-lab' })
        .select('field value')
        .lean<Array<{ field: string; value: unknown }>>();
      expect(stored.map((obs) => obs.field).sort()).toEqual([
        'contactEmail',
        'inferredDirectorName',
        'name',
      ]);
      expect(stored.find((obs) => obs.field === 'contactEmail')?.value).toBe(
        'lab.office@example.edu',
      );
    });
  },
);

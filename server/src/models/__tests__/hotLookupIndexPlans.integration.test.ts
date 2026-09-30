import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Observation } from '../observation';
import { Researcher } from '../researcher';
import { Account } from '../account';
import { reportMissingMongoIndexes } from '../../db/connections';
import {
  loadRosterObservedEntityKeys,
  ROSTER_LANE_SOURCE_NAME,
} from '../../scrapers/facultyRosterDepartureReconciler';
import { planStudentVisibilityGate } from '../../services/studentVisibilityGateService';
import { resolveExistingUserForIdentity } from '../../scrapers/sources/officialProfilePiBackfillScraper';
import {
  CONTROLLED_VOCABULARY_RESEARCH_AREA_SOURCES,
  resetControlledVocabularyHeadingsCache,
  warmControlledVocabularyHeadings,
} from '../../utils/controlledVocabularyHeadings';

/**
 * A declared `schema.index(...)` proves nothing on its own: the question each of these
 * lookups asks is whether MongoDB's planner actually takes the index for the query the
 * caller sends, and a declaration can be present while the plan stays a scan (#3934).
 *
 * So every case here drives the real caller against a real `mongod`, captures the command
 * that caller actually sent through the driver's command monitor rather than restating it,
 * and explains that captured command twice: once with the indexes this change declares and
 * once with exactly those indexes dropped. The second half is what makes the first half
 * mean anything, because it is the plan the code had before the change.
 */
const TARGET_PROFILE_URL = 'https://medicine.example.test/profile/subject-one';
const VOCABULARY_SOURCE = CONTROLLED_VOCABULARY_RESEARCH_AREA_SOURCES[0];
const FILLER_OBSERVATIONS = 20000;
const FILLER_RESEARCHERS = 10000;

const INDEXES_THIS_CHANGE_DECLARES = {
  observations: [
    'sourceUrl_1_observedAt_-1',
    'sourceName_1_entityType_1_superseded_1_entityKey_1_entityId_1',
    'sourceName_1_field_1',
  ],
  researchers: ['profileLinks.url_1', 'profile.websiteUrl_1'],
} as const;

interface PlanReading {
  readonly stages: string[];
  readonly indexes: string[];
  readonly nReturned: number;
  readonly docsExamined: number;
  readonly keysExamined: number;
}

interface DrivenLookup {
  readonly filter: unknown;
  readonly withIndexes: PlanReading;
  readonly withoutIndexes: PlanReading;
  readonly resultWithIndexes: unknown;
  readonly resultWithoutIndexes: unknown;
}

const driven = new Map<string, DrivenLookup>();
const lookup = (name: string): DrivenLookup => {
  const found = driven.get(name);
  if (!found) throw new Error(`${name} was never driven`);
  return found;
};

let server: MongoMemoryServer;
let capturedCommands: Record<string, any>[] = [];

const distinctValues = (plan: string, key: string): string[] => [
  ...new Set(
    (plan.match(new RegExp(`"${key}":"([A-Za-z_.\\-0-9]+)"`, 'g')) || []).map(
      (match) => match.split('"')[3],
    ),
  ),
];

async function explainCaptured(command: Record<string, any>): Promise<PlanReading> {
  const { lsid: _lsid, $db: _db, $clusterTime: _clusterTime, ...explainable } = command;
  const explained: any = await mongoose.connection.db!.command({
    explain: explainable,
    verbosity: 'executionStats',
  });
  const winningPlan = JSON.stringify(explained.queryPlanner.winningPlan);
  const stats = explained.executionStats;
  return {
    stages: distinctValues(winningPlan, 'stage'),
    indexes: distinctValues(winningPlan, 'indexName'),
    nReturned: stats.nReturned,
    docsExamined: stats.totalDocsExamined,
    keysExamined: stats.totalKeysExamined,
  };
}

async function setIndexesThisChangeDeclares(present: boolean): Promise<void> {
  if (present) {
    await Observation.createIndexes();
    await Researcher.createIndexes();
    return;
  }
  for (const [collection, names] of Object.entries(INDEXES_THIS_CHANGE_DECLARES)) {
    const live = mongoose.connection.db!.collection(collection);
    const liveNames = new Set((await live.indexes()).map((index) => String(index.name)));
    // An undeclared index is already absent rather than an error, so the plan readings
    // below report what the code without the declaration plans and the assertions name
    // the regression, instead of the suite dying in setup on a missing name.
    for (const name of names.filter((candidate) => liveNames.has(candidate))) {
      await live.dropIndex(name);
    }
  }
}

async function drive(
  name: string,
  run: () => Promise<unknown>,
  pick: (command: Record<string, any>) => boolean,
): Promise<void> {
  const capture = async (): Promise<{ command: Record<string, any>; result: unknown }> => {
    capturedCommands = [];
    const result = await run();
    const matching = capturedCommands.filter(pick);
    if (matching.length !== 1) {
      throw new Error(
        `${name} sent ${matching.length} matching commands, expected exactly one. Saw: ` +
          JSON.stringify(capturedCommands.map((command) => command.find ?? command.distinct)),
      );
    }
    return { command: matching[0], result };
  };

  const withIndexes = await capture();
  const withIndexesPlan = await explainCaptured(withIndexes.command);
  await setIndexesThisChangeDeclares(false);
  const withoutIndexes = await capture();
  const withoutIndexesPlan = await explainCaptured(withoutIndexes.command);
  await setIndexesThisChangeDeclares(true);

  driven.set(name, {
    filter: withIndexes.command.filter ?? withIndexes.command.query,
    withIndexes: withIndexesPlan,
    withoutIndexes: withoutIndexesPlan,
    resultWithIndexes: withIndexes.result,
    resultWithoutIndexes: withoutIndexes.result,
  });
}

async function seedCorpus(): Promise<void> {
  const db = mongoose.connection.db!;
  for (const collection of ['observations', 'researchers', 'accounts', 'researchentities']) {
    await db.createCollection(collection);
  }

  const observations: Record<string, unknown>[] = [];
  const observation = (row: Record<string, unknown>) =>
    observations.push({ superseded: false, sourceId: new mongoose.Types.ObjectId(), ...row });

  for (let index = 0; index < FILLER_OBSERVATIONS; index += 1) {
    observation({
      sourceName: `filler-source-${index % 9}`,
      field: 'websiteUrl',
      entityType: 'researchEntity',
      entityKey: `filler-key-${index % 3000}`,
      entityId: new mongoose.Types.ObjectId(),
      value: `https://example.test/${index}`,
      observedAt: new Date(2026, 0, 1 + (index % 300)),
      sourceUrl: `https://example.test/page-${index}`,
    });
  }
  // The rows the repair queue's evidence lookup is looking for, few among the filler.
  for (let index = 0; index < 3; index += 1) {
    observation({
      sourceName: 'official-profile',
      field: 'title',
      entityType: 'user',
      entityId: new mongoose.Types.ObjectId(),
      value: `title ${index}`,
      observedAt: new Date(2026, 5, 1 + index),
      sourceUrl: TARGET_PROFILE_URL,
    });
  }
  // The roster lane's own observations, which the gate reads source-scoped as well.
  for (let index = 0; index < 200; index += 1) {
    observation({
      sourceName: ROSTER_LANE_SOURCE_NAME,
      field: 'members',
      entityType: 'researchEntity',
      entityKey: `roster-key-${index}`,
      entityId: new mongoose.Types.ObjectId(),
      value: [`Listed Member ${index}`],
      observedAt: new Date(2026, 3, 1 + (index % 28)),
      sourceUrl: `https://roster.example.test/${index}`,
    });
  }
  // A vocabulary source whose rows are mostly on another field, which is the corpus shape
  // that makes the `field` key earn its place: on `sourceName` alone the reload would have
  // to examine all of them.
  for (let index = 0; index < 4000; index += 1) {
    const isHeading = index % 13 === 0;
    observation({
      sourceName: VOCABULARY_SOURCE,
      field: isHeading ? 'researchAreas' : 'description',
      entityType: 'researchEntity',
      entityKey: `vocabulary-key-${index}`,
      entityId: new mongoose.Types.ObjectId(),
      value: isHeading ? [`Cell ${index}, Molecular Biology`] : `description ${index}`,
      observedAt: new Date(2026, 2, 1 + (index % 28)),
      sourceUrl: `https://vocabulary.example.test/${index}`,
    });
  }
  await Observation.collection.insertMany(observations);

  const account = {
    _id: new mongoose.Types.ObjectId(),
    netid: 'syn0001',
    email: 'syn0001@example.test',
  };
  await Account.collection.insertOne(account as never);

  const researchers: Record<string, unknown>[] = [];
  for (let index = 0; index < FILLER_RESEARCHERS; index += 1) {
    researchers.push({
      displayName: `Filler Person ${index}`,
      archived: false,
      profileLinks: [{ url: `https://example.test/people/${index}`, label: 'profile' }],
      profile: { websiteUrl: `https://lab.example.test/${index}` },
    });
  }
  researchers.push({
    displayName: 'Subject One',
    archived: false,
    accountId: account._id,
    profileLinks: [{ url: TARGET_PROFILE_URL, label: 'profile' }],
    profile: { websiteUrl: 'https://lab.example.test/subject-one' },
  });
  await Researcher.collection.insertMany(researchers);
}

describe('the hot observation and researcher lookups take their index against a real server (#3934)', () => {
  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    await mongoose.connect(server.getUri(), {
      autoIndex: false,
      autoCreate: false,
      monitorCommands: true,
    });
    mongoose.connection.getClient().on('commandStarted', (event: any) => {
      if (['find', 'distinct'].includes(event.commandName)) capturedCommands.push(event.command);
    });

    await seedCorpus();
    await setIndexesThisChangeDeclares(true);

    await drive(
      'repair queue evidence by sourceUrl, newest first',
      // The caller is module-private and only runs in apply mode, so the query goes through
      // the model the caller uses. The planner, the corpus and the index are the real ones.
      async () =>
        (
          await Observation.find({
            sourceUrl: { $in: [TARGET_PROFILE_URL] },
            sourceId: { $ne: null },
            superseded: { $ne: true },
          })
            .sort({ observedAt: -1 })
            .limit(20)
            .lean()
        ).length,
      (command) => command.find === 'observations',
    );

    await drive(
      'roster lane observed-key read',
      async () => (await loadRosterObservedEntityKeys()).size,
      (command) => command.distinct === 'observations' && command.key === 'entityKey',
    );

    await drive(
      'gate source-scoped distinct on the id form',
      async () =>
        (
          await planStudentVisibilityGate({
            collection: 'research',
            mode: 'dry-run',
            sourceName: ROSTER_LANE_SOURCE_NAME,
          })
        ).length,
      (command) => command.distinct === 'observations' && command.key === 'entityId',
    );

    await drive(
      'gate source-scoped distinct on the key form',
      async () =>
        (
          await planStudentVisibilityGate({
            collection: 'research',
            mode: 'dry-run',
            sourceName: ROSTER_LANE_SOURCE_NAME,
          })
        ).length,
      (command) => command.distinct === 'observations' && command.key === 'entityKey',
    );

    await drive(
      'researcher identity by profile URL',
      async () =>
        (
          await resolveExistingUserForIdentity({
            canonicalUrl: TARGET_PROFILE_URL,
            fetchedUrl: TARGET_PROFILE_URL,
            displayName: 'Subject One',
            email: '',
            title: '',
            departments: [],
            researchInterests: [],
          })
        )?.netid ?? null,
      (command) =>
        command.find === 'researchers' &&
        JSON.stringify(command.filter).includes('profileLinks.url'),
    );

    await drive(
      'controlled-vocabulary heading reload',
      async () => {
        resetControlledVocabularyHeadingsCache();
        return (await warmControlledVocabularyHeadings()).size;
      },
      (command) =>
        command.find === 'observations' && JSON.stringify(command.filter).includes('researchAreas'),
    );
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await server?.stop();
  });

  it('builds every declared index, so the drift report reaches zero', async () => {
    const drift = await reportMissingMongoIndexes();

    expect(
      drift.filter((entry) => ['observations', 'researchers'].includes(entry.collection)),
    ).toEqual([]);
  });

  it.each([
    ['repair queue evidence by sourceUrl, newest first', 'sourceUrl_1_observedAt_-1'],
    [
      'roster lane observed-key read',
      'sourceName_1_entityType_1_superseded_1_entityKey_1_entityId_1',
    ],
    [
      'gate source-scoped distinct on the id form',
      'sourceName_1_entityType_1_superseded_1_entityKey_1_entityId_1',
    ],
    [
      'gate source-scoped distinct on the key form',
      'sourceName_1_entityType_1_superseded_1_entityKey_1_entityId_1',
    ],
    ['controlled-vocabulary heading reload', 'sourceName_1_field_1'],
  ])('%s is planned on %s', (name, indexName) => {
    expect(lookup(name).withIndexes.indexes).toEqual([indexName]);
  });

  it('plans the researcher identity union on one index per $or clause', () => {
    const identity = lookup('researcher identity by profile URL');

    expect(identity.withIndexes.stages).toContain('OR');
    expect([...identity.withIndexes.indexes].sort()).toEqual([
      'profile.websiteUrl_1',
      'profileLinks.url_1',
    ]);
  });

  it.each([
    ['repair queue evidence by sourceUrl, newest first', 20],
    ['gate source-scoped distinct on the id form', 200],
    ['gate source-scoped distinct on the key form', 200],
    ['researcher identity by profile URL', 10],
    ['controlled-vocabulary heading reload', 400],
  ])('%s examines at most %i documents', (name, ceiling) => {
    expect(lookup(name).withIndexes.docsExamined).toBeLessThanOrEqual(ceiling);
  });

  it('answers the roster lane read from the index alone, fetching no document', () => {
    const roster = lookup('roster lane observed-key read');

    expect(roster.withIndexes.stages).toContain('DISTINCT_SCAN');
    expect(roster.withIndexes.docsExamined).toBe(0);
  });

  it.each([
    'repair queue evidence by sourceUrl, newest first',
    'roster lane observed-key read',
    'gate source-scoped distinct on the id form',
    'gate source-scoped distinct on the key form',
    'researcher identity by profile URL',
    'controlled-vocabulary heading reload',
  ])('%s costs far more with these indexes dropped', (name) => {
    const { withIndexes, withoutIndexes } = lookup(name);

    expect(withoutIndexes.indexes).not.toEqual(withIndexes.indexes);
    expect(withoutIndexes.docsExamined).toBeGreaterThan(withIndexes.docsExamined * 10 + 100);
  });

  it.each([
    'repair queue evidence by sourceUrl, newest first',
    'roster lane observed-key read',
    'gate source-scoped distinct on the id form',
    'gate source-scoped distinct on the key form',
    'researcher identity by profile URL',
    'controlled-vocabulary heading reload',
  ])('%s returns the same answer with the indexes dropped', (name) => {
    const { resultWithIndexes, resultWithoutIndexes, withIndexes, withoutIndexes } = lookup(name);

    expect(resultWithoutIndexes).toEqual(resultWithIndexes);
    expect(withoutIndexes.nReturned).toBe(withIndexes.nReturned);
  });

  it('finds the researcher the profile URL names, which is what the union is for', () => {
    expect(lookup('researcher identity by profile URL').resultWithIndexes).toBe('syn0001');
  });

  it('keeps the sourceId index load-bearing, because the BBS track read leads on it', async () => {
    const before = capturedCommands.length;
    await Observation.exists({
      sourceId: new mongoose.Types.ObjectId(),
      entityType: 'researchEntity',
      field: 'researchAreas',
      value: { $in: ['Cell 0, Molecular Biology'] },
    });
    const command = capturedCommands.slice(before).find((entry) => entry.find === 'observations');

    const plan = await explainCaptured(command!);

    expect(plan.indexes).toEqual(['sourceId_1_observedAt_-1']);
    expect(plan.keysExamined).toBeLessThanOrEqual(1);
  });

  it('takes no index bounds from a case-insensitive sourceUrl regex, so its plan is unchanged', async () => {
    const hostFilterRead = async () => {
      const before = capturedCommands.length;
      await Observation.find({
        entityType: 'researchEntity',
        superseded: { $ne: true },
        $or: [
          { sourceUrl: { $regex: '^https?://(www\\.)?example\\.test(/|$|\\?)', $options: 'i' } },
        ],
      })
        .select('sourceUrl entityKey entityId')
        .lean();
      return explainCaptured(
        capturedCommands.slice(before).find((entry) => entry.find === 'observations')!,
      );
    };

    const withIndexes = await hostFilterRead();
    await setIndexesThisChangeDeclares(false);
    const withoutIndexes = await hostFilterRead();
    await setIndexesThisChangeDeclares(true);

    expect(withIndexes.indexes).not.toContain('sourceUrl_1_observedAt_-1');
    expect(withIndexes.indexes).toEqual(withoutIndexes.indexes);
    expect(withIndexes.keysExamined).toBe(withoutIndexes.keysExamined);
  });

  it('indexes the profile URL paths without making them unique, because a URL is shared', async () => {
    const sharedUrl = 'https://medicine.example.test/lab/shared-group-page';

    const inserted = await Researcher.collection.insertMany([
      {
        displayName: 'Shared One',
        archived: false,
        profileLinks: [{ url: sharedUrl }],
        profile: { websiteUrl: sharedUrl },
      },
      {
        displayName: 'Shared Two',
        archived: false,
        profileLinks: [{ url: sharedUrl }],
        profile: { websiteUrl: sharedUrl },
      },
    ] as never[]);

    expect(inserted.insertedCount).toBe(2);
    expect(await Researcher.countDocuments({ 'profileLinks.url': sharedUrl })).toBe(2);
  });
});

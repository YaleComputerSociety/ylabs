import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fakeIndex = vi.hoisted(() => {
  const state = { nextTaskUid: 1, failingDocumentIds: new Set<string>() };
  const taskDocumentIds = new Map<number, string[]>();
  const added: Array<Record<string, any>> = [];
  return {
    state,
    added,
    index: {
      addDocuments: vi.fn(async (documents: Array<Record<string, any>>) => {
        const taskUid = state.nextTaskUid++;
        added.push(...documents);
        taskDocumentIds.set(
          taskUid,
          documents.map((document) => String(document.id)),
        );
        return { taskUid };
      }),
      deleteDocument: vi.fn(async (id: string) => {
        const taskUid = state.nextTaskUid++;
        taskDocumentIds.set(taskUid, [id]);
        return { taskUid };
      }),
      deleteDocuments: vi.fn(async (ids: string[]) => {
        const taskUid = state.nextTaskUid++;
        taskDocumentIds.set(taskUid, ids);
        return { taskUid };
      }),
      tasks: {
        waitForTask: vi.fn(async (taskUid: number) => {
          const ids = taskDocumentIds.get(taskUid) || [];
          return ids.some((id) => state.failingDocumentIds.has(id))
            ? { status: 'failed', error: { code: 'invalid_document_fields' } }
            : { status: 'succeeded' };
        }),
      },
    },
  };
});

vi.mock('../../utils/meiliClient', () => ({
  getMeiliIndex: async () => fakeIndex.index,
  getMeiliClient: async () => ({ index: () => fakeIndex.index }),
  resolveIndexName: (name: string) => name,
  assertDeployedMeiliConnectionConfig: () => undefined,
}));

import { Observation } from '../../models/observation';
import { Researcher } from '../../models/researcher';
import { materializeEntity, materializeFromRun } from '../entityMaterializer';
import { materializeCanonicalMembership } from '../canonicalMembershipMaterializer';
import { resetDirectoryNetidsByAddressCache } from '../directoryContradictedProfileNetid';
import { resetInvalidatedScrapeRunCache } from '../invalidatedScrapeRuns';
import { resetOverSharedPersonWebsiteKeysCache } from '../overSharedPersonWebsite';
import { recordFullCoverageRun } from './fullCoverageRunFixture';

const NETID = 'zz5626a';
const KEY = `netid:${NETID}`;
const OLD_NAME = 'R. Fixturely';
const NEW_NAME = 'Robin Fixturely';
const ROSTER_URL = 'https://fixture5626.example.edu/people/';
const FAR_FUTURE = new Date('2099-01-01T00:00:00Z');

type Row = 'led' | 'faculty' | 'member' | 'historical' | 'archivedEdge' | 'unrelated';

describe('a researcher rename re-syncs the search documents of the rows linked to them (#5626)', () => {
  let replSet: MongoMemoryReplSet;
  const rowIds = {} as Record<Row, mongoose.Types.ObjectId>;
  let researcherId: mongoose.Types.ObjectId;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    await Observation.syncIndexes();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  const db = () => {
    const connection = mongoose.connection.db;
    if (!connection) throw new Error('no db');
    return connection;
  };

  const seedRow = async (row: Row, extra: Record<string, unknown> = {}) => {
    const _id = new mongoose.Types.ObjectId();
    rowIds[row] = _id;
    await db()
      .collection('research_entities')
      .insertOne({
        _id,
        slug: `fixture-5626-${row}`,
        name: `Fixture 5626 ${row} Lab`,
        kind: 'lab',
        entityType: 'LAB',
        archived: false,
        studentVisibilityTier: 'student_ready',
        ...extra,
      });
    return _id;
  };

  const seedEdge = (
    personId: mongoose.Types.ObjectId,
    row: Row,
    role: string,
    extra: Record<string, unknown> = {},
  ) =>
    db()
      .collection('role_assignments')
      .insertOne({
        personId,
        target: { kind: 'RESEARCH_ENTITY', id: rowIds[row] },
        role,
        state: 'CURRENT',
        confidence: 0.9,
        reviewStatus: 'UNREVIEWED',
        archived: false,
        ...extra,
      });

  const observation = (field: string, value: unknown, extra: Record<string, unknown> = {}) =>
    Observation.create({
      entityType: 'user',
      entityKey: KEY,
      field,
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'dept-faculty-roster',
      sourceUrl: 'https://fixture5626.example.edu/faculty/',
      confidence: 0.9,
      observedAt: new Date('2026-11-01T00:00:00Z'),
      superseded: false,
      ...extra,
    });

  const seedNameEvidence = async (extra: Record<string, unknown> = {}) => {
    await observation('fname', 'Robin', extra);
    await observation('lname', 'Fixturely', extra);
  };

  const syncedRowIds = () => new Set(fakeIndex.added.map((document) => String(document.id)));
  const lastSynced = (row: Row) =>
    [...fakeIndex.added].reverse().find((document) => document.id === String(rowIds[row]));

  beforeEach(async () => {
    for (const name of [
      'observations',
      'researchers',
      'accounts',
      'research_entities',
      'role_assignments',
      'scrape_runs',
    ]) {
      await db().collection(name).deleteMany({});
    }
    resetDirectoryNetidsByAddressCache();
    resetInvalidatedScrapeRunCache();
    resetOverSharedPersonWebsiteKeysCache();
    fakeIndex.added.length = 0;
    fakeIndex.state.failingDocumentIds.clear();
    vi.clearAllMocks();

    const researcher = await Researcher.create({
      displayName: OLD_NAME,
      identifiers: { netid: NETID },
      profile: {},
      profileLinks: [],
      status: 'UNKNOWN',
      archived: false,
    });
    researcherId = researcher._id as mongoose.Types.ObjectId;
    await seedRow('led');
    await seedRow('faculty');
    await seedRow('member', {
      rosterEnrichment: {
        state: 'current',
        sourceUrl: ROSTER_URL,
        observedAt: new Date('2026-10-01T00:00:00Z'),
        memberKeys: ['fixture-5626-member'],
      },
    });
    await seedRow('historical');
    await seedRow('archivedEdge');
    await seedRow('unrelated');
    await seedEdge(researcherId, 'led', 'PI');
    await seedEdge(researcherId, 'faculty', 'CORE_FACULTY');
    await seedEdge(researcherId, 'member', 'POSTDOC', {
      rosterProvenance: {
        sourceName: 'official-research-home-roster',
        sourceUrl: ROSTER_URL,
        evidenceStatus: 'verified',
        membershipKey: 'fixture-5626-member',
        observedAt: new Date('2026-10-02T00:00:00Z'),
        freshnessExpiresAt: FAR_FUTURE,
      },
    });
    await seedEdge(researcherId, 'historical', 'PI', { state: 'HISTORICAL' });
    await seedEdge(researcherId, 'archivedEdge', 'PI', { archived: true });
    const someoneElse = await Researcher.create({ displayName: 'Other Fixture', archived: false });
    await seedEdge(someoneElse._id as mongoose.Types.ObjectId, 'unrelated', 'PI');
  });

  it('re-syncs every row with a live edge, and the indexed names carry the new name', async () => {
    await seedNameEvidence();

    const result = await materializeEntity('user', { entityKey: KEY });

    expect((await Researcher.findById(researcherId).lean<any>()).displayName).toBe(NEW_NAME);
    expect(result.otherIndexSyncFailedEntityIds).toBeUndefined();
    expect(syncedRowIds()).toEqual(
      new Set([rowIds.led, rowIds.faculty, rowIds.member].map(String)),
    );
    expect(lastSynced('led')?.leadProfessorNames).toEqual([NEW_NAME]);
    expect(lastSynced('led')?.professorNames).toEqual([NEW_NAME]);
    expect(lastSynced('faculty')?.professorNames).toEqual([NEW_NAME]);
    expect(lastSynced('faculty')?.leadProfessorNames ?? []).toEqual([]);
    expect(lastSynced('member')?.memberNames).toEqual([NEW_NAME]);
    expect(fakeIndex.index.addDocuments).toHaveBeenCalledTimes(1);
  });

  it('re-syncs nothing when the save leaves every indexed field as it was', async () => {
    await seedNameEvidence();
    await materializeEntity('user', { entityKey: KEY });
    fakeIndex.added.length = 0;
    vi.clearAllMocks();
    await observation('primaryDepartment', 'Fixture Studies');

    const again = await materializeEntity('user', { entityKey: KEY });

    expect(again.fieldsWritten).toBeGreaterThan(0);
    expect(fakeIndex.index.addDocuments).not.toHaveBeenCalled();
  });

  it('re-syncs nothing for a title that keeps the emeritus verdict', async () => {
    await Researcher.updateOne({ _id: researcherId }, { $set: { displayName: NEW_NAME } });
    await seedNameEvidence();
    await observation('title', 'Professor of Fixture Studies');

    const result = await materializeEntity('user', { entityKey: KEY });

    expect((await Researcher.findById(researcherId).lean<any>()).profile.title).toBe(
      'Professor of Fixture Studies',
    );
    expect(result.fieldsWritten).toBeGreaterThan(0);
    expect(fakeIndex.index.addDocuments).not.toHaveBeenCalled();
  });

  it('re-syncs for a title that makes the lead emeritus, which the way-in withhold reads', async () => {
    await Researcher.updateOne({ _id: researcherId }, { $set: { displayName: NEW_NAME } });
    await seedNameEvidence();
    await observation('title', 'Professor Emeritus of Fixture Studies');

    await materializeEntity('user', { entityKey: KEY });

    expect(syncedRowIds()).toEqual(
      new Set([rowIds.led, rowIds.faculty, rowIds.member].map(String)),
    );
  });

  it('re-syncs nothing on a dry run', async () => {
    await seedNameEvidence();

    const result = await materializeEntity('user', { entityKey: KEY }, { dryRun: true });

    expect(result.fieldsWritten).toBeGreaterThan(0);
    expect((await Researcher.findById(researcherId).lean<any>()).displayName).toBe(OLD_NAME);
    expect(fakeIndex.index.addDocuments).not.toHaveBeenCalled();
  });

  it('reports a failed linked-row sync on the materialize result', async () => {
    fakeIndex.state.failingDocumentIds.add(String(rowIds.led));
    await seedNameEvidence();

    const result = await materializeEntity('user', { entityKey: KEY });

    expect(new Set(result.otherIndexSyncFailedEntityIds)).toEqual(
      new Set([rowIds.led, rowIds.faculty, rowIds.member].map(String)),
    );
  });

  it('counts a failed linked-row sync in the run stale-index set', async () => {
    const runId = new mongoose.Types.ObjectId();
    await recordFullCoverageRun('dept-faculty-roster', runId, new Date('2026-11-01T00:00:00Z'));
    fakeIndex.state.failingDocumentIds.add(String(rowIds.led));
    await seedNameEvidence({ scrapeRunId: runId });

    const counts = await materializeFromRun(String(runId));

    expect(counts.errors).toBe(0);
    expect((await Researcher.findById(researcherId).lean<any>()).displayName).toBe(NEW_NAME);
    expect(counts.indexSyncFailures).toBe(3);
  });

  it('re-syncs on a field-scoped run only when the scope wrote an indexed field', async () => {
    await seedNameEvidence();
    await observation('primaryDepartment', 'Fixture Studies');

    await materializeEntity(
      'user',
      { entityKey: KEY },
      { userWriteOnlyFields: ['primaryDepartment'] },
    );
    const afterDepartmentScope = await Researcher.findById(researcherId).lean<any>();
    expect(afterDepartmentScope.profile.primaryDepartment).toBe('Fixture Studies');
    expect(afterDepartmentScope.displayName).toBe(OLD_NAME);
    expect(fakeIndex.index.addDocuments).not.toHaveBeenCalled();

    await materializeEntity('user', { entityKey: KEY }, { userWriteOnlyFields: ['displayName'] });
    expect(lastSynced('led')?.leadProfessorNames).toEqual([NEW_NAME]);
  });

  it('re-syncs the rows of a name-only researcher that membership adopts and renames', async () => {
    const noisy = await Researcher.create({
      displayName: 'Photo of Dana Fixturewell.',
      profileLinks: [],
      archived: false,
    });
    await seedEdge(noisy._id as mongoose.Types.ObjectId, 'unrelated', 'CORE_FACULTY');

    await materializeCanonicalMembership(
      String(rowIds.historical),
      { legacyRole: 'pi', isCurrentMember: true, confidence: 0.9, displayName: 'Dana Fixturewell' },
      { displayName: 'Dana Fixturewell' },
    );

    expect((await Researcher.findById(noisy._id).lean<any>()).displayName).toBe('Dana Fixturewell');
    expect(lastSynced('unrelated')?.professorNames).toEqual(
      expect.arrayContaining(['Dana Fixturewell']),
    );
  });
});

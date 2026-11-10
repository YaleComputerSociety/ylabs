import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DirectoryRemoval } from '../../models/directoryRemoval';
import { Observation } from '../../models/observation';
import { Researcher } from '../../models/researcher';
import { loadDirectoryRemovalMatcher } from '../../services/directoryRemovalMatcher';
import { directoryRemovalDigest } from '../../utils/directoryRemovalDigest';
import { runDirectoryRemovalObservationPurge } from '../directoryRemovalObservationPurge';

const KEY = 'synthetic-directory-removal-key-0123456789';
const KEYED_ENV = { DIRECTORY_REMOVAL_KEY: KEY } as NodeJS.ProcessEnv;
const REMOVED = {
  netid: 'zz9001',
  email: 'synthetic.removed@example.test',
  profileUrl: 'https://medicine.example.test/profile/synthetic-removed/',
};
const NAMESAKE_NETID = 'zz9002';
const OTHER_NETID = 'zz9003';

const sourceId = new mongoose.Types.ObjectId();
const legacyUserId = new mongoose.Types.ObjectId();
const removedResearcherId = new mongoose.Types.ObjectId();
const otherResearcherId = new mongoose.Types.ObjectId();

const expectedDeleted: string[] = [];
const expectedKept: string[] = [];

async function seedObservation(
  outcome: 'deleted' | 'kept',
  fields: {
    entityType: string;
    entityKey?: string;
    entityId?: mongoose.Types.ObjectId;
    field: string;
    value?: unknown;
    superseded?: boolean;
  },
): Promise<void> {
  const { insertedId } = await Observation.collection.insertOne({
    sourceId,
    sourceName: 'synthetic-source',
    confidence: 0.9,
    observedAt: new Date('2026-11-01T00:00:00Z'),
    superseded: false,
    ...fields,
  });
  (outcome === 'deleted' ? expectedDeleted : expectedKept).push(String(insertedId));
}

async function remainingIds(): Promise<string[]> {
  const docs = await Observation.collection.find({}, { projection: { _id: 1 } }).toArray();
  return docs.map((doc) => String(doc._id)).sort();
}

let memoryServer: MongoMemoryServer | undefined;

beforeAll(async () => {
  memoryServer = await MongoMemoryServer.create();
  await mongoose.connect(memoryServer.getUri('directory_removal_purge_test'));
});

afterAll(async () => {
  await mongoose.disconnect();
  await memoryServer?.stop();
});

beforeEach(async () => {
  expectedDeleted.length = 0;
  expectedKept.length = 0;
  await Promise.all([
    Observation.collection.deleteMany({}),
    DirectoryRemoval.collection.deleteMany({}),
    Researcher.collection.deleteMany({}),
  ]);
  const recordedAt = new Date('2026-11-10T00:00:00Z');
  await DirectoryRemoval.collection.insertMany([
    { digest: directoryRemovalDigest(KEY, 'netid', REMOVED.netid), kind: 'netid', recordedAt },
    { digest: directoryRemovalDigest(KEY, 'email', REMOVED.email), kind: 'email', recordedAt },
    {
      digest: directoryRemovalDigest(KEY, 'netid', OTHER_NETID),
      kind: 'netid',
      recordedAt,
      withdrawnAt: recordedAt,
      withdrawnReason: 'recorded_in_error',
    },
  ]);
  await Researcher.collection.insertMany([
    {
      _id: removedResearcherId,
      displayName: 'Synthetic Removed',
      identifiers: { netid: REMOVED.netid },
    },
    { _id: otherResearcherId, displayName: 'Synthetic Other', identifiers: { netid: OTHER_NETID } },
  ]);

  await seedObservation('deleted', {
    entityType: 'user',
    entityKey: `netid:${REMOVED.netid}`,
    field: 'title',
    value: 'Professor',
  });
  await seedObservation('deleted', {
    entityType: 'user',
    entityKey: `netid:${REMOVED.netid}`,
    field: 'bio',
    value: 'Synthetic bio',
    superseded: true,
  });
  await seedObservation('deleted', {
    entityType: 'user',
    entityKey: REMOVED.netid,
    field: 'title',
    value: 'Professor',
  });
  await seedObservation('deleted', {
    entityType: 'user',
    entityKey: 'dept:synthetic-dept:synthetic-removed',
    field: 'email',
    value: REMOVED.email.toUpperCase(),
  });
  await seedObservation('deleted', {
    entityType: 'user',
    entityKey: 'dept:synthetic-dept:synthetic-removed',
    field: 'fname',
    value: 'Synthetic',
  });
  await seedObservation('deleted', {
    entityType: 'user',
    entityKey: 'dept:synthetic-dept:synthetic-removed',
    field: 'lname',
    value: 'Removed',
  });
  await seedObservation('deleted', {
    entityType: 'user',
    entityKey: 'ysm:synthetic-removed',
    entityId: legacyUserId,
    field: 'netid',
    value: REMOVED.netid,
  });
  await seedObservation('deleted', {
    entityType: 'user',
    entityId: legacyUserId,
    field: 'bio',
    value: 'Synthetic bio',
  });
  await seedObservation('deleted', {
    entityType: 'researchGroupMember',
    entityKey: 'official-roster:synthetic-lab:aa11',
    field: 'email',
    value: REMOVED.email,
  });
  await seedObservation('deleted', {
    entityType: 'researchGroupMember',
    entityKey: 'official-roster:synthetic-lab:aa11',
    field: 'name',
    value: 'Synthetic Removed',
  });
  await seedObservation('deleted', {
    entityType: 'researchGroupMember',
    entityKey: 'synthetic-lab:research-faculty:synthetic-removed',
    field: 'member',
    value: { userId: removedResearcherId, name: 'Synthetic Removed' },
  });
  await seedObservation('deleted', {
    entityType: 'researchEntity',
    entityKey: 'synthetic-lab',
    field: 'inferredPiUserKey',
    value: `netid:${REMOVED.netid}`,
  });
  await seedObservation('deleted', {
    entityType: 'researchEntity',
    entityKey: 'synthetic-center',
    field: 'inferredPiUserKey',
    value: 'dept:synthetic-dept:synthetic-removed',
  });
  await seedObservation('deleted', {
    entityType: 'researchEntity',
    entityKey: 'synthetic-lab',
    field: 'inferredPiUserId',
    value: removedResearcherId,
  });
  await seedObservation('deleted', {
    entityType: 'researchEntity',
    entityKey: 'synthetic-lab',
    field: 'contactEmail',
    value: REMOVED.email,
  });

  await seedObservation('kept', {
    entityType: 'user',
    entityKey: `netid:${NAMESAKE_NETID}`,
    field: 'fname',
    value: 'Synthetic',
  });
  await seedObservation('kept', {
    entityType: 'user',
    entityKey: `netid:${NAMESAKE_NETID}`,
    field: 'lname',
    value: 'Removed',
  });
  await seedObservation('kept', {
    entityType: 'user',
    entityKey: 'dept:other-dept:synthetic-removed',
    field: 'fname',
    value: 'Synthetic',
  });
  await seedObservation('kept', {
    entityType: 'user',
    entityKey: 'dept:other-dept:synthetic-removed',
    field: 'lname',
    value: 'Removed',
  });
  await seedObservation('kept', {
    entityType: 'user',
    entityKey: `netid:${OTHER_NETID}`,
    field: 'title',
    value: 'Professor',
  });
  await seedObservation('kept', {
    entityType: 'researchGroupMember',
    entityKey: 'official-roster:synthetic-lab:bb22',
    field: 'profileIdentityEvidence',
    value: { emails: [REMOVED.email], netids: [], linkedProfileUrls: [], pageUrl: '' },
  });
  await seedObservation('kept', {
    entityType: 'researchGroupMember',
    entityKey: 'official-roster:synthetic-lab:cc33',
    field: 'member',
    value: { userId: otherResearcherId, name: 'Synthetic Other' },
  });
  await seedObservation('kept', {
    entityType: 'researchEntity',
    entityKey: 'synthetic-lab',
    field: 'inferredPiUserKey',
    value: `netid:${NAMESAKE_NETID}`,
  });
  await seedObservation('kept', {
    entityType: 'researchEntity',
    entityKey: 'synthetic-lab',
    field: 'inferredPiUserId',
    value: otherResearcherId,
  });
  await seedObservation('kept', {
    entityType: 'researchEntity',
    entityKey: 'synthetic-lab',
    field: 'contactName',
    value: 'Synthetic Removed',
  });
  await seedObservation('kept', {
    entityType: 'researchEntity',
    entityKey: 'synthetic-lab',
    field: 'rosterEnrichment',
    value: {
      complete: true,
      undergraduates: [
        { name: 'Synthetic Peer' },
        { name: 'Synthetic Removed', profileUrl: REMOVED.profileUrl },
      ],
    },
  });
  await seedObservation('kept', {
    entityType: 'fellowship',
    entityKey: 'synthetic-fellowship',
    field: 'contactEmail',
    value: 'synthetic.office@example.test',
  });
});

describe('runDirectoryRemovalObservationPurge', () => {
  it('deletes nothing on a dry run and reports the plan by count only', async () => {
    const before = await remainingIds();
    const matcher = await loadDirectoryRemovalMatcher(KEYED_ENV);
    const result = await runDirectoryRemovalObservationPurge({ matcher, apply: false });

    expect(await remainingIds()).toEqual(before);
    expect(result.mode).toBe('dry-run');
    expect(result.deleted).toBeNull();
    expect(result.removalEntriesActive).toBe(2);
    expect(result.removedResearchersMatched).toBe(1);
    expect(result.toDelete.observations).toBe(expectedDeleted.length);
    expect(result.toDelete.byEntityType).toEqual({
      user: 8,
      researchGroupMember: 3,
      researchEntity: 4,
    });
    expect(result.toDelete.byIdentityForm).toEqual({ entityKey: 13, entityId: 1, both: 1 });
    expect(result.subjects.user).toEqual({
      removed: 4,
      identity_evidence_only: 0,
      name_only: 1,
      namesake: 1,
    });
    expect(result.subjects.researchGroupMember).toEqual({
      removed: 2,
      identity_evidence_only: 1,
      name_only: 0,
      namesake: 0,
    });
    expect(result.leftInPlace).toEqual({
      personObservationsBySubjectVerdict: {
        identity_evidence_only: { researchGroupMember: 1 },
        name_only: { user: 2 },
        namesake: { user: 2 },
      },
      rowObservationsByField: {
        contactName: { name_matched_left_in_place: 1 },
        rosterEnrichment: { name_matched_left_in_place: 1 },
      },
    });
    expect(JSON.stringify(result)).not.toMatch(
      new RegExp(`zz900|synthetic\\.removed|Synthetic Removed|${KEY}|[0-9a-f]{64}`, 'i'),
    );
  });

  it('deletes exactly the matched observations on --apply and leaves namesakes and others alone', async () => {
    const matcher = await loadDirectoryRemovalMatcher(KEYED_ENV);
    const result = await runDirectoryRemovalObservationPurge({ matcher, apply: true });

    expect(result.deleted).toBe(expectedDeleted.length);
    expect(await remainingIds()).toEqual([...expectedKept].sort());

    const rerun = await runDirectoryRemovalObservationPurge({ matcher, apply: true });
    expect(rerun.deleted).toBe(0);
  });

  it('refuses when the key is missing or the list holds no active entry', async () => {
    const keyless = await loadDirectoryRemovalMatcher({} as NodeJS.ProcessEnv);
    await expect(
      runDirectoryRemovalObservationPurge({ matcher: keyless, apply: true }),
    ).rejects.toThrow(/DIRECTORY_REMOVAL_KEY/);

    await DirectoryRemoval.collection.updateMany({}, { $set: { withdrawnAt: new Date() } });
    const empty = await loadDirectoryRemovalMatcher(KEYED_ENV);
    await expect(
      runDirectoryRemovalObservationPurge({ matcher: empty, apply: true }),
    ).rejects.toThrow(/no active directory_removals entry/);
    expect((await remainingIds()).length).toBe(expectedDeleted.length + expectedKept.length);
  });
});

import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertBackfillPersonDisplayFieldsApplyAllowed,
  backfillPersonDisplayFields,
  parseBackfillPersonDisplayFieldsArgs,
} from '../backfillPersonDisplayFields';
import {
  assertBackfillUpdateIsDisplayOnly,
  composeDisplayProfileFromLegacy,
  displayProfileFillUpdate,
} from '../backfillPersonDisplayFieldsCore';

describe('backfillPersonDisplayFields CLI helpers', () => {
  it('defaults to a dry-run and parses apply safety flags', () => {
    expect(parseBackfillPersonDisplayFieldsArgs([])).toEqual({
      apply: false,
      confirmBackfillPersonDisplayFields: false,
    });
    expect(
      parseBackfillPersonDisplayFieldsArgs(['--apply', '--confirm-backfill-person-display-fields']),
    ).toEqual({
      apply: true,
      confirmBackfillPersonDisplayFields: true,
    });
  });

  it('rejects malformed CLI arguments', () => {
    expect(() => parseBackfillPersonDisplayFieldsArgs(['prod'])).toThrow(
      /Unknown backfill:person-display-fields argument: prod/,
    );
    expect(() =>
      parseBackfillPersonDisplayFieldsArgs(['--confirm-backfill-person-display-fields=1']),
    ).toThrow(/does not accept a value/);
  });

  it('requires confirmation when applying', () => {
    expect(() =>
      assertBackfillPersonDisplayFieldsApplyAllowed({
        apply: true,
        confirmBackfillPersonDisplayFields: false,
      }),
    ).toThrow(/--confirm-backfill-person-display-fields is required/);
    expect(() =>
      assertBackfillPersonDisplayFieldsApplyAllowed({
        apply: false,
        confirmBackfillPersonDisplayFields: false,
      }),
    ).not.toThrow();
  });
});

describe('backfillPersonDisplayFields core', () => {
  it('prefers user values over faculty fallback and cleans empties', () => {
    const composed = composeDisplayProfileFromLegacy({
      user: {
        title: '  Professor of Testing  ',
        primaryDepartment: '',
        imageUrl: 'https://img.example.test/u.png',
        website: undefined,
      },
      facultyMember: {
        title: 'Faculty Fallback Title',
        primarySchool: 'School of Fallback',
        photoUrl: 'https://img.example.test/f.png',
        websiteUrl: 'https://faculty.example.test',
      },
    });
    expect(composed).toEqual({
      title: 'Professor of Testing',
      primaryDepartment: 'School of Fallback',
      imageUrl: 'https://img.example.test/u.png',
      websiteUrl: 'https://faculty.example.test',
    });
  });

  it('truncates oversize display values to their schema bounds', () => {
    const composed = composeDisplayProfileFromLegacy({
      user: {
        title: 't'.repeat(300),
        primaryDepartment: 'd'.repeat(300),
        imageUrl: `https://img.example.test/${'a'.repeat(3000)}`,
        website: `https://site.example.test/${'b'.repeat(3000)}`,
      },
    });
    expect(composed.title).toHaveLength(240);
    expect(composed.primaryDepartment).toHaveLength(240);
    expect(composed.imageUrl).toHaveLength(2048);
    expect(composed.websiteUrl).toHaveLength(2048);

    const update = displayProfileFillUpdate(undefined, composed);
    expect(update.imageUrl).toHaveLength(2048);
    expect(update.title).toHaveLength(240);
  });

  it('only fills fields that are currently empty', () => {
    const update = displayProfileFillUpdate(
      { title: 'Existing Title', primaryDepartment: '' },
      {
        title: 'New Title',
        primaryDepartment: 'New Dept',
        imageUrl: 'https://img.example.test/u.png',
      },
    );
    expect(update).toEqual({
      primaryDepartment: 'New Dept',
      imageUrl: 'https://img.example.test/u.png',
    });
  });

  it('rejects update documents that touch non-profile fields', () => {
    expect(() =>
      assertBackfillUpdateIsDisplayOnly({ 'profile.title': 'ok', displayName: 'no' }),
    ).toThrow(/non-profile field "displayName"/);
    expect(() =>
      assertBackfillUpdateIsDisplayOnly({ 'profile.title': 'ok', 'profile.imageUrl': 'ok' }),
    ).not.toThrow();
  });
});

describe('backfillPersonDisplayFields apply', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['accounts', 'users', 'faculty_members', 'researchers']) {
      await db.collection(name).deleteMany({});
    }
  });

  it('fills empty display fields from the linked user without clobbering or touching identity', async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');

    const accountId = new mongoose.Types.ObjectId();
    const facultyMemberId = new mongoose.Types.ObjectId();
    const personId = new mongoose.Types.ObjectId();

    await db.collection('accounts').insertOne({
      _id: accountId,
      netid: 'ab123',
      email: 'ab123@example.test',
      status: 'ACTIVE',
      archived: false,
    });
    await db.collection('faculty_members').insertOne({
      _id: facultyMemberId,
      title: 'Faculty Fallback Title',
      primarySchool: 'School of Fallback',
      photoUrl: 'https://img.example.test/f.png',
      websiteUrl: 'https://faculty.example.test',
    });
    await db.collection('users').insertOne({
      netid: 'ab123',
      title: 'Professor of Testing',
      primaryDepartment: 'Department of Testing',
      imageUrl: 'https://img.example.test/u.png',
      website: 'https://user.example.test',
      facultyMemberId,
    });
    await db.collection('researchers').insertOne({
      _id: personId,
      schemaVersion: 1,
      displayName: 'Synthetic Person',
      accountId,
      profileLinks: [],
      profile: { title: 'Existing Title' },
      status: 'ACTIVE',
      archived: false,
    });

    const orphanAccountId = new mongoose.Types.ObjectId();
    const orphanPersonId = new mongoose.Types.ObjectId();
    await db.collection('accounts').insertOne({
      _id: orphanAccountId,
      netid: 'zz999',
      email: 'zz999@example.test',
      status: 'ACTIVE',
      archived: false,
    });
    await db.collection('researchers').insertOne({
      _id: orphanPersonId,
      schemaVersion: 1,
      displayName: 'Orphan Person',
      accountId: orphanAccountId,
      profileLinks: [],
      status: 'ACTIVE',
      archived: false,
    });

    const dryRun = await backfillPersonDisplayFields({ apply: false });
    expect(dryRun.mode).toBe('dry-run');
    expect(dryRun.peopleUpdated).toBe(1);
    const untouched = await db.collection('researchers').findOne({ _id: personId });
    expect(untouched?.profile?.primaryDepartment).toBeUndefined();

    const result = await backfillPersonDisplayFields({ apply: true });
    expect(result.mode).toBe('apply');
    expect(result.peopleScanned).toBe(2);
    expect(result.peopleWithLegacyMatch).toBe(1);
    expect(result.peopleUpdated).toBe(1);
    expect(result.populatedByField.title).toBe(0);
    expect(result.populatedByField.primaryDepartment).toBe(1);
    expect(result.populatedByField.imageUrl).toBe(1);
    expect(result.populatedByField.websiteUrl).toBe(1);

    const updated = await db.collection('researchers').findOne({ _id: personId });
    expect(updated?.profile?.title).toBe('Existing Title');
    expect(updated?.profile?.primaryDepartment).toBe('Department of Testing');
    expect(updated?.profile?.imageUrl).toBe('https://img.example.test/u.png');
    expect(updated?.profile?.websiteUrl).toBe('https://user.example.test');
    expect(updated?.displayName).toBe('Synthetic Person');
    expect(updated?.accountId?.toString()).toBe(accountId.toString());
    expect(updated?.status).toBe('ACTIVE');

    const orphan = await db.collection('researchers').findOne({ _id: orphanPersonId });
    expect(orphan?.profile).toBeUndefined();
  });
});

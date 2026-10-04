import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { LoginSignalTally } from '../../models/loginSignalTally';
import { loginSignalBuckets } from '../../models/storedVocabularies';
import { loginSignalBucketForLookup, recordLoginSignal } from '../loginSignalTallyService';

let memoryServer: MongoMemoryServer | undefined;

const day = new Date('2026-10-04T15:30:00Z');

describe('the login signal tally', () => {
  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri('login_signal_tally_test'));
  });

  beforeEach(async () => {
    await LoginSignalTally.collection.deleteMany({});
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryServer?.stop();
  });

  it('stores only the date and integer counts, one document per UTC day', async () => {
    await recordLoginSignal('undergrad_usable_major', day);
    await recordLoginSignal('undergrad_usable_major', day);
    await recordLoginSignal('grad_with_curriculum', day);
    await recordLoginSignal('yalies_unavailable', new Date('2026-10-05T00:00:01Z'));

    const stored = await LoginSignalTally.collection.find({}).sort({ date: 1 }).toArray();

    expect(stored).toHaveLength(2);
    const allowed = new Set(['_id', 'date', ...loginSignalBuckets]);
    for (const doc of stored) {
      for (const key of Object.keys(doc)) expect(allowed.has(key)).toBe(true);
      for (const bucket of loginSignalBuckets) {
        if (bucket in doc) expect(Number.isInteger(doc[bucket])).toBe(true);
      }
    }
    expect(stored[0]).toMatchObject({
      date: '2026-10-04',
      undergrad_usable_major: 2,
      grad_with_curriculum: 1,
    });
    expect(stored[1]).toMatchObject({ date: '2026-10-05', yalies_unavailable: 1 });
  });

  it('never stores a field the schema does not declare', () => {
    const declared = Object.keys(LoginSignalTally.schema.paths).sort();
    expect(declared).toEqual(['_id', 'date', ...loginSignalBuckets].sort());
  });

  it('swallows a write failure without logging anything about the login', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const updateOne = vi
      .spyOn(LoginSignalTally, 'updateOne')
      .mockRejectedValueOnce(new Error('synthetic write failure'));

    await expect(recordLoginSignal('undergrad_no_major', day)).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledWith('Login signal tally write failed');
    updateOne.mockRestore();
    error.mockRestore();
  });

  it('maps every lookup outcome to exactly one bucket', () => {
    expect(loginSignalBucketForLookup({ kind: 'unavailable' })).toBe('yalies_unavailable');
    expect(loginSignalBucketForLookup({ kind: 'not_found' })).toBe('yalies_not_found');
    expect(
      loginSignalBucketForLookup({
        kind: 'employee',
        employee: {
          netid: 'fixturenetid',
          fname: 'Fixture',
          lname: 'Person',
          email: 'fixture.person@example.invalid',
          title: 'Synthetic Title',
          department: '',
        },
      }),
    ).toBe('other_or_faculty');
  });
});

describe('the login signal tally while Mongo is disconnected', () => {
  it('skips the write instead of buffering it behind a login', async () => {
    const updateOne = vi.spyOn(LoginSignalTally, 'updateOne');
    await recordLoginSignal('undergrad_no_major', day);
    expect(updateOne).not.toHaveBeenCalled();
    updateOne.mockRestore();
  });
});

import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clearC4Flags } from './c4FlagTestEnv';

import { Observation } from '../../models/observation';
import { appendObservations } from '../observationStore';
import type { ObservationInput } from '../types';

beforeEach(clearC4Flags);

const LANE = 'fixture-profile-lane';
const OTHER_LANE = 'fixture-roster-lane';
const SUBJECT_KEY = 'netid:fx1001';
const PAGE = 'https://example.edu/people/fixture-person';
const OTHER_PAGE = 'https://example.edu/directory/fixture-person';
const FIRST = 'first.address@example.edu';
const SECOND = 'second.address@example.edu';
const REPLACEMENT = 'replacement.address@example.edu';

const sourceId = new mongoose.Types.ObjectId();

let clock = Date.parse('2026-01-01T00:00:00Z');

async function read(
  values: string[],
  opts: {
    sourceName?: string;
    sourceUrl?: string;
    entityKey?: string;
    entityId?: string;
    runId?: mongoose.Types.ObjectId;
    extra?: ObservationInput[];
  } = {},
) {
  clock += 60_000;
  const observedAt = new Date(clock);
  const runId = opts.runId ?? new mongoose.Types.ObjectId();
  const inputs: ObservationInput[] = values.map((value) => ({
    entityType: 'user',
    ...(opts.entityId ? { entityId: opts.entityId } : {}),
    ...(opts.entityKey === '' ? {} : { entityKey: opts.entityKey ?? SUBJECT_KEY }),
    field: 'email',
    value,
    sourceUrl: opts.sourceUrl ?? PAGE,
    observedAt,
  }));
  await appendObservations([...inputs, ...(opts.extra ?? [])], {
    scrapeRunId: String(runId),
    sourceId: String(sourceId),
    sourceName: opts.sourceName ?? LANE,
    sourceWeight: 0.9,
    dryRun: false,
  });
  return runId;
}

async function liveEmails(filter: Record<string, unknown> = {}): Promise<string[]> {
  const rows = await Observation.find({
    entityType: 'user',
    field: 'email',
    superseded: false,
    ...filter,
  })
    .select('value')
    .lean();
  return rows.map((row) => String((row as { value?: unknown }).value)).sort();
}

describe('a newer read of a page replaces the emails it no longer states (#5705)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    await mongoose.connection.db?.collection('observations').deleteMany({});
  });

  it('retires the earlier-run address when a newer read states a different one', async () => {
    await read([FIRST]);
    await read([REPLACEMENT]);

    expect(await liveEmails()).toEqual([REPLACEMENT]);
    const retired = await Observation.findOne({ value: FIRST }).lean();
    expect(retired?.superseded).toBe(true);
    expect(retired?.rollback?.reason).toContain('#5705');
  });

  it('changes nothing when the same read is run twice', async () => {
    await read([REPLACEMENT]);
    await read([REPLACEMENT]);
    const before = await Observation.countDocuments({ 'rollback.rolledBackAt': { $exists: true } });
    await read([REPLACEMENT]);

    expect(await liveEmails()).toEqual([REPLACEMENT]);
    expect(await Observation.countDocuments({ 'rollback.rolledBackAt': { $exists: true } })).toBe(
      before,
    );
  });

  it('keeps both addresses one read states, and a later read stating both supersedes neither', async () => {
    await read([FIRST, SECOND]);
    expect(await liveEmails()).toEqual([FIRST, SECOND]);

    await read([SECOND, FIRST]);
    expect(await liveEmails()).toEqual([FIRST, SECOND]);
    expect(await Observation.countDocuments({ 'rollback.rolledBackAt': { $exists: true } })).toBe(
      0,
    );
  });

  it('retires the other address when a newer read states only one of the two', async () => {
    await read([FIRST, SECOND]);
    await read([SECOND]);

    expect(await liveEmails()).toEqual([SECOND]);
  });

  it('keeps every address when a newer read of the page states no email', async () => {
    await read([FIRST]);
    await read([], {
      extra: [
        {
          entityType: 'user',
          entityKey: SUBJECT_KEY,
          field: 'name',
          value: 'Fixture Person',
          sourceUrl: PAGE,
        },
      ],
    });

    expect(await liveEmails()).toEqual([FIRST]);
  });

  it('never touches another lane or another page', async () => {
    await read([FIRST], { sourceName: OTHER_LANE });
    await read([FIRST], { sourceUrl: OTHER_PAGE });
    await read([REPLACEMENT]);

    expect(await liveEmails({ sourceName: OTHER_LANE })).toEqual([FIRST]);
    expect(await liveEmails({ sourceUrl: OTHER_PAGE })).toEqual([FIRST]);
    expect(await liveEmails({ sourceName: LANE, sourceUrl: PAGE })).toEqual([REPLACEMENT]);
  });

  it('does not let rows of the same run retire each other across batches', async () => {
    const runId = await read([FIRST]);
    await read([SECOND], { runId });

    expect(await liveEmails()).toEqual([FIRST, SECOND]);
  });

  it('matches an earlier row stored under the other identity form', async () => {
    const entityId = String(new mongoose.Types.ObjectId());
    await read([FIRST], { entityId, entityKey: '' });
    await read([REPLACEMENT], { entityId, entityKey: SUBJECT_KEY });
    expect(await liveEmails()).toEqual([REPLACEMENT]);

    await read([SECOND], { entityKey: SUBJECT_KEY });
    expect(await liveEmails()).toEqual([SECOND]);
  });
});

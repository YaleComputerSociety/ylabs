import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Observation } from '../../models/observation';
import { appendObservations, buildObservationFingerprint } from '../observationStore';
import { plannedOutputFingerprint } from '../../scripts/laneScorecardCore';
import type { ObservationInput } from '../types';

const ENTITY_KEY = 'netid:mk5578';
const PROFILE_PAGE = 'https://fixture-dept.yale.edu/people/marlo-kestrel';

const unmarked: ObservationInput = {
  entityType: 'user',
  entityKey: ENTITY_KEY,
  field: 'title',
  value: 'Associate Professor of Fixture Studies',
  sourceUrl: PROFILE_PAGE,
};
const marked: ObservationInput = { ...unmarked, extraction: { source: 'profileTitleBlock' } };

const PINNED_FINGERPRINT =
  '["associate professor of fixture studies","dept-faculty-roster","key:netid:mk5578","title","user"]';

describe('the observation extraction marker (#5578)', () => {
  let replSet: MongoMemoryReplSet;
  const sourceId = new mongoose.Types.ObjectId();

  const append = (input: ObservationInput) =>
    appendObservations([input], {
      scrapeRunId: String(new mongoose.Types.ObjectId()),
      sourceId: String(sourceId),
      sourceName: 'dept-faculty-roster',
      sourceWeight: 0.7,
      dryRun: false,
    });

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

  it('stores the marker beside the value', async () => {
    await append(marked);

    const stored: any = await Observation.findOne({ entityKey: ENTITY_KEY }).lean();
    expect(stored.extraction).toEqual({ source: 'profileTitleBlock' });
  });

  it('leaves the fingerprint of an existing observation unchanged', async () => {
    await append(unmarked);
    await append(marked);

    const rows: any[] = await Observation.find({ entityKey: ENTITY_KEY })
      .sort({ observedAt: 1, _id: 1 })
      .lean();
    expect(rows.map((row) => row.observationFingerprint)).toEqual([
      PINNED_FINGERPRINT,
      PINNED_FINGERPRINT,
    ]);
    expect(rows.map((row) => row.superseded)).toEqual([true, false]);
    expect(String(rows[0].supersededBy)).toBe(String(rows[1]._id));
  });

  it('fingerprints and hashes two observations that differ only in the marker identically', () => {
    const identity = { sourceName: 'dept-faculty-roster', ...unmarked };
    expect(buildObservationFingerprint(identity)).toBe(PINNED_FINGERPRINT);
    expect(buildObservationFingerprint({ ...identity, ...marked } as typeof identity)).toBe(
      PINNED_FINGERPRINT,
    );
    expect(plannedOutputFingerprint([marked])).toBe(plannedOutputFingerprint([unmarked]));
  });

  it('refuses a marker outside the enum', async () => {
    const outsideTheEnum: Record<string, unknown> = {
      ...unmarked,
      sourceId,
      sourceName: 'dept-faculty-roster',
      confidence: 0.7,
      extraction: { source: 'somewhereElse' },
    };
    await expect(Observation.create(outsideTheEnum)).rejects.toThrow(/extraction/);
  });
});

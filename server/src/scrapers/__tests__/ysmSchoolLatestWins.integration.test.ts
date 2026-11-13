import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clearC4Flags } from './c4FlagTestEnv';

import { Observation } from '../../models/observation';
import { appendObservations } from '../observationStore';

const SLUG = 'ysm-faculty-fixture-latest-wins-school';
const PROFILE_URL = 'https://medicine.yale.edu/profile/fixture-latest-wins-school/';

const readSchool = (sourceName: string, school: string, observedAt: string) =>
  appendObservations(
    [
      {
        entityType: 'researchEntity' as const,
        entityKey: SLUG,
        field: 'school',
        value: school,
        sourceUrl: PROFILE_URL,
        observedAt: new Date(observedAt),
      },
    ],
    {
      scrapeRunId: String(new mongoose.Types.ObjectId()),
      sourceId: String(new mongoose.Types.ObjectId()),
      sourceName,
      sourceWeight: 0.8,
      dryRun: false,
    },
  );

const liveSchools = async (sourceName: string) =>
  (
    await Observation.find({ sourceName, field: 'school', superseded: false })
      .select('value')
      .lean()
  ).map((row: any) => row.value);

describe('a YSM profile states one school, so a changed school replaces the earlier one (#6160)', () => {
  let replSet: MongoMemoryReplSet | undefined;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    clearC4Flags();
    await Observation.deleteMany({});
  });

  it('supersedes the earlier school when the profile now states another one', async () => {
    await readSchool('ysm-faculty-directory', 'Yale School of Medicine', '2026-01-01T00:00:00Z');
    await readSchool('ysm-faculty-directory', 'School of Public Health', '2026-02-01T00:00:00Z');

    expect(await liveSchools('ysm-faculty-directory')).toEqual(['School of Public Health']);
  });

  it('leaves another source that states two schools for one row as two readings', async () => {
    await readSchool('fixture-roster-source', 'School of Medicine', '2026-01-01T00:00:00Z');
    await readSchool('fixture-roster-source', 'School of Public Health', '2026-02-01T00:00:00Z');

    expect((await liveSchools('fixture-roster-source')).sort()).toEqual([
      'School of Medicine',
      'School of Public Health',
    ]);
  });
});

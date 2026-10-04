import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clearC4Flags } from './c4FlagTestEnv';

import { Observation } from '../../models/observation';
import { appendObservations, collapseLatestWins } from '../observationStore';

const SLUG = 'fixture-latest-wins-name-row';
const PAGE_URL = 'https://example.edu/fixture-lab/';
const DESCRIPTION_LANE = 'lab-microsite-description-llm';
const OTHER_SOURCE = 'fixture-directory-source';

const readNamed = (sourceName: string, name: string | null, observedAt: string) =>
  appendObservations(
    name === null
      ? [
          {
            entityType: 'researchEntity' as const,
            entityKey: SLUG,
            field: 'methods',
            value: ['two-photon imaging'],
            sourceUrl: PAGE_URL,
            observedAt: new Date(observedAt),
          },
        ]
      : (['name', 'displayName'] as const).map((field) => ({
          entityType: 'researchEntity' as const,
          entityKey: SLUG,
          field,
          value: name,
          sourceUrl: PAGE_URL,
          observedAt: new Date(observedAt),
        })),
    {
      scrapeRunId: String(new mongoose.Types.ObjectId()),
      sourceId: String(new mongoose.Types.ObjectId()),
      sourceName,
      sourceWeight: 0.8,
      dryRun: false,
    },
  );

const liveValues = async (sourceName: string, field: string) =>
  (await Observation.find({ sourceName, field, superseded: false }).select('value').lean()).map(
    (row: any) => row.value,
  );

describe('a description-lane re-read supersedes the name its earlier read asserted (#3925)', () => {
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

  it('keeps one live lane name when a later read names the row differently', async () => {
    await readNamed(DESCRIPTION_LANE, 'Fixture Imaging Laboratory', '2026-01-01T00:00:00Z');
    await readNamed(DESCRIPTION_LANE, 'Fixture Neuroimaging Lab', '2026-02-01T00:00:00Z');

    expect(await liveValues(DESCRIPTION_LANE, 'name')).toEqual(['Fixture Neuroimaging Lab']);
    expect(await liveValues(DESCRIPTION_LANE, 'displayName')).toEqual(['Fixture Neuroimaging Lab']);
  });

  it('leaves the earlier name live when a later read asserts no name', async () => {
    await readNamed(DESCRIPTION_LANE, 'Fixture Imaging Laboratory', '2026-01-01T00:00:00Z');
    await readNamed(DESCRIPTION_LANE, null, '2026-02-01T00:00:00Z');

    expect(await liveValues(DESCRIPTION_LANE, 'name')).toEqual(['Fixture Imaging Laboratory']);
  });

  it('leaves other sources keeping every distinct name they asserted', async () => {
    await readNamed(OTHER_SOURCE, 'Fixture Imaging Laboratory', '2026-01-01T00:00:00Z');
    await readNamed(OTHER_SOURCE, 'Fixture Neuroimaging Lab', '2026-02-01T00:00:00Z');

    expect((await liveValues(OTHER_SOURCE, 'name')).sort()).toEqual([
      'Fixture Imaging Laboratory',
      'Fixture Neuroimaging Lab',
    ]);
  });

  it('reads only the newest lane name from a log that still holds two', () => {
    const collapsed = collapseLatestWins(
      [
        {
          field: 'name',
          sourceName: DESCRIPTION_LANE,
          value: 'Fixture Imaging Laboratory',
          observedAt: new Date('2026-01-01T00:00:00Z'),
        },
        {
          field: 'name',
          sourceName: DESCRIPTION_LANE,
          value: 'Fixture Neuroimaging Lab',
          observedAt: new Date('2026-02-01T00:00:00Z'),
        },
        {
          field: 'name',
          sourceName: OTHER_SOURCE,
          value: 'Fixture Imaging Laboratory',
          observedAt: new Date('2026-01-01T00:00:00Z'),
        },
      ],
      'researchEntity',
    );
    expect(collapsed.map((row) => `${row.sourceName}:${row.value}`)).toEqual([
      `${DESCRIPTION_LANE}:Fixture Neuroimaging Lab`,
      `${OTHER_SOURCE}:Fixture Imaging Laboratory`,
    ]);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = {
  created: [] as Array<Record<string, unknown>>,
  newest: null as { measuredAt: Date } | null,
  reportCalls: 0,
};

vi.mock('../../models/corpusQualitySnapshot', () => ({
  CORPUS_QUALITY_SNAPSHOT_COLLECTION: 'corpus_quality_snapshots',
  CorpusQualitySnapshot: {
    findOne: () => ({
      sort: () => ({
        select: () => ({
          lean: async () => mocks.newest,
        }),
      }),
    }),
    create: async (row: Record<string, unknown>) => {
      mocks.created.push(row);
      return row;
    },
  },
}));

vi.mock('../corpusQualityReport', () => ({
  readCorpusQualityReport: async (generatedAt: Date) => {
    mocks.reportCalls += 1;
    return {
      generatedAt: generatedAt.toISOString(),
      surface: 'served rows',
      coverage: { entities: 1, archived: 0, studentReady: 1, byTier: [], studentReadyBySchool: [] },
      richness: {},
      description: {},
      integrity: {},
    };
  },
}));

const {
  corpusSnapshotMaxAgeMs,
  corpusSnapshotSchedulerEnabled,
  connectedOperatorEnvironment,
  recordCorpusQualitySnapshotIfStale,
} = await import('../corpusQualitySnapshotScheduler');

const NOW = new Date('2026-09-15T12:00:00.000Z');
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);

beforeEach(() => {
  mocks.created = [];
  mocks.newest = null;
  mocks.reportCalls = 0;
});

describe('corpusSnapshotSchedulerEnabled', () => {
  it('is on by default, because a measurement nobody remembers to take is the problem', () => {
    expect(corpusSnapshotSchedulerEnabled({} as NodeJS.ProcessEnv)).toBe(true);
  });

  it('is off under test so a suite never writes a row', () => {
    expect(corpusSnapshotSchedulerEnabled({ NODE_ENV: 'test' } as NodeJS.ProcessEnv)).toBe(false);
  });

  it('can be disabled explicitly', () => {
    expect(
      corpusSnapshotSchedulerEnabled({ CORPUS_SNAPSHOT_DISABLED: 'true' } as NodeJS.ProcessEnv),
    ).toBe(false);
  });
});

describe('corpusSnapshotMaxAgeMs', () => {
  it('defaults to a day', () => {
    expect(corpusSnapshotMaxAgeMs({} as NodeJS.ProcessEnv)).toBe(24 * 3_600_000);
  });

  it('clamps an absurd override rather than trusting it', () => {
    expect(
      corpusSnapshotMaxAgeMs({ CORPUS_SNAPSHOT_MAX_AGE_HOURS: '0' } as NodeJS.ProcessEnv),
    ).toBe(24 * 3_600_000);
    expect(
      corpusSnapshotMaxAgeMs({ CORPUS_SNAPSHOT_MAX_AGE_HOURS: '100000' } as NodeJS.ProcessEnv),
    ).toBe(24 * 30 * 3_600_000);
  });
});

describe('connectedOperatorEnvironment', () => {
  it('discovers the environment from the connected database name', () => {
    expect(connectedOperatorEnvironment('Development')).toBe('development');
    expect(connectedOperatorEnvironment('Beta')).toBe('beta');
    expect(connectedOperatorEnvironment('Prod')).toBe('production');
  });

  it('returns undefined for a database it cannot place, so nothing is mislabelled', () => {
    expect(connectedOperatorEnvironment('SomeOtherDb')).toBeUndefined();
    expect(connectedOperatorEnvironment(undefined)).toBeUndefined();
  });
});

describe('recordCorpusQualitySnapshotIfStale', () => {
  const call = () =>
    recordCorpusQualitySnapshotIfStale({
      environment: 'development',
      databaseName: 'Development',
      maxAgeMs: 24 * 3_600_000,
      now: NOW,
    });

  it('records when no measurement exists', async () => {
    expect(await call()).toBe('recorded');
    expect(mocks.created).toHaveLength(1);
    expect(mocks.created[0]).toMatchObject({
      environment: 'development',
      databaseName: 'Development',
    });
  });

  it('records when the newest measurement is older than the maximum age', async () => {
    mocks.newest = { measuredAt: hoursAgo(25) };

    expect(await call()).toBe('recorded');
    expect(mocks.created).toHaveLength(1);
  });

  it('does nothing when a measurement is still fresh, and does not compute the report', async () => {
    mocks.newest = { measuredAt: hoursAgo(2) };

    expect(await call()).toBe('fresh');
    expect(mocks.created).toHaveLength(0);
    expect(mocks.reportCalls).toBe(0);
  });

  /**
   * A restart must not skip a day nor take a second measurement, which is the
   * reason this is staleness-driven rather than a daily timer.
   */
  it('is idempotent across a restart within the window', async () => {
    expect(await call()).toBe('recorded');
    mocks.newest = { measuredAt: new Date(mocks.created[0].measuredAt as Date) };

    expect(await call()).toBe('fresh');
    expect(mocks.created).toHaveLength(1);
  });
});

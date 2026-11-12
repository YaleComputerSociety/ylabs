import mongoose from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  assertLiveMissRerankOffForUnleasedScript,
  LiveMissRerankRefusedError,
} from '../liveMissRerankScriptGuard';

const searchWork = vi.hoisted(() => ({
  warmSpelling: vi.fn(async () => undefined),
  search: vi.fn(async () => ({ results: [], total: 0 })),
  connect: vi.fn(async () => undefined),
}));

vi.mock('../../db/connections', () => ({ initializeConnections: searchWork.connect }));
vi.mock('../../services/researchSearchSpellingVocabulary', () => ({
  warmResearchSearchSpellingVocabulary: searchWork.warmSpelling,
}));
vi.mock('../../services/researchGroupService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/researchGroupService')>()),
  searchResearchGroupsViaMeili: searchWork.search,
}));

const remoteConnection = (databaseName: string) => ({
  name: databaseName,
  host: 'cluster0.example.mongodb.net',
  db: { databaseName },
});

const flagOn = { SEARCH_RERANK_LIVE_MISS_ENABLED: 'true' } as NodeJS.ProcessEnv;

describe('assertLiveMissRerankOffForUnleasedScript', () => {
  it('refuses on Development while the live-miss flag is on', () => {
    expect(() =>
      assertLiveMissRerankOffForUnleasedScript(
        'journey:eval',
        remoteConnection('Development'),
        flagOn,
      ),
    ).toThrow(LiveMissRerankRefusedError);
  });

  it('names the leased seeding route in the refusal', () => {
    expect(() =>
      assertLiveMissRerankOffForUnleasedScript(
        'research-search:relevance',
        remoteConnection('Development'),
        flagOn,
      ),
    ).toThrow(/research-search:seed-rerank-cache --apply/);
  });

  it('allows the run when the live-miss flag is off', () => {
    expect(() =>
      assertLiveMissRerankOffForUnleasedScript('journey:eval', remoteConnection('Development'), {
        SEARCH_RERANK_LIVE_MISS_ENABLED: 'false',
      } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });

  it.each(['off', 'false', '0'])(
    'still refuses on Development when DEV_WRITE_LEASE=%s',
    (leaseSetting) => {
      expect(() =>
        assertLiveMissRerankOffForUnleasedScript('journey:eval', remoteConnection('Development'), {
          ...flagOn,
          DEV_WRITE_LEASE: leaseSetting,
        } as NodeJS.ProcessEnv),
      ).toThrow(LiveMissRerankRefusedError);
    },
  );

  it.each(['Beta', 'Prod', 'ylabs_test'])('allows the run against %s', (databaseName) => {
    expect(() =>
      assertLiveMissRerankOffForUnleasedScript(
        'journey:eval',
        remoteConnection(databaseName),
        flagOn,
      ),
    ).not.toThrow();
  });

  it('allows the run against a local database', () => {
    expect(() =>
      assertLiveMissRerankOffForUnleasedScript(
        'journey:eval',
        { name: 'scratch', host: 'localhost', db: { databaseName: 'scratch' } },
        flagOn,
      ),
    ).not.toThrow();
  });
});

describe('unleased search evaluation scripts on Development with the live-miss flag on', () => {
  const savedArgv = process.argv;
  const savedEnv = { ...process.env };
  const connection = mongoose.connection as unknown as { name: string; host: string };
  const savedName = connection.name;
  const savedHost = connection.host;

  beforeEach(() => {
    vi.clearAllMocks();
    process.argv = ['node', 'evaluation-script'];
    process.env.SEARCH_RERANK_LIVE_MISS_ENABLED = 'true';
    process.env.MONGODBURL = 'mongodb+srv://cluster0.example.mongodb.net/Development';
    process.env.MEILISEARCH_HOST = 'http://localhost:7700';
    searchWork.connect.mockImplementation(async () => {
      connection.name = 'Development';
      connection.host = 'cluster0.example.mongodb.net';
    });
  });

  afterEach(() => {
    process.argv = savedArgv;
    process.env = { ...savedEnv };
    connection.name = savedName;
    connection.host = savedHost;
  });

  it.each([
    ['journey:eval', () => import('../journeyEval/runJourneyEval')],
    ['research-search:relevance', () => import('../researchSearchRelevance')],
  ])('%s refuses after connecting and before any search runs', async (_name, load) => {
    const { main } = await load();

    await expect(main()).rejects.toBeInstanceOf(LiveMissRerankRefusedError);

    expect(searchWork.connect).toHaveBeenCalledTimes(1);
    expect(searchWork.warmSpelling).not.toHaveBeenCalled();
    expect(searchWork.search).not.toHaveBeenCalled();
  });
});

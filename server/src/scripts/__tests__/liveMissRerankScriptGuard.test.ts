import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assertLiveMissRerankOffForUnleasedScript,
  LiveMissRerankRefusedError,
} from '../liveMissRerankScriptGuard';

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

  it('allows the run when the write lease is switched off', () => {
    expect(() =>
      assertLiveMissRerankOffForUnleasedScript('journey:eval', remoteConnection('Development'), {
        ...flagOn,
        DEV_WRITE_LEASE: 'off',
      } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });

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

describe('live-miss rerank refusal wiring', () => {
  const scriptsDir = path.resolve(__dirname, '..');

  it.each([
    ['journeyEval/runJourneyEval.ts', 'journey:eval', 'warmResearchSearchSpellingVocabulary()'],
    [
      'researchSearchRelevance.ts',
      'research-search:relevance',
      'warmResearchSearchSpellingVocabulary()',
    ],
  ])(
    '%s refuses right after connecting, before any search runs',
    (file, scriptName, firstSearchWork) => {
      const source = readFileSync(path.join(scriptsDir, file), 'utf8');
      const connectAt = source.indexOf('await initializeConnections();');
      const guardAt = source.indexOf(`assertLiveMissRerankOffForUnleasedScript('${scriptName}')`);
      const searchAt = source.indexOf(firstSearchWork);
      expect(connectAt).toBeGreaterThan(-1);
      expect(guardAt).toBeGreaterThan(connectAt);
      expect(searchAt).toBeGreaterThan(guardAt);
    },
  );
});

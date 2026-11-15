import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const SERVER_SRC = path.resolve(__dirname, '../..');
const RAW_COUNT = 'observationCount';
const RECONCILED_COUNT = 'storedObservationCountAtReconcile';

const listTypeScript = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : listTypeScript(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') ? [full] : [];
  });

/**
 * A Mongoose `.select('a b c')` projection names its fields as one space-separated string, so a
 * select that names the raw run count is a loader of run write counts.
 */
const PROJECTION_STRING = /\.select\(\s*(['"`])([^'"`]+)\1/g;

/**
 * Loaders that read the raw count on purpose, each with its reason. An entry must still hold such
 * a projection, so it cannot outlive the code it excuses.
 */
const READS_THE_RAW_CLAIM_ON_PURPOSE: Record<string, string> = {
  'scripts/reconcileStaleScrapeRuns.ts':
    'the reconciler compares the run claim against its own recount, which is what produces the reconciled count',
};

function projectionsMissingReconciledCount(source: string): string[] {
  return Array.from(source.matchAll(PROJECTION_STRING), (match) => match[2])
    .map((fields) => fields.trim().split(/\s+/))
    .filter((fields) => fields.includes(RAW_COUNT) && !fields.includes(RECONCILED_COUNT))
    .map((fields) => fields.join(' '));
}

describe('every loader of a run write count also loads the reconciled count (#6291)', () => {
  it('finds no projection that loads observationCount without storedObservationCountAtReconcile', () => {
    const offenders = listTypeScript(SERVER_SRC)
      .filter(
        (file) => !Object.hasOwn(READS_THE_RAW_CLAIM_ON_PURPOSE, path.relative(SERVER_SRC, file)),
      )
      .flatMap((file) =>
        projectionsMissingReconciledCount(fs.readFileSync(file, 'utf8')).map(
          (fields) => `${path.relative(SERVER_SRC, file)}: '${fields}'`,
        ),
      );

    // A projection that silently stops loading the field puts its consumer back on the raw
    // count, which a crashed run can leave at 0 while its writes exist, with every other test
    // still green, because those hand runs to the consumers in memory.
    expect(offenders).toEqual([]);
  });

  it('excuses only loaders that still read the raw claim, each with a reason', () => {
    for (const [file, reason] of Object.entries(READS_THE_RAW_CLAIM_ON_PURPOSE)) {
      expect(reason.trim(), file).not.toBe('');
      const source = fs.readFileSync(path.join(SERVER_SRC, file), 'utf8');
      expect(projectionsMissingReconciledCount(source), file).not.toEqual([]);
    }
  });

  it('flags a projection that loads the raw count alone, and passes one that loads both', () => {
    expect(
      projectionsMissingReconciledCount(`.select('sourceName status observationCount')`),
    ).toEqual(['sourceName status observationCount']);
    expect(
      projectionsMissingReconciledCount(
        `.select('status observationCount storedObservationCountAtReconcile')`,
      ),
    ).toEqual([]);
    expect(projectionsMissingReconciledCount(`log('observationCount is zero')`)).toEqual([]);
    expect(
      projectionsMissingReconciledCount(`.select(
        'sourceName observationCount',
      )`),
    ).toEqual(['sourceName observationCount']);
  });

  it('still finds the loaders it was written for', () => {
    const loaders = listTypeScript(SERVER_SRC).filter((file) =>
      Array.from(fs.readFileSync(file, 'utf8').matchAll(PROJECTION_STRING), (m) => m[2]).some(
        (fields) => fields.trim().split(/\s+/).includes(RECONCILED_COUNT),
      ),
    );
    expect(loaders.map((file) => path.relative(SERVER_SRC, file)).sort()).toEqual(
      expect.arrayContaining([
        'scrapers/sourceYieldGuard.ts',
        'scripts/betaDataQuality.ts',
        'scripts/sourceHealth.ts',
        'services/adminOperatorBoardService.ts',
      ]),
    );
  });
});

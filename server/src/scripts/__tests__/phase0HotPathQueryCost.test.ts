import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { writePhase0HotPathQueryCostReport } from '../phase0HotPathQueryCost';
import type { Phase0HotPathQueryCostReport } from '../phase0HotPathQueryCostCore';

function fixtureReport(): Phase0HotPathQueryCostReport {
  return {
    schemaVersion: 1,
    artifactType: 'phase0-hot-path-query-cost',
    generatedAt: '2026-07-28T12:00:00.000Z',
    sourceCommit: 'c2478017eddeeb289f834d1498ce24375a0175c6',
    environment: 'development',
    databaseName: 'Development',
    mongo: {
      serverVersion: '8.0.0',
      readPreference: 'secondaryPreferred',
      maxTimeMS: 5000,
      commentPrefix: 'ylabs-phase0-hotpath',
    },
    fixtures: {
      browseEntityCount: 0,
      typicalEntityAvailable: false,
      highFanoutEntityAvailable: false,
      ordinaryOpportunityAvailable: false,
      highEvidenceOpportunityAvailable: false,
      accountFixtureClasses: [],
      adminSearchFixtureAvailable: false,
    },
    indexes: [],
    queries: [],
    summary: {
      expectedQueryShapes: 0,
      measuredQueryShapes: 0,
      fixtureUnavailableQueryShapes: 0,
      errorQueryShapes: 0,
      collectionScans: 0,
      blockingSorts: 0,
      diskSpills: 0,
      amplifiedQueryShapes: 0,
      uncoveredLabels: [],
      reviewRequired: false,
    },
  };
}

describe('Phase 0 hot-path query-cost artifact writer', () => {
  it('writes a new mode-0600 artifact and refuses overwrite', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-phase0-query-cost-'));
    const output = path.join(directory, 'query-cost.json');

    const receipt = writePhase0HotPathQueryCostReport(fixtureReport(), output);

    expect(receipt).toMatchObject({ output });
    expect(receipt.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt.bytes).toBeGreaterThan(0);
    expect(fs.statSync(output).mode & 0o777).toBe(0o600);
    expect(() => writePhase0HotPathQueryCostReport(fixtureReport(), output)).toThrow(
      /EEXIST|file already exists/i,
    );
  });

  it('refuses a symlink output', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-phase0-query-cost-link-'));
    const target = path.join(directory, 'target.json');
    const output = path.join(directory, 'query-cost.json');
    fs.writeFileSync(target, '{}\n', { mode: 0o600 });
    fs.symlinkSync(target, output);

    expect(() => writePhase0HotPathQueryCostReport(fixtureReport(), output)).toThrow(
      /EEXIST|symbolic link/i,
    );
  });
});

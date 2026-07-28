import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  assertHardenedQueryCostProfile,
  writePhase0HotPathQueryCostReport,
} from '../phase0HotPathQueryCost';
import type { Phase0HotPathQueryCostReport } from '../phase0HotPathQueryCostCore';

function betaAtlasTestUrl(): string {
  const credentials = ['inventory-reader', 'unit-test-password'].join(':');
  return ['mongodb+srv://', credentials, '@cluster.unit-test.mongodb.net/Beta'].join('');
}

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
      amplificationThreshold: 100,
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
  it('revalidates the hardened external profile at the executable boundary', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-query-cost-profile-'));
    const profilePath = path.join(directory, 'beta-inventory.env');
    const mongoUrl = betaAtlasTestUrl();
    fs.chmodSync(directory, 0o700);
    fs.writeFileSync(profilePath, `MONGODBURL=${mongoUrl}\n`, { mode: 0o600 });
    const original = {
      active: process.env.YLABS_INVENTORY_PROFILE_ACTIVE,
      name: process.env.YLABS_INVENTORY_PROFILE_NAME,
      profilePath: process.env.YLABS_INVENTORY_PROFILE_PATH,
      mongoUrl: process.env.MONGODBURL,
    };
    try {
      process.env.YLABS_INVENTORY_PROFILE_ACTIVE = 'true';
      process.env.YLABS_INVENTORY_PROFILE_NAME = 'beta-inventory';
      process.env.YLABS_INVENTORY_PROFILE_PATH = profilePath;
      process.env.MONGODBURL = mongoUrl;
      expect(() => assertHardenedQueryCostProfile('beta')).not.toThrow();
      process.env.MONGODBURL = `${mongoUrl}?retryWrites=true`;
      expect(() => assertHardenedQueryCostProfile('beta')).toThrow(/exactly match/);
      process.env.MONGODBURL = mongoUrl;
      process.env.YLABS_INVENTORY_PROFILE_PATH = '';
      expect(() => assertHardenedQueryCostProfile('beta')).toThrow(/hardened inventory profile/);
    } finally {
      for (const [key, value] of Object.entries({
        YLABS_INVENTORY_PROFILE_ACTIVE: original.active,
        YLABS_INVENTORY_PROFILE_NAME: original.name,
        YLABS_INVENTORY_PROFILE_PATH: original.profilePath,
        MONGODBURL: original.mongoUrl,
      })) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      fs.rmSync(directory, { recursive: true });
    }
  });

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

  it('refuses a symlink parent before creating descendants through it', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-phase0-query-cost-parent-'));
    const outside = fs.mkdtempSync(path.join(process.cwd(), 'phase0-query-cost-outside-'));
    const linkedParent = path.join(directory, 'linked');
    const output = path.join(linkedParent, 'new', 'query-cost.json');
    fs.symlinkSync(outside, linkedParent);

    try {
      expect(() => writePhase0HotPathQueryCostReport(fixtureReport(), output)).toThrow(
        /real directories/,
      );
      expect(fs.existsSync(path.join(outside, 'new'))).toBe(false);
    } finally {
      fs.rmSync(outside, { recursive: true });
    }
  });
});

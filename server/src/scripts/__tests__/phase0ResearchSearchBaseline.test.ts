import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  assertHardenedSearchBaselineProfile,
  sourceCommit,
  writePhase0ResearchSearchBaseline,
} from '../phase0ResearchSearchBaseline';
import type { Phase0ResearchSearchBaselineReport } from '../phase0ResearchSearchBaselineCore';

function fixtureReport(): Phase0ResearchSearchBaselineReport {
  return {
    schemaVersion: 2,
    artifactType: 'phase0-research-search-baseline',
    generatedAt: '2026-07-28T12:00:00.000Z',
    sourceCommit: '5d4b09617ed96c963c1e28011075a941d1307b13',
    environment: 'development',
    databaseName: 'Development',
    saltFingerprint: 'salt-fingerprint',
    meilisearch: {
      targetKind: 'local',
      indexName: 'researchentities',
      settingsFingerprint: 'settings-fingerprint',
      searchableAttributes: ['name'],
      filterableAttributes: ['archived'],
      sortableAttributes: ['browseRankScore'],
      embedderNames: ['default'],
      numberOfDocuments: 1,
      indexing: false,
    },
    suite: { iterations: 1, topK: 1, caseCount: 0 },
    summary: { degradedSamples: 0, unstableCases: 0, indexing: false, reviewRequired: false },
    cases: [],
  };
}

describe('Phase 0 ResearchEntity search baseline artifact writer', () => {
  it('revalidates both protected profiles at the executable boundary', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-search-executable-profile-'));
    const inventoryPath = path.join(directory, 'beta-inventory.env');
    const searchPath = path.join(directory, 'beta-search.env');
    const mongoUrl =
      'mongodb+srv://search-reader:unit-test-password@cluster.unit-test.mongodb.net/Beta';
    const searchValues = {
      MEILISEARCH_HOST: 'https://private-search.internal.test',
      MEILISEARCH_API_KEY: 'private-search-key-value',
      MEILISEARCH_INDEX_PREFIX: 'beta',
      PHASE0_SEARCH_BASELINE_SALT: '7decbd7cf96d4edca5e46dbe1d06f4a1b64b5846209f2bce',
    };
    fs.chmodSync(directory, 0o700);
    fs.writeFileSync(inventoryPath, `MONGODBURL=${mongoUrl}\n`, { mode: 0o600 });
    fs.writeFileSync(
      searchPath,
      `${Object.entries(searchValues)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n')}\n`,
      { mode: 0o600 },
    );
    const keys = [
      'YLABS_SEARCH_BASELINE_PROFILE_ACTIVE',
      'YLABS_INVENTORY_PROFILE_NAME',
      'YLABS_INVENTORY_PROFILE_PATH',
      'YLABS_SEARCH_BASELINE_PROFILE_PATH',
      'MONGODBURL',
      ...Object.keys(searchValues),
    ] as const;
    const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    try {
      process.env.YLABS_SEARCH_BASELINE_PROFILE_ACTIVE = 'true';
      expect(() => assertHardenedSearchBaselineProfile('beta')).toThrow(
        /hardened external profiles/,
      );

      process.env.YLABS_INVENTORY_PROFILE_NAME = 'beta-inventory';
      process.env.YLABS_INVENTORY_PROFILE_PATH = inventoryPath;
      process.env.YLABS_SEARCH_BASELINE_PROFILE_PATH = searchPath;
      process.env.MONGODBURL = mongoUrl;
      Object.assign(process.env, searchValues);
      expect(() => assertHardenedSearchBaselineProfile('beta')).not.toThrow();

      process.env.MEILISEARCH_API_KEY = 'forged-value';
      expect(() => assertHardenedSearchBaselineProfile('beta')).toThrow(/exactly match/);
    } finally {
      for (const key of keys) {
        const value = original[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      fs.rmSync(directory, { recursive: true });
    }
  });

  it('binds evidence to a clean full source commit', () => {
    const cleanHead = 'a'.repeat(40);
    const runCommand = ((_command: string, args: readonly string[]) =>
      args[0] === 'status' ? '' : `${cleanHead}\n`) as typeof import('child_process').execFileSync;

    expect(sourceCommit(runCommand, { SOURCE_COMMIT: cleanHead })).toBe(cleanHead);
    expect(() =>
      sourceCommit(
        ((_command: string, args: readonly string[]) =>
          args[0] === 'status'
            ? ' M server/src/index.ts\n'
            : `${cleanHead}\n`) as typeof import('child_process').execFileSync,
        {},
      ),
    ).toThrow(/clean source worktree/);
    expect(() => sourceCommit(runCommand, { SOURCE_COMMIT: 'b'.repeat(40) })).toThrow(
      /does not match/,
    );
  });

  it('writes a new mode-0600 artifact and refuses overwrite', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-phase0-search-baseline-'));
    const output = path.join(directory, 'baseline.json');

    const receipt = writePhase0ResearchSearchBaseline(fixtureReport(), output);

    expect(receipt).toMatchObject({ output });
    expect(receipt.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt.bytes).toBeGreaterThan(0);
    expect(fs.statSync(output).mode & 0o777).toBe(0o600);
    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject({
      artifactType: 'phase0-research-search-baseline',
      environment: 'development',
    });
    expect(() => writePhase0ResearchSearchBaseline(fixtureReport(), output)).toThrow(
      /EEXIST|file already exists/i,
    );
  });

  it('refuses a symlink output', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-phase0-search-symlink-'));
    const target = path.join(directory, 'target.json');
    const output = path.join(directory, 'baseline.json');
    fs.writeFileSync(target, '{}\n', { mode: 0o600 });
    fs.symlinkSync(target, output);

    expect(() => writePhase0ResearchSearchBaseline(fixtureReport(), output)).toThrow(
      /EEXIST|symbolic link/i,
    );
  });

  it('refuses a symlink parent before creating descendants through it', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-phase0-search-parent-'));
    const outside = fs.mkdtempSync(path.join(process.cwd(), 'phase0-search-outside-'));
    const linkedParent = path.join(directory, 'linked');
    const output = path.join(linkedParent, 'new', 'baseline.json');
    fs.symlinkSync(outside, linkedParent);

    try {
      expect(() => writePhase0ResearchSearchBaseline(fixtureReport(), output)).toThrow(
        /real directories/,
      );
      expect(fs.existsSync(path.join(outside, 'new'))).toBe(false);
    } finally {
      fs.rmSync(outside, { recursive: true });
    }
  });
});

import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { writePhase0ResearchSearchBaseline } from '../phase0ResearchSearchBaseline';
import type { Phase0ResearchSearchBaselineReport } from '../phase0ResearchSearchBaselineCore';

function fixtureReport(): Phase0ResearchSearchBaselineReport {
  return {
    schemaVersion: 1,
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
    summary: { degradedSamples: 0, unstableCases: 0, reviewRequired: false },
    cases: [],
  };
}

describe('Phase 0 ResearchEntity search baseline artifact writer', () => {
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

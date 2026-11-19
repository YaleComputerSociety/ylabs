import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  buildBetaReadinessCommands,
  buildBetaReadinessGateOutput,
  buildBetaReadinessGates,
  betaReadinessExitCode,
  parseBetaReadinessGateArgs,
  writeBetaReadinessGateOutput,
} from '../betaReadinessGate';

describe('betaReadinessGate CLI helpers', () => {
  it('parses the output flag', () => {
    expect(parseBetaReadinessGateArgs(['--output', '/tmp/ylabs-beta-readiness.json'])).toEqual({
      output: '/tmp/ylabs-beta-readiness.json',
    });
    expect(() => parseBetaReadinessGateArgs(['prod'])).toThrow(
      /Unknown Beta readiness gate argument: prod/,
    );
    expect(() => parseBetaReadinessGateArgs(['--output', '--strict'])).toThrow(
      /--output requires a path/,
    );
    expect(() => parseBetaReadinessGateArgs(['--output=--strict'])).toThrow(
      /--output requires a path/,
    );
    expect(() => parseBetaReadinessGateArgs(['--output=/var/tmp/beta-readiness.json'])).toThrow(
      /--output must write under/,
    );
    expect(() => parseBetaReadinessGateArgs(['--output=/tmp/beta-readiness.txt'])).toThrow(
      /--output must point to a \.json report file/,
    );
  });

  it('refuses the retired strict and accepted-input root flags (#3723)', () => {
    expect(() => parseBetaReadinessGateArgs(['--strict'])).toThrow(
      /Unknown Beta readiness gate argument: --strict/,
    );
    expect(() => parseBetaReadinessGateArgs(['--root', '/tmp/accepted-inputs'])).toThrow(
      /Unknown Beta readiness gate argument: --root/,
    );
  });

  it('refuses the retired backup confirmation flag, which verified nothing (#5556)', () => {
    expect(() => parseBetaReadinessGateArgs(['--confirm-beta-backup'])).toThrow(
      /Unknown Beta readiness gate argument: --confirm-beta-backup/,
    );
    expect(parseBetaReadinessGateArgs([])).toEqual({});
  });

  it('reports no backup gate, so no row can read ready on an operator assertion (#5556)', () => {
    const gates = buildBetaReadinessGates({
      legacyCollectionCounts: { research_groups: 0 },
      missingSources: [],
    });

    expect(Object.keys(gates).sort()).toEqual(['canonicalMigration', 'sourceMetadata']);
    expect(JSON.stringify(gates)).not.toMatch(/backup|restore point/i);
  });

  it('blocks the migration and source gates on the evidence they read', () => {
    const gates = buildBetaReadinessGates({
      legacyCollectionCounts: { research_groups: 2, applications: 0 },
      missingSources: ['nih-reporter'],
    });

    expect(gates.canonicalMigration.status).toBe('blocked');
    expect(gates.sourceMetadata).toMatchObject({
      status: 'blocked',
      missingSources: ['nih-reporter'],
    });
    expect(
      buildBetaReadinessGates({ legacyCollectionCounts: {}, missingSources: [] }).sourceMetadata
        .status,
    ).toBe('ready');
  });

  it('exits non-zero whenever any gate is blocked, with no flag needed (#3723)', () => {
    expect(betaReadinessExitCode(['sourceMetadata'])).toBe(1);
    expect(betaReadinessExitCode(['sourceMetadata', 'canonicalMigration'])).toBe(1);
    expect(betaReadinessExitCode([])).toBe(0);
  });

  it('writes the beta readiness artifact when output is provided', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-beta-readiness-'));
    const output = path.join(dir, 'beta-readiness.json');
    writeBetaReadinessGateOutput(
      {
        ready: false,
        gates: {
          sourceMetadata: { status: 'blocked' },
        },
      },
      output,
    );

    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject({
      ready: false,
      gates: {
        sourceMetadata: { status: 'blocked' },
      },
    });
    expect(() =>
      writeBetaReadinessGateOutput({ ready: true }, '/var/tmp/beta-readiness.json'),
    ).toThrow(/--output must write under/);
  });

  it('wraps beta readiness artifacts with target metadata and parsed options', () => {
    const output = buildBetaReadinessGateOutput(
      {
        ready: false,
        gates: {
          sourceMetadata: { status: 'blocked' },
        },
      },
      {
        environment: 'beta',
        db: 'Beta',
        options: {
          output: '/tmp/ylabs-beta-readiness.json',
        },
      },
    );

    expect(output).toEqual({
      ready: false,
      gates: {
        sourceMetadata: { status: 'blocked' },
      },
      environment: 'beta',
      db: 'Beta',
      options: {
        output: '/tmp/ylabs-beta-readiness.json',
      },
    });
  });

  it('advises only the promotion refresh and the guarded reindex, never a Beta write flag', () => {
    const commands = buildBetaReadinessCommands();

    expect(commands).toEqual({
      refreshFromDevelopment: 'yarn beta:refresh-from-development:plan',
      meiliRebuild: 'node scripts/reindex-search-index.mjs beta',
    });
    expect(JSON.stringify(commands)).not.toMatch(/ALLOW_NON_PROD_SCRAPER_WRITES|--clear/);
  });
});

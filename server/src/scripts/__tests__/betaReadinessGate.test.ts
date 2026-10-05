import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  buildBetaReadinessCommands,
  buildBetaReadinessGateOutput,
  betaReadinessExitCode,
  parseBetaReadinessGateArgs,
  writeBetaReadinessGateOutput,
} from '../betaReadinessGate';

describe('betaReadinessGate CLI helpers', () => {
  it('parses the backup confirmation and output flags', () => {
    expect(
      parseBetaReadinessGateArgs([
        '--confirm-beta-backup',
        '--output',
        '/tmp/ylabs-beta-readiness.json',
      ]),
    ).toEqual({
      confirmBetaBackup: true,
      output: '/tmp/ylabs-beta-readiness.json',
    });
    expect(() => parseBetaReadinessGateArgs(['prod'])).toThrow(
      /Unknown Beta readiness gate argument: prod/,
    );
    expect(() => parseBetaReadinessGateArgs(['--output', '--confirm-beta-backup'])).toThrow(
      /--output requires a path/,
    );
    expect(() => parseBetaReadinessGateArgs(['--output=--confirm-beta-backup'])).toThrow(
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

  it('defaults to an unconfirmed backup when no flag is passed', () => {
    expect(parseBetaReadinessGateArgs([])).toEqual({ confirmBetaBackup: false });
  });

  it('exits non-zero whenever any gate is blocked, with no flag needed (#3723)', () => {
    expect(betaReadinessExitCode(['betaBackup'])).toBe(1);
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
          betaBackup: { status: 'blocked' },
        },
      },
      output,
    );

    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject({
      ready: false,
      gates: {
        betaBackup: { status: 'blocked' },
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
          betaBackup: { status: 'blocked' },
        },
      },
      {
        environment: 'beta',
        db: 'Beta',
        options: {
          confirmBetaBackup: true,
          output: '/tmp/ylabs-beta-readiness.json',
        },
      },
    );

    expect(output).toEqual({
      ready: false,
      gates: {
        betaBackup: { status: 'blocked' },
      },
      environment: 'beta',
      db: 'Beta',
      options: {
        confirmBetaBackup: true,
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

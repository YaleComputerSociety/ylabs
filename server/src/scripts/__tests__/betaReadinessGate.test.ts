import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  buildBetaReadinessCommands,
  buildBetaReadinessGateOutput,
  parseBetaReadinessGateArgs,
  summarizeReviewedProfileLinkInput,
  writeBetaReadinessGateOutput,
} from '../betaReadinessGate';

describe('betaReadinessGate CLI helpers', () => {
  it('parses gate confirmation, strict, root, and output flags', () => {
    expect(
      parseBetaReadinessGateArgs([
        '--strict',
        '--confirm-beta-backup',
        '--root',
        '/tmp/accepted-inputs',
        '--output',
        '/tmp/ylabs-beta-readiness.json',
      ]),
    ).toEqual({
      root: '/tmp/accepted-inputs',
      strict: true,
      confirmBetaBackup: true,
      output: '/tmp/ylabs-beta-readiness.json',
    });
    expect(() => parseBetaReadinessGateArgs(['prod'])).toThrow(
      /Unknown Beta readiness gate argument: prod/,
    );
    expect(() => parseBetaReadinessGateArgs(['--root'])).toThrow(/--root requires a path/);
    expect(() => parseBetaReadinessGateArgs(['--root', '--strict'])).toThrow(
      /--root requires a path/,
    );
    expect(() => parseBetaReadinessGateArgs(['--root=--strict'])).toThrow(/--root requires a path/);
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

  it('defaults the accepted-input root to empty when omitted', () => {
    expect(parseBetaReadinessGateArgs([])).toEqual({
      root: '',
      strict: false,
      confirmBetaBackup: false,
    });
  });

  it('reports reviewed Scholar profile links without making them a scraper gate', () => {
    expect(
      summarizeReviewedProfileLinkInput(
        { status: 'ready', readyRows: 3, blockedRows: 0 },
        'Profile links are ready.',
        'Profile links are optional.',
      ),
    ).toEqual({
      status: 'ready',
      message: 'Profile links are ready.',
      readyRows: 3,
      blockedRows: 0,
    });
    expect(
      summarizeReviewedProfileLinkInput(
        { status: 'blocked', readyRows: 1, blockedRows: 2 },
        'Profile links are ready.',
        'Profile links are optional.',
      ),
    ).toEqual({
      status: 'deferred',
      message: 'Profile links are optional.',
      readyRows: 1,
      blockedRows: 2,
    });
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
        readyForUnblockedBetaSeed: false,
        gates: {
          betaBackup: { status: 'blocked' },
        },
      },
      {
        environment: 'beta',
        db: 'Beta',
        options: {
          root: '/tmp/accepted-inputs',
          strict: true,
          confirmBetaBackup: true,
          output: '/tmp/ylabs-beta-readiness.json',
        },
      },
    );

    expect(output).toEqual({
      readyForUnblockedBetaSeed: false,
      gates: {
        betaBackup: { status: 'blocked' },
      },
      environment: 'beta',
      db: 'Beta',
      options: {
        root: '/tmp/accepted-inputs',
        strict: true,
        confirmBetaBackup: true,
        output: '/tmp/ylabs-beta-readiness.json',
      },
    });
  });

  it('builds target-explicit Beta follow-up commands', () => {
    expect(buildBetaReadinessCommands()).toEqual({
      seedSources:
        'SCRAPER_ENV=beta ALLOW_NON_PROD_SCRAPER_WRITES=true yarn scrape:seed-sources --dry-run --output /tmp/ylabs-seed-sources-dry-run.json',
      sourceRun:
        'SCRAPER_ENV=beta ALLOW_NON_PROD_SCRAPER_WRITES=true yarn scrape run --source <source> --auto-materialize',
      meiliRebuild:
        'SCRAPER_ENV=beta yarn --cwd server meili:rebuild-research-entities --clear --confirm-meili-rebuild',
    });
  });
});

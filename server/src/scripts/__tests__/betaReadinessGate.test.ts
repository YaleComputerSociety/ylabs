import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  buildBetaReadinessCommands,
  buildBetaReadinessGateOutput,
  parseBetaReadinessGateArgs,
  writeBetaReadinessGateOutput,
} from '../betaReadinessGate';
import { DEFAULT_ACCEPTED_INPUT_ROOT } from '../acceptedInputsCore';

describe('betaReadinessGate CLI helpers', () => {
  it('parses gate confirmation, strict, root, and output flags', () => {
    expect(
      parseBetaReadinessGateArgs([
        '--strict',
        '--confirm-beta-backup',
        '--accept-pathway-meili',
        '--root',
        '/tmp/accepted-inputs',
        '--output',
        '/tmp/ylabs-beta-readiness.json',
      ]),
    ).toEqual({
      root: '/tmp/accepted-inputs',
      strict: true,
      confirmBetaBackup: true,
      acceptPathwayMeili: true,
      output: '/tmp/ylabs-beta-readiness.json',
    });
    expect(() => parseBetaReadinessGateArgs(['prod'])).toThrow(
      /Unknown Beta readiness gate argument: prod/,
    );
    expect(() => parseBetaReadinessGateArgs(['--root'])).toThrow(/--root requires a path/);
    expect(() => parseBetaReadinessGateArgs(['--root', '--strict'])).toThrow(
      /--root requires a path/,
    );
    expect(() => parseBetaReadinessGateArgs(['--root=--strict'])).toThrow(
      /--root requires a path/,
    );
    expect(() => parseBetaReadinessGateArgs(['--output', '--strict'])).toThrow(
      /--output requires a path/,
    );
    expect(() => parseBetaReadinessGateArgs(['--output=--strict'])).toThrow(
      /--output requires a path/,
    );
  });

  it('uses the default accepted-input root when root is omitted', () => {
    expect(parseBetaReadinessGateArgs([])).toEqual({
      root: DEFAULT_ACCEPTED_INPUT_ROOT,
      strict: false,
      confirmBetaBackup: false,
      acceptPathwayMeili: false,
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
          acceptPathwayMeili: true,
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
        acceptPathwayMeili: true,
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
      pathwayRelevance:
        'SCRAPER_ENV=beta PATHWAY_SEARCH_BACKEND=mongo yarn --cwd server pathway:relevance-review',
      paperAuthorshipAudit: 'SCRAPER_ENV=beta yarn --cwd server papers:authorship-audit',
      meiliRebuild:
        'SCRAPER_ENV=beta yarn --cwd server meili:rebuild-pathways --clear --confirm-meili-rebuild && SCRAPER_ENV=beta yarn --cwd server meili:rebuild-research-entities --clear --confirm-meili-rebuild',
      acceptedMeiliReadiness:
        'SCRAPER_ENV=beta PATHWAY_SEARCH_BACKEND=meili yarn --cwd server beta:readiness --confirm-beta-backup --accept-pathway-meili --strict',
    });
  });
});

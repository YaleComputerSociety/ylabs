import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

import {
  assertBetaSeedAllowed,
  buildBetaSeedPlan,
  parseBetaSeedEnvironmentArgs,
  writeBetaSeedOutput,
} from '../betaSeedEnvironment';

describe('betaSeedEnvironment CLI helpers', () => {
  it('parses dry-run defaults and explicit source lists', () => {
    expect(
      parseBetaSeedEnvironmentArgs([
        '--source',
        'ysm-atoz-index',
        '--sources=centers-institutes-index,dept-faculty-roster',
        '--artifact-dir',
        '/tmp/ylabs-beta-seed',
        '--output=/tmp/ylabs-beta-seed-plan.json',
      ]),
    ).toEqual({
      apply: false,
      confirmBetaSeed: false,
      seedSources: true,
      runReadiness: true,
      runPathwayRelevance: true,
      rebuildMeili: true,
      sources: ['ysm-atoz-index', 'centers-institutes-index', 'dept-faculty-roster'],
      artifactDir: '/tmp/ylabs-beta-seed',
      output: '/tmp/ylabs-beta-seed-plan.json',
    });
  });

  it('parses apply confirmation and skip flags', () => {
    expect(
      parseBetaSeedEnvironmentArgs([
        '--apply',
        '--confirm-beta-seed',
        '--skip-source-metadata',
        '--skip-readiness',
        '--skip-pathway-relevance',
        '--skip-meili',
      ]),
    ).toMatchObject({
      apply: true,
      confirmBetaSeed: true,
      seedSources: false,
      runReadiness: false,
      runPathwayRelevance: false,
      rebuildMeili: false,
      sources: [],
    });
  });

  it('rejects malformed arguments', () => {
    expect(() => parseBetaSeedEnvironmentArgs(['--source'])).toThrow(/--source requires a value/);
    expect(() => parseBetaSeedEnvironmentArgs(['--source=--apply'])).toThrow(
      /--source requires a value/,
    );
    expect(() => parseBetaSeedEnvironmentArgs(['--artifact-dir'])).toThrow(
      /--artifact-dir requires a path/,
    );
    expect(() => parseBetaSeedEnvironmentArgs(['--artifact-dir=/var/tmp/ylabs-beta-seed'])).toThrow(
      /--artifact-dir must write under/,
    );
    expect(() => parseBetaSeedEnvironmentArgs(['--output=/var/tmp/beta-seed.json'])).toThrow(
      /--output must write under/,
    );
    expect(() => parseBetaSeedEnvironmentArgs(['--output=/tmp/beta-seed.txt'])).toThrow(
      /--output must point to a \.json report file/,
    );
    expect(() => parseBetaSeedEnvironmentArgs(['unexpected'])).toThrow(
      /Unknown beta seed argument: unexpected/,
    );
  });

  it('requires confirmation for apply mode and refuses non-beta targets', () => {
    expect(() =>
      assertBetaSeedAllowed({
        options: parseBetaSeedEnvironmentArgs(['--apply']),
        env: { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        mongoUrl: 'mongodb://example.test/Beta',
      }),
    ).toThrow(/--confirm-beta-seed is required/);

    expect(() =>
      assertBetaSeedAllowed({
        options: parseBetaSeedEnvironmentArgs(['--apply', '--confirm-beta-seed']),
        env: { SCRAPER_ENV: 'production', CONFIRM_PROD_SCRAPE: 'true' } as NodeJS.ProcessEnv,
        mongoUrl: 'mongodb://example.test/Production',
      }),
    ).toThrow(/beta:seed-environment must run with SCRAPER_ENV=beta/);
  });

  it('builds a dry-run plan that seeds metadata, selected source runs, Meili, and checks', () => {
    const plan = buildBetaSeedPlan(
      parseBetaSeedEnvironmentArgs([
        '--source=ysm-atoz-index',
        '--artifact-dir=/tmp/ylabs-beta-seed',
      ]),
      {
        environment: 'beta',
        dbLabel: 'cluster.example.test/Beta',
      },
    );

    expect(plan.mode).toBe('dry-run');
    expect(plan.target).toEqual({
      environment: 'beta',
      db: 'cluster.example.test/Beta',
    });
    expect(plan.steps.map((step) => step.name)).toEqual([
      'beta-readiness-preflight',
      'seed-source-metadata-dry-run',
      'seed-source-metadata-apply',
      'run-source-ysm-atoz-index',
      'rebuild-pathway-meili-index',
      'rebuild-research-entity-meili-index',
      'pathway-relevance-review',
      'beta-readiness-meili-acceptance',
    ]);
    expect(plan.steps.find((step) => step.name === 'seed-source-metadata-apply')).toMatchObject({
      env: {
        SCRAPER_ENV: 'beta',
        ALLOW_NON_PROD_SCRAPER_WRITES: 'true',
      },
      args: [
        'scrape:seed-sources',
        '--apply',
        '--confirm-seed-apply',
        '--output',
        '/tmp/ylabs-beta-seed/seed-sources-apply.json',
      ],
    });
    expect(plan.steps.find((step) => step.name === 'run-source-ysm-atoz-index')).toMatchObject({
      args: [
        'scrape',
        'run',
        '--source',
        'ysm-atoz-index',
        '--auto-materialize',
        '--output',
        '/tmp/ylabs-beta-seed/source-ysm-atoz-index-report.json',
      ],
    });
    expect(() =>
      buildBetaSeedPlan(
        {
          ...parseBetaSeedEnvironmentArgs(['--skip-readiness']),
          artifactDir: '/var/tmp/ylabs-beta-seed',
        },
        {
          environment: 'beta',
          dbLabel: 'cluster.example.test/Beta',
        },
      ),
    ).toThrow(/--artifact-dir must write under/);
  });

  it('rejects unsafe beta seed report writes', () => {
    expect(() => writeBetaSeedOutput({ ok: true }, '/var/tmp/beta-seed.json')).toThrow(
      /--output must write under/,
    );
  });

  it('exposes the beta seed package script', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8'),
    );
    expect(packageJson.scripts['beta:seed-environment']).toBe(
      'tsx src/scripts/betaSeedEnvironment.ts',
    );
    expect(packageJson.scripts['beta:seed']).toBe('yarn beta:seed-environment');
    expect(packageJson.scripts['beta:seed-meili']).toBe(
      'cross-env SCRAPER_ENV=beta yarn beta:seed-environment --apply --confirm-beta-seed --skip-source-metadata --output /tmp/ylabs-beta-meili-result.json',
    );
  });
});

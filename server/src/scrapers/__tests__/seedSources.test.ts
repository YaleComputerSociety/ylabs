import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import {
  assertSeedSourcesWriteAllowed,
  buildSeedSourcesOutput,
  parseSeedSourcesArgs,
  writeSeedSourcesOutput,
} from '../seedSources';

const productionEnv = {
  SCRAPER_ENV: 'production',
  CONFIRM_PROD_SCRAPE: 'false',
} as NodeJS.ProcessEnv;

describe('seedSources CLI helpers', () => {
  it('parses reset, dry-run, and output flags', () => {
    expect(parseSeedSourcesArgs([])).toEqual({
      apply: false,
      confirmSeedApply: false,
      reset: false,
    });
    expect(parseSeedSourcesArgs(['--reset', '--dry-run', '--output=/tmp/sources.json'])).toEqual({
      apply: false,
      confirmSeedApply: false,
      reset: true,
      output: '/tmp/sources.json',
    });
    expect(() => parseSeedSourcesArgs(['--output=/etc/sources.json'])).toThrow(
      /--output must write under/,
    );
    expect(() => parseSeedSourcesArgs(['--output=/tmp/sources.txt'])).toThrow(
      /--output must point to a \.json report file/,
    );
  });

  it('blocks apply source seeding without explicit confirmation', () => {
    expect(() =>
      assertSeedSourcesWriteAllowed(
        { apply: true, confirmSeedApply: false },
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        'mongodb+srv://example.mongodb.net/Beta',
      ),
    ).toThrow(/--confirm-seed-apply is required/);

    expect(() =>
      assertSeedSourcesWriteAllowed(
        { apply: true, confirmSeedApply: true },
        productionEnv,
        'mongodb+srv://example.mongodb.net/Production',
      ),
    ).toThrow(/production writes require CONFIRM_PROD_SCRAPE=true/);

    expect(() =>
      assertSeedSourcesWriteAllowed(
        { apply: false, confirmSeedApply: false },
        productionEnv,
        'mongodb+srv://example.mongodb.net/Production',
      ),
    ).not.toThrow();
  });

  it('adds target metadata and writes source seeding artifacts', () => {
    const payload = buildSeedSourcesOutput(
      {
        mode: 'dry-run',
        sourceCount: 2,
        sources: [{ name: 'openalex', action: 'would_update' }],
      },
      {
        environment: 'beta',
        db: 'Beta',
        options: {
          apply: false,
          confirmSeedApply: false,
          reset: false,
          output: '/tmp/sources.json',
        },
      },
    );

    expect(payload).toMatchObject({
      mode: 'dry-run',
      environment: 'beta',
      db: 'Beta',
      options: {
        apply: false,
        confirmSeedApply: false,
        reset: false,
        output: '/tmp/sources.json',
      },
      sourceCount: 2,
      sources: [{ name: 'openalex', action: 'would_update' }],
    });

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-seed-sources-'));
    const output = path.join(dir, 'sources.json');
    writeSeedSourcesOutput(payload, output);
    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject(payload);
    expect(() => writeSeedSourcesOutput(payload, '/etc/sources.json')).toThrow(
      /--output must write under/,
    );
  });
});

import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import {
  ACTIVE_SOURCE_NAMES,
  RETIRED_SOURCE_NAMES,
  assertSeedSourcesWriteAllowed,
  buildSeedSourcesOutput,
  parseSeedSourcesArgs,
  writeSeedSourcesOutput,
} from '../seedSources';
import { RETIRED_BIBLIOGRAPHIC_SOURCE_NAMES } from '../retiredPaperPipeline';
import { getSourceCoverage } from '../sourceCoverageRegistry';

const productionEnv = {
  SCRAPER_ENV: 'production',
  CONFIRM_PROD_SCRAPE: 'false',
} as NodeJS.ProcessEnv;

describe('seedSources CLI helpers', () => {
  it('retires bibliography sources instead of seeding them as active', () => {
    for (const sourceName of RETIRED_BIBLIOGRAPHIC_SOURCE_NAMES) {
      expect(ACTIVE_SOURCE_NAMES, sourceName).not.toContain(sourceName);
      expect(RETIRED_SOURCE_NAMES, sourceName).toContain(sourceName);
    }
  });

  it('retires the student-decision LLM source instead of seeding it as active', () => {
    expect(ACTIVE_SOURCE_NAMES).not.toContain('student-decision-llm');
    expect(RETIRED_SOURCE_NAMES).toContain('student-decision-llm');
  });

  it('retires the orphaned external-fellowship LLM seed instead of seeding it as active', () => {
    expect(ACTIVE_SOURCE_NAMES).not.toContain('external-fellowship-llm-scraper');
    expect(RETIRED_SOURCE_NAMES).toContain('external-fellowship-llm-scraper');
  });

  it('gives every active seeded source a coverage-registry entry', () => {
    const orphaned = ACTIVE_SOURCE_NAMES.filter((name) => getSourceCoverage(name) === undefined);
    expect(orphaned).toEqual([]);
  });

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

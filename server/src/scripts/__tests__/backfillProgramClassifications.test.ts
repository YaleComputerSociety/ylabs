import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import {
  assertBackfillProgramClassificationsApplyAllowed,
  buildBackfillProgramClassificationsOutput,
  parseBackfillProgramClassificationsArgs,
  writeBackfillProgramClassificationsOutput,
} from '../backfillProgramClassifications';

describe('backfillProgramClassifications CLI helpers', () => {
  it('parses apply, limit, and output flags', () => {
    expect(
      parseBackfillProgramClassificationsArgs([
        '--apply',
        '--confirm-program-classification-backfill',
        '--limit=15',
        '--output',
        '/tmp/ylabs-program-classifications.json',
      ]),
    ).toEqual({
      apply: true,
      confirmProgramClassificationBackfill: true,
      limit: 15,
      output: '/tmp/ylabs-program-classifications.json',
    });
    expect(() => parseBackfillProgramClassificationsArgs(['prod'])).toThrow(
      /Unknown program classification backfill argument: prod/,
    );
    expect(() => parseBackfillProgramClassificationsArgs(['--limit=bad'])).toThrow(
      /--limit requires a positive integer/,
    );
    expect(() =>
      parseBackfillProgramClassificationsArgs(['--limit=9007199254740992']),
    ).toThrow(/--limit requires a positive integer/);
  });

  it('rejects malformed program classification output paths', () => {
    expect(() => parseBackfillProgramClassificationsArgs(['--output', '--apply'])).toThrow(
      /--output requires a path/,
    );
    expect(() => parseBackfillProgramClassificationsArgs(['--output=--apply'])).toThrow(
      /--output requires a path/,
    );
  });

  it('requires a bounded limit before apply mode can run', () => {
    expect(() =>
      assertBackfillProgramClassificationsApplyAllowed(
        { apply: true, confirmProgramClassificationBackfill: true, limit: Infinity },
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        'mongodb://example.invalid/Beta',
      ),
    ).toThrow(/--limit is required when --apply is set/);

    expect(
      assertBackfillProgramClassificationsApplyAllowed(
        { apply: true, confirmProgramClassificationBackfill: true, limit: 15 },
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        'mongodb://example.invalid/Beta',
      ),
    ).toMatchObject({ environment: 'beta' });
  });

  it('requires explicit confirmation before program classification backfill apply', () => {
    expect(parseBackfillProgramClassificationsArgs(['--apply', '--limit=15'])).toMatchObject({
      apply: true,
      confirmProgramClassificationBackfill: false,
      limit: 15,
    });
    expect(() =>
      assertBackfillProgramClassificationsApplyAllowed(
        { apply: true, confirmProgramClassificationBackfill: false, limit: 15 },
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        'mongodb://example.invalid/Beta',
      ),
    ).toThrow(/--confirm-program-classification-backfill is required/);
  });

  it('writes the program classification artifact when output is provided', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-program-classifications-'));
    const output = path.join(dir, 'program-classifications.json');
    const payload = {
      mode: 'dry-run',
      scanned: 5,
      counts: { structured_program: 2 },
    };

    writeBackfillProgramClassificationsOutput(payload, output);

    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject(payload);
  });

  it('wraps program classification artifacts with target metadata and parsed options', () => {
    const output = buildBackfillProgramClassificationsOutput(
      {
        mode: 'dry-run',
        scanned: 5,
        counts: { structured_program: 2 },
      },
      {
        environment: 'beta',
        db: 'Beta',
        options: {
          apply: false,
          confirmProgramClassificationBackfill: false,
          limit: 15,
          output: '/tmp/ylabs-program-classifications.json',
        },
      },
    );

    expect(output).toEqual({
      mode: 'dry-run',
      scanned: 5,
      counts: { structured_program: 2 },
      environment: 'beta',
      db: 'Beta',
      options: {
        apply: false,
        confirmProgramClassificationBackfill: false,
        limit: 15,
        output: '/tmp/ylabs-program-classifications.json',
      },
    });
  });
});
